import type { WhisperRuntimeModelId, WhisperUserFacingModelId } from './types.js';

export const whisperJsRuntimeModelIds = {
  'openai/whisper-large-v3': 'onnx-community/whisper-large-v3-ONNX',
  'openai/whisper-large-v3-turbo': 'onnx-community/whisper-large-v3-turbo'
} satisfies Record<WhisperUserFacingModelId, WhisperRuntimeModelId>;

export const whisperLocalDefaults = {
  model: 'openai/whisper-large-v3-turbo',
  runtimeModel: whisperJsRuntimeModelIds['openai/whisper-large-v3-turbo'],
  language: 'en',
  task: 'transcribe',
  chunkLengthSeconds: 20,
  strideLengthSeconds: 4,
  returnTimestamps: false,
  expectedSampleRate: 16000
} as const;

export function isWhisperUserFacingModelId(modelId: string): modelId is WhisperUserFacingModelId {
  return modelId in whisperJsRuntimeModelIds;
}

export function resolveWhisperRuntimeModelId(modelId: string): string {
  if (isWhisperUserFacingModelId(modelId)) {
    return whisperJsRuntimeModelIds[modelId];
  }

  return modelId;
}
