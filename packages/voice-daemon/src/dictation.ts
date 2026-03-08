import { WhisperLocalTranscriber } from '@cli2voice/stt-whisper-local';
import type {
  WhisperTranscriptionResult,
  WhisperWarmOptions,
  WhisperWarmResult
} from '@cli2voice/stt-whisper-local';
import type { ResolvedDaemonConfig } from './config.js';

export type DictationTranscribeInput = {
  audioPath: string;
  language?: string | null;
  model?: string;
  sessionId?: string | null;
};

export type DictationTranscribeResult = WhisperTranscriptionResult;

export type DictationTranscriber = {
  transcribeFile(filePath: string, request?: { language?: string | null; model?: string }): Promise<DictationTranscribeResult>;
  warm(request?: WhisperWarmOptions): Promise<WhisperWarmResult>;
};

export function createDictationTranscriber(
  config: ResolvedDaemonConfig['dictation']
): DictationTranscriber {
  return new WhisperLocalTranscriber({
    model: config.sttModel,
    language: config.language,
    device: config.device,
    dtype: config.dtype
  });
}
