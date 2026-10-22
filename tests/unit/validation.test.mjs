import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LABEL_PATTERN, isValidLabel, assertValidLabel } from '../../package/contents/code/core/validation.mjs';

test('accepts a label that starts with a letter or digit and has up to 32 characters', () => {
  assert.equal(isValidLabel('default'), true);
  assert.equal(isValidLabel('Work_2-b'), true);
  assert.equal(isValidLabel('7days'), true);
  assert.equal(isValidLabel('a'.repeat(32)), true);
});

test('rejects empty, too long and non string labels', () => {
  assert.equal(isValidLabel(''), false);
  assert.equal(isValidLabel('a'.repeat(33)), false);
  assert.equal(isValidLabel(undefined), false);
  assert.equal(isValidLabel(42), false);
});

test('rejects a label that starts with a dash or an underscore, so it cannot look like a command option', () => {
  assert.equal(isValidLabel('-x'), false);
  assert.equal(isValidLabel('--help'), false);
  assert.equal(isValidLabel('_hidden'), false);
});

test('rejects a trailing newline', () => {
  assert.equal(isValidLabel('work\n'), false);
  assert.equal(LABEL_PATTERN.test('work\n'), false);
});

test('rejects every shell meta character that could inject a command', () => {
  const attacks = ['a b', 'a;rm', 'a|b', 'a&b', '$(id)', '`id`', 'a>b', 'a<b', "a'b", 'a"b', 'a\\b', 'a\nb', 'a*', 'a/b', '../x', 'a.b', 'zaż'];
  for (const attack of attacks) {
    assert.equal(isValidLabel(attack), false, attack);
  }
});

test('assertValidLabel throws a named error for an invalid label', () => {
  assert.throws(() => assertValidLabel('a;b', 'account'), /account name is not allowed/);
  assert.equal(assertValidLabel('ok', 'account'), 'ok');
});
