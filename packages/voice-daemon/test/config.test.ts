import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDaemonConfig, writeStoredConfig } from '../src/config.js';

const ENV_KEYS = [
  'CLI2VOICE_DATA_DIR',
  'CLI2VOICE_TTS_PROVIDER',
  'CLI2VOICE_KOKORO_MODEL',
  'CLI2VOICE_KOKORO_VOICE',
  'CLI2VOICE_KOKORO_DTYPE',
  'CLI2VOICE_KOKORO_DEVICE',
  'CLI2VOICE_KOKORO_SPEED'
] as const;

const envSnapshot = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
const tempDirs = new Set<string>();

async function createTempDataDir(): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli2voice-config-'));
  tempDirs.add(dataDir);
  process.env.CLI2VOICE_DATA_DIR = dataDir;
  return dataDir;
}

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  await Promise.all(Array.from(tempDirs, (dataDir) => fs.rm(dataDir, { recursive: true, force: true })));
  tempDirs.clear();
});

describe('readDaemonConfig', () => {
  it('defaults to Kokoro with af_heart on CPU', async () => {
    await createTempDataDir();

    const config = await readDaemonConfig();

    expect(config.tts.provider).toBe('kokoro');
    expect(config.kokoro).toMatchObject({
      model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      voice: 'af_heart',
      dtype: 'q8',
      device: 'cpu',
      speed: 1
    });
  });

  it('respects stored Kokoro overrides', async () => {
    const dataDir = await createTempDataDir();
    const configPath = path.join(dataDir, 'config.json');

    await writeStoredConfig(
      {
        tts: { provider: 'kokoro' },
        kokoro: {
          voice: 'af_bella',
          speed: 1.1
        }
      },
      configPath
    );

    const config = await readDaemonConfig();

    expect(config.tts.provider).toBe('kokoro');
    expect(config.kokoro.voice).toBe('af_bella');
    expect(config.kokoro.speed).toBe(1.1);
  });
});
