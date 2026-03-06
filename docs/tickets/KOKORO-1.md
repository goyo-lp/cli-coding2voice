# KOKORO-1: Add Local Kokoro TTS Package

## Goal

Create a new package that implements the existing `TextToSpeechProvider` contract using local Kokoro inference.

## Scope

- Create `packages/tts-kokoro-local`
- Add `kokoro-js` dependency
- Implement a provider class that:
  - loads Kokoro once and reuses it
  - runs in Node CPU mode
  - defaults to `af_heart`
  - emits playable audio buffers
- Add a focused unit or smoke-oriented test if practical

## Files

Primary ownership:
- `packages/tts-kokoro-local/**`

Allowed supporting edits:
- root/workspace package metadata if needed for dependency wiring

## Acceptance criteria

- Package builds successfully
- Provider satisfies `TextToSpeechProvider`
- Local synthesis returns a non-empty audio buffer
- Default voice is `af_heart`
