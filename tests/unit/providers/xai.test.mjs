import { test } from 'node:test';
import assert from 'node:assert/strict';

import { xai } from '../../../package/contents/code/providers/xai.mjs';
import { BEARER_AUTH, ACCEPT_JSON } from '../../../package/contents/code/providers/common.mjs';
import { fetchUsage } from '../../../package/contents/code/core/fetchUsage.mjs';
import { ERROR_KIND, REASON, failure } from '../../../package/contents/code/core/http.mjs';
import { LABEL, makeUsage, usageAmount, succeeded } from '../../../package/contents/code/core/usage.mjs';
import { fixtureRunner, TEST_BOUNDARY, testAccount } from '../support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);
const TEAM = '00000000-0000-4000-8000-000000000001';
const ACCOUNT = testAccount(xai, 'team', { teamId: TEAM });

function run(names) {
  const runner = fixtureRunner('xai', names, xai.buildRequests(NOW, ACCOUNT));
  return fetchUsage(xai, ACCOUNT, runner.runCommand, () => NOW, TEST_BOUNDARY);
}

test('asks the prepaid balance and the invoice preview of the team with the management key', () => {
  assert.deepEqual(xai.auth, BEARER_AUTH);
  assert.equal(xai.keyHelp, 'Management key, from the xAI Console');
  assert.deepEqual(xai.fields.map((field) => [field.id, field.label, field.typed]), [['teamId', 'Team ID', true]]);
  assert.deepEqual(xai.buildRequests(NOW, ACCOUNT), [
    { id: 'balance', url: 'https://management-api.x.ai/v1/billing/teams/' + TEAM + '/prepaid/balance', headers: [ACCEPT_JSON] },
    { id: 'invoice', url: 'https://management-api.x.ai/v1/billing/teams/' + TEAM + '/postpaid/invoice/preview', headers: [ACCEPT_JSON] },
  ]);
});

test('a team ID that is not plain never reaches a URL', () => {
  for (const teamId of ['../x', 'a b', '', undefined, 'x'.repeat(65)]) {
    assert.throws(() => xai.buildRequests(NOW, testAccount(xai, 'team', { teamId: teamId })), /team ID/, String(teamId));
  }
});

test('200 shows the prepaid balance and the month spend from the invoice lines, in dollars', async () => {
  assert.deepEqual(await run({ balance: 'balance-200', invoice: 'invoice-200' }), succeeded(makeUsage({
    amounts: [usageAmount(LABEL.BALANCE, '', 17.67, null, false), usageAmount(LABEL.SPENT_THIS_MONTH, '', 7.33, null, false)],
  })));
});

test('an invoice without lines is a spend of zero', async () => {
  assert.equal((await run({ balance: 'balance-200', invoice: 'invoice-empty-200' })).usage.amounts[1].value, 0);
});

test('a changed balance, a changed invoice line or a broken body is an unexpected answer', async () => {
  for (const names of [{ balance: 'balance-changed-200', invoice: 'invoice-200' }, { balance: 'balance-200', invoice: 'invoice-changed-200' }, { balance: 'malformed', invoice: 'invoice-200' }, { balance: 'balance-200', invoice: 'invoice-no-core-200' }]) {
    assert.deepEqual(await run(names), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED) }, JSON.stringify(names));
  }
});

test('401 means the key was rejected', async () => {
  assert.deepEqual(await run({ balance: '401', invoice: 'invoice-200' }), { ok: false, error: failure(ERROR_KIND.KEY_REJECTED, REASON.HTTP_STATUS, null, { status: 401 }) });
});

test('a timeout means cannot connect', async () => {
  assert.deepEqual(await run({ balance: 'balance-200', invoice: 'common/timeout' }), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT) });
});
