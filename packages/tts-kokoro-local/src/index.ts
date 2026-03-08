import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import type { SynthesisRequest, SynthesisWarmRequest, TextToSpeechProvider } from '@cli2voice/voice-core';

export type KokoroQuantization = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
export type KokoroDevice = 'cpu' | 'wasm' | 'webgpu' | null;

export type KokoroLocalTextToSpeechProviderOptions = {
  model?: string;
  voice?: string;
  dtype?: KokoroQuantization;
  device?: KokoroDevice;
  speed?: number;
};

type KokoroModel = Awaited<ReturnType<typeof KokoroTTS.from_pretrained>>;
type KokoroGenerateOptions = Parameters<KokoroModel['generate']>[1];
type KokoroVoice = NonNullable<KokoroGenerateOptions>['voice'];

const DEFAULT_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE: KokoroVoice = 'af_heart';
const DEFAULT_DTYPE: KokoroQuantization = 'q8';
const DEFAULT_DEVICE: KokoroDevice = 'cpu';
const DEFAULT_SPEED = 1;

function splitTextForStreaming(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.length > 0 ? sentences : [normalized];
}

export class KokoroLocalTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'kokoro';
  private readonly models = new Map<string, Promise<KokoroModel>>();

  constructor(private readonly options: KokoroLocalTextToSpeechProviderOptions = {}) {}

  async synthesize(request: SynthesisRequest): Promise<Buffer> {
    const text = request.text.trim();
    if (!text) {
      throw new Error('Cannot synthesize empty text.');
    }

    const format = request.format ?? 'wav';
    if (format !== 'wav') {
      throw new Error('Kokoro local synthesis only supports WAV output.');
    }

    const modelId = request.model || this.options.model || DEFAULT_MODEL;
    const voice = (request.voice || this.options.voice || DEFAULT_VOICE) as KokoroVoice;
    const speed = this.options.speed ?? DEFAULT_SPEED;
    const tts = await this.loadModel(modelId);
    const audio = await tts.generate(text, { voice, speed });
    const wav = audio.toWav();
    return Buffer.from(wav);
  }

  async warm(request: SynthesisWarmRequest = {}): Promise<void> {
    const modelId = request.model || this.options.model || DEFAULT_MODEL;
    await this.loadModel(modelId);
  }

  async *streamSynthesize(request: SynthesisRequest): AsyncIterable<Buffer> {
    const text = request.text.trim();
    if (!text) {
      throw new Error('Cannot synthesize empty text.');
    }

    const format = request.format ?? 'wav';
    if (format !== 'wav') {
      throw new Error('Kokoro local synthesis only supports WAV output.');
    }

    const modelId = request.model || this.options.model || DEFAULT_MODEL;
    const voice = (request.voice || this.options.voice || DEFAULT_VOICE) as KokoroVoice;
    const speed = this.options.speed ?? DEFAULT_SPEED;
    const tts = await this.loadModel(modelId);
    const splitter = new TextSplitterStream();
    const segments = splitTextForStreaming(text);
    splitter.push(...segments);
    splitter.close();

    for await (const chunk of tts.stream(splitter, { voice, speed })) {
      yield Buffer.from(chunk.audio.toWav());
    }
  }

  private loadModel(modelId: string): Promise<KokoroModel> {
    const dtype = this.options.dtype ?? DEFAULT_DTYPE;
    const device = this.options.device ?? DEFAULT_DEVICE;
    const cacheKey = `${modelId}::${dtype}::${device}`;

    const existing = this.models.get(cacheKey);
    if (existing) {
      return existing;
    }

    const pending = KokoroTTS.from_pretrained(modelId, {
      dtype,
      device
    }).catch((error) => {
      this.models.delete(cacheKey);
      throw error;
    });
    this.models.set(cacheKey, pending);
    return pending;
  }
}

export const kokoroDefaults = {
  model: DEFAULT_MODEL,
  voice: DEFAULT_VOICE,
  dtype: DEFAULT_DTYPE,
  device: DEFAULT_DEVICE,
  speed: DEFAULT_SPEED
} as const;
