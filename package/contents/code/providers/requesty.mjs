import { ERROR_KIND, REASON, failure, parseJsonBody } from '../core/http.mjs';
import { toFiniteNumber, isPlainObject } from '../core/values.mjs';
import { PERCENT } from '../core/units.mjs';
import { LABEL, PERIOD, makeUsage, usageWindow, usageAmount, usageAmountProblem, succeeded, unexpected } from '../core/usage.mjs';
import { BEARER_AUTH, ACCEPT_JSON, NO_FIELDS, SPEND_MIN_INTERVAL_SECONDS } from './common.mjs';
import { KIND } from '../core/providerKind.mjs';

const BASE_URL = 'https://api-v2.requesty.ai/v1/manage';

function classify(reply) {
  return reply.status === 402 ? failure(ERROR_KIND.NOT_AVAILABLE, REASON.BALANCE_EXHAUSTED) : null;
}

function readKeyInfo(result) {
  const body = parseJsonBody(result.reply);
  if (!body.ok || !isPlainObject(body.value)) {
    return null;
  }
  const spend = toFiniteNumber(body.value.monthly_spend);
  const limit = body.value.monthly_limit === null ? 0 : toFiniteNumber(body.value.monthly_limit);
  if (spend === null || limit === null) {
    return null;
  }
  return { spend: spend, limit: limit };
}

function balanceProblem(error) {
  return error.kind === ERROR_KIND.KEY_REJECTED ? failure(ERROR_KIND.NOT_AVAILABLE, REASON.BALANCE_NEEDS_MANAGE) : error;
}

function readBalance(result) {
  if (result.error) {
    return usageAmountProblem(LABEL.BALANCE, balanceProblem(result.error));
  }
  const body = parseJsonBody(result.reply);
  const balance = body.ok && isPlainObject(body.value) ? toFiniteNumber(body.value.balance) : null;
  return balance === null
    ? usageAmountProblem(LABEL.BALANCE, failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SHAPE_CHANGED))
    : usageAmount(LABEL.BALANCE, '', balance, null, false);
}

function interpret(results) {
  const keyInfo = readKeyInfo(results.key);
  if (keyInfo === null) {
    return unexpected(REASON.SHAPE_CHANGED);
  }
  const hasLimit = keyInfo.limit > 0;
  const windows = hasLimit ? [usageWindow(PERIOD.MONTHLY, '', (keyInfo.spend / keyInfo.limit) * PERCENT, null)] : [];
  const amounts = [usageAmount(LABEL.SPENT_THIS_MONTH, '', keyInfo.spend, hasLimit ? keyInfo.limit : null, !hasLimit)];
  amounts.push(readBalance(results.org));
  return succeeded(makeUsage({ windows: windows, amounts: amounts }));
}

export const requesty = Object.freeze({
  id: 'requesty',
  title: 'Requesty',
  kind: KIND.REMOTE,
  minIntervalSeconds: SPEND_MIN_INTERVAL_SECONDS,
  needsKey: true,
  keyHelp: 'API key with manage permission, from the Requesty dashboard',
  fields: NO_FIELDS,
  auth: BEARER_AUTH,
  buildRequests: function () {
    return [
      { id: 'key', url: BASE_URL + '/apikey/self', headers: [ACCEPT_JSON] },
      { id: 'org', url: BASE_URL + '/org', headers: [ACCEPT_JSON], optional: true },
    ];
  },
  classify: classify,
  interpret: interpret,
});
