import { nextAttemptAfterSuccess, nextAttemptAfterFailure } from './scheduler.mjs';

export function createEntry(spec) {
  const lastAttemptAt = spec.lastAttemptAt === undefined ? null : spec.lastAttemptAt;
  return {
    key: spec.account.id,
    providerId: spec.account.service,
    account: spec.account,
    title: spec.title,
    intervalMs: spec.intervalMs,
    usage: null,
    error: null,
    lastSuccessAt: null,
    lastAttemptAt: lastAttemptAt,
    nextAttemptAt: lastAttemptAt === null ? 0 : lastAttemptAt + spec.intervalMs,
    consecutiveFailures: 0,
    isLoading: false,
  };
}

function update(entry, changes) {
  return Object.assign({}, entry, changes);
}

export function markLoading(entry, now) {
  return update(entry, { isLoading: true, lastAttemptAt: now });
}

export function applySuccess(entry, usage, now) {
  return update(entry, {
    usage: usage,
    error: null,
    lastSuccessAt: now,
    lastAttemptAt: now,
    nextAttemptAt: nextAttemptAfterSuccess(now, entry.intervalMs),
    consecutiveFailures: 0,
    isLoading: false,
  });
}

export function applyFailure(entry, error, now) {
  const failures = entry.consecutiveFailures + 1;
  return update(entry, {
    error: error,
    lastAttemptAt: now,
    nextAttemptAt: nextAttemptAfterFailure(now, entry.intervalMs, failures, error),
    consecutiveFailures: failures,
    isLoading: false,
  });
}

export function withInterval(entry, intervalMs) {
  if (entry.intervalMs === intervalMs) {
    return entry;
  }
  const isHealthy = entry.consecutiveFailures === 0 && entry.lastAttemptAt !== null;
  return update(entry, {
    intervalMs: intervalMs,
    nextAttemptAt: isHealthy ? entry.lastAttemptAt + intervalMs : entry.nextAttemptAt,
  });
}

export function withAccount(entry, account) {
  return entry.account === account ? entry : update(entry, { account: account });
}

export function dueNow(entry, now) {
  return entry.isLoading ? entry : update(entry, { nextAttemptAt: now });
}
