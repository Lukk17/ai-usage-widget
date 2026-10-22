import { ERROR_KIND, REASON, failure } from '../core/http.mjs';
import { isPlainObject } from '../core/values.mjs';
import { SECOND_MS } from '../core/units.mjs';
import { LABEL, makeUsage, usageAmount, usageCount, succeeded, unexpected } from '../core/usage.mjs';
import { KIND } from '../core/providerKind.mjs';
import { BEARER_AUTH, ACCEPT_JSON, NO_FIELDS, monthStartUtcMs, readDailyBuckets, SPEND_MIN_INTERVAL_SECONDS } from './common.mjs';

const BASE_URL = 'https://api.openai.com/v1/organization';
const DAYS_IN_LONGEST_MONTH = 31;
const CURRENCY = 'usd';

function classify(reply) {
  return reply.status === 401 || reply.status === 403
    ? failure(ERROR_KIND.KEY_REJECTED, REASON.OPENAI_ADMIN_KEY_REQUIRED, null, { status: reply.status })
    : null;
}

function reportUrl(path, now) {
  return BASE_URL + path + '?start_time=' + Math.floor(monthStartUtcMs(now) / SECOND_MS) + '&bucket_width=1d&limit=' + DAYS_IN_LONGEST_MONTH;
}

function isAmount(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sumCosts(items) {
  let total = 0;
  for (const item of items) {
    const amount = isPlainObject(item) && isPlainObject(item.amount) ? item.amount : null;
    if (amount === null || !isAmount(amount.value) || String(amount.currency).toLowerCase() !== CURRENCY) {
      return null;
    }
    total += amount.value;
  }
  return total;
}

function isTokenCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function sumTokens(items) {
  let input = 0;
  let output = 0;
  for (const item of items) {
    if (!isPlainObject(item) || !isTokenCount(item.input_tokens) || !isTokenCount(item.output_tokens)) {
      return null;
    }
    input += item.input_tokens;
    output += item.output_tokens;
  }
  return { input: input, output: output };
}

function interpret(results) {
  const costs = readDailyBuckets(results.costs);
  const usage = readDailyBuckets(results.usage);
  const usd = costs ? sumCosts(costs) : null;
  const tokens = usage ? sumTokens(usage) : null;
  if (usd === null || tokens === null) {
    return unexpected(REASON.SHAPE_CHANGED);
  }
  return succeeded(makeUsage({
    amounts: [usageAmount(LABEL.SPENT_THIS_MONTH, '', usd, null, false)],
    counts: [usageCount(LABEL.INPUT_TOKENS_THIS_MONTH, tokens.input), usageCount(LABEL.OUTPUT_TOKENS_THIS_MONTH, tokens.output)],
  }));
}

export const openai = Object.freeze({
  id: 'openai',
  title: 'OpenAI API',
  kind: KIND.REMOTE,
  minIntervalSeconds: SPEND_MIN_INTERVAL_SECONDS,
  needsKey: true,
  keyHelp: 'Admin API key, from the OpenAI Platform',
  fields: NO_FIELDS,
  auth: BEARER_AUTH,
  buildRequests: function (now) {
    return [
      { id: 'costs', url: reportUrl('/costs', now), headers: [ACCEPT_JSON] },
      { id: 'usage', url: reportUrl('/usage/completions', now), headers: [ACCEPT_JSON] },
    ];
  },
  classify: classify,
  interpret: interpret,
});
