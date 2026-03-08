# Kokoro Migration Plan

## Goal

Use local Kokoro as the only `cli2voice` speech provider, using:

- provider: `kokoro`
- voice: `af_heart`
- language/accent target: American English
- primary agent target: Codex

## Why this migration

- `cli2voice` reads short terminal answers, which fits local TTS well.
- Kokoro has an official JavaScript runtime path suitable for this TypeScript/Node codebase.
- Local inference removes API-key dependence, network latency, and ongoing usage cost.
- The daemon architecture already exists, which amortizes Kokoro's cold-start cost by keeping the model warm.

## Constraints

- Do not regress Codex wrapper behavior.
- Preserve playback backends and MCP control plane.
- Confirm the migration with a real synthesis smoke test, not just type checks.

## Technical approach

1. Add `packages/tts-kokoro-local`.
2. Use `kokoro-js` in Node CPU mode with a warm, reusable model instance.
3. Synthesize audio as WAV and feed it through the existing playback layer.
4. Simplify daemon config to a single `kokoro` section.
5. Make `af_heart` the default voice.
6. Remove hosted TTS provider packages and references from the repo.
7. Update docs and integrations to describe Codex as the primary workflow.
8. Validate with a real daemon + Codex-oriented smoke test.

## Ticket sequence

1. `KOKORO-1`: Add the local Kokoro TTS package.
2. `KOKORO-2`: Wire Kokoro into daemon config and runtime defaults.
3. `KOKORO-3`: Update Codex-first docs and installation guidance.
4. `KOKORO-4`: Validate the full flow with real synthesis and session playback plumbing.

## Acceptance criteria

- `cli2voice status` reports `ttsProvider: kokoro` by default.
- Default Kokoro voice is `af_heart`.
- The runtime and package graph contain no non-Kokoro TTS code paths.
- `npm run check`, `npm run build`, and `npm test` pass.
- A real local Kokoro synthesis succeeds through the daemon.
- Codex-facing docs describe the supported setup clearly.
