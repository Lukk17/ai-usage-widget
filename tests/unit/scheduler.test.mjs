import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BACKOFF_MS,
  backoffDelayMs,
  nextAttemptAfterSuccess,
  nextAttemptAfterFailure,
  isDue,
  manualRefreshAt,
} from '../../package/contents/code/core/scheduler.mjs';
import { ERROR_KIND, REASON, failure } from '../../package/contents/code/core/http.mjs';
import { MINUTE_MS, HOUR_MS } from '../../package/contents/code/core/units.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);
const FIVE_MINUTES = 5 * MINUTE_MS;

test('the backoff cap is one hour', () => {
  assert.equal(MAX_BACKOFF_MS, HOUR_MS);
});

test('backoff starts at the interval and doubles with each failure', () => {
  assert.equal(backoffDelayMs(FIVE_MINUTES, 0), FIVE_MINUTES);
  assert.equal(backoffDelayMs(FIVE_MINUTES, 1), FIVE_MINUTES);
  assert.equal(backoffDelayMs(FIVE_MINUTES, 2), 2 * FIVE_MINUTES);
  assert.equal(backoffDelayMs(FIVE_MINUTES, 3), 4 * FIVE_MINUTES);
});

test('backoff is capped at one hour, or at the interval when the interval is longer', () => {
  assert.equal(backoffDelayMs(FIVE_MINUTES, 10), MAX_BACKOFF_MS);
  assert.equal(backoffDelayMs(FIVE_MINUTES, 500), MAX_BACKOFF_MS);
  assert.equal(backoffDelayMs(120 * MINUTE_MS, 4), 120 * MINUTE_MS);
});

test('after a success the next attempt is one interval later', () => {
  assert.equal(nextAttemptAfterSuccess(NOW, FIVE_MINUTES), NOW + FIVE_MINUTES);
});

test('after a failure the next attempt follows the backoff', () => {
  assert.equal(nextAttemptAfterFailure(NOW, FIVE_MINUTES, 3, failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT)), NOW + 4 * FIVE_MINUTES);
});

test('a lost connection retries after one interval without doubling', () => {
  assert.equal(nextAttemptAfterFailure(NOW, FIVE_MINUTES, 6, failure(ERROR_KIND.CANNOT_CONNECT, REASON.NO_CONNECTION)), NOW + FIVE_MINUTES);
});

test('after a failure the next attempt is never earlier than Retry-After', () => {
  const retryAt = NOW + 30 * MINUTE_MS;
  assert.equal(nextAttemptAfterFailure(NOW, FIVE_MINUTES, 1, failure(ERROR_KIND.RATE_LIMITED, REASON.HTTP_STATUS, retryAt)), retryAt);
});

test('a short Retry-After does not make the widget poll faster than the backoff', () => {
  assert.equal(nextAttemptAfterFailure(NOW, FIVE_MINUTES, 1, failure(ERROR_KIND.RATE_LIMITED, REASON.HTTP_STATUS, NOW + 1000)), NOW + FIVE_MINUTES);
});

test('an entry is due when its next attempt time has come and it is not loading', () => {
  assert.equal(isDue({ nextAttemptAt: NOW, lastAttemptAt: null, isLoading: false }, NOW), true);
  assert.equal(isDue({ nextAttemptAt: NOW + 1, lastAttemptAt: NOW - 1, isLoading: false }, NOW), false);
  assert.equal(isDue({ nextAttemptAt: 0, lastAttemptAt: null, isLoading: true }, NOW), false);
});

test('an entry is due when the clock moved back before its last attempt', () => {
  assert.equal(isDue({ nextAttemptAt: NOW + 50 * MINUTE_MS, lastAttemptAt: NOW + 45 * MINUTE_MS, isLoading: false }, NOW), true);
});

test('a manual refresh runs at once when the minimum interval has passed', () => {
  const entry = { lastAttemptAt: NOW - FIVE_MINUTES, nextAttemptAt: NOW + FIVE_MINUTES, error: null };
  assert.equal(manualRefreshAt(entry, NOW, FIVE_MINUTES), NOW);
});

test('a manual refresh never polls faster than the minimum interval', () => {
  const entry = { lastAttemptAt: NOW - MINUTE_MS, nextAttemptAt: NOW + 4 * MINUTE_MS, error: null };
  assert.equal(manualRefreshAt(entry, NOW, FIVE_MINUTES), NOW + 4 * MINUTE_MS);
});

test('a manual refresh of a never polled entry runs at once', () => {
  assert.equal(manualRefreshAt({ lastAttemptAt: null, nextAttemptAt: 0, error: null }, NOW, FIVE_MINUTES), NOW);
});

test('a manual refresh right after storing a missing key runs at once, because no request reached the service', () => {
  const entry = { lastAttemptAt: NOW - 10000, nextAttemptAt: NOW + FIVE_MINUTES, error: failure(ERROR_KIND.NO_KEY, REASON.NO_KEY) };
  assert.equal(manualRefreshAt(entry, NOW, FIVE_MINUTES), NOW);
});

test('a manual refresh does not skip the Retry-After of a 5xx answer', () => {
  const retryAt = NOW + 50 * MINUTE_MS;
  const entry = { lastAttemptAt: NOW - 10 * MINUTE_MS, nextAttemptAt: retryAt, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.SERVICE_ERROR, retryAt, { status: 503 }) };
  assert.equal(manualRefreshAt(entry, NOW, FIVE_MINUTES), retryAt);
});

test('a manual refresh right after installing a missing tool runs at once', () => {
  const entry = { lastAttemptAt: NOW - 10000, nextAttemptAt: NOW + FIVE_MINUTES, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.TOOL_MISSING) };
  assert.equal(manualRefreshAt(entry, NOW, FIVE_MINUTES), NOW);
});

test('a manual refresh does not skip a rate limit wait', () => {
  const retryAt = NOW + 50 * MINUTE_MS;
  const entry = { lastAttemptAt: NOW - 10 * MINUTE_MS, nextAttemptAt: retryAt, error: failure(ERROR_KIND.RATE_LIMITED, REASON.HTTP_STATUS, retryAt) };
  assert.equal(manualRefreshAt(entry, NOW, FIVE_MINUTES), retryAt);
});
