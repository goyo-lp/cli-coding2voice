import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { splitCompleteJsonlChunk } from '@cli2voice/voice-core';
import { Cli2VoiceDaemonClient } from '@cli2voice/voice-daemon/client';
import { parseCodexSessionActionsDetailed } from './events.js';

type TrackedFile = {
  offset: number;
  isFresh: boolean;
  lastChunkAt: number;
  pendingLine: string;
};

type SessionFileInfo = {
  filePath: string;
  size: number;
  birthtimeMs: number;
  mtimeMs: number;
};

type PollCandidate = {
  filePath: string;
  isFresh: boolean;
};

const SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const MIN_POLL_INTERVAL_MS = 140;
const MAX_POLL_INTERVAL_MS = 1100;
const IDLE_POLL_BACKOFF_STEP_MS = 120;
const DISCOVERY_INTERVAL_MS = 900;
const DISCOVERY_INTERVAL_LOCKED_MS = 3000;
const ACTIVE_FILE_SWEEP_INTERVAL_MS = 2800;
const ACTIVE_FILE_STALE_MS = 6000;
const MAX_APPENDED_READ_BYTES = 512 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPLAY_WINDOW_MS = 5000;
const WS_DISABLE_FLAGS = ['responses_websockets', 'responses_websockets_v2'] as const;

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

function selectTrackedFilesForPoll(
  candidates: PollCandidate[],
  activeFilePath: string | null,
  includeBackgroundSweep: boolean
): string[] {
  if (activeFilePath && candidates.some((candidate) => candidate.filePath === activeFilePath)) {
    if (!includeBackgroundSweep) return [activeFilePath];
    return [
      activeFilePath,
      ...candidates.filter((candidate) => candidate.filePath !== activeFilePath).map((candidate) => candidate.filePath)
    ];
  }

  const fresh = candidates.filter((candidate) => candidate.isFresh).map((candidate) => candidate.filePath);
  if (fresh.length > 0) return fresh;
  return candidates.map((candidate) => candidate.filePath);
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

  const codexArgs = buildCodexArgs(args);
  const wrapperStartedAt = Date.now();
  const sessionId = `codex-${process.pid}-${wrapperStartedAt}`;
  await client.registerSession({
    sessionId,
    provider: 'codex',
    workspacePath: process.cwd(),
    metadata: {
      argv: JSON.stringify(codexArgs)
    }
  });

  const trackedFiles = new Map<string, TrackedFile>();
  let activeFilePath: string | null = null;
  let lastDiscoveryAt = 0;
  let lastBackgroundSweepAt = 0;

  const seedTrackedFiles = async (): Promise<boolean> => {
    const files = await listSessionFilesFast();
    const discoveredPaths = new Set(files.map((file) => file.filePath));
    let changed = false;

    for (const file of files) {
      if (trackedFiles.has(file.filePath)) continue;
      const replayFromStart = shouldReplayFromStart({ birthtimeMs: file.birthtimeMs }, wrapperStartedAt);
      trackedFiles.set(file.filePath, {
        offset: replayFromStart ? 0 : file.size,
        isFresh: replayFromStart,
        lastChunkAt: 0,
        pendingLine: ''
      });
      changed = true;
    }

    for (const trackedPath of Array.from(trackedFiles.keys())) {
      if (discoveredPaths.has(trackedPath)) continue;
      trackedFiles.delete(trackedPath);
      if (activeFilePath === trackedPath) {
        activeFilePath = null;
      }
      changed = true;
    }

    return changed;
  };

  const discoverIfNeeded = async (): Promise<boolean> => {
    const now = Date.now();
    const discoveryInterval = activeFilePath ? DISCOVERY_INTERVAL_LOCKED_MS : DISCOVERY_INTERVAL_MS;
    if (now - lastDiscoveryAt < discoveryInterval) return false;
    lastDiscoveryAt = now;
    return seedTrackedFiles();
  };

  const shouldSwitchActiveFile = (candidateFilePath: string, now: number): boolean => {
    if (activeFilePath === candidateFilePath) return false;
    const currentActive = activeFilePath ? trackedFiles.get(activeFilePath) : null;
    const activeIsStale = !currentActive || now - currentActive.lastChunkAt >= ACTIVE_FILE_STALE_MS;
    return !activeFilePath || activeIsStale;
  };

  const pollSession = async (): Promise<boolean> => {
    const discoveredChanges = await discoverIfNeeded();
    let hadActivity = discoveredChanges;
    const now = Date.now();
    const shouldSweepAll = Boolean(activeFilePath && now - lastBackgroundSweepAt >= ACTIVE_FILE_SWEEP_INTERVAL_MS);
    if (shouldSweepAll) {
      lastBackgroundSweepAt = now;
    }

    const filesToPoll = selectTrackedFilesForPoll(
      Array.from(trackedFiles.entries()).map(([filePath, state]) => ({ filePath, isFresh: state.isFresh })),
      activeFilePath,
      shouldSweepAll
    );

    for (const filePath of filesToPoll) {
      const state = trackedFiles.get(filePath);
      if (!state) continue;
      let nextOffset = state.offset;
      let chunk = '';
      let pendingLine = state.pendingLine;
      try {
        const result = await readAppendedChunk(filePath, state.offset);
        nextOffset = result.nextOffset;
        chunk = result.chunk;
        if (result.didResetOffset) pendingLine = '';
      } catch {
        if (activeFilePath === filePath) activeFilePath = null;
        continue;
      }

      const framed = splitCompleteJsonlChunk(`${pendingLine}${chunk}`);
      trackedFiles.set(filePath, {
        ...state,
        offset: nextOffset,
        lastChunkAt: chunk ? now : state.lastChunkAt,
        pendingLine: framed.trailingPartial,
        isFresh: false
      });
      if (!chunk) continue;
      hadActivity = true;

      const { actions, traces } = parseCodexSessionActionsDetailed(framed.completeChunk, { debug: debugEvents });
      if (debugEvents) {
        for (const trace of traces) {
          debug(`${path.basename(filePath)} ${trace}`);
        }
      }
      if (actions.length === 0) continue;
      if (!activeFilePath && state.isFresh) {
        activeFilePath = filePath;
      }
      if (actions.some((action) => action.kind === 'candidate') && shouldSwitchActiveFile(filePath, now)) {
        activeFilePath = filePath;
      }
      await client.publishActions({ sessionId }, { actions });
    }

    return hadActivity;
  };

  await seedTrackedFiles();

  const child = spawn('codex', codexArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      CLI2VOICE_SESSION_ID: sessionId
    }
  });

  child.on('error', (error) => {
    process.stderr.write(`cli2voice codex spawn failed: ${error.message}\n`);
  });

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

  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
  });

  if (timer) clearInterval(timer);
  await pollSession();
  process.exitCode = exitCode;
}
