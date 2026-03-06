# cli2voice Architecture

Packages:
- `packages/voice-core`: contracts, session actions, policy engine, speech filtering, daemon client types
- `packages/voice-daemon`: session store, daemon runtime, HTTP control plane
- `packages/mcp-server`: MCP wrapper around the daemon API
- `packages/provider-*`: provider-specific wrappers and event adapters
- `packages/tts-kokoro-local`: local Kokoro TTS provider, defaulting to American English `af_heart`
- `packages/tts-*`: optional hosted text-to-speech providers
- `packages/playback-*`: playback backends
- `apps/*`: user-facing CLIs
- `integrations/*`: Codex skill, Claude plugin, Gemini extension bundles

Primary flow:
1. A provider adapter registers a session with the daemon.
2. Provider events are normalized into `SessionAction` values.
3. The daemon persists actions, updates policy state, and decides whether to speak.
4. The daemon synthesizes audio through the active TTS provider and plays it through the selected backend.
5. External tools and integrations control the daemon through HTTP or MCP.

Default deployment:
- Codex is the primary host.
- The daemon keeps Kokoro loaded for lower warm-path latency.
- Local speech uses voice `af_heart` unless configuration overrides it.
