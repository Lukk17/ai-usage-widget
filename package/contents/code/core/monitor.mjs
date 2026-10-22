import { ERROR_KIND, REASON, failure } from './http.mjs';
import { isDue, manualRefreshAt } from './scheduler.mjs';
import { SECOND_MS } from './units.mjs';
import { MIN_MANUAL_REFRESH_SECONDS } from './accounts.mjs';
import { createEntry, markLoading, applySuccess, applyFailure, withInterval, withAccount, dueNow } from './state.mjs';

const MIN_MANUAL_REFRESH_MS = MIN_MANUAL_REFRESH_SECONDS * SECOND_MS;

function minIntervalMs(provider) {
  return (provider.minIntervalSeconds || 0) * SECOND_MS;
}

function sameTarget(a, b) {
  const keys = Object.keys(a).filter((key) => key !== 'name');
  return keys.length === Object.keys(b).filter((key) => key !== 'name').length && keys.every((key) => a[key] === b[key]);
}

export function createMonitor(deps) {
  let entries = Object.create(null);
  let order = [];
  const lastAttemptByKey = new Map();

  function notify() {
    deps.onChange();
  }

  function store(entry) {
    entries[entry.key] = entry;
    if (entry.lastAttemptAt !== null) {
      lastAttemptByKey.set(entry.key, entry.lastAttemptAt);
    }
    notify();
  }

  function entryFor(account, refreshMs) {
    const provider = deps.findProvider(account.service);
    const intervalMs = Math.max(refreshMs, minIntervalMs(provider));
    const existing = entries[account.id];
    if (existing && sameTarget(existing.account, account)) {
      return withAccount(withInterval(existing, intervalMs), account);
    }
    const lastAttemptAt = !existing && lastAttemptByKey.has(account.id) ? lastAttemptByKey.get(account.id) : null;
    return createEntry({ account: account, title: provider.title, intervalMs: intervalMs, lastAttemptAt: lastAttemptAt });
  }

  function configure(settings) {
    const next = Object.create(null);
    const nextOrder = [];
    settings.accounts.forEach((account) => {
      if (!deps.findProvider(account.service) || next[account.id]) {
        return;
      }
      next[account.id] = entryFor(account, settings.intervalMs);
      nextOrder.push(account.id);
    });
    entries = next;
    order = nextOrder;
    notify();
  }

  function run(key) {
    const provider = deps.findProvider(entries[key].providerId);
    const account = entries[key].account;
    store(markLoading(entries[key], deps.now()));
    return Promise.resolve()
      .then(() => deps.checkAccount(provider, account))
      .catch(() => ({ ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL) }))
      .then((outcome) => {
        const current = entries[key];
        if (!current || !sameTarget(current.account, account)) {
          return;
        }
        const now = deps.now();
        store(outcome.ok ? applySuccess(current, outcome.usage, now) : applyFailure(current, outcome.error, now));
      });
  }

  function tick() {
    const now = deps.now();
    return Promise.all(order.filter((key) => isDue(entries[key], now)).map(run));
  }

  function refreshNow() {
    const now = deps.now();
    order.forEach((key) => {
      const entry = entries[key];
      if (!entry.isLoading) {
        const floorMs = Math.max(MIN_MANUAL_REFRESH_MS, minIntervalMs(deps.findProvider(entry.providerId)));
        entries[key] = Object.assign({}, entry, { nextAttemptAt: manualRefreshAt(entry, now, floorMs) });
      }
    });
    notify();
    return tick();
  }

  function recheck(key) {
    if (!entries[key]) {
      return Promise.resolve([]);
    }
    entries[key] = dueNow(entries[key], deps.now());
    notify();
    return tick();
  }

  function snapshot() {
    return order.map((key) => entries[key]);
  }

  return { configure: configure, tick: tick, refreshNow: refreshNow, recheck: recheck, snapshot: snapshot };
}
