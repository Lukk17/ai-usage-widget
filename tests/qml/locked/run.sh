#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${AI_USAGE_LOCKED_SESSION:-}" ]]; then
  HOME="$(mktemp -d)"
  XDG_RUNTIME_DIR="$(mktemp -d)"
  XDG_CACHE_HOME="$(mktemp -d)"
  XDG_DATA_HOME="$(mktemp -d)"
  AI_USAGE_LOCKED_SESSION=1
  export HOME XDG_RUNTIME_DIR XDG_CACHE_HOME XDG_DATA_HOME AI_USAGE_LOCKED_SESSION
  chmod 700 "$XDG_RUNTIME_DIR"
  mkdir -p "$HOME/.config"
  printf '[KSecretD]\nEnabled=false\n' > "$HOME/.config/kwalletrc"
  exec env -u DBUS_SESSION_BUS_ADDRESS dbus-run-session -- bash "${BASH_SOURCE[0]}"
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE

head -c 32 /dev/urandom | base64 | gnome-keyring-daemon --unlock --components=secrets >/dev/null
printf 'scenario-locked' | secret-tool store --label="ai-usage/minimax.alocked" server ai-usage user minimax.alocked type plaintext
secret-tool lock --collection=/org/freedesktop/secrets/collection/login
/usr/lib/qt6/bin/qmltestrunner -input "$HERE/lockedWallet.qml"
