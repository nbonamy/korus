import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('desktop update lifecycle and command workflows preserve recovery and private state', { skip: process.platform === 'win32', timeout: 60_000 }, () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', '.agents/skills/korus-desktop-update/tests', '-v'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 55_000,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});
