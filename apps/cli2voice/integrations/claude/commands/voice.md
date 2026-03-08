---
description: Control cli2voice speech for the current Claude workspace
argument-hint: <on|off|default|plan-on|plan-off>
allowed-tools: [Bash]
---

# Voice Control

Translate the user's request into exactly one of these modes:

- `on`
- `off`
- `default`
- `plan-on`
- `plan-off`

Then run:

```bash
node "__CLI2VOICE_APP_CLI__" session <mode> --provider claude --workspace "$PWD"
```

After the command finishes, report the resulting voice mode change.
