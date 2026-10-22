import { ERROR_KIND, REASON, failure } from './http.mjs';
import { quote, quoteUrl } from './shell.mjs';
import { buildLookupPart, buildSearchPart } from './secrets.mjs';
import { SECOND_MS } from './units.mjs';
import { randomHex } from './values.mjs';

export const SECRET_TOOL_TIMEOUT_SECONDS = 10;
export const CURL_MAX_TIME_SECONDS = 20;
export const CURL_KILL_AFTER_SECONDS = 25;
export const MAX_RESPONSE_BYTES = 1048576;
export const BOUNDARY_PATTERN = /^aiu[0-9a-f]{24}$/;

const COMMAND_MARGIN_SECONDS = 5;
const BOUNDARY_DIGITS = 24;
const REQUEST_ID_PATTERN = /^[a-z][a-z0-9]{0,15}$/;
const SECRET_TOOL_TIMED_OUT = '124';
const TOOL_MISSING_CODES = ['126', '127'];
const CURL_TIMEOUT_CODES = [28, 124];
const CURL_CONNECTION_CODES = [6, 7];
const CURL_TOOL_MISSING_CODES = [126, 127];
const CURL_TOO_LARGE_CODE = 63;
const SAFE_START = 'ulimit -c 0; set +a +x +v; unset SSLKEYLOGFILE key rc found';
const HEADER_FORMAT = '%s: %s%s\\n';

export function newBoundary(random) {
  return 'aiu' + randomHex(BOUNDARY_DIGITS, random);
}

export function commandTimeoutMs(requestCount) {
  return (2 * SECRET_TOOL_TIMEOUT_SECONDS + requestCount * CURL_KILL_AFTER_SECONDS + COMMAND_MARGIN_SECONDS) * SECOND_MS;
}

function marker(boundary, word, value) {
  return 'printf ' + quote('%s ' + word + ' %s\\n') + ' ' + quote(boundary) + ' ' + value;
}

function lineMarker(boundary, word, value) {
  return 'printf ' + quote('\\n%s ' + word + ' %s\\n') + ' ' + quote(boundary) + ' ' + value;
}

function curlPart(spec, request) {
  if (!REQUEST_ID_PATTERN.test(request.id)) {
    throw new Error('the request id is not allowed');
  }
  const fixedHeaders = request.headers.map((header) => '-H ' + quote(header)).join(' ');
  const writeOut = '\\n' + spec.boundary + ' end %{http_code} %header{retry-after}\\n';
  return [
    marker(spec.boundary, 'begin', quote(request.id)),
    'printf ' + quote(HEADER_FORMAT) + ' ' + quote(spec.auth.header) + ' ' + quote(spec.auth.prefix) + ' "$key" | timeout ' + CURL_KILL_AFTER_SECONDS
      + ' curl --disable --silent --show-error --globoff --tlsv1.2 --proto ' + quote('=https') + ' --max-redirs 0 --max-time ' + CURL_MAX_TIME_SECONDS
      + ' --max-filesize ' + MAX_RESPONSE_BYTES + ' -H @- ' + (fixedHeaders ? fixedHeaders + ' ' : '')
      + '-w ' + quote(writeOut) + ' ' + quoteUrl(request.url),
    lineMarker(spec.boundary, 'curl', '"$?"'),
  ].join('; ');
}

export function buildCheckCommand(spec) {
  if (!BOUNDARY_PATTERN.test(spec.boundary)) {
    throw new Error('the boundary is not allowed');
  }
  const lockedGuard = 'found=$(timeout ' + SECRET_TOOL_TIMEOUT_SECONDS + ' ' + buildSearchPart(spec.providerId, spec.account) + ' 2>/dev/null); '
    + 'case "$found" in "(@ao [], [objectpath "*) ' + marker(spec.boundary, 'lookup', quote('locked')) + '; exit 0;; esac';
  const lookup = 'key=$(timeout ' + SECRET_TOOL_TIMEOUT_SECONDS + ' ' + buildLookupPart(spec.providerId, spec.account) + '); rc=$?';
  const lookupGuard = 'if [ "$rc" -ne 0 ]; then ' + marker(spec.boundary, 'lookup', '"$rc"') + '; exit 0; fi';
  const keyGuard = 'case "$key" in '
    + "'') " + marker(spec.boundary, 'lookup', quote('empty')) + '; exit 0;; '
    + '*[!!-~]*) ' + marker(spec.boundary, 'lookup', quote('invalid')) + '; exit 0;; esac';
  return [SAFE_START, lockedGuard, lookup, lookupGuard, keyGuard].concat(spec.requests.map((request) => curlPart(spec, request))).join('; ');
}

function lookupFailure(value, stderr) {
  if (value === 'locked') {
    return failure(ERROR_KIND.CANNOT_CONNECT, REASON.WALLET_LOCKED);
  }
  if (value === SECRET_TOOL_TIMED_OUT) {
    return failure(ERROR_KIND.CANNOT_CONNECT, REASON.SECRET_SERVICE_TIMEOUT);
  }
  if (TOOL_MISSING_CODES.indexOf(value) !== -1) {
    return failure(ERROR_KIND.CANNOT_CONNECT, REASON.TOOL_MISSING);
  }
  if (value === 'invalid') {
    return failure(ERROR_KIND.NO_KEY, REASON.KEY_FORMAT);
  }
  if (value !== 'empty' && typeof stderr === 'string' && stderr.trim() !== '') {
    return failure(ERROR_KIND.CANNOT_CONNECT, REASON.SECRET_SERVICE_UNAVAILABLE);
  }
  return failure(ERROR_KIND.NO_KEY, REASON.NO_KEY);
}

function findLine(text, prefix, from) {
  const start = text.indexOf(prefix, from);
  if (start === -1) {
    return null;
  }
  const end = text.indexOf('\n', start + prefix.length);
  return { start: start, end: end === -1 ? text.length : end, value: text.slice(start + prefix.length, end === -1 ? text.length : end) };
}

const INCOMPLETE = Object.freeze({ kind: 'incomplete' });

function replyFromCurl(curlCode, status, body, retryAfter) {
  if (curlCode === 0) {
    return { kind: 'response', status: status, body: body, header: (name) => (name.toLowerCase() === 'retry-after' && retryAfter !== '' ? retryAfter : null) };
  }
  if (CURL_TIMEOUT_CODES.indexOf(curlCode) !== -1) {
    return { kind: 'timeout' };
  }
  if (CURL_CONNECTION_CODES.indexOf(curlCode) !== -1) {
    return { kind: 'network' };
  }
  if (curlCode === CURL_TOO_LARGE_CODE) {
    return { kind: 'too_large' };
  }
  if (CURL_TOOL_MISSING_CODES.indexOf(curlCode) !== -1) {
    return { kind: 'tool_missing' };
  }
  return { kind: 'curl_error', code: curlCode };
}

function readBlock(stdout, boundary, id) {
  const beginMarker = boundary + ' begin ' + id + '\n';
  const beginAt = stdout.indexOf(beginMarker);
  if (beginAt === -1) {
    return INCOMPLETE;
  }
  const bodyStart = beginAt + beginMarker.length;
  const curlLine = findLine(stdout, '\n' + boundary + ' curl ', bodyStart - 1);
  if (curlLine === null) {
    return INCOMPLETE;
  }
  const curlCode = Number(curlLine.value);
  if (curlCode !== 0) {
    return replyFromCurl(curlCode);
  }
  const endMarker = stdout.lastIndexOf('\n' + boundary + ' end ', curlLine.start);
  if (endMarker < bodyStart - 1) {
    return INCOMPLETE;
  }
  const endLine = findLine(stdout, boundary + ' end ', endMarker + 1);
  const separator = endLine.value.indexOf(' ');
  const status = Number(separator === -1 ? endLine.value : endLine.value.slice(0, separator));
  const retryAfter = separator === -1 ? '' : endLine.value.slice(separator + 1).trim();
  return replyFromCurl(curlCode, status, stdout.slice(bodyStart, endMarker), retryAfter);
}

export function parseCheckOutput(result, requests, boundary) {
  if (!result || result.timedOut || typeof result.stdout !== 'string') {
    return { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.REQUEST_TIMEOUT) };
  }
  const lookup = findLine(result.stdout, boundary + ' lookup ', 0);
  if (lookup !== null) {
    return { ok: false, error: lookupFailure(lookup.value, result.stderr) };
  }
  return { ok: true, replies: requests.map((request) => readBlock(result.stdout, boundary, request.id)) };
}
