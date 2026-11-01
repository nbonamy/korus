import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

for (const script of ['build.mjs', 'build-sdk.mjs']) {
  test(`${script} launches the selected npm CLI with spaced paths and propagates build failure`, () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'app build ')));
    try {
      mkdirSync(path.join(root, 'scripts'));
      mkdirSync(path.join(root, 'core/src'), { recursive: true });
      writeFileSync(path.join(root, 'core/src/product.json'), '{}');
      copyFileSync(new URL(script, import.meta.url), path.join(root, 'scripts', script));
      symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      const sdkRoot = path.join(root, 'sdk checkout');
      mkdirSync(sdkRoot);
      writeFileSync(path.join(sdkRoot, 'package.json'), '{}');
      const overrides = {};
      for (const [workspace, name] of [['client/backend', 'backend'], ['client/backend', 'core'], ['client/electron', 'electron'], ['client/vue', 'vue']]) {
        mkdirSync(path.join(root, workspace), { recursive: true });
        writeFileSync(path.join(root, workspace, 'package.json'), '{}');
        overrides[`@codex-app-sdk/${name}`] = `file:./sdk checkout/packages/${name}`;
      }
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', overrides }));
      const trace = path.join(root, 'trace.json');
      const npmCli = path.join(root, 'npm cli.cjs');
      writeFileSync(npmCli, `require('node:fs').writeFileSync(process.env.APP_BUILD_TRACE, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));process.exit(23);`);
      const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
        cwd: root, env: { ...process.env, PATH: '', npm_execpath: npmCli, APP_BUILD_TRACE: trace, APP_SKIP_SIGNING: '1' },
        encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 23, result.stderr);
      const call = JSON.parse(readFileSync(trace, 'utf8'));
      assert.deepEqual(call.args, script === 'build.mjs' ? ['run', 'build:backend'] : ['run', 'build']);
      assert.equal(call.cwd, script === 'build.mjs' ? root : sdkRoot);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
