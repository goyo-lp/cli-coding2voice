import {
  createSessionVoiceState,
  normalizeSpeechKey,
  reduceSessionVoiceState,
  toSpeechDecision,
  type ActionPublicationResult,
  type ActivePlayback,
  type AudioFormat,
  type PublishActionsInput,
  type RegisterSessionInput,
  type SessionOverrideInput,
  type SessionRecord,
  type SessionSelector,
  type SpeakNowInput,
  type TextToSpeechProvider,
  type PlaybackBackend
} from '@cli2voice/voice-core';
import { MacOsPlaybackBackend } from '@cli2voice/playback-macos';
import { ShellPlaybackBackend } from '@cli2voice/playback-shell';
import { ElevenLabsTextToSpeechProvider } from '@cli2voice/tts-elevenlabs';
import { KokoroLocalTextToSpeechProvider } from '@cli2voice/tts-kokoro-local';
import { OpenAiTextToSpeechProvider } from '@cli2voice/tts-openai';
import type { ResolvedDaemonConfig } from './config.js';
import { Cli2VoiceStore } from './store.js';

export class Cli2VoiceRuntime {
  private readonly recentMessages = new Map<string, Map<string, number>>();
  private readonly playbackBackend: PlaybackBackend;
  private readonly ttsProvider: TextToSpeechProvider;
  private currentPlayback: ActivePlayback | null = null;
  private speechQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: ResolvedDaemonConfig,
    private readonly store: Cli2VoiceStore
  ) {
    this.playbackBackend = this.createPlaybackBackend();
    this.ttsProvider = this.createTtsProvider();
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  registerSession(input: RegisterSessionInput): SessionRecord {
    return this.store.upsertSession({
      sessionId: input.sessionId,
      provider: input.provider,
      workspacePath: input.workspacePath,
      defaultMode: input.defaultMode ?? this.config.defaultMode,
      metadata: input.metadata ?? {}
    });
  }

  listSessions() {
    return this.store.listSessions();
  }

  getSession(sessionId: string) {
    return this.store.getSession(sessionId);
  }

  getStatus(): Record<string, unknown> {
    return {
      ok: true,
      host: this.config.host,
      port: this.config.port,
      playbackBackend: this.playbackBackend.name,
      ttsProvider: this.ttsProvider.name,
      currentPlayback: this.currentPlayback
        ? {
            id: this.currentPlayback.id,
            pid: this.currentPlayback.pid ?? null,
            filePath: this.currentPlayback.filePath ?? null,
            startedAt: this.currentPlayback.startedAt
          }
        : null,
      config: {
        defaultMode: this.config.defaultMode,
        summarizeCodeHeavy: this.config.summarizeCodeHeavy,
        duplicateWindowMs: this.config.duplicateWindowMs,
        playback: this.config.playback,
        tts: {
          provider: this.config.tts.provider,
          kokoroModel: this.config.kokoro.model,
          kokoroVoice: this.config.kokoro.voice,
          kokoroDType: this.config.kokoro.dtype,
          kokoroDevice: this.config.kokoro.device,
          kokoroSpeed: this.config.kokoro.speed,
          openaiModel: this.config.openai.model,
          openaiVoice: this.config.openai.voice,
          elevenlabsModel: this.config.elevenlabs.model,
          elevenlabsVoice: this.config.elevenlabs.voice,
          hasOpenAiKey: Boolean(this.config.openai.apiKey),
          hasElevenLabsKey: Boolean(this.config.elevenlabs.apiKey)
        }
      }
    };
  }

  applySignal(input: SessionOverrideInput): SessionRecord {
    const session = this.resolveSessionOrThrow(input);
    const nextState = reduceSessionVoiceState(
      {
        defaultMode: session.defaultMode,
        planMode: session.planMode,
        manualVoiceOverride: session.manualVoiceOverride
      },
      input.signal
    );
    this.store.appendAction(session.sessionId, { kind: 'control', signal: input.signal, source: 'daemon.api' });
    return this.store.updateSessionState(session.sessionId, nextState);
  }

  async publishActions(selector: SessionSelector, input: PublishActionsInput): Promise<ActionPublicationResult> {
    const session = this.resolveSessionOrThrow(selector);
    let state = createSessionVoiceState(session.defaultMode);
    state.planMode = session.planMode;
    state.manualVoiceOverride = session.manualVoiceOverride;

    const decisions: ActionPublicationResult['decisions'] = [];
    let spoken = 0;

    for (const action of input.actions) {
      this.store.appendAction(session.sessionId, action);

      if (action.kind === 'control') {
        state = reduceSessionVoiceState(state, action.signal);
        continue;
      }

      if (!action.message.trim()) {
        decisions.push({ message: action.message, reason: 'empty', spoken: false, source: action.source });
        continue;
      }

      const contentDecision = toSpeechDecision(action.message, this.config.summarizeCodeHeavy);
      if (!this.isVoiceEnabled(state)) {
        this.store.recordUtterance({
          sessionId: session.sessionId,
          source: action.source,
          inputText: action.message,
          spokenText: contentDecision.textForSpeech,
          decisionReason: 'voice-disabled',
          spoken: false
        });
        decisions.push({ message: action.message, reason: 'voice-disabled', spoken: false, source: action.source });
        continue;
      }

      if (!contentDecision.shouldSpeak) {
        this.store.recordUtterance({
          sessionId: session.sessionId,
          source: action.source,
          inputText: action.message,
          spokenText: '',
          decisionReason: contentDecision.reason,
          spoken: false
        });
        decisions.push({ message: action.message, reason: contentDecision.reason, spoken: false, source: action.source });
        continue;
      }

      if (this.isDuplicate(session.sessionId, action.dedupeKey ?? action.message)) {
        this.store.recordUtterance({
          sessionId: session.sessionId,
          source: action.source,
          inputText: action.message,
          spokenText: contentDecision.textForSpeech,
          decisionReason: 'duplicate',
          spoken: false
        });
        decisions.push({ message: action.message, reason: 'duplicate', spoken: false, source: action.source });
        continue;
      }

      await this.enqueueSpeech({
        sessionId: session.sessionId,
        source: action.source,
        inputText: action.message,
        speechText: contentDecision.textForSpeech
      });
      spoken += 1;
      decisions.push({ message: action.message, reason: contentDecision.reason, spoken: true, source: action.source });
    }

    const updated = this.store.updateSessionState(session.sessionId, state);
    return { session: updated, spoken, decisions };
  }

  async speakNow(input: SpeakNowInput): Promise<{ spoken: boolean; reason: string }> {
    const decision = toSpeechDecision(input.text, this.config.summarizeCodeHeavy);
    if (!decision.shouldSpeak) {
      this.store.recordUtterance({
        sessionId: input.sessionId ?? null,
        source: input.source ?? 'daemon.api',
        inputText: input.text,
        spokenText: '',
        decisionReason: decision.reason,
        spoken: false
      });
      return { spoken: false, reason: decision.reason };
    }

    await this.enqueueSpeech({
      sessionId: input.sessionId,
      source: input.source ?? 'daemon.api',
      inputText: input.text,
      speechText: decision.textForSpeech,
      force: input.force ?? true
    });
    return { spoken: true, reason: decision.reason };
  }

  async stopPlayback(): Promise<boolean> {
    if (!this.currentPlayback) {
      return false;
    }
    await this.currentPlayback.stop();
    this.currentPlayback = null;
    return true;
  }

  close(): void {
    this.store.close();
  }

  private createPlaybackBackend(): PlaybackBackend {
    const kind = this.config.playback.backend === 'auto'
      ? process.platform === 'darwin'
        ? 'macos'
        : 'shell'
      : this.config.playback.backend;

    return kind === 'macos' ? new MacOsPlaybackBackend() : new ShellPlaybackBackend();
  }

  private createTtsProvider(): TextToSpeechProvider {
    if (this.config.tts.provider === 'kokoro') {
      return new KokoroLocalTextToSpeechProvider({
        model: this.config.kokoro.model,
        voice: this.config.kokoro.voice,
        dtype: this.config.kokoro.dtype,
        device: this.config.kokoro.device,
        speed: this.config.kokoro.speed
      });
    }

    if (this.config.tts.provider === 'elevenlabs') {
      return new ElevenLabsTextToSpeechProvider({
        apiKey: this.config.elevenlabs.apiKey,
        baseUrl: this.config.elevenlabs.baseUrl
      });
    }

    return new OpenAiTextToSpeechProvider({
      apiKey: this.config.openai.apiKey,
      baseUrl: this.config.openai.baseUrl
    });
  }

  private resolveSessionOrThrow(selector: SessionSelector): SessionRecord {
    const session = this.store.resolveSession(selector);
    if (!session) {
      const details = selector.sessionId
        ? `sessionId=${selector.sessionId}`
        : `provider=${selector.provider ?? '*'} workspace=${selector.workspacePath ?? '*'}`;
      throw new Error(`No matching session found (${details}).`);
    }
    return session;
  }

  private isVoiceEnabled(state: { defaultMode: SessionRecord['defaultMode']; planMode: boolean; manualVoiceOverride: SessionRecord['manualVoiceOverride'] }): boolean {
    if (state.manualVoiceOverride === 'on') return true;
    if (state.manualVoiceOverride === 'off') return false;
    if (state.defaultMode === 'always') return true;
    if (state.defaultMode === 'off') return false;
    return state.planMode;
  }

  private isDuplicate(sessionId: string, message: string): boolean {
    const now = Date.now();
    const key = normalizeSpeechKey(message);
    const seen = this.recentMessages.get(sessionId) ?? new Map<string, number>();

    for (const [entry, timestamp] of seen.entries()) {
      if (now - timestamp > this.config.duplicateWindowMs) {
        seen.delete(entry);
      }
    }

    const previous = seen.get(key);
    seen.set(key, now);
    this.recentMessages.set(sessionId, seen);
    return typeof previous === 'number' && now - previous <= this.config.duplicateWindowMs;
  }

  private getCurrentVoice(): string {
    switch (this.config.tts.provider) {
      case 'kokoro':
        return this.config.kokoro.voice;
      case 'elevenlabs':
        return this.config.elevenlabs.voice;
      case 'openai':
      default:
        return this.config.openai.voice;
    }
  }

  private getCurrentModel(): string {
    switch (this.config.tts.provider) {
      case 'kokoro':
        return this.config.kokoro.model;
      case 'elevenlabs':
        return this.config.elevenlabs.model;
      case 'openai':
      default:
        return this.config.openai.model;
    }
  }

  private getCurrentAudioFormat(): AudioFormat {
    return this.config.tts.provider === 'kokoro' ? 'wav' : 'mp3';
  }

  private async enqueueSpeech(input: {
    sessionId?: string;
    source: string;
    inputText: string;
    speechText: string;
    force?: boolean;
  }): Promise<void> {
    this.speechQueue = this.speechQueue.then(async () => {
      if (this.currentPlayback && this.config.playback.conflictPolicy === 'ignore') {
        this.store.recordUtterance({
          sessionId: input.sessionId ?? null,
          source: input.source,
          inputText: input.inputText,
          spokenText: input.speechText,
          decisionReason: 'playback-busy',
          spoken: false
        });
        return;
      }

      if (this.currentPlayback && this.config.playback.conflictPolicy === 'stop-and-replace') {
        await this.currentPlayback.stop();
        this.currentPlayback = null;
      }

      const audio = await this.ttsProvider.synthesize({
        text: input.speechText,
        model: this.getCurrentModel(),
        voice: this.getCurrentVoice(),
        format: this.getCurrentAudioFormat(),
        instructions: this.config.tts.provider === 'openai' ? this.config.openai.instructions : undefined
      });

      const playback = await this.playbackBackend.play(audio, {
        rate: this.config.playback.rate,
        format: this.getCurrentAudioFormat()
      });
      this.currentPlayback = playback;
      playback.done?.finally(() => {
        if (this.currentPlayback?.id === playback.id) {
          this.currentPlayback = null;
        }
      });

      this.store.recordUtterance({
        sessionId: input.sessionId ?? null,
        source: input.source,
        inputText: input.inputText,
        spokenText: input.speechText,
        decisionReason: 'spoken',
        spoken: true
      });
    });

    return this.speechQueue;
  }
}
