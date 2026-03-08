import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { ActivePlayback, AudioFormat, PlaybackBackend, PlaybackRequest } from '@cli2voice/voice-core';
import { startMacosStreamingPlayback } from './helper.js';

async function createPlaybackFile(buffer: Buffer, format: AudioFormat = 'mp3'): Promise<string> {
  const tempDir = path.join(os.tmpdir(), 'cli2voice-audio');
  await fs.mkdir(tempDir, { recursive: true });
  const filePath = path.join(tempDir, `${randomUUID()}.${format}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export class MacOsPlaybackBackend implements PlaybackBackend {
  readonly name = 'macos';

  async play(buffer: Buffer, request?: PlaybackRequest): Promise<ActivePlayback> {
    if (process.platform !== 'darwin') {
      throw new Error('The macOS playback backend only runs on macOS.');
    }

    const filePath = await createPlaybackFile(buffer, request?.format ?? 'mp3');
    const rate = Math.max(0.5, Math.min(2.5, request?.rate ?? 1));
    const child = spawn('afplay', ['-r', rate.toFixed(2), filePath], {
      stdio: 'ignore',
      detached: true
    });

    const spawned = once(child, 'spawn').then(() => undefined);
    const errored = once(child, 'error').then(([error]) => {
      throw error;
    });

    try {
      await Promise.race([spawned, errored]);
    } catch (error) {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      throw new Error(`afplay failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }

    const cleanup = async (): Promise<void> => {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
    };
    child.once('exit', () => {
      void cleanup();
    });
    child.once('error', () => {
      void cleanup();
    });

    const done = once(child, 'exit').then(() => undefined).catch(() => undefined);

    return {
      id: randomUUID(),
      pid: typeof child.pid === 'number' && child.pid > 0 ? child.pid : undefined,
      filePath,
      startedAt: new Date().toISOString(),
      done,
      stop: async () => {
        if (typeof child.pid === 'number' && child.pid > 0 && !child.killed) {
          try {
            child.kill('SIGTERM');
          } catch {
            // ignore process state races
          }
        }
        await cleanup();
      }
    };
  }

  async playStream(chunks: AsyncIterable<Buffer>, request?: PlaybackRequest): Promise<ActivePlayback> {
    return startMacosStreamingPlayback(chunks, request);
  }
}
