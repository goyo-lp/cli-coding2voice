---
name: voice-control
description: Use this skill when the user explicitly asks Claude to change cli2voice speech behavior for the current workspace.
version: 1.0.0
---

# Voice Control

Map the request to exactly one of these modes:

- `on`
- `off`
- `default`
- `plan-on`
- `plan-off`

Then run:

```bash
node "__CLI2VOICE_APP_CLI__" session <mode> --provider claude --workspace "$PWD"
```

Only use this skill for explicit voice-control requests.
