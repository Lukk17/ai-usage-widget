#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
readonly ROOT="$HERE/../.."
readonly SCENARIOS="$HERE/../fixtures/scenarios.json"
readonly FIXTURES="$HERE/../fixtures"
readonly RESULTS="${AI_USAGE_RESULTS:-/results}"
readonly READOUT_ADDRESS=127.0.0.20
readonly READOUT_PORT=8766
readonly SERVICE_ADDRESS=127.0.0.10
readonly HTTPS_PORT=443
readonly WAIT_STEPS=50

json_lines() {
  python3 -I -c "$1" "$SCENARIOS"
}

lint_qml() {
  local log="$RESULTS/qmllint.log"
  if /usr/lib/qt6/bin/qmllint -I /usr/lib/qt6/qml "$ROOT"/package/contents/ui/*.qml > "$log" 2>&1; then
    printf 'ok - qmllint found nothing\n'
  else
    cat "$log"
    printf 'not ok - qmllint found problems\n'
    return 1
  fi
}

check_host_mapping() {
  local host address
  while read -r host address; do
    if [[ "$(getent hosts "$host" | awk '{print $1}')" != "$address" ]]; then
      printf 'not ok - %s must resolve to %s, start the container with the --add-host flags from tests/run-in-containers.sh\n' "$host" "$address"
      exit 1
    fi
  done < <(json_lines "import json, sys; [print(h, a) for h, a in json.load(open(sys.argv[1]))['hosts'].items()]")
}

make_certificates() {
  local dir="$1"
  local names
  names="$(json_lines "import json, sys; print(','.join('DNS:' + h for h in json.load(open(sys.argv[1]))['hosts']))")"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$dir/ca.key" -out "$dir/ca.pem" -days 2 -subj "/CN=ai-usage test CA" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout "$dir/server.key" -out "$dir/server.csr" -subj "/CN=ai-usage test server" 2>/dev/null
  printf 'subjectAltName=%s\n' "$names" > "$dir/san.ext"
  openssl x509 -req -in "$dir/server.csr" -CA "$dir/ca.pem" -CAkey "$dir/ca.key" -CAcreateserial -out "$dir/server.pem" -days 2 -extfile "$dir/san.ext" 2>/dev/null
}

store_fake_keys() {
  local service id scenario
  head -c 32 /dev/urandom | base64 | gnome-keyring-daemon --unlock --components=secrets >/dev/null
  while read -r service id scenario; do
    printf 'scenario-%s' "$scenario" | secret-tool store --label="ai-usage/$service.$id" server ai-usage user "$service.$id" type plaintext
  done < <(json_lines "import json, sys; [print(a['service'], a['id'], a['scenario']) for a in json.load(open(sys.argv[1]))['accounts'] if a['scenario']]")
}

place_local_files() {
  mkdir -p "$HOME/.config/Claude" "$HOME/.codex/sessions/2026/10/18" "$HOME/.cache/JetBrains/IntelliJIdea2026.2/log" "$HOME/.cache/JetBrains/PyCharm2026.2/log"
  cp "$FIXTURES/claude-desktop/plan-usage-history.json" "$HOME/.config/Claude/plan-usage-history.json"
  cp "$FIXTURES/codex/rollout-2026-10-18T12-00-00-placeholder.jsonl" "$HOME/.codex/sessions/2026/10/18/"
  cp "$FIXTURES/jetbrains/idea.log" "$HOME/.cache/JetBrains/IntelliJIdea2026.2/log/idea.log"
  cp "$FIXTURES/jetbrains/idea-other.log" "$HOME/.cache/JetBrains/PyCharm2026.2/log/idea.log"
}

wait_for() {
  local address="$1" port="$2"
  for _ in $(seq "$WAIT_STEPS"); do
    if python3 -I -c "import socket, sys; socket.create_connection((sys.argv[1], int(sys.argv[2])), 1)" "$address" "$port" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  printf 'not ok - nothing listens on %s:%s\n' "$address" "$port"
  exit 1
}

write_kwalletrc() {
  mkdir -p "$HOME/.config"
  printf '[KSecretD]\nEnabled=false\n' > "$HOME/.config/kwalletrc"
}

check_output_has_no_key() {
  if grep -n -F 'scenario-' "$1"; then
    printf 'not ok - a fake key appeared in the test output\n'
    exit 1
  fi
  printf 'ok - no fake key appeared in the test output\n'
}

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  mkdir -p "$RESULTS"
  status=0
  lint_qml || status=$?
  HOME="$(mktemp -d)"
  XDG_RUNTIME_DIR="$(mktemp -d)"
  XDG_CACHE_HOME="$(mktemp -d)"
  XDG_DATA_HOME="$(mktemp -d)"
  export HOME XDG_RUNTIME_DIR XDG_CACHE_HOME XDG_DATA_HOME
  chmod 700 "$XDG_RUNTIME_DIR"
  write_kwalletrc
  dbus-run-session -- bash "${BASH_SOURCE[0]}" 2>&1 | tee "$RESULTS/qml.log" || status=$?
  exit "$status"
fi

check_host_mapping
certificates="$(mktemp -d)"
make_certificates "$certificates"
export CURL_CA_BUNDLE="$certificates/ca.pem"
export QML_XHR_ALLOW_FILE_READ=1
store_fake_keys
place_local_files

python3 -I "$HERE/fixture_server.py" "$certificates/server.pem" "$certificates/server.key" &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
wait_for "$SERVICE_ADDRESS" "$HTTPS_PORT"
wait_for "$READOUT_ADDRESS" "$READOUT_PORT"

output="$(mktemp)"
status=0
/usr/lib/qt6/bin/qmltestrunner -input "$HERE" 2>&1 | tee "$output" || status=$?
bash "$HERE/locked/run.sh" 2>&1 | tee -a "$output" || status=$?
check_output_has_no_key "$output"
bash "$HERE/viewer-smoke.sh" || status=$?
exit "$status"
