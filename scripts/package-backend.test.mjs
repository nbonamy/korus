import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

for (const split of [false, true]) {
  test(`daemon packaging ${split ? 'rejects missing lazy chunks' : 'produces a standalone runnable file'}`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'korus-daemon-artifact-'));
    try {
      for (const directory of ['scripts', 'core/src', 'backend/dist']) mkdirSync(path.join(root, directory), { recursive: true });
      copyFileSync(new URL('./package-backend.mjs', import.meta.url), path.join(root, 'scripts/package-backend.mjs'));
      symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      writeFileSync(path.join(root, 'core/src/product.json'), JSON.stringify({ daemonName: 'korusd' }));
      writeFileSync(path.join(root, 'backend/dist/korusd'), '');
      writeFileSync(path.join(root, 'backend/dist/daemon.mjs'), split
        ? 'export const lazy = () => import("./assets/lazy.js");'
        : 'const { basename } = await import("node:path"); process.stdout.write(basename("/fixture/ok"));');
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/package-backend.mjs')], { encoding: 'utf8' });
      if (split) {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /self-contained/);
      } else {
        assert.equal(result.status, 0, result.stderr);
        const run = spawnSync(process.execPath, [path.join(root, 'electron/resources/daemon/daemon.mjs')], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        assert.equal(run.stdout, 'ok');
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
