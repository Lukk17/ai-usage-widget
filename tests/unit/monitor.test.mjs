import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMonitor } from '../../package/contents/code/core/monitor.mjs';
import { ERROR_KIND, REASON, failure } from '../../package/contents/code/core/http.mjs';
import { SECOND_MS, MINUTE_MS } from '../../package/contents/code/core/units.mjs';
import { PERIOD, makeUsage, usageWindow, succeeded } from '../../package/contents/code/core/usage.mjs';
import { findProvider } from '../../package/contents/code/providers/registry.mjs';

const START = Date.UTC(2026, 9, 18, 12);
const INTERVAL = 30 * SECOND_MS;
const GOOD = succeeded(makeUsage({ windows: [usageWindow(PERIOD.WEEKLY, '', 40, null)] }));

function account(id, service, extra) {
  return Object.assign({ id: id, service: service, name: id + '@example.com' }, extra || {});
}

const WORK = account('awork', 'opencodeGo');
const HOME = account('ahome', 'minimax');

function harness(options) {
  const opts = options || {};
  const clock = { now: START };
  const checks = [];
  const changes = [];
  const outcomes = opts.outcomes || {};
  const monitor = createMonitor({
    findProvider: findProvider,
    checkAccount: (...args) => {
      const [provider, item] = args;
      checks.push({ key: item.id, provider: provider.id, account: item, arguments: args.length });
      const pick = outcomes[item.id];
      const value = typeof pick === 'function' ? pick() : pick;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value || { ok: false, error: failure(ERROR_KIND.NO_KEY, REASON.NO_KEY) });
    },
    now: () => clock.now,
    onChange: () => changes.push(clock.now),
  });
  return { monitor, clock, checks, changes };
}

function configure(monitor, accounts, intervalMs) {
  monitor.configure({ accounts: accounts, intervalMs: intervalMs || INTERVAL });
}

function byKey(monitor) {
  const result = {};
  monitor.snapshot().forEach((entry) => { result[entry.key] = entry; });
  return result;
}

test('configure creates one entry per account in the saved order, keyed by the account id', () => {
  const { monitor } = harness();
  configure(monitor, [HOME, WORK]);
  assert.deepEqual(monitor.snapshot().map((e) => [e.key, e.providerId, e.title, e.account.name]), [
    ['ahome', 'minimax', 'MiniMax', 'ahome@example.com'],
    ['awork', 'opencodeGo', 'OpenCode Go', 'awork@example.com'],
  ]);
});

test('an account of an unknown service or a repeated id is left out', () => {
  const { monitor } = harness();
  configure(monitor, [WORK, account('awork', 'minimax'), account('agone', 'gone')]);
  assert.deepEqual(monitor.snapshot().map((e) => e.key), ['awork']);
});

test('with no accounts there is nothing to check', async () => {
  const { monitor, checks } = harness();
  configure(monitor, []);
  await monitor.tick();
  assert.deepEqual(monitor.snapshot(), []);
  assert.deepEqual(checks, []);
});

test('a tick checks each due account once with its provider and account record, and stores the result', async () => {
  const { monitor, checks } = harness({ outcomes: { awork: GOOD } });
  configure(monitor, [WORK]);
  await monitor.tick();
  assert.deepEqual(checks.map((c) => [c.key, c.provider, c.arguments]), [['awork', 'opencodeGo', 2]]);
  assert.equal(checks[0].account, WORK);
  const entry = byKey(monitor).awork;
  assert.equal(entry.error, null);
  assert.equal(entry.lastSuccessAt, START);
  assert.deepEqual(entry.usage, GOOD.usage);
});

test('a spend service is asked at most every 5 minutes even with a 30 second refresh, a subscription follows the refresh', async () => {
  const spend = account('aspend', 'openai');
  const { monitor, checks, clock } = harness({ outcomes: { aspend: GOOD, awork: GOOD, ahome: GOOD } });
  configure(monitor, [spend, HOME]);
  await monitor.tick();
  assert.equal(byKey(monitor).aspend.intervalMs, 5 * MINUTE_MS);
  assert.equal(byKey(monitor).ahome.intervalMs, INTERVAL);
  clock.now = START + INTERVAL;
  await monitor.tick();
  assert.deepEqual(checks.map((c) => c.key), ['aspend', 'ahome', 'ahome']);
  clock.now = START + 2 * MINUTE_MS;
  await monitor.refreshNow();
  assert.equal(checks.filter((c) => c.key === 'aspend').length, 1);
  clock.now = START + 5 * MINUTE_MS;
  await monitor.tick();
  assert.equal(checks.filter((c) => c.key === 'aspend').length, 2);
});

test('one failing account never hides the others', async () => {
  const { monitor } = harness({ outcomes: { awork: GOOD, ahome: { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT) } } });
  configure(monitor, [WORK, HOME]);
  await monitor.tick();
  assert.equal(byKey(monitor).awork.error, null);
  assert.equal(byKey(monitor).ahome.error.reason, REASON.TIMEOUT);
});

test('a check that throws is an unexpected answer, not a stopped monitor', async () => {
  const { monitor } = harness({ outcomes: { awork: new Error('boom') } });
  configure(monitor, [WORK]);
  await monitor.tick();
  assert.deepEqual(byKey(monitor).awork.error, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL));
});

test('an account is checked again only after the refresh interval', async () => {
  const { monitor, checks, clock } = harness({ outcomes: { awork: GOOD } });
  configure(monitor, [WORK]);
  await monitor.tick();
  clock.now = START + INTERVAL - 1;
  await monitor.tick();
  assert.equal(checks.length, 1);
  clock.now = START + INTERVAL;
  await monitor.tick();
  assert.equal(checks.length, 2);
});

test('an account is checked again when the clock moved back', async () => {
  const { monitor, checks, clock } = harness({ outcomes: { awork: GOOD } });
  configure(monitor, [WORK]);
  await monitor.tick();
  clock.now = START - MINUTE_MS;
  await monitor.tick();
  assert.equal(checks.length, 2);
});

test('a rate limited account waits for Retry-After and keeps its last good values', async () => {
  let answer = GOOD;
  const { monitor, checks, clock } = harness({ outcomes: { awork: () => answer } });
  configure(monitor, [WORK]);
  await monitor.tick();
  answer = { ok: false, error: failure(ERROR_KIND.RATE_LIMITED, REASON.HTTP_STATUS, START + 40 * MINUTE_MS + INTERVAL) };
  clock.now = START + INTERVAL;
  await monitor.tick();
  const entry = byKey(monitor).awork;
  assert.deepEqual(entry.usage, GOOD.usage);
  assert.equal(entry.nextAttemptAt, START + 40 * MINUTE_MS + INTERVAL);
  clock.now = START + 30 * MINUTE_MS;
  await monitor.tick();
  assert.equal(checks.length, 2);
});

test('a tick while a check is still running does not start a second one', async () => {
  const { monitor, checks } = harness({ outcomes: { awork: () => new Promise(() => {}) } });
  configure(monitor, [WORK]);
  monitor.tick();
  await monitor.tick();
  assert.equal(checks.length, 1);
});

test('deleting an account drops its entry, and a late answer for it is ignored', async () => {
  let release = null;
  const { monitor } = harness({ outcomes: { awork: () => new Promise((resolve) => { release = () => resolve(GOOD); }) } });
  configure(monitor, [WORK]);
  const running = monitor.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  configure(monitor, []);
  release();
  await running;
  assert.deepEqual(monitor.snapshot(), []);
});

test('renaming an account keeps its values and its schedule', async () => {
  const { monitor, checks } = harness({ outcomes: { awork: GOOD } });
  configure(monitor, [WORK]);
  await monitor.tick();
  configure(monitor, [Object.assign({}, WORK, { name: 'renamed' })]);
  await monitor.tick();
  assert.equal(checks.length, 1);
  assert.equal(byKey(monitor).awork.account.name, 'renamed');
  assert.deepEqual(byKey(monitor).awork.usage, GOOD.usage);
});

test('changing a field of an account starts it fresh, and a late answer for the old field is ignored', async () => {
  let release = null;
  const team = account('axai', 'xai', { teamId: 'team-one' });
  const { monitor, checks } = harness({ outcomes: { axai: () => (release ? GOOD : new Promise((resolve) => { release = () => resolve(GOOD); })) } });
  configure(monitor, [team]);
  const running = monitor.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  configure(monitor, [Object.assign({}, team, { teamId: 'team-two' })]);
  release();
  await running;
  assert.equal(byKey(monitor).axai.usage, null);
  await monitor.tick();
  assert.equal(checks.length, 2);
  assert.equal(checks[1].account.teamId, 'team-two');
});

test('a new refresh interval moves the next check of a healthy account', async () => {
  const { monitor } = harness({ outcomes: { awork: GOOD } });
  configure(monitor, [WORK]);
  await monitor.tick();
  configure(monitor, [WORK], 5 * MINUTE_MS);
  assert.equal(byKey(monitor).awork.nextAttemptAt, START + 5 * MINUTE_MS);
});

test('an account deleted and added again with the same id keeps its last attempt', async () => {
  const { monitor, checks, clock } = harness({ outcomes: { awork: GOOD } });
  configure(monitor, [WORK]);
  await monitor.tick();
  configure(monitor, []);
  clock.now = START + 1000;
  configure(monitor, [WORK]);
  await monitor.tick();
  assert.equal(checks.length, 1);
});

test('refreshNow checks again at once when 30 seconds have passed, and not sooner', async () => {
  const { monitor, checks, clock } = harness({ outcomes: { awork: GOOD } });
  configure(monitor, [WORK], 15 * MINUTE_MS);
  await monitor.tick();
  clock.now = START + 29 * SECOND_MS;
  await monitor.refreshNow();
  assert.equal(checks.length, 1);
  assert.equal(byKey(monitor).awork.nextAttemptAt, START + 30 * SECOND_MS);
  clock.now = START + 30 * SECOND_MS;
  await monitor.refreshNow();
  assert.equal(checks.length, 2);
});

test('refreshNow right after a locked wallet or a missing key checks at once', async () => {
  let answer = { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.SECRET_SERVICE_UNAVAILABLE) };
  const { monitor, checks, clock } = harness({ outcomes: { awork: () => answer } });
  configure(monitor, [WORK]);
  await monitor.tick();
  answer = GOOD;
  clock.now = START + 1000;
  await monitor.refreshNow();
  assert.equal(checks.length, 2);
  assert.equal(byKey(monitor).awork.error, null);
});

test('refreshNow tells the view about the new times at once and leaves running checks alone', async () => {
  const { monitor, checks, changes } = harness({ outcomes: { awork: () => new Promise(() => {}) } });
  configure(monitor, [WORK]);
  monitor.tick();
  const before = changes.length;
  await monitor.refreshNow();
  assert.ok(changes.length > before);
  assert.equal(checks.length, 1);
});

test('recheck checks one account at once, for example after its key changed', async () => {
  const { monitor, checks, clock } = harness({ outcomes: { awork: GOOD, ahome: GOOD } });
  configure(monitor, [WORK, HOME]);
  await monitor.tick();
  clock.now = START + 1000;
  await monitor.recheck('awork');
  assert.deepEqual(checks.map((c) => c.key), ['awork', 'ahome', 'awork']);
  assert.deepEqual(await monitor.recheck('unknown'), []);
});

test('an account id that is also an object property name works like any other', async () => {
  const special = account('constructor', 'requesty');
  const { monitor, checks } = harness({ outcomes: { constructor: GOOD } });
  configure(monitor, [special]);
  await monitor.tick();
  assert.deepEqual(checks.map((c) => c.key), ['constructor']);
  assert.deepEqual(monitor.snapshot()[0].usage, GOOD.usage);
});
