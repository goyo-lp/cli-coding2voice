# Curl Installer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a single `curl | bash` installer that clones, builds, pre-downloads models, and configures integrations for cli2voice.

**Architecture:** A bash `install.sh` at repo root handles all setup. A Node.js `scripts/warm-models.mjs` triggers HuggingFace model pre-downloads for Kokoro TTS and Whisper STT. The installer is idempotent (re-running updates instead of failing).

**Tech Stack:** Bash (installer), Node.js ESM (model warm-up), HuggingFace transformers + kokoro-js (model downloads)

---

### Task 1: Create the model warm-up script

**Files:**
- Create: `scripts/warm-models.mjs`

**Step 1: Write the warm-up script**

This script imports the Kokoro and Whisper libraries directly and triggers model downloads without needing the daemon. It uses the same default model IDs as the daemon config.

```javascript
#!/usr/bin/env node
// scripts/warm-models.mjs
// Pre-downloads Kokoro TTS and Whisper STT models from HuggingFace.
// Called by install.sh during setup.

import { KokoroTTS } from 'kokoro-js';
import { pipeline } from '@huggingface/transformers';

const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_DTYPE = 'q8';
const KOKORO_DEVICE = 'cpu';
const WHISPER_MODEL = 'onnx-community/whisper-large-v3-turbo';

async function warmKokoro() {
  process.stderr.write('Downloading Kokoro TTS model...\n');
  try {
    await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: KOKORO_DTYPE, device: KOKORO_DEVICE });
    process.stderr.write('✓ Kokoro TTS model cached\n');
  } catch (error) {
    process.stderr.write(`⚠ Kokoro download failed: ${error.message}\n`);
    process.stderr.write('  You can retry later with: cli2voice speak "test"\n');
  }
}

async function warmWhisper() {
  process.stderr.write('Downloading Whisper STT model...\n');
  try {
    await pipeline('automatic-speech-recognition', WHISPER_MODEL);
    process.stderr.write('✓ Whisper STT model cached\n');
  } catch (error) {
    process.stderr.write(`⚠ Whisper download failed: ${error.message}\n`);
    process.stderr.write('  You can retry later by enabling dictation\n');
  }
}

await warmKokoro();
await warmWhisper();
```

**Step 2: Verify the script runs**

Run: `cd ~/.cli2voice/repo && node scripts/warm-models.mjs`
Expected: Model download progress on stderr, "✓ ... cached" messages. Models appear in `~/.cache/huggingface/`.

**Step 3: Commit**

```bash
git add scripts/warm-models.mjs
git commit -m "feat: add model warm-up script for installer"
```

---

### Task 2: Create the installer script

**Files:**
- Create: `install.sh`

**Step 1: Write install.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

CLI2VOICE_HOME="${HOME}/.cli2voice"
REPO_DIR="${CLI2VOICE_HOME}/repo"
BIN_DIR="${CLI2VOICE_HOME}/bin"
REPO_URL="https://github.com/goyo-lp/cli-coding2voice.git"

# ── Colors ──────────────────────────────────────────────────────────────────
bold='\033[1m'
green='\033[32m'
yellow='\033[33m'
red='\033[31m'
reset='\033[0m'

info()  { printf "${bold}%s${reset}\n" "$*"; }
ok()    { printf "${green}✓${reset} %s\n" "$*"; }
warn()  { printf "${yellow}⚠${reset} %s\n" "$*"; }
fail()  { printf "${red}✗${reset} %s\n" "$*"; exit 1; }

# ── Dependency checks ──────────────────────────────────────────────────────
check_command() {
  local cmd="$1" name="$2" install_hint="$3" min_version="${4:-}"
  if command -v "$cmd" &>/dev/null; then
    local version
    version=$("$cmd" --version 2>&1 | head -1)
    ok "$name found: $version"
    return 0
  fi

  if command -v brew &>/dev/null; then
    warn "$name not found. Installing via Homebrew..."
    brew install "$cmd"
    ok "$name installed"
    return 0
  fi

  fail "$name is required but not found. Install it: $install_hint"
}

info ""
info "cli2voice installer"
info "───────────────────"
info ""

check_command node "Node.js" "https://nodejs.org/ or: brew install node"
check_command python3 "Python 3" "https://python.org/ or: brew install python3"
check_command git "Git" "https://git-scm.com/ or: brew install git"

# Verify Node.js version >= 18
NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js 18+ required (found v$(node -e 'console.log(process.versions.node)'))"
fi

# Xcode CLI tools (macOS only, needed for dictation helper)
if [ "$(uname -s)" = "Darwin" ]; then
  if xcrun --find swiftc &>/dev/null; then
    ok "Xcode CLI tools found"
  else
    warn "Xcode CLI tools not found. Installing..."
    xcode-select --install 2>/dev/null || true
    info "Please complete the Xcode CLI tools installation, then re-run this script."
    exit 1
  fi
fi

# ── Clone or update ────────────────────────────────────────────────────────
info ""
if [ -d "$REPO_DIR/.git" ]; then
  info "Updating existing installation..."
  cd "$REPO_DIR"
  git pull --ff-only
  ok "Updated to latest"
else
  info "Cloning cli2voice..."
  mkdir -p "$CLI2VOICE_HOME"
  git clone "$REPO_URL" "$REPO_DIR"
  ok "Cloned to $REPO_DIR"
fi

# ── Build ──────────────────────────────────────────────────────────────────
info ""
info "Installing dependencies..."
cd "$REPO_DIR"
npm install --no-audit --no-fund 2>&1 | tail -1
ok "Dependencies installed"

info "Building..."
npm run build 2>&1 | tail -1
ok "Build complete"

# ── Create bin wrapper ─────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/cli2voice" << 'WRAPPER'
#!/usr/bin/env bash
exec node "$HOME/.cli2voice/repo/apps/cli2voice/dist/cli.js" "$@"
WRAPPER
chmod +x "$BIN_DIR/cli2voice"
ok "Created cli2voice command"

# ── Add to PATH ────────────────────────────────────────────────────────────
add_to_path() {
  local shell_config="$1"
  local path_line='export PATH="$HOME/.cli2voice/bin:$PATH"'
  if [ -f "$shell_config" ] && grep -qF '.cli2voice/bin' "$shell_config"; then
    return 0
  fi
  printf '\n# cli2voice\n%s\n' "$path_line" >> "$shell_config"
  ok "Added to PATH in $shell_config"
}

case "${SHELL:-/bin/bash}" in
  */zsh)  add_to_path "$HOME/.zshrc" ;;
  */bash) add_to_path "$HOME/.bashrc" ;;
  *)      add_to_path "$HOME/.profile" ;;
esac

# Make cli2voice available in this script
export PATH="$BIN_DIR:$PATH"

# ── Pre-download models ───────────────────────────────────────────────────
info ""
info "Downloading AI models (this may take a few minutes)..."
node "$REPO_DIR/scripts/warm-models.mjs"

# ── Build dictation helper (macOS) ─────────────────────────────────────────
if [ "$(uname -s)" = "Darwin" ]; then
  info ""
  info "Building dictation helper..."
  if cli2voice dictation helper-build >/dev/null 2>&1; then
    ok "Dictation helper compiled"
  else
    warn "Dictation helper build failed (you can retry: cli2voice dictation helper-build)"
  fi
fi

# ── Audio confirmation ─────────────────────────────────────────────────────
info ""
info "Testing audio..."
# Start daemon temporarily
CLI2VOICE_PORT=0 cli2voice daemon start &
DAEMON_PID=$!
sleep 3

# Get the actual port from status
DAEMON_PORT=$(curl -s http://127.0.0.1:4317/status 2>/dev/null | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try{console.log(JSON.parse(d).port)}catch{console.log('4317')}
  })
" 2>/dev/null || echo "4317")

if cli2voice speak "cli 2 voice is ready" 2>/dev/null; then
  ok "Audio working"
else
  warn "Audio test failed (you can test later: cli2voice speak 'hello')"
fi

kill "$DAEMON_PID" 2>/dev/null
wait "$DAEMON_PID" 2>/dev/null || true

# ── Integration setup ──────────────────────────────────────────────────────
info ""
info "Which CLI tools do you use?"
info "  [1] Claude Code"
info "  [2] Codex"
info "  [3] Gemini CLI"
info "  [a] All"
info "  [n] None"
printf "> "
read -r choice

install_integration() {
  local name="$1" label="$2"
  if cli2voice integration install "$name" 2>/dev/null; then
    ok "$label integration installed"
  else
    warn "$label integration install failed"
  fi
}

case "$choice" in
  1) install_integration claude "Claude Code" ;;
  2) install_integration codex "Codex" ;;
  3) install_integration gemini "Gemini CLI" ;;
  a|A)
    install_integration claude "Claude Code"
    install_integration codex "Codex"
    install_integration gemini "Gemini CLI"
    ;;
  n|N) ok "Skipped integrations (run: cli2voice integration install <name> later)" ;;
  *) warn "Unknown choice '$choice', skipping integrations" ;;
esac

# ── Done ───────────────────────────────────────────────────────────────────
info ""
info "═══════════════════════════════════════"
info " cli2voice installed successfully!"
info "═══════════════════════════════════════"
info ""
info " Restart your shell or run:"
info "   source ~/.zshrc"
info ""
info " To start the daemon:"
info "   cli2voice daemon start"
info ""
info " To uninstall:"
info "   rm -rf ~/.cli2voice"
info ""
```

**Step 2: Make it executable**

```bash
chmod +x install.sh
```

**Step 3: Test the installer locally**

Run: `bash install.sh`
Expected: Full flow completes — deps checked, repo cloned/updated, built, models downloaded, audio plays, integrations prompted.

**Step 4: Commit**

```bash
git add install.sh
git commit -m "feat: add curl installer for one-line setup"
```

---

### Task 3: Fix the audio test in the installer

The audio test section in Task 2 starts a daemon and speaks. But `CLI2VOICE_PORT=0` isn't a real feature — the daemon uses port 4317 by default. Simplify this to use the default port and handle conflicts.

**Files:**
- Modify: `install.sh` (audio confirmation section)

**Step 1: Replace the audio test section**

Replace the audio confirmation block with:

```bash
# ── Audio confirmation ─────────────────────────────────────────────────────
info ""
info "Testing audio..."
CLI2VOICE_PORT=19741 cli2voice daemon start &
DAEMON_PID=$!
sleep 3

if CLI2VOICE_PORT=19741 cli2voice speak "cli 2 voice is ready" 2>/dev/null; then
  ok "Audio working"
else
  warn "Audio test failed (you can test later: cli2voice speak 'hello')"
fi

kill "$DAEMON_PID" 2>/dev/null
wait "$DAEMON_PID" 2>/dev/null || true
```

**Step 2: Test**

Run: `bash install.sh`
Expected: Daemon starts on port 19741, speaks, shuts down cleanly.

**Step 3: Commit**

```bash
git add install.sh
git commit -m "fix: use fixed port for installer audio test"
```

---

### Task 4: Update README with install instructions

**Files:**
- Modify: `README.md`

**Step 1: Add install section to README**

Add at the top of the README, after any existing title/description:

```markdown
## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/goyo-lp/cli-coding2voice/main/install.sh | bash
```

This will:
- Install dependencies (Node.js, Python 3) via Homebrew if needed
- Clone and build cli2voice to `~/.cli2voice/`
- Download Kokoro TTS and Whisper STT models (~900MB)
- Compile the macOS dictation helper
- Set up integrations for your CLI tools (Claude Code, Codex, Gemini CLI)

### Manual Install

```bash
git clone https://github.com/goyo-lp/cli-coding2voice.git ~/.cli2voice/repo
cd ~/.cli2voice/repo
npm install && npm run build
```

### Uninstall

```bash
rm -rf ~/.cli2voice
# Remove the PATH line from ~/.zshrc or ~/.bashrc
```
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add curl install instructions to README"
```

---

### Task 5: End-to-end validation

**Step 1: Clean slate test**

```bash
rm -rf ~/.cli2voice
curl -fsSL https://raw.githubusercontent.com/goyo-lp/cli-coding2voice/main/install.sh | bash
```

Expected: Full install completes, audio plays, integrations installed.

**Step 2: Idempotent re-run test**

```bash
curl -fsSL https://raw.githubusercontent.com/goyo-lp/cli-coding2voice/main/install.sh | bash
```

Expected: "Updating existing installation...", no errors, no duplicate PATH entries.

**Step 3: Verify post-install**

```bash
source ~/.zshrc
cli2voice status
cli2voice speak "hello world"
```

Expected: Status returns JSON, audio plays.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: cli2voice one-line installer complete"
```
