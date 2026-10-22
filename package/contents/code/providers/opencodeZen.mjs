import { ERROR_KIND, REASON, failure, parseJsonBody } from '../core/http.mjs';
import { toFiniteNumber, parseIsoTime, isPlainObject } from '../core/values.mjs';
import { PERCENT } from '../core/units.mjs';
import { LABEL, PERIOD, makeUsage, usageWindow, usageAmount, succeeded, unexpected } from '../core/usage.mjs';
import { BEARER_AUTH, ACCEPT_JSON, NO_FIELDS, SPEND_MIN_INTERVAL_SECONDS } from './common.mjs';
import { KIND } from '../core/providerKind.mjs';

export const MAX_MEMBERS = 50;

const MEMBERS_URL = 'https://opencode.ai/console/api/v1/budgets/members';
const MICROCENTS_PER_DOLLAR = 100000000;
const FORBIDDEN = 403;

function classify(reply) {
  return reply.status === FORBIDDEN ? failure(ERROR_KIND.KEY_REJECTED, REASON.ZEN_ALL_PERMISSIONS) : null;
}

function emailName(email) {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

function readLimit(value) {
  if (value === null) {
    return { ok: true, usd: null };
  }
  const limit = typeof value === 'string' ? toFiniteNumber(value) : null;
  return limit === null ? { ok: false } : { ok: true, usd: limit / MICROCENTS_PER_DOLLAR };
}

function readMember(value) {
  if (!isPlainObject(value) || typeof value.email !== 'string' || typeof value.spent_micro_cents !== 'string') {
    return null;
  }
  const spent = toFiniteNumber(value.spent_micro_cents);
  const limit = readLimit(value.limit_micro_cents);
  const resetsAt = parseIsoTime(value.resets_at);
  if (spent === null || !limit.ok || resetsAt === null) {
    return null;
  }
  return { name: emailName(value.email), spentUsd: spent / MICROCENTS_PER_DOLLAR, limitUsd: limit.usd, resetsAt: resetsAt };
}

function hasLimit(member) {
  return member.limitUsd !== null && member.limitUsd > 0;
}

function usedPercent(member) {
  return (member.spentUsd / member.limitUsd) * PERCENT;
}

function mainAmount(member) {
  return hasLimit(member)
    ? usageAmount(LABEL.BUDGET_LEFT, '', member.limitUsd - member.spentUsd, null, false)
    : usageAmount(LABEL.SPENT_THIS_MONTH, '', member.spentUsd, null, true);
}

function memberAmount(member) {
  return hasLimit(member)
    ? usageAmount(LABEL.MEMBER_BUDGET_LEFT, member.name, member.limitUsd - member.spentUsd, null, false)
    : usageAmount(LABEL.MEMBER_SPEND, member.name, member.spentUsd, null, true);
}

function interpret(results) {
  const body = parseJsonBody(results.members.reply);
  if (!body.ok || !Array.isArray(body.value)) {
    return unexpected(REASON.SHAPE_CHANGED);
  }
  const members = body.value.map(readMember);
  if (members.indexOf(null) !== -1) {
    return unexpected(REASON.SHAPE_CHANGED);
  }
  const shown = members.slice(0, MAX_MEMBERS);
  const limited = shown.filter(hasLimit);
  const main = limited.length > 0
    ? limited.reduce((best, member) => (usedPercent(member) > usedPercent(best) ? member : best))
    : shown[0];
  const windows = limited.map((member) => usageWindow(PERIOD.MONTHLY, member.name, usedPercent(member), member.resetsAt));
  const amounts = shown.map((member) => (member === main ? mainAmount(member) : memberAmount(member)));
  return succeeded(makeUsage({ windows: windows, amounts: amounts }));
}

export const opencodeZen = Object.freeze({
  id: 'opencodeZen',
  title: 'OpenCode Zen',
  kind: KIND.REMOTE,
  minIntervalSeconds: SPEND_MIN_INTERVAL_SECONDS,
  needsKey: true,
  keyHelp: 'Service account key, from the OpenCode console',
  fields: NO_FIELDS,
  auth: BEARER_AUTH,
  buildRequests: function () {
    return [{ id: 'members', url: MEMBERS_URL, headers: [ACCEPT_JSON] }];
  },
  classify: classify,
  interpret: interpret,
});
