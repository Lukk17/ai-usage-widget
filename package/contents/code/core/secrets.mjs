import { quote } from './shell.mjs';
import { WALLET_FOLDER, entryName } from './walletMessages.mjs';

const ENTRY_TYPE = 'plaintext';

export const SECRET_SERVICE_NAME = 'org.freedesktop.secrets';
export const SECRET_SERVICE_PATH = '/org/freedesktop/secrets';
export const SEARCH_ITEMS_METHOD = 'org.freedesktop.Secret.Service.SearchItems';

function attributes(providerId, account) {
  return 'server ' + quote(WALLET_FOLDER) + ' user ' + quote(entryName(providerId, account)) + ' type ' + quote(ENTRY_TYPE);
}

function attributeDictionary(providerId, account) {
  return '"{\'server\': \'' + WALLET_FOLDER + '\', \'user\': \'' + entryName(providerId, account) + '\', \'type\': \'' + ENTRY_TYPE + '\'}"';
}

export function buildLookupPart(providerId, account) {
  return 'secret-tool lookup ' + attributes(providerId, account);
}

export function buildSearchPart(providerId, account) {
  return 'gdbus call --session --dest ' + SECRET_SERVICE_NAME + ' --object-path ' + SECRET_SERVICE_PATH + ' --method ' + SEARCH_ITEMS_METHOD + ' ' + attributeDictionary(providerId, account);
}
