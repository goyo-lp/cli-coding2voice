import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DefaultVoiceMode } from '@cli2voice/voice-core';

export type PlaybackConflictPolicy = 'ignore' | 'stop-and-replace';
export type PlaybackBackendKind = 'auto' | 'macos' | 'shell';
export type TtsProviderKind = 'kokoro' | 'openai' | 'elevenlabs';
export type KokoroDType = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
export type KokoroDeviceKind = 'cpu' | 'wasm' | 'webgpu';

export type StoredDaemonConfig = {
  host?: string;
  port?: number;
  dataDir?: string;
  defaultMode?: DefaultVoiceMode;
  summarizeCodeHeavy?: boolean;
  duplicateWindowMs?: number;
  playback?: {
    backend?: PlaybackBackendKind;
    conflictPolicy?: PlaybackConflictPolicy;
    rate?: number;
  };
  kokoro?: {
    model?: string;
    voice?: string;
    dtype?: KokoroDType;
    device?: KokoroDeviceKind;
    speed?: number;
  };
  openai?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    voice?: string;
    instructions?: string;
  };
  elevenlabs?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    voice?: string;
  };
  tts?: {
    provider?: TtsProviderKind;
  };
};

export type ResolvedDaemonConfig = {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  configPath: string;
  defaultMode: DefaultVoiceMode;
  summarizeCodeHeavy: boolean;
  duplicateWindowMs: number;
  playback: {
    backend: PlaybackBackendKind;
    conflictPolicy: PlaybackConflictPolicy;
    rate: number;
  };
  tts: {
    provider: TtsProviderKind;
  };
  kokoro: {
    model: string;
    voice: string;
    dtype: KokoroDType;
    device: KokoroDeviceKind;
    speed: number;
  };
  openai: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    voice: string;
    instructions?: string;
  };
  elevenlabs: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    voice: string;
  };
};

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.cli2voice');

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mergeConfig(stored: StoredDaemonConfig, dataDir: string, configPath: string): ResolvedDaemonConfig {
  const host = process.env.CLI2VOICE_HOST ?? stored.host ?? '127.0.0.1';
  const port = getEnvNumber('CLI2VOICE_PORT', stored.port ?? 4317);

  return {
    host,
    port,
    dataDir,
    dbPath: path.join(dataDir, 'state.sqlite'),
    configPath,
    defaultMode: (process.env.CLI2VOICE_DEFAULT_MODE as DefaultVoiceMode | undefined) ?? stored.defaultMode ?? 'plan',
    summarizeCodeHeavy:
      process.env.CLI2VOICE_SUMMARIZE_CODE_HEAVY === 'false'
        ? false
        : stored.summarizeCodeHeavy ?? true,
    duplicateWindowMs: getEnvNumber('CLI2VOICE_DUPLICATE_WINDOW_MS', stored.duplicateWindowMs ?? 8000),
    playback: {
      backend: (process.env.CLI2VOICE_PLAYBACK_BACKEND as PlaybackBackendKind | undefined) ?? stored.playback?.backend ?? 'auto',
      conflictPolicy:
        (process.env.CLI2VOICE_PLAYBACK_CONFLICT_POLICY as PlaybackConflictPolicy | undefined) ??
        stored.playback?.conflictPolicy ??
        'stop-and-replace',
      rate: getEnvNumber('CLI2VOICE_PLAYBACK_RATE', stored.playback?.rate ?? 1)
    },
    tts: {
      provider: (process.env.CLI2VOICE_TTS_PROVIDER as TtsProviderKind | undefined) ?? stored.tts?.provider ?? 'kokoro'
    },
    kokoro: {
      model:
        process.env.CLI2VOICE_KOKORO_MODEL ??
        stored.kokoro?.model ??
        'onnx-community/Kokoro-82M-v1.0-ONNX',
      voice: process.env.CLI2VOICE_KOKORO_VOICE ?? stored.kokoro?.voice ?? 'af_heart',
      dtype: (process.env.CLI2VOICE_KOKORO_DTYPE as KokoroDType | undefined) ?? stored.kokoro?.dtype ?? 'q8',
      device: (process.env.CLI2VOICE_KOKORO_DEVICE as KokoroDeviceKind | undefined) ?? stored.kokoro?.device ?? 'cpu',
      speed: getEnvNumber('CLI2VOICE_KOKORO_SPEED', stored.kokoro?.speed ?? 1)
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? stored.openai?.apiKey,
      baseUrl: process.env.OPENAI_BASE_URL ?? stored.openai?.baseUrl ?? 'https://api.openai.com/v1',
      model: process.env.CLI2VOICE_OPENAI_MODEL ?? stored.openai?.model ?? 'gpt-4o-mini-tts',
      voice: process.env.CLI2VOICE_OPENAI_VOICE ?? stored.openai?.voice ?? 'alloy',
      instructions: process.env.CLI2VOICE_OPENAI_INSTRUCTIONS ?? stored.openai?.instructions
    },
    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY ?? stored.elevenlabs?.apiKey,
      baseUrl: process.env.ELEVENLABS_BASE_URL ?? stored.elevenlabs?.baseUrl ?? 'https://api.elevenlabs.io/v1',
      model: process.env.CLI2VOICE_ELEVENLABS_MODEL ?? stored.elevenlabs?.model ?? 'eleven_flash_v2_5',
      voice: process.env.CLI2VOICE_ELEVENLABS_VOICE ?? stored.elevenlabs?.voice ?? 'EXAVITQu4vr4xnSDxMaL'
    }
  };
}

export function getDefaultDataDir(): string {
  return process.env.CLI2VOICE_DATA_DIR ?? DEFAULT_DATA_DIR;
}

export function getConfigPath(dataDir = getDefaultDataDir()): string {
  return path.join(dataDir, 'config.json');
}

export async function readStoredConfig(configPath = getConfigPath()): Promise<StoredDaemonConfig> {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return JSON.parse(raw) as StoredDaemonConfig;
  } catch {
    return {};
  }
}

export async function readDaemonConfig(): Promise<ResolvedDaemonConfig> {
  const dataDir = getDefaultDataDir();
  const configPath = getConfigPath(dataDir);
  await fs.mkdir(dataDir, { recursive: true });
  const stored = await readStoredConfig(configPath);
  return mergeConfig(stored, dataDir, configPath);
}

export async function writeStoredConfig(config: StoredDaemonConfig, configPath = getConfigPath()): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function setByPath(target: Record<string, unknown>, dotPath: string, value: unknown): void {
  const segments = dotPath.split('.').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('Config key cannot be empty.');
  }

  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] as string;
    const nextValue = cursor[segment];
    if (typeof nextValue !== 'object' || nextValue === null || Array.isArray(nextValue)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments.at(-1) as string] = value;
}

function parseConfigValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && value.trim() !== '') return numeric;
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export async function updateStoredConfig(dotPath: string, rawValue: string): Promise<ResolvedDaemonConfig> {
  const configPath = getConfigPath();
  const stored = await readStoredConfig(configPath);
  setByPath(stored as Record<string, unknown>, dotPath, parseConfigValue(rawValue));
  await writeStoredConfig(stored, configPath);
  return readDaemonConfig();
}
