import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { fileReadCommand, parseLocalRead, readLocalFile, wrapRead, LOCAL_READ_TIMEOUT_MS, LOCAL_TOOL_TIMEOUT_SECONDS, OVERALL_TIMEOUT_SECONDS } from '../../package/contents/code/core/localRead.mjs';
import { ERROR_KIND, REASON, failure } from '../../package/contents/code/core/http.mjs';
import { fakeHome, placeText, shellRunner, removeFakeHomes } from './support/localFiles.mjs';

afterEach(removeFakeHomes);

const READ = Object.freeze({ readCommand: fileReadCommand('"$HOME/data.json"', 16), maxReadBytes: 16 });

test('a found file comes back with its text, a missing one as not found', async () => {
  const home = fakeHome();
  const runner = shellRunner(home);
  assert.deepEqual(await readLocalFile(READ, runner.runCommand), { ok: true, found: false, text: '' });
  placeText(home, 'data.json', '{"a":1}');
  assert.deepEqual(await readLocalFile(READ, runner.runCommand), { ok: true, found: true, text: '{"a":1}' });
  assert.equal(runner.calls[0].timeoutMs, LOCAL_READ_TIMEOUT_MS);
});

test('a file above the cap is refused by its real size, and only the cap is ever read', async () => {
  const home = fakeHome();
  placeText(home, 'data.json', 'x'.repeat(1000));
  const runner = shellRunner(home);
  assert.deepEqual(await readLocalFile(READ, runner.runCommand), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.FILE_TOO_LARGE, null, { size: 16 }) });
  const raw = await runner.runCommand(READ.readCommand, 5000);
  assert.equal(raw.stdout, 'found 1000\n' + 'x'.repeat(16));
});

test('a file exactly at the cap is read whole', async () => {
  const home = fakeHome();
  placeText(home, 'data.json', 'y'.repeat(16));
  assert.deepEqual(await readLocalFile(READ, shellRunner(home).runCommand), { ok: true, found: true, text: 'y'.repeat(16) });
});

test('a symbolic link in place of the file counts as missing', async () => {
  const home = fakeHome();
  placeText(home, 'elsewhere.json', '{"a":1}');
  symlinkSync(join(home, 'elsewhere.json'), join(home, 'data.json'));
  assert.deepEqual(await readLocalFile(READ, shellRunner(home).runCommand), { ok: true, found: false, text: '' });
});

test('the whole read runs inside one overall timeout under the widget limit', () => {
  assert.ok(READ.readCommand.startsWith('timeout ' + OVERALL_TIMEOUT_SECONDS + " sh -c '"));
  assert.ok(OVERALL_TIMEOUT_SECONDS * 1000 < LOCAL_READ_TIMEOUT_MS);
  assert.ok(LOCAL_TOOL_TIMEOUT_SECONDS < OVERALL_TIMEOUT_SECONDS);
  assert.throws(() => wrapRead("it's"), /cannot be quoted/);
});

test('every tool of the read runs inside timeout', () => {
  assert.match(READ.readCommand, new RegExp('timeout ' + LOCAL_TOOL_TIMEOUT_SECONDS + ' wc -c'));
  assert.match(READ.readCommand, new RegExp('timeout ' + LOCAL_TOOL_TIMEOUT_SECONDS + ' head -c 16'));
  assert.ok(LOCAL_TOOL_TIMEOUT_SECONDS * 1000 < LOCAL_READ_TIMEOUT_MS);
});

test('a read that runs past the runner timeout is a read failure', async () => {
  const slow = { readCommand: 'sleep 2', maxReadBytes: 16 };
  const runner = shellRunner(fakeHome());
  const result = await runner.runCommand(slow.readCommand, 100);
  assert.equal(result.timedOut, true);
  assert.deepEqual(parseLocalRead(result, 16), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.FILE_READ_FAILED) });
});

test('a folder in place of the file counts as missing', async () => {
  const home = fakeHome();
  placeText(home, 'data.json/inside', 'x');
  assert.deepEqual(await readLocalFile(READ, shellRunner(home).runCommand), { ok: true, found: false, text: '' });
});

test('a timed out, failed or garbled read is a read failure', async () => {
  const readFailed = { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.FILE_READ_FAILED) };
  assert.deepEqual(parseLocalRead({ timedOut: true, stdout: '' }, 16), readFailed);
  assert.deepEqual(parseLocalRead(null, 16), readFailed);
  assert.deepEqual(parseLocalRead({ stdout: 'something else\n' }, 16), readFailed);
  assert.deepEqual(parseLocalRead({ stdout: 'found' }, 16), readFailed);
  assert.deepEqual(parseLocalRead({ stdout: 'found 0\n' }, 16), { ok: true, found: true, text: '' });
  assert.deepEqual(parseLocalRead({ stdout: 'found \nabc' }, 16), readFailed);
  assert.deepEqual(parseLocalRead({ stdout: 'found 3\nabc' }, 16), { ok: true, found: true, text: 'abc' });
  assert.deepEqual(parseLocalRead({ stdout: 'found 17\n' + 'z'.repeat(16) }, 16), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.FILE_TOO_LARGE, null, { size: 16 }) });
  assert.deepEqual(parseLocalRead({ stdout: 'found 4\n' + String.fromCharCode(0x17c, 0x17c) }, 4), { ok: true, found: true, text: String.fromCharCode(0x17c, 0x17c) });
  assert.deepEqual(await readLocalFile(READ, () => Promise.reject(new Error('gone'))), { ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.COMMAND_FAILED) });
});
