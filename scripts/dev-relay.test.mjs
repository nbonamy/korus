import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { relayEndpoint, relayHostIds, relayPushConfig } from './dev-relay.mjs';

const peerId = '12D3KooWFvcCybZCDxxiUYY247TDpaSanCyB3PBm5Ck8VZr6ujor';

test('the development relay takes its local address from .env or the environment', () => {
  const dotenv = `OTHER=secret\nAPP_COMPANION_RELAY_URL=ws://localhost:47800\nAPP_COMPANION_RELAY_PEER_ID=${peerId}\n`;
  assert.deepEqual(relayEndpoint({}, dotenv), { origin: 'ws://localhost:47800', port: 47800, peerId });
  assert.equal(relayEndpoint({ APP_COMPANION_RELAY_URL: 'ws://127.0.0.1:50000' }, dotenv).port, 50000);
  assert.equal(relayEndpoint({}, 'APP_COMPANION_RELAY_URL=ws://localhost:47800\n').peerId, '');
});

test('the development relay refuses addresses it cannot serve', () => {
  for (const source of ['', 'APP_COMPANION_RELAY_URL=ws://relay.example:47800\n', 'APP_COMPANION_RELAY_URL=wss://localhost:47800\n', 'APP_COMPANION_RELAY_URL=ws://localhost\n']) {
    assert.throws(() => relayEndpoint({}, source), /APP_COMPANION_RELAY_URL/);
  }
  assert.throws(() => relayEndpoint({}, 'APP_COMPANION_RELAY_URL=ws://localhost:47800\nAPP_COMPANION_RELAY_PEER_ID=nope\n'), /identity/);
});

test('the relay admits the local daemon laptop, or an explicit list', async () => {
  const key = await generateKeyPair('Ed25519');
  const state = JSON.stringify({ identity: Buffer.from(privateKeyToProtobuf(key)).toString('base64') });
  assert.deepEqual(await relayHostIds({}, state), [peerIdFromPrivateKey(key).toString()]);
  assert.deepEqual(await relayHostIds({ APP_COMPANION_RELAY_HOST_IDS: 'a, b' }, ''), ['a', 'b']);
  await assert.rejects(relayHostIds({}, ''), /laptop identity/);
});

test('push configuration selects the product topic and one environment without embedding signing material', () => {
  const product = { appId: 'com.example.app' };
  assert.equal(relayPushConfig({}, '', product), undefined);
  const dotenv = 'APP_COMPANION_APNS_KEY_ID=KEY1234567\nAPP_COMPANION_APNS_TEAM_ID=TEAM123456\nAPP_COMPANION_APNS_KEY_FILE=/private/key.p8\n';
  assert.deepEqual(relayPushConfig({}, dotenv, product), { teamId: 'TEAM123456', topic: product.appId, development: { keyId: 'KEY1234567', privateKeyFile: '/private/key.p8' } });
  assert.ok(relayPushConfig({ APP_COMPANION_APNS_ENVIRONMENT: 'production' }, dotenv, product).production);
  assert.throws(() => relayPushConfig({}, 'APP_COMPANION_APNS_KEY_ID=bad', product), /APP_COMPANION_APNS/);
});
