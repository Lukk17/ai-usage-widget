import { ERROR_KIND, REASON, failure } from './http.mjs';
import { quote } from './shell.mjs';

export const LOCAL_TOOL_TIMEOUT_SECONDS = 8;
export const OVERALL_TIMEOUT_SECONDS = 9;
export const LOCAL_READ_TIMEOUT_MS = 10000;
export const LIMIT = 'timeout ' + LOCAL_TOOL_TIMEOUT_SECONDS;
export const FOUND_LINE = 'found';
export const MISSING_LINE = 'missing';

const FOUND_PATTERN = /^found (\d+)$/;

export const MISSING_OUTPUT = 'printf "' + MISSING_LINE + '\\n"';

export function wrapRead(script) {
  return 'timeout ' + OVERALL_TIMEOUT_SECONDS + ' sh -c ' + quote(script);
}

export function foundOutput(variable) {
  return 'printf "' + FOUND_LINE + ' %s\\n" "$(printf "%s" "$' + variable + '" | wc -c | tr -d " ")"; printf "%s" "$' + variable + '"';
}

export function fileReadCommand(pathExpression, maxBytes) {
  return wrapRead('f=' + pathExpression + '; '
    + 'if [ -f "$f" ] && [ ! -L "$f" ]; then size=$(' + LIMIT + ' wc -c < "$f" | tr -d " "); '
    + 'printf "' + FOUND_LINE + ' %s\\n" "$size"; ' + LIMIT + ' head -c ' + maxBytes + ' -- "$f"; '
    + 'else ' + MISSING_OUTPUT + '; fi');
}

function readFailed() {
  return { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.FILE_READ_FAILED) };
}

function tooLarge(maxBytes) {
  return { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.FILE_TOO_LARGE, null, { size: maxBytes }) };
}

export function parseLocalRead(result, maxBytes) {
  if (!result || result.timedOut || typeof result.stdout !== 'string') {
    return readFailed();
  }
  const lineEnd = result.stdout.indexOf('\n');
  const first = lineEnd === -1 ? result.stdout : result.stdout.slice(0, lineEnd);
  const text = lineEnd === -1 ? '' : result.stdout.slice(lineEnd + 1);
  if (first === MISSING_LINE) {
    return { ok: true, found: false, text: '' };
  }
  const found = FOUND_PATTERN.exec(first);
  if (found === null) {
    return readFailed();
  }
  if (Number(found[1]) > maxBytes) {
    return tooLarge(maxBytes);
  }
  return { ok: true, found: true, text: text };
}

export function readLocalFile(provider, runCommand) {
  return Promise.resolve()
    .then(() => runCommand(provider.readCommand, LOCAL_READ_TIMEOUT_MS))
    .then((result) => parseLocalRead(result, provider.maxReadBytes), () => ({ ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.COMMAND_FAILED) }));
}
