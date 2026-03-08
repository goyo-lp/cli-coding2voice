import { decodeWavFile } from './wav.js';
import { whisperLocalDefaults, resolveWhisperRuntimeModelId } from './models.js';
import { defaultWhisperPipelineFactory } from './runtime.js';
import type {
  WhisperAutomaticSpeechRecognitionPipeline,
  WhisperLocalTranscriberOptions,
  WhisperModelId,
  WhisperPipelineFactory,
  WhisperPipelineResult,
  WhisperReturnTimestamps,
  WhisperTask,
  WhisperTranscribeFileOptions,
  WhisperWarmOptions,
  WhisperWarmResult,
  WhisperTranscriptionChunk,
  WhisperTranscriptionResult
} from './types.js';

type ResolvedTranscriptionOptions = {
  chunkLengthSeconds: number;
  expectedSampleRate: number;
  language: string | null;
  model: WhisperModelId;
  returnTimestamps: WhisperReturnTimestamps;
  runtimeModel: string;
  strideLengthSeconds: number;
  task: WhisperTask;
};

export class WhisperLocalTranscriber {
  private readonly pipelines = new Map<string, Promise<WhisperAutomaticSpeechRecognitionPipeline>>();
  private readonly pipelineFactory: WhisperPipelineFactory;

  constructor(private readonly options: WhisperLocalTranscriberOptions = {}) {
    this.pipelineFactory = options.pipelineFactory ?? defaultWhisperPipelineFactory;
  }

  async transcribeFile(filePath: string, request: WhisperTranscribeFileOptions = {}): Promise<WhisperTranscriptionResult> {
    const resolved = this.resolveOptions(request);
    const audio = await decodeWavFile(filePath);

    if (audio.sampleRate !== resolved.expectedSampleRate) {
      throw new Error(
        `Whisper local dictation expects ${resolved.expectedSampleRate} Hz WAV audio, received ${audio.sampleRate} Hz.`
      );
    }

    const transcriber = await this.getPipeline(resolved.runtimeModel);
    const output = await transcriber(audio.samples, {
      chunk_length_s: resolved.chunkLengthSeconds,
      language: resolved.language,
      return_timestamps: resolved.returnTimestamps,
      stride_length_s: resolved.strideLengthSeconds,
      task: resolved.task
    });

    return {
      chunks: normalizeChunks(output),
      durationSeconds: audio.durationSeconds,
      language: resolved.language,
      model: resolved.model,
      runtimeModel: resolved.runtimeModel,
      sampleRate: audio.sampleRate,
      text: output.text.trim()
    };
  }

  async warm(request: WhisperWarmOptions = {}): Promise<WhisperWarmResult> {
    const resolved = this.resolveOptions(request);
    await this.getPipeline(resolved.runtimeModel);
    return {
      model: resolved.model,
      runtimeModel: resolved.runtimeModel
    };
  }

  private resolveOptions(request: WhisperTranscribeFileOptions): ResolvedTranscriptionOptions {
    const model = request.model ?? this.options.model ?? whisperLocalDefaults.model;

    return {
      chunkLengthSeconds:
        request.chunkLengthSeconds ?? this.options.chunkLengthSeconds ?? whisperLocalDefaults.chunkLengthSeconds,
      expectedSampleRate:
        request.expectedSampleRate ?? this.options.expectedSampleRate ?? whisperLocalDefaults.expectedSampleRate,
      language: normalizeLanguage(request.language ?? this.options.language ?? whisperLocalDefaults.language),
      model,
      returnTimestamps:
        request.returnTimestamps ?? this.options.returnTimestamps ?? whisperLocalDefaults.returnTimestamps,
      runtimeModel: resolveWhisperRuntimeModelId(model),
      strideLengthSeconds:
        request.strideLengthSeconds ?? this.options.strideLengthSeconds ?? whisperLocalDefaults.strideLengthSeconds,
      task: request.task ?? this.options.task ?? whisperLocalDefaults.task
    };
  }

  private async getPipeline(runtimeModel: string): Promise<WhisperAutomaticSpeechRecognitionPipeline> {
    const cacheKey = this.createCacheKey(runtimeModel);
    const existing = this.pipelines.get(cacheKey);
    if (existing) {
      return existing;
    }

    const pending = this.pipelineFactory('automatic-speech-recognition', runtimeModel, this.buildPipelineOptions()).catch(
      (error) => {
        this.pipelines.delete(cacheKey);
        throw error;
      }
    );
    this.pipelines.set(cacheKey, pending);
    return pending;
  }

  private buildPipelineOptions(): Record<string, unknown> {
    const options: Record<string, unknown> = {};

    if (this.options.device != null) {
      options.device = this.options.device;
    }

    if (this.options.dtype != null) {
      options.dtype = this.options.dtype;
    }

    if (this.options.revision) {
      options.revision = this.options.revision;
    }

    if (this.options.localFilesOnly != null) {
      options.local_files_only = this.options.localFilesOnly;
    }

    return options;
  }

  private createCacheKey(runtimeModel: string): string {
    const options = this.buildPipelineOptions();
    return `${runtimeModel}::${JSON.stringify(options)}`;
  }
}

function normalizeLanguage(language: string | null | undefined): string | null {
  const value = language?.trim();
  return value ? value : null;
}

function normalizeChunks(output: WhisperPipelineResult): WhisperTranscriptionChunk[] | undefined {
  if (!output.chunks?.length) {
    return undefined;
  }

  return output.chunks.map((chunk) => ({
    text: chunk.text.trim(),
    timestamp: chunk.timestamp
  }));
}
