import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { nodeRuntimeTarget, prepareNodeRuntime } from './node-runtime.mjs';

test('every supported platform/arch has a pinned checksum', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const arch of ['x64', 'arm64']) {
      assert.match(nodeRuntimeTarget(platform, arch).sha256, /^[a-f0-9]{64}$/, `${platform}/${arch}`);
    }
  }
});
test('rejects unsupported targets before downloading anything', () => {
  assert.throws(() => nodeRuntimeTarget('linux', 'ia32'), /No pinned Node runtime/);
});

test('rejects tampered downloads before extracting or installing them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'node-runtime-test-'));
  try {
    let extracted = false;
    await assert.rejects(prepareNodeRuntime({ platform: 'linux', arch: 'x64', outputDir: path.join(root, 'out'), cacheDir: path.join(root, 'cache') }, {
      fetch: async () => new Response('tampered'),
      extract: () => { extracted = true; },
    }), /checksum mismatch/);
    assert.equal(extracted, false);
    await assert.rejects(readFile(path.join(root, 'out/node')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stages a Windows runtime ZIP without shell or archive tools on PATH', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'node-runtime-zip-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = 'node-v22.0.0-win-x64';
  const fixture = path.join(root, directory);
  await mkdir(fixture);
  await writeFile(path.join(fixture, 'node.exe'), 'fixture executable');
  await writeFile(path.join(fixture, 'LICENSE'), 'fixture notices');
  await writeFile(path.join(fixture, 'npm.cmd'), 'not shipped');
  const archivePath = path.join(root, 'fixture.zip');
  if (process.platform === 'win32') {
    execFileSync('tar.exe', ['-caf', archivePath, directory], { cwd: root });
  } else {
    execFileSync('zip', ['-qr', archivePath, directory], { cwd: root });
  }
  const archive = await readFile(archivePath);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const outputDir = path.join(root, 'out');
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = root;
    const executable = await prepareNodeRuntime({
      platform: 'win32', arch: 'x64', outputDir, cacheDir: path.join(root, 'cache'),
      config: { version: '22.0.0', checksums: { 'win32-x64': sha256 } },
    }, { fetch: async () => new Response(archive) });
    assert.equal(await readFile(executable, 'utf8'), 'fixture executable');
    assert.equal(await readFile(path.join(outputDir, 'LICENSE'), 'utf8'), 'fixture notices');
    assert.deepEqual((await readdir(outputDir)).sort(), ['LICENSE', 'node.exe', 'release.json']);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test('extracts only the runtime and notices, verifies cached bytes, and replaces a corrupt cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'node-runtime-test-'));
  try {
    const directory = 'node-v22.0.0-linux-x64';
    await mkdir(path.join(root, directory, 'bin'), { recursive: true });
    await writeFile(path.join(root, directory, 'bin/node'), 'fixture executable');
    await writeFile(path.join(root, directory, 'bin/npm'), 'not shipped');
    await writeFile(path.join(root, directory, 'LICENSE'), 'fixture notices');
    const archivePath = path.join(root, 'fixture.tar.gz');
    execFileSync('tar', ['-czf', archivePath, '-C', root, directory]);
    const archive = await readFile(archivePath);
    const config = { version: '22.0.0', checksums: { 'linux-x64': createHash('sha256').update(archive).digest('hex') } };
    const options = { platform: 'linux', arch: 'x64', outputDir: path.join(root, 'out'), cacheDir: path.join(root, 'cache'), config };
    let downloads = 0;
    const dependencies = { fetch: async () => { downloads++; return new Response(archive); } };
    const executable = await prepareNodeRuntime(options, dependencies);
    assert.equal(await readFile(executable, 'utf8'), 'fixture executable');
    assert.equal(await readFile(path.join(options.outputDir, 'LICENSE'), 'utf8'), 'fixture notices');
    await assert.rejects(readFile(path.join(options.outputDir, 'npm')), { code: 'ENOENT' });
    await prepareNodeRuntime(options, dependencies);
    assert.equal(downloads, 1);
    await writeFile(path.join(options.cacheDir, `${directory}.tar.gz`), 'corrupt cache');
    await prepareNodeRuntime(options, dependencies);
    assert.equal(downloads, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
