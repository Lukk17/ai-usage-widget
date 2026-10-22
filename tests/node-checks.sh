#!/usr/bin/env bash
set -uo pipefail

readonly RESULTS="${AI_USAGE_RESULTS:-/results}"
mkdir -p "$RESULTS"
status=0

npm run --silent test:coverage 2>&1 | tee "$RESULTS/unit.log" || status=1

mapfile -t scripts < <(find tests -name '*.sh' -type f | sort)
if shellcheck "${scripts[@]}" > "$RESULTS/shellcheck.log" 2>&1; then
  printf 'ok - shellcheck found nothing in %s scripts\n' "${#scripts[@]}" | tee -a "$RESULTS/shellcheck.log"
else
  cat "$RESULTS/shellcheck.log"
  printf 'not ok - shellcheck found problems\n'
  status=1
fi

exit "$status"
