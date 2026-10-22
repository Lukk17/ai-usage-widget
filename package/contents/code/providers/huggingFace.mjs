import { ERROR_KIND, REASON, failure, parseJsonBody } from '../core/http.mjs';
import { isPlainObject } from '../core/values.mjs';
import { CENTS_PER_DOLLAR } from '../core/units.mjs';
import { LABEL, makeUsage, usageAmount, usageText, succeeded, unexpected } from '../core/usage.mjs';
import { KIND } from '../core/providerKind.mjs';
import { BEARER_AUTH, ACCEPT_JSON, NO_FIELDS, monthStartUtcMs, SPEND_MIN_INTERVAL_SECONDS } from './common.mjs';

const BASE_URL = 'https://huggingface.co/api';
const PRO_PLAN = 'PRO';
export const PRO_INCLUDED_CREDITS_USD = 2;
const USD = 'usd';
const FREE_PLAN = 'free';

function classify(reply) {
  return reply.status === 403 ? failure(ERROR_KIND.KEY_REJECTED, REASON.HF_BILLING_PERMISSION) : null;
}

function missing(field) {
  return unexpected(REASON.FIELD_MISSING, { field: field });
}

function readUser(result) {
  const body = parseJsonBody(result.reply);
  if (!body.ok || !isPlainObject(body.value)) {
    return { error: unexpected(REASON.SHAPE_CHANGED) };
  }
  const user = body.value;
  if (typeof user.isPro !== 'boolean') {
    return { error: missing('isPro') };
  }
  if (typeof user.billingMode !== 'string' || user.billingMode === '') {
    return { error: missing('billingMode') };
  }
  return { isPro: user.isPro, plan: user.isPro ? PRO_PLAN : FREE_PLAN, billingMode: user.billingMode };
}

function sumSessions(periods) {
  let cents = 0;
  for (const period of periods) {
    if (!isPlainObject(period) || !Array.isArray(period.sessions)) {
      return { error: missing('sessions') };
    }
    for (const session of period.sessions) {
      if (!isPlainObject(session) || typeof session.costCents !== 'number' || !Number.isFinite(session.costCents)) {
        return { error: missing('costCents') };
      }
      cents += session.costCents;
    }
  }
  return { cents: cents };
}

function readSpend(result) {
  const body = parseJsonBody(result.reply);
  if (!body.ok || !isPlainObject(body.value)) {
    return { error: unexpected(REASON.SHAPE_CHANGED) };
  }
  if (typeof body.value.currency !== 'string' || body.value.currency === '') {
    return { error: missing('currency') };
  }
  if (!Array.isArray(body.value.periods)) {
    return { error: missing('periods') };
  }
  const sum = sumSessions(body.value.periods);
  return sum.error ? sum : { amount: sum.cents / CENTS_PER_DOLLAR, currency: body.value.currency };
}

function includedCredits(user, spend) {
  if (!user.isPro || spend.currency.toLowerCase() !== USD) {
    return [];
  }
  return [usageAmount(LABEL.INCLUDED_CREDITS_LEFT, '', Math.max(0, PRO_INCLUDED_CREDITS_USD - spend.amount), null, false, USD)];
}

function interpret(results) {
  const user = readUser(results.whoami);
  if (user.error) {
    return user.error;
  }
  const spend = readSpend(results.usage);
  if (spend.error) {
    return spend.error;
  }
  return succeeded(makeUsage({
    texts: [usageText(LABEL.PLAN, user.plan), usageText(LABEL.BILLING_MODE, user.billingMode)],
    amounts: includedCredits(user, spend).concat([usageAmount(LABEL.SPENT_THIS_MONTH, '', spend.amount, null, false, spend.currency)]),
  }));
}

export const huggingFace = Object.freeze({
  id: 'huggingFace',
  title: 'Hugging Face',
  kind: KIND.REMOTE,
  minIntervalSeconds: SPEND_MIN_INTERVAL_SECONDS,
  needsKey: true,
  keyHelp: 'Fine-grained access token with billing read permission, from Hugging Face settings',
  fields: NO_FIELDS,
  auth: BEARER_AUTH,
  buildRequests: function (now) {
    return [
      { id: 'whoami', url: BASE_URL + '/whoami-v2', headers: [ACCEPT_JSON] },
      { id: 'usage', url: BASE_URL + '/settings/billing/usage-by-inference-session?startDate=' + encodeURIComponent(new Date(monthStartUtcMs(now)).toISOString()), headers: [ACCEPT_JSON] },
    ];
  },
  classify: classify,
  interpret: interpret,
});
