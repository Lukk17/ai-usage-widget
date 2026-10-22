import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchUsage } from '../../package/contents/code/core/fetchUsage.mjs';
import { commandTimeoutMs } from '../../package/contents/code/core/curlCommand.mjs';
import { ERROR_KIND, REASON, failure } from '../../package/contents/code/core/http.mjs';
import { makeUsage, usageText, LABEL, succeeded } from '../../package/contents/code/core/usage.mjs';
import { TEST_BOUNDARY, testAccount } from './support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);
const BEARER = { header: 'Authorization', prefix: 'Bearer ' };

function provider(overrides) {
  return Object.assign({
    id: 'requesty',
    auth: BEARER,
    buildRequests: () => [
      { id: 'main', url: 'https://example.invalid/main', headers: [] },
      { id: 'extra', url: 'https://example.invalid/extra', headers: [], optional: true },
    ],
    interpret: (results) => succeeded(makeUsage({ texts: [usageText(LABEL.PLAN, results.extra.error ? 'extra failed' : 'both fine')] })),
  }, overrides);
}

function block(id, status, retryAfter, curlCode) {
  return `${TEST_BOUNDARY} begin ${id}\n{}\n${TEST_BOUNDARY} end ${status} ${retryAfter || ''}\n${TEST_BOUNDARY} curl ${curlCode || 0}\n`;
}

function runner(stdout, stderr) {
  const calls = [];
  const runCommand = (command, timeoutMs) => {
    calls.push({ command, timeoutMs });
    return stdout instanceof Error ? Promise.reject(stdout) : Promise.resolve({ exitCode: 0, stdout, stderr: stderr || '' });
  };
  return { runCommand, calls };
}

function check(prov, stdout, stderr) {
  const fake = runner(stdout, stderr);
  return fetchUsage(prov, testAccount(prov, 'work'), fake.runCommand, () => NOW, TEST_BOUNDARY).then((outcome) => ({ outcome, calls: fake.calls }));
}

function steppingClock(times) {
  const queue = times.slice();
  return () => (queue.length > 1 ? queue.shift() : queue[0]);
}

test('one command reads the key once and runs every request, with a timeout that fits them all', async () => {
  const { outcome, calls } = await check(provider({}), block('main', 200) + block('extra', 200));
  assert.deepEqual(outcome, succeeded(makeUsage({ texts: [usageText(LABEL.PLAN, 'both fine')] })));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeoutMs, commandTimeoutMs(2));
  assert.equal(calls[0].command.split('secret-tool lookup').length, 2);
  assert.match(calls[0].command, /'https:\/\/example\.invalid\/main'/);
  assert.match(calls[0].command, /'https:\/\/example\.invalid\/extra'/);
});

test('a failed optional request is handed to the provider instead of failing the service', async () => {
  const { outcome } = await check(provider({}), block('main', 200) + block('extra', 500));
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.usage.texts, [usageText(LABEL.PLAN, 'extra failed')]);
});

test('a failed required request fails the service with its error', async () => {
  const { outcome } = await check(provider({}), block('main', 401) + block('extra', 200));
  assert.equal(outcome.error.kind, ERROR_KIND.KEY_REJECTED);
});

test('a redirect on a required request is an unexpected answer', async () => {
  const { outcome } = await check(provider({}), block('main', 302) + block('extra', 200));
  assert.deepEqual(outcome.error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.REDIRECT, null, { status: 302 }));
});

test('a rate limit on any request wins and uses the latest Retry-After', async () => {
  const { outcome } = await check(provider({}), block('main', 429, '60') + block('extra', 429, '300'));
  assert.equal(outcome.error.kind, ERROR_KIND.RATE_LIMITED);
  assert.equal(outcome.error.retryAt, NOW + 300000);
});

test('a rate limit on an optional request still pauses the whole service', async () => {
  const { outcome } = await check(provider({}), block('main', 200) + block('extra', 429));
  assert.equal(outcome.error.kind, ERROR_KIND.RATE_LIMITED);
  assert.equal(outcome.error.retryAt, null);
});

test('Retry-After is measured from the time the answer came back, not from the start of the check', async () => {
  const fake = runner(block('main', 429, '60') + block('extra', 200));
  const later = NOW + 40000;
  const outcome = await fetchUsage(provider({}), testAccount(provider({}), 'work'), fake.runCommand, steppingClock([NOW, later]), TEST_BOUNDARY);
  assert.equal(outcome.error.retryAt, later + 60000);
});

test('the provider reads the answer with the time it came back', async () => {
  const seen = [];
  const timed = provider({ interpret: (results, now) => { seen.push(now); return succeeded(makeUsage({})); } });
  const fake = runner(block('main', 200) + block('extra', 200));
  await fetchUsage(timed, testAccount(timed, 'work'), fake.runCommand, steppingClock([NOW, NOW + 9000]), TEST_BOUNDARY);
  assert.deepEqual(seen, [NOW + 9000]);
});

test('a missing key stops the check with no key', async () => {
  const { outcome } = await check(provider({}), `${TEST_BOUNDARY} lookup 1\n`);
  assert.deepEqual(outcome, { ok: false, error: failure(ERROR_KIND.NO_KEY, REASON.NO_KEY) });
});

test('a runner that rejects means the check could not run', async () => {
  const { outcome } = await check(provider({}), new Error('engine gone'));
  assert.deepEqual(outcome.error, failure(ERROR_KIND.CANNOT_CONNECT, REASON.COMMAND_FAILED));
});

test('a runner that timed out is a request timeout', async () => {
  const outcome = await fetchUsage(provider({}), testAccount(provider({}), 'work'), () => Promise.resolve({ timedOut: true }), () => NOW, TEST_BOUNDARY);
  assert.deepEqual(outcome.error, failure(ERROR_KIND.CANNOT_CONNECT, REASON.REQUEST_TIMEOUT));
});

test('the provider override is used to classify replies', async () => {
  const custom = provider({ classify: (r) => (r.status === 404 ? failure(ERROR_KIND.NOT_AVAILABLE, REASON.TEAM_ORGANIZATION_REQUIRED) : null) });
  const { outcome } = await check(custom, block('main', 404) + block('extra', 200));
  assert.deepEqual(outcome.error, failure(ERROR_KIND.NOT_AVAILABLE, REASON.TEAM_ORGANIZATION_REQUIRED));
});

test('a provider that throws while interpreting gives an unexpected answer', async () => {
  const broken = provider({ interpret: () => { throw new Error('bad shape'); } });
  const { outcome } = await check(broken, block('main', 200) + block('extra', 200));
  assert.deepEqual(outcome.error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL));
});

test('a provider that throws while building requests gives an unexpected answer and runs nothing', async () => {
  const broken = provider({ buildRequests: () => { throw new Error('no'); } });
  const { outcome, calls } = await check(broken, '');
  assert.deepEqual(outcome.error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL));
  assert.equal(calls.length, 0);
});

test('an unsafe account never reaches a command', async () => {
  const fake = runner('');
  const outcome = await fetchUsage(provider({}), testAccount(provider({}), 'a;id'), fake.runCommand, () => NOW, TEST_BOUNDARY);
  assert.deepEqual(outcome.error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL));
  assert.equal(fake.calls.length, 0);
});
