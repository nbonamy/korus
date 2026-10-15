import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

for (const scenario of [
  { name: 'local SDK selected by .env', dotenv: '1', source: true },
  { name: 'shell source mode overrides .env', dotenv: '0', shell: '1', source: true },
  { name: 'workspace-installed SDK when shell disables source mode', dotenv: '1', shell: '0' },
  { name: 'hoisted SDK by default', hoisted: true },
]) {
  test(`dev launcher supplies usable speech assets from ${scenario.name}`, () => {
    const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'korus dev assets ')));
    const root = path.join(temp, 'korus');
    try {
      mkdirSync(path.join(root, 'scripts'), { recursive: true });
      copyFileSync(new URL('./dev.mjs', import.meta.url), path.join(root, 'scripts/dev.mjs'));
      mkdirSync(path.join(root, 'node_modules'), { recursive: true });
      symlinkSync(fileURLToPath(new URL('../node_modules/dotenv', import.meta.url)), path.join(root, 'node_modules/dotenv'), process.platform === 'win32' ? 'junction' : 'dir');
      const installedPackage = path.join(root, scenario.hoisted ? '' : 'backend', 'node_modules/@codex-app-sdk/backend');
      const localAssets = path.join(temp, 'codex-app-sdk/packages/backend/assets');
      for (const directory of [path.join(installedPackage, 'assets'), localAssets, path.join(root, 'backend/dist')]) {
        mkdirSync(directory, { recursive: true });
      }
      writeFileSync(path.join(installedPackage, 'package.json'), '{"name":"@codex-app-sdk/backend"}');
      writeFileSync(path.join(installedPackage, 'assets/apple-speechanalyzer-cli'), 'installed helper');
      writeFileSync(path.join(localAssets, 'apple-speechanalyzer-cli'), 'local helper');
      writeFileSync(path.join(root, 'backend/dist/daemon.mjs'), '');
      if (scenario.dotenv) writeFileSync(path.join(root, '.env'), `CODEX_APP_SDK_SOURCE=${scenario.dotenv}\n`);
      const trace = path.join(temp, 'trace.json');
      const npmCli = path.join(temp, 'npm cli.cjs');
      writeFileSync(npmCli, `
        const fs = require('node:fs');
        const path = require('node:path');
        if (process.argv.includes('build:codex') || process.env.APP_BUNDLED_CODEX_PATH) process.exit(99);
        if (process.argv.includes('dev:backend')) setInterval(() => {}, 1000);
        if (process.argv.includes('start:electron')) {
          const assets = process.env.CODEX_APP_SDK_ASSETS_PATH;
          const copy = path.join(process.cwd(), 'copied-helper');
          fs.copyFileSync(path.join(assets, 'apple-speechanalyzer-cli'), copy);
          fs.writeFileSync(process.env.APP_DEV_TRACE, JSON.stringify({ assets, helper: fs.readFileSync(copy, 'utf8'), nodeEnv: process.env.NODE_ENV }));
        }
      `);
      const env = { ...process.env, NODE_ENV: 'production', npm_execpath: npmCli, APP_DEV_TRACE: trace };
      delete env.CODEX_APP_SDK_SOURCE;
      delete env.CODEX_APP_SDK_ASSETS_PATH;
      delete env.APP_BUNDLED_CODEX_PATH;
      if (scenario.shell) env.CODEX_APP_SDK_SOURCE = scenario.shell;
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/dev.mjs')], {
        cwd: temp, env, encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(trace, 'utf8')), {
        assets: scenario.source ? localAssets : path.join(installedPackage, 'assets'),
        helper: scenario.source ? 'local helper' : 'installed helper',
        nodeEnv: 'development',
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}

test('a failed npm spawn rejects startup without an unsettled top-level await', () => {
  const env = { ...process.env, PATH: '' };
  delete env.npm_execpath;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./dev.mjs', import.meta.url))], {
    env, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /ENOENT/);
  assert.doesNotMatch(result.stderr, /unsettled top-level await/);
});
