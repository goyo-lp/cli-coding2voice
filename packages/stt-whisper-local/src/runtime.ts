import fs from 'node:fs/promises';
import path from 'node:path';
import type { WhisperPipelineFactory } from './types.js';

type TransformersModule = {
  env?: {
    cacheDir?: string | null;
  };
  pipeline: WhisperPipelineFactory;
};

export async function importTransformersModule(): Promise<TransformersModule> {
  try {
    return (await import('@huggingface/transformers')) as TransformersModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load @huggingface/transformers for local Whisper transcription. Install workspace dependencies and retry. ${detail}`
    );
  }
}

export function isWhisperModelCacheCorruptionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return (
    normalized.includes('external initializer') ||
    normalized.includes('deserialize tensor') ||
    normalized.includes('out of bounds') ||
    normalized.includes('can not be read in full') ||
    normalized.includes('cannot be read in full') ||
    (normalized.includes('.onnx_data') && normalized.includes('not found'))
  );
}

export function getWhisperModelCachePath(cacheDir: string | null | undefined, model: string): string | null {
  const resolvedCacheDir = cacheDir?.trim();
  if (!resolvedCacheDir) {
    return null;
  }

  const segments = model.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  return path.join(resolvedCacheDir, ...segments);
}

async function clearWhisperModelCache(cacheDir: string | null | undefined, model: string): Promise<boolean> {
  const modelCachePath = getWhisperModelCachePath(cacheDir, model);
  if (!modelCachePath) {
    return false;
  }

  await fs.rm(modelCachePath, { force: true, recursive: true });
  return true;
}

export async function loadWhisperPipelineWithCacheRecovery(
  transformers: TransformersModule,
  task: Parameters<WhisperPipelineFactory>[0],
  model: Parameters<WhisperPipelineFactory>[1],
  options?: Parameters<WhisperPipelineFactory>[2]
): Promise<ReturnType<WhisperPipelineFactory>> {
  try {
    return await transformers.pipeline(task, model, options);
  } catch (error) {
    if (options?.local_files_only === true || !isWhisperModelCacheCorruptionError(error)) {
      throw error;
    }

    const cleared = await clearWhisperModelCache(transformers.env?.cacheDir, model);
    if (!cleared) {
      throw error;
    }

    return transformers.pipeline(task, model, options);
  }
}

export const defaultWhisperPipelineFactory: WhisperPipelineFactory = async (task, model, options) => {
  const transformers = await importTransformersModule();
  return loadWhisperPipelineWithCacheRecovery(transformers, task, model, options);
};
