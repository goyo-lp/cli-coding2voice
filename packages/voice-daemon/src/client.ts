import type {
  PublishActionsInput,
  RegisterSessionInput,
  SessionOverrideInput,
  SessionSelector,
  SpeakNowInput
} from '@cli2voice/voice-core';
import type { DictationTranscribeInput } from './dictation.js';

type RequestInitWithJson = {
  method?: string;
  body?: unknown;
};

export class Cli2VoiceDaemonClient {
  constructor(private readonly baseUrl = process.env.CLI2VOICE_BASE_URL ?? 'http://127.0.0.1:4317') {}

  async health() {
    return this.request('/health');
  }

  async status() {
    return this.request('/status');
  }

  async config() {
    return this.request('/config');
  }

  async listSessions() {
    return this.request('/sessions');
  }

  async getSession(sessionId: string) {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  async registerSession(input: RegisterSessionInput) {
    return this.request('/sessions/register', { method: 'POST', body: input });
  }

  async publishActions(selector: SessionSelector, input: PublishActionsInput) {
    if (!selector.sessionId) {
      throw new Error('publishActions requires an explicit sessionId.');
    }
    return this.request(`/sessions/${encodeURIComponent(selector.sessionId)}/actions`, { method: 'POST', body: input });
  }

  async applySignal(input: SessionOverrideInput) {
    if (input.sessionId) {
      return this.request(`/sessions/${encodeURIComponent(input.sessionId)}/control`, { method: 'POST', body: { signal: input.signal } });
    }
    return this.request('/sessions/control', { method: 'POST', body: input });
  }

  async speak(input: SpeakNowInput) {
    return this.request('/speak', { method: 'POST', body: input });
  }

  async stopPlayback() {
    return this.request('/playback/stop', { method: 'POST', body: {} });
  }

  async transcribeDictation(input: DictationTranscribeInput) {
    return this.request('/dictation/transcribe', { method: 'POST', body: input });
  }

  private async request(pathname: string, init: RequestInitWithJson = {}) {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json'
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });

    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    if (!response.ok) {
      throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
    }
    return payload;
  }
}
