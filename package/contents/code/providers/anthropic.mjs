import { ERROR_KIND, REASON, failure } from '../core/http.mjs';
import { toFiniteNumber, isPlainObject } from '../core/values.mjs';
import { CENTS_PER_DOLLAR } from '../core/units.mjs';
import { LABEL, makeUsage, usageAmount, usageCount, succeeded, unexpected } from '../core/usage.mjs';
import { ACCEPT_JSON, NO_FIELDS, monthStartUtcMs, readDailyBuckets, SPEND_MIN_INTERVAL_SECONDS } from './common.mjs';
import { KIND } from '../core/providerKind.mjs';

const BASE_URL = 'https://api.anthropic.com/v1/organizations';
const API_VERSION = '2023-06-01';
const DAYS_IN_LONGEST_MONTH = 31;
const API_KEY_AUTH = Object.freeze({ header: 'x-api-key', prefix: '' });

function monthStartUtc(now) {
  return new Date(monthStartUtcMs(now)).toISOString().replace('.000Z', 'Z');
}

function reportUrl(path, now) {
  return BASE_URL + path + '?starting_at=' + encodeURIComponent(monthStartUtc(now)) + '&bucket_width=1d&limit=' + DAYS_IN_LONGEST_MONTH;
}

function classify(reply) {
  if (reply.status === 401) {
    return failure(ERROR_KIND.KEY_REJECTED, REASON.ADMIN_KEY_REQUIRED);
  }
  if (reply.status === 403 || reply.status === 404) {
    return failure(ERROR_KIND.NOT_AVAILABLE, REASON.TEAM_ORGANIZATION_REQUIRED);
  }
  return null;
}

function sumCostCents(items) {
  let total = 0;
  for (const item of items) {
    const cents = isPlainObject(item) && item.currency === 'USD' && typeof item.amount === 'string' ? toFiniteNumber(item.amount) : null;
    if (cents === null) {
      return null;
    }
    total += cents;
  }
  return total;
}

function tokenNumber(value) {
  const number = toFiniteNumber(value === undefined ? 0 : value);
  return number === null || number < 0 ? null : number;
}

function sumTokens(items) {
  let input = 0;
  let output = 0;
  for (const item of items) {
    if (!isPlainObject(item)) {
      return null;
    }
    const cache = isPlainObject(item.cache_creation) ? item.cache_creation : {};
    const parts = [item.uncached_input_tokens, item.cache_read_input_tokens, cache.ephemeral_1h_input_tokens, cache.ephemeral_5m_input_tokens].map(tokenNumber);
    const out = tokenNumber(item.output_tokens);
    if (parts.indexOf(null) !== -1 || out === null) {
      return null;
    }
    input += parts.reduce((sum, value) => sum + value, 0);
    output += out;
  }
  return { input: input, output: output };
}

function interpret(results) {
  const cost = readDailyBuckets(results.cost);
  const usage = readDailyBuckets(results.usage);
  const cents = cost ? sumCostCents(cost) : null;
  const tokens = usage ? sumTokens(usage) : null;
  if (cents === null || tokens === null) {
    return unexpected(REASON.SHAPE_CHANGED);
  }
  return succeeded(makeUsage({
    amounts: [usageAmount(LABEL.SPENT_THIS_MONTH, '', cents / CENTS_PER_DOLLAR, null, false)],
    counts: [usageCount(LABEL.INPUT_TOKENS_THIS_MONTH, tokens.input), usageCount(LABEL.OUTPUT_TOKENS_THIS_MONTH, tokens.output)],
  }));
}

export const anthropic = Object.freeze({
  id: 'anthropic',
  title: 'Anthropic API',
  kind: KIND.REMOTE,
  minIntervalSeconds: SPEND_MIN_INTERVAL_SECONDS,
  needsKey: true,
  keyHelp: 'Admin API key, from the Claude Console (team organizations only)',
  fields: NO_FIELDS,
  auth: API_KEY_AUTH,
  buildRequests: function (now) {
    const headers = [ACCEPT_JSON, 'anthropic-version: ' + API_VERSION];
    return [
      { id: 'cost', url: reportUrl('/cost_report', now), headers: headers },
      { id: 'usage', url: reportUrl('/usage_report/messages', now), headers: headers },
    ];
  },
  classify: classify,
  interpret: interpret,
});
