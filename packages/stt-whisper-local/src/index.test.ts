import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WhisperLocalTranscriber,
  decodeWavBuffer,
  loadWhisperPipelineWithCacheRecovery,
  resolveWhisperRuntimeModelId,
  isWhisperModelCacheCorruptionError,
  whisperJsRuntimeModelIds,
  whisperLocalDefaults
} from './index.js';
import type { WhisperAutomaticSpeechRecognitionPipeline, WhisperPipelineFactory } from './types.js';

const tempFiles: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempFiles.splice(0).map((filePath) => fs.rm(filePath, { force: true, recursive: true })));
});

describe('whisperLocalDefaults', () => {
  it('defaults to the turbo model for local dictation', () => {
    expect(whisperLocalDefaults.model).toBe('openai/whisper-large-v3-turbo');
    expect(whisperLocalDefaults.runtimeModel).toBe('onnx-community/whisper-large-v3-turbo');
    expect(whisperLocalDefaults.language).toBe('en');
    expect(whisperLocalDefaults.chunkLengthSeconds).toBe(20);
    expect(whisperLocalDefaults.strideLengthSeconds).toBe(4);
  });

  it('maps supported OpenAI model ids to Transformers.js-compatible runtime ids', () => {
    expect(whisperJsRuntimeModelIds['openai/whisper-large-v3']).toBe('onnx-community/whisper-large-v3-ONNX');
    expect(resolveWhisperRuntimeModelId('openai/whisper-large-v3-turbo')).toBe('onnx-community/whisper-large-v3-turbo');
    expect(resolveWhisperRuntimeModelId('onnx-community/custom-whisper')).toBe('onnx-community/custom-whisper');
  });
});

describe('runtime helpers', () => {
  it('detects recoverable Whisper cache corruption errors', () => {
    expect(
      isWhisperModelCacheCorruptionError(
        new Error(
          'Deserialize tensor onnx::MatMul_3966 failed.tensorprotoutils.cc:1080 GetExtDataFromTensorProto External initializer: onnx::MatMul_3966 offset: 947553280 size to read: 6214400 given file_length: 933124812 are out of bounds or can not be read in full.'
        )
      )
    ).toBe(true);
    expect(isWhisperModelCacheCorruptionError(new Error('network timeout'))).toBe(false);
  });

  it('clears a corrupted cached model directory and retries pipeline initialization once', async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stt-whisper-cache-'));
    tempFiles.push(cacheDir);
    const modelId = 'onnx-community/whisper-large-v3-turbo';
    const modelCachePath = path.join(cacheDir, 'onnx-community', 'whisper-large-v3-turbo');
    await fs.mkdir(modelCachePath, { recursive: true });
    await fs.writeFile(path.join(modelCachePath, 'encoder_model.onnx_data'), 'truncated');

    const recoveredPipeline = vi.fn<WhisperAutomaticSpeechRecognitionPipeline>(async () => ({ text: 'ok' }));
    const pipeline = vi
      .fn<WhisperPipelineFactory>()
      .mockRejectedValueOnce(
        new Error(
          'External initializer: encoder_model.onnx_data offset: 10 size to read: 12 given file_length: 8 are out of bounds or can not be read in full.'
        )
      )
      .mockResolvedValueOnce(recoveredPipeline);

    const loaded = await loadWhisperPipelineWithCacheRecovery(
      { env: { cacheDir }, pipeline },
      'automatic-speech-recognition',
      modelId,
      {}
    );

    expect(pipeline).toHaveBeenCalledTimes(2);
    expect(loaded).toBe(recoveredPipeline);
    await expect(fs.stat(modelCachePath)).rejects.toThrow();
  });
});

describe('decodeWavBuffer', () => {
  it('decodes 16-bit PCM wav data into mono Float32 samples', () => {
    const buffer = createWavBuffer({
      channels: 2,
      sampleRate: 16000,
      samples: [
        [0, 0],
        [32767, 0],
        [-32768, 32767]
      ]
    });

    const decoded = decodeWavBuffer(buffer);

    expect(decoded.channels).toBe(2);
    expect(decoded.sampleRate).toBe(16000);
    expect(decoded.samples.length).toBe(3);
    expect(decoded.samples[0]).toBe(0);
    expect(decoded.samples[1]).toBeCloseTo(0.49998474, 5);
    expect(decoded.samples[2]).toBeCloseTo(-0.00001526, 5);
  });
});

describe('WhisperLocalTranscriber', () => {
  it('uses the turbo runtime model and dictation defaults by default', async () => {
    const calls: Array<{ audio: Float32Array; options: Record<string, unknown> | undefined }> = [];
    const pipeline = vi.fn<WhisperAutomaticSpeechRecognitionPipeline>(async (audio, options) => {
      calls.push({ audio, options });
      return { text: '  dictated text  ' };
    });
    const pipelineFactory = vi.fn<WhisperPipelineFactory>(async () => pipeline);
    const filePath = await createTempWavFile({ sampleRate: 16000 });

    const transcriber = new WhisperLocalTranscriber({ pipelineFactory });
    const result = await transcriber.transcribeFile(filePath);

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(pipelineFactory).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'onnx-community/whisper-large-v3-turbo',
      {}
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.audio).toBeInstanceOf(Float32Array);
    expect(calls[0]?.options).toEqual({
      chunk_length_s: 20,
      language: 'en',
      return_timestamps: false,
      stride_length_s: 4,
      task: 'transcribe'
    });
    expect(result.text).toBe('dictated text');
    expect(result.model).toBe('openai/whisper-large-v3-turbo');
    expect(result.runtimeModel).toBe('onnx-community/whisper-large-v3-turbo');
  });

  it('maps the exact large-v3 model id when requested and reuses cached pipelines', async () => {
    const pipeline = vi.fn<WhisperAutomaticSpeechRecognitionPipeline>(async () => ({ text: 'hola' }));
    const pipelineFactory = vi.fn<WhisperPipelineFactory>(async () => pipeline);
    const firstFile = await createTempWavFile({ sampleRate: 16000 });
    const secondFile = await createTempWavFile({ sampleRate: 16000 });
    const transcriber = new WhisperLocalTranscriber({
      model: 'openai/whisper-large-v3',
      pipelineFactory,
      localFilesOnly: true
    });

    const first = await transcriber.transcribeFile(firstFile, { language: 'es' });
    const second = await transcriber.transcribeFile(secondFile, { language: 'es' });

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(pipelineFactory).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'onnx-community/whisper-large-v3-ONNX',
      { local_files_only: true }
    );
    expect(pipeline).toHaveBeenCalledTimes(2);
    expect(first.runtimeModel).toBe('onnx-community/whisper-large-v3-ONNX');
    expect(second.language).toBe('es');
  });

  it('can warm the configured pipeline without transcribing audio', async () => {
    const pipeline = vi.fn<WhisperAutomaticSpeechRecognitionPipeline>(async () => ({ text: 'unused' }));
    const pipelineFactory = vi.fn<WhisperPipelineFactory>(async () => pipeline);
    const transcriber = new WhisperLocalTranscriber({ pipelineFactory });

    const result = await transcriber.warm();

    expect(result).toEqual({
      model: 'openai/whisper-large-v3-turbo',
      runtimeModel: 'onnx-community/whisper-large-v3-turbo'
    });
    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('rejects wav files that are not recorded at the expected dictation sample rate', async () => {
    const pipelineFactory = vi.fn<WhisperPipelineFactory>();
    const filePath = await createTempWavFile({ sampleRate: 8000 });
    const transcriber = new WhisperLocalTranscriber({ pipelineFactory });

    await expect(transcriber.transcribeFile(filePath)).rejects.toThrow('expects 16000 Hz WAV audio');
    expect(pipelineFactory).not.toHaveBeenCalled();
  });

  it('retries pipeline initialization after an earlier initialization failure', async () => {
    const recoveredPipeline = vi.fn<WhisperAutomaticSpeechRecognitionPipeline>(async () => ({ text: 'retry worked' }));
    const pipelineFactory = vi
      .fn<WhisperPipelineFactory>()
      .mockRejectedValueOnce(new Error('bootstrap failed'))
      .mockResolvedValueOnce(recoveredPipeline);
    const firstFile = await createTempWavFile({ sampleRate: 16000 });
    const secondFile = await createTempWavFile({ sampleRate: 16000 });
    const transcriber = new WhisperLocalTranscriber({ pipelineFactory });

    await expect(transcriber.transcribeFile(firstFile)).rejects.toThrow('bootstrap failed');
    const second = await transcriber.transcribeFile(secondFile);

    expect(pipelineFactory).toHaveBeenCalledTimes(2);
    expect(second.text).toBe('retry worked');
  });
});

async function createTempWavFile(options: CreateWavOptions): Promise<string> {
  const filePath = path.join(os.tmpdir(), `stt-whisper-local-${Date.now()}-${Math.random()}.wav`);
  tempFiles.push(filePath);
  await fs.writeFile(filePath, createWavBuffer(options));
  return filePath;
}

type CreateWavOptions = {
  channels?: number;
  sampleRate: number;
  samples?: number[][] | number[];
};

function createWavBuffer(options: CreateWavOptions): Buffer {
  const channels = options.channels ?? 1;
  const frames = normalizeFrames(options.samples, channels);
  const sampleRate = options.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frames.length * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (const frame of frames) {
    for (const channelSample of frame) {
      buffer.writeInt16LE(clampSample(channelSample), offset);
      offset += 2;
    }
  }

  return buffer;
}

function normalizeFrames(samples: CreateWavOptions['samples'], channels: number): number[][] {
  if (!samples) {
    return [[0], [8192], [16384], [8192], [0]].map((frame) => (channels === 1 ? frame : new Array(channels).fill(frame[0])));
  }

  if (typeof samples[0] === 'number') {
    return (samples as number[]).map((sample) => new Array(channels).fill(sample));
  }

  return (samples as number[][]).map((frame) => {
    if (frame.length !== channels) {
      throw new Error(`Expected ${channels} samples per frame, received ${frame.length}.`);
    }

    return frame;
  });
}

function clampSample(sample: number): number {
  return Math.max(-32768, Math.min(32767, Math.trunc(sample)));
}
