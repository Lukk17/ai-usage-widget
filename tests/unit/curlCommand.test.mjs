import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, symlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SECRET_TOOL_TIMEOUT_SECONDS,
  CURL_MAX_TIME_SECONDS,
  CURL_KILL_AFTER_SECONDS,
  MAX_RESPONSE_BYTES,
  BOUNDARY_PATTERN,
  commandTimeoutMs,
  buildCheckCommand,
  parseCheckOutput,
} from '../../package/contents/code/core/curlCommand.mjs';
import { ERROR_KIND, REASON, failure } from '../../package/contents/code/core/http.mjs';
import { ALL_PROVIDERS } from '../../package/contents/code/providers/registry.mjs';
import { KIND } from '../../package/contents/code/core/providerKind.mjs';
import { MINUTE_MS, DAY_MS } from '../../package/contents/code/core/units.mjs';
import { testAccount } from './support/replies.mjs';

const BOUNDARY = 'aiu0123456789abcdef01234567';
const BEARER = { header: 'Authorization', prefix: 'Bearer ' };
const FAKE_KEY = 'sk-fake-key-for-tests';
const REQUESTS = [
  { id: 'key', url: 'https://api-v2.requesty.ai/v1/manage/apikey/self', headers: ['Accept: application/json'] },
  { id: 'org', url: 'https://api-v2.requesty.ai/v1/manage/org', headers: ['Accept: application/json'] },
];

function spec(overrides) {
  return Object.assign({ providerId: 'requesty', account: 'work', auth: BEARER, requests: REQUESTS }, overrides);
}

function finishedBlock(id, body, status, retryAfter, curlCode) {
  return BOUNDARY + ' begin ' + id + '\n' + body + '\n' + BOUNDARY + ' end ' + status + ' ' + (retryAfter || '') + '\n\n' + BOUNDARY + ' curl ' + curlCode + '\n';
}

function killedBlock(id, partialBody, curlCode) {
  return BOUNDARY + ' begin ' + id + '\n' + partialBody + '\n' + BOUNDARY + ' curl ' + curlCode + '\n';
}

function parse(stdout, requests) {
  return parseCheckOutput({ exitCode: 0, stdout: BOUNDARY + '\n' + stdout, stderr: '' }, requests || [REQUESTS[0]]);
}

const COMMAND_FAILED = { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.COMMAND_FAILED) };

test('the limits are named and the request size limit is 1 MiB', () => {
  assert.equal(MAX_RESPONSE_BYTES, 1048576);
  assert.ok(CURL_KILL_AFTER_SECONDS > CURL_MAX_TIME_SECONDS);
  assert.equal(commandTimeoutMs(2), (2 * SECRET_TOOL_TIMEOUT_SECONDS + 2 * CURL_KILL_AFTER_SECONDS + 5) * 1000);
});

test('the command text is the same every time for the same spec and holds no boundary', () => {
  const first = buildCheckCommand(spec({}));
  assert.equal(buildCheckCommand(spec({})), first);
  assert.doesNotMatch(first, /aiu[0-9a-f]/);
});

test('for every remote service the command for one account stays the same within a month', () => {
  const start = Date.UTC(2026, 10, 3, 12);
  ALL_PROVIDERS.filter((provider) => provider.kind === KIND.REMOTE).forEach((provider) => {
    const account = testAccount(provider, 'default', { teamId: '65c1e471-205f-4566-9c5a-07198bcdf4ce' });
    const commandAt = (now) => buildCheckCommand({ providerId: provider.id, account: account.id, auth: provider.auth, requests: provider.buildRequests(now, account) });
    assert.equal(commandAt(start + MINUTE_MS), commandAt(start), provider.id);
    assert.equal(commandAt(start + 6 * DAY_MS), commandAt(start), provider.id);
  });
});

test('the shell makes the boundary from /dev/urandom, stops when it is not 24 hex digits, and prints it first', () => {
  const command = buildCheckCommand(spec({}));
  const start = 'ulimit -c 0; set +a +x +v; unset SSLKEYLOGFILE key rc found boundary; '
    + "boundary=aiu$(od -An -N12 -tx1 /dev/urandom | tr -d ' \\n'); "
    + 'if [ "${#boundary}" -ne 27 ]; then exit 1; fi; '
    + 'case "${boundary#aiu}" in *[!0-9a-f]*) exit 1;; esac; '
    + "printf '%s\\n' \"$boundary\"; found=$(";
  assert.ok(command.startsWith(start), command.slice(0, 260));
});

test('every marker uses the boundary from the shell variable', () => {
  const command = buildCheckCommand(spec({}));
  assert.match(command, /printf '%s begin %s\\n' "\$boundary" 'key'; /);
  assert.match(command, /printf '\\n%s curl %s\\n' "\$boundary" "\$\?"/);
  assert.match(command, /printf '%s lookup %s\\n' "\$boundary" 'locked'/);
  assert.match(command, /printf '%s lookup %s\\n' "\$boundary" "\$rc"/);
  assert.match(command, / -w "\\n\$boundary end %\{http_code\} %header\{retry-after\}\\n" 'https:/);
});

test('the command turns off core dumps, tracing and export first, and drops SSLKEYLOGFILE and any inherited key, rc, found or boundary', () => {
  const command = buildCheckCommand(spec({}));
  assert.ok(command.startsWith('ulimit -c 0; set +a +x +v; unset SSLKEYLOGFILE key rc found boundary; '), command.slice(0, 80));
});

test('the command reads the key with secret-tool inside timeout and pipes it to curl on stdin with a constant printf format', () => {
  const command = buildCheckCommand(spec({}));
  assert.match(command, /key=\$\(timeout 10 secret-tool lookup server 'ai-usage' user 'requesty\.work' type 'plaintext'\); rc=\$\?/);
  assert.match(command, /found=\$\(timeout 10 gdbus call --session --dest org\.freedesktop\.secrets --object-path \/org\/freedesktop\/secrets --method org\.freedesktop\.Secret\.Service\.SearchItems "\{'server': 'ai-usage', 'user': 'requesty\.work', 'type': 'plaintext'\}" 2>\/dev\/null\); case "\$found" in/);
  assert.match(command, /printf '%s: %s%s\\n' 'Authorization' 'Bearer ' "\$key" \| timeout 25 curl /);
  assert.match(command, / -H @- /);
});

test('curl refuses anything but HTTPS with TLS 1.2 or later, never follows redirects, does not expand globs and limits time and size', () => {
  const command = buildCheckCommand(spec({}));
  assert.match(command, /curl --disable --silent --show-error --globoff --tlsv1\.2 --proto '=https' --max-redirs 0 --max-time 20 --max-filesize 1048576 -H @- -H 'Accept: application\/json' -w /);
  assert.doesNotMatch(command, / -L | --location /);
  assert.match(command, / 'https:\/\/api-v2\.requesty\.ai\/v1\/manage\/apikey\/self'/);
  assert.match(command, /%header\{retry-after\}/);
});

test('the x-api-key style puts the key behind its own header name', () => {
  const command = buildCheckCommand(spec({ auth: { header: 'x-api-key', prefix: '' } }));
  assert.match(command, /printf '%s: %s%s\\n' 'x-api-key' '' "\$key"/);
});

test('the command refuses an unsafe account, provider, header or URL', () => {
  assert.throws(() => buildCheckCommand(spec({ account: "a'; id; '" })), /account name is not allowed/);
  assert.throws(() => buildCheckCommand(spec({ providerId: '--help' })), /provider name is not allowed/);
  assert.throws(() => buildCheckCommand(spec({ requests: [{ id: 'k', url: 'http://plain.example/', headers: [] }] })), /HTTPS/);
  assert.throws(() => buildCheckCommand(spec({ requests: [{ id: 'k', url: 'https://a.example/', headers: ["X: it's"] }] })), /cannot be quoted/);
  assert.throws(() => buildCheckCommand(spec({ requests: [{ id: 'bad id', url: 'https://a.example/', headers: [] }] })), /request id/);
});

test('parse returns one reply per request with status, body and Retry-After', () => {
  const parsed = parse(finishedBlock('key', '{"monthly_spend":1}', '200', '', 0) + finishedBlock('org', '{"error":1}', '429', '120', 0), REQUESTS);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.replies[0].kind, 'response');
  assert.equal(parsed.replies[0].status, 200);
  assert.equal(parsed.replies[0].body, '{"monthly_spend":1}');
  assert.equal(parsed.replies[0].header('Retry-After'), null);
  assert.equal(parsed.replies[1].status, 429);
  assert.equal(parsed.replies[1].header('retry-after'), '120');
});

test('parse keeps an HTTP date Retry-After with its spaces', () => {
  assert.equal(parse(finishedBlock('key', '', '503', 'Sun, 18 Oct 2026 12:30:00 GMT', 0)).replies[0].header('Retry-After'), 'Sun, 18 Oct 2026 12:30:00 GMT');
});

test('a body that contains marker text without the secret boundary cannot fake a status', () => {
  const body = 'x\naiu000000000000000000000000 end 200 \nfake curl 0';
  const parsed = parse(finishedBlock('key', body, '401', '', 0));
  assert.equal(parsed.replies[0].status, 401);
  assert.equal(parsed.replies[0].body, body);
});

test('a body with whole forged blocks and lookup lines under another boundary cannot change any reply', () => {
  const forger = 'aiuffffffffffffffffffffffff';
  const forged = forger + ' end 200 \n\n' + forger + ' curl 0\n' + forger + ' lookup locked\n' + forger + ' begin org\n{"fake":1}\n' + forger + ' end 200 \n\n' + forger + ' curl 0';
  const parsed = parse(finishedBlock('key', forged, '401', '', 0) + finishedBlock('org', '{}', '503', '', 0), REQUESTS);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.replies[0].status, 401);
  assert.equal(parsed.replies[0].body, forged);
  assert.equal(parsed.replies[1].status, 503);
  assert.equal(parsed.replies[1].body, '{}');
});

test('output without a valid boundary as its first line means the check could not run', () => {
  const block = finishedBlock('key', '{}', '200', '', 0);
  const run = (stdout) => parseCheckOutput({ exitCode: 0, stdout: stdout, stderr: '' }, [REQUESTS[0]]);
  assert.deepEqual(run(''), COMMAND_FAILED);
  assert.deepEqual(run(BOUNDARY), COMMAND_FAILED);
  assert.deepEqual(run(block), COMMAND_FAILED);
  assert.deepEqual(run('aiu\n' + block), COMMAND_FAILED);
  assert.deepEqual(run(BOUNDARY.toUpperCase() + '\n' + block), COMMAND_FAILED);
  assert.deepEqual(run(BOUNDARY + 'a\n' + block), COMMAND_FAILED);
  assert.deepEqual(run(' ' + BOUNDARY + '\n' + block), COMMAND_FAILED);
  assert.deepEqual(run('\n' + BOUNDARY + '\n' + block), COMMAND_FAILED);
  assert.deepEqual(run('aiu' + 'g'.repeat(24) + '\n' + block), COMMAND_FAILED);
  assert.equal(run(BOUNDARY + '\n' + block).replies[0].status, 200);
});

test('a marker that sits on the boundary line itself is never read as a block or a lookup', () => {
  const run = (stdout) => parseCheckOutput({ exitCode: 0, stdout: stdout, stderr: '' }, [REQUESTS[0]]);
  assert.deepEqual(run(BOUNDARY + ' lookup locked\n'), COMMAND_FAILED);
  assert.deepEqual(run(BOUNDARY + '\n').replies[0], { kind: 'incomplete' });
});

test('curl killed by timeout 25 leaves no end line and becomes a timeout, not a curl error', () => {
  assert.deepEqual(parse(killedBlock('key', '{"partial":', 124)).replies[0], { kind: 'timeout' });
});

test('curl failures that still print the end line become timeout, lost connection or too large', () => {
  const cases = [[28, 'timeout'], [6, 'network'], [7, 'network'], [63, 'too_large']];
  for (const [code, kind] of cases) {
    assert.equal(parse(finishedBlock('key', '', '000', '', code)).replies[0].kind, kind, String(code));
  }
});

test('another curl exit code is a curl error that keeps the code', () => {
  assert.deepEqual(parse(finishedBlock('key', '', '000', '', 35)).replies[0], { kind: 'curl_error', code: 35 });
});

test('a missing curl or timeout program becomes tool missing', () => {
  for (const code of [126, 127]) {
    assert.deepEqual(parse(killedBlock('key', '', code)).replies[0], { kind: 'tool_missing' }, String(code));
  }
});

test('a block cut off after its begin line, a block without its end line, or a missing block is incomplete', () => {
  assert.deepEqual(parse(BOUNDARY + ' begin key\n{"partial":').replies[0], { kind: 'incomplete' });
  assert.deepEqual(parse(BOUNDARY + ' begin key\n{}\n\n' + BOUNDARY + ' curl 0\n').replies[0], { kind: 'incomplete' });
  assert.deepEqual(parse(finishedBlock('key', '{}', '200', '', 0), REQUESTS).replies[1], { kind: 'incomplete' });
});

test('the end line of the next request is never used for an earlier one', () => {
  const stdout = BOUNDARY + ' begin key\n{}\n\n' + BOUNDARY + ' curl 0\n' + finishedBlock('org', '{}', '200', '', 0);
  const parsed = parse(stdout, REQUESTS);
  assert.deepEqual(parsed.replies[0], { kind: 'incomplete' });
  assert.equal(parsed.replies[1].status, 200);
});

test('a failed key lookup becomes no key, a Secret Service timeout, a missing tool or an unavailable Secret Service', () => {
  const lookup = (value, stderr) => parseCheckOutput({ exitCode: 0, stdout: BOUNDARY + '\n' + BOUNDARY + ' lookup ' + value + '\n', stderr: stderr || '' }, REQUESTS);
  assert.deepEqual(lookup('1'), { ok: false, error: failure(ERROR_KIND.NO_KEY, REASON.NO_KEY) });
  assert.deepEqual(lookup('empty'), { ok: false, error: failure(ERROR_KIND.NO_KEY, REASON.NO_KEY) });
  assert.deepEqual(lookup('invalid'), { ok: false, error: failure(ERROR_KIND.NO_KEY, REASON.KEY_FORMAT) });
  assert.deepEqual(lookup('124'), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.SECRET_SERVICE_TIMEOUT) });
  assert.deepEqual(lookup('126', 'timeout: secret-tool: Permission denied\n'), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.TOOL_MISSING) });
  assert.deepEqual(lookup('127', 'timeout: failed to run command secret-tool\n'), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.TOOL_MISSING) });
  assert.deepEqual(lookup('1', 'secret-tool: Cannot spawn a message bus\n'), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.SECRET_SERVICE_UNAVAILABLE) });
  assert.deepEqual(lookup('locked'), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.WALLET_LOCKED) });
});

test('a command that timed out in the runner, or gave no result, is a request timeout', () => {
  assert.deepEqual(parseCheckOutput({ timedOut: true }, REQUESTS), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.REQUEST_TIMEOUT) });
  assert.deepEqual(parseCheckOutput(null, REQUESTS), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.REQUEST_TIMEOUT) });
});

function fakeTools(secret, secretExit, search) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-usage-fake-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', [bin]);
  writeFileSync(join(dir, 'secret'), secret);
  writeFileSync(join(bin, 'secret-tool'), [
    '#!/bin/sh',
    'printf "%s\\n" "$1" >> "$FAKE_DIR/secret-tool-calls"',
    'cat "$FAKE_DIR/secret"',
    'exit "$FAKE_SECRET_EXIT"',
    '',
  ].join('\n'));
  writeFileSync(join(bin, 'curl'), [
    '#!/bin/sh',
    'printf "%s\\n" "$@" > "$FAKE_DIR/argv"',
    'env > "$FAKE_DIR/env"',
    'cat > "$FAKE_DIR/stdin"',
    'format=""',
    'while [ $# -gt 0 ]; do if [ "$1" = "-w" ]; then format="$2"; fi; shift; done',
    'printf "%s" "{\\"ok\\":true}"',
    'printf "$(printf "%s" "$format" | sed "s/%{http_code}/200/; s/%header{retry-after}//")"',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'search'), search === undefined ? "([objectpath '/org/freedesktop/secrets/collection/login/1'], @ao [])" : search);
  writeFileSync(join(bin, 'gdbus'), [
    '#!/bin/sh',
    'printf "%s\\n" "$@" > "$FAKE_DIR/gdbus-argv"',
    'cat "$FAKE_DIR/search"',
    'printf "\\n"',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'gdbus'), 0o755);
  chmodSync(join(bin, 'secret-tool'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
  const resolved = execFileSync('sh', ['-c', 'command -v secret-tool; command -v curl'], { env: { PATH: bin + ':' + process.env.PATH }, encoding: 'utf8' });
  assert.equal(resolved, join(bin, 'secret-tool') + '\n' + join(bin, 'curl') + '\n', 'the fakes resolve before the real tools');
  return { dir: dir, bin: bin, env: { PATH: bin + ':' + process.env.PATH, FAKE_DIR: dir, FAKE_SECRET_EXIT: String(secretExit) } };
}

function writeTool(bin, name, lines) {
  writeFileSync(join(bin, name), ['#!/bin/sh'].concat(lines, ['']).join('\n'));
  chmodSync(join(bin, name), 0o755);
}

function onlyTheseSystemTools(fake, names) {
  const system = join(fake.dir, 'system');
  mkdirSync(system);
  names.forEach((name) => {
    const real = execFileSync('sh', ['-c', 'command -v "$1"', 'sh', name], { encoding: 'utf8' }).trim();
    symlinkSync(real, join(system, name));
  });
  return Object.assign({}, fake.env, { PATH: fake.bin + ':' + system });
}

function firstLine(stdout) {
  return stdout.slice(0, stdout.indexOf('\n'));
}

function runShell(shell, command, env) {
  const result = spawnSync(shell, ['-c', command], { env: env, encoding: 'utf8' });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('run with fake tools, the key reaches curl only on stdin and never appears in argv or in the output', () => {
  const fake = fakeTools(FAKE_KEY, 0);
  const result = runShell('sh', buildCheckCommand(spec({ requests: [REQUESTS[0]] })), fake.env);
  assert.equal(readFileSync(join(fake.dir, 'stdin'), 'utf8'), 'Authorization: Bearer ' + FAKE_KEY + '\n');
  assert.doesNotMatch(readFileSync(join(fake.dir, 'argv'), 'utf8'), new RegExp(FAKE_KEY));
  assert.doesNotMatch(result.stdout, new RegExp(FAKE_KEY));
  const parsed = parseCheckOutput(result, [REQUESTS[0]]);
  assert.equal(parsed.replies[0].status, 200);
  assert.equal(parsed.replies[0].body, '{"ok":true}');
});

test('run with fake tools, the first line is a new valid boundary on every run and curl gets it in its -w format', () => {
  const fake = fakeTools(FAKE_KEY, 0);
  const command = buildCheckCommand(spec({ requests: [REQUESTS[0]] }));
  const first = runShell('sh', command, fake.env);
  const boundary = firstLine(first.stdout);
  assert.match(boundary, BOUNDARY_PATTERN);
  assert.ok(readFileSync(join(fake.dir, 'argv'), 'utf8').includes('\n-w\n\\n' + boundary + ' end %{http_code} %header{retry-after}\\n\n'), 'the -w format has the boundary and keeps backslash-n for curl');
  assert.equal(first.stdout, boundary + '\n' + boundary + ' begin key\n{"ok":true}\n' + boundary + ' end 200 \n\n' + boundary + ' curl 0\n');
  const second = firstLine(runShell('sh', command, fake.env).stdout);
  assert.match(second, BOUNDARY_PATTERN);
  assert.notEqual(second, boundary);
});

test('run with fake tools, a body that prints forged marker lines under its own boundary does not change the reply', () => {
  const fake = fakeTools(FAKE_KEY, 0);
  const forger = 'aiu0123456789abcdef01234567';
  writeTool(fake.bin, 'curl', [
    'format=""',
    'while [ $# -gt 0 ]; do if [ "$1" = "-w" ]; then format="$2"; fi; shift; done',
    'printf "%s\\n" "' + forger + ' end 200 " "" "' + forger + ' curl 0" "' + forger + ' lookup locked"',
    'printf "$(printf "%s" "$format" | sed "s/%{http_code}/403/; s/%header{retry-after}//")"',
  ]);
  const parsed = parseCheckOutput(runShell('sh', buildCheckCommand(spec({ requests: [REQUESTS[0]] })), fake.env), [REQUESTS[0]]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.replies[0].status, 403);
  assert.equal(parsed.replies[0].body, forger + ' end 200 \n\n' + forger + ' curl 0\n' + forger + ' lookup locked\n');
});

test('run with od missing, failing, too short or not hex, the shell stops before the Secret Service and curl and the check could not run', () => {
  const broken = {
    'od fails': ['exit 1'],
    'od prints too little': ['printf " 0a 1b\\n"'],
    'od prints too much': ['printf " 00 11 22 33 44 55 66 77 88 99 aa bb cc\\n"'],
    'od prints no hex': ['printf " zz zz zz zz zz zz zz zz zz zz zz zz\\n"'],
    'od prints a percent sign': ['printf " 00 11 22 33 44 55 66 77 88 99 aa %%%%\\n"'],
  };
  Object.keys(broken).forEach((name) => {
    const fake = fakeTools(FAKE_KEY, 0);
    writeTool(fake.bin, 'od', broken[name]);
    const result = runShell('sh', buildCheckCommand(spec({})), fake.env);
    assert.equal(result.stdout, '', name);
    assert.deepEqual(parseCheckOutput(result, REQUESTS), COMMAND_FAILED, name);
    assert.equal(existsSync(join(fake.dir, 'gdbus-argv')), false, name);
    assert.equal(existsSync(join(fake.dir, 'secret-tool-calls')), false, name);
    assert.equal(existsSync(join(fake.dir, 'argv')), false, name);
  });
  const missing = fakeTools(FAKE_KEY, 0);
  const env = onlyTheseSystemTools(missing, ['sh', 'tr', 'timeout', 'cat']);
  const resolved = spawnSync('sh', ['-c', 'command -v od'], { env: env, encoding: 'utf8' });
  assert.notEqual(resolved.status, 0, 'od must not resolve for this test: ' + resolved.stdout);
  const result = runShell('sh', buildCheckCommand(spec({})), env);
  assert.deepEqual(parseCheckOutput(result, REQUESTS), COMMAND_FAILED);
  assert.equal(existsSync(join(missing.dir, 'gdbus-argv')), false);
  assert.equal(existsSync(join(missing.dir, 'secret-tool-calls')), false);
});

test('run with fake tools in bash with xtrace and allexport on and SSLKEYLOGFILE set, the key stays out of stderr and out of the curl environment', () => {
  const fake = fakeTools(FAKE_KEY, 0);
  const env = Object.assign({}, fake.env, { SHELLOPTS: 'xtrace:allexport', SSLKEYLOGFILE: join(fake.dir, 'tls-keys.log') });
  const result = runShell('bash', buildCheckCommand(spec({ requests: [REQUESTS[0]] })), env);
  assert.match(result.stderr, /\+ ulimit -c 0/, 'xtrace really was on at the start');
  assert.doesNotMatch(result.stderr, new RegExp(FAKE_KEY));
  const curlEnvironment = readFileSync(join(fake.dir, 'env'), 'utf8');
  assert.doesNotMatch(curlEnvironment, new RegExp(FAKE_KEY));
  assert.doesNotMatch(curlEnvironment, /SSLKEYLOGFILE/);
  assert.equal(parseCheckOutput(result, [REQUESTS[0]]).replies[0].status, 200);
});

test('run with fake tools, a backslash in the header prefix passes through literally', () => {
  const fake = fakeTools(FAKE_KEY, 0);
  runShell('sh', buildCheckCommand(spec({ auth: { header: 'X-Test', prefix: 'a\\nb ' }, requests: [REQUESTS[0]] })), fake.env);
  assert.equal(readFileSync(join(fake.dir, 'stdin'), 'utf8'), 'X-Test: a\\nb ' + FAKE_KEY + '\n');
});

test('run with fake tools, a locked item in SearchItems stops before the lookup, so no unlock prompt opens, and before curl runs', () => {
  const fake = fakeTools(FAKE_KEY, 0, "(@ao [], [objectpath '/org/freedesktop/secrets/collection/login/1'])");
  const parsed = parseCheckOutput(runShell('sh', buildCheckCommand(spec({})), fake.env), REQUESTS);
  assert.deepEqual(parsed.error, failure(ERROR_KIND.CANNOT_CONNECT, REASON.WALLET_LOCKED));
  assert.equal(existsSync(join(fake.dir, 'secret-tool-calls')), false);
  assert.equal(existsSync(join(fake.dir, 'argv')), false);
  assert.equal(readFileSync(join(fake.dir, 'gdbus-argv'), 'utf8'), "call\n--session\n--dest\norg.freedesktop.secrets\n--object-path\n/org/freedesktop/secrets\n--method\norg.freedesktop.Secret.Service.SearchItems\n{'server': 'ai-usage', 'user': 'requesty.work', 'type': 'plaintext'}\n");
});

test('run with fake tools, an unlocked item, no item or a failed gdbus go on to the lookup, also when a locked copy sits next to an unlocked one', () => {
  const answers = ["([objectpath '/x/1'], @ao [])", '(@ao [], @ao [])', '', 'Error: something'];
  answers.forEach((answer) => {
    const fake = fakeTools(FAKE_KEY, 0, answer);
    runShell('sh', buildCheckCommand(spec({ requests: [REQUESTS[0]] })), fake.env);
    assert.equal(readFileSync(join(fake.dir, 'secret-tool-calls'), 'utf8'), 'lookup\n', answer);
  });
  const both = fakeTools(FAKE_KEY, 0, "([objectpath '/x/1'], [objectpath '/x/2'])");
  runShell('sh', buildCheckCommand(spec({ requests: [REQUESTS[0]] })), both.env);
  assert.equal(readFileSync(join(both.dir, 'secret-tool-calls'), 'utf8'), 'lookup\n');
});

test('run with fake tools, a missing key stops before curl runs', () => {
  const fake = fakeTools('', 1);
  const parsed = parseCheckOutput(runShell('sh', buildCheckCommand(spec({})), fake.env), REQUESTS);
  assert.equal(parsed.error.kind, ERROR_KIND.NO_KEY);
  assert.equal(existsSync(join(fake.dir, 'argv')), false);
});

test('run with fake tools, a key with a space or a newline inside stops before curl runs', () => {
  for (const secret of ['two words', 'line\nInjected: yes']) {
    const fake = fakeTools(secret, 0);
    const parsed = parseCheckOutput(runShell('sh', buildCheckCommand(spec({})), fake.env), REQUESTS);
    assert.deepEqual(parsed.error, failure(ERROR_KIND.NO_KEY, REASON.KEY_FORMAT), JSON.stringify(secret));
    assert.equal(existsSync(join(fake.dir, 'argv')), false);
  }
});

test('run without curl on the PATH, the check reports a missing tool', () => {
  const fake = fakeTools(FAKE_KEY, 0);
  execFileSync('rm', [join(fake.dir, 'bin', 'curl')]);
  const env = onlyTheseSystemTools(fake, ['sh', 'od', 'tr', 'timeout', 'cat']);
  const resolved = spawnSync('sh', ['-c', 'command -v curl'], { env: env, encoding: 'utf8' });
  assert.notEqual(resolved.status, 0, 'curl must not resolve for this test: ' + resolved.stdout);
  const parsed = parseCheckOutput(runShell('sh', buildCheckCommand(spec({ requests: [REQUESTS[0]] })), env), [REQUESTS[0]]);
  assert.deepEqual(parsed.replies[0], { kind: 'tool_missing' });
});
