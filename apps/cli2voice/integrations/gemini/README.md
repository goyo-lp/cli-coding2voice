# Gemini Integration

This directory is a Gemini CLI extension for `cli2voice`.

Contents:

- `gemini-extension.json`: extension manifest and MCP server entry
- `hooks/hooks.json`: `SessionStart` and `AfterAgent` hooks
- `commands/voice.toml`: `/voice` command
- `skills/voice-control/SKILL.md`: explicit voice-control skill

Recommended install:

```bash
node __CLI2VOICE_APP_CLI__ integration install gemini
```

After install, restart Gemini CLI. The extension will:

- register each Gemini session with `cli2voice`
- publish the final `prompt_response` after each agent turn
- expose `cli2voice` MCP tools to Gemini
