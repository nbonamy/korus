import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createLibp2p } from 'libp2p';
import { noise as nodeNoise } from '@chainsafe/libp2p-noise';
import { webSockets } from '@libp2p/websockets';
import { yamux } from '@chainsafe/libp2p-yamux';
import { generateKeyPair as nodeKey, privateKeyToProtobuf as nodeSerialize } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { noise } from '../apple-crypto/noise';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf, publicKeyFromProtobuf, publicKeyToProtobuf, publicKeyFromMultihash } from '../apple-crypto/keys';
import { cryptoFixture } from './apple-crypto-fixture';
import { decode, encode } from '../apple-crypto/bridge';
import { XXHandshakeState } from '../../../node_modules/@chainsafe/libp2p-noise/dist/src/protocol.js';
import { wrapCrypto } from '../../../node_modules/@chainsafe/libp2p-noise/dist/src/crypto.js';
import { pureJsCrypto } from '../../../node_modules/@chainsafe/libp2p-noise/dist/src/crypto/js.js';
import { Uint8ArrayList } from 'uint8arraylist';
let native: Awaited<ReturnType<typeof cryptoFixture>>;
beforeAll(async () => {
  native = await cryptoFixture();
  vi.stubGlobal('window', { webkit: { messageHandlers: { native: { postMessage: ({ command }: any) => native.call(command) } } } });
}, 30000);
afterAll(async () => { await native?.close(); vi.unstubAllGlobals(); });

describe('Apple-backed encrypted transport', () => {
  it('preserves a saved Ed25519 identity and verifies signatures in both implementations', async () => {
    const original = await nodeKey('Ed25519');
    const migrated = privateKeyFromProtobuf(nodeSerialize(original));
    expect(privateKeyToProtobuf(migrated)).toEqual(nodeSerialize(original));
    expect(peerIdFromPrivateKey(migrated).toString()).toBe(peerIdFromPrivateKey(original).toString());
    const data = new TextEncoder().encode('pinned device identity');
    expect(await original.publicKey.verify(data, await migrated.sign(data))).toBe(true);
    expect(await migrated.publicKey.verify(data, await original.sign(data))).toBe(true);
    expect(await migrated.publicKey.verify(new Uint8Array([0]), await original.sign(data))).toBe(false);
    expect(publicKeyFromProtobuf(publicKeyToProtobuf(migrated.publicKey)).equals(original.publicKey)).toBe(true);
    expect(publicKeyFromMultihash(migrated.publicKey.toMultihash()).toCID().equals(original.publicKey.toCID())).toBe(true);
    expect(migrated.equals(original)).toBe(true);
    const fresh = await generateKeyPair('Ed25519');
    expect(fresh.publicKey.toString()).toBe(peerIdFromPrivateKey(fresh).toString());
    expect(await fresh.publicKey.verify(data, await fresh.sign(data))).toBe(true);
    expect(fresh.equals(migrated)).toBe(false);
    await expect(generateKeyPair('RSA')).rejects.toThrow();
    expect(() => privateKeyFromProtobuf(new Uint8Array())).toThrow();
    expect(() => publicKeyFromProtobuf(new Uint8Array())).toThrow();
    const corrupt = nodeSerialize(original).slice(); corrupt[corrupt.length - 1]! ^= 1;
    await expect(privateKeyFromProtobuf(corrupt).sign(data)).rejects.toThrow();
    const signal = AbortSignal.abort();
    await expect(migrated.sign(data, { signal })).rejects.toThrow();
    await expect(migrated.publicKey.verify(data, new Uint8Array(), { signal })).rejects.toThrow();
  });

  it('rejects tampering, replay and record operations before a complete handshake', async () => {
    const begin = async () => {
      const first = await native.call({ op: 'create', initiator: true });
      const crypto = wrapCrypto(pureJsCrypto);
      const responder = new XXHandshakeState({ crypto, initiator: false, protocolName: 'Noise_XX_25519_ChaChaPoly_SHA256', prologue: new Uint8Array(), s: crypto.generateKeypair() });
      responder.readMessageA(new Uint8ArrayList(decode((await native.call({ op: 'writeA', id: first.id })).data)));
      const response = responder.writeMessageB(new Uint8Array([7]));
      expect(decode((await native.call({ op: 'readB', id: first.id, data: encode(response.subarray()) })).data)).toEqual(new Uint8Array([7]));
      responder.readMessageC(new Uint8ArrayList(decode((await native.call({ op: 'writeC', id: first.id, data: '' })).data)));
      await native.call({ op: 'split', id: first.id });
      return { id: first.id, ciphers: responder.ss.split() };
    };
    const early = await native.call({ op: 'create', initiator: true });
    await expect(native.call({ op: 'encrypt', id: early.id, records: ['AA=='] })).rejects.toThrow();
    const session = await begin();
    const encrypted = session.ciphers[1].encryptWithAd(new Uint8Array(), new Uint8Array([1, 2, 3])).subarray();
    expect((await native.call({ op: 'decrypt', id: session.id, records: [encode(encrypted)] })).records).toEqual(['AQID']);
    await expect(native.call({ op: 'decrypt', id: session.id, records: [encode(encrypted)] })).rejects.toThrow();
    const tamper = await begin();
    const record = tamper.ciphers[1].encryptWithAd(new Uint8Array(), new Uint8Array([1])).subarray(); record[0]! ^= 1;
    await expect(native.call({ op: 'decrypt', id: tamper.id, records: [encode(record)] })).rejects.toThrow();
    await expect(native.call({ op: 'encrypt', id: tamper.id, records: ['AA=='] })).rejects.toThrow();
  });

  it('rejects a substituted peer identity and fails closed without the native service', async () => {
    const apple = await createLibp2p({ privateKey: await generateKeyPair('Ed25519'), transports: [webSockets()], connectionEncrypters: [noise()], streamMuxers: [yamux()] });
    const node = await createLibp2p({ addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] }, transports: [webSockets()], connectionEncrypters: [nodeNoise()], streamMuxers: [yamux()] });
    try {
      const impostor = peerIdFromPrivateKey(await nodeKey('Ed25519'));
      const address = node.getMultiaddrs()[0]!.decapsulateCode(421).encapsulate(`/p2p/${impostor}`);
      await expect(apple.dial(address, { signal: AbortSignal.timeout(5000) })).rejects.toThrow(/identity|peer|key/i);
      expect(apple.getConnections()).toHaveLength(0);
      const saved = await generateKeyPair('Ed25519');
      vi.stubGlobal('window', {});
      await expect(saved.sign(new Uint8Array([1]))).rejects.toThrow('native');
    } finally {
      vi.stubGlobal('window', { webkit: { messageHandlers: { native: { postMessage: ({ command }: any) => native.call(command) } } } });
      await Promise.all([apple.stop(), node.stop()]);
    }
  });

  it.each([true, false])('exchanges ordered multi-record traffic with ordinary libp2p Noise (Apple initiates: %s)', async appleInitiates => {
    const apple = await createLibp2p({ privateKey: await generateKeyPair('Ed25519'), addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] }, transports: [webSockets()], connectionEncrypters: [noise()], streamMuxers: [yamux()] });
    const node = await createLibp2p({ transports: [webSockets()], addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] }, connectionEncrypters: [nodeNoise()], streamMuxers: [yamux()] });
    const [client, server] = appleInitiates ? [apple, node] : [node, apple];
    try {
      await server.handle('/crypto-test/1', async stream => { for await (const bytes of stream) { if (!stream.send(bytes)) await stream.onDrain(); } await stream.close(); });
      const stream = await client.dialProtocol(server.getMultiaddrs()[0]!, '/crypto-test/1', { signal: AbortSignal.timeout(10000) });
      const payload = new Uint8Array(1024 * 1024 + 123); for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
      const chunks: Uint8Array[] = [];
      const reading = (async () => { for await (const part of stream) chunks.push(part.subarray()); })();
      stream.send(payload); await stream.close({ signal: AbortSignal.timeout(10000) }); await reading;
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(payload));
    } finally { await Promise.all([apple.stop(), node.stop()]); }
  }, 20000);
});
