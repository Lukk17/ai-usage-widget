import { test } from 'node:test';
import assert from 'node:assert/strict';

import { requesty } from '../../../package/contents/code/providers/requesty.mjs';
import { BEARER_AUTH, ACCEPT_JSON } from '../../../package/contents/code/providers/common.mjs';
import { fetchUsage } from '../../../package/contents/code/core/fetchUsage.mjs';
import { ERROR_KIND, REASON, failure } from '../../../package/contents/code/core/http.mjs';
import { LABEL, PERIOD, usageWindow, usageAmount, usageAmountProblem } from '../../../package/contents/code/core/usage.mjs';
import { fixtureRunner, curlBlock, readRecorded, TEST_BOUNDARY, testAccount } from '../support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);

function run(names) {
  const runner = fixtureRunner('requesty', names, requesty.buildRequests(NOW));
  return fetchUsage(requesty, testAccount(requesty, 'work'), runner.runCommand, () => NOW, TEST_BOUNDARY);
}

test('asks for the key itself and, optionally, for the organization, with a bearer key and fixed headers', () => {
  assert.deepEqual(requesty.auth, BEARER_AUTH);
  assert.deepEqual(requesty.buildRequests(NOW), [
    { id: 'key', url: 'https://api-v2.requesty.ai/v1/manage/apikey/self', headers: [ACCEPT_JSON] },
    { id: 'org', url: 'https://api-v2.requesty.ai/v1/manage/org', headers: [ACCEPT_JSON], optional: true },
  ]);
});

test('200 shows the monthly spend against the key limit and the organization balance', async () => {
  const outcome = await run({ key: 'apikey-self-200', org: 'org-200' });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.usage.windows.length, 1);
  assert.equal(outcome.usage.windows[0].period, PERIOD.MONTHLY);
  assert.ok(Math.abs(outcome.usage.windows[0].usedPercent - 24.6912) < 1e-9);
  assert.deepEqual(outcome.usage.amounts, [
    usageAmount(LABEL.SPENT_THIS_MONTH, '', 12.3456, 50, false),
    usageAmount(LABEL.BALANCE, '', 87.65, null, false),
  ]);
});

test('a limit of 0 means no limit, and a key without manage permission keeps the Balance row with the reason', async () => {
  const outcome = await run({ key: 'apikey-self-unlimited-200', org: 'org-403' });
  assert.deepEqual(outcome.usage.windows, []);
  assert.deepEqual(outcome.usage.amounts, [
    usageAmount(LABEL.SPENT_THIS_MONTH, '', 3.5, null, true),
    usageAmountProblem(LABEL.BALANCE, failure(ERROR_KIND.NOT_AVAILABLE, REASON.BALANCE_NEEDS_MANAGE)),
  ]);
});

test('a 401 on the organization also says the balance needs manage permission', async () => {
  const outcome = await run({ key: 'apikey-self-200', org: '401' });
  assert.deepEqual(outcome.usage.amounts[1], usageAmountProblem(LABEL.BALANCE, failure(ERROR_KIND.NOT_AVAILABLE, REASON.BALANCE_NEEDS_MANAGE)));
});

test('the balance is read from every number form Requesty may send', async () => {
  const cases = [[87.65, 87.65], [-12.5, -12.5], ['87.65', 87.65], ['-3', -3], [1e-5, 1e-5], ['1e-5', 1e-5], ['2.5E+3', 2500], [0, 0]];
  for (const [balance, expected] of cases) {
    const runCommand = () => Promise.resolve({ exitCode: 0, stdout: curlBlock('key', readRecorded('requesty', 'apikey-self-200')) + curlBlock('org', { status: 200, headers: {}, body: { balance: balance } }), stderr: '' });
    const outcome = await fetchUsage(requesty, testAccount(requesty, 'work'), runCommand, () => NOW, TEST_BOUNDARY);
    assert.deepEqual(outcome.usage.amounts[1], usageAmount(LABEL.BALANCE, '', expected, null, false), String(balance));
  }
});

test('a balance that is not a number keeps the row and says the format changed', async () => {
  for (const balance of ['lots', null, '1e', true, '9'.repeat(400)]) {
    const runCommand = () => Promise.resolve({ exitCode: 0, stdout: curlBlock('key', readRecorded('requesty', 'apikey-self-200')) + curlBlock('org', { status: 200, headers: {}, body: { balance: balance } }), stderr: '' });
    const outcome = await fetchUsage(requesty, testAccount(requesty, 'work'), runCommand, () => NOW, TEST_BOUNDARY);
    assert.deepEqual(outcome.usage.amounts[1], usageAmountProblem(LABEL.BALANCE, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED)), String(balance));
  }
});

test('a limit of null also means no limit', async () => {
  const outcome = await run({ key: 'apikey-self-null-limit-200', org: 'org-403' });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.usage.amounts[0], usageAmount(LABEL.SPENT_THIS_MONTH, '', 7.25, null, true));
  assert.deepEqual(outcome.usage.windows, []);
});

test('a broken or timed out organization answer keeps the card and puts the reason in the Balance row', async () => {
  const expected = {
    malformed: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED),
    'common/timeout': failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT),
    '500': failure(ERROR_KIND.CANNOT_CONNECT, REASON.SERVICE_ERROR, null, { status: 500 }),
    '402': failure(ERROR_KIND.NOT_AVAILABLE, REASON.BALANCE_EXHAUSTED),
  };
  for (const org of Object.keys(expected)) {
    const outcome = await run({ key: 'apikey-self-200', org: org });
    assert.equal(outcome.ok, true, org);
    assert.deepEqual(outcome.usage.amounts.map((item) => item.label), [LABEL.SPENT_THIS_MONTH, LABEL.BALANCE], org);
    assert.deepEqual(outcome.usage.amounts[1].problem, expected[org], org);
  }
});

test('the key help asks for a key with manage permission', () => {
  assert.equal(requesty.keyHelp, 'API key with manage permission, from the Requesty dashboard');
});

test('401 and 403 on the key mean the key was rejected', async () => {
  for (const name of ['401', '403']) {
    assert.equal((await run({ key: name, org: name })).error.kind, ERROR_KIND.KEY_REJECTED, name);
  }
});

test('402 means the organization balance is exhausted', async () => {
  assert.deepEqual((await run({ key: '402', org: '402' })).error, failure(ERROR_KIND.NOT_AVAILABLE, REASON.BALANCE_EXHAUSTED));
});

test('a redirect is not followed and is an unexpected answer', async () => {
  assert.deepEqual((await run({ key: 'redirect-302', org: 'org-200' })).error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.REDIRECT, null, { status: 302 }));
});

test('429 is rate limited until Retry-After', async () => {
  const outcome = await run({ key: '429', org: 'org-200' });
  assert.equal(outcome.error.kind, ERROR_KIND.RATE_LIMITED);
  assert.equal(outcome.error.retryAt, NOW + 120000);
});

test('500 means the service could not answer, and 503 keeps its Retry-After', async () => {
  assert.equal((await run({ key: '500', org: '500' })).error.kind, ERROR_KIND.CANNOT_CONNECT);
  const outcome = await run({ key: '503-retry-after', org: 'org-200' });
  assert.equal(outcome.error.kind, ERROR_KIND.CANNOT_CONNECT);
  assert.equal(outcome.error.retryAt, NOW + 900000);
});

test('a timeout means cannot connect', async () => {
  assert.deepEqual((await run({ key: 'common/timeout', org: 'org-200' })).error, failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT));
});

test('a lost connection means cannot connect with the no connection reason', async () => {
  assert.deepEqual((await run({ key: 'common/network', org: 'common/network' })).error, failure(ERROR_KIND.CANNOT_CONNECT, REASON.NO_CONNECTION));
});

test('a malformed or changed body is an unexpected answer', async () => {
  for (const name of ['malformed', 'apikey-self-changed-200']) {
    assert.deepEqual((await run({ key: name, org: 'org-200' })).error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED), name);
  }
});

test('a monthly limit window is built with the shared window helper', async () => {
  const outcome = await run({ key: 'apikey-self-200', org: 'org-200' });
  assert.deepEqual(outcome.usage.windows[0], usageWindow(PERIOD.MONTHLY, '', outcome.usage.windows[0].usedPercent, null));
});
