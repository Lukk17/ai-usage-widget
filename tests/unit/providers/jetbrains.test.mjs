import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { jetbrains, LOG_TAIL_BYTES } from '../../../package/contents/code/providers/jetbrains.mjs';
import { checkAccount } from '../../../package/contents/code/core/check.mjs';
import { readLocalFile } from '../../../package/contents/code/core/localRead.mjs';
import { ERROR_KIND, REASON, failure } from '../../../package/contents/code/core/http.mjs';
import { PERIOD, makeUsage, usageWindow } from '../../../package/contents/code/core/usage.mjs';
import { fakeHome, placeFixture, placeText, shellRunner, removeFakeHomes } from '../support/localFiles.mjs';

afterEach(removeFakeHomes);

const NOW = Date.UTC(2026, 9, 18, 12);
const ACCOUNT = Object.freeze({ id: 'ajb', service: 'jetbrains', name: 'me' });
const IDEA = '.cache/JetBrains/IntelliJIdea2026.2/log/idea.log';
const PYCHARM = '.cache/JetBrains/PyCharm2026.2/log/idea.log';

function check(home) {
  return checkAccount(jetbrains, ACCOUNT, { runCommand: shellRunner(home).runCommand, clock: () => NOW, newBoundary: () => '' });
}

test('JetBrains AI needs no key and explains that in its help text', () => {
  assert.equal(jetbrains.needsKey, false);
  assert.equal(jetbrains.keyHelp, 'No key needed, read from the JetBrains IDE log');
  assert.match(jetbrains.readCommand, new RegExp('tail -c ' + LOG_TAIL_BYTES));
});

test('the newest available quota line gives the monthly bar from the tariff quota, with no reset time', async () => {
  const home = fakeHome();
  placeFixture(home, IDEA, 'jetbrains/idea.log');
  assert.deepEqual(await check(home), { ok: true, usage: makeUsage({ windows: [usageWindow(PERIOD.MONTHLY, '', (380.75 / 1000000) * 100, null)] }) });
});

test('the newest line across every IDE wins, and a top-up quota above zero adds a top-up window for the additional rows', async () => {
  const home = fakeHome();
  placeFixture(home, IDEA, 'jetbrains/idea.log');
  placeFixture(home, PYCHARM, 'jetbrains/idea-other.log');
  assert.deepEqual((await check(home)).usage.windows, [usageWindow(PERIOD.MONTHLY, '', (550000 / 1000000) * 100, null), usageWindow(PERIOD.TOP_UP, '', (50000 / 200000) * 100, null)]);
});

test('only the line time and the two quota parts leave the read command, never the license or quota ids', async () => {
  const home = fakeHome();
  placeFixture(home, IDEA, 'jetbrains/idea.log');
  placeFixture(home, PYCHARM, 'jetbrains/idea-other.log');
  const read = await readLocalFile(jetbrains, shellRunner(home).runCommand);
  assert.equal(read.found, true);
  assert.equal(read.text, '2026-10-18 12:05:00,000 tariffQuota=Details(current=550000, maximum=1000000 topUpQuota=Details(current=50000, maximum=200000');
});

test('a line with only a tariff quota keeps that part, and a line without it keeps only its time', async () => {
  const home = fakeHome();
  placeText(home, IDEA, '2026-10-18 11:00:00,001 [1] INFO - #c.i.m.l.a.QuotaManager2Impl - New quota state is: Available(quota=JbaiQuota(license=SECRETLIKE, tariffQuota=Details(current=5, maximum=10, available=5)))\n');
  assert.equal((await readLocalFile(jetbrains, shellRunner(home).runCommand)).text, '2026-10-18 11:00:00,001 tariffQuota=Details(current=5, maximum=10');
  assert.deepEqual((await check(home)).usage.windows, [usageWindow(PERIOD.MONTHLY, '', 50, null)]);
  const changed = fakeHome();
  placeText(changed, IDEA, '2026-10-18 11:00:00,001 [1] INFO - #c.i.m.l.a.QuotaManager2Impl - New quota state is: Available(quota=Other(license=SECRETLIKE))\n');
  assert.equal((await readLocalFile(jetbrains, shellRunner(changed).runCommand)).text, '2026-10-18 11:00:00,001');
});

test('every tool of the log read runs inside timeout', () => {
  assert.match(jetbrains.readCommand, /timeout 8 tail -c/);
  assert.match(jetbrains.readCommand, /timeout 8 grep/);
});

test('only the tail of a large log is read', async () => {
  const home = fakeHome();
  const old = '2026-10-18 01:00:00,000 [1] INFO - #c.i.m.l.a.QuotaManager2Impl - New quota state is: Available(quota=JbaiQuota(license=x, current=1, maximum=10, tariffQuota=Details(current=1, maximum=10, available=9), topUpQuota=Details(current=0, maximum=0, available=0)))\n';
  placeText(home, IDEA, old + 'y'.repeat(LOG_TAIL_BYTES) + '\n');
  assert.deepEqual(await check(home), { ok: false, error: failure(ERROR_KIND.NOT_AVAILABLE, REASON.JETBRAINS_NO_QUOTA) });
});

test('no log, no quota line or a changed line each have their own error', async () => {
  assert.deepEqual(await check(fakeHome()), { ok: false, error: failure(ERROR_KIND.NOT_AVAILABLE, REASON.JETBRAINS_LOG_MISSING) });
  const quiet = fakeHome();
  placeText(quiet, IDEA, '2026-10-18 11:00:00,001 [1] INFO - nothing here\n');
  assert.deepEqual(await check(quiet), { ok: false, error: failure(ERROR_KIND.NOT_AVAILABLE, REASON.JETBRAINS_NO_QUOTA) });
  const changed = fakeHome();
  placeText(changed, IDEA, '2026-10-18 11:00:00,001 [1] INFO - #c.i.m.l.a.QuotaManager2Impl - New quota state is: Available(quota=Other(current=1))\n');
  assert.deepEqual(await check(changed), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.FILE_FORMAT_CHANGED) });
  const zero = fakeHome();
  placeText(zero, IDEA, '2026-10-18 11:00:00,001 [1] INFO - #c.i.m.l.a.QuotaManager2Impl - New quota state is: Available(quota=JbaiQuota(tariffQuota=Details(current=0, maximum=0, available=0)))\n');
  assert.deepEqual(await check(zero), { ok: false, error: failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.FILE_FORMAT_CHANGED) });
});
