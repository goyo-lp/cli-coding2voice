#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
case "$mode" in
  on|off|default|plan-on|plan-off)
    ;;
  *)
    echo "Usage: set-voice.sh <on|off|default|plan-on|plan-off>" >&2
    exit 2
    ;;
esac

node "__CLI2VOICE_APP_CLI__" session "$mode" --provider codex --workspace "$PWD"
