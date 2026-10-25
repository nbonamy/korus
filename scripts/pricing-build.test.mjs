import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('standalone and desktop resource bundles load the checked-in pricing catalog offline', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pricing-build-'));
  try {
    await mkdir(path.join(temp, 'backend'), { recursive: true });
    await mkdir(path.join(temp, 'scripts'));
    for (const name of ['core', 'node_modules']) {
      await symlink(path.join(root, name), path.join(temp, name), process.platform === 'win32' ? 'junction' : 'dir');
    }
    await copyFile(path.join(root, 'scripts/package-backend.mjs'), path.join(temp, 'scripts/package-backend.mjs'));
    await writeFile(path.join(temp, 'offline.mjs'), `
import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
const fail = () => { throw new Error('Network is disabled'); };
globalThis.fetch = fail; http.request = fail; https.request = fail; net.connect = fail; net.createConnection = fail;
`);
    const config = path.join(root, 'backend/vite.config.ts');
    await writeFile(path.join(temp, 'build.mjs'), `import { build } from 'vite';
await build({ configFile: ${JSON.stringify(config)}, logLevel: 'silent', build: { outDir: ${JSON.stringify(path.join(temp, 'backend/dist'))}, sourcemap: false } });
`);
    const run = (args) => {
      const result = spawnSync(process.execPath, ['--import', path.join(temp, 'offline.mjs'), ...args], {
        cwd: temp, env: { ...process.env, CODEX_APP_SDK_SOURCE: '0' }, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    run([path.join(temp, 'build.mjs')]);
    run([path.join(temp, 'scripts/package-backend.mjs')]);
    const results = [];
    const expected = JSON.parse(await readFile(path.join(root, 'backend/src/pricing/history.json'), 'utf8'));
    for (const bundle of ['backend/dist/daemon.mjs', 'electron/resources/daemon/daemon.mjs']) {
      const url = pathToFileURL(path.join(temp, bundle)).href;
      const output = run(['--input-type=module', '-e', `
const { loadPricingHistory } = await import(${JSON.stringify(url)});
const history = loadPricingHistory();
console.log(JSON.stringify(history));
`]);
      const history = JSON.parse(output);
      assert.equal(history[0].date, '2026-10-01T00:00:00.000Z');
      assert.deepEqual(history, expected);
      results.push(history);
    }
    assert.deepEqual(results[0], results[1]);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
