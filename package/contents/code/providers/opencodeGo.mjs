import { ERROR_KIND, REASON, failure, parseJsonBody } from '../core/http.mjs';
import { parseIsoTime, isPlainObject } from '../core/values.mjs';
import { PERIOD, makeUsage, usageWindow, succeeded, unexpected } from '../core/usage.mjs';
import { BEARER_AUTH, ACCEPT_JSON, NO_FIELDS, NO_MIN_INTERVAL_SECONDS } from './common.mjs';
import { KIND } from '../core/providerKind.mjs';

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const WINDOWS = [
  { field: 'rolling', period: PERIOD.FIVE_HOUR },
  { field: 'weekly', period: PERIOD.WEEKLY },
  { field: 'monthly', period: PERIOD.MONTHLY },
];

function classify(reply) {
  if (reply.status !== 403) {
    return null;
  }
  const body = parseJsonBody(reply);
  const isEntitlement = body.ok && isPlainObject(body.value) && isPlainObject(body.value.error) && body.value.error.type === 'EntitlementError';
  return isEntitlement ? failure(ERROR_KIND.NOT_AVAILABLE, REASON.GO_SUBSCRIPTION_REQUIRED) : null;
}

function readWindow(value) {
  if (!isPlainObject(value) || typeof value.percent !== 'number' || !Number.isFinite(value.percent) || typeof value.status !== 'string') {
    return null;
  }
  const resetsAt = parseIsoTime(value.resetsAt);
  return resetsAt === null ? null : { percent: value.percent, resetsAt: resetsAt };
}

function interpret(results) {
  const body = parseJsonBody(results.usage.reply);
  if (!body.ok || !isPlainObject(body.value) || !isPlainObject(body.value.usage)) {
    return unexpected(REASON.SHAPE_CHANGED);
  }
  const usage = body.value.usage;
  const windows = [];
  for (const spec of WINDOWS) {
    if (!Object.prototype.hasOwnProperty.call(usage, spec.field)) {
      continue;
    }
    const item = readWindow(usage[spec.field]);
    if (item === null) {
      return unexpected(REASON.SHAPE_CHANGED);
    }
    windows.push(usageWindow(spec.period, '', item.percent, item.resetsAt));
  }
  return windows.length === 0 ? unexpected(REASON.SHAPE_CHANGED) : succeeded(makeUsage({ windows: windows }));
}

export const opencodeGo = Object.freeze({
  id: 'opencodeGo',
  title: 'OpenCode Go',
  kind: KIND.REMOTE,
  minIntervalSeconds: NO_MIN_INTERVAL_SECONDS,
  needsKey: true,
  keyHelp: 'Go API key, from the OpenCode console',
  fields: NO_FIELDS,
  auth: BEARER_AUTH,
  buildRequests: function () {
    return [{ id: 'usage', url: USAGE_URL, headers: [ACCEPT_JSON] }];
  },
  classify: classify,
  interpret: interpret,
});
