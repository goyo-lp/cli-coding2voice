# cli2voice Curl Installer Design

## Distribution Method

Single curl command:
```
curl -fsSL https://raw.githubusercontent.com/goyo-lp/cli-coding2voice/main/install.sh | bash
```

## Install Location

```
~/.cli2voice/
├── repo/                  # git clone of cli-coding2voice
├── bin/
│   ├── cli2voice          # shell wrapper → node repo/apps/cli2voice/dist/cli.js
│   └── cli2voice-dictation-helper  # compiled Swift binary
├── config.json            # created on first daemon start
└── state.sqlite           # session persistence
```

`~/.cli2voice/bin` is added to user's PATH via shell config.

## Installer Flow

### Step 1: Check system dependencies
- Node.js 18+ → auto-install via Homebrew if available, else error with instructions
- Python 3 → same strategy
- Xcode CLI tools → prompt `xcode-select --install` if missing (macOS)

### Step 2: Clone & build
- `git clone` to `~/.cli2voice/repo` (or `git pull` if already exists for idempotent re-install)
- `npm install && npm run build`

### Step 3: Create bin wrapper
- Write `~/.cli2voice/bin/cli2voice` shell script, `chmod +x`

### Step 4: Add to PATH
- Detect shell (zsh/bash/profile)
- Append `export PATH="$HOME/.cli2voice/bin:$PATH"` if not already present

### Step 5: Pre-download models
- Run `scripts/warm-models.mjs` which triggers HuggingFace downloads for:
  - Kokoro TTS model (`onnx-community/Kokoro-82M-v1.0-ONNX`, q8, ~80MB)
  - Whisper STT model (`onnx-community/whisper-large-v3-turbo`, ~800MB)
- Start daemon temporarily, run `cli2voice speak "cli2voice is ready"` for audio confirmation
- Compile dictation helper via `cli2voice dictation helper-build`

### Step 6: Interactive integration setup
- Prompt user: which CLI tools do you use? (Claude Code / Codex / Gemini CLI / All / None)
- Run `cli2voice integration install <name>` for selected integrations

### Step 7: Print completion message
- Remind to restart shell or `source` config
- Print `cli2voice daemon start` to begin
- Print uninstall instructions: `rm -rf ~/.cli2voice`

## Edge Cases

- **Re-install/update**: If `~/.cli2voice/repo` exists, `git pull` + rebuild instead of clone
- **Model download failure**: Warn but don't fail install; user retries on first use
- **Xcode CLT missing + declined**: Skip dictation helper, warn dictation unavailable
- **Integration install failure**: Warn and continue with remaining integrations
- **Shell detection**: Check `$SHELL` for zsh/bash, fall back to `~/.profile`

## Files to Create

1. `install.sh` — main installer script at repo root
2. `scripts/warm-models.mjs` — Node script that triggers model pre-downloads
