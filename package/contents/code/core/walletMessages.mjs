import { assertValidLabel } from './validation.mjs';

export const WALLET_SERVICE = 'org.kde.kwalletd6';
export const WALLET_PATH = '/modules/kwalletd6';
export const WALLET_INTERFACE = 'org.kde.KWallet';
export const WALLET_FOLDER = 'ai-usage';
export const WALLET_APP_ID = 'ai-usage-widget';

export const WALLET_ERROR = Object.freeze({
  NOT_RUNNING: 'not_running',
  NO_ANSWER: 'no_answer',
  NO_ANSWER_AFTER_OPEN: 'no_answer_after_open',
  LOCKED: 'locked',
  WRITE_FAILED: 'write_failed',
  REMOVE_FAILED: 'remove_failed',
  FAILED: 'failed',
  INVALID_KEY: 'invalid_key',
  CANCELLED: 'cancelled',
});

const KEY_PATTERN = /^[\x21-\x7E]{1,4096}$/;
const ENTRY_SEPARATOR = '.';
const WINDOW_ID = 0;
const HANDLE_SESSION = false;
const SUCCESS = 0;
const NOT_RUNNING_ERRORS = ['org.freedesktop.DBus.Error.ServiceUnknown', 'org.freedesktop.DBus.Error.NameHasNoOwner'];
const NO_ANSWER_ERRORS = ['org.freedesktop.DBus.Error.NoReply', 'org.freedesktop.DBus.Error.Timeout'];

export function entryName(providerId, account) {
  assertValidLabel(providerId, 'provider');
  assertValidLabel(account, 'account');
  return providerId + ENTRY_SEPARATOR + account;
}

export function isValidKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

function message(member, args, signature) {
  return { service: WALLET_SERVICE, path: WALLET_PATH, iface: WALLET_INTERFACE, member: member, arguments: args, signature: signature };
}

export function localWalletMessage() {
  return message('localWallet', [], '');
}

export function openAsyncMessage(walletName) {
  return message('openAsync', [walletName, WINDOW_ID, WALLET_APP_ID, HANDLE_SESSION], '(sxsb)');
}

export function writePasswordMessage(handle, providerId, account, key) {
  if (!isValidKey(key)) {
    throw new Error('the key must be plain ASCII without spaces or line breaks');
  }
  return message('writePassword', [handle, WALLET_FOLDER, entryName(providerId, account), key, WALLET_APP_ID], '(issss)');
}

export function hasEntryMessage(handle, providerId, account) {
  return message('hasEntry', [handle, WALLET_FOLDER, entryName(providerId, account), WALLET_APP_ID], '(isss)');
}

export function removeEntryMessage(handle, providerId, account) {
  return message('removeEntry', [handle, WALLET_FOLDER, entryName(providerId, account), WALLET_APP_ID], '(isss)');
}

export function closeMessage(handle) {
  return message('close', [handle, false, WALLET_APP_ID], '(ibs)');
}

export function unwrapValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'value' in value ? value.value : value;
}

export function errorForDbus(name) {
  if (NOT_RUNNING_ERRORS.indexOf(name) !== -1) {
    return WALLET_ERROR.NOT_RUNNING;
  }
  return NO_ANSWER_ERRORS.indexOf(name) !== -1 ? WALLET_ERROR.NO_ANSWER : WALLET_ERROR.FAILED;
}

export function errorForHandle(handle) {
  if (typeof handle !== 'number') {
    return WALLET_ERROR.FAILED;
  }
  return handle >= 0 ? null : WALLET_ERROR.LOCKED;
}

export function errorForResult(result, failureCode) {
  return result === SUCCESS ? null : failureCode;
}
