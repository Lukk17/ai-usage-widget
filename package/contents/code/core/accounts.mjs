import { isValidLabel } from './validation.mjs';
import { isPlainObject, randomHex } from './values.mjs';

export const REFRESH_CHOICES_SECONDS = Object.freeze([30, 60, 300, 900, 1800, 3600]);
export const DEFAULT_REFRESH_SECONDS = 30;
export const MIN_MANUAL_REFRESH_SECONDS = REFRESH_CHOICES_SECONDS[0];
export const MAX_ACCOUNT_NAME_LENGTH = 100;
export const FIELD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

const ID_PREFIX = 'a';
const ID_DIGITS = 12;
const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;
const LAST_C0_CONTROL = 0x1f;
const FIRST_DELETE_CONTROL = 0x7f;
const LAST_C1_CONTROL = 0x9f;

export function refreshSeconds(value) {
  const seconds = Number(value);
  return REFRESH_CHOICES_SECONDS.indexOf(seconds) === -1 ? DEFAULT_REFRESH_SECONDS : seconds;
}

export function cleanKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function newDiscoveries(items, accounts, providerId) {
  const taken = Array.prototype.slice.call(accounts || []).filter((account) => account.service === providerId);
  return Array.prototype.slice.call(items || []).filter((item) => !taken.some((account) => Object.keys(item.fields).every((field) => account[field] === item.fields[field])));
}

export function areDiscoveryNamesValid(names) {
  const values = Object.keys(names || {}).map((key) => names[key]);
  return values.some((value) => cleanName(value) !== '') && values.every((value) => cleanName(value) === '' || isValidName(value));
}

export function cleanName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isControlCode(code) {
  return code <= LAST_C0_CONTROL || (code >= FIRST_DELETE_CONTROL && code <= LAST_C1_CONTROL) || code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR;
}

function hasControlCharacter(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (isControlCode(text.charCodeAt(index))) {
      return true;
    }
  }
  return false;
}

export function isValidName(value) {
  const name = cleanName(value);
  return name.length > 0 && name.length <= MAX_ACCOUNT_NAME_LENGTH && !hasControlCharacter(name);
}

export function isValidField(value) {
  return typeof value === 'string' && FIELD_PATTERN.test(value);
}

export function newAccountId(existingIds, random) {
  const taken = Array.prototype.slice.call(existingIds || []);
  for (;;) {
    const id = ID_PREFIX + randomHex(ID_DIGITS, random);
    if (taken.indexOf(id) === -1) {
      return id;
    }
  }
}

export function makeAccount(provider, id, name, fields) {
  const values = fields || {};
  if (!provider || !isValidLabel(id) || !isValidName(name)) {
    return null;
  }
  const account = { id: id, service: provider.id, name: cleanName(name) };
  for (const field of provider.fields) {
    if (!isValidField(values[field.id])) {
      return null;
    }
    account[field.id] = values[field.id];
  }
  return account;
}

export function parseAccounts(text, findProvider) {
  let value;
  try {
    value = JSON.parse(typeof text === 'string' && text.trim() !== '' ? text : '[]');
  } catch (error) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const accounts = [];
  value.forEach((item) => {
    const account = isPlainObject(item) ? makeAccount(findProvider(item.service), item.id, item.name, item) : null;
    if (account !== null && !accounts.some((existing) => existing.id === account.id)) {
      accounts.push(account);
    }
  });
  return accounts;
}

export function serializeAccounts(accounts) {
  return JSON.stringify(Array.prototype.slice.call(accounts || []));
}

export function withAccount(accounts, account) {
  const list = Array.prototype.slice.call(accounts || []);
  const index = list.findIndex((item) => item.id === account.id);
  if (index === -1) {
    return list.concat([account]);
  }
  list[index] = account;
  return list;
}

export function withOrder(accounts, ids) {
  const list = Array.prototype.slice.call(accounts || []);
  const wanted = Array.prototype.slice.call(ids || []);
  const ordered = wanted.map((id) => list.filter((item) => item.id === id)[0]).filter((item, index, all) => item !== undefined && all.indexOf(item) === index);
  return ordered.concat(list.filter((item) => ordered.indexOf(item) === -1));
}

export function withAccountMoved(accounts, id, step) {
  const list = Array.prototype.slice.call(accounts || []);
  const from = list.findIndex((item) => item.id === id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= list.length) {
    return list;
  }
  const moved = list.splice(from, 1)[0];
  list.splice(to, 0, moved);
  return list;
}

export function withoutAccount(accounts, id) {
  return Array.prototype.slice.call(accounts || []).filter((item) => item.id !== id);
}
