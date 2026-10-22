import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SETTINGS_FILE, MISSING_VALUE, SETTINGS_TIMEOUT_MS, TOOL_TIMEOUT_SECONDS, EMPTY_VALUES,
  assertSettingsFileName, encodeBase64, readCommand, writeCommand, parseSettingsOutput, hasWritten, planMigration, createSettingsStore,
} from '../../package/contents/code/core/settingsFile.mjs';

const ACCOUNTS_WRITE = /printf "%s" '([A-Za-z0-9+/=]*)' \| base64 -d\) && timeout 5 kwriteconfig6 --file '([^']+)' --group 'General' --key 'accounts' -- "\$v"/;
const REFRESH_WRITE = /kwriteconfig6 --file '([^']+)' --group 'General' --key 'refreshSeconds' -- '([0-9]+)'/;
const CLAUDE = { id: 'aone', service: 'claude', name: 'one', org: 'org-1' };
const OTHER = { id: 'atwo', service: 'claude', name: 'two', org: 'org-2' };

function fakeKConfig(initial, options) {
  const settings = Object.assign({ readFails: false, writesIgnored: false }, options || {});
  const file = Object.assign({ accounts: null, refreshSeconds: null }, initial || {});
  const log = { commands: [], writes: 0, timeouts: [] };
  const output = () => (file.accounts === null ? MISSING_VALUE : file.accounts) + '\n' + (file.refreshSeconds === null ? MISSING_VALUE : file.refreshSeconds) + '\n';
  const runCommand = (command, timeoutMs) => {
    log.commands.push(command);
    log.timeouts.push(timeoutMs);
    if (settings.readFails) {
      return Promise.resolve({ exitCode: 127, stdout: '', stderr: 'kreadconfig6: not found', timedOut: false });
    }
    const accounts = ACCOUNTS_WRITE.exec(command);
    const refresh = REFRESH_WRITE.exec(command);
    if (accounts || refresh) {
      log.writes += 1;
    }
    if (!settings.writesIgnored) {
      if (accounts) {
        file.accounts = Buffer.from(accounts[1], 'base64').toString('utf8');
      }
      if (refresh) {
        file.refreshSeconds = refresh[2];
      }
    }
    return Promise.resolve({ exitCode: 0, stdout: output(), stderr: '', timedOut: false });
  };
  return { file, log, runCommand };
}

function store(fake, legacyAccounts, legacyRefresh) {
  return createSettingsStore({
    fileName: SETTINGS_FILE,
    runCommand: fake.runCommand,
    legacy: () => ({ accounts: legacyAccounts || [], refreshSeconds: legacyRefresh === undefined ? 30 : legacyRefresh }),
  });
}

test('the settings live in their own file in the KDE config folder, read with kreadconfig6 and a missing marker', () => {
  assert.equal(SETTINGS_FILE, 'ai-usage-widgetrc');
  assert.equal(readCommand(SETTINGS_FILE), "a=$(timeout 5 kreadconfig6 --file 'ai-usage-widgetrc' --group 'General' --key 'accounts' --default '<missing>') && r=$(timeout 5 kreadconfig6 --file 'ai-usage-widgetrc' --group 'General' --key 'refreshSeconds' --default '<missing>') && printf \"%s\\n%s\\n\" \"$a\" \"$r\"");
});

test('only a plain file name that ends in rc is accepted', () => {
  assert.equal(assertSettingsFileName('ai-usage-test-7rc'), 'ai-usage-test-7rc');
  ['../ai-usagerc', 'a/brc', 'ai-usage', '', 'rc', '.hiddenrc', 42].forEach((name) => assert.throws(() => assertSettingsFileName(name), /plain file name/, String(name)));
});

test('the base64 text is the UTF-8 bytes of the value, for ASCII, accents, quotes and characters outside the basic plane', () => {
  ['', 'a', 'ab', 'abc', '[{"name":"Łukasz \\"q\\" O\'Brien; $(rm) é"}]', 'euro € emoji \u{1F600} and \u{10FFFF}', 'ü'.repeat(41)].forEach((text) => {
    assert.equal(encodeBase64(text), Buffer.from(text, 'utf8').toString('base64'), text);
  });
});

test('a written account list reaches the shell only as base64, so no name can break the command', () => {
  const accounts = JSON.stringify([{ id: 'aone', service: 'claude', name: "O'Brien\"; rm -rf ~; echo '" }]);
  const command = writeCommand(SETTINGS_FILE, { accounts: accounts, refreshSeconds: 300 });
  assert.equal(command.indexOf('Brien'), -1);
  assert.equal(Buffer.from(ACCOUNTS_WRITE.exec(command)[1], 'base64').toString('utf8'), accounts);
  assert.deepEqual(REFRESH_WRITE.exec(command).slice(1), ['ai-usage-widgetrc', '300']);
  assert.ok(command.endsWith(readCommand(SETTINGS_FILE)), 'the command reads the file back');
  assert.ok(command.indexOf('--key \'accounts\'') < command.indexOf('--key \'refreshSeconds\' --'), 'the accounts are written first');
});

test('a write with nothing to write, an empty list text or a refresh that is not a whole number is refused', () => {
  assert.throws(() => writeCommand(SETTINGS_FILE, {}), /nothing to write/);
  assert.throws(() => writeCommand(SETTINGS_FILE, { accounts: '' }), /non-empty string/);
  assert.throws(() => writeCommand(SETTINGS_FILE, { accounts: 7 }), /non-empty string/);
  [30.5, '300', -30, 10000000, NaN].forEach((value) => assert.throws(() => writeCommand(SETTINGS_FILE, { refreshSeconds: value }), /whole number/, String(value)));
  assert.throws(() => writeCommand('../x', { refreshSeconds: 30 }), /plain file name/);
});

test('the read output gives each value, or null when the key is not in the file', () => {
  assert.deepEqual(parseSettingsOutput({ exitCode: 0, stdout: '<missing>\n<missing>\n', timedOut: false }), { ok: true, values: { accounts: null, refreshSeconds: null } });
  assert.deepEqual(parseSettingsOutput({ exitCode: 0, stdout: '[]\n300\n', timedOut: false }), { ok: true, values: { accounts: '[]', refreshSeconds: '300' } });
  assert.deepEqual(parseSettingsOutput({ exitCode: 0, stdout: '\n\n', timedOut: false }), { ok: true, values: { accounts: '', refreshSeconds: '' } });
  assert.deepEqual(parseSettingsOutput({ exitCode: 0, stdout: 'line one\nline two\n60\n', timedOut: false }).values, { accounts: 'line one\nline two', refreshSeconds: '60' });
});

test('a failed, timed out, cut off or one line read is not trusted', () => {
  [null, { exitCode: 127, stdout: '', timedOut: false }, { exitCode: 0, stdout: '[]\n30\n', timedOut: true }, { exitCode: 0, stdout: '[]\n30', timedOut: false }, { exitCode: 0, stdout: '[]\n', timedOut: false }, { exitCode: 0, stdout: 7, timedOut: false }].forEach((result) => {
    assert.deepEqual(parseSettingsOutput(result), { ok: false, values: EMPTY_VALUES }, JSON.stringify(result));
  });
});

test('a write counts only when the file reads back every written value', () => {
  assert.equal(hasWritten({ accounts: '[]', refreshSeconds: '300' }, { accounts: '[]', refreshSeconds: 300 }), true);
  assert.equal(hasWritten({ accounts: '[]', refreshSeconds: '30' }, { refreshSeconds: 300 }), false);
  assert.equal(hasWritten({ accounts: null, refreshSeconds: null }, { accounts: '[]' }), false);
});

test('the applet accounts are copied only when the file has no account list and the applet has accounts', () => {
  assert.deepEqual(planMigration({ accounts: null, refreshSeconds: null }, [CLAUDE], 300), { accounts: JSON.stringify([CLAUDE]), refreshSeconds: 300 });
  assert.deepEqual(planMigration({ accounts: null, refreshSeconds: '60' }, [CLAUDE], 300), { accounts: JSON.stringify([CLAUDE]) });
  assert.deepEqual(planMigration({ accounts: null, refreshSeconds: null }, [CLAUDE], undefined), { accounts: JSON.stringify([CLAUDE]) });
  assert.deepEqual(planMigration({ accounts: '[]', refreshSeconds: null }, [CLAUDE], 300), {});
  assert.deepEqual(planMigration({ accounts: JSON.stringify([OTHER]), refreshSeconds: null }, [CLAUDE], 300), {});
  assert.deepEqual(planMigration({ accounts: null, refreshSeconds: null }, [], 300), {});
  assert.deepEqual(planMigration({ accounts: null, refreshSeconds: null }, undefined, 300), {});
});

test('the first start copies the applet accounts and refresh into the file once', async () => {
  const fake = fakeKConfig();
  const settings = store(fake, [CLAUDE], 300);
  assert.deepEqual(await settings.load(), { ok: true, values: { accounts: JSON.stringify([CLAUDE]), refreshSeconds: '300' } });
  assert.deepEqual(fake.file, { accounts: JSON.stringify([CLAUDE]), refreshSeconds: '300' });
  assert.equal(fake.log.writes, 1);
  await settings.load();
  assert.equal(fake.log.writes, 1, 'the second start writes nothing');
  assert.ok(fake.log.timeouts.every((value) => value === SETTINGS_TIMEOUT_MS));
});

test('when the file and the applet both have accounts, the file wins and nothing is written', async () => {
  const fake = fakeKConfig({ accounts: JSON.stringify([OTHER]), refreshSeconds: '60' });
  assert.deepEqual(await store(fake, [CLAUDE], 300).load(), { ok: true, values: { accounts: JSON.stringify([OTHER]), refreshSeconds: '60' } });
  assert.equal(fake.log.writes, 0);
});

test('an empty list in the file stays empty, so deleted accounts never come back from the applet', async () => {
  const fake = fakeKConfig({ accounts: '[]' });
  assert.deepEqual((await store(fake, [CLAUDE], 300).load()).values, { accounts: '[]', refreshSeconds: null });
  assert.equal(fake.log.writes, 0);
});

test('with no accounts anywhere the first start writes no file', async () => {
  const fake = fakeKConfig();
  assert.deepEqual(await store(fake, [], 30).load(), { ok: true, values: { accounts: null, refreshSeconds: null } });
  assert.equal(fake.log.writes, 0);
});

test('a file that cannot be read keeps the applet accounts on screen and reports the failure', async () => {
  const fake = fakeKConfig({}, { readFails: true });
  assert.deepEqual(await store(fake, [CLAUDE], 300).load(), { ok: false, values: { accounts: JSON.stringify([CLAUDE]), refreshSeconds: '300' } });
  assert.deepEqual(await store(fake, [], 300).load(), { ok: false, values: { accounts: null, refreshSeconds: null } });
});

test('a copy that does not reach the file keeps working with the applet accounts and tries again on the next load', async () => {
  const fake = fakeKConfig({}, { writesIgnored: true });
  const settings = store(fake, [CLAUDE], 300);
  assert.deepEqual(await settings.load(), { ok: true, values: { accounts: JSON.stringify([CLAUDE]), refreshSeconds: '300' } });
  await settings.load();
  assert.equal(fake.log.writes, 2);
});

test('an update reads the file first and changes what is there now', async () => {
  const fake = fakeKConfig({ accounts: JSON.stringify([OTHER]), refreshSeconds: '60' });
  const settings = store(fake, [], 30);
  const values = await settings.update((current) => ({ accounts: JSON.stringify(JSON.parse(current.accounts).concat([CLAUDE])) }));
  assert.deepEqual(values, { accounts: JSON.stringify([OTHER, CLAUDE]), refreshSeconds: '60' });
  assert.deepEqual(await settings.update(() => ({ refreshSeconds: 900 })), { accounts: JSON.stringify([OTHER, CLAUDE]), refreshSeconds: '900' });
});

test('the first update of a file with no account list starts from the applet accounts and copies them too', async () => {
  const fake = fakeKConfig();
  const settings = store(fake, [CLAUDE], 300);
  let seen = null;
  await settings.update((current) => {
    seen = current;
    return { accounts: JSON.stringify(JSON.parse(current.accounts).concat([OTHER])) };
  });
  assert.deepEqual(seen, { accounts: JSON.stringify([CLAUDE]), refreshSeconds: '300' });
  assert.deepEqual(fake.file, { accounts: JSON.stringify([CLAUDE, OTHER]), refreshSeconds: '300' });
});

test('an update fails when the file cannot be read or does not read back the new value', async () => {
  await assert.rejects(store(fakeKConfig({}, { readFails: true }), [], 30).update(() => ({ refreshSeconds: 60 })), /could not be read/);
  await assert.rejects(store(fakeKConfig({}, { writesIgnored: true }), [], 30).update(() => ({ refreshSeconds: 60 })), /not saved/);
});

test('updates run one after another, so two quick changes both reach the file', async () => {
  const fake = fakeKConfig({ accounts: '[]' });
  const settings = store(fake, [], 30);
  const add = (account) => settings.update((current) => ({ accounts: JSON.stringify(JSON.parse(current.accounts).concat([account])) }));
  const failed = settings.update(() => ({ refreshSeconds: 1.5 }));
  await Promise.all([add(CLAUDE), add(OTHER), assert.rejects(failed, /whole number/)]);
  assert.deepEqual(JSON.parse(fake.file.accounts).map((item) => item.id), ['aone', 'atwo']);
});

test('a write and its read back end inside the time the widget waits, even when every tool runs to its own limit', () => {
  const tools = writeCommand(SETTINGS_FILE, { accounts: '[]', refreshSeconds: 30 }).split('timeout ' + TOOL_TIMEOUT_SECONDS + ' ').length - 1;
  assert.equal(tools, 4);
  assert.ok(tools * TOOL_TIMEOUT_SECONDS * 1000 < SETTINGS_TIMEOUT_MS);
});
