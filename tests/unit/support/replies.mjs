import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');
const CURL_TIMEOUT_CODE = 28;
const CURL_CONNECT_CODE = 7;

export const TEST_BOUNDARY = 'aiu00000000000000000000beef';

export function reply(status, body, headers = {}) {
  const lowered = {};
  for (const name of Object.keys(headers)) {
    lowered[name.toLowerCase()] = headers[name];
  }
  return {
    kind: 'response',
    status,
    body,
    header: (name) => (Object.hasOwn(lowered, name.toLowerCase()) ? lowered[name.toLowerCase()] : null),
  };
}

export function readRecorded(provider, name) {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, provider, `${name}.json`), 'utf8'));
}

function headerValue(headers, wanted) {
  const match = Object.keys(headers).filter((name) => name.toLowerCase() === wanted);
  return match.length > 0 ? headers[match[0]] : '';
}

export function curlBlock(id, recorded) {
  if (recorded.kind === 'timeout') {
    return `${TEST_BOUNDARY} begin ${id}\n\n${TEST_BOUNDARY} end 000 \n${TEST_BOUNDARY} curl ${CURL_TIMEOUT_CODE}\n`;
  }
  if (recorded.kind === 'network') {
    return `${TEST_BOUNDARY} begin ${id}\n\n${TEST_BOUNDARY} end 000 \n${TEST_BOUNDARY} curl ${CURL_CONNECT_CODE}\n`;
  }
  const body = typeof recorded.bodyText === 'string' ? recorded.bodyText : JSON.stringify(recorded.body);
  const retryAfter = headerValue(recorded.headers || {}, 'retry-after');
  return `${TEST_BOUNDARY} begin ${id}\n${body}\n${TEST_BOUNDARY} end ${recorded.status} ${retryAfter}\n${TEST_BOUNDARY} curl 0\n`;
}

export function fixtureRunner(provider, namesByRequestId, requests) {
  const calls = [];
  const runCommand = (command, timeoutMs) => {
    calls.push({ command, timeoutMs });
    const stdout = requests.map((request) => {
      const name = namesByRequestId[request.id];
      const [dir, file] = name.indexOf('/') === -1 ? [provider, name] : name.split('/');
      return curlBlock(request.id, readRecorded(dir, file));
    }).join('');
    return Promise.resolve({ exitCode: 0, stdout, stderr: '' });
  };
  return { runCommand, calls };
}

export function testAccount(provider, id, fields = {}) {
  return Object.assign({ id, service: provider && provider.id ? provider.id : 'requesty', name: `${id}@example.com` }, fields);
}
