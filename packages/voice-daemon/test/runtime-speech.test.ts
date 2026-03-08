import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackBackend, TextToSpeechProvider } from '@cli2voice/voice-core';
import { splitSpeechTextForPlayback, Cli2VoiceRuntime } from '../src/runtime.js';
import type { ResolvedDaemonConfig } from '../src/config.js';
import { Cli2VoiceStore } from '../src/store.js';

async function createRuntimeTestHarness() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli2voice-runtime-test-'));
  const config: ResolvedDaemonConfig = {
    host: '127.0.0.1',
    port: 4317,
    dataDir: tempDir,
    dbPath: path.join(tempDir, 'state.sqlite'),
    configPath: path.join(tempDir, 'config.json'),
    defaultMode: 'always',
    summarizeCodeHeavy: true,
    duplicateWindowMs: 8000,
    playback: {
      backend: 'shell',
      conflictPolicy: 'stop-and-replace',
      rate: 1
    },
    kokoro: {
      model: 'test-model',
      voice: 'af_heart',
      dtype: 'q8',
      device: 'cpu',
      speed: 1
    },
    dictation: {
      enabled: false,
      shortcut: 'right_option',
      backend: 'daemon_whisper',
      insertMode: 'type',
      sttModel: 'openai/whisper-large-v3-turbo',
      language: 'en',
      device: 'cpu',
      dtype: 'fp32',
      prewarm: false,
      partialResults: true,
      maxRecordingMs: 60000,
      dictionary: {},
      snippets: {},
      commandMode: {
        enabled: true,
        wakePhrase: 'command',
        commands: {}
      }
    }
  };

  const store = new Cli2VoiceStore(config.dbPath);
  const runtime = new Cli2VoiceRuntime(config, store);

  return {
    runtime,
    store,
    tempDir
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
});

describe('splitSpeechTextForPlayback', () => {
  it('keeps short answers as a single chunk', () => {
    expect(splitSpeechTextForPlayback('Today is Sunday.')).toEqual(['Today is Sunday.']);
  });

  it('splits longer multi-sentence answers into speakable chunks', () => {
    expect(
      splitSpeechTextForPlayback(
        'No consensus answer exists. A practical one is that meaning comes from what you organize your finite time around. Find something worth caring about.'
      )
    ).toEqual([
      'No consensus answer exists.',
      'A practical one is that meaning comes from what you organize your finite time around. Find something worth caring about.'
    ]);
  });

  it('prefers streaming tts when both the provider and playback backend support it', async () => {
    const { runtime, tempDir } = await createRuntimeTestHarness();
    const streamSynthesize = vi.fn(async function* () {
      yield Buffer.from([1, 2, 3]);
      yield Buffer.from([4, 5, 6]);
    });
    const synthesize = vi.fn();
    const play = vi.fn();
    const playStream = vi.fn(async (chunks: AsyncIterable<Buffer>) => {
      const consumed: number[][] = [];
      for await (const chunk of chunks) {
        consumed.push(Array.from(chunk));
      }
      expect(consumed).toEqual([
        [1, 2, 3],
        [4, 5, 6]
      ]);
      return {
        id: 'playback-1',
        startedAt: new Date().toISOString(),
        done: Promise.resolve(),
        stop: async () => undefined
      };
    });

    (runtime as unknown as { ttsProvider: TextToSpeechProvider }).ttsProvider = {
      name: 'mock-tts',
      warm: vi.fn(async () => undefined),
      synthesize,
      streamSynthesize
    };
    (runtime as unknown as { playbackBackend: PlaybackBackend }).playbackBackend = {
      name: 'mock-playback',
      play,
      playStream
    };

    try {
      await runtime.initialize();
      await runtime.speakNow({ text: 'Say this sooner.' });

      expect(streamSynthesize).toHaveBeenCalledTimes(1);
      expect(synthesize).not.toHaveBeenCalled();
      expect(playStream).toHaveBeenCalledTimes(1);
      expect(play).not.toHaveBeenCalled();
    } finally {
      runtime.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
