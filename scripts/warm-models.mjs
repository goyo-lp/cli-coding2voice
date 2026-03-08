#!/usr/bin/env node
// Pre-downloads Kokoro TTS and Whisper STT models from HuggingFace.
// Called by install.sh during setup.

import { KokoroTTS } from 'kokoro-js';
import { pipeline } from '@huggingface/transformers';

const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_DTYPE = 'q8';
const KOKORO_DEVICE = 'cpu';
const WHISPER_MODEL = 'onnx-community/whisper-large-v3-turbo';

async function warmKokoro() {
  process.stderr.write('Downloading Kokoro TTS model...\n');
  try {
    await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: KOKORO_DTYPE, device: KOKORO_DEVICE });
    process.stderr.write('✓ Kokoro TTS model cached\n');
  } catch (error) {
    process.stderr.write(`⚠ Kokoro download failed: ${error.message}\n`);
    process.stderr.write('  You can retry later with: cli2voice speak "test"\n');
  }
}

async function warmWhisper() {
  process.stderr.write('Downloading Whisper STT model...\n');
  try {
    await pipeline('automatic-speech-recognition', WHISPER_MODEL);
    process.stderr.write('✓ Whisper STT model cached\n');
  } catch (error) {
    process.stderr.write(`⚠ Whisper download failed: ${error.message}\n`);
    process.stderr.write('  You can retry later by enabling dictation\n');
  }
}

await warmKokoro();
await warmWhisper();
