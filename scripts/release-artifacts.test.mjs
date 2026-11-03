import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildAsar } from './fixtures/build-asar.mjs';
import { collectArtifacts, listTarget } from './release-artifacts.mjs';
import { readZip } from './sourcemap-archive.mjs';

const installers = { 'darwin-arm64': ['zip', 'dmg'], 'win32-x64': ['zip', 'exe', 'nupkg', 'RELEASES'],
  'linux-x64': ['zip', 'deb', 'rpm'], 'linux-arm64': ['zip', 'deb', 'rpm'] };

async function collect(t, target, omit) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-artifacts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'make');
  await fs.mkdir(path.join(source, 'nested'), { recursive: true });
  for (const extension of installers[target].filter(item => item !== omit)) {
    await fs.writeFile(path.join(source, 'nested', extension === 'RELEASES' ? extension : `app-0.27.0.${extension}`), extension);
  }
  const output = path.join(root, 'out');
  await collectArtifacts({ source, output, target });
  return output;
}

test('installers are renamed for download except Squirrel files, which keep the names RELEASES references', async t => {
  assert.deepEqual((await fs.readdir(await collect(t, 'darwin-arm64'))).sort(), ['korus-darwin-arm64.zip', 'korus-macos-arm64.dmg']);
  assert.deepEqual((await fs.readdir(await collect(t, 'win32-x64'))).sort(),
    ['RELEASES', 'app-0.27.0.nupkg', 'korus-win32-x64-setup.exe', 'korus-win32-x64.zip']);
});

test('a platform missing an installer type is not publishable', async t => {
  await assert.rejects(collect(t, 'win32-x64', 'exe'), /Missing \.exe artifact for win32-x64/);
  await assert.rejects(listTarget('/nonexistent-artifact-directory', 'linux-x64'), /Missing \.zip artifact for linux-x64/);
});

test('the shipped source maps are published beside each target\'s installers, and a build without them is not publishable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-artifacts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'make');
  await fs.mkdir(source, { recursive: true });
  for (const extension of installers['linux-x64']) await fs.writeFile(path.join(source, `app-0.27.0.${extension}`), extension);
  const packaged = path.join(root, 'packaged');
  await fs.mkdir(path.join(packaged, 'korus-linux-x64/resources'), { recursive: true });
  await assert.rejects(collectArtifacts({ source, output: path.join(root, 'none'), target: 'linux-x64', sourcemaps: packaged }), /Packaged app\.asar not found/);
  await fs.writeFile(path.join(packaged, 'korus-linux-x64/resources/app.asar'), buildAsar({ '.vite/renderer/main_window/assets/index-ABC.js.map': '{"version":3,"mappings":""}' }));
  const output = path.join(root, 'out');
  await collectArtifacts({ source, output, target: 'linux-x64', sourcemaps: packaged, version: '0.27.0' });
  assert.deepEqual((await fs.readdir(output)).sort(), ['korus-linux-x64-sourcemaps.zip', 'korus-linux-x64.deb', 'korus-linux-x64.rpm', 'korus-linux-x64.zip']);
  const zip = readZip(await fs.readFile(path.join(output, 'korus-linux-x64-sourcemaps.zip')));
  assert.deepEqual(zip.names, ['sourcemaps.json', 'renderer/main_window/assets/index-ABC.js.map']);
  assert.equal(JSON.parse(zip.read('sourcemaps.json')).version, '0.27.0');
});
