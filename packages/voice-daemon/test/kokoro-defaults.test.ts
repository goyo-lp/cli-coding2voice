import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedDaemonConfig } from '../src/config.js';
import { readDaemonConfig } from '../src/config.js';
import { Cli2VoiceRuntime } from '../src/runtime.js';
import { Cli2VoiceStore } from '../src/store.js';

const ENV_KEYS = [
  'CLI2VOICE_DATA_DIR',
  'CLI2VOICE_TTS_PROVIDER',
  'CLI2VOICE_KOKORO_MODEL',
  'CLI2VOICE_KOKORO_VOICE',
  'CLI2VOICE_KOKORO_DTYPE',
  'CLI2VOICE_KOKORO_DEVICE',
  'CLI2VOICE_KOKORO_SPEED'
] as const;

const envSnapshots: Array<Record<string, string | undefined>> = [];
const tempDirs: string[] = [];

function pushEnvSnapshot(): void {
  envSnapshots.push(Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])));
}

function restoreLatestEnvSnapshot(): void {
  const snapshot = envSnapshots.pop();
  if (!snapshot) return;
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createRuntimeConfig(tempDir: string): ResolvedDaemonConfig {
  return {
    host: '127.0.0.1',
    port: 4317,
    dataDir: tempDir,
    dbPath: path.join(tempDir, 'state.sqlite'),
    configPath: path.join(tempDir, 'config.json'),
    defaultMode: 'plan',
    summarizeCodeHeavy: true,
    duplicateWindowMs: 8000,
    playback: {
      backend: 'shell',
      conflictPolicy: 'stop-and-replace',
      rate: 1
    },
    tts: {
      provider: 'kokoro'
    },
    kokoro: {
      model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      voice: 'af_heart',
      dtype: 'q8',
      device: 'cpu',
      speed: 1
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy'
    },
    elevenlabs: {
      baseUrl: 'https://api.elevenlabs.io/v1',
      model: 'eleven_flash_v2_5',
      voice: 'EXAVITQu4vr4xnSDxMaL'
    }
  };
}

afterEach(async () => {
  restoreLatestEnvSnapshot();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('Kokoro daemon defaults', () => {
  it('defaults the daemon to local Kokoro with af_heart', async () => {
    pushEnvSnapshot();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    const tempDir = await createTempDir('cli2voice-config-');
    process.env.CLI2VOICE_DATA_DIR = tempDir;

    const config = await readDaemonConfig();
    expect(config.tts.provider).toBe('kokoro');
    expect(config.kokoro.model).toBe('onnx-community/Kokoro-82M-v1.0-ONNX');
    expect(config.kokoro.voice).toBe('af_heart');
    expect(config.kokoro.dtype).toBe('q8');
    expect(config.kokoro.device).toBe('cpu');
    expect(config.kokoro.speed).toBe(1);
  });

  it('reports Kokoro as the active provider in runtime status', async () => {
    const tempDir = await createTempDir('cli2voice-runtime-');
    const config = createRuntimeConfig(tempDir);
    const runtime = new Cli2VoiceRuntime(config, new Cli2VoiceStore(config.dbPath));
    await runtime.initialize();

    try {
      const status = runtime.getStatus() as {
        ttsProvider: string;
        config: {
          tts: {
            provider: string;
            kokoroVoice: string;
          };
        };
      };

      expect(status.ttsProvider).toBe('kokoro');
      expect(status.config.tts.provider).toBe('kokoro');
      expect(status.config.tts.kokoroVoice).toBe('af_heart');
    } finally {
      runtime.close();
    }
  });
});
