import * as Wallet from './walletMessages.mjs';
import { SECOND_MS } from './units.mjs';

export const OPEN_WAIT_MS = 120 * SECOND_MS;
export const MAX_EARLY_SIGNALS = 20;

const NO_HANDLE = -1;

function failureCode(failure, isOpen) {
  if (failure && typeof failure.code === 'string') {
    return failure.code;
  }
  const code = Wallet.errorForDbus(failure && typeof failure.name === 'string' ? failure.name : '');
  return isOpen && code === Wallet.WALLET_ERROR.NO_ANSWER ? Wallet.WALLET_ERROR.NO_ANSWER_AFTER_OPEN : code;
}

function checked(failureCode) {
  return (result) => {
    const error = Wallet.errorForResult(result, failureCode);
    if (error) {
      throw { code: error };
    }
    return null;
  };
}

export function createWalletSession(call, schedule, openWaitMs, onWaiting) {
  const waitMs = () => (typeof openWaitMs === 'function' ? openWaitMs() : openWaitMs) || OPEN_WAIT_MS;
  const reportWaiting = onWaiting || (() => null);
  let queue = Promise.resolve();
  let generation = 0;
  const waiting = new Map();
  const early = new Map();
  const abandoned = new Set();

  function send(message) {
    return Promise.resolve().then(() => call(message));
  }

  function closeQuietly(handle) {
    return typeof handle !== 'number' || handle < 0 ? Promise.resolve() : send(Wallet.closeMessage(handle)).then(() => null, () => null);
  }

  function opened(transaction, handle) {
    if (waiting.has(transaction)) {
      const waiter = waiting.get(transaction);
      waiting.delete(transaction);
      reportWaiting(waiting.size);
      waiter.cancel();
      waiter.resolve(handle);
      return;
    }
    if (abandoned.has(transaction)) {
      abandoned.delete(transaction);
      closeQuietly(handle);
      return;
    }
    early.set(transaction, handle);
    if (early.size > MAX_EARLY_SIGNALS) {
      early.delete(early.keys().next().value);
    }
  }

  function waitForOpen(transaction) {
    if (typeof transaction !== 'number' || transaction < 0) {
      return Promise.reject({ code: Wallet.WALLET_ERROR.FAILED });
    }
    if (early.has(transaction)) {
      const handle = early.get(transaction);
      early.delete(transaction);
      return Promise.resolve(handle);
    }
    return new Promise((resolve, reject) => {
      const cancel = schedule(waitMs(), () => {
        waiting.delete(transaction);
        reportWaiting(waiting.size);
        abandoned.add(transaction);
        reject({ code: Wallet.WALLET_ERROR.NO_ANSWER });
      });
      waiting.set(transaction, { resolve: resolve, reject: reject, cancel: cancel });
      reportWaiting(waiting.size);
    });
  }

  function withWallet(action) {
    let handle = NO_HANDLE;
    return send(Wallet.localWalletMessage())
      .then((walletName) => send(Wallet.openAsyncMessage(walletName)))
      .then(waitForOpen)
      .then((opened) => {
        const error = Wallet.errorForHandle(opened);
        if (error) {
          throw { code: error };
        }
        handle = opened;
        return action(handle);
      })
      .then((value) => closeQuietly(handle).then(() => ({ ok: true, value: value })),
        (failure) => closeQuietly(handle).then(() => ({ ok: false, code: failureCode(failure, handle !== NO_HANDLE) })));
  }

  function enqueue(job) {
    const enqueuedIn = generation;
    const result = queue.then(() => (enqueuedIn === generation ? job() : { ok: false, code: Wallet.WALLET_ERROR.CANCELLED }));
    queue = result.then(() => null, () => null);
    return result;
  }

  function save(providerId, account, key) {
    if (!Wallet.isValidKey(key)) {
      return Promise.resolve({ ok: false, code: Wallet.WALLET_ERROR.INVALID_KEY });
    }
    return enqueue(() => withWallet((handle) => send(Wallet.hasEntryMessage(handle, providerId, account))
      .then((existed) => send(Wallet.writePasswordMessage(handle, providerId, account, key))
        .then(checked(Wallet.WALLET_ERROR.WRITE_FAILED))
        .then(() => ({ replaced: existed === true })))));
  }

  function remove(providerId, account) {
    return enqueue(() => withWallet((handle) => send(Wallet.hasEntryMessage(handle, providerId, account))
      .then((existed) => (existed === true
        ? send(Wallet.removeEntryMessage(handle, providerId, account)).then(checked(Wallet.WALLET_ERROR.REMOVE_FAILED)).then(() => ({ removed: true }))
        : { removed: false }))));
  }

  function unlock() {
    return enqueue(() => withWallet(() => null));
  }

  function cancelWaiting() {
    generation += 1;
    Array.from(waiting.keys()).forEach((transaction) => {
      const waiter = waiting.get(transaction);
      waiting.delete(transaction);
      abandoned.add(transaction);
      waiter.cancel();
      waiter.reject({ code: Wallet.WALLET_ERROR.CANCELLED });
    });
    reportWaiting(waiting.size);
  }

  return { save: save, remove: remove, unlock: unlock, opened: opened, cancelWaiting: cancelWaiting };
}
