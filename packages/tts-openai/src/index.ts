import type { SynthesisRequest, TextToSpeechProvider } from '@cli2voice/voice-core';

export type OpenAiTextToSpeechProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
};

export class OpenAiTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'openai';

  constructor(private readonly options: OpenAiTextToSpeechProviderOptions = {}) {}

  async synthesize(request: SynthesisRequest): Promise<Buffer> {
    const apiKey = this.options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OpenAI API key. Set OPENAI_API_KEY or configure cli2voice with an explicit key.');
    }

    const input = request.text.trim();
    if (!input) {
      throw new Error('Cannot synthesize empty text.');
    }

    const response = await fetch(`${this.options.baseUrl ?? 'https://api.openai.com/v1'}/audio/speech`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        voice: request.voice,
        input,
        instructions: request.instructions,
        response_format: request.format ?? 'mp3'
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI TTS request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
