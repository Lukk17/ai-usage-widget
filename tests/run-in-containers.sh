#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
RESULTS="$(realpath -m -- "${1:-$ROOT/test-results}")"
readonly RESULTS
TEMP_ROOT="$(realpath -m -- "${TMPDIR:-/tmp}")"
readonly TEMP_ROOT
readonly RUN_ID="ai-usage-widget-test-$$"
readonly NODE_IMAGE="$RUN_ID:node"
readonly QML_IMAGE="$RUN_ID:qml"
readonly ISOLATION=(--network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 2g --cpus 2)
readonly HOST_FLAG_PATTERN='^--add-host=[A-Za-z0-9.-]+:[0-9.]+$'

containers=()
images=()

cleanup() {
  if [[ ${#containers[@]} -gt 0 ]]; then
    docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  fi
  if [[ ${#images[@]} -gt 0 ]]; then
    docker rmi -f "${images[@]}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

is_allowed_results_folder() {
  local path="$1"
  [[ "$path" == "$ROOT/test-results" || "$path" == "$ROOT/test-results"/* || "$path" == "$TEMP_ROOT"/?* ]]
}

check_results_folder() {
  if ! is_allowed_results_folder "$RESULTS"; then
    printf 'not ok - %s is not %s/test-results or a folder below %s, pick another results folder\n' "$RESULTS" "$ROOT" "$TEMP_ROOT" >&2
    exit 1
  fi
}

build() {
  local image="$1" dockerfile="$2"
  images+=("$image")
  docker build --quiet -t "$image" -f "$ROOT/tests/docker/$dockerfile" "$ROOT" >/dev/null
}

run_suite() {
  local suite="$1" image="$2"
  shift 2
  local container="$RUN_ID-$suite"
  local status=0
  containers+=("$container")
  docker create --name "$container" "${ISOLATION[@]}" "$@" "$image" >/dev/null
  docker start --attach "$container" || status=$?
  mkdir -p "$RESULTS/$suite"
  if ! docker cp "$container:/results/." "$RESULTS/$suite/"; then
    printf 'not ok - could not copy the %s results out of the container\n' "$suite" >&2
    status=1
  fi
  return "$status"
}

host_mapping_lines() {
  docker run --rm "${ISOLATION[@]}" "$QML_IMAGE" python3 -I -c "import json; [print('--add-host=' + h + ':' + a) for h, a in json.load(open('/work/tests/fixtures/scenarios.json'))['hosts'].items()]"
}

check_host_flags() {
  local line
  while IFS= read -r line; do
    if [[ ! "$line" =~ $HOST_FLAG_PATTERN ]]; then
      printf 'not ok - refused a host mapping line: %q\n' "$line" >&2
      return 1
    fi
  done <<< "$1"
}

main() {
  check_results_folder
  rm -rf -- "$RESULTS/node" "$RESULTS/qml"
  mkdir -p "$RESULTS"
  build "$NODE_IMAGE" node.Dockerfile
  build "$QML_IMAGE" qml.Dockerfile

  local status=0
  run_suite node "$NODE_IMAGE" || status=$?
  local hosts
  hosts="$(host_mapping_lines)"
  if [[ -z "$hosts" ]]; then
    printf 'not ok - the QML image printed no host mappings\n' >&2
    return 1
  fi
  check_host_flags "$hosts"
  local flags=()
  mapfile -t flags <<< "$hosts"
  run_suite qml "$QML_IMAGE" --sysctl net.ipv4.ip_unprivileged_port_start=0 "${flags[@]}" || status=$?

  printf 'results in %s\n' "$RESULTS"
  return "$status"
}

main
