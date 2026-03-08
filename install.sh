#!/usr/bin/env bash
set -euo pipefail

CLI2VOICE_HOME="${HOME}/.cli2voice"
REPO_DIR="${CLI2VOICE_HOME}/repo"
BIN_DIR="${CLI2VOICE_HOME}/bin"
REPO_URL="https://github.com/goyo-lp/cli-coding2voice.git"
SHELL_CONFIG="$HOME/.profile"
SOURCE_COMMAND="source ~/.profile"

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

create_node_wrapper() {
  local name="$1" target="$2"
  cat > "$BIN_DIR/$name" << WRAPPER
#!/usr/bin/env bash
exec node "\$HOME/.cli2voice/repo/$target" "\$@"
WRAPPER
  chmod +x "$BIN_DIR/$name"
  ok "Created $name command"
}

create_shell_wrapper() {
  local name="$1" command="$2"
  cat > "$BIN_DIR/$name" << WRAPPER
#!/usr/bin/env bash
exec $command "\$@"
WRAPPER
  chmod +x "$BIN_DIR/$name"
  ok "Created $name command"
}

# ── Dependency checks ──────────────────────────────────────────────────────
check_command() {
  local cmd="$1" name="$2" install_hint="$3"
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
if ! npm install --no-audit --no-fund 2>&1 | tail -3; then
  fail "npm install failed"
fi
ok "Dependencies installed"

info "Building..."
if ! npm run build 2>&1 | tail -3; then
  fail "npm run build failed"
fi
ok "Build complete"

# ── Create bin wrappers ────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
create_node_wrapper cli2voice "apps/cli2voice/dist/cli.js"
create_node_wrapper codex2voice "apps/codex2voice/dist/cli.js"
create_node_wrapper claude2voice "apps/claude2voice/dist/cli.js"
create_node_wrapper gemini2voice "apps/gemini2voice/dist/cli.js"
create_shell_wrapper codex-voice "codex2voice wrap --"
create_shell_wrapper claude-voice "claude2voice wrap --"
create_shell_wrapper gemini-voice "gemini2voice wrap --"

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
  */zsh)
    SHELL_CONFIG="$HOME/.zshrc"
    SOURCE_COMMAND="source ~/.zshrc"
    ;;
  */bash)
    SHELL_CONFIG="$HOME/.bashrc"
    SOURCE_COMMAND="source ~/.bashrc"
    ;;
  *)
    SHELL_CONFIG="$HOME/.profile"
    SOURCE_COMMAND="source ~/.profile"
    ;;
esac
add_to_path "$SHELL_CONFIG"

# Make cli2voice available for the rest of this script
export PATH="$BIN_DIR:$PATH"

enable_default_macos_dictation() {
  local config_path="$CLI2VOICE_HOME/config.json"

  if [ -f "$config_path" ]; then
    if node -e '
      const fs = require("fs");
      const filePath = process.argv[1];
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const hasSetting = parsed && parsed.dictation && Object.prototype.hasOwnProperty.call(parsed.dictation, "enabled");
      process.exit(hasSetting ? 0 : 1);
    ' "$config_path"; then
      ok "Keeping existing dictation.enabled preference"
      return 0
    fi
  fi

  if cli2voice config set dictation.enabled true >/dev/null 2>&1; then
    ok "Enabled dictation by default on macOS"
  else
    warn "Could not enable dictation automatically (you can run: cli2voice config set dictation.enabled true)"
  fi
}

# ── Pre-download models ───────────────────────────────────────────────────
info ""
info "Downloading AI models (this may take a few minutes)..."
if [ -f "$REPO_DIR/scripts/warm-models.mjs" ]; then
  node "$REPO_DIR/scripts/warm-models.mjs"
else
  warn "Model warm-up script not found in this checkout. Skipping pre-download."
  warn "The first speech or dictation request will download models on demand."
fi

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

if [ "$(uname -s)" = "Darwin" ]; then
  info ""
  info "Configuring dictation defaults..."
  enable_default_macos_dictation
fi

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

# ── Integration setup ──────────────────────────────────────────────────────
info ""
info "Which CLI tools do you use?"
info "  [1] Claude Code"
info "  [2] Codex"
info "  [3] Gemini CLI"
info "  [a] All"
info "  [n] None"
printf "> "
read -r choice < /dev/tty

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
info "   $SOURCE_COMMAND"
info ""
info " To start the daemon:"
info "   cli2voice daemon start"
info ""
info " Wrapped commands:"
info "   codex-voice"
info "   claude-voice"
info "   gemini-voice"
info ""
if [ "$(uname -s)" = "Darwin" ]; then
  info " macOS first-run checklist for dictation:"
  info "   1. Start the daemon: cli2voice daemon start"
  info "   2. Launch your wrapped CLI, for example: codex-voice"
  info "   3. Hold Right Option once and speak to trigger macOS permission prompts"
  info "   4. Allow access for your terminal app in:"
  info "      System Settings > Privacy & Security > Microphone"
  info "      System Settings > Privacy & Security > Speech Recognition"
  info "      System Settings > Privacy & Security > Accessibility"
  info "   5. If you dismissed a prompt, re-enable your terminal app there and try again"
  info "   6. Test dictation: hold Right Option, speak, release"
  info ""
  info " If permissions get stuck, reset them and retry:"
  info "   tccutil reset Microphone com.apple.Terminal"
  info "   tccutil reset SpeechRecognition com.apple.Terminal"
  info "   tccutil reset Accessibility com.apple.Terminal"
  info " Replace com.apple.Terminal with your terminal app bundle id if needed."
  info " For iTerm, use com.googlecode.iterm2."
  info ""
fi
info " To uninstall:"
info "   rm -rf ~/.cli2voice"
info ""
