import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runWrappedCli } from '@cli2voice/dictation-core';
import { splitCompleteJsonlChunk } from '@cli2voice/voice-core';
import { Cli2VoiceDaemonClient } from '@cli2voice/voice-daemon/client';
import { readDaemonConfig } from '@cli2voice/voice-daemon/config';
import { parseCodexSessionActionsDetailed } from './events.js';

type TrackedFile = {
  offset: number;
  lastChunkAt: number;
  pendingLine: string;
};

type SessionFileInfo = {
  filePath: string;
  size: number;
  birthtimeMs: number;
  mtimeMs: number;
};

type SessionMetaPayload = {
  id?: string;
  cwd?: string;
  source?: unknown;
  originator?: string;
};

const SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const MIN_POLL_INTERVAL_MS = 80;
const MAX_POLL_INTERVAL_MS = 900;
const IDLE_POLL_BACKOFF_STEP_MS = 80;
const DISCOVERY_INTERVAL_MS = 900;
const MAX_APPENDED_READ_BYTES = 512 * 1024;
const SESSION_META_READ_BYTES = 64 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPLAY_WINDOW_MS = 5000;
const WS_DISABLE_FLAGS = ['responses_websockets', 'responses_websockets_v2'] as const;
export const WRAPPED_CODEX_DEFAULT_VOICE_MODE = 'always' as const;

function getSessionDayDir(date: Date): string {
  const yyyy = date.getFullYear().toString();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(SESSIONS_DIR, yyyy, mm, dd);
}

export function shouldReplayFromStart(stat: { birthtimeMs: number }, wrapperStartedAt: number): boolean {
  if (!Number.isFinite(stat.birthtimeMs) || stat.birthtimeMs <= 0) return false;
  return stat.birthtimeMs >= wrapperStartedAt - REPLAY_WINDOW_MS;
}

async function listSessionFilesFast(): Promise<SessionFileInfo[]> {
  const today = getSessionDayDir(new Date());
  const yesterday = getSessionDayDir(new Date(Date.now() - DAY_MS));
  const dirs = today === yesterday ? [today] : [today, yesterday];
  const files: SessionFileInfo[] = [];

  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return;
          const filePath = path.join(dir, entry.name);
          try {
            const stat = await fs.stat(filePath);
            files.push({
              filePath,
              size: stat.size,
              birthtimeMs: stat.birthtimeMs,
              mtimeMs: stat.mtimeMs
            });
          } catch {
            // ignore unreadable files
          }
        })
      );
    } catch {
      // ignore missing directories
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

function hasWsFeatureToken(token: string): boolean {
  return token
    .split(',')
    .map((part) => part.trim())
    .some((part) => WS_DISABLE_FLAGS.includes(part as (typeof WS_DISABLE_FLAGS)[number]));
}

export function hasWebSocketFeatureOverride(userArgs: string[]): boolean {
  for (let index = 0; index < userArgs.length; index += 1) {
    const token = userArgs[index] ?? '';
    if (token === '--enable' || token === '--disable') {
      const next = userArgs[index + 1] ?? '';
      if (hasWsFeatureToken(next)) return true;
      index += 1;
      continue;
    }
    if (token.startsWith('--enable=')) {
      if (hasWsFeatureToken(token.slice('--enable='.length))) return true;
    }
    if (token.startsWith('--disable=')) {
      if (hasWsFeatureToken(token.slice('--disable='.length))) return true;
    }
  }
  return false;
}

function buildCodexArgs(userArgs: string[]): string[] {
  if (hasWebSocketFeatureOverride(userArgs)) return userArgs;
  return ['--disable', 'responses_websockets', '--disable', 'responses_websockets_v2', ...userArgs];
}

async function readAppendedChunk(
  filePath: string,
  offset: number
): Promise<{ nextOffset: number; chunk: string; didResetOffset: boolean }> {
  const stat = await fs.stat(filePath);
  const size = stat.size;
  const didResetOffset = offset > size;
  const safeOffset = didResetOffset ? 0 : offset;
  const length = size - safeOffset;
  if (length <= 0) return { nextOffset: size, chunk: '', didResetOffset };

  const bytesToRead = Math.min(length, MAX_APPENDED_READ_BYTES);
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, safeOffset);
    return {
      nextOffset: safeOffset + bytesToRead,
      chunk: buffer.toString('utf8'),
      didResetOffset
    };
  } finally {
    await handle.close();
  }
}

function computeNextPollInterval(previousMs: number, hadActivity: boolean): number {
  if (hadActivity) return MIN_POLL_INTERVAL_MS;
  const stepped = previousMs + IDLE_POLL_BACKOFF_STEP_MS;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, stepped));
}

export function extractResumedCodexThreadId(userArgs: string[]): string | null {
  for (let index = 0; index < userArgs.length; index += 1) {
    if ((userArgs[index] ?? '') !== 'resume') {
      continue;
    }

    const threadId = userArgs[index + 1]?.trim();
    return threadId ? threadId : null;
  }

  return null;
}

async function readSessionMeta(filePath: string): Promise<SessionMetaPayload | null> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(SESSION_META_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead <= 0) {
      return null;
    }

    const head = buffer.toString('utf8', 0, bytesRead);
    const lines = head.split('\n').slice(0, 8);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const event = JSON.parse(trimmed) as { type?: string; payload?: SessionMetaPayload };
        if (event.type === 'session_meta' && event.payload) {
          return event.payload;
        }
      } catch {
        // ignore malformed partial lines at the start of the file
      }
    }

    return null;
  } finally {
    await handle.close();
  }
}

export function isPrimaryCliSessionMeta(meta: SessionMetaPayload | null | undefined, cwd: string): boolean {
  if (!meta) {
    return false;
  }

  if (meta.cwd !== cwd) {
    return false;
  }

  if (meta.source !== 'cli') {
    return false;
  }

  return meta.originator === 'codex_cli_rs';
}

export async function runCodexWrapper(args: string[], options: { debugEvents?: boolean } = {}): Promise<void> {
  const debugEvents = Boolean(options.debugEvents);
  const debug = (line: string): void => {
    if (debugEvents) {
      process.stderr.write(`[cli2voice codex] ${line}\n`);
    }
  };

  const client = new Cli2VoiceDaemonClient();
  await client.health();
  const config = await readDaemonConfig();

  const codexArgs = buildCodexArgs(args);
  const resumedThreadId = extractResumedCodexThreadId(codexArgs);
  const wrapperStartedAt = Date.now();
  const sessionId = `codex-${process.pid}-${wrapperStartedAt}`;
  await client.registerSession({
    sessionId,
    provider: 'codex',
    workspacePath: process.cwd(),
    defaultMode: WRAPPED_CODEX_DEFAULT_VOICE_MODE,
    metadata: {
      argv: JSON.stringify(codexArgs)
    }
  });

  const sessionMetaCache = new Map<string, Promise<SessionMetaPayload | null>>();
  let trackedFilePath: string | null = null;
  let trackedFile: TrackedFile | null = null;
  let lastDiscoveryAt = 0;
  let publishQueue: Promise<void> = Promise.resolve();

  const publishActionsInOrder = (actions: Awaited<ReturnType<typeof parseCodexSessionActionsDetailed>>['actions']): void => {
    publishQueue = publishQueue
      .then(async () => {
        await client.publishActions({ sessionId }, { actions });
      })
      .catch((error) => {
        process.stderr.write(`cli2voice publish failed: ${error instanceof Error ? error.message : String(error)}\n`);
      });
  };

  const getCachedSessionMeta = (filePath: string): Promise<SessionMetaPayload | null> => {
    const existing = sessionMetaCache.get(filePath);
    if (existing) {
      return existing;
    }

    const pending = readSessionMeta(filePath).catch(() => null);
    sessionMetaCache.set(filePath, pending);
    return pending;
  };

  const discoverTrackedFile = async (): Promise<boolean> => {
    if (trackedFilePath && trackedFile) {
      return false;
    }

    const files = await listSessionFilesFast();
    const freshCutoff = wrapperStartedAt - REPLAY_WINDOW_MS;
    const explicitMatchByPath =
      resumedThreadId ? files.find((file) => path.basename(file.filePath).includes(resumedThreadId)) ?? null : null;

    const candidates = explicitMatchByPath ? [explicitMatchByPath] : files;
    for (const file of candidates) {
      if (!resumedThreadId && file.birthtimeMs < freshCutoff) {
        continue;
      }

      const meta = await getCachedSessionMeta(file.filePath);
      if (!meta) {
        continue;
      }

      if (resumedThreadId) {
        if (meta.id !== resumedThreadId) {
          continue;
        }
      } else if (!isPrimaryCliSessionMeta(meta, process.cwd())) {
        continue;
      }

      const replayFromStart = shouldReplayFromStart({ birthtimeMs: file.birthtimeMs }, wrapperStartedAt);
      trackedFilePath = file.filePath;
      trackedFile = {
        offset: resumedThreadId ? file.size : replayFromStart ? 0 : file.size,
        lastChunkAt: 0,
        pendingLine: ''
      };
      debug(`tracking ${path.basename(file.filePath)}${meta.id ? ` thread=${meta.id}` : ''}`);
      return true;
    }

    return false;
  };

  const refreshTrackedFile = async (): Promise<boolean> => {
    if (!trackedFilePath || !trackedFile) {
      return false;
    }

    try {
      const result = await readAppendedChunk(trackedFilePath, trackedFile.offset);
      const framed = splitCompleteJsonlChunk(`${trackedFile.pendingLine}${result.chunk}`);
      const now = Date.now();
      trackedFile = {
        offset: result.nextOffset,
        lastChunkAt: result.chunk ? now : trackedFile.lastChunkAt,
        pendingLine: framed.trailingPartial
      };

      if (!result.chunk) {
        return false;
      }

      const { actions, traces } = parseCodexSessionActionsDetailed(framed.completeChunk, { debug: debugEvents });
      if (debugEvents) {
        for (const trace of traces) {
          debug(`${path.basename(trackedFilePath)} ${trace}`);
        }
      }
      if (actions.length > 0) {
        publishActionsInOrder(actions);
      }
      return true;
    } catch {
      trackedFilePath = null;
      trackedFile = null;
      return false;
    }
  };

  const discoverIfNeeded = async (): Promise<boolean> => {
    const now = Date.now();
    if (now - lastDiscoveryAt < DISCOVERY_INTERVAL_MS) return false;
    lastDiscoveryAt = now;
    return discoverTrackedFile();
  };

  const pollSession = async (): Promise<boolean> => {
    const discovered = await discoverIfNeeded();
    if (!trackedFilePath || !trackedFile) {
      return discovered;
    }

    const hadActivity = await refreshTrackedFile();
    return discovered || hadActivity;
  };

  await discoverTrackedFile();

  /* Legacy broad-session watcher removed.
     The wrapper now locks onto the single Codex session file created for this
     launch (or the explicitly resumed thread) so parallel wrappers do not
     re-speak each other’s output. */
  let pollIntervalMs = MIN_POLL_INTERVAL_MS;
  let polling = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = (): void => {
    if (polling) return;
    polling = true;
    void pollSession()
      .then((hadActivity) => {
        const nextInterval = computeNextPollInterval(pollIntervalMs, hadActivity);
        if (nextInterval !== pollIntervalMs) {
          pollIntervalMs = nextInterval;
          if (timer) clearInterval(timer);
          timer = setInterval(tick, pollIntervalMs);
        }
      })
      .catch((error) => {
        process.stderr.write(`cli2voice polling failed: ${error instanceof Error ? error.message : String(error)}\n`);
      })
      .finally(() => {
        polling = false;
      });
  };

  timer = setInterval(tick, pollIntervalMs);
  tick();

  await runWrappedCli({
    command: 'codex',
    args: codexArgs,
    dictation: config.dictation,
    env: {
      ...process.env,
      CLI2VOICE_SESSION_ID: sessionId
    },
    onExit: async () => {
      if (timer) clearInterval(timer);
      await pollSession();
      await publishQueue;
    }
  });
}
