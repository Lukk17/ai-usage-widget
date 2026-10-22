import { REASON } from '../core/http.mjs';
import { toFiniteNumber, isPlainObject } from '../core/values.mjs';
import { MINUTE_MS, HOUR_MS, WEEK_MS } from '../core/units.mjs';
import { PERIOD, DISCOVERY, makeUsage, usageWindow, succeeded, unexpected, notAvailable } from '../core/usage.mjs';
import { isValidField } from '../core/accounts.mjs';
import { fileReadCommand } from '../core/localRead.mjs';
import { KIND } from '../core/providerKind.mjs';
import { NO_MIN_INTERVAL_SECONDS } from './common.mjs';

export const MAX_HISTORY_BYTES = 1048576;
export const HISTORY_VERSION = 2;

const FIVE_HOURS_MS = 5 * HOUR_MS;
const CLEAR_DROP_POINTS = 10;
const MAX_SAMPLE_GAP_MS = 30 * MINUTE_MS;
const WINDOWS = [
  { field: 'fh', period: PERIOD.FIVE_HOUR, lengthMs: FIVE_HOURS_MS, estimate: (samples, now) => estimateFiveHourReset(samples, now) },
  { field: 'sd', period: PERIOD.WEEKLY, lengthMs: WEEK_MS, estimate: (samples, now) => estimateWeeklyReset(samples, now) },
];

export const READ_HISTORY_COMMAND = fileReadCommand('"${XDG_CONFIG_HOME:-$HOME/.config}/Claude/plan-usage-history.json"', MAX_HISTORY_BYTES);

function readSample(value) {
  if (!isPlainObject(value) || !isValidField(value.org) || !isPlainObject(value.u)) {
    return null;
  }
  const time = toFiniteNumber(value.t);
  return time === null ? null : { org: value.org, time: time, values: value.u };
}

export function samplesByOrg(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return null;
  }
  if (!isPlainObject(value) || value.version !== HISTORY_VERSION || !Array.isArray(value.samples)) {
    return null;
  }
  const byOrg = new Map();
  value.samples.map(readSample).forEach((sample) => {
    if (sample !== null) {
      byOrg.set(sample.org, (byOrg.get(sample.org) || []).concat([sample]));
    }
  });
  byOrg.forEach((samples) => samples.sort((first, second) => first.time - second.time));
  return byOrg;
}

export function newestSamples(text) {
  const byOrg = samplesByOrg(text);
  if (byOrg === null) {
    return null;
  }
  const newest = new Map();
  byOrg.forEach((samples, org) => newest.set(org, samples[samples.length - 1]));
  return newest;
}

function seriesOf(samples, field) {
  return samples
    .map((sample) => ({ time: sample.time, percent: typeof sample.values[field] === 'number' ? toFiniteNumber(sample.values[field]) : null }))
    .filter((point) => point.percent !== null);
}

function isClearDrop(previous, current) {
  return previous.percent - current.percent >= CLEAR_DROP_POINTS;
}

function midpointOf(previous, current) {
  return current.time - previous.time > MAX_SAMPLE_GAP_MS ? null : (previous.time + current.time) / 2;
}

export function estimateFiveHourReset(samples, now) {
  const series = seriesOf(samples, 'fh');
  for (let index = series.length - 1; index > 0; index -= 1) {
    const previous = series[index - 1];
    const current = series[index];
    if (current.percent > 0 && (previous.percent === 0 || isClearDrop(previous, current))) {
      const start = midpointOf(previous, current);
      const reset = start === null ? null : start + FIVE_HOURS_MS;
      return reset !== null && reset > now ? reset : null;
    }
  }
  return null;
}

export function estimateWeeklyReset(samples, now) {
  const series = seriesOf(samples, 'sd');
  for (let index = series.length - 1; index > 0; index -= 1) {
    const previous = series[index - 1];
    const current = series[index];
    if (isClearDrop(previous, current) || (current.percent === 0 && previous.percent > 0)) {
      const reset = midpointOf(previous, current);
      if (reset === null) {
        return null;
      }
      let next = reset + WEEK_MS;
      while (next <= now) {
        next += WEEK_MS;
      }
      return next;
    }
  }
  return null;
}

function usageOf(samples, now) {
  const sample = samples[samples.length - 1];
  const windows = [];
  WINDOWS.forEach((spec) => {
    const percent = typeof sample.values[spec.field] === 'number' ? toFiniteNumber(sample.values[spec.field]) : null;
    if (percent !== null) {
      windows.push(usageWindow(spec.period, '', percent, spec.estimate(samples, now), { validUntil: sample.time + spec.lengthMs, estimated: true }));
    }
  });
  return windows.length === 0 ? null : makeUsage({ windows: windows });
}

function interpret(read, account, now) {
  if (!read.found) {
    return notAvailable(REASON.CLAUDE_FILE_MISSING);
  }
  const byOrg = samplesByOrg(read.text);
  if (byOrg === null) {
    return unexpected(REASON.FILE_FORMAT_CHANGED);
  }
  if (!byOrg.has(account.org)) {
    return notAvailable(REASON.CLAUDE_ORG_MISSING);
  }
  const usage = usageOf(byOrg.get(account.org), now);
  return usage === null ? unexpected(REASON.FILE_FORMAT_CHANGED) : succeeded(usage);
}

function discover(read, now) {
  if (!read.found) {
    return notAvailable(REASON.CLAUDE_FILE_MISSING);
  }
  const byOrg = samplesByOrg(read.text);
  if (byOrg === null) {
    return unexpected(REASON.FILE_FORMAT_CHANGED);
  }
  const items = Array.from(byOrg.keys()).sort()
    .map((org) => ({ fields: { org: org }, usage: usageOf(byOrg.get(org), now) }))
    .filter((item) => item.usage !== null);
  return { ok: true, items: items };
}

export const claudeDesktop = Object.freeze({
  id: 'claude',
  title: 'Claude',
  kind: KIND.LOCAL,
  minIntervalSeconds: NO_MIN_INTERVAL_SECONDS,
  needsKey: false,
  keyHelp: '',
  fields: Object.freeze([Object.freeze({ id: 'org', label: 'Organization', typed: false })]),
  readCommand: READ_HISTORY_COMMAND,
  maxReadBytes: MAX_HISTORY_BYTES,
  interpret: interpret,
  discover: discover,
  discoveryText: Object.freeze({ reading: DISCOVERY.CLAUDE_READING, none: DISCOVERY.CLAUDE_NONE_NEW }),
});
