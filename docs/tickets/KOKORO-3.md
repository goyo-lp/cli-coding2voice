# KOKORO-3: Update Codex-First Docs And Setup

## Goal

Make Codex the clearly documented primary path and remove ElevenLabs-first assumptions from the repo docs.

## Scope

- Update root README
- Update phase docs if needed
- Add or update a migration note describing Kokoro defaults
- Ensure Codex integration docs explain the expected local Kokoro behavior
- Keep Claude/Gemini docs accurate but secondary

## Files

Primary ownership:
- `README.md`
- `docs/**`
- `integrations/codex/**`

Allowed supporting edits:
- `integrations/claude/**`
- `integrations/gemini/**` if references need cleanup

## Acceptance criteria

- Docs say Kokoro is the default provider
- Docs say `af_heart` is the default voice
- Docs describe Codex as the primary integration path
- No user-facing docs imply ElevenLabs is the default path
