---
name: voice-control
description: Use this skill when the user explicitly asks Gemini CLI to change cli2voice speech behavior for the current workspace.
version: 1.0.0
---

# Voice Control

Map the user's request to one of:

- `on`
- `off`
- `default`
- `plan-on`
- `plan-off`

Then run:

```bash
node "__CLI2VOICE_APP_CLI__" session <mode> --provider gemini --workspace "$PWD"
```

Only use this skill for explicit voice-control requests.
