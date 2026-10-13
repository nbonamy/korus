import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { relayEndpoint, relayHostIds } from './dev-relay.mjs';

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
