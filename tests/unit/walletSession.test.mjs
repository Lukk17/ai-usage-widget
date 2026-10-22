import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWalletSession, OPEN_WAIT_MS, MAX_EARLY_SIGNALS } from '../../package/contents/code/core/walletSession.mjs';
import { WALLET_ERROR } from '../../package/contents/code/core/walletMessages.mjs';

const FAKE_KEY = 'sk-fake-key-for-tests';
const HANDLE = 41;
const TRANSACTION = 7;
const NO_REPLY = { name: 'org.freedesktop.DBus.Error.NoReply' };
const SERVICE_UNKNOWN = { name: 'org.freedesktop.DBus.Error.ServiceUnknown' };

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function harness(overrides, signal) {
  const answers = Object.assign({ localWallet: 'Login', openAsync: TRANSACTION, opened: HANDLE, hasEntry: false, writePassword: 0, removeEntry: 0, close: 1 }, overrides);
  const mode = signal || 'after';
  const sent = [];
  const closed = [];
  const timers = [];
  let session = null;
  const call = (message) => {
    sent.push(message.member);
    if (message.member === 'close') {
      closed.push(message.arguments[0]);
    }
    const answer = answers[message.member];
    if (answer instanceof Error || (answer && answer.name)) {
      return Promise.reject(answer);
    }
    if (message.member === 'openAsync' && mode === 'early') {
      session.opened(answer, answers.opened);
    }
    if (message.member === 'openAsync' && mode === 'after') {
      setTimeout(() => session.opened(answer, answers.opened), 0);
    }
    return Promise.resolve(answer);
  };
  const schedule = (ms, fire) => {
    const timer = { ms: ms, fire: fire, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  };
  session = createWalletSession(call, schedule);
  return { session, sent, closed, timers };
}

test('a successful save opens the wallet with openAsync, waits for the opened signal and closes exactly once', async () => {
  const { session, sent, closed, timers } = harness({});
  assert.deepEqual(await session.save('minimax', 'home', FAKE_KEY), { ok: true, value: { replaced: false } });
  assert.deepEqual(sent, ['localWallet', 'openAsync', 'hasEntry', 'writePassword', 'close']);
  assert.deepEqual(closed, [HANDLE]);
  assert.equal(timers[0].ms, OPEN_WAIT_MS);
  assert.equal(timers[0].cancelled, true);
});

test('a signal that comes before the openAsync reply is kept and used', async () => {
  const { session, closed } = harness({}, 'early');
  assert.deepEqual(await session.unlock(), { ok: true, value: null });
  assert.deepEqual(closed, [HANDLE]);
});

test('a save over an existing entry reports a replace', async () => {
  assert.deepEqual(await harness({ hasEntry: true }).session.save('minimax', 'home', FAKE_KEY), { ok: true, value: { replaced: true } });
});

test('close is still sent when writePassword returns -1', async () => {
  const { session, sent } = harness({ writePassword: -1 });
  assert.deepEqual(await session.save('minimax', 'home', FAKE_KEY), { ok: false, code: WALLET_ERROR.WRITE_FAILED });
  assert.deepEqual(sent, ['localWallet', 'openAsync', 'hasEntry', 'writePassword', 'close']);
});

test('close is still sent when hasEntry gets no reply, and that no reply after open has its own code', async () => {
  const { session, sent } = harness({ hasEntry: NO_REPLY });
  assert.deepEqual(await session.save('minimax', 'home', FAKE_KEY), { ok: false, code: WALLET_ERROR.NO_ANSWER_AFTER_OPEN });
  assert.deepEqual(sent, ['localWallet', 'openAsync', 'hasEntry', 'close']);
});

test('a handle of -1 in the opened signal is a locked wallet and nothing is closed', async () => {
  const { session, sent } = harness({ opened: -1 });
  assert.deepEqual(await session.save('minimax', 'home', FAKE_KEY), { ok: false, code: WALLET_ERROR.LOCKED });
  assert.deepEqual(sent, ['localWallet', 'openAsync']);
});

test('no reply on openAsync is the plain no answer code, and a missing kwalletd is not running', async () => {
  assert.deepEqual(await harness({ openAsync: NO_REPLY }).session.unlock(), { ok: false, code: WALLET_ERROR.NO_ANSWER });
  const missing = harness({ localWallet: SERVICE_UNKNOWN });
  assert.deepEqual(await missing.session.unlock(), { ok: false, code: WALLET_ERROR.NOT_RUNNING });
  assert.deepEqual(missing.sent, ['localWallet']);
});

test('a transaction id that is not a number is a failure', async () => {
  assert.deepEqual(await harness({ openAsync: 'x' }).session.unlock(), { ok: false, code: WALLET_ERROR.FAILED });
  assert.deepEqual(await harness({ openAsync: -1 }).session.unlock(), { ok: false, code: WALLET_ERROR.FAILED });
});

test('a wallet that opens after the wait gave up is closed as soon as its signal comes', async () => {
  const { session, sent, closed, timers } = harness({}, 'never');
  const unlocking = session.unlock();
  await settle();
  timers[0].fire();
  assert.deepEqual(await unlocking, { ok: false, code: WALLET_ERROR.NO_ANSWER });
  assert.deepEqual(closed, []);
  session.opened(TRANSACTION, HANDLE);
  await settle();
  assert.deepEqual(closed, [HANDLE]);
  assert.deepEqual(sent, ['localWallet', 'openAsync', 'close']);
  session.opened(TRANSACTION, HANDLE);
  await settle();
  assert.deepEqual(closed, [HANDLE]);
});

test('a late signal that says the wallet stayed locked closes nothing', async () => {
  const { session, closed, timers } = harness({}, 'never');
  const unlocking = session.unlock();
  await settle();
  timers[0].fire();
  await unlocking;
  session.opened(TRANSACTION, -1);
  await settle();
  assert.deepEqual(closed, []);
});

test('signals of other programs are never acted on and only the newest few are kept', async () => {
  const { session, sent } = harness({ openAsync: 500 }, 'never');
  for (let transaction = 1000; transaction < 1000 + MAX_EARLY_SIGNALS + 5; transaction += 1) {
    session.opened(transaction, 3);
  }
  await settle();
  assert.deepEqual(sent, []);
});

test('a failed close does not change a successful result', async () => {
  assert.deepEqual(await harness({ close: NO_REPLY }).session.save('minimax', 'home', FAKE_KEY), { ok: true, value: { replaced: false } });
});

test('remove checks the entry, sends removeEntry then close, and a result of -1 is a remove failure', async () => {
  const good = harness({ hasEntry: true });
  assert.deepEqual(await good.session.remove('minimax', 'home'), { ok: true, value: { removed: true } });
  assert.deepEqual(good.sent, ['localWallet', 'openAsync', 'hasEntry', 'removeEntry', 'close']);
  const bad = harness({ hasEntry: true, removeEntry: -1 });
  assert.deepEqual(await bad.session.remove('minimax', 'home'), { ok: false, code: WALLET_ERROR.REMOVE_FAILED });
  assert.deepEqual(bad.sent, ['localWallet', 'openAsync', 'hasEntry', 'removeEntry', 'close']);
});

test('removing an entry that is not in the wallet succeeds without removeEntry', async () => {
  const { session, sent } = harness({ hasEntry: false });
  assert.deepEqual(await session.remove('minimax', 'home'), { ok: true, value: { removed: false } });
  assert.deepEqual(sent, ['localWallet', 'openAsync', 'hasEntry', 'close']);
});

test('unlock opens the wallet, which makes KWallet ask for the password, and closes it again', async () => {
  const { session, sent } = harness({});
  assert.deepEqual(await session.unlock(), { ok: true, value: null });
  assert.deepEqual(sent, ['localWallet', 'openAsync', 'close']);
});

test('an invalid key sends nothing', async () => {
  const { session, sent } = harness({});
  assert.deepEqual(await session.save('minimax', 'home', 'two words'), { ok: false, code: WALLET_ERROR.INVALID_KEY });
  assert.deepEqual(sent, []);
});

test('wallet work runs one at a time: the second job starts only after the first has closed the wallet', async () => {
  let releaseWrite = null;
  const sent = [];
  let session = null;
  const call = (message) => {
    sent.push(message.member);
    if (message.member === 'writePassword') {
      return new Promise((resolve) => { releaseWrite = () => resolve(0); });
    }
    if (message.member === 'openAsync') {
      setTimeout(() => session.opened(TRANSACTION, HANDLE), 0);
      return Promise.resolve(TRANSACTION);
    }
    return Promise.resolve({ localWallet: 'Login', hasEntry: false, close: 1 }[message.member]);
  };
  session = createWalletSession(call, () => () => null);
  const saving = session.save('minimax', 'home', FAKE_KEY);
  const unlocking = session.unlock();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(sent, ['localWallet', 'openAsync', 'hasEntry', 'writePassword']);
  releaseWrite();
  await Promise.all([saving, unlocking]);
  assert.deepEqual(sent, ['localWallet', 'openAsync', 'hasEntry', 'writePassword', 'close', 'localWallet', 'openAsync', 'close']);
});

test('a call that throws instead of rejecting still settles as a failure', async () => {
  const call = () => { throw new Error('bus gone'); };
  assert.deepEqual(await createWalletSession(call, () => () => null).unlock(), { ok: false, code: WALLET_ERROR.FAILED });
});

test('the time to wait for the opened signal can be shortened', async () => {
  const timers = [];
  const call = (message) => Promise.resolve({ localWallet: 'Login', openAsync: TRANSACTION }[message.member]);
  const session = createWalletSession(call, (ms, fire) => { timers.push({ ms: ms, fire: fire }); return () => null; }, 3000);
  const unlocking = session.unlock();
  await settle();
  assert.equal(timers[0].ms, 3000);
  timers[0].fire();
  assert.deepEqual(await unlocking, { ok: false, code: WALLET_ERROR.NO_ANSWER });
});

test('the session reports how many opens wait for KWallet, so the view can say so', async () => {
  const counts = [];
  let session = null;
  const call = (message) => {
    if (message.member === 'openAsync') {
      setTimeout(() => session.opened(TRANSACTION, HANDLE), 0);
    }
    return Promise.resolve({ localWallet: 'Login', openAsync: TRANSACTION, close: 1 }[message.member]);
  };
  session = createWalletSession(call, () => () => null, 1000, (count) => counts.push(count));
  await session.unlock();
  assert.deepEqual(counts, [1, 0]);
  const timers = [];
  const late = createWalletSession((message) => Promise.resolve({ localWallet: 'Login', openAsync: TRANSACTION }[message.member]), (ms, fire) => { timers.push(fire); return () => null; }, 1000, (count) => counts.push(count));
  const waiting = late.unlock();
  await settle();
  timers[0]();
  await waiting;
  assert.deepEqual(counts, [1, 0, 1, 0]);
});

test('cancel stops the wait at once, and a handle that opens later is still closed', async () => {
  const { session, closed, timers } = harness({}, 'never');
  const unlocking = session.unlock();
  await settle();
  session.cancelWaiting();
  assert.deepEqual(await unlocking, { ok: false, code: WALLET_ERROR.CANCELLED });
  assert.equal(timers[0].cancelled, true);
  session.opened(TRANSACTION, HANDLE);
  await settle();
  assert.deepEqual(closed, [HANDLE]);
});

test('cancel also drops wallet work that was queued behind the wait', async () => {
  const { session, sent } = harness({}, 'never');
  const first = session.unlock();
  const second = session.save('minimax', 'home', FAKE_KEY);
  await settle();
  session.cancelWaiting();
  assert.deepEqual(await first, { ok: false, code: WALLET_ERROR.CANCELLED });
  assert.deepEqual(await second, { ok: false, code: WALLET_ERROR.CANCELLED });
  assert.deepEqual(sent, ['localWallet', 'openAsync']);
});

test('wallet work queued after a cancel runs normally', async () => {
  const { session } = harness({}, 'early');
  session.cancelWaiting();
  assert.deepEqual(await session.unlock(), { ok: true, value: null });
});

test('the wait time can come from a function, read at each wait', async () => {
  let limit = 1000;
  const timers = [];
  const call = (message) => Promise.resolve({ localWallet: 'Login', openAsync: TRANSACTION }[message.member]);
  const session = createWalletSession(call, (ms, fire) => { timers.push({ ms: ms, fire: fire }); return () => null; }, () => limit);
  limit = 2500;
  const unlocking = session.unlock();
  await settle();
  assert.equal(timers[0].ms, 2500);
  timers[0].fire();
  await unlocking;
});
