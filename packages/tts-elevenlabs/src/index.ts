import type { SynthesisRequest, TextToSpeechProvider } from '@cli2voice/voice-core';

export type ElevenLabsTextToSpeechProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
};

export class ElevenLabsTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'elevenlabs';

  constructor(private readonly options: ElevenLabsTextToSpeechProviderOptions = {}) {}

  async synthesize(request: SynthesisRequest): Promise<Buffer> {
    const apiKey = this.options.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('Missing ElevenLabs API key. Set ELEVENLABS_API_KEY or configure cli2voice with an explicit key.');
    }

    const text = request.text.trim();
    if (!text) {
      throw new Error('Cannot synthesize empty text.');
    }

    const response = await fetch(
      `${this.options.baseUrl ?? 'https://api.elevenlabs.io/v1'}/text-to-speech/${encodeURIComponent(request.voice)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: request.model,
          output_format: request.format === 'wav' ? 'pcm_44100' : 'mp3_44100_128',
          voice_settings: {
            stability: this.options.stability ?? 0.4,
            similarity_boost: this.options.similarityBoost ?? 0.7,
            style: this.options.style ?? 0.2,
            use_speaker_boost: this.options.useSpeakerBoost ?? true
          }
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ElevenLabs TTS request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
