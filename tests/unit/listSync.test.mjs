import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planListSync, applyPlan } from '../../package/contents/code/core/listSync.mjs';

function check(current, next) {
  const plan = planListSync(current, next);
  assert.deepEqual(applyPlan(current, plan), next, JSON.stringify([current, next]));
  return plan;
}

test('an unchanged list needs no operation', () => {
  assert.deepEqual(check(['a', 'b', 'c'], ['a', 'b', 'c']), []);
});

test('a new key is inserted where it belongs', () => {
  assert.deepEqual(check(['a', 'c'], ['a', 'b', 'c']), [{ op: 'insert', index: 1, key: 'b' }]);
});

test('a removed key is removed', () => {
  assert.deepEqual(check(['a', 'b', 'c'], ['a', 'c']), [{ op: 'remove', index: 1 }]);
});

test('a key that changed place is moved, never removed and inserted again', () => {
  const plan = check(['a', 'b', 'c'], ['c', 'a', 'b']);
  assert.deepEqual(plan, [{ op: 'move', from: 2, to: 0 }]);
});

test('mixed changes still end in the right order', () => {
  check([], ['x', 'y']);
  check(['x', 'y'], []);
  check(['a', 'b', 'c', 'd'], ['d', 'e', 'b']);
  check(['k1', 'k2', 'k3'], ['k3', 'k2', 'k1', 'k4']);
});
