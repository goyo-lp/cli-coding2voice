# cli2voice Architecture

Packages:
- `packages/voice-core`: contracts, session actions, policy engine, speech filtering, daemon client types
- `packages/voice-daemon`: session store, daemon runtime, HTTP control plane
- `packages/dictation-core`: PTY wrapper, transcript normalization, macOS helper management
- `packages/mcp-server`: MCP wrapper around the daemon API
- `packages/provider-*`: provider-specific wrappers and event adapters
- `packages/stt-whisper-local`: local Whisper-family transcription for dictation
- `packages/tts-kokoro-local`: the only TTS provider, defaulting to American English `af_heart`
- `packages/playback-*`: playback backends
- `native/macos-dictation-helper`: global shortcut and microphone capture helper for macOS
- `apps/*`: user-facing CLIs
- `integrations/*`: Codex skill, Claude plugin, Gemini extension bundles

Primary speech flow:
1. A provider adapter registers a session with the daemon.
2. Provider events are normalized into `SessionAction` values.
3. The daemon persists actions, updates policy state, and decides whether to speak.
4. The daemon synthesizes audio through Kokoro and plays it through the selected backend.
5. External tools and integrations control the daemon through HTTP or MCP.

Primary dictation flow:
1. A wrapped provider CLI runs inside a PTY managed by `packages/dictation-core`.
2. The macOS helper listens for the configured hold-to-talk shortcut and records a temporary WAV clip.
3. `packages/stt-whisper-local` transcribes the clip with a local Whisper runtime.
4. The normalized transcript is written back into the PTY without submitting the prompt.

Default deployment:
- Codex is the primary host.
- The daemon keeps Kokoro loaded for lower warm-path latency.
- Local speech uses voice `af_heart` unless configuration overrides it.
- Dictation defaults to `openai/whisper-large-v3-turbo` on macOS and can be switched to `openai/whisper-large-v3`.
- The default dictation shortcut is `right_option`.
