import { makeAccount, isValidName, isValidField, cleanKey, cleanName, withAccount, withoutAccount } from './accounts.mjs';

export const INVALID = Object.freeze({
  SERVICE: 'service',
  NAME: 'name',
  FIELD: 'field',
  KEY: 'key',
  ACCOUNT: 'account',
});

function refused(invalid) {
  return Promise.resolve({ ok: false, invalid: invalid, walletCode: '' });
}

function walletFailed(code) {
  return { ok: false, invalid: '', walletCode: code };
}

function done(action, provider, account) {
  return { ok: true, action: action, title: provider.title, name: account.name, id: account.id };
}

export function createAccountActions(deps) {
  function invalidReason(provider, name, fields) {
    if (!isValidName(name)) {
      return INVALID.NAME;
    }
    const values = fields || {};
    return provider.fields.every((field) => isValidField(values[field.id])) ? INVALID.ACCOUNT : INVALID.FIELD;
  }

  function store(account, checkNow) {
    return deps.updateAccounts((list) => withAccount(list, account)).then(() => {
      if (checkNow) {
        deps.recheck(account.id);
      }
    });
  }

  function storeNewKeyAccount(provider, account) {
    return store(account, true).then(() => done('add', provider, account), (error) => deps.wallet.remove(provider.id, account.id).then(() => {
      throw error;
    }, () => {
      throw error;
    }));
  }

  function add(spec) {
    const provider = deps.findProvider(spec.service);
    if (!provider) {
      return refused(INVALID.SERVICE);
    }
    const id = deps.newId(deps.getAccounts().map((item) => item.id));
    const account = makeAccount(provider, id, spec.name, spec.fields);
    if (account === null) {
      return refused(invalidReason(provider, spec.name, spec.fields));
    }
    if (!provider.needsKey) {
      return store(account, true).then(() => done('add', provider, account));
    }
    const key = cleanKey(spec.key);
    if (key === '') {
      return refused(INVALID.KEY);
    }
    return deps.wallet.save(provider.id, id, key).then((result) => (result.ok ? storeNewKeyAccount(provider, account) : walletFailed(result.code)));
  }

  function edit(id, spec) {
    const current = deps.getAccounts().filter((item) => item.id === id)[0];
    const provider = current ? deps.findProvider(current.service) : null;
    if (!provider) {
      return refused(INVALID.ACCOUNT);
    }
    const fields = Object.assign({}, current, spec.fields || {});
    const account = makeAccount(provider, id, spec.name, fields);
    if (account === null) {
      return refused(invalidReason(provider, spec.name, fields));
    }
    const key = cleanKey(spec.key);
    if (!provider.needsKey || key === '') {
      return store(account, false).then(() => done('edit', provider, account));
    }
    return deps.wallet.save(provider.id, id, key).then((result) => (result.ok
      ? store(account, true).then(() => done('edit', provider, account))
      : walletFailed(result.code)));
  }

  function remove(id) {
    const current = deps.getAccounts().filter((item) => item.id === id)[0];
    const provider = current ? deps.findProvider(current.service) : null;
    if (!provider) {
      return refused(INVALID.ACCOUNT);
    }
    const forget = () => deps.updateAccounts((list) => withoutAccount(list, id)).then(() => done('remove', provider, current));
    if (!provider.needsKey) {
      return forget();
    }
    return deps.wallet.remove(provider.id, id).then((result) => (result.ok ? forget() : walletFailed(result.code)));
  }

  function addMany(service, items) {
    const named = Array.prototype.slice.call(items || []).filter((item) => cleanName(item.name) !== '');
    if (named.length === 0) {
      return refused(INVALID.NAME);
    }
    return named.reduce((chain, item) => chain.then((previous) => (previous && !previous.ok
      ? previous
      : add({ service: service, name: item.name, fields: item.fields }))), Promise.resolve(null));
  }

  return { add: add, addMany: addMany, edit: edit, remove: remove };
}
