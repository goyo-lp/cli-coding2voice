# Codex Integration

This is the primary host integration for cli2voice.

The default speech stack is local Kokoro:
- provider: `kokoro`
- model: `onnx-community/Kokoro-82M-v1.0-ONNX`
- voice: American English `af_heart`

This integration installs three Codex-facing pieces:

- `skills/voice-control`: skill that turns explicit voice requests into `cli2voice` session commands
- `config.example.toml`: MCP server snippet for `~/.codex/config.toml`
- `skills/voice-control/scripts/set-voice.sh`: helper used by the skill

Recommended install:

```bash
node __CLI2VOICE_APP_CLI__ integration install codex
```

That copies this directory into `~/.codex`, which makes the skill available at `~/.codex/skills/voice-control`.

After install, add the MCP snippet from `config.example.toml` into `~/.codex/config.toml` and restart Codex.

Recommended runtime flow:

1. Start the daemon: `cli2voice daemon start`
2. Keep using `codex` for normal Codex sessions.
3. Run `codex-voice` when you want wrapped speech output and dictation.
4. Use explicit controls in-session: `/voice on`, `/voice off`, `/voice default`

You can also use MCP tools exposed by `cli2voice mcp`.
