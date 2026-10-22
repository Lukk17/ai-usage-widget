import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toFiniteNumber, parseIsoTime, isPlainObject, randomHex } from '../../package/contents/code/core/values.mjs';

test('toFiniteNumber accepts numbers and decimal strings', () => {
  assert.equal(toFiniteNumber(12.5), 12.5);
  assert.equal(toFiniteNumber('123.45'), 123.45);
  assert.equal(toFiniteNumber('-7'), -7);
  assert.equal(toFiniteNumber('7525000000'), 7525000000);
});

test('toFiniteNumber rejects anything that is not a plain number', () => {
  for (const value of [null, undefined, '', ' ', 'abc', '1e', 'e5', '1.e5', '0x10', '12abc', Number.NaN, Infinity, {}, [], true]) {
    assert.equal(toFiniteNumber(value), null, String(value));
  }
});

test('parseIsoTime reads an RFC 3339 timestamp and rejects other values', () => {
  assert.equal(parseIsoTime('2026-10-18T12:00:00Z'), Date.UTC(2026, 9, 18, 12));
  assert.equal(parseIsoTime('2026-10-18T14:00:00.500+02:00'), Date.UTC(2026, 9, 18, 12, 0, 0, 500));
  assert.equal(parseIsoTime('tomorrow'), null);
  assert.equal(parseIsoTime('2026-10-18'), null);
  assert.equal(parseIsoTime(1760000000), null);
  assert.equal(parseIsoTime(null), null);
});

test('isPlainObject is true only for non array objects', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject('x'), false);
});

test('toFiniteNumber turns a decimal string too large for a number into null', () => {
  assert.equal(toFiniteNumber('9'.repeat(400)), null);
  assert.equal(toFiniteNumber('-' + '9'.repeat(400)), null);
});

test('randomHex gives the asked number of hex digits from the random source', () => {
  const values = [0, 0.5, 0.99];
  assert.equal(randomHex(3, () => values.shift()), '08f');
  assert.match(randomHex(24), /^[0-9a-f]{24}$/);
});

test('toFiniteNumber accepts exponent notation in a decimal string', () => {
  assert.equal(toFiniteNumber('1e-5'), 1e-5);
  assert.equal(toFiniteNumber('-2.5E+3'), -2500);
  assert.equal(toFiniteNumber('7e0'), 7);
});
