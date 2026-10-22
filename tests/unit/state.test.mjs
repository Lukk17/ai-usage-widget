import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createEntry,
  markLoading,
  applySuccess,
  applyFailure,
  withInterval,
  withAccount,
  dueNow,
} from '../../package/contents/code/core/state.mjs';
import { ERROR_KIND, REASON, failure } from '../../package/contents/code/core/http.mjs';
import { MINUTE_MS } from '../../package/contents/code/core/units.mjs';
import { makeUsage, usageWindow, PERIOD } from '../../package/contents/code/core/usage.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);
const FIVE_MINUTES = 5 * MINUTE_MS;
const ACCOUNT = Object.freeze({ id: 'a0123456789ab', service: 'requesty', name: 'work@example.com' });
const USAGE = makeUsage({ windows: [usageWindow(PERIOD.WEEKLY, '', 40, null)] });

function freshEntry() {
  return createEntry({ account: ACCOUNT, title: 'Requesty', intervalMs: FIVE_MINUTES });
}

test('a new entry is keyed by the account id and keeps the account', () => {
  const entry = freshEntry();
  assert.equal(entry.key, 'a0123456789ab');
  assert.equal(entry.providerId, 'requesty');
  assert.equal(entry.account, ACCOUNT);
});

test('a new entry has no data, no error and is due at once', () => {
  const entry = freshEntry();
  assert.equal(entry.usage, null);
  assert.equal(entry.error, null);
  assert.equal(entry.nextAttemptAt, 0);
  assert.equal(entry.isLoading, false);
});

test('a new entry can start from an earlier attempt so a re-added account keeps its minimum interval', () => {
  const entry = createEntry({ account: ACCOUNT, title: 'Requesty', intervalMs: FIVE_MINUTES, lastAttemptAt: NOW - MINUTE_MS });
  assert.equal(entry.lastAttemptAt, NOW - MINUTE_MS);
  assert.equal(entry.nextAttemptAt, NOW + 4 * MINUTE_MS);
});

test('markLoading records the attempt and does not change the original entry', () => {
  const entry = freshEntry();
  const loading = markLoading(entry, NOW);
  assert.equal(loading.isLoading, true);
  assert.equal(loading.lastAttemptAt, NOW);
  assert.equal(entry.isLoading, false);
});

test('a success stores the usage, clears the error and schedules the next poll', () => {
  const failed = applyFailure(markLoading(freshEntry(), NOW), failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT), NOW);
  const entry = applySuccess(markLoading(failed, NOW), USAGE, NOW);
  assert.deepEqual(entry.usage, USAGE);
  assert.equal(entry.error, null);
  assert.equal(entry.consecutiveFailures, 0);
  assert.equal(entry.lastSuccessAt, NOW);
  assert.equal(entry.nextAttemptAt, NOW + FIVE_MINUTES);
  assert.equal(entry.isLoading, false);
});

test('a failure keeps the last good usage and counts consecutive failures', () => {
  const good = applySuccess(freshEntry(), USAGE, NOW - FIVE_MINUTES);
  const once = applyFailure(markLoading(good, NOW), failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT), NOW);
  const twice = applyFailure(once, failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT), NOW);
  assert.deepEqual(twice.usage, USAGE);
  assert.equal(twice.lastSuccessAt, NOW - FIVE_MINUTES);
  assert.equal(twice.error.kind, ERROR_KIND.CANNOT_CONNECT);
  assert.equal(twice.consecutiveFailures, 2);
  assert.equal(twice.nextAttemptAt, NOW + 2 * FIVE_MINUTES);
  assert.equal(twice.isLoading, false);
});

test('a rate limited failure waits until Retry-After', () => {
  const retryAt = NOW + 40 * MINUTE_MS;
  const entry = applyFailure(freshEntry(), failure(ERROR_KIND.RATE_LIMITED, REASON.HTTP_STATUS, retryAt), NOW);
  assert.equal(entry.nextAttemptAt, retryAt);
});

test('withAccount swaps the account record and keeps the state', () => {
  const entry = applySuccess(freshEntry(), USAGE, NOW);
  const renamed = Object.assign({}, ACCOUNT, { name: 'new name' });
  assert.equal(withAccount(entry, ACCOUNT), entry);
  assert.equal(withAccount(entry, renamed).account.name, 'new name');
  assert.deepEqual(withAccount(entry, renamed).usage, USAGE);
});

test('dueNow makes an entry due at once unless it is loading', () => {
  const entry = applySuccess(freshEntry(), USAGE, NOW);
  assert.equal(dueNow(entry, NOW + 1).nextAttemptAt, NOW + 1);
  const loading = markLoading(entry, NOW);
  assert.equal(dueNow(loading, NOW + 1), loading);
});

test('withInterval moves the next poll of a healthy entry to the new interval', () => {
  const entry = applySuccess(markLoading(freshEntry(), NOW), USAGE, NOW);
  const changed = withInterval(entry, 10 * MINUTE_MS);
  assert.equal(changed.intervalMs, 10 * MINUTE_MS);
  assert.equal(changed.nextAttemptAt, NOW + 10 * MINUTE_MS);
});

test('withInterval keeps a backoff or Retry-After time of a failing entry', () => {
  const retryAt = NOW + 40 * MINUTE_MS;
  const entry = applyFailure(markLoading(freshEntry(), NOW), failure(ERROR_KIND.RATE_LIMITED, REASON.HTTP_STATUS, retryAt), NOW);
  assert.equal(withInterval(entry, 10 * MINUTE_MS).nextAttemptAt, retryAt);
});

test('withInterval returns the same entry when nothing changed', () => {
  const entry = freshEntry();
  assert.equal(withInterval(entry, FIVE_MINUTES), entry);
});

test('withInterval keeps a never polled entry due at once', () => {
  assert.equal(withInterval(freshEntry(), 10 * MINUTE_MS).nextAttemptAt, 0);
});
