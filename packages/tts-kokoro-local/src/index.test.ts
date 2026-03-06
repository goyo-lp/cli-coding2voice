import { afterEach, describe, expect, it, vi } from 'vitest';
import { KokoroTTS } from 'kokoro-js';
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
});
