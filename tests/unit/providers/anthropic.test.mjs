import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anthropic } from '../../../package/contents/code/providers/anthropic.mjs';
import { ACCEPT_JSON } from '../../../package/contents/code/providers/common.mjs';
import { fetchUsage } from '../../../package/contents/code/core/fetchUsage.mjs';
import { ERROR_KIND, REASON, failure } from '../../../package/contents/code/core/http.mjs';
import { LABEL, usageAmount, usageCount } from '../../../package/contents/code/core/usage.mjs';
import { fixtureRunner, TEST_BOUNDARY, testAccount } from '../support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);

function run(names) {
  const runner = fixtureRunner('anthropic', names, anthropic.buildRequests(NOW));
  return fetchUsage(anthropic, testAccount(anthropic, 'default'), runner.runCommand, () => NOW, TEST_BOUNDARY);
}

test('asks for daily cost and usage buckets since the start of the month in UTC, with the key in x-api-key', () => {
  assert.deepEqual(anthropic.auth, { header: 'x-api-key', prefix: '' });
  assert.deepEqual(anthropic.buildRequests(NOW), [
    { id: 'cost', url: 'https://api.anthropic.com/v1/organizations/cost_report?starting_at=2026-10-01T00%3A00%3A00Z&bucket_width=1d&limit=31', headers: [ACCEPT_JSON, 'anthropic-version: 2023-06-01'] },
    { id: 'usage', url: 'https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=2026-10-01T00%3A00%3A00Z&bucket_width=1d&limit=31', headers: [ACCEPT_JSON, 'anthropic-version: 2023-06-01'] },
  ]);
});

test('the month start is the first day of the current UTC month even late on the last day', () => {
  assert.match(anthropic.buildRequests(Date.UTC(2026, 9, 31, 23, 59))[0].url, /starting_at=2026-10-01T00%3A00%3A00Z/);
  assert.match(anthropic.buildRequests(Date.UTC(2026, 11, 3))[0].url, /starting_at=2026-12-01T00%3A00%3A00Z/);
});

test('the key help names the key and where it is created', () => {
  assert.equal(anthropic.keyHelp, 'Admin API key, from the Claude Console (team organizations only)');
  assert.equal(anthropic.needsKey, true);
});

test('200 sums the cost in cents into dollars and sums the tokens', async () => {
  const outcome = await run({ cost: 'cost-200', usage: 'usage-200' });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.usage.amounts[0].label, LABEL.SPENT_THIS_MONTH);
  assert.ok(Math.abs(outcome.usage.amounts[0].value - 3.24) < 1e-9);
  assert.deepEqual(outcome.usage.amounts, [usageAmount(LABEL.SPENT_THIS_MONTH, '', outcome.usage.amounts[0].value, null, false)]);
  assert.deepEqual(outcome.usage.counts, [usageCount(LABEL.INPUT_TOKENS_THIS_MONTH, 2000000), usageCount(LABEL.OUTPUT_TOKENS_THIS_MONTH, 50000)]);
});

test('more pages than one month of buckets still sums what came back', async () => {
  assert.equal((await run({ cost: 'cost-has-more-200', usage: 'usage-200' })).ok, true);
});

test('a cost in another currency, a broken token count or a broken bucket is an unexpected answer', async () => {
  const cases = [{ cost: 'cost-changed-200', usage: 'usage-200' }, { cost: 'cost-200', usage: 'usage-changed-200' }, { cost: 'cost-200', usage: 'usage-bucket-changed-200' }, { cost: 'cost-200', usage: 'usage-item-changed-200' }, { cost: 'cost-200', usage: 'malformed' }];
  for (const names of cases) {
    assert.deepEqual((await run(names)).error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED), JSON.stringify(names));
  }
});

test('403 and 404 explain that a team organization is needed', async () => {
  for (const name of ['403', '404']) {
    assert.deepEqual((await run({ cost: name, usage: name })).error, failure(ERROR_KIND.NOT_AVAILABLE, REASON.TEAM_ORGANIZATION_REQUIRED), name);
  }
});

test('401 means the key was rejected and names the key types the API accepts', async () => {
  assert.deepEqual((await run({ cost: '401', usage: '401' })).error, failure(ERROR_KIND.KEY_REJECTED, REASON.ADMIN_KEY_REQUIRED));
});

test('402 means the account cannot use the service', async () => {
  assert.equal((await run({ cost: '402', usage: '402' })).error.kind, ERROR_KIND.NOT_AVAILABLE);
});

test('429 is rate limited until Retry-After', async () => {
  const outcome = await run({ cost: '429', usage: 'usage-200' });
  assert.equal(outcome.error.kind, ERROR_KIND.RATE_LIMITED);
  assert.equal(outcome.error.retryAt, NOW + 60000);
});

test('500 and 529 mean the service could not answer', async () => {
  for (const name of ['500', '529']) {
    assert.equal((await run({ cost: name, usage: 'usage-200' })).error.kind, ERROR_KIND.CANNOT_CONNECT, name);
  }
});

test('a timeout means cannot connect', async () => {
  assert.deepEqual((await run({ cost: 'common/timeout', usage: 'usage-200' })).error, failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT));
});
