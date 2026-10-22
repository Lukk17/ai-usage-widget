import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkAccount, discoverAccounts } from '../../package/contents/code/core/check.mjs';
import { KIND } from '../../package/contents/code/core/providerKind.mjs';
import { ERROR_KIND, REASON, failure } from '../../package/contents/code/core/http.mjs';
import { LABEL, makeUsage, usageText, succeeded } from '../../package/contents/code/core/usage.mjs';
import { TEST_BOUNDARY } from './support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);
const ACCOUNT = Object.freeze({ id: 'alocal', service: 'local', name: 'me' });

function localProvider(overrides) {
  return Object.assign({
    id: 'local',
    kind: KIND.LOCAL,
    readCommand: 'read-it',
    maxReadBytes: 100,
    interpret: (read, account, now) => succeeded(makeUsage({ texts: [usageText(LABEL.PLAN, read.text + ':' + account.id + ':' + now)] })),
  }, overrides);
}

function tools(stdout) {
  const calls = [];
  return {
    calls,
    runCommand: (command, timeoutMs) => {
      calls.push({ command, timeoutMs });
      return Promise.resolve({ exitCode: 0, stdout: stdout, stderr: '' });
    },
    clock: () => NOW,
    newBoundary: () => TEST_BOUNDARY,
  };
}

test('a local account is read with the provider command and interpreted with the account and the time', async () => {
  const fake = tools('found 5\nhello');
  const outcome = await checkAccount(localProvider({}), ACCOUNT, fake);
  assert.equal(outcome.usage.texts[0].value, 'hello:alocal:' + NOW);
  assert.deepEqual(fake.calls.map((call) => call.command), ['read-it']);
});

test('a failed local read is passed on, and an interpreter that throws is an internal error', async () => {
  assert.deepEqual(await checkAccount(localProvider({}), ACCOUNT, tools('nonsense')), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.FILE_READ_FAILED) });
  const throwing = localProvider({ interpret: () => { throw new Error('bad'); } });
  assert.deepEqual(await checkAccount(throwing, ACCOUNT, tools('found 1\nx')), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL) });
});

test('a remote account goes through secret-tool and curl with a new boundary', async () => {
  const remote = {
    id: 'requesty',
    kind: KIND.REMOTE,
    auth: { header: 'Authorization', prefix: 'Bearer ' },
    buildRequests: () => [{ id: 'main', url: 'https://example.invalid/main', headers: [] }],
    interpret: () => succeeded(makeUsage({})),
  };
  const fake = tools(`${TEST_BOUNDARY} begin main\n{}\n${TEST_BOUNDARY} end 200 \n${TEST_BOUNDARY} curl 0\n`);
  const outcome = await checkAccount(remote, { id: 'awork', service: 'requesty', name: 'work' }, fake);
  assert.equal(outcome.ok, true);
  assert.match(fake.calls[0].command, /secret-tool lookup server 'ai-usage' user 'requesty\.awork'/);
});

test('discovery reads the file once and lists what the provider finds', async () => {
  const provider = localProvider({ discover: (read) => ({ ok: true, items: [{ fields: { org: read.text }, usage: makeUsage({}) }] }) });
  assert.deepEqual((await discoverAccounts(provider, tools('found 5\norg-1'))).items.map((item) => item.fields.org), ['org-1']);
  assert.deepEqual(await discoverAccounts(localProvider({}), tools('found 1\nx')), { ok: true, items: [] });
  assert.equal((await discoverAccounts(provider, tools('bad'))).ok, false);
  const throwing = localProvider({ discover: () => { throw new Error('bad'); } });
  assert.deepEqual(await discoverAccounts(throwing, tools('found 1\nx')), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL) });
});
