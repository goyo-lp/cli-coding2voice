# cli2voice Phase Map

This repo implements the original seven-phase plan as concrete packages and bundles.

## Phase 1: Core Contracts

- `packages/voice-core`
- explicit `/voice` and `/plan` command parsing
- portable session reducer and speech filtering

## Phase 2: Local Daemon

- `packages/voice-daemon`
- HTTP control plane
- SQLite persistence via `node:sqlite`
- playback queue, dedupe, and utterance logging
- warm local Kokoro runtime for low-latency repeated speech

## Phase 3: Control Plane

- `packages/mcp-server`
- `cli2voice` CLI commands for `session`, `status`, `speak`, `stop`, `config`, and dictation helper/status inspection
- session selection by `sessionId` or `provider + workspace`

## Phase 4: Platform Targets

- `packages/provider-codex`
- `packages/provider-claude`
- `packages/provider-gemini`
- `packages/dictation-core`
- `integrations/codex`
- `integrations/claude`
- `integrations/gemini`
- wrapper-based PTY execution for dictation-capable CLI input

## Phase 5: Providers And Backends

- `packages/tts-kokoro-local`
- `packages/stt-whisper-local`
- `packages/playback-macos`
- `packages/playback-shell`
- `native/macos-dictation-helper`
- default voice: American English `af_heart`
- default dictation model: `openai/whisper-large-v3-turbo`

## Phase 6: Plugin Product Layer

- `cli2voice integration install <platform>` copies platform bundles with absolute paths
- all integrations expose `cli2voice` MCP
- docs define the install surface instead of hidden postinstall side effects

## Phase 7: Intelligence Layer

The repo deliberately keeps the hot speech path deterministic. Intelligence is placed at the edge:

- platform skills in `integrations/*/skills`
- explicit slash/custom commands in `integrations/*/commands`
- MCP tools for structured automation

This leaves room for a later docs/RAG or orchestration layer without coupling it to playback.
