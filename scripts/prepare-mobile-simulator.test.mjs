import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareMobileSimulator } from './prepare-mobile-simulator.mjs';

test('stages the verified distribution, runtime resources and licenses and rejects corrupt cached archives', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-prepare-'));
  try {
    const source = path.join(root, 'fixture');
    fs.mkdirSync(path.join(source, 'Resources/Swift'), { recursive: true });
    fs.writeFileSync(path.join(source, 'idb_companion'), 'native companion');
    fs.writeFileSync(path.join(source, 'Resources/SimulatorFrameworkBridge-iOS'), 'simulator bridge');
    const cache = path.join(root, 'client/electron/.mobile-simulator-artifacts/1.2.3');
    fs.mkdirSync(cache, { recursive: true });
    const archive = path.join(cache, 'companion.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', source, '.']);
    fs.writeFileSync(path.join(root, 'mobile-simulator-release.json'), JSON.stringify({ version: '1.2.3', platform: 'darwin', arch: 'arm64', sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }));
    const resources = path.join(root, 'client/electron/resources/mobile-simulator');
    fs.mkdirSync(resources, { recursive: true });
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.txt', 'idb.proto']) fs.writeFileSync(path.join(resources, name), name);
    const output = await prepareMobileSimulator({ root, platform: 'darwin', arch: 'arm64' });
    assert.equal(fs.readFileSync(path.join(output, 'Resources/SimulatorFrameworkBridge-iOS'), 'utf8'), 'simulator bridge');
    assert.equal(fs.readFileSync(path.join(output, 'THIRD_PARTY_NOTICES.txt'), 'utf8'), 'THIRD_PARTY_NOTICES.txt');
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'release.json'), 'utf8')).version, '1.2.3');
    fs.writeFileSync(archive, 'corrupt archive');
    await assert.rejects(prepareMobileSimulator({ root, platform: 'darwin', arch: 'arm64' }), /checksum mismatch/);
    assert.equal(fs.readFileSync(path.join(output, 'idb_companion'), 'utf8'), 'native companion');
    assert.equal(await prepareMobileSimulator({ root, platform: 'darwin', arch: 'x64' }), null);
    assert.equal(await prepareMobileSimulator({ root, platform: 'linux', arch: 'x64' }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects a bad download before caching or preparing it', async () => {
  const { createServer } = await import('node:http');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-download-'));
  const server = createServer((_req, res) => res.end('wrong release bytes'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    fs.writeFileSync(path.join(root, 'mobile-simulator-release.json'), JSON.stringify({ version: '1.2.3', platform: 'darwin', arch: 'arm64', sha256: '0'.repeat(64), url: `http://127.0.0.1:${server.address().port}/companion.tar.gz` }));
    await assert.rejects(prepareMobileSimulator({ root, platform: 'darwin', arch: 'arm64' }), /checksum mismatch/);
    assert.equal(fs.existsSync(path.join(root, 'client/electron/.mobile-simulator-artifacts/1.2.3/companion.tar.gz')), false);
    assert.equal(fs.existsSync(path.join(root, 'client/electron/.mobile-simulator/mobile-simulator')), false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});
