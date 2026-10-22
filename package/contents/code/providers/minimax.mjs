import { ERROR_KIND, REASON, failure, parseJsonBody } from '../core/http.mjs';
import { toFiniteNumber, isPlainObject } from '../core/values.mjs';
import { PERCENT, MINUTE_MS } from '../core/units.mjs';
import { PERIOD, makeUsage, usageWindow, periodForMinutes, succeeded, unexpected } from '../core/usage.mjs';
import { BEARER_AUTH, ACCEPT_JSON, NO_FIELDS, NO_MIN_INTERVAL_SECONDS } from './common.mjs';
import { KIND } from '../core/providerKind.mjs';

export const MAX_MODELS = 50;

const REMAINS_URL = 'https://api.minimax.io/v1/token_plan/remains';
const STATUS_UNLIMITED = 3;
const KEY_REJECTED_CODES = [1004, 2049];
const RATE_LIMITED_CODES = [1002, 1039, 1041, 2045, 2056];
const INSUFFICIENT_BALANCE_CODE = 1008;
const INTERVAL = { prefix: 'current_interval', remainsField: 'remains_time', startField: 'start_time', endField: 'end_time' };
const WEEKLY = { prefix: 'current_weekly', remainsField: 'weekly_remains_time', startField: null, endField: null };
const NO_COUNTS = 'no_counts';

function serviceCodeFailure(code) {
  const params = { code: code };
  if (KEY_REJECTED_CODES.indexOf(code) !== -1) {
    return failure(ERROR_KIND.KEY_REJECTED, REASON.SERVICE_CODE, null, params);
  }
  if (RATE_LIMITED_CODES.indexOf(code) !== -1) {
    return failure(ERROR_KIND.RATE_LIMITED, REASON.SERVICE_CODE, null, params);
  }
  if (code === INSUFFICIENT_BALANCE_CODE) {
    return failure(ERROR_KIND.NOT_AVAILABLE, REASON.INSUFFICIENT_BALANCE, null, params);
  }
  return failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.SERVICE_CODE, null, params);
}

function optionalNumber(value) {
  return value === undefined || value === null ? null : toFiniteNumber(value);
}

function isUnlimited(model, spec) {
  return optionalNumber(model[spec.prefix + '_status']) === STATUS_UNLIMITED;
}

function periodOf(model, spec) {
  if (spec.startField === null) {
    return { period: PERIOD.WEEKLY, count: null };
  }
  const start = optionalNumber(model[spec.startField]);
  const end = optionalNumber(model[spec.endField]);
  return periodForMinutes(start === null || end === null ? null : (end - start) / MINUTE_MS);
}

function readWindow(model, spec, now) {
  const period = periodOf(model, spec);
  const remains = toFiniteNumber(model[spec.remainsField]);
  const resetsAt = remains === null ? null : now + remains;
  const remainingPercent = optionalNumber(model[spec.prefix + '_remaining_percent']);
  if (remainingPercent !== null) {
    return usageWindow(period.period, model.model_name, PERCENT - remainingPercent, resetsAt, { count: period.count });
  }
  const total = toFiniteNumber(model[spec.prefix + '_total_count']);
  const reported = toFiniteNumber(model[spec.prefix + '_usage_count']);
  if (total === null || reported === null) {
    return NO_COUNTS;
  }
  if (total <= 0 || reported < 0 || reported > total) {
    return null;
  }
  const isUsedUpWithoutPlanDetails = reported === 0;
  return usageWindow(period.period, model.model_name, ((total - reported) / total) * PERCENT, resetsAt, { count: period.count, canBeMain: !isUsedUpWithoutPlanDetails });
}

function readModel(model, now) {
  if (!isPlainObject(model) || typeof model.model_name !== 'string') {
    return null;
  }
  const windows = [];
  if (!isUnlimited(model, INTERVAL)) {
    const interval = readWindow(model, INTERVAL, now);
    if (interval === NO_COUNTS) {
      return null;
    }
    if (interval !== null) {
      windows.push(interval);
    }
  }
  if (!isUnlimited(model, WEEKLY)) {
    const weekly = readWindow(model, WEEKLY, now);
    if (weekly !== null && weekly !== NO_COUNTS) {
      windows.push(weekly);
    }
  }
  return windows;
}

function readModels(models, now) {
  const windows = [];
  for (const model of models) {
    const modelWindows = readModel(model, now);
    if (modelWindows === null) {
      return null;
    }
    modelWindows.forEach((item) => windows.push(item));
  }
  return windows;
}

function interpret(results, now) {
  const body = parseJsonBody(results.remains.reply);
  if (!body.ok || !isPlainObject(body.value)) {
    return unexpected(REASON.SHAPE_CHANGED);
  }
  const base = body.value.base_resp;
  const code = isPlainObject(base) ? toFiniteNumber(base.status_code) : null;
  if (code !== null && code !== 0) {
    return { ok: false, error: serviceCodeFailure(code) };
  }
  const windows = Array.isArray(body.value.model_remains) ? readModels(body.value.model_remains.slice(0, MAX_MODELS), now) : null;
  if (windows === null) {
    return unexpected(REASON.SHAPE_CHANGED);
  }
  return succeeded(makeUsage({ windows: windows }));
}

export const minimax = Object.freeze({
  id: 'minimax',
  title: 'MiniMax',
  kind: KIND.REMOTE,
  minIntervalSeconds: NO_MIN_INTERVAL_SECONDS,
  needsKey: true,
  keyHelp: 'Token Plan key, from the MiniMax Platform',
  fields: NO_FIELDS,
  auth: BEARER_AUTH,
  buildRequests: function () {
    return [{ id: 'remains', url: REMAINS_URL, headers: [ACCEPT_JSON] }];
  },
  interpret: interpret,
});
