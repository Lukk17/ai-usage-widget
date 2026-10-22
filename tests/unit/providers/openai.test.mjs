import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openai } from '../../../package/contents/code/providers/openai.mjs';
import { BEARER_AUTH, ACCEPT_JSON } from '../../../package/contents/code/providers/common.mjs';
import { fetchUsage } from '../../../package/contents/code/core/fetchUsage.mjs';
import { ERROR_KIND, REASON, failure } from '../../../package/contents/code/core/http.mjs';
import { LABEL, makeUsage, usageAmount, usageCount, succeeded } from '../../../package/contents/code/core/usage.mjs';
import { fixtureRunner, TEST_BOUNDARY, testAccount } from '../support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);
const MONTH_START = Date.UTC(2026, 9, 1) / 1000;

function run(names) {
  const runner = fixtureRunner('openai', names, openai.buildRequests(NOW));
  return fetchUsage(openai, testAccount(openai, 'org'), runner.runCommand, () => NOW, TEST_BOUNDARY);
}

test('asks the costs and completions usage of this UTC month with the admin key as a bearer token', () => {
  assert.deepEqual(openai.auth, BEARER_AUTH);
  assert.equal(openai.keyHelp, 'Admin API key, from the OpenAI Platform');
  assert.deepEqual(openai.buildRequests(NOW), [
    { id: 'costs', url: 'https://api.openai.com/v1/organization/costs?start_time=' + MONTH_START + '&bucket_width=1d&limit=31', headers: [ACCEPT_JSON] },
    { id: 'usage', url: 'https://api.openai.com/v1/organization/usage/completions?start_time=' + MONTH_START + '&bucket_width=1d&limit=31', headers: [ACCEPT_JSON] },
  ]);
  assert.match(openai.buildRequests(Date.UTC(2026, 11, 31, 23, 59))[0].url, new RegExp('start_time=' + Date.UTC(2026, 11, 1) / 1000 + '&'));
});

test('200 sums the month spend in dollars and the input and output tokens', async () => {
  assert.deepEqual(await run({ costs: 'costs-200', usage: 'usage-200' }), succeeded(makeUsage({
    amounts: [usageAmount(LABEL.SPENT_THIS_MONTH, '', 3.75, null, false)],
    counts: [usageCount(LABEL.INPUT_TOKENS_THIS_MONTH, 2000000), usageCount(LABEL.OUTPUT_TOKENS_THIS_MONTH, 50000)],
  })));
});

test('more pages than one month of buckets still sums what came back', async () => {
  assert.equal((await run({ costs: 'costs-has-more-200', usage: 'usage-200' })).usage.amounts[0].value, 3.75);
});

test('another currency, a token count that is not a number or a broken body is an unexpected answer', async () => {
  for (const names of [{ costs: 'costs-changed-200', usage: 'usage-200' }, { costs: 'costs-200', usage: 'usage-changed-200' }, { costs: 'malformed', usage: 'usage-200' }, { costs: 'bucket-changed-200', usage: 'usage-200' }, { costs: 'costs-200', usage: 'no-data-200' }]) {
    assert.deepEqual(await run(names), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED) }, JSON.stringify(names));
  }
});

test('401 and 403 say an Admin API key is needed', async () => {
  assert.deepEqual(await run({ costs: '401', usage: 'usage-200' }), { ok: false, error: failure(ERROR_KIND.KEY_REJECTED, REASON.OPENAI_ADMIN_KEY_REQUIRED, null, { status: 401 }) });
  assert.deepEqual(await run({ costs: 'costs-200', usage: '403' }), { ok: false, error: failure(ERROR_KIND.KEY_REJECTED, REASON.OPENAI_ADMIN_KEY_REQUIRED, null, { status: 403 }) });
});

test('429 is rate limited until Retry-After', async () => {
  assert.deepEqual(await run({ costs: '429', usage: 'usage-200' }), { ok: false, error: failure(ERROR_KIND.RATE_LIMITED, REASON.HTTP_STATUS, NOW + 120000, { status: 429 }) });
});

test('a timeout means cannot connect', async () => {
  assert.deepEqual(await run({ costs: 'common/timeout', usage: 'usage-200' }), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT) });
});
