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
import { AbstractMessageStream } from '@libp2p/utils';
import { AppleEncryptedStream } from '../apple-crypto/stream';
import { uint16BEEncode } from '../../../node_modules/@chainsafe/libp2p-noise/dist/src/encoder.js';
let native: Awaited<ReturnType<typeof cryptoFixture>>;
beforeAll(async () => {
  native = await cryptoFixture();
  vi.stubGlobal('window', { webkit: { messageHandlers: { native: { postMessage: ({ command }: any) => native.call(command) } } } });
}, 30000);
afterAll(async () => { await native?.close(); vi.unstubAllGlobals(); });

async function encryptedStreamFixture() {
  const first = await native.call({ op: 'create', initiator: true });
  const crypto = wrapCrypto(pureJsCrypto);
  const responder = new XXHandshakeState({ crypto, initiator: false, protocolName: 'Noise_XX_25519_ChaChaPoly_SHA256', prologue: new Uint8Array(), s: crypto.generateKeypair() });
  responder.readMessageA(new Uint8ArrayList(decode((await native.call({ op: 'writeA', id: first.id })).data)));
  await native.call({ op: 'readB', id: first.id, data: encode(responder.writeMessageB(new Uint8Array()).subarray()) });
  responder.readMessageC(new Uint8ArrayList(decode((await native.call({ op: 'writeC', id: first.id, data: '' })).data)));
  await native.call({ op: 'split', id: first.id });
  const cipher = responder.ss.split()[1];
  const log = Object.assign(vi.fn(), { enabled: false, error: vi.fn(), trace: vi.fn(), newScope: () => log });
  class Transport extends AbstractMessageStream {
    sendData(data: Parameters<AbstractMessageStream['sendData']>[0]) { return { sentBytes: data.byteLength, canSendMore: true }; }
    remotePaused = false;
    sendPause() { this.remotePaused = true; }
    onResume?: () => void;
    sendResume() { this.remotePaused = false; this.onResume?.(); }
    sendReset() {}
    async close() { this.onTransportClosed(); }
  }
  const transport = new Transport({ log, direction: 'inbound', maxReadBufferLength: 4 * 1024 * 1024 });
  const stream = new AppleEncryptedStream(transport, first.id);
  const encrypt = (payload: Uint8Array) => {
    const wire = new Uint8ArrayList();
    for (let offset = 0; offset < payload.length; offset += 65519) {
      const record = cipher.encryptWithAd(new Uint8Array(), payload.subarray(offset, offset + 65519));
      wire.append(uint16BEEncode(record.byteLength), record);
    }
    return wire.subarray();
  };
  return { stream, transport, encrypt };
}

describe('Apple-backed encrypted transport', () => {
  it.each(['transport bytes', 'consumer resume'] as const)('does not lose a final wake-up from %s while a decrypt cycle unwinds', async wakeup => {
    const { stream, transport, encrypt } = await encryptedStreamFixture();
    const first = new Uint8Array([1, 2, 3]);
    const last = new Uint8Array([4, 5, 6]);
    const firstWire = encrypt(first), lastWire = encrypt(last);
    const chunks: Uint8Array[] = [];
    stream.addEventListener('message', event => {
      chunks.push(event.data.subarray());
      if (wakeup === 'consumer resume' && chunks.length === 1) {
        stream.pause();
        transport.onData(lastWire);
        queueMicrotask(() => stream.resume());
      }
    });
    if (wakeup === 'transport bytes') transport.onResume = () => {
      transport.onResume = undefined;
      queueMicrotask(() => transport.onData(lastWire));
    };
    try {
      transport.onData(firstWire);
      await vi.waitFor(() => expect(Buffer.concat(chunks)).toEqual(Buffer.concat([first, last])), { timeout: 500 });
    } finally { stream.abort(new Error('Test complete')); }
  });

  it('re-pauses a synchronous resume burst while native decryption is blocked, then recovers byte-exactly', async () => {
    const { stream, transport, encrypt } = await encryptedStreamFixture();
    const first = new Uint8Array([1]);
    const burst = new Uint8Array(1024 * 1024 - 65537).fill(7);
    const firstWire = encrypt(first), burstWire = encrypt(burst);
    const chunks: Uint8Array[] = [];
    stream.addEventListener('message', event => chunks.push(event.data.subarray()));
    const gates: (() => void)[] = [];
    let calls = 0; let completed = 0;
    const resumed = vi.fn(); transport.onResume = resumed;
    vi.stubGlobal('window', { webkit: { messageHandlers: { native: { postMessage: async ({ command }: any) => {
      if (command.op !== 'decrypt') return native.call(command);
      calls += 1;
      await new Promise<void>(resolve => gates.push(resolve));
      const result = await native.call(command); completed += 1; return result;
    } } } } });
    try {
      transport.onData(firstWire);
      await vi.waitFor(() => expect(calls).toBe(1));
      expect(transport.readStatus).toBe('paused');
      transport.onData(burstWire);
      expect(transport.readBufferLength).toBe(burstWire.byteLength);
      expect(transport.readBufferLength).toBeLessThanOrEqual(1024 * 1024);
      gates.shift()!();
      await vi.waitFor(() => expect(calls).toBe(2));
      expect(completed).toBe(1);
      expect(transport.readBufferLength).toBe(0);
      expect(transport.readStatus).toBe('paused');
      expect(transport.remotePaused).toBe(true);
      expect(resumed).toHaveBeenCalledTimes(1);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(resumed).toHaveBeenCalledTimes(1);
      expect(calls).toBe(2);
      gates.shift()!();
      await vi.waitFor(() => expect(Buffer.concat(chunks)).toEqual(Buffer.concat([first, burst])));
    } finally {
      for (const release of gates) release();
      stream.abort(new Error('Test complete'));
      vi.stubGlobal('window', { webkit: { messageHandlers: { native: { postMessage: ({ command }: any) => native.call(command) } } } });
    }
  });

  it.each([false, true])('decrypts a coalesced history burst larger than four MiB without losing record boundaries (fragmented: %s)', async fragmented => {
    const { stream, transport, encrypt } = await encryptedStreamFixture();
    const payload = new Uint8Array(4 * 1024 * 1024 + 123);
    for (let index = 0; index < payload.length; index++) payload[index] = index % 251;
    const wire = encrypt(payload);
    const chunks: Uint8Array[] = [];
    let received = 0; let failure: Error | undefined;
    stream.addEventListener('message', event => { const bytes = event.data.subarray(); chunks.push(bytes); received += bytes.length; });
    stream.addEventListener('close', event => { failure = event.error; });
    vi.stubGlobal('window', { webkit: { messageHandlers: { native: { postMessage: async ({ command }: any) => {
      if (command.op === 'decrypt') await new Promise(resolve => setTimeout(resolve, 2));
      return native.call(command);
    } } } } });
    try {
      // resume() coalesces its paused buffer into one event; network packets need not match Noise records.
      if (fragmented) { transport.onData(wire.subarray(0, 1)); transport.onData(wire.subarray(1, 1171)); transport.onData(wire.subarray(1171)); }
      else transport.onData(wire.subarray());
      await vi.waitFor(() => { expect(failure).toBeUndefined(); expect(received).toBe(payload.length); }, { timeout: 10000 });
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(payload));
    } finally {
      stream.abort(new Error('Test complete'));
      vi.stubGlobal('window', { webkit: { messageHandlers: { native: { postMessage: ({ command }: any) => native.call(command) } } } });
    }
  }, 15000);

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
