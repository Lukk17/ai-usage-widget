import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PERCENT, SECOND_MS, MINUTE_MS, HOUR_MS, DAY_MS, WEEK_MS } from '../../package/contents/code/core/units.mjs';

test('the time units build on each other', () => {
  assert.equal(SECOND_MS, 1000);
  assert.equal(MINUTE_MS, 60 * SECOND_MS);
  assert.equal(HOUR_MS, 60 * MINUTE_MS);
  assert.equal(DAY_MS, 24 * HOUR_MS);
  assert.equal(WEEK_MS, 7 * DAY_MS);
});

test('a percentage is out of 100', () => {
  assert.equal(PERCENT, 100);
});
