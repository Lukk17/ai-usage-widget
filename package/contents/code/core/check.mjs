import { ERROR_KIND, REASON, failure } from './http.mjs';
import { KIND } from './providerKind.mjs';
import { fetchUsage } from './fetchUsage.mjs';
import { readLocalFile } from './localRead.mjs';

function internalError() {
  return { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL) };
}

function readLocalUsage(provider, account, tools) {
  return readLocalFile(provider, tools.runCommand).then((read) => {
    if (!read.ok) {
      return { ok: false, error: read.error };
    }
    try {
      return provider.interpret(read, account, tools.clock());
    } catch (error) {
      return internalError();
    }
  });
}

export function checkAccount(provider, account, tools) {
  if (provider.kind === KIND.LOCAL) {
    return readLocalUsage(provider, account, tools);
  }
  return fetchUsage(provider, account, tools.runCommand, tools.clock, tools.newBoundary());
}

export function discoverAccounts(provider, tools) {
  if (typeof provider.discover !== 'function') {
    return Promise.resolve({ ok: true, items: [] });
  }
  return readLocalFile(provider, tools.runCommand).then((read) => {
    if (!read.ok) {
      return { ok: false, error: read.error };
    }
    try {
      return provider.discover(read, tools.clock());
    } catch (error) {
      return internalError();
    }
  });
}
