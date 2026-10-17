import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedConfig } from '../mobile/scripts/ios.mjs';

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
