import { quote } from './shell.mjs';
import { serializeAccounts } from './accounts.mjs';

export const SETTINGS_FILE = 'ai-usage-widgetrc';
export const SETTINGS_GROUP = 'General';
export const SETTINGS_KEY = Object.freeze({
  ACCOUNTS: 'accounts',
  REFRESH_SECONDS: 'refreshSeconds',
});
export const MISSING_VALUE = '<missing>';
export const TOOL_TIMEOUT_SECONDS = 5;
export const SETTINGS_TIMEOUT_MS = 25000;
export const EMPTY_VALUES = Object.freeze({ accounts: null, refreshSeconds: null });

const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}rc$/;
const REFRESH_PATTERN = /^[0-9]{1,6}$/;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_PAD = '=';
const SIX_BITS = 0x3f;
const LAST_ONE_BYTE = 0x7f;
const LAST_TWO_BYTES = 0x7ff;
const LAST_THREE_BYTES = 0xffff;
const CONTINUATION = 0x80;
const TWO_BYTE_LEAD = 0xc0;
const THREE_BYTE_LEAD = 0xe0;
const FOUR_BYTE_LEAD = 0xf0;
const KEY_ORDER = [SETTINGS_KEY.ACCOUNTS, SETTINGS_KEY.REFRESH_SECONDS];

export function assertSettingsFileName(fileName) {
  if (typeof fileName !== 'string' || !FILE_NAME_PATTERN.test(fileName)) {
    throw new Error('the settings file name must be a plain file name that ends in rc');
  }
  return fileName;
}

function utf8Bytes(text) {
  const bytes = [];
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code <= LAST_ONE_BYTE) {
      bytes.push(code);
    } else if (code <= LAST_TWO_BYTES) {
      bytes.push(TWO_BYTE_LEAD | (code >> 6), CONTINUATION | (code & SIX_BITS));
    } else if (code <= LAST_THREE_BYTES) {
      bytes.push(THREE_BYTE_LEAD | (code >> 12), CONTINUATION | ((code >> 6) & SIX_BITS), CONTINUATION | (code & SIX_BITS));
    } else {
      bytes.push(FOUR_BYTE_LEAD | (code >> 18), CONTINUATION | ((code >> 12) & SIX_BITS), CONTINUATION | ((code >> 6) & SIX_BITS), CONTINUATION | (code & SIX_BITS));
    }
  }
  return bytes;
}

export function encodeBase64(text) {
  const bytes = utf8Bytes(String(text));
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] || 0) << 8) | (bytes[index + 2] || 0);
    out += BASE64_ALPHABET[(chunk >> 18) & SIX_BITS] + BASE64_ALPHABET[(chunk >> 12) & SIX_BITS];
    out += index + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & SIX_BITS] : BASE64_PAD;
    out += index + 2 < bytes.length ? BASE64_ALPHABET[chunk & SIX_BITS] : BASE64_PAD;
  }
  return out;
}

function fileArguments(fileName, key) {
  return ' --file ' + quote(assertSettingsFileName(fileName)) + ' --group ' + quote(SETTINGS_GROUP) + ' --key ' + quote(key);
}

function readPart(fileName, key) {
  return 'timeout ' + TOOL_TIMEOUT_SECONDS + ' kreadconfig6' + fileArguments(fileName, key) + ' --default ' + quote(MISSING_VALUE);
}

export function readCommand(fileName) {
  return 'a=$(' + readPart(fileName, SETTINGS_KEY.ACCOUNTS) + ') && r=$(' + readPart(fileName, SETTINGS_KEY.REFRESH_SECONDS) + ') && printf "%s\\n%s\\n" "$a" "$r"';
}

function isValidRefresh(value) {
  return Number.isInteger(value) && REFRESH_PATTERN.test(String(value));
}

function writePart(fileName, key, value) {
  if (key === SETTINGS_KEY.ACCOUNTS) {
    if (typeof value !== 'string' || value === '') {
      throw new Error('the accounts value must be a non-empty string');
    }
    return 'v=$(printf "%s" ' + quote(encodeBase64(value)) + ' | base64 -d) && timeout ' + TOOL_TIMEOUT_SECONDS + ' kwriteconfig6' + fileArguments(fileName, key) + ' -- "$v"';
  }
  if (!isValidRefresh(value)) {
    throw new Error('the refresh value must be a whole number of seconds');
  }
  return 'timeout ' + TOOL_TIMEOUT_SECONDS + ' kwriteconfig6' + fileArguments(fileName, key) + ' -- ' + quote(String(value));
}

function writtenKeys(values) {
  return KEY_ORDER.filter((key) => Object.prototype.hasOwnProperty.call(values || {}, key));
}

export function writeCommand(fileName, values) {
  const keys = writtenKeys(values);
  if (keys.length === 0) {
    throw new Error('nothing to write');
  }
  return keys.map((key) => writePart(fileName, key, values[key])).join(' && ') + ' && ' + readCommand(fileName);
}

function present(text) {
  return text === MISSING_VALUE ? null : text;
}

export function parseSettingsOutput(result) {
  if (!result || result.timedOut || result.exitCode !== 0 || typeof result.stdout !== 'string' || !result.stdout.endsWith('\n')) {
    return { ok: false, values: EMPTY_VALUES };
  }
  const lines = result.stdout.slice(0, -1).split('\n');
  if (lines.length < 2) {
    return { ok: false, values: EMPTY_VALUES };
  }
  const refreshText = lines.pop();
  return { ok: true, values: { accounts: present(lines.join('\n')), refreshSeconds: present(refreshText) } };
}

export function hasWritten(values, writes) {
  return writtenKeys(writes).every((key) => values[key] === String(writes[key]));
}

export function planMigration(fileValues, legacyAccounts, legacyRefreshSeconds) {
  const accounts = Array.prototype.slice.call(legacyAccounts || []);
  if (fileValues.accounts !== null || accounts.length === 0) {
    return {};
  }
  const writes = { accounts: serializeAccounts(accounts) };
  if (fileValues.refreshSeconds === null && isValidRefresh(legacyRefreshSeconds)) {
    writes.refreshSeconds = legacyRefreshSeconds;
  }
  return writes;
}

function merged(values, writes) {
  const next = Object.assign({}, values);
  writtenKeys(writes).forEach((key) => {
    next[key] = String(writes[key]);
  });
  return next;
}

export function createSettingsStore(deps) {
  const fileName = assertSettingsFileName(deps.fileName);
  let queue = Promise.resolve();

  function enqueue(work) {
    const next = queue.then(work);
    queue = next.then(() => null, () => null);
    return next;
  }

  function read() {
    return deps.runCommand(readCommand(fileName), SETTINGS_TIMEOUT_MS).then(parseSettingsOutput);
  }

  function write(writes) {
    return deps.runCommand(writeCommand(fileName, writes), SETTINGS_TIMEOUT_MS).then(parseSettingsOutput).then((result) => {
      if (!result.ok || !hasWritten(result.values, writes)) {
        throw new Error('the settings file was not saved');
      }
      return result.values;
    });
  }

  function migrationFor(values) {
    const legacy = deps.legacy();
    return planMigration(values, legacy.accounts, legacy.refreshSeconds);
  }

  function load() {
    return enqueue(() => read().then((result) => {
      if (!result.ok) {
        return { ok: false, values: merged(EMPTY_VALUES, migrationFor(EMPTY_VALUES)) };
      }
      const writes = migrationFor(result.values);
      if (writtenKeys(writes).length === 0) {
        return { ok: true, values: result.values };
      }
      return write(writes).then((values) => ({ ok: true, values: values }), () => ({ ok: true, values: merged(result.values, writes) }));
    }));
  }

  function update(change) {
    return enqueue(() => read().then((result) => {
      if (!result.ok) {
        throw new Error('the settings file could not be read');
      }
      const migration = migrationFor(result.values);
      return write(Object.assign({}, migration, change(merged(result.values, migration))));
    }));
  }

  return { load: load, update: update };
}
