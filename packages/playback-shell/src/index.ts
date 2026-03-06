import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { ActivePlayback, AudioFormat, PlaybackBackend, PlaybackRequest } from '@cli2voice/voice-core';

type PlayerCommand = {
  command: string;
  buildArgs: (filePath: string, request?: PlaybackRequest) => string[];
};

const CANDIDATES: PlayerCommand[] = [
  {
    command: 'ffplay',
    buildArgs: (filePath, request) => {
      const rate = request?.rate;
      const args = ['-nodisp', '-autoexit', '-loglevel', 'quiet'];
      if (rate && Number.isFinite(rate) && rate > 0) {
        args.push('-af', `atempo=${Math.max(0.5, Math.min(2, rate)).toFixed(2)}`);
      }
      args.push(filePath);
      return args;
    }
  },
  {
    command: 'mpv',
    buildArgs: (filePath, request) => {
      const args = ['--no-video', '--really-quiet'];
      if (request?.rate && Number.isFinite(request.rate) && request.rate > 0) {
        args.push(`--speed=${Math.max(0.5, Math.min(3, request.rate)).toFixed(2)}`);
      }
      args.push(filePath);
      return args;
    }
  },
  {
    command: 'play',
    buildArgs: (filePath) => [filePath]
  },
  {
    command: 'paplay',
    buildArgs: (filePath) => [filePath]
  },
  {
    command: 'aplay',
    buildArgs: (filePath) => [filePath]
  }
];

async function commandExists(command: string): Promise<boolean> {
  const parts = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of parts) {
    const fullPath = path.join(dir, command);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

async function resolvePlayer(): Promise<PlayerCommand> {
  for (const candidate of CANDIDATES) {
    if (await commandExists(candidate.command)) {
      return candidate;
    }
  }

  throw new Error('No shell playback command found. Install ffplay, mpv, sox (`play`), paplay, or aplay.');
}

async function createPlaybackFile(buffer: Buffer, format: AudioFormat = 'mp3'): Promise<string> {
  const tempDir = path.join(os.tmpdir(), 'cli2voice-audio');
  await fs.mkdir(tempDir, { recursive: true });
  const filePath = path.join(tempDir, `${randomUUID()}.${format}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function spawnPlayback(command: string, args: string[], filePath: string): Promise<ActivePlayback> {
  const child = spawn(command, args, {
    stdio: 'ignore',
    detached: true
  });

  let settled = false;
  const cleanup = async (): Promise<void> => {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
  };

  const spawned = once(child, 'spawn').then(() => {
    settled = true;
  });
  const errored = once(child, 'error').then(([error]) => {
    throw error;
  });

  try {
    await Promise.race([spawned, errored]);
  } catch (error) {
    await cleanup();
    throw new Error(`Playback process failed to start: ${error instanceof Error ? error.message : String(error)}`);
  }

  child.once('exit', () => {
    void cleanup();
  });
  child.once('error', () => {
    if (settled) {
      void cleanup();
    }
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

export class ShellPlaybackBackend implements PlaybackBackend {
  readonly name = 'shell';

  async play(buffer: Buffer, request?: PlaybackRequest): Promise<ActivePlayback> {
    const player = await resolvePlayer();
    const filePath = await createPlaybackFile(buffer, request?.format ?? 'mp3');
    return spawnPlayback(player.command, player.buildArgs(filePath, request), filePath);
  }
}
