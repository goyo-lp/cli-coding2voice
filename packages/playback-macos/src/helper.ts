import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { ActivePlayback, PlaybackRequest } from '@cli2voice/voice-core';

const execFileAsync = promisify(execFile);

function getPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..');
}

function getMacosPlaybackHelperSourcePath(): string {
  return path.join(getPackageRoot(), 'native', 'macos-playback-helper', 'main.swift');
}

function getMacosPlaybackHelperBinaryPath(): string {
  return path.join(os.homedir(), '.cli2voice', 'bin', 'cli2voice-playback-helper');
}

async function hasSwiftCompiler(): Promise<boolean> {
  try {
    await execFileAsync('xcrun', ['--find', 'swiftc']);
    return true;
  } catch {
    return false;
  }
}

export async function ensureMacosPlaybackHelperBuilt(force = false): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new Error('The macOS playback helper is only supported on macOS.');
  }

  const sourcePath = getMacosPlaybackHelperSourcePath();
  const binaryPath = getMacosPlaybackHelperBinaryPath();
  if (!(await hasSwiftCompiler())) {
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
    '-o',
    binaryPath
  ]);

  return binaryPath;
}

function clampPlaybackRate(rate: number | undefined): number {
  if (!Number.isFinite(rate)) {
    return 1;
  }
  return Math.max(0.5, Math.min(2.5, rate ?? 1));
}

function createExitPromise(child: ReturnType<typeof spawn>, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', (error) => {
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM') {
        resolve();
        return;
      }

      reject(new Error(`${label} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`));
    });
  });
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(chunk.length, 0);

  await writeBuffer(stream, header);
  if (chunk.length > 0) {
    await writeBuffer(stream, chunk);
  }
}

async function writeBuffer(stream: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  if (stream.write(chunk)) {
    return;
  }
  await once(stream, 'drain');
}

export async function startMacosStreamingPlayback(
  chunks: AsyncIterable<Buffer>,
  request?: PlaybackRequest
): Promise<ActivePlayback> {
  const helperPath = await ensureMacosPlaybackHelperBuilt();
  const child = spawn(helperPath, ['stream', '--rate', clampPlaybackRate(request?.rate).toFixed(2)], {
    stdio: ['pipe', 'ignore', 'pipe']
  });

  const spawned = once(child, 'spawn').then(() => undefined);
  const errored = once(child, 'error').then(([error]) => {
    throw error;
  });

  try {
    await Promise.race([spawned, errored]);
  } catch (error) {
    throw new Error(`macOS playback helper failed to start: ${error instanceof Error ? error.message : String(error)}`);
  }

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (text.trim()) {
      process.stderr.write(`cli2voice playback helper: ${text}`);
    }
  });

  const exitPromise = createExitPromise(child, 'macOS playback helper');
  const pump = (async () => {
    try {
      for await (const chunk of chunks) {
        if (!Buffer.isBuffer(chunk)) {
          continue;
        }
        if (child.stdin.destroyed) {
          break;
        }
        await writeChunk(child.stdin, chunk);
      }
      if (!child.stdin.destroyed) {
        await writeChunk(child.stdin, Buffer.alloc(0));
        child.stdin.end();
      }
    } catch (error) {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
      }
      throw error;
    }
  })();

  const done = Promise.all([exitPromise, pump]).then(() => undefined);

  return {
    id: `macos-stream-${child.pid ?? Date.now()}`,
    pid: typeof child.pid === 'number' && child.pid > 0 ? child.pid : undefined,
    startedAt: new Date().toISOString(),
    done,
    stop: async () => {
      child.stdin.destroy();
      if (typeof child.pid === 'number' && child.pid > 0 && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore process state races
        }
      }
      await exitPromise.catch(() => undefined);
    }
  };
}
