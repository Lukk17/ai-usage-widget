import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');
const homes = [];

export function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'ai-usage-home-'));
  homes.push(home);
  return home;
}

export function removeFakeHomes() {
  homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true }));
}

export function placeFixture(home, relativePath, fixture) {
  const target = join(home, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(FIXTURE_ROOT, fixture), target);
  return target;
}

export function placeText(home, relativePath, text) {
  const target = join(home, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return target;
}

export function shellRunner(home, extraEnv = {}) {
  const calls = [];
  const runCommand = (command, timeoutMs) => {
    calls.push({ command, timeoutMs });
    const env = Object.assign({ PATH: process.env.PATH, HOME: home }, extraEnv);
    const result = spawnSync('sh', ['-c', command], { env, encoding: 'utf8', timeout: timeoutMs });
    const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
    return Promise.resolve({ exitCode: result.status, stdout: timedOut ? '' : result.stdout, stderr: result.stderr, timedOut: timedOut });
  };
  return { runCommand, calls };
}
