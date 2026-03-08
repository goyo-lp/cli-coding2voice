---
name: voice-control
description: Detect explicit user intent to control cli2voice speech for the current Codex workspace and run the installed helper script.
---

# Voice Control Skill

Use this skill when the user asks to:
- turn voice on
- turn voice off
- reset voice to default behavior
- switch plan mode on or off

## Rules

1. Only react to explicit voice-control intent.
2. Map the request to exactly one mode:
- `on`
- `off`
- `default`
- `plan-on`
- `plan-off`
3. Run the helper script:

```bash
"${CODEX_HOME:-$HOME/.codex}/skills/voice-control/scripts/set-voice.sh" <mode>
```

## Notes

- The helper targets the most recent Codex session for the current workspace via `cli2voice`, not an ad-hoc temp file.
- If no matching Codex session exists, tell the user to launch Codex through `codex2voice` first.
