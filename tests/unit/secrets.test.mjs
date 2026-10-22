import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as Secrets from '../../package/contents/code/core/secrets.mjs';

test('the lookup part asks for the KWallet entry by server, user and type, in single quotes, and contains no key', () => {
  assert.equal(Secrets.buildLookupPart('requesty', 'work'), "secret-tool lookup server 'ai-usage' user 'requesty.work' type 'plaintext'");
});

test('the lookup part refuses a provider or account that could inject a command or an option', () => {
  assert.throws(() => Secrets.buildLookupPart('requesty', 'work; rm -rf ~'), /account name is not allowed/);
  assert.throws(() => Secrets.buildLookupPart('$(id)', 'work'), /provider name is not allowed/);
  assert.throws(() => Secrets.buildLookupPart('requesty', '--help'), /account name is not allowed/);
});

test('there is no store command any more, keys are saved in the widget settings', () => {
  assert.equal(Secrets.buildStoreCommand, undefined);
});

test('the locked check asks the Secret Service SearchItems for the same entry, which loads no secret', () => {
  assert.equal(Secrets.buildSearchPart('requesty', 'work'), "gdbus call --session --dest org.freedesktop.secrets --object-path /org/freedesktop/secrets --method org.freedesktop.Secret.Service.SearchItems \"{'server': 'ai-usage', 'user': 'requesty.work', 'type': 'plaintext'}\"");
  assert.throws(() => Secrets.buildSearchPart('requesty', 'a;b'), /account name is not allowed/);
  assert.throws(() => Secrets.buildSearchPart('requesty', 'a"b'), /account name is not allowed/);
});
