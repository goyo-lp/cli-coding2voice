import fs from 'node:fs/promises';
import type { DecodedWavAudio } from './types.js';

const RIFF_HEADER = 'RIFF';
const WAVE_HEADER = 'WAVE';
const FMT_CHUNK = 'fmt ';
const DATA_CHUNK = 'data';
const PCM_FORMAT = 1;
const FLOAT_FORMAT = 3;

type WavFormat = {
  audioFormat: number;
  bitsPerSample: number;
  blockAlign: number;
  channels: number;
  sampleRate: number;
};

export async function decodeWavFile(filePath: string): Promise<DecodedWavAudio> {
  const buffer = await fs.readFile(filePath);
  return decodeWavBuffer(buffer);
}

export function decodeWavBuffer(buffer: Buffer): DecodedWavAudio {
  if (buffer.length < 44) {
    throw new Error('WAV file is too small to contain a valid header.');
  }

  if (buffer.toString('ascii', 0, 4) !== RIFF_HEADER || buffer.toString('ascii', 8, 12) !== WAVE_HEADER) {
    throw new Error('Only RIFF/WAVE audio files are supported.');
  }

  let offset = 12;
  let format: WavFormat | null = null;
  let dataOffset = -1;
  let dataSize = -1;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + chunkSize > buffer.length) {
      throw new Error('WAV file contains a truncated chunk.');
    }

    if (chunkId === FMT_CHUNK) {
      if (chunkSize < 16) {
        throw new Error('WAV fmt chunk is incomplete.');
      }

      format = {
        audioFormat: buffer.readUInt16LE(chunkDataOffset),
        channels: buffer.readUInt16LE(chunkDataOffset + 2),
        sampleRate: buffer.readUInt32LE(chunkDataOffset + 4),
        blockAlign: buffer.readUInt16LE(chunkDataOffset + 12),
        bitsPerSample: buffer.readUInt16LE(chunkDataOffset + 14)
      };
    } else if (chunkId === DATA_CHUNK) {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!format) {
    throw new Error('WAV file is missing the fmt chunk.');
  }

  if (dataOffset < 0 || dataSize < 0) {
    throw new Error('WAV file is missing the data chunk.');
  }

  if (format.channels < 1) {
    throw new Error('WAV channel count must be at least 1.');
  }

  if (format.audioFormat === PCM_FORMAT) {
    return decodePcm16(buffer, dataOffset, dataSize, format);
  }

  if (format.audioFormat === FLOAT_FORMAT) {
    return decodeFloat32(buffer, dataOffset, dataSize, format);
  }

  throw new Error(`Unsupported WAV audio format: ${format.audioFormat}.`);
}

function decodePcm16(buffer: Buffer, dataOffset: number, dataSize: number, format: WavFormat): DecodedWavAudio {
  if (format.bitsPerSample !== 16) {
    throw new Error(`Unsupported PCM bit depth: ${format.bitsPerSample}. Expected 16-bit PCM.`);
  }

  if (format.blockAlign <= 0 || dataSize % format.blockAlign !== 0) {
    throw new Error('PCM WAV data is not aligned to frame boundaries.');
  }

  const frameCount = dataSize / format.blockAlign;
  const samples = new Float32Array(frameCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let mixed = 0;
    for (let channelIndex = 0; channelIndex < format.channels; channelIndex += 1) {
      const sampleOffset = dataOffset + frameIndex * format.blockAlign + channelIndex * 2;
      mixed += buffer.readInt16LE(sampleOffset) / 32768;
    }
    samples[frameIndex] = mixed / format.channels;
  }

  return {
    channels: format.channels,
    durationSeconds: frameCount / format.sampleRate,
    sampleRate: format.sampleRate,
    samples
  };
}

function decodeFloat32(buffer: Buffer, dataOffset: number, dataSize: number, format: WavFormat): DecodedWavAudio {
  if (format.bitsPerSample !== 32) {
    throw new Error(`Unsupported float WAV bit depth: ${format.bitsPerSample}. Expected 32-bit float.`);
  }

  if (format.blockAlign <= 0 || dataSize % format.blockAlign !== 0) {
    throw new Error('Float WAV data is not aligned to frame boundaries.');
  }

  const frameCount = dataSize / format.blockAlign;
  const samples = new Float32Array(frameCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let mixed = 0;
    for (let channelIndex = 0; channelIndex < format.channels; channelIndex += 1) {
      const sampleOffset = dataOffset + frameIndex * format.blockAlign + channelIndex * 4;
      mixed += buffer.readFloatLE(sampleOffset);
    }
    samples[frameIndex] = mixed / format.channels;
  }

  return {
    channels: format.channels,
    durationSeconds: frameCount / format.sampleRate,
    sampleRate: format.sampleRate,
    samples
  };
}
