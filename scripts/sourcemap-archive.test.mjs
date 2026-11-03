import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildAsar } from './fixtures/build-asar.mjs';
import { createZip, findPackagedAsar, listAsar, readAsar, readZip, sourcemapZip } from './sourcemap-archive.mjs';

function temporaryDirectory(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sourcemap-archive-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const appFiles = {
  'package.json': '{}',
  '.vite/build/main.js': 'main',
  '.vite/build/main.js.map': '{"version":3,"mappings":""}',
  '.vite/renderer/main_window/assets/index-ABC.js.map': '{"version":3,"mappings":"AAAA"}'.repeat(50),
  'node_modules/dep/index.js.map': 'not ours',
};

test('reads files and lists maps out of an asar without Electron', t => {
  const archive = path.join(temporaryDirectory(t), 'app.asar');
  writeFileSync(archive, buildAsar(appFiles));
  assert.equal(readAsar(archive, '.vite/build/main.js').toString(), 'main');
  assert.equal(readAsar(archive, '.vite/build/missing.js'), null);
  assert.deepEqual(listAsar(archive, inner => inner.endsWith('.map')).sort(),
    ['.vite/build/main.js.map', '.vite/renderer/main_window/assets/index-ABC.js.map', 'node_modules/dep/index.js.map']);
});

test('a zip round-trips compressed entries and is a valid archive to other tools', t => {
  const directory = temporaryDirectory(t);
  const big = Buffer.from('mapping,'.repeat(5000));
  const archive = createZip([{ name: 'a/one.map', data: big }, { name: 'two.json', data: Buffer.from('{"é":1}') }]);
  assert.ok(archive.length < big.length / 4, 'maps compress');
  const zip = readZip(archive);
  assert.deepEqual(zip.names, ['a/one.map', 'two.json']);
  assert.deepEqual(zip.read('a/one.map'), big);
  assert.equal(zip.read('two.json').toString(), '{"é":1}');
  assert.equal(zip.read('missing'), null);
  const file = path.join(directory, 'check.zip');
  writeFileSync(file, archive);
  const check = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
  if (check.error?.code !== 'ENOENT') assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('the source map zip holds only the shipped .vite maps and says which build they belong to', t => {
  const archive = path.join(temporaryDirectory(t), 'app.asar');
  writeFileSync(archive, buildAsar(appFiles));
  const zip = readZip(sourcemapZip({ asarPath: archive, version: '0.50.7', target: 'linux-x64' }));
  assert.deepEqual(zip.names, ['sourcemaps.json', 'build/main.js.map', 'renderer/main_window/assets/index-ABC.js.map']);
  assert.deepEqual(JSON.parse(zip.read('sourcemaps.json')), { version: '0.50.7', target: 'linux-x64', maps: [
    { name: 'build/main.js.map', bytes: Buffer.byteLength(appFiles['.vite/build/main.js.map']) },
    { name: 'renderer/main_window/assets/index-ABC.js.map', bytes: Buffer.byteLength(appFiles['.vite/renderer/main_window/assets/index-ABC.js.map']) }] });
  assert.throws(() => sourcemapZip({ asarPath: writeAsar(t, { 'package.json': '{}' }), version: '1', target: 'x' }), /No source maps found/);
});

function writeAsar(t, files) {
  const archive = path.join(temporaryDirectory(t), 'app.asar');
  writeFileSync(archive, buildAsar(files));
  return archive;
}

test('finds the packaged asar under Forge output on every platform layout but not in make/', t => {
  const out = temporaryDirectory(t);
  for (const layout of ['Korus-darwin-arm64/Korus.app/Contents/Resources', 'korus-linux-x64/resources']) {
    mkdirSync(path.join(out, layout), { recursive: true });
    writeFileSync(path.join(out, layout, 'app.asar'), 'x');
  }
  mkdirSync(path.join(out, 'make/zip'), { recursive: true });
  writeFileSync(path.join(out, 'make/zip/app.asar'), 'installer payload');
  assert.match(findPackagedAsar(out), /Korus-darwin-arm64\/Korus\.app\/Contents\/Resources\/app\.asar$/);
  assert.equal(findPackagedAsar(temporaryDirectory(t)), null);
});
