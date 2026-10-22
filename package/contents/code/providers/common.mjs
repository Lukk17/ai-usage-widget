import { parseJsonBody } from '../core/http.mjs';
import { isPlainObject } from '../core/values.mjs';

export const BEARER_AUTH = Object.freeze({ header: 'Authorization', prefix: 'Bearer ' });
export const ACCEPT_JSON = 'Accept: application/json';
export const NO_FIELDS = Object.freeze([]);
export const SPEND_MIN_INTERVAL_SECONDS = 300;
export const NO_MIN_INTERVAL_SECONDS = 0;

export function monthStartUtcMs(now) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export function readDailyBuckets(result) {
  const body = parseJsonBody(result.reply);
  if (!body.ok || !isPlainObject(body.value) || !Array.isArray(body.value.data)) {
    return null;
  }
  const items = [];
  for (const bucket of body.value.data) {
    if (!isPlainObject(bucket) || !Array.isArray(bucket.results)) {
      return null;
    }
    bucket.results.forEach((item) => items.push(item));
  }
  return items;
}
