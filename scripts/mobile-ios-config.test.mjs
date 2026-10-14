import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedConfig } from '../mobile/scripts/ios.mjs';

test('the native app uses the product bundle identity shared with its APNs topic', () => {
  const config = generatedConfig({ appId: 'com.example.app', name: 'Example' }, {}, 'APP_COMPANION_RELAY_URL=wss://relay.example\nAPP_COMPANION_RELAY_PEER_ID=peer\n');
  assert.match(config, /^COMPANION_BUNDLE_ID = com\.example\.app$/m);
  assert.match(config, /^COMPANION_RELAY_URL = wss:\/\$\(\)\/relay\.example$/m);
});

test('new installs use the bundled public relay and explicit deployment overrides remain paired', () => {
  const product = { appId: 'com.example.app', name: 'Example', companionRelay: { origin: 'wss://relay.example', peerId: 'pinned-peer' } };
  const config = generatedConfig(product, {}, '');
  assert.match(config, /COMPANION_RELAY_URL = wss:\/\$\(\)\/relay\.example/);
  assert.match(config, /COMPANION_RELAY_PEER_ID = pinned-peer/);
  assert.throws(() => generatedConfig(product, { APP_COMPANION_RELAY_URL: 'wss://other.example' }, ''), /both/);
});
