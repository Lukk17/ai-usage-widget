import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opencodeZen, MAX_MEMBERS } from '../../../package/contents/code/providers/opencodeZen.mjs';
import { BEARER_AUTH, ACCEPT_JSON } from '../../../package/contents/code/providers/common.mjs';
import { fetchUsage } from '../../../package/contents/code/core/fetchUsage.mjs';
import { ERROR_KIND, REASON, failure } from '../../../package/contents/code/core/http.mjs';
import { LABEL, PERIOD, usageWindow, usageAmount } from '../../../package/contents/code/core/usage.mjs';
import { fixtureRunner, curlBlock, TEST_BOUNDARY, testAccount } from '../support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);

function run(name) {
  const runner = fixtureRunner('opencode-zen', { members: name }, opencodeZen.buildRequests(NOW));
  return fetchUsage(opencodeZen, testAccount(opencodeZen, 'team'), runner.runCommand, () => NOW, TEST_BOUNDARY);
}

test('asks the budgets endpoint with the service account key as a bearer token', () => {
  assert.deepEqual(opencodeZen.auth, BEARER_AUTH);
  assert.deepEqual(opencodeZen.buildRequests(NOW), [{ id: 'members', url: 'https://opencode.ai/console/api/v1/budgets/members', headers: [ACCEPT_JSON] }]);
});

test('200 converts microcents to dollars, shows the budget left of the member closest to the limit as the main number, and only the part of each email before the @', async () => {
  const outcome = await run('200');
  assert.deepEqual(outcome.usage.amounts, [
    usageAmount(LABEL.BUDGET_LEFT, '', 75.25 - 56.4375, null, false),
    usageAmount(LABEL.MEMBER_SPEND, 'bob', 1.23, null, true),
  ]);
  assert.deepEqual(outcome.usage.windows, [usageWindow(PERIOD.MONTHLY, 'alice', 75, Date.UTC(2026, 10, 1))]);
  assert.doesNotMatch(JSON.stringify(outcome.usage), /example\.com/);
});

test('an empty member list gives an empty card without an error', async () => {
  const outcome = await run('200-empty');
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.usage.amounts, []);
});

test('more than MAX_MEMBERS members are capped', async () => {
  const members = [];
  for (let index = 0; index < MAX_MEMBERS + 7; index += 1) {
    members.push({ user_id: 'u' + index, email: 'member' + index + '@example.com', limit_micro_cents: null, spent_micro_cents: '100000000', exceeded: false, resets_at: '2026-11-01T00:00:00.000Z', source: null, updated_at: null });
  }
  const runCommand = () => Promise.resolve({ exitCode: 0, stdout: curlBlock('members', { status: 200, headers: {}, body: members }), stderr: '' });
  const outcome = await fetchUsage(opencodeZen, testAccount(opencodeZen, 'team'), runCommand, () => NOW, TEST_BOUNDARY);
  assert.equal(outcome.usage.amounts.length, MAX_MEMBERS);
});

test('a changed shape, a limit that is not a decimal string or null, or a broken number is an unexpected answer', async () => {
  for (const name of ['changed-200', 'partly-changed-200', 'bad-number-200', 'limit-number-200', 'malformed']) {
    assert.deepEqual((await run(name)).error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED), name);
  }
});

test('401 means the key was rejected', async () => {
  assert.equal((await run('401')).error.kind, ERROR_KIND.KEY_REJECTED);
});

test('403 explains that the key needs All permissions', async () => {
  assert.deepEqual((await run('403')).error, failure(ERROR_KIND.KEY_REJECTED, REASON.ZEN_ALL_PERMISSIONS));
});

test('402 means the account cannot use the service', async () => {
  assert.equal((await run('402')).error.kind, ERROR_KIND.NOT_AVAILABLE);
});

test('429 is rate limited until Retry-After', async () => {
  const outcome = await run('429');
  assert.equal(outcome.error.kind, ERROR_KIND.RATE_LIMITED);
  assert.equal(outcome.error.retryAt, NOW + 90000);
});

test('502 means the service could not answer and a timeout means cannot connect', async () => {
  assert.equal((await run('502')).error.kind, ERROR_KIND.CANNOT_CONNECT);
  assert.deepEqual((await run('common/timeout')).error, failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT));
});

function runMembers(members) {
  const runCommand = () => Promise.resolve({ exitCode: 0, stdout: curlBlock('members', { status: 200, headers: {}, body: members }), stderr: '' });
  return fetchUsage(opencodeZen, testAccount(opencodeZen, 'team'), runCommand, () => NOW, TEST_BOUNDARY);
}

function member(name, limit, spent) {
  return { user_id: 'u-' + name, email: name + '@example.com', limit_micro_cents: limit, spent_micro_cents: spent, exceeded: false, resets_at: '2026-11-01T00:00:00.000Z', source: null, updated_at: null };
}

test('the main member is the one closest to its limit, the others show their budget left or their spend as additional rows', async () => {
  const outcome = await runMembers([member('low', '10000000000', '1000000000'), member('high', '10000000000', '9000000000'), member('free', null, '200000000')]);
  assert.deepEqual(outcome.usage.amounts, [
    usageAmount(LABEL.MEMBER_BUDGET_LEFT, 'low', 90, null, false),
    usageAmount(LABEL.BUDGET_LEFT, '', 10, null, false),
    usageAmount(LABEL.MEMBER_SPEND, 'free', 2, null, true),
  ]);
  assert.deepEqual(outcome.usage.windows.map((item) => [item.name, item.usedPercent]), [['low', 10], ['high', 90]]);
});

test('without any limit the main number is the spend of this month and there is no bar', async () => {
  const outcome = await runMembers([member('solo', null, '500000000')]);
  assert.deepEqual(outcome.usage.amounts, [usageAmount(LABEL.SPENT_THIS_MONTH, '', 5, null, true)]);
  assert.deepEqual(outcome.usage.windows, []);
});

test('the card shows Budget left first and the monthly bar under it', async () => {
  const { buildViewModel } = await import('../../../package/contents/code/core/formatter.mjs');
  const { createEntry, applySuccess } = await import('../../../package/contents/code/core/state.mjs');
  const outcome = await run('200');
  const section = buildViewModel([applySuccess(createEntry({ account: testAccount(opencodeZen, 'team'), title: 'OpenCode Zen', intervalMs: 300000 }), outcome.usage, NOW)], NOW).sections[0];
  assert.deepEqual(section.mainRows.map((item) => item.label + '=' + item.valueText), ['Budget left=$18.81']);
  assert.deepEqual(section.windows.map((item) => item.label + '=' + item.percentText), ['monthly=75%']);
  assert.deepEqual(section.rows.map((item) => item.label + '=' + item.valueText), ['bob=$1.23, no limit']);
});
