# KOKORO-2: Wire Kokoro Into Runtime Defaults

## Goal

Make Kokoro the default TTS provider for `cli2voice` while keeping the provider abstraction intact.

## Scope

- Extend daemon config types with `kokoro`
- Add config defaults for:
  - provider `kokoro`
  - voice `af_heart`
  - Node CPU mode
  - quantization setting
- Update runtime provider selection to instantiate Kokoro
- Ensure status output reports Kokoro configuration
- Keep OpenAI and ElevenLabs optional

## Files

Primary ownership:
- `packages/voice-daemon/src/config.ts`
- `packages/voice-daemon/src/runtime.ts`
- `packages/voice-daemon/src/server.ts` if needed
- `packages/voice-daemon/src/client.ts` if needed

Allowed supporting edits:
- package manifests for dependency wiring
- shared types if required

## Acceptance criteria

- Default runtime provider is Kokoro
- `cli2voice status` shows `ttsProvider: kokoro`
- Status/config surfaces include Kokoro voice information
- Existing daemon behavior remains intact
