import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAccountActions, INVALID } from '../../package/contents/code/core/accountActions.mjs';
import { WALLET_ERROR } from '../../package/contents/code/core/walletMessages.mjs';
import { findProvider } from '../../package/contents/code/providers/registry.mjs';

const KEY = 'sk-fake-key-for-tests';

function harness(initial, walletAnswers, ids, settings) {
  const queue = (ids || []).slice();
  const options = Object.assign({ fail: false, file: null }, settings || {});
  const state = { accounts: initial || [], saved: [], removed: [], rechecks: [], updates: 0 };
  const answers = Object.assign({ save: { ok: true, value: { replaced: false } }, remove: { ok: true, value: { removed: true } } }, walletAnswers || {});
  const actions = createAccountActions({
    wallet: {
      save: (providerId, id, key) => { state.saved.push([providerId, id, key]); return Promise.resolve(answers.save); },
      remove: (providerId, id) => { state.removed.push([providerId, id]); return Promise.resolve(answers.remove); },
    },
    getAccounts: () => state.accounts,
    updateAccounts: (change) => {
      state.updates += 1;
      if (options.fail) {
        return Promise.reject(new Error('the settings file was not saved'));
      }
      state.accounts = change(options.file || state.accounts);
      return Promise.resolve(state.accounts);
    },
    findProvider: findProvider,
    newId: () => (queue.length > 0 ? queue.shift() : 'anew000000000'),
    recheck: (id) => state.rechecks.push(id),
  });
  return { actions, state };
}

test('adding a key account saves the key under the new id first, then stores the account and checks it', async () => {
  const { actions, state } = harness();
  const result = await actions.add({ service: 'minimax', name: ' me@example.com ', key: KEY, fields: {} });
  assert.deepEqual(result, { ok: true, action: 'add', title: 'MiniMax', name: 'me@example.com', id: 'anew000000000' });
  assert.deepEqual(state.saved, [['minimax', 'anew000000000', KEY]]);
  assert.deepEqual(state.accounts, [{ id: 'anew000000000', service: 'minimax', name: 'me@example.com' }]);
  assert.deepEqual(state.rechecks, ['anew000000000']);
});

test('a wallet that fails keeps the account out of the list', async () => {
  const { actions, state } = harness([], { save: { ok: false, code: WALLET_ERROR.LOCKED } });
  assert.deepEqual(await actions.add({ service: 'minimax', name: 'me', key: KEY }), { ok: false, invalid: '', walletCode: WALLET_ERROR.LOCKED });
  assert.deepEqual(state.accounts, []);
  assert.deepEqual(state.rechecks, []);
});

test('an account without a key service is stored without touching the wallet', async () => {
  const { actions, state } = harness();
  const result = await actions.add({ service: 'claude', name: 'me', fields: { org: '00000000-0000-4000-8000-0000000000aa' } });
  assert.equal(result.ok, true);
  assert.deepEqual(state.saved, []);
  assert.deepEqual(state.accounts, [{ id: 'anew000000000', service: 'claude', name: 'me', org: '00000000-0000-4000-8000-0000000000aa' }]);
});

test('a missing key, name, field or service is refused before anything is saved', async () => {
  const { actions, state } = harness();
  assert.equal((await actions.add({ service: 'minimax', name: 'me', key: '' })).invalid, INVALID.KEY);
  assert.equal((await actions.add({ service: 'minimax', name: '', key: KEY })).invalid, INVALID.NAME);
  assert.equal((await actions.add({ service: 'xai', name: 'team', key: KEY, fields: { teamId: '../x' } })).invalid, INVALID.FIELD);
  assert.equal((await actions.add({ service: 'gone', name: 'me', key: KEY })).invalid, INVALID.SERVICE);
  assert.deepEqual(state.saved, []);
  assert.deepEqual(state.accounts, []);
});

test('editing changes the name and fields, an empty key keeps the saved key, and nothing is checked at once', async () => {
  const { actions, state } = harness([{ id: 'a1', service: 'xai', name: 'old', teamId: 'team-1' }]);
  const result = await actions.edit('a1', { name: 'new', key: '', fields: { teamId: 'team-2' } });
  assert.deepEqual(result, { ok: true, action: 'edit', title: 'xAI API', name: 'new', id: 'a1' });
  assert.deepEqual(state.accounts, [{ id: 'a1', service: 'xai', name: 'new', teamId: 'team-2' }]);
  assert.deepEqual(state.saved, []);
  assert.deepEqual(state.rechecks, []);
});

test('editing with a new key replaces the key under the same id and checks the account at once', async () => {
  const { actions, state } = harness([{ id: 'a1', service: 'minimax', name: 'old' }]);
  await actions.edit('a1', { name: 'old', key: KEY });
  assert.deepEqual(state.saved, [['minimax', 'a1', KEY]]);
  assert.deepEqual(state.rechecks, ['a1']);
  const failing = harness([{ id: 'a1', service: 'minimax', name: 'old' }], { save: { ok: false, code: WALLET_ERROR.WRITE_FAILED } });
  assert.deepEqual(await failing.actions.edit('a1', { name: 'new', key: KEY }), { ok: false, invalid: '', walletCode: WALLET_ERROR.WRITE_FAILED });
  assert.equal(failing.state.accounts[0].name, 'old');
});

test('editing a Claude account keeps its organization', async () => {
  const { actions, state } = harness([{ id: 'a1', service: 'claude', name: 'old', org: 'org-1' }]);
  await actions.edit('a1', { name: 'new' });
  assert.deepEqual(state.accounts, [{ id: 'a1', service: 'claude', name: 'new', org: 'org-1' }]);
});

test('editing an unknown account or with a bad name is refused', async () => {
  const { actions } = harness([{ id: 'a1', service: 'minimax', name: 'old' }]);
  assert.equal((await actions.edit('nope', { name: 'x' })).invalid, INVALID.ACCOUNT);
  assert.equal((await actions.edit('a1', { name: ' ' })).invalid, INVALID.NAME);
});

test('deleting removes the key from the wallet and then the account', async () => {
  const { actions, state } = harness([{ id: 'a1', service: 'minimax', name: 'home' }, { id: 'a2', service: 'claude', name: 'me', org: 'org-1' }]);
  assert.deepEqual(await actions.remove('a1'), { ok: true, action: 'remove', title: 'MiniMax', name: 'home', id: 'a1' });
  assert.deepEqual(state.removed, [['minimax', 'a1']]);
  assert.deepEqual(state.accounts.map((item) => item.id), ['a2']);
  await actions.remove('a2');
  assert.deepEqual(state.removed, [['minimax', 'a1']]);
  assert.deepEqual(state.accounts, []);
});

test('a wallet that cannot remove the key keeps the account, and an unknown id is refused', async () => {
  const { actions, state } = harness([{ id: 'a1', service: 'minimax', name: 'home' }], { remove: { ok: false, code: WALLET_ERROR.LOCKED } });
  assert.deepEqual(await actions.remove('a1'), { ok: false, invalid: '', walletCode: WALLET_ERROR.LOCKED });
  assert.equal(state.accounts.length, 1);
  assert.equal((await actions.remove('nope')).invalid, INVALID.ACCOUNT);
});

test('a pasted key is trimmed before it is saved, on add and on edit', async () => {
  const { actions, state } = harness([{ id: 'a1', service: 'minimax', name: 'old' }]);
  await actions.add({ service: 'minimax', name: 'me', key: '  ' + KEY + '\n' });
  await actions.edit('a1', { name: 'old', key: KEY + '\r\n' });
  assert.deepEqual(state.saved.map((item) => item[2]), [KEY, KEY]);
  assert.equal((await actions.add({ service: 'minimax', name: 'me', key: ' \n ' })).invalid, INVALID.KEY);
});

test('addMany adds every named item in order and skips the unnamed ones', async () => {
  const { actions, state } = harness([], {}, ['afirst0000000', 'asecond000000']);
  const result = await actions.addMany('claude', [{ name: 'one', fields: { org: 'org-1' } }, { name: ' ', fields: { org: 'org-2' } }, { name: 'three', fields: { org: 'org-3' } }]);
  assert.equal(result.ok, true);
  assert.deepEqual(state.accounts.map((item) => [item.id, item.name, item.org]), [['afirst0000000', 'one', 'org-1'], ['asecond000000', 'three', 'org-3']]);
});

test('addMany refuses when no item has a name, and stops at the first failure', async () => {
  const { actions, state } = harness();
  assert.equal((await actions.addMany('claude', [{ name: '', fields: { org: 'org-1' } }])).invalid, INVALID.NAME);
  assert.equal((await actions.addMany('claude', undefined)).invalid, INVALID.NAME);
  const failed = await actions.addMany('claude', [{ name: 'bad', fields: { org: '../x' } }, { name: 'good', fields: { org: 'org-2' } }]);
  assert.equal(failed.invalid, INVALID.FIELD);
  assert.deepEqual(state.accounts, []);
});

test('a settings file that cannot be written fails the add and takes the new key out of the wallet again', async () => {
  const { actions, state } = harness([], {}, [], { fail: true });
  await assert.rejects(actions.add({ service: 'minimax', name: 'me', key: KEY }), /not saved/);
  assert.deepEqual(state.saved, [['minimax', 'anew000000000', KEY]]);
  assert.deepEqual(state.removed, [['minimax', 'anew000000000']]);
  assert.deepEqual(state.accounts, []);
  assert.deepEqual(state.rechecks, []);
});

test('the add still fails with the settings error when the wallet also cannot take the key back', async () => {
  const { actions, state } = harness([], { remove: { ok: false, code: WALLET_ERROR.REMOVE_FAILED } }, [], { fail: true });
  await assert.rejects(actions.add({ service: 'minimax', name: 'me', key: KEY }), /not saved/);
  assert.deepEqual(state.removed, [['minimax', 'anew000000000']]);
  assert.equal(state.updates, 1);
});

test('a settings file that cannot be written fails edit, delete and a no key add without a wallet clean up', async () => {
  const { actions, state } = harness([{ id: 'a1', service: 'claude', name: 'old', org: 'org-1' }], {}, [], { fail: true });
  await assert.rejects(actions.edit('a1', { name: 'new' }), /not saved/);
  await assert.rejects(actions.remove('a1'), /not saved/);
  await assert.rejects(actions.add({ service: 'claude', name: 'me', fields: { org: 'org-2' } }), /not saved/);
  assert.deepEqual(state.removed, []);
  assert.deepEqual(state.accounts, [{ id: 'a1', service: 'claude', name: 'old', org: 'org-1' }]);
});

test('every change is applied to the list the settings file holds now, so the account of another widget stays', async () => {
  const shared = [{ id: 'aother', service: 'claude', name: 'from the panel', org: 'org-9' }];
  const { actions, state } = harness([], {}, [], { file: shared });
  await actions.add({ service: 'claude', name: 'me', fields: { org: 'org-1' } });
  assert.deepEqual(state.accounts.map((item) => item.id), ['aother', 'anew000000000']);
});

test('a wallet that throws while it takes the key back still leaves the settings error', async () => {
  const removed = [];
  const actions = createAccountActions({
    wallet: {
      save: () => Promise.resolve({ ok: true, value: { replaced: false } }),
      remove: (providerId, id) => { removed.push([providerId, id]); return Promise.reject(new Error('the session bus is gone')); },
    },
    getAccounts: () => [],
    updateAccounts: () => Promise.reject(new Error('the settings file was not saved')),
    findProvider: findProvider,
    newId: () => 'anew000000000',
    recheck: () => assert.fail('nothing is checked'),
  });
  await assert.rejects(actions.add({ service: 'minimax', name: 'me', key: KEY }), /not saved/);
  assert.deepEqual(removed, [['minimax', 'anew000000000']]);
});
