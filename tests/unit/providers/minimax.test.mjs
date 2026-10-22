import { test } from 'node:test';
import assert from 'node:assert/strict';

import { minimax, MAX_MODELS } from '../../../package/contents/code/providers/minimax.mjs';
import { BEARER_AUTH, ACCEPT_JSON } from '../../../package/contents/code/providers/common.mjs';
import { fetchUsage } from '../../../package/contents/code/core/fetchUsage.mjs';
import { ERROR_KIND, REASON, failure } from '../../../package/contents/code/core/http.mjs';
import { buildViewModel } from '../../../package/contents/code/core/formatter.mjs';
import { createEntry, applySuccess } from '../../../package/contents/code/core/state.mjs';
import { PERIOD, MAX_NAME_LENGTH } from '../../../package/contents/code/core/usage.mjs';
import { fixtureRunner, curlBlock, TEST_BOUNDARY, testAccount } from '../support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);

function run(name) {
  const runner = fixtureRunner('minimax', { remains: name }, minimax.buildRequests(NOW));
  return fetchUsage(minimax, testAccount(minimax, 'default'), runner.runCommand, () => NOW, TEST_BOUNDARY);
}

function runBody(body) {
  const runCommand = () => Promise.resolve({ exitCode: 0, stdout: curlBlock('remains', { status: 200, headers: {}, body: body }), stderr: '' });
  return fetchUsage(minimax, testAccount(minimax, 'default'), runCommand, () => NOW, TEST_BOUNDARY);
}

function model(name, reported) {
  return { model_name: name, remains_time: 1000, current_interval_total_count: 100, current_interval_usage_count: reported, current_interval_remaining_percent: 100 - reported, current_weekly_total_count: 0, current_weekly_usage_count: 0, weekly_remains_time: 1000 };
}

test('asks the token plan endpoint with the subscription key as a bearer token', () => {
  assert.deepEqual(minimax.auth, BEARER_AUTH);
  assert.deepEqual(minimax.buildRequests(NOW), [{ id: 'remains', url: 'https://api.minimax.io/v1/token_plan/remains', headers: [ACCEPT_JSON] }]);
});

test('the public CLI fixture follows MiniMax CLI v1.0.28: counts without a percent are remaining counts', async () => {
  const outcome = await run('200');
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.usage.windows.map((w) => [w.period, w.name, Math.round(w.usedPercent * 10) / 10, w.resetsAt, w.canBeMain]), [
    [PERIOD.FIVE_HOUR, 'MiniMax-M*', 84.8, NOW + 7151954, true],
    [PERIOD.DAILY, 'speech-hd', 100, NOW + 75551954, false],
    [PERIOD.WEEKLY, 'speech-hd', 100, NOW + 248351954, false],
    [PERIOD.DAILY, 'image-01', 100, NOW + 75551954, false],
    [PERIOD.WEEKLY, 'image-01', 100, NOW + 248351954, false],
  ]);
});

test('with the public CLI fixture the main bars come from the models with plan details, the rest goes to the additional rows', async () => {
  const outcome = await run('200');
  const entry = applySuccess(createEntry({ account: testAccount(minimax, 'default'), title: 'MiniMax', intervalMs: 300000 }), outcome.usage, NOW);
  const section = buildViewModel([entry], NOW).sections[0];
  assert.deepEqual(section.windows.map((item) => [item.label, item.percentText]), [['5hr', '85%'], ['daily', '100%'], ['weekly', '100%']]);
  assert.deepEqual(section.rows.map((item) => item.label), ['image-01 daily', 'image-01 weekly']);
});

test('reset times count from the time the answer came back', async () => {
  const runner = fixtureRunner('minimax', { remains: '200' }, minimax.buildRequests(NOW));
  const times = [NOW, NOW + 5000];
  const outcome = await fetchUsage(minimax, testAccount(minimax, 'default'), runner.runCommand, () => (times.length > 1 ? times.shift() : times[0]), TEST_BOUNDARY);
  assert.equal(outcome.usage.windows[0].resetsAt, NOW + 5000 + 7151954);
});

test('the remaining percent from the server wins over the counts', async () => {
  const outcome = await run('200-with-percent');
  assert.deepEqual(outcome.usage.windows.map((w) => [w.period, w.name, w.usedPercent, w.canBeMain]), [
    [PERIOD.FIVE_HOUR, 'MiniMax-M*', 20, true],
    [PERIOD.WEEKLY, 'MiniMax-M*', 75, true],
    [PERIOD.DAILY, 'speech-hd', 0, true],
  ]);
});

test('an unlimited model without any counts is left out instead of breaking the answer', async () => {
  const outcome = await run('200-unlimited-no-counts');
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.usage.windows.map((w) => w.name), ['MiniMax-M*']);
});

test('10,000 models are capped to the first MAX_MODELS models', async () => {
  const models = [];
  for (let index = 0; index < 10000; index += 1) {
    models.push(model('m' + index, index % 100));
  }
  const outcome = await runBody({ base_resp: { status_code: 0 }, model_remains: models });
  assert.equal(MAX_MODELS, 50);
  assert.deepEqual(outcome.usage.windows.map((w) => w.name), models.slice(0, MAX_MODELS).map((item) => item.model_name));
});

test('a 2 MB model name is cut to the maximum name length', async () => {
  const outcome = await runBody({ base_resp: { status_code: 0 }, model_remains: [model('x'.repeat(2 * 1024 * 1024), 5)] });
  assert.equal(outcome.usage.windows[0].name.length, MAX_NAME_LENGTH);
});

test('MiniMax error codes on HTTP 200 map to key rejected, rate limited, not available or unexpected answer', async () => {
  const expected = {
    1004: ERROR_KIND.KEY_REJECTED,
    2049: ERROR_KIND.KEY_REJECTED,
    1002: ERROR_KIND.RATE_LIMITED,
    1039: ERROR_KIND.RATE_LIMITED,
    1041: ERROR_KIND.RATE_LIMITED,
    2045: ERROR_KIND.RATE_LIMITED,
    2056: ERROR_KIND.RATE_LIMITED,
    1008: ERROR_KIND.NOT_AVAILABLE,
    1000: ERROR_KIND.UNEXPECTED_ANSWER,
  };
  for (const code of Object.keys(expected)) {
    const outcome = await run('base-resp-' + code + '-200');
    assert.equal(outcome.error.kind, expected[code], code);
    assert.equal(outcome.error.params.code, Number(code), code);
  }
  assert.deepEqual((await run('base-resp-1008-200')).error, failure(ERROR_KIND.NOT_AVAILABLE, REASON.INSUFFICIENT_BALANCE, null, { code: 1008 }));
  assert.deepEqual((await run('base-resp-error-200')).error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SERVICE_CODE, null, { code: 1028 }));
});

test('a model that is not an object or has no name is an unexpected answer', async () => {
  for (const model of [null, 'MiniMax-M*', { model_name: 5 }]) {
    assert.deepEqual(await runBody({ base_resp: { status_code: 0 }, model_remains: [model] }), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED) }, JSON.stringify(model));
  }
});

test('a changed or malformed body is an unexpected answer', async () => {
  for (const name of ['changed-200', 'malformed']) {
    assert.deepEqual((await run(name)).error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED), name);
  }
});

test('401 and 403 mean the key was rejected', async () => {
  for (const name of ['401', '403']) {
    assert.equal((await run(name)).error.kind, ERROR_KIND.KEY_REJECTED, name);
  }
});

test('402 means the plan cannot be used right now', async () => {
  assert.equal((await run('402')).error.kind, ERROR_KIND.NOT_AVAILABLE);
});

test('429 with an HTTP date is rate limited until that date', async () => {
  const outcome = await run('429');
  assert.equal(outcome.error.kind, ERROR_KIND.RATE_LIMITED);
  assert.equal(outcome.error.retryAt, Date.UTC(2026, 9, 18, 12, 30));
});

test('500 means the service could not answer and a timeout means cannot connect', async () => {
  assert.equal((await run('500')).error.kind, ERROR_KIND.CANNOT_CONNECT);
  assert.deepEqual((await run('common/timeout')).error, failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT));
});
