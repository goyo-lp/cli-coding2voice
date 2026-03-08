import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedDaemonConfig } from '../src/config.js';
import type { DictationTranscriber } from '../src/dictation.js';
import { Cli2VoiceRuntime } from '../src/runtime.js';
import { Cli2VoiceStore } from '../src/store.js';

const tempDirs: string[] = [];

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
    kokoro: {
      model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      voice: 'af_heart',
      dtype: 'q8',
      device: 'cpu',
      speed: 1
    },
    dictation: {
      enabled: true,
      shortcut: 'right_option',
      backend: 'auto',
      insertMode: 'type',
      sttModel: 'openai/whisper-large-v3-turbo',
      language: 'en',
      device: 'cpu',
      dtype: 'fp32',
      prewarm: true,
      partialResults: true,
      dictionary: {},
      snippets: {},
      commandMode: {
        enabled: true,
        wakePhrase: 'command',
        commands: {
          send: 'submit',
          submit: 'submit',
          backspace: 'backspace',
          'clear line': 'clear_line',
          escape: 'escape',
          tab: 'tab'
        }
      },
      maxRecordingMs: 60000
    }
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('Cli2VoiceRuntime dictation', () => {
  it('prewarms dictation when enabled', async () => {
    const tempDir = await createTempDir('cli2voice-runtime-dictation-');
    const config = createRuntimeConfig(tempDir);
    const warm = vi.fn<DictationTranscriber['warm']>(async () => ({
      model: 'openai/whisper-large-v3-turbo',
      runtimeModel: 'onnx-community/whisper-large-v3-turbo'
    }));
    const transcribeFile = vi.fn<DictationTranscriber['transcribeFile']>(async () => ({
      text: 'unused',
      model: 'openai/whisper-large-v3-turbo',
      runtimeModel: 'onnx-community/whisper-large-v3-turbo',
      language: 'en',
      durationSeconds: 1,
      sampleRate: 16000
    }));
    const runtime = new Cli2VoiceRuntime(config, new Cli2VoiceStore(config.dbPath), {
      createDictationTranscriber: () => ({ warm, transcribeFile })
    });

    await runtime.initialize();

    try {
      const status = runtime.getStatus() as { dictationRuntime: { state: string } };
      expect(warm).toHaveBeenCalledTimes(1);
      expect(status.dictationRuntime.state).toBe('warm');
    } finally {
      runtime.close();
    }
  });

  it('routes dictation transcription through the daemon-owned transcriber', async () => {
    const tempDir = await createTempDir('cli2voice-runtime-dictation-');
    const config = createRuntimeConfig(tempDir);
    const warm = vi.fn<DictationTranscriber['warm']>(async () => ({
      model: 'openai/whisper-large-v3-turbo',
      runtimeModel: 'onnx-community/whisper-large-v3-turbo'
    }));
    const transcribeFile = vi.fn<DictationTranscriber['transcribeFile']>(async () => ({
      text: 'what day is it today?',
      model: 'openai/whisper-large-v3-turbo',
      runtimeModel: 'onnx-community/whisper-large-v3-turbo',
      language: 'en',
      durationSeconds: 1,
      sampleRate: 16000
    }));
    const runtime = new Cli2VoiceRuntime(config, new Cli2VoiceStore(config.dbPath), {
      createDictationTranscriber: () => ({ warm, transcribeFile })
    });
    await runtime.initialize();

    try {
      const result = await runtime.transcribeDictation({ audioPath: '/tmp/sample.wav' });
      const status = runtime.getStatus() as { dictationRuntime: { state: string } };

      expect(transcribeFile).toHaveBeenCalledWith('/tmp/sample.wav', {
        language: 'en',
        model: 'openai/whisper-large-v3-turbo'
      });
      expect(result.text).toBe('what day is it today?');
      expect(status.dictationRuntime.state).toBe('warm');
    } finally {
      runtime.close();
    }
  });
});
