import { afterEach, describe, expect, it, vi } from 'vitest';
import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import { KokoroLocalTextToSpeechProvider, kokoroDefaults } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KokoroLocalTextToSpeechProvider', () => {
  it('exports af_heart as the default voice', () => {
    expect(kokoroDefaults.voice).toBe('af_heart');
  });

  it('rejects non-wav output', async () => {
    const loader = vi.spyOn(KokoroTTS, 'from_pretrained');
    const provider = new KokoroLocalTextToSpeechProvider();

    await expect(
      provider.synthesize({
        text: 'hello',
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: 'af_heart',
        format: 'mp3'
      })
    ).rejects.toThrow('only supports WAV output');

    expect(loader).not.toHaveBeenCalled();
  });

  it('loads a model once per cache key and uses af_heart when voice is empty', async () => {
    const generate = vi.fn().mockResolvedValue({
      toWav: () => new Uint8Array([1, 2, 3, 4])
    });
    const loader = vi.spyOn(KokoroTTS, 'from_pretrained').mockResolvedValue({
      generate
    } as never);
    const provider = new KokoroLocalTextToSpeechProvider({ dtype: 'q8', device: 'cpu' });

    const first = await provider.synthesize({
      text: 'first',
      model: 'test-model',
      voice: '',
      format: 'wav'
    });
    const second = await provider.synthesize({
      text: 'second',
      model: 'test-model',
      voice: '',
      format: 'wav'
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenNthCalledWith(1, 'first', { voice: 'af_heart', speed: 1 });
    expect(generate).toHaveBeenNthCalledWith(2, 'second', { voice: 'af_heart', speed: 1 });
    expect(first.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
    expect(second.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
  });

  it('warms the cached model without generating audio', async () => {
    const generate = vi.fn().mockResolvedValue({
      toWav: () => new Uint8Array([1, 2, 3, 4])
    });
    const loader = vi.spyOn(KokoroTTS, 'from_pretrained').mockResolvedValue({
      generate
    } as never);
    const provider = new KokoroLocalTextToSpeechProvider({ dtype: 'q8', device: 'cpu' });

    await provider.warm?.({
      model: 'test-model',
      voice: 'af_heart',
      format: 'wav'
    });
    await provider.synthesize({
      text: 'hello',
      model: 'test-model',
      voice: 'af_heart',
      format: 'wav'
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('streams wav chunks from the kokoro stream api', async () => {
    const stream = vi.fn(async function* () {
      yield {
        audio: {
          toWav: () => new Uint8Array([1, 2])
        }
      };
      yield {
        audio: {
          toWav: () => new Uint8Array([3, 4, 5])
        }
      };
    });
    const loader = vi.spyOn(KokoroTTS, 'from_pretrained').mockResolvedValue({
      generate: vi.fn(),
      stream
    } as never);
    const provider = new KokoroLocalTextToSpeechProvider({ dtype: 'q8', device: 'cpu' });

    const chunks: Buffer[] = [];
    for await (const chunk of provider.streamSynthesize?.({
      text: 'hello world',
      model: 'test-model',
      voice: 'af_heart',
      format: 'wav'
    }) ?? []) {
      chunks.push(chunk);
    }

    expect(loader).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    const calls = (stream as unknown as { mock: { calls: Array<[unknown, unknown]> } }).mock.calls;
    const firstCall = calls.at(0);
    expect(firstCall).toBeDefined();
    const firstArg = firstCall?.[0];
    const options = firstCall?.[1];
    expect(firstArg).toBeInstanceOf(TextSplitterStream);
    expect(options).toEqual({ voice: 'af_heart', speed: 1 });
    expect(chunks.map((chunk) => Array.from(chunk))).toEqual([[1, 2], [3, 4, 5]]);
  });
});
