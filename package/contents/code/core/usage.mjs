import { ERROR_KIND, failure } from './http.mjs';

export const MAX_NAME_LENGTH = 64;

const CUT_MARK = '...';
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const FIVE_HOURS_MINUTES = 5 * MINUTES_PER_HOUR;
const WEEK_MINUTES = 7 * MINUTES_PER_DAY;
const SHORTEST_MONTH_MINUTES = 28 * MINUTES_PER_DAY;
const LONGEST_MONTH_MINUTES = 31 * MINUTES_PER_DAY;

export const PERIOD = Object.freeze({
  FIVE_HOUR: 'five_hour',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  HOURS: 'hours',
  DAYS: 'days',
  MINUTES: 'minutes',
  INTERVAL: 'interval',
  TOP_UP: 'top_up',
});

export const DEFAULT_CURRENCY = 'usd';

export const LABEL = Object.freeze({
  SPENT_THIS_MONTH: 'spent_this_month',
  BALANCE: 'balance',
  INPUT_TOKENS_THIS_MONTH: 'input_tokens_this_month',
  OUTPUT_TOKENS_THIS_MONTH: 'output_tokens_this_month',
  MEMBER_SPEND: 'member_spend',
  BUDGET_LEFT: 'budget_left',
  MEMBER_BUDGET_LEFT: 'member_budget_left',
  INCLUDED_CREDITS_LEFT: 'included_credits_left',
  PLAN: 'plan',
  BILLING_MODE: 'billing_mode',
});

export const DISCOVERY = Object.freeze({
  CLAUDE_READING: 'claude_reading',
  CLAUDE_NONE_NEW: 'claude_none_new',
});

export function cutName(name) {
  const text = typeof name === 'string' ? name : '';
  return text.length > MAX_NAME_LENGTH ? text.slice(0, MAX_NAME_LENGTH - CUT_MARK.length) + CUT_MARK : text;
}

export function periodForMinutes(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    return { period: PERIOD.INTERVAL, count: null };
  }
  const rounded = Math.round(minutes);
  if (rounded === FIVE_HOURS_MINUTES) {
    return { period: PERIOD.FIVE_HOUR, count: null };
  }
  if (rounded === MINUTES_PER_DAY) {
    return { period: PERIOD.DAILY, count: null };
  }
  if (rounded === WEEK_MINUTES) {
    return { period: PERIOD.WEEKLY, count: null };
  }
  if (rounded >= SHORTEST_MONTH_MINUTES && rounded <= LONGEST_MONTH_MINUTES) {
    return { period: PERIOD.MONTHLY, count: null };
  }
  if (rounded % MINUTES_PER_DAY === 0) {
    return { period: PERIOD.DAYS, count: rounded / MINUTES_PER_DAY };
  }
  if (rounded % MINUTES_PER_HOUR === 0) {
    return { period: PERIOD.HOURS, count: rounded / MINUTES_PER_HOUR };
  }
  return { period: PERIOD.MINUTES, count: rounded };
}

export function usageWindow(period, name, usedPercent, resetsAt, options) {
  const settings = options || {};
  return {
    period: period,
    count: settings.count === undefined ? null : settings.count,
    name: cutName(name),
    usedPercent: usedPercent,
    resetsAt: resetsAt,
    validUntil: settings.validUntil === undefined ? null : settings.validUntil,
    estimated: settings.estimated === true,
    canBeMain: settings.canBeMain !== false,
  };
}

export function usageAmount(label, name, value, limit, noLimit, currency) {
  return { label: label, name: cutName(name), value: value, limit: limit, noLimit: Boolean(noLimit), currency: cutName(currency || DEFAULT_CURRENCY), problem: null };
}

export function usageAmountProblem(label, problem) {
  return Object.assign(usageAmount(label, '', null, null, false), { problem: problem });
}

export function usageCount(label, value) {
  return { label: label, value: value };
}

export function usageText(label, value) {
  return { label: label, value: cutName(value) };
}

export function makeUsage(parts) {
  return {
    windows: parts.windows || [],
    amounts: parts.amounts || [],
    counts: parts.counts || [],
    texts: parts.texts || [],
  };
}

export function succeeded(usage) {
  return { ok: true, usage: usage };
}

export function unexpected(reason, params) {
  return { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, reason, null, params) };
}

export function notAvailable(reason, params) {
  return { ok: false, error: failure(ERROR_KIND.NOT_AVAILABLE, reason, null, params) };
}
