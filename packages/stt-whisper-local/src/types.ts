export type WhisperUserFacingModelId = 'openai/whisper-large-v3' | 'openai/whisper-large-v3-turbo';

export type WhisperRuntimeModelId =
  | 'onnx-community/whisper-large-v3-ONNX'
  | 'onnx-community/whisper-large-v3-turbo';

export type WhisperModelId = WhisperUserFacingModelId | WhisperRuntimeModelId | (string & {});

export type WhisperTask = 'transcribe' | 'translate';
export type WhisperReturnTimestamps = false | true | 'word';

export type WhisperTranscriptionChunk = {
  text: string;
  timestamp: [number | null, number | null];
};

export type WhisperTranscriptionResult = {
  text: string;
  model: WhisperModelId;
  runtimeModel: string;
  language: string | null;
  durationSeconds: number;
  sampleRate: number;
  chunks?: WhisperTranscriptionChunk[];
};

export type WhisperPipelineResult = {
  text: string;
  chunks?: WhisperTranscriptionChunk[];
};

export type WhisperAutomaticSpeechRecognitionPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>
) => Promise<WhisperPipelineResult>;

export type WhisperPipelineFactory = (
  task: 'automatic-speech-recognition',
  model: string,
  options?: Record<string, unknown>
) => Promise<WhisperAutomaticSpeechRecognitionPipeline>;

export type WhisperLocalTranscriberOptions = {
  model?: WhisperModelId;
  language?: string | null;
  chunkLengthSeconds?: number;
  strideLengthSeconds?: number;
  returnTimestamps?: WhisperReturnTimestamps;
  task?: WhisperTask;
  expectedSampleRate?: number;
  device?: string | null;
  dtype?: string | Record<string, string> | null;
  revision?: string;
  localFilesOnly?: boolean;
  pipelineFactory?: WhisperPipelineFactory;
};

export type WhisperTranscribeFileOptions = {
  model?: WhisperModelId;
  language?: string | null;
  chunkLengthSeconds?: number;
  strideLengthSeconds?: number;
  returnTimestamps?: WhisperReturnTimestamps;
  task?: WhisperTask;
  expectedSampleRate?: number;
};

export type WhisperWarmOptions = {
  model?: WhisperModelId;
};

export type WhisperWarmResult = {
  model: WhisperModelId;
  runtimeModel: string;
};

export type DecodedWavAudio = {
  channels: number;
  durationSeconds: number;
  sampleRate: number;
  samples: Float32Array;
};
