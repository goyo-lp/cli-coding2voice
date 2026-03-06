# cli2voice

cli2voice is a Codex-first voice layer for terminal coding agents.

The default speech path is fully local:
- Kokoro local TTS via `packages/tts-kokoro-local`
- American English voice `af_heart`
- a long-lived daemon that keeps the model warm and handles playback

It is organized as a monorepo with:
- shared core contracts and policy logic
- a local daemon with session persistence and playback control
- provider adapters for Codex, Claude Code, and Gemini CLI
- MCP integration for portable tool access
- platform integration bundles for Codex skills, Claude plugins, and Gemini extensions

Codex is the primary host target. Claude Code and Gemini CLI remain supported through the same daemon and MCP control plane.

See `docs/architecture.md` for the target system design.
