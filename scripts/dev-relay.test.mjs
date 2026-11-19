import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { generateKeyPair, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { relayHostIds } from './dev-relay.mjs';

test('the development relay admits the local daemon identity from companions.json', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dev-relay-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const key = await generateKeyPair('Ed25519');
  await writeFile(path.join(home, 'companions.json'), JSON.stringify({
    identity: Buffer.from(privateKeyToProtobuf(key)).toString('base64'),
  }));

  assert.deepEqual(await relayHostIds({}, home), [peerIdFromPrivateKey(key).toString()]);
});
