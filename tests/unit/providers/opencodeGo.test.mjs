import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opencodeGo } from '../../../package/contents/code/providers/opencodeGo.mjs';
import { BEARER_AUTH, ACCEPT_JSON } from '../../../package/contents/code/providers/common.mjs';
import { fetchUsage } from '../../../package/contents/code/core/fetchUsage.mjs';
import { ERROR_KIND, REASON, failure } from '../../../package/contents/code/core/http.mjs';
import { PERIOD, usageWindow } from '../../../package/contents/code/core/usage.mjs';
import { fixtureRunner, TEST_BOUNDARY, testAccount } from '../support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);

function run(name) {
  const runner = fixtureRunner('opencode-go', { usage: name }, opencodeGo.buildRequests(NOW));
  return fetchUsage(opencodeGo, testAccount(opencodeGo, 'alice'), runner.runCommand, () => NOW, TEST_BOUNDARY);
}

test('asks the Go usage endpoint with the account key as a bearer token', () => {
  assert.deepEqual(opencodeGo.auth, BEARER_AUTH);
  assert.deepEqual(opencodeGo.buildRequests(NOW), [{ id: 'usage', url: 'https://opencode.ai/zen/go/v1/usage', headers: [ACCEPT_JSON] }]);
});

test('200 shows the rolling, weekly and monthly windows with their reset times', async () => {
  const outcome = await run('200');
  assert.deepEqual(outcome.usage.windows, [
    usageWindow(PERIOD.FIVE_HOUR, '', 37, Date.UTC(2026, 9, 18, 14, 30)),
    usageWindow(PERIOD.WEEKLY, '', 62, Date.UTC(2026, 9, 19)),
    usageWindow(PERIOD.MONTHLY, '', 18, Date.UTC(2026, 10, 3, 9, 12)),
  ]);
});

test('a rate limited window keeps its bar and an unknown extra window is ignored', async () => {
  const outcome = await run('200-rate-limited');
  assert.deepEqual(outcome.usage.windows.map((w) => w.period), [PERIOD.FIVE_HOUR, PERIOD.WEEKLY, PERIOD.MONTHLY]);
});

test('a changed shape is an unexpected answer, also when only one window changed or none is known', async () => {
  for (const name of ['changed-200', 'partly-changed-200', 'empty-usage-200', 'malformed']) {
    assert.deepEqual((await run(name)).error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED), name);
  }
});

test('401 means the key was rejected', async () => {
  assert.equal((await run('401')).error.kind, ERROR_KIND.KEY_REJECTED);
});

test('403 with an entitlement error says the Go subscription is missing', async () => {
  assert.deepEqual((await run('403')).error, failure(ERROR_KIND.NOT_AVAILABLE, REASON.GO_SUBSCRIPTION_REQUIRED));
});

test('any other 403 means the key was rejected', async () => {
  assert.equal((await run('403-other')).error.kind, ERROR_KIND.KEY_REJECTED);
});

test('402 means the account cannot use the service', async () => {
  assert.equal((await run('402')).error.kind, ERROR_KIND.NOT_AVAILABLE);
});

test('429 is rate limited until Retry-After', async () => {
  const outcome = await run('429');
  assert.equal(outcome.error.kind, ERROR_KIND.RATE_LIMITED);
  assert.equal(outcome.error.retryAt, NOW + 600000);
});

test('503 means the service could not answer and a timeout means cannot connect', async () => {
  assert.equal((await run('503')).error.kind, ERROR_KIND.CANNOT_CONNECT);
  assert.deepEqual((await run('common/timeout')).error, failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT));
});
