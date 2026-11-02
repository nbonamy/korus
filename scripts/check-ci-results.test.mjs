import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('./check-ci-results.mjs', import.meta.url));
test('CI aggregate requires every expected successful job', () => {
  const run = (needs) =>
    spawnSync(process.execPath, [cli, 'checks', 'tests'], {
      env: { ...process.env, CI_RESULTS: JSON.stringify(needs) },
      encoding: 'utf8',
    });
  assert.equal(
    run({ checks: { result: 'success' }, tests: { result: 'success' } }).status,
    0,
  );
  for (const state of ['failure', 'cancelled', 'skipped'])
    assert.notEqual(
      run({ checks: { result: 'success' }, tests: { result: state } }).status,
      0,
    );
  assert.notEqual(run({ checks: { result: 'success' } }).status, 0);
  assert.notEqual(run({}).status, 0);
});
