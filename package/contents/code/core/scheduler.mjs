import { ERROR_KIND, REASON } from './http.mjs';
import { HOUR_MS } from './units.mjs';

export const MAX_BACKOFF_MS = HOUR_MS;

const MAX_DOUBLINGS = 32;
const REASONS_WITHOUT_BACKOFF = [REASON.NO_CONNECTION];
const REASONS_BEFORE_ANY_REQUEST = [REASON.NO_KEY, REASON.KEY_FORMAT, REASON.SECRET_SERVICE_TIMEOUT, REASON.SECRET_SERVICE_UNAVAILABLE, REASON.WALLET_LOCKED, REASON.TOOL_MISSING];

export function backoffDelayMs(intervalMs, consecutiveFailures) {
  const exponent = Math.max(consecutiveFailures - 1, 0);
  const cap = Math.max(MAX_BACKOFF_MS, intervalMs);
  if (exponent >= MAX_DOUBLINGS) {
    return cap;
  }
  return Math.min(intervalMs * Math.pow(2, exponent), cap);
}

export function nextAttemptAfterSuccess(now, intervalMs) {
  return now + intervalMs;
}

export function nextAttemptAfterFailure(now, intervalMs, consecutiveFailures, error) {
  const failures = REASONS_WITHOUT_BACKOFF.indexOf(error.reason) === -1 ? consecutiveFailures : 1;
  const afterBackoff = now + backoffDelayMs(intervalMs, failures);
  return error.retryAt ? Math.max(afterBackoff, error.retryAt) : afterBackoff;
}

export function isDue(entry, now) {
  if (entry.isLoading) {
    return false;
  }
  const clockMovedBack = entry.lastAttemptAt !== null && entry.lastAttemptAt !== undefined && now < entry.lastAttemptAt;
  return clockMovedBack || now >= entry.nextAttemptAt;
}

export function manualRefreshAt(entry, now, minIntervalMs) {
  if (entry.error && REASONS_BEFORE_ANY_REQUEST.indexOf(entry.error.reason) !== -1) {
    return now;
  }
  const earliest = entry.lastAttemptAt === null ? now : Math.max(now, entry.lastAttemptAt + minIntervalMs);
  if (entry.error && entry.error.kind === ERROR_KIND.RATE_LIMITED) {
    return Math.max(earliest, entry.nextAttemptAt);
  }
  const refreshAt = Math.min(earliest, Math.max(entry.nextAttemptAt, now));
  return entry.error && entry.error.retryAt ? Math.max(refreshAt, entry.error.retryAt) : refreshAt;
}
