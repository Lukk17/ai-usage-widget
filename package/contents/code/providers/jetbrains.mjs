import { REASON } from '../core/http.mjs';
import { toFiniteNumber } from '../core/values.mjs';
import { PERCENT } from '../core/units.mjs';
import { PERIOD, makeUsage, usageWindow, succeeded, unexpected, notAvailable } from '../core/usage.mjs';
import { LIMIT, MISSING_OUTPUT, foundOutput, wrapRead } from '../core/localRead.mjs';
import { KIND } from '../core/providerKind.mjs';
import { NO_FIELDS, NO_MIN_INTERVAL_SECONDS } from './common.mjs';

export const QUOTA_MARKER = 'QuotaManager2Impl - New quota state is: Available(';
export const LOG_TAIL_BYTES = 4194304;
export const MAX_LINE_CHARACTERS = 4000;
export const MAX_READ_BYTES = 8192;

const NUMBER = '(-?\\d+(?:\\.\\d+)?)';
const TARIFF_PATTERN = new RegExp('tariffQuota=Details\\(current=' + NUMBER + ', maximum=' + NUMBER);
const TOP_UP_PATTERN = new RegExp('topUpQuota=Details\\(current=' + NUMBER + ', maximum=' + NUMBER);

const LINE_TIME = '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]+';
const SHELL_NUMBER = '-?[0-9.]+';
const TARIFF_PART = 'tariffQuota=Details\\(current=' + SHELL_NUMBER + ', maximum=' + SHELL_NUMBER;
const TOP_UP_PART = 'topUpQuota=Details\\(current=' + SHELL_NUMBER + ', maximum=' + SHELL_NUMBER;
const KEEP_ALLOWED_PARTS = 'sed -n -E'
  + ' -e "s/^(' + LINE_TIME + ').*(' + TARIFF_PART + ').*(' + TOP_UP_PART + ').*\\$/\\1 \\2 \\3/p" -e t'
  + ' -e "s/^(' + LINE_TIME + ').*(' + TARIFF_PART + ').*\\$/\\1 \\2/p" -e t'
  + ' -e "s/^(' + LINE_TIME + ').*\\$/\\1/p"';

export const READ_LOGS_COMMAND = wrapRead('set -- "$HOME"/.cache/JetBrains/*/log/idea.log; '
  + 'if [ -f "$1" ]; then line=$('
  + 'for f in "$@"; do if [ -f "$f" ] && [ ! -L "$f" ]; then ' + LIMIT + ' tail -c ' + LOG_TAIL_BYTES + ' -- "$f" | ' + LIMIT + ' grep -a -F "' + QUOTA_MARKER + '" | tail -n 1 | cut -c 1-' + MAX_LINE_CHARACTERS + ' | ' + KEEP_ALLOWED_PARTS + '; fi; done '
  + '| LC_ALL=C sort | tail -n 1); ' + foundOutput('line') + '; '
  + 'else ' + MISSING_OUTPUT + '; fi');

function readDetails(line, pattern) {
  const match = pattern.exec(line);
  if (match === null) {
    return null;
  }
  const current = toFiniteNumber(match[1]);
  const maximum = toFiniteNumber(match[2]);
  return current === null || maximum === null ? null : { current: current, maximum: maximum };
}

function percentOf(details) {
  return (details.current / details.maximum) * PERCENT;
}

function interpret(read) {
  if (!read.found) {
    return notAvailable(REASON.JETBRAINS_LOG_MISSING);
  }
  const line = read.text.trim();
  if (line === '') {
    return notAvailable(REASON.JETBRAINS_NO_QUOTA);
  }
  const tariff = readDetails(line, TARIFF_PATTERN);
  if (tariff === null || tariff.maximum <= 0) {
    return unexpected(REASON.FILE_FORMAT_CHANGED);
  }
  const windows = [usageWindow(PERIOD.MONTHLY, '', percentOf(tariff), null)];
  const topUp = readDetails(line, TOP_UP_PATTERN);
  if (topUp !== null && topUp.maximum > 0) {
    windows.push(usageWindow(PERIOD.TOP_UP, '', percentOf(topUp), null));
  }
  return succeeded(makeUsage({ windows: windows }));
}

export const jetbrains = Object.freeze({
  id: 'jetbrains',
  title: 'JetBrains AI',
  kind: KIND.LOCAL,
  minIntervalSeconds: NO_MIN_INTERVAL_SECONDS,
  needsKey: false,
  keyHelp: 'No key needed, read from the JetBrains IDE log',
  fields: NO_FIELDS,
  readCommand: READ_LOGS_COMMAND,
  maxReadBytes: MAX_READ_BYTES,
  interpret: interpret,
});
