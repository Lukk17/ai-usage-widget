import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as Wallet from '../../package/contents/code/core/walletMessages.mjs';

const FAKE_KEY = 'sk-fake-key-for-tests';

function target(message) {
  return [message.service, message.path, message.iface, message.member, message.signature];
}

test('the wallet is reached through kwalletd6 on the session bus, in one ai-usage folder', () => {
  assert.equal(Wallet.WALLET_SERVICE, 'org.kde.kwalletd6');
  assert.equal(Wallet.WALLET_PATH, '/modules/kwalletd6');
  assert.equal(Wallet.WALLET_INTERFACE, 'org.kde.KWallet');
  assert.equal(Wallet.WALLET_FOLDER, 'ai-usage');
  assert.equal(Wallet.WALLET_APP_ID, 'ai-usage-widget');
});

test('an entry is named provider dot account, and only checked names are accepted', () => {
  assert.equal(Wallet.entryName('minimax', 'home'), 'minimax.home');
  assert.throws(() => Wallet.entryName('minimax', 'a.b'), /account name is not allowed/);
  assert.throws(() => Wallet.entryName('--x', 'home'), /provider name is not allowed/);
});

test('a key must be plain ASCII without spaces or line breaks, like the check needs it', () => {
  assert.equal(Wallet.isValidKey(FAKE_KEY), true);
  for (const key of ['', 'two words', 'line\nbreak', 'zaż', 'x'.repeat(4097), null]) {
    assert.equal(Wallet.isValidKey(key), false, JSON.stringify(key));
  }
});

test('every message names the service, the path, the interface, the member and a parenthesised signature', () => {
  assert.deepEqual(target(Wallet.localWalletMessage()), ['org.kde.kwalletd6', '/modules/kwalletd6', 'org.kde.KWallet', 'localWallet', '']);
  assert.deepEqual(Wallet.localWalletMessage().arguments, []);
  assert.deepEqual(target(Wallet.openAsyncMessage('kdewallet')), ['org.kde.kwalletd6', '/modules/kwalletd6', 'org.kde.KWallet', 'openAsync', '(sxsb)']);
  assert.deepEqual(Wallet.openAsyncMessage('kdewallet').arguments, ['kdewallet', 0, 'ai-usage-widget', false]);
});

test('write, has, remove and close carry the handle, the folder and the entry name', () => {
  assert.deepEqual(Wallet.writePasswordMessage(7, 'minimax', 'home', FAKE_KEY).arguments, [7, 'ai-usage', 'minimax.home', FAKE_KEY, 'ai-usage-widget']);
  assert.equal(Wallet.writePasswordMessage(7, 'minimax', 'home', FAKE_KEY).signature, '(issss)');
  assert.deepEqual(Wallet.hasEntryMessage(7, 'minimax', 'home').arguments, [7, 'ai-usage', 'minimax.home', 'ai-usage-widget']);
  assert.equal(Wallet.hasEntryMessage(7, 'minimax', 'home').signature, '(isss)');
  assert.deepEqual(Wallet.removeEntryMessage(7, 'minimax', 'home').arguments, [7, 'ai-usage', 'minimax.home', 'ai-usage-widget']);
  assert.equal(Wallet.removeEntryMessage(7, 'minimax', 'home').signature, '(isss)');
  assert.deepEqual(Wallet.closeMessage(7).arguments, [7, false, 'ai-usage-widget']);
  assert.equal(Wallet.closeMessage(7).signature, '(ibs)');
});

test('a key that breaks the rule is never put into a message', () => {
  assert.throws(() => Wallet.writePasswordMessage(7, 'minimax', 'home', 'two words'), /key/);
});

test('there is no builder that reads a key back', () => {
  assert.equal(Object.keys(Wallet).some((name) => /read/i.test(name)), false);
});

test('D-Bus errors map to not running, no answer or a general failure', () => {
  assert.equal(Wallet.errorForDbus('org.freedesktop.DBus.Error.ServiceUnknown'), Wallet.WALLET_ERROR.NOT_RUNNING);
  assert.equal(Wallet.errorForDbus('org.freedesktop.DBus.Error.NameHasNoOwner'), Wallet.WALLET_ERROR.NOT_RUNNING);
  assert.equal(Wallet.errorForDbus('org.freedesktop.DBus.Error.NoReply'), Wallet.WALLET_ERROR.NO_ANSWER);
  assert.equal(Wallet.errorForDbus('org.freedesktop.DBus.Error.Timeout'), Wallet.WALLET_ERROR.NO_ANSWER);
  assert.equal(Wallet.errorForDbus('org.freedesktop.DBus.Error.UnknownMethod'), Wallet.WALLET_ERROR.FAILED);
});

test('a negative handle means the wallet is locked or could not be opened', () => {
  assert.equal(Wallet.errorForHandle(1234), null);
  assert.equal(Wallet.errorForHandle(0), null);
  assert.equal(Wallet.errorForHandle(-1), Wallet.WALLET_ERROR.LOCKED);
  assert.equal(Wallet.errorForHandle('x'), Wallet.WALLET_ERROR.FAILED);
});

test('a write or remove result of 0 is success, anything else is its own failure', () => {
  assert.equal(Wallet.errorForResult(0, Wallet.WALLET_ERROR.WRITE_FAILED), null);
  assert.equal(Wallet.errorForResult(-1, Wallet.WALLET_ERROR.WRITE_FAILED), Wallet.WALLET_ERROR.WRITE_FAILED);
  assert.equal(Wallet.errorForResult(-1, Wallet.WALLET_ERROR.REMOVE_FAILED), Wallet.WALLET_ERROR.REMOVE_FAILED);
});

test('an invalid key sends no message and returns INVALID_KEY', async () => {
  const { createWalletSession } = await import('../../package/contents/code/core/walletSession.mjs');
  const sent = [];
  const result = await createWalletSession((message) => { sent.push(message.member); return Promise.resolve(0); }).save('minimax', 'home', 'two words');
  assert.deepEqual(result, { ok: false, code: Wallet.WALLET_ERROR.INVALID_KEY });
  assert.deepEqual(sent, []);
});

test('a reply value is unwrapped from the typed D-Bus value the QML module returns', () => {
  assert.equal(Wallet.unwrapValue({ value: 'Login' }), 'Login');
  assert.equal(Wallet.unwrapValue(5), 5);
  assert.deepEqual(Wallet.unwrapValue(['minimax.home']), ['minimax.home']);
  assert.equal(Wallet.unwrapValue(null), null);
});
