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
      mkdirSync(path.join(root, 'scripts')); mkdirSync(path.join(root, 'core/src'), { recursive: true });
      writeFileSync(path.join(root, 'core/src/product.json'), '{}');
      copyFileSync(new URL(script, import.meta.url), path.join(root, 'scripts', script));
      symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      copyFileSync(new URL('sdk-sources.mjs', import.meta.url), path.join(root, 'scripts/sdk-sources.mjs'));
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', name: 'example-app' }));
      const sdkRoot = path.join(root, 'sdk checkout');
      for (const name of ['codex-sdk', 'multi-agent-sdk', 'agent-ui-sdk']) {
        mkdirSync(path.join(sdkRoot, name), { recursive: true });
        writeFileSync(path.join(sdkRoot, name, 'package.json'), JSON.stringify({ name: '@korus-dev/' + name, exports: {} }));
      }
      const trace = path.join(root, 'trace.json'); const npmCli = path.join(root, 'npm cli.cjs');
      writeFileSync(npmCli, `require('node:fs').writeFileSync(process.env.APP_BUILD_TRACE, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));process.exit(23);`);
      const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
        cwd: root, env: { ...process.env, PATH: '', npm_execpath: npmCli, APP_BUILD_TRACE: trace, APP_SKIP_SIGNING: '1', SDK_LOCAL_SOURCE: '1', SDK_SOURCE_ROOT: sdkRoot }, encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.error, undefined); assert.equal(result.status, 23, result.stderr);
      const call = JSON.parse(readFileSync(trace, 'utf8'));
      assert.deepEqual(call.args, script === 'build.mjs' ? ['run', 'build:backend'] : ['run', 'build']);
      assert.equal(call.cwd, script === 'build.mjs' ? root : path.join(sdkRoot, 'codex-sdk'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('npm SDK builds are the default and do not require sibling checkouts', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./build-sdk.mjs', import.meta.url))], {
    env: { ...process.env, SDK_LOCAL_SOURCE: '0', SDK_SOURCE_ROOT: '/nonexistent-sdks', npm_execpath: '/nonexistent-npm' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /installed npm SDK/);
});
