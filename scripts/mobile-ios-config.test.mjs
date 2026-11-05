import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generatedConfig, runXcode } from '../mobile/scripts/ios.mjs';

test('the native app receives product identity and the privacy link through build settings', () => {
  const config = generatedConfig({ appId: 'com.example.app', name: 'Example', companionName: 'Example Mobile', websiteUrl: 'https://example.com' }, {}, 'APP_COMPANION_RELAY_URL=wss://relay.example\nAPP_COMPANION_RELAY_PEER_ID=peer\n');
  assert.match(config, /^COMPANION_BUNDLE_ID = com\.example\.app$/m);
  assert.match(config, /^COMPANION_DISPLAY_NAME = Example$/m);
  assert.match(config, /^COMPANION_PRODUCT_NAME = Example Mobile$/m);
  assert.match(config, /^COMPANION_PRIVACY_POLICY_URL = https:\/\$\(\)\/example\.com\/privacy\/$/m);
  assert.match(config, /^COMPANION_RELAY_URL = wss:\/\$\(\)\/relay\.example$/m);
});

test('new installs use the bundled public relay and explicit deployment overrides remain paired', () => {
  const product = { appId: 'com.example.app', name: 'Example', websiteUrl: 'https://example.com', companionRelay: { origin: 'wss://relay.example', peerId: 'pinned-peer' } };
  const config = generatedConfig(product, {}, '');
  assert.match(config, /COMPANION_RELAY_URL = wss:\/\$\(\)\/relay\.example/);
  assert.match(config, /COMPANION_RELAY_PEER_ID = pinned-peer/);
  assert.throws(() => generatedConfig(product, { APP_COMPANION_RELAY_URL: 'wss://other.example' }, ''), /both/);
});

// Homebrew tools ahead of the system PATH must not be selected by Xcode child processes.
test('Xcode export uses system tools even with conflicting user executables', { skip: process.platform === 'win32' }, () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'ios-export-path-'));
  const tool = process.platform === 'darwin' ? 'rsync' : 'printf';
  const probeArgs = tool === 'rsync' ? ['--version'] : ['system-tools'];
  const expected = execFileSync(`/usr/bin/${tool}`, probeArgs, { encoding: 'utf8' });
  const shadow = path.join(folder, tool);
  writeFileSync(shadow, '#!/bin/sh\nexit 91\n'); chmodSync(shadow, 0o755);
  const args = ['-exportArchive', '-archivePath', '/tmp/Candidate.xcarchive'];
  const env = { ...process.env, PATH: `${folder}:${process.env.PATH}`, EXPORT_SENTINEL: 'preserved' };
  let calls = 0;
  try {
    runXcode(args, { env, execute(command, actualArgs, options) {
      calls++;
      assert.equal(command, '/usr/bin/xcodebuild');
      assert.deepEqual(actualArgs, args);
      assert.equal(options.env.EXPORT_SENTINEL, 'preserved');
      assert.equal(execFileSync(tool, probeArgs, { env: options.env, encoding: 'utf8' }), expected);
    } });
    assert.equal(calls, 1);
    assert.equal(env.PATH.split(':')[0], folder, 'the caller environment stays intact');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
