# Claude Integration

This directory is a Claude Code plugin bundle for `cli2voice`.

Contents:

- `.claude-plugin/plugin.json`: plugin metadata
- `.mcp.json`: launches the `cli2voice` MCP server
- `commands/voice.md`: `/voice` slash command
- `hooks/hooks.json`: `SessionStart` and `Stop` hooks
- `skills/voice-control/SKILL.md`: lets Claude infer explicit voice intent

Recommended install:

```bash
node __CLI2VOICE_APP_CLI__ integration install claude
```

After install, restart Claude Code. The plugin will:

- register each Claude session with `cli2voice` on `SessionStart`
- inspect the transcript on `Stop` and publish the last assistant text to the daemon
- expose MCP tools for direct control and status
