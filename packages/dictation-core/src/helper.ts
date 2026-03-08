import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  DictationConfig,
  DictationShortcut,
  DictationStatus,
  MacosDictationEvent
} from './types.js';

const execFileAsync = promisify(execFile);

function getPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..');
}

export function getMacosDictationHelperSourcePath(): string {
  return path.join(getPackageRoot(), 'native', 'macos-dictation-helper', 'main.swift');
}

export function getMacosDictationHelperBinaryPath(): string {
  return path.join(os.homedir(), '.cli2voice', 'bin', 'cli2voice-dictation-helper');
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function hasSwiftCompiler(): Promise<boolean> {
  try {
    await execFileAsync('xcrun', ['--find', 'swiftc']);
    return true;
  } catch {
    return false;
  }
}

export async function ensureMacosDictationHelperBuilt(force = false): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new Error('The macOS dictation helper is only supported on macOS.');
  }

  const sourcePath = getMacosDictationHelperSourcePath();
  const binaryPath = getMacosDictationHelperBinaryPath();
  const swiftc = await hasSwiftCompiler();
  if (!swiftc) {
    throw new Error('Unable to find swiftc via xcrun. Install Xcode command line tools.');
  }

  await fs.mkdir(path.dirname(binaryPath), { recursive: true });

  const sourceStat = await fs.stat(sourcePath);
  const binaryStat = force ? null : await fs.stat(binaryPath).catch(() => null);

  if (!force && binaryStat && binaryStat.mtimeMs >= sourceStat.mtimeMs) {
    return binaryPath;
  }

  await execFileAsync('xcrun', [
    'swiftc',
    '-O',
    sourcePath,
    '-framework',
    'AVFoundation',
    '-framework',
    'CoreGraphics',
    '-framework',
    'Speech',
    '-o',
    binaryPath
  ]);

  return binaryPath;
}

export function parseMacosDictationEvent(line: string): MacosDictationEvent | null {
  if (!line.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const event = parsed as Record<string, unknown>;
  if (
    event.type === 'recording_started' &&
    typeof event.shortcut === 'string' &&
    typeof event.backend === 'string'
  ) {
    return {
      type: 'recording_started',
      shortcut: event.shortcut as DictationShortcut,
      backend: event.backend as 'macos_native' | 'daemon_whisper'
    };
  }

  if (
    event.type === 'recording_stopped' &&
    typeof event.reason === 'string' &&
    typeof event.shortcut === 'string' &&
    typeof event.backend === 'string'
  ) {
    return {
      type: 'recording_stopped',
      audioPath: typeof event.audioPath === 'string' ? event.audioPath : undefined,
      reason: event.reason === 'timeout' ? 'timeout' : 'released',
      shortcut: event.shortcut as DictationShortcut,
      backend: event.backend as 'macos_native' | 'daemon_whisper'
    };
  }

  if (
    event.type === 'transcript_partial' &&
    typeof event.text === 'string' &&
    typeof event.shortcut === 'string'
  ) {
    return {
      type: 'transcript_partial',
      text: event.text,
      shortcut: event.shortcut as DictationShortcut,
      backend: 'macos_native'
    };
  }

  if (
    event.type === 'transcript_final' &&
    typeof event.text === 'string' &&
    typeof event.shortcut === 'string'
  ) {
    return {
      type: 'transcript_final',
      text: event.text,
      shortcut: event.shortcut as DictationShortcut,
      backend: 'macos_native'
    };
  }

  if (
    event.type === 'transcript_empty' &&
    typeof event.reason === 'string' &&
    typeof event.shortcut === 'string'
  ) {
    return {
      type: 'transcript_empty',
      shortcut: event.shortcut as DictationShortcut,
      reason: event.reason === 'timeout' ? 'timeout' : 'released',
      backend: 'macos_native'
    };
  }

  if (event.type === 'error' && typeof event.message === 'string') {
    return { type: 'error', message: event.message };
  }

  return null;
}

export async function getDictationStatus(config: DictationConfig): Promise<DictationStatus> {
  const sourcePath = getMacosDictationHelperSourcePath();
  const binaryPath = getMacosDictationHelperBinaryPath();
  const [binaryExists, swiftcAvailable] = await Promise.all([
    fileExists(binaryPath),
    process.platform === 'darwin' ? hasSwiftCompiler() : Promise.resolve(false)
  ]);

  return {
    enabled: config.enabled,
    platformSupported: process.platform === 'darwin',
    shortcut: config.shortcut,
    backend: config.backend,
    insertMode: config.insertMode,
    sttModel: config.sttModel,
    language: config.language,
    device: config.device,
    dtype: config.dtype,
    prewarm: config.prewarm,
    partialResults: config.partialResults,
    maxRecordingMs: config.maxRecordingMs,
    dictionary: config.dictionary,
    snippets: config.snippets,
    commandMode: config.commandMode,
    helper: {
      sourcePath,
      binaryPath,
      binaryExists,
      swiftcAvailable
    }
  };
}

export async function startMacosDictationHelper(
  config: DictationConfig,
  onEvent: (event: MacosDictationEvent) => Promise<void> | void
): Promise<{ close(): Promise<void> }> {
  const helperPath = await ensureMacosDictationHelperBuilt();
  const child = spawn(
    helperPath,
    [
      'listen',
      '--shortcut',
      config.shortcut,
      '--backend',
      config.backend,
      '--language',
      config.language,
      '--partial-results',
      String(config.partialResults),
      '--max-recording-ms',
      String(config.maxRecordingMs)
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const dispatchEvent = (event: MacosDictationEvent): void => {
    void Promise.resolve(onEvent(event)).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`cli2voice dictation event handling failed: ${message}\n`);
    });
  };

  const stdout = createInterface({ input: child.stdout });
  stdout.on('line', (line) => {
    const event = parseMacosDictationEvent(line);
    if (event) {
      dispatchEvent(event);
    }
  });

  const stderr = createInterface({ input: child.stderr });
  stderr.on('line', (line) => {
    if (line.trim()) {
      dispatchEvent({ type: 'error', message: line.trim() });
    }
  });

  child.on('error', (error) => {
    dispatchEvent({ type: 'error', message: error.message });
  });

  return {
    async close() {
      stdout.close();
      stderr.close();
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => child.once('close', () => resolve()));
      }
    }
  };
}
