export type SessionControlSignal =
  | 'plan_enter'
  | 'plan_exit'
  | 'manual_voice_on'
  | 'manual_voice_off'
  | 'manual_voice_default';

export type SessionAction =
  | {
      kind: 'control';
      signal: SessionControlSignal;
      source: string;
      line?: number;
    }
  | {
      kind: 'candidate';
      message: string;
      source: string;
      line?: number;
      dedupeKey?: string;
    };

export type ManualVoiceOverride = 'on' | 'off' | null;
export type DefaultVoiceMode = 'off' | 'plan' | 'always';

export type SessionVoiceState = {
  defaultMode: DefaultVoiceMode;
  planMode: boolean;
  manualVoiceOverride: ManualVoiceOverride;
};

export type SpeechDecision = {
  shouldSpeak: boolean;
  reason: string;
  textForSpeech: string;
};

export type EvaluatedCandidate = {
  message: string;
  shouldSpeak: boolean;
  line?: number;
  source: string;
};

export type AudioFormat = 'mp3' | 'wav';

export type SynthesisRequest = {
  text: string;
  voice: string;
  model: string;
  format?: AudioFormat;
  instructions?: string;
};

export type SynthesisWarmRequest = Partial<Omit<SynthesisRequest, 'text'>> & {
  text?: string;
};

export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(request: SynthesisRequest): Promise<Buffer>;
  warm?(request?: SynthesisWarmRequest): Promise<void>;
  streamSynthesize?(request: SynthesisRequest): AsyncIterable<Buffer>;
}

export type PlaybackRequest = {
  rate?: number;
  format?: AudioFormat;
};

export type ActivePlayback = {
  id: string;
  pid?: number;
  filePath?: string;
  startedAt: string;
  done?: Promise<void>;
  stop(): Promise<void>;
};

export interface PlaybackBackend {
  readonly name: string;
  play(buffer: Buffer, request?: PlaybackRequest): Promise<ActivePlayback>;
  playStream?(chunks: AsyncIterable<Buffer>, request?: PlaybackRequest): Promise<ActivePlayback>;
}

export type RegisterSessionInput = {
  sessionId: string;
  provider: string;
  workspacePath: string;
  defaultMode?: DefaultVoiceMode;
  metadata?: Record<string, string>;
};

export type PublishActionsInput = {
  actions: SessionAction[];
};

export type SessionSelector = {
  sessionId?: string;
  provider?: string;
  workspacePath?: string;
};

export type SpeakNowInput = {
  text: string;
  sessionId?: string;
  force?: boolean;
  source?: string;
};

export type SessionOverrideInput = SessionSelector & {
  signal: SessionControlSignal;
};

export type SessionRecord = {
  sessionId: string;
  provider: string;
  workspacePath: string;
  defaultMode: DefaultVoiceMode;
  planMode: boolean;
  manualVoiceOverride: ManualVoiceOverride;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, string>;
};

export type SessionSummary = SessionRecord & {
  lastUtteranceAt: string | null;
  utteranceCount: number;
};

export type ActionPublicationResult = {
  session: SessionRecord;
  spoken: number;
  decisions: Array<{
    message: string;
    reason: string;
    spoken: boolean;
    source: string;
  }>;
};

export interface ProviderAdapter<Event = unknown> {
  readonly provider: string;
  parse(event: Event): SessionAction[];
}
