import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDaemonConfig, writeStoredConfig } from '../src/config.js';

const ENV_KEYS = [
  'CLI2VOICE_DATA_DIR',
  'CLI2VOICE_KOKORO_MODEL',
  'CLI2VOICE_KOKORO_VOICE',
  'CLI2VOICE_KOKORO_DTYPE',
  'CLI2VOICE_KOKORO_DEVICE',
  'CLI2VOICE_KOKORO_SPEED',
  'CLI2VOICE_DICTATION_ENABLED',
  'CLI2VOICE_DICTATION_SHORTCUT',
  'CLI2VOICE_DICTATION_BACKEND',
  'CLI2VOICE_DICTATION_INSERT_MODE',
  'CLI2VOICE_DICTATION_STT_MODEL',
  'CLI2VOICE_DICTATION_LANGUAGE',
  'CLI2VOICE_DICTATION_DEVICE',
  'CLI2VOICE_DICTATION_DTYPE',
  'CLI2VOICE_DICTATION_PREWARM',
  'CLI2VOICE_DICTATION_PARTIAL_RESULTS',
  'CLI2VOICE_DICTATION_COMMAND_MODE_ENABLED',
  'CLI2VOICE_DICTATION_COMMAND_MODE_WAKE_PHRASE',
  'CLI2VOICE_DICTATION_MAX_RECORDING_MS'
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

    expect(config.kokoro).toMatchObject({
      model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      voice: 'af_heart',
      dtype: 'q8',
      device: 'cpu',
      speed: 1
    });
    expect(config.dictation).toMatchObject({
      enabled: false,
      shortcut: 'right_option',
      backend: 'auto',
      insertMode: 'type',
      sttModel: 'openai/whisper-large-v3-turbo',
      language: 'en',
      device: 'cpu',
      dtype: 'fp32',
      prewarm: true,
      partialResults: true,
      maxRecordingMs: 60000
    });
    expect(config.dictation.commandMode.enabled).toBe(true);
    expect(config.dictation.commandMode.wakePhrase).toBe('command');
    expect(config.dictation.commandMode.commands.send).toBe('submit');
  });

  it('respects stored Kokoro overrides', async () => {
    const dataDir = await createTempDataDir();
    const configPath = path.join(dataDir, 'config.json');

    await writeStoredConfig(
      {
        kokoro: {
          voice: 'af_bella',
          speed: 1.1
        }
      },
      configPath
    );

    const config = await readDaemonConfig();

    expect(config.kokoro.voice).toBe('af_bella');
    expect(config.kokoro.speed).toBe(1.1);
    expect(config.dictation.enabled).toBe(false);
  });

  it('respects stored dictation overrides', async () => {
    const dataDir = await createTempDataDir();
    const configPath = path.join(dataDir, 'config.json');

    await writeStoredConfig(
      {
        dictation: {
          enabled: true,
          shortcut: 'control_v',
          backend: 'daemon_whisper',
          sttModel: 'openai/whisper-large-v3',
          language: 'es',
          device: 'cpu',
          dtype: 'q8',
          prewarm: false,
          partialResults: false,
          dictionary: {
            codex: 'Codex'
          },
          snippets: {
            'slash model': '/model '
          },
          commandMode: {
            enabled: true,
            wakePhrase: 'computer',
            commands: {
              send: 'submit'
            }
          },
          maxRecordingMs: 15000
        }
      },
      configPath
    );

    const config = await readDaemonConfig();

    expect(config.dictation).toMatchObject({
      enabled: true,
      shortcut: 'control_v',
      backend: 'daemon_whisper',
      insertMode: 'type',
      sttModel: 'openai/whisper-large-v3',
      language: 'es',
      device: 'cpu',
      dtype: 'q8',
      prewarm: false,
      partialResults: false,
      maxRecordingMs: 15000
    });
    expect(config.dictation.dictionary.codex).toBe('Codex');
    expect(config.dictation.snippets['slash model']).toBe('/model ');
    expect(config.dictation.commandMode.wakePhrase).toBe('computer');
  });
});
