# KOKORO-2: Make Kokoro The Only Runtime TTS

## Goal

Make Kokoro the only TTS provider for `cli2voice`.

## Scope

- Simplify daemon config types to `kokoro`
- Add config defaults for:
  - voice `af_heart`
  - Node CPU mode
  - quantization setting
- Remove all non-Kokoro provider wiring
- Update runtime provider selection to instantiate Kokoro only
- Ensure status output reports Kokoro configuration

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

- `cli2voice status` shows `ttsProvider: kokoro`
- Status/config surfaces include Kokoro voice information
- No runtime config or dependency wiring remains for non-Kokoro TTS providers
- Existing daemon behavior remains intact
