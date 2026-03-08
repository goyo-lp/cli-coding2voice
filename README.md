# cli2voice

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/goyo-lp/cli-coding2voice/main/install.sh | bash
```

This will:
- Install dependencies (Node.js, Python 3) via Homebrew if needed
- Clone and build cli2voice to `~/.cli2voice/`
- Download Kokoro TTS and Whisper STT models (~900MB)
- Compile the macOS dictation helper
- Create `cli2voice`, `codex-voice`, `claude-voice`, `gemini-voice`, `codex2voice`, `claude2voice`, and `gemini2voice` in `~/.cli2voice/bin`
- Enable dictation by default on macOS unless you already set `dictation.enabled`
- Set up integrations for your CLI tools (Claude Code, Codex, Gemini CLI)

### After Install

1. Reload your shell.
2. Start the daemon: `cli2voice daemon start`
3. Keep using `codex` for normal Codex.
4. Use `codex-voice` when you want wrapped speech output plus hold-to-talk dictation.

### macOS First Run

The first time you use dictation in a wrapped session, macOS may ask for permissions for your terminal app. Allow all three:

- `System Settings > Privacy & Security > Microphone`
- `System Settings > Privacy & Security > Speech Recognition`
- `System Settings > Privacy & Security > Accessibility`

Recommended test:

1. Run `cli2voice daemon start`
2. Run `codex-voice`
3. Hold `Right Option`, speak, then release

If you dismissed a prompt earlier, re-enable your terminal app in those privacy panes and try again. If permissions are stuck, reset them and retry:

```bash
tccutil reset Microphone com.apple.Terminal
tccutil reset SpeechRecognition com.apple.Terminal
tccutil reset Accessibility com.apple.Terminal
```

Replace `com.apple.Terminal` with your terminal app bundle id if you use iTerm or another terminal. For iTerm, use `com.googlecode.iterm2`.

### Manual Install

```bash
git clone https://github.com/goyo-lp/cli-coding2voice.git ~/.cli2voice/repo
cd ~/.cli2voice/repo
npm install && npm run build
mkdir -p ~/.cli2voice/bin
printf '#!/usr/bin/env bash\nexec node "$HOME/.cli2voice/repo/apps/cli2voice/dist/cli.js" "$@"\n' > ~/.cli2voice/bin/cli2voice
chmod +x ~/.cli2voice/bin/cli2voice
export PATH="$HOME/.cli2voice/bin:$PATH"
```

If you want the same wrapper commands as the curl installer, also create shell scripts for `codex-voice`, `claude-voice`, and `gemini-voice`, or call the built app CLIs directly such as `node ~/.cli2voice/repo/apps/codex2voice/dist/cli.js wrap --`.

### Uninstall

```bash
rm -rf ~/.cli2voice
# Remove the PATH line from ~/.zshrc or ~/.bashrc
```

---

cli2voice is a Codex-first voice layer for terminal coding agents.

The default speech path is fully local:
- Kokoro local TTS via `packages/tts-kokoro-local`
- American English voice `af_heart`
- a long-lived daemon that keeps the model warm and handles playback
- no hosted TTS providers in the runtime path

The repo also includes a local dictation path for wrapped CLIs on macOS:
- hold-to-talk input capture through a small native helper in `native/macos-dictation-helper`
- PTY-based text injection into wrapped `codex`, `claude`, and `gemini` sessions
- local Whisper-family STT via `packages/stt-whisper-local`
- default dictation model `openai/whisper-large-v3-turbo`
- configurable exact model `openai/whisper-large-v3`

It is organized as a monorepo with:
- shared core contracts and policy logic
- a local daemon with session persistence and playback control
- a shared dictation wrapper layer for terminal input
- provider adapters for Codex, Claude Code, and Gemini CLI
- MCP integration for portable tool access
- platform integration bundles for Codex skills, Claude plugins, and Gemini extensions

Codex is the primary host target. Claude Code and Gemini CLI remain supported through the same daemon and MCP control plane.

See `docs/architecture.md` for the target system design.

## Dictation

Dictation only works when the real CLI is launched through a wrapper:
- `codex-voice`
- `claude-voice`
- `gemini-voice`
- `codex2voice`
- `claude2voice`
- `gemini2voice`

The curl installer enables dictation by default on macOS unless you already chose a different `dictation.enabled` setting. Manual installs stay opt-in until you enable it yourself.

The default shortcut is `right_option`, input is inserted into the current prompt without pressing Enter, and the helper only supports macOS in the current implementation.

Useful commands:
- `cli2voice dictation status`
- `cli2voice dictation helper-build`
- `cli2voice config set dictation.enabled true`
- `cli2voice config set dictation.shortcut control_v`
- `cli2voice config set dictation.sttModel openai/whisper-large-v3`
