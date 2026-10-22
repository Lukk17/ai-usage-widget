import { REASON, parseJsonBody } from '../core/http.mjs';
import { toFiniteNumber, isPlainObject } from '../core/values.mjs';
import { CENTS_PER_DOLLAR } from '../core/units.mjs';
import { LABEL, makeUsage, usageAmount, succeeded, unexpected } from '../core/usage.mjs';
import { isValidField } from '../core/accounts.mjs';
import { KIND } from '../core/providerKind.mjs';
import { BEARER_AUTH, ACCEPT_JSON, SPEND_MIN_INTERVAL_SECONDS } from './common.mjs';

const BASE_URL = 'https://management-api.x.ai/v1/billing/teams/';

function teamUrl(account, path) {
  if (!isValidField(account.teamId)) {
    throw new Error('the team ID is not allowed');
  }
  return BASE_URL + account.teamId + path;
}

function cents(value) {
  return isPlainObject(value) && typeof value.val === 'string' ? toFiniteNumber(value.val) : null;
}

function readBalance(result) {
  const body = parseJsonBody(result.reply);
  const total = body.ok && isPlainObject(body.value) ? cents(body.value.total) : null;
  return total === null ? null : -total / CENTS_PER_DOLLAR;
}

function readSpend(result) {
  const body = parseJsonBody(result.reply);
  const invoice = body.ok && isPlainObject(body.value) ? body.value.coreInvoice : null;
  if (!isPlainObject(invoice) || !Array.isArray(invoice.lines)) {
    return null;
  }
  let total = 0;
  for (const line of invoice.lines) {
    const amount = isPlainObject(line) && typeof line.amount === 'string' ? toFiniteNumber(line.amount) : null;
    if (amount === null) {
      return null;
    }
    total += amount;
  }
  return total / CENTS_PER_DOLLAR;
}

function interpret(results) {
  const balance = readBalance(results.balance);
  const spend = readSpend(results.invoice);
  if (balance === null || spend === null) {
    return unexpected(REASON.SHAPE_CHANGED);
  }
  return succeeded(makeUsage({
    amounts: [usageAmount(LABEL.BALANCE, '', balance, null, false), usageAmount(LABEL.SPENT_THIS_MONTH, '', spend, null, false)],
  }));
}

export const xai = Object.freeze({
  id: 'xai',
  title: 'xAI API',
  kind: KIND.REMOTE,
  minIntervalSeconds: SPEND_MIN_INTERVAL_SECONDS,
  needsKey: true,
  keyHelp: 'Management key, from the xAI Console',
  fields: Object.freeze([Object.freeze({ id: 'teamId', label: 'Team ID', typed: true })]),
  auth: BEARER_AUTH,
  buildRequests: function (now, account) {
    return [
      { id: 'balance', url: teamUrl(account, '/prepaid/balance'), headers: [ACCEPT_JSON] },
      { id: 'invoice', url: teamUrl(account, '/postpaid/invoice/preview'), headers: [ACCEPT_JSON] },
    ];
  },
  interpret: interpret,
});
