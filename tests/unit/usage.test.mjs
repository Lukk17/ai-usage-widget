import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_NAME_LENGTH,
  PERIOD,
  LABEL,
  makeUsage,
  usageWindow,
  usageAmount,
  usageCount,
  usageText,
  periodForMinutes,
  cutName,
  succeeded,
  notAvailable,
} from '../../package/contents/code/core/usage.mjs';
import { ERROR_KIND, REASON } from '../../package/contents/code/core/http.mjs';

test('a window keeps its period, name, percent, reset time and validity and counts for the panel by default', () => {
  assert.deepEqual(usageWindow(PERIOD.FIVE_HOUR, 'MiniMax-M*', 20, 5), { period: 'five_hour', count: null, name: 'MiniMax-M*', usedPercent: 20, resetsAt: 5, validUntil: null, estimated: false, canBeMain: true });
  assert.equal(usageWindow(PERIOD.DAILY, 'speech-hd', 100, 5, { canBeMain: false }).canBeMain, false);
  assert.deepEqual(usageWindow(PERIOD.HOURS, '', 1, null, { count: 3, validUntil: 9 }), { period: 'hours', count: 3, name: '', usedPercent: 1, resetsAt: null, validUntil: 9, estimated: false, canBeMain: true });
});

test('window lengths in minutes become the 5hr, daily, weekly and monthly periods', () => {
  assert.deepEqual(periodForMinutes(300), { period: PERIOD.FIVE_HOUR, count: null });
  assert.deepEqual(periodForMinutes(1440), { period: PERIOD.DAILY, count: null });
  assert.deepEqual(periodForMinutes(10080), { period: PERIOD.WEEKLY, count: null });
  assert.deepEqual(periodForMinutes(28 * 1440), { period: PERIOD.MONTHLY, count: null });
  assert.deepEqual(periodForMinutes(31 * 1440), { period: PERIOD.MONTHLY, count: null });
  assert.deepEqual(periodForMinutes(299.6), { period: PERIOD.FIVE_HOUR, count: null });
});

test('other lengths are counted in days, hours or minutes, and a missing length is an interval', () => {
  assert.deepEqual(periodForMinutes(2 * 1440), { period: PERIOD.DAYS, count: 2 });
  assert.deepEqual(periodForMinutes(120), { period: PERIOD.HOURS, count: 2 });
  assert.deepEqual(periodForMinutes(45), { period: PERIOD.MINUTES, count: 45 });
  [null, undefined, 0, -5, Number.NaN, '300'].forEach((value) => assert.deepEqual(periodForMinutes(value), { period: PERIOD.INTERVAL, count: null }, String(value)));
});

test('amounts, counts and texts are plain records, and money is in US dollars unless a currency is given', () => {
  assert.deepEqual(usageAmount(LABEL.SPENT_THIS_MONTH, '', 1.5, 10, false), { label: 'spent_this_month', name: '', value: 1.5, limit: 10, noLimit: false, currency: 'usd', problem: null });
  assert.equal(usageAmount(LABEL.SPENT_THIS_MONTH, '', 1, null, false, 'eur').currency, 'eur');
  assert.deepEqual(usageCount(LABEL.INPUT_TOKENS_THIS_MONTH, 7), { label: 'input_tokens_this_month', value: 7 });
  assert.deepEqual(usageText(LABEL.PLAN, 'PRO'), { label: 'plan', value: 'PRO' });
  assert.equal(usageAmount(LABEL.SPENT_THIS_MONTH, '', 1, null, false, 'x'.repeat(100)).currency.length, MAX_NAME_LENGTH);
});

test('a long name from a service is cut to the maximum length', () => {
  const huge = 'x'.repeat(2 * 1024 * 1024);
  const cut = cutName(huge);
  assert.equal(cut.length, MAX_NAME_LENGTH);
  assert.ok(cut.endsWith('...'));
  assert.equal(usageWindow(PERIOD.FIVE_HOUR, huge, 1, null).name.length, MAX_NAME_LENGTH);
  assert.equal(usageAmount(LABEL.MEMBER_SPEND, huge, 1, null, true).name.length, MAX_NAME_LENGTH);
  assert.equal(usageText(LABEL.BILLING_MODE, huge).value.length, MAX_NAME_LENGTH);
  assert.equal(cutName('short'), 'short');
  assert.equal(cutName(undefined), '');
});

test('makeUsage fills empty lists and keeps nothing else', () => {
  assert.deepEqual(makeUsage({}), { windows: [], amounts: [], counts: [], texts: [] });
  assert.deepEqual(makeUsage({ notes: ['x'], accountName: 'Alice' }), { windows: [], amounts: [], counts: [], texts: [] });
});

test('every text from a service is cut to 64 characters', () => {
  assert.equal(MAX_NAME_LENGTH, 64);
});

test('the outcome helpers say shown or not available', () => {
  assert.deepEqual(succeeded(makeUsage({})), { ok: true, usage: makeUsage({}) });
  assert.deepEqual(notAvailable(REASON.CLAUDE_FILE_MISSING), { ok: false, error: { kind: ERROR_KIND.NOT_AVAILABLE, reason: REASON.CLAUDE_FILE_MISSING, retryAt: null, params: {} } });
});
