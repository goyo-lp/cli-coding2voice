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
import { KokoroLocalTextToSpeechProvider } from '@cli2voice/tts-kokoro-local';
import type { ResolvedDaemonConfig } from './config.js';
import {
  createDictationTranscriber,
  type DictationTranscribeInput,
  type DictationTranscribeResult,
  type DictationTranscriber
} from './dictation.js';
import { Cli2VoiceStore } from './store.js';

export type Cli2VoiceRuntimeDependencies = {
  createDictationTranscriber?: (config: ResolvedDaemonConfig['dictation']) => DictationTranscriber;
};

export class Cli2VoiceRuntime {
  private readonly recentMessages = new Map<string, Map<string, number>>();
  private readonly playbackBackend: PlaybackBackend;
  private readonly ttsProvider: TextToSpeechProvider;
  private currentPlayback: ActivePlayback | null = null;
  private speechQueue: Promise<void> = Promise.resolve();
  private ttsWarmPromise: Promise<void> | null = null;
  private ttsWarmState: 'cold' | 'warming' | 'warm' = 'cold';
  private activeSpeechJobId = 0;
  private dictationTranscriber: DictationTranscriber | null = null;
  private dictationWarmPromise: Promise<void> | null = null;
  private dictationWarmState: 'cold' | 'warming' | 'warm' = 'cold';

  constructor(
    private readonly config: ResolvedDaemonConfig,
    private readonly store: Cli2VoiceStore,
    private readonly dependencies: Cli2VoiceRuntimeDependencies = {}
  ) {
    this.playbackBackend = this.createPlaybackBackend();
    this.ttsProvider = this.createTtsProvider();
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.ensureTtsWarm().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`cli2voice tts warmup failed: ${message}\n`);
    });
    if (this.config.dictation.enabled && this.config.dictation.prewarm) {
      await this.ensureDictationWarm().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`cli2voice dictation warmup failed: ${message}\n`);
      });
    }
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
        kokoro: {
          model: this.config.kokoro.model,
          voice: this.config.kokoro.voice,
          dtype: this.config.kokoro.dtype,
          device: this.config.kokoro.device,
          speed: this.config.kokoro.speed
        },
        dictation: {
          enabled: this.config.dictation.enabled,
          shortcut: this.config.dictation.shortcut,
          backend: this.config.dictation.backend,
          insertMode: this.config.dictation.insertMode,
          sttModel: this.config.dictation.sttModel,
          language: this.config.dictation.language,
          device: this.config.dictation.device,
          dtype: this.config.dictation.dtype,
          prewarm: this.config.dictation.prewarm,
          partialResults: this.config.dictation.partialResults,
          maxRecordingMs: this.config.dictation.maxRecordingMs,
          dictionary: this.config.dictation.dictionary,
          snippets: this.config.dictation.snippets,
          commandMode: this.config.dictation.commandMode
        }
      },
      ttsRuntime: {
        state: this.ttsWarmState,
        model: this.config.kokoro.model,
        voice: this.config.kokoro.voice,
        dtype: this.config.kokoro.dtype,
        device: this.config.kokoro.device
      },
      dictationRuntime: {
        state: this.dictationWarmState,
        model: this.config.dictation.sttModel,
        backend: this.config.dictation.backend,
        device: this.config.dictation.device,
        dtype: this.config.dictation.dtype
      }
    };
  }

  async transcribeDictation(input: DictationTranscribeInput): Promise<DictationTranscribeResult> {
    const transcriber = this.getOrCreateDictationTranscriber();
    const request = {
      language: input.language ?? this.config.dictation.language,
      model: input.model ?? this.config.dictation.sttModel
    };
    if (this.dictationWarmState === 'cold') {
      this.dictationWarmState = 'warming';
    }

    const result = await transcriber.transcribeFile(input.audioPath, request);
    this.dictationWarmState = 'warm';
    return result;
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
    this.activeSpeechJobId += 1;
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
    return new KokoroLocalTextToSpeechProvider({
      model: this.config.kokoro.model,
      voice: this.config.kokoro.voice,
      dtype: this.config.kokoro.dtype,
      device: this.config.kokoro.device,
      speed: this.config.kokoro.speed
    });
  }

  private getOrCreateDictationTranscriber(): DictationTranscriber {
    if (this.dictationTranscriber) {
      return this.dictationTranscriber;
    }

    const create = this.dependencies.createDictationTranscriber ?? createDictationTranscriber;
    this.dictationTranscriber = create(this.config.dictation);
    return this.dictationTranscriber;
  }

  private async ensureDictationWarm(): Promise<void> {
    if (this.dictationWarmState === 'warm') {
      return;
    }
    if (this.dictationWarmPromise) {
      return this.dictationWarmPromise;
    }

    const transcriber = this.getOrCreateDictationTranscriber();
    this.dictationWarmState = 'warming';
    this.dictationWarmPromise = transcriber
      .warm({ model: this.config.dictation.sttModel })
      .then(() => {
        this.dictationWarmState = 'warm';
      })
      .catch((error) => {
        this.dictationWarmState = 'cold';
        throw error;
      })
      .finally(() => {
        this.dictationWarmPromise = null;
      });

    return this.dictationWarmPromise;
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

  private getCurrentAudioFormat(): AudioFormat {
    return 'wav';
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
        this.activeSpeechJobId += 1;
        await this.currentPlayback.stop();
        this.currentPlayback = null;
      }

      const speechJobId = ++this.activeSpeechJobId;
      await this.ensureTtsWarm().catch(() => undefined);
      await this.playSpeechText(speechJobId, input.speechText);

      this.store.recordUtterance({
        sessionId: input.sessionId ?? null,
        source: input.source,
        inputText: input.inputText,
        spokenText: input.speechText,
        decisionReason: 'spoken',
        spoken: true
      });
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`cli2voice speech error (recovering): ${message}\n`);
      this.store.recordUtterance({
        sessionId: input.sessionId ?? null,
        source: input.source,
        inputText: input.inputText,
        spokenText: input.speechText,
        decisionReason: 'synthesis-error',
        spoken: false
      });
    });

    return this.speechQueue;
  }

  private async ensureTtsWarm(): Promise<void> {
    if (this.ttsWarmState === 'warm' || !this.ttsProvider.warm) {
      return;
    }
    if (this.ttsWarmPromise) {
      return this.ttsWarmPromise;
    }

    this.ttsWarmState = 'warming';
    this.ttsWarmPromise = this.ttsProvider
      .warm({
        model: this.config.kokoro.model,
        voice: this.config.kokoro.voice,
        format: this.getCurrentAudioFormat()
      })
      .then(() => {
        this.ttsWarmState = 'warm';
      })
      .catch((error) => {
        this.ttsWarmState = 'cold';
        throw error;
      })
      .finally(() => {
        this.ttsWarmPromise = null;
      });

    return this.ttsWarmPromise;
  }

  private async playSpeechText(speechJobId: number, text: string): Promise<void> {
    if (this.ttsProvider.streamSynthesize && this.playbackBackend.playStream) {
      try {
        const streamingPlayback = await this.startSpeechStreamingPlayback(speechJobId, text);
        if (streamingPlayback) {
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`cli2voice streaming playback failed, falling back to chunked playback: ${message}\n`);
      }
    }

    const chunks = splitSpeechTextForPlayback(text);
    if (chunks.length === 0) {
      return;
    }

    let playback = await this.startSpeechChunkPlayback(speechJobId, chunks[0] as string);
    if (!playback) {
      return;
    }

    if (chunks.length === 1) {
      return;
    }

    void this.continueSpeechChunks(speechJobId, playback, chunks.slice(1));
  }

  private async startSpeechStreamingPlayback(speechJobId: number, text: string): Promise<ActivePlayback | null> {
    if (!this.ttsProvider.streamSynthesize || !this.playbackBackend.playStream) {
      return null;
    }
    if (this.activeSpeechJobId !== speechJobId) {
      return null;
    }

    const playback = await this.playbackBackend.playStream(
      this.streamSpeechChunks(speechJobId, text),
      {
        rate: this.config.playback.rate,
        format: this.getCurrentAudioFormat()
      }
    );

    if (this.activeSpeechJobId !== speechJobId) {
      await playback.stop().catch(() => undefined);
      return null;
    }

    this.currentPlayback = playback;
    this.attachPlaybackCleanup(playback);
    return playback;
  }

  private async continueSpeechChunks(
    speechJobId: number,
    initialPlayback: ActivePlayback,
    remainingChunks: string[]
  ): Promise<void> {
    let playback: ActivePlayback | null = initialPlayback;
    let nextAudioPromise: Promise<Buffer> | null =
      remainingChunks.length > 0 ? this.synthesizeSpeechChunk(remainingChunks[0] as string) : null;

    for (let index = 0; index < remainingChunks.length; index += 1) {
      if (this.activeSpeechJobId !== speechJobId) {
        return;
      }

      await playback.done?.catch(() => undefined);
      if (this.activeSpeechJobId !== speechJobId) {
        return;
      }

      if (!nextAudioPromise) {
        return;
      }
      const audio = await nextAudioPromise;
      if (this.activeSpeechJobId !== speechJobId) {
        return;
      }

      const followingChunk = remainingChunks[index + 1];
      nextAudioPromise = followingChunk ? this.synthesizeSpeechChunk(followingChunk) : null;
      playback = await this.playAudioBuffer(audio);
      this.currentPlayback = playback;
      this.attachPlaybackCleanup(playback);
    }
  }

  private async startSpeechChunkPlayback(speechJobId: number, chunk: string): Promise<ActivePlayback | null> {
    if (this.activeSpeechJobId !== speechJobId) {
      return null;
    }

    const audio = await this.synthesizeSpeechChunk(chunk);
    if (this.activeSpeechJobId !== speechJobId) {
      return null;
    }

    const playback = await this.playAudioBuffer(audio);
    this.currentPlayback = playback;
    this.attachPlaybackCleanup(playback);
    return playback;
  }

  private async synthesizeSpeechChunk(text: string): Promise<Buffer> {
    return this.ttsProvider.synthesize({
      text,
      model: this.config.kokoro.model,
      voice: this.config.kokoro.voice,
      format: this.getCurrentAudioFormat()
    });
  }

  private async playAudioBuffer(audio: Buffer): Promise<ActivePlayback> {
    return this.playbackBackend.play(audio, {
      rate: this.config.playback.rate,
      format: this.getCurrentAudioFormat()
    });
  }

  private async *streamSpeechChunks(speechJobId: number, text: string): AsyncIterable<Buffer> {
    if (!this.ttsProvider.streamSynthesize) {
      return;
    }

    const chunks = this.ttsProvider.streamSynthesize({
      text,
      model: this.config.kokoro.model,
      voice: this.config.kokoro.voice,
      format: this.getCurrentAudioFormat()
    });

    for await (const chunk of chunks) {
      if (this.activeSpeechJobId !== speechJobId) {
        return;
      }
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
        continue;
      }
      yield chunk;
    }
  }

  private attachPlaybackCleanup(playback: ActivePlayback): void {
    playback.done?.finally(() => {
      if (this.currentPlayback?.id === playback.id) {
        this.currentPlayback = null;
      }
    });
  }
}

export function splitSpeechTextForPlayback(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  if (normalized.length <= 90) {
    return [normalized];
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return [normalized];
  }

  const [firstSentence, ...remainingSentences] = sentences;
  const chunks: string[] = [firstSentence as string];
  let current = '';

  for (const sentence of remainingSentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    const candidate = `${current} ${sentence}`;
    if (candidate.length <= 180) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = sentence;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
