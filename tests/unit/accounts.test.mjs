import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REFRESH_CHOICES_SECONDS,
  DEFAULT_REFRESH_SECONDS,
  MIN_MANUAL_REFRESH_SECONDS,
  MAX_ACCOUNT_NAME_LENGTH,
  refreshSeconds,
  cleanName,
  isValidName,
  isValidField,
  newAccountId,
  makeAccount,
  parseAccounts,
  serializeAccounts,
  withAccount,
  withoutAccount,
  cleanKey,
  newDiscoveries,
  areDiscoveryNamesValid,
  withOrder,
  withAccountMoved,
} from '../../package/contents/code/core/accounts.mjs';
import { isValidLabel } from '../../package/contents/code/core/validation.mjs';
import { findProvider } from '../../package/contents/code/providers/registry.mjs';

const XAI = findProvider('xai');
const MINIMAX = findProvider('minimax');

test('the refresh choices are 30 seconds and 1, 5, 15, 30 and 60 minutes, 30 seconds by default', () => {
  assert.deepEqual(REFRESH_CHOICES_SECONDS, [30, 60, 300, 900, 1800, 3600]);
  assert.equal(DEFAULT_REFRESH_SECONDS, 30);
  assert.equal(MIN_MANUAL_REFRESH_SECONDS, 30);
  assert.equal(refreshSeconds(900), 900);
  assert.equal(refreshSeconds('300'), 300);
  [undefined, null, 31, 0, 'abc', 86400].forEach((value) => assert.equal(refreshSeconds(value), 30, String(value)));
});

test('a name or email is trimmed, needs 1 to 100 characters and no control characters', () => {
  assert.equal(cleanName('  me@example.com '), 'me@example.com');
  assert.equal(cleanName(5), '');
  assert.equal(isValidName('Zażółć <b>work</b>'), true);
  assert.equal(isValidName('x'.repeat(MAX_ACCOUNT_NAME_LENGTH)), true);
  ['', '   ', 'x'.repeat(MAX_ACCOUNT_NAME_LENGTH + 1), 'line\nbreak', 'tab\there', 'bell\u0007', 'del\u007f', 'c1\u0085', 'line' + String.fromCharCode(0x2028) + 'separator', 'paragraph' + String.fromCharCode(0x2029) + 'separator', null].forEach((name) => assert.equal(isValidName(name), false, JSON.stringify(name)));
});

test('a field like a team ID is letters, digits and dashes only, so it is safe in a URL', () => {
  assert.equal(isValidField('65c1e471-205f-4566-9c5a-07198bcdf4ce'), true);
  ['', '-x', '../x', 'a b', 'a/b', 'a?b', 'x'.repeat(65), 5, undefined].forEach((value) => assert.equal(isValidField(value), false, String(value)));
});

test('a new account id is a valid label that no other account has', () => {
  const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const id = newAccountId(['a000000000000'], () => values.shift());
  assert.equal(id, 'a888888888888');
  assert.equal(isValidLabel(id), true);
  assert.match(newAccountId([]), /^a[0-9a-f]{12}$/);
});

test('makeAccount keeps the id, the service, the cleaned name and the fields the service needs', () => {
  assert.deepEqual(makeAccount(MINIMAX, 'a1', ' me ', { teamId: 'ignored' }), { id: 'a1', service: 'minimax', name: 'me' });
  assert.deepEqual(makeAccount(XAI, 'a2', 'team', { teamId: 'team-1' }), { id: 'a2', service: 'xai', name: 'team', teamId: 'team-1' });
  assert.equal(makeAccount(XAI, 'a2', 'team', {}), null);
  assert.equal(makeAccount(MINIMAX, '--x', 'me'), null);
  assert.equal(makeAccount(MINIMAX, 'a1', ''), null);
  assert.equal(makeAccount(null, 'a1', 'me'), null);
});

test('parseAccounts reads the saved JSON, skips broken or repeated accounts and unknown services', () => {
  const text = JSON.stringify([
    { id: 'a1', service: 'minimax', name: 'home' },
    { id: 'a1', service: 'requesty', name: 'repeat' },
    { id: 'a2', service: 'gone', name: 'x' },
    { id: 'a3', service: 'xai', name: 'no team' },
    { id: 'a4', service: 'xai', name: 'team', teamId: 'team-1', extra: 'dropped' },
    'nonsense',
  ]);
  assert.deepEqual(parseAccounts(text, findProvider), [
    { id: 'a1', service: 'minimax', name: 'home' },
    { id: 'a4', service: 'xai', name: 'team', teamId: 'team-1' },
  ]);
});

test('nothing saved, broken JSON or something else than a list means no accounts', () => {
  ['', '   ', undefined, null, '{not json', '{"a":1}', '5'].forEach((text) => assert.deepEqual(parseAccounts(text, findProvider), [], String(text)));
});

test('accounts are saved as JSON and read back the same', () => {
  const accounts = [{ id: 'a1', service: 'minimax', name: 'home' }, { id: 'a4', service: 'xai', name: 'team', teamId: 'team-1' }];
  assert.deepEqual(parseAccounts(serializeAccounts(accounts), findProvider), accounts);
  assert.equal(serializeAccounts(undefined), '[]');
});

test('withAccount adds a new account at the end and replaces one with the same id in place', () => {
  const one = { id: 'a1', service: 'minimax', name: 'one' };
  const two = { id: 'a2', service: 'minimax', name: 'two' };
  assert.deepEqual(withAccount([one], two), [one, two]);
  assert.deepEqual(withAccount([one, two], { id: 'a1', service: 'minimax', name: 'renamed' }).map((item) => item.name), ['renamed', 'two']);
  assert.deepEqual(withAccount(undefined, one), [one]);
});

test('withoutAccount removes one account and keeps the others', () => {
  const one = { id: 'a1', service: 'minimax', name: 'one' };
  const two = { id: 'a2', service: 'minimax', name: 'two' };
  assert.deepEqual(withoutAccount([one, two], 'a1'), [two]);
  assert.deepEqual(withoutAccount(undefined, 'a1'), []);
});

test('cleanKey trims a pasted key, so a trailing newline is not refused', () => {
  assert.equal(cleanKey('  sk-abc\n'), 'sk-abc');
  assert.equal(cleanKey(undefined), '');
});

test('newDiscoveries leaves out what an account of the same service already has', () => {
  const items = [{ fields: { org: 'org-a' } }, { fields: { org: 'org-b' } }];
  const accounts = [{ id: 'a1', service: 'claude', name: 'x', org: 'org-b' }, { id: 'a2', service: 'other', name: 'y', org: 'org-a' }];
  assert.deepEqual(newDiscoveries(items, accounts, 'claude').map((item) => item.fields.org), ['org-a']);
  assert.deepEqual(newDiscoveries(undefined, undefined, 'claude'), []);
});

test('the names for found organizations are valid when at least one is typed and every typed one is a valid name', () => {
  assert.equal(areDiscoveryNamesValid({ 'org-a': 'me@example.com', 'org-b': '' }), true);
  assert.equal(areDiscoveryNamesValid({ 'org-a': ' ', 'org-b': '' }), false);
  assert.equal(areDiscoveryNamesValid({ 'org-a': 'ok', 'org-b': 'bad' + String.fromCharCode(7) }), false);
  assert.equal(areDiscoveryNamesValid({}), false);
  assert.equal(areDiscoveryNamesValid(undefined), false);
  assert.equal(areDiscoveryNamesValid(Object.assign(Object.create(null), { constructor: 'me' })), true);
});

test('withOrder puts the accounts in the given id order, ignores unknown or repeated ids and keeps any missing account at the end', () => {
  const a = { id: 'a1', service: 'minimax', name: 'a' };
  const b = { id: 'a2', service: 'minimax', name: 'b' };
  const c = { id: 'a3', service: 'minimax', name: 'c' };
  assert.deepEqual(withOrder([a, b, c], ['a3', 'a1', 'a2']), [c, a, b]);
  assert.deepEqual(withOrder([a, b, c], ['a2', 'nope', 'a2']), [b, a, c]);
  assert.deepEqual(withOrder(undefined, undefined), []);
});

test('withAccountMoved moves one account up or down by one and refuses to move past the ends', () => {
  const a = { id: 'a1', service: 'minimax', name: 'a' };
  const b = { id: 'a2', service: 'minimax', name: 'b' };
  const c = { id: 'a3', service: 'minimax', name: 'c' };
  assert.deepEqual(withAccountMoved([a, b, c], 'a3', -1), [a, c, b]);
  assert.deepEqual(withAccountMoved([a, b, c], 'a1', 1), [b, a, c]);
  assert.deepEqual(withAccountMoved([a, b, c], 'a1', -1), [a, b, c]);
  assert.deepEqual(withAccountMoved([a, b, c], 'a3', 1), [a, b, c]);
  assert.deepEqual(withAccountMoved([a, b, c], 'nope', 1), [a, b, c]);
});
