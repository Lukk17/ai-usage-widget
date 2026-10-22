import { REASON } from '../core/http.mjs';
import { toFiniteNumber, parseIsoTime, isPlainObject } from '../core/values.mjs';
import { SECOND_MS } from '../core/units.mjs';
import { makeUsage, usageWindow, periodForMinutes, succeeded, unexpected, notAvailable } from '../core/usage.mjs';
import { LIMIT, MISSING_OUTPUT, foundOutput, wrapRead } from '../core/localRead.mjs';
import { KIND } from '../core/providerKind.mjs';
import { NO_FIELDS, NO_MIN_INTERVAL_SECONDS } from './common.mjs';

export const MAX_LINE_BYTES = 65536;

const WINDOW_FIELDS = ['primary', 'secondary'];

export const MAX_FILES = 20;

export const READ_SESSION_COMMAND = wrapRead('d="$HOME/.codex/sessions"; '
  + 'if [ -n "${CODEX_HOME:-}" ] && [ -d "$CODEX_HOME/sessions" ]; then d="$CODEX_HOME/sessions"; fi; '
  + 'files=$(' + LIMIT + ' find "$d" -type f -name "rollout-*.jsonl" -printf "%T@ %p\\n" 2>/dev/null | sort -rn | head -n ' + MAX_FILES + ' | cut -d " " -f 2-); '
  + 'if [ -z "$files" ]; then ' + MISSING_OUTPUT + '; else '
  + 'line=$(printf "%s\\n" "$files" | while IFS= read -r f; do '
  + 'if [ -f "$f" ] && [ ! -L "$f" ]; then l=$(' + LIMIT + ' grep -F "\\"rate_limits\\":{" -- "$f" | tail -n 1 | head -c ' + (MAX_LINE_BYTES + 1) + '); '
  + 'if [ -n "$l" ]; then printf "%s" "$l"; break; fi; fi; done); '
  + foundOutput('line') + '; fi');

function resetTime(value, lineTime) {
  const resetsAt = typeof value.resets_at === 'number' ? toFiniteNumber(value.resets_at) : null;
  if (resetsAt !== null) {
    return resetsAt * SECOND_MS;
  }
  const resetsIn = typeof value.resets_in_seconds === 'number' ? toFiniteNumber(value.resets_in_seconds) : null;
  return resetsIn !== null && lineTime !== null ? lineTime + resetsIn * SECOND_MS : null;
}

function readWindow(value, lineTime) {
  if (!isPlainObject(value)) {
    return null;
  }
  const percent = typeof value.used_percent === 'number' ? toFiniteNumber(value.used_percent) : null;
  const minutes = typeof value.window_minutes === 'number' ? toFiniteNumber(value.window_minutes) : null;
  if (percent === null || minutes === null) {
    return null;
  }
  const period = periodForMinutes(minutes);
  return usageWindow(period.period, '', percent, resetTime(value, lineTime), { count: period.count });
}

function rateLimitsOf(text) {
  try {
    const value = JSON.parse(text);
    if (!isPlainObject(value) || !isPlainObject(value.payload) || !isPlainObject(value.payload.rate_limits)) {
      return null;
    }
    return { limits: value.payload.rate_limits, lineTime: parseIsoTime(value.timestamp) };
  } catch (error) {
    return null;
  }
}

function interpret(read) {
  if (!read.found) {
    return notAvailable(REASON.CODEX_MISSING);
  }
  if (read.text.trim() === '') {
    return notAvailable(REASON.CODEX_NO_LIMITS);
  }
  const found = rateLimitsOf(read.text);
  if (found === null) {
    return unexpected(REASON.FILE_FORMAT_CHANGED);
  }
  const limits = found.limits;
  const windows = WINDOW_FIELDS
    .filter((field) => limits[field] !== undefined && limits[field] !== null)
    .map((field) => readWindow(limits[field], found.lineTime));
  if (windows.length === 0 || windows.indexOf(null) !== -1) {
    return unexpected(REASON.FILE_FORMAT_CHANGED);
  }
  return succeeded(makeUsage({ windows: windows }));
}

export const chatgpt = Object.freeze({
  id: 'chatgpt',
  title: 'ChatGPT',
  kind: KIND.LOCAL,
  minIntervalSeconds: NO_MIN_INTERVAL_SECONDS,
  needsKey: false,
  keyHelp: '',
  fields: NO_FIELDS,
  readCommand: READ_SESSION_COMMAND,
  maxReadBytes: MAX_LINE_BYTES,
  interpret: interpret,
});
