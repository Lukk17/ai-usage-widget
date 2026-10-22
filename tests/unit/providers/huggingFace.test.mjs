import { test } from 'node:test';
import assert from 'node:assert/strict';

import { huggingFace, PRO_INCLUDED_CREDITS_USD } from '../../../package/contents/code/providers/huggingFace.mjs';
import { BEARER_AUTH, ACCEPT_JSON } from '../../../package/contents/code/providers/common.mjs';
import { fetchUsage } from '../../../package/contents/code/core/fetchUsage.mjs';
import { ERROR_KIND, REASON, failure } from '../../../package/contents/code/core/http.mjs';
import { LABEL, makeUsage, usageAmount, usageText, succeeded } from '../../../package/contents/code/core/usage.mjs';
import { fixtureRunner, curlBlock, readRecorded, TEST_BOUNDARY, testAccount } from '../support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);

function run(names) {
  const runner = fixtureRunner('huggingface', names, huggingFace.buildRequests(NOW));
  return fetchUsage(huggingFace, testAccount(huggingFace, 'me'), runner.runCommand, () => NOW, TEST_BOUNDARY);
}

function missing(field) {
  return { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.FIELD_MISSING, null, { field: field }) };
}

test('asks who the token belongs to and the inference spend since the start of the UTC month', () => {
  assert.deepEqual(huggingFace.auth, BEARER_AUTH);
  assert.equal(huggingFace.keyHelp, 'Fine-grained access token with billing read permission, from Hugging Face settings');
  assert.deepEqual(huggingFace.buildRequests(NOW), [
    { id: 'whoami', url: 'https://huggingface.co/api/whoami-v2', headers: [ACCEPT_JSON] },
    { id: 'usage', url: 'https://huggingface.co/api/settings/billing/usage-by-inference-session?startDate=2026-10-01T00%3A00%3A00.000Z', headers: [ACCEPT_JSON] },
  ]);
});

test('200 for a PRO account shows the included credits left next to the spend of this month, with the plan and the billing mode', async () => {
  assert.deepEqual(await run({ whoami: 'whoami-200', usage: 'usage-200' }), succeeded(makeUsage({
    texts: [usageText(LABEL.PLAN, 'PRO'), usageText(LABEL.BILLING_MODE, 'postpaid')],
    amounts: [usageAmount(LABEL.INCLUDED_CREDITS_LEFT, '', 2 - 1.335, null, false, 'usd'), usageAmount(LABEL.SPENT_THIS_MONTH, '', 1.335, null, false, 'usd')],
  })));
  assert.equal(PRO_INCLUDED_CREDITS_USD, 2);
});

test('included credits left never go below zero', async () => {
  const runCommand = () => Promise.resolve({ exitCode: 0, stdout: curlBlock('whoami', readRecorded('huggingface', 'whoami-200')) + curlBlock('usage', { status: 200, headers: {}, body: { currency: 'usd', periods: [{ period: '2026-10-01T00:00:00.000Z', sessions: [{ id: 's', requestCount: 1, costCents: 500 }] }] } }), stderr: '' });
  const outcome = await fetchUsage(huggingFace, testAccount(huggingFace, 'me'), runCommand, () => NOW, TEST_BOUNDARY);
  assert.equal(outcome.usage.amounts[0].label, LABEL.INCLUDED_CREDITS_LEFT);
  assert.equal(outcome.usage.amounts[0].value, 0);
});

test('a free account shows only the spend of this month', async () => {
  const outcome = await run({ whoami: 'whoami-free-200', usage: 'usage-200' });
  assert.deepEqual(outcome.usage.amounts.map((item) => item.label), [LABEL.SPENT_THIS_MONTH]);
});

test('a free user shows the free plan, and another currency is kept', async () => {
  const outcome = await run({ whoami: 'whoami-free-200', usage: 'usage-eur-200' });
  assert.equal(outcome.usage.texts[0].value, 'free');
  assert.equal(outcome.usage.amounts[0].currency, 'eur');
});

test('no sessions this month is a spend of zero', async () => {
  assert.equal((await run({ whoami: 'whoami-200', usage: 'usage-empty-200' })).usage.amounts[1].value, 0);
});

test('a missing field names the field', async () => {
  assert.deepEqual(await run({ whoami: 'whoami-no-plan-200', usage: 'usage-200' }), missing('isPro'));
  assert.deepEqual(await run({ whoami: 'whoami-no-billing-mode-200', usage: 'usage-200' }), missing('billingMode'));
  assert.deepEqual(await run({ whoami: 'whoami-200', usage: 'usage-no-currency-200' }), missing('currency'));
  assert.deepEqual(await run({ whoami: 'whoami-200', usage: 'usage-no-cost-200' }), missing('costCents'));
  assert.deepEqual(await run({ whoami: 'whoami-200', usage: 'usage-no-periods-200' }), missing('periods'));
  assert.deepEqual(await run({ whoami: 'whoami-200', usage: 'usage-no-sessions-200' }), missing('sessions'));
});

test('a broken body is an unexpected answer', async () => {
  assert.deepEqual(await run({ whoami: 'openai/malformed', usage: 'usage-200' }), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED) });
  assert.deepEqual(await run({ whoami: 'whoami-200', usage: 'openai/malformed' }), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED) });
});

test('401 means the key was rejected and 403 says the token needs billing read permission', async () => {
  assert.deepEqual(await run({ whoami: '401', usage: 'usage-200' }), { ok: false, error: failure(ERROR_KIND.KEY_REJECTED, REASON.HTTP_STATUS, null, { status: 401 }) });
  assert.deepEqual(await run({ whoami: 'whoami-200', usage: '403' }), { ok: false, error: failure(ERROR_KIND.KEY_REJECTED, REASON.HF_BILLING_PERMISSION) });
});
