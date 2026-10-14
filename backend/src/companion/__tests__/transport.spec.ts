import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { multiaddr } from '@multiformats/multiaddr';
import { randomUUID } from 'node:crypto';
import { companionProtocol, companionResponseLimit, encodeCompanionFrame, CompanionFrameDecoder } from '@workspace/core/companion-protocol';
import { companionRendezvousProtocol } from '@workspace/core/companion-relay';
import { createPairingExchange, normalizePairingCode, pairingChannel, pairingConfirmationsMatch } from '@workspace/core/companion-pairing';
import { createCompanionRelay } from '../relay';
import { CompanionOutboundConnector } from '../connector';
import { CompanionGateway } from '../gateway';
import type { Libp2p } from '@libp2p/interface';
const stops: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.reverse()) await stop(); stops.length = 0; });
describe('encrypted companion circuit', () => {
  it('transfers a history response larger than four MiB over the encrypted circuit', async () => {
    const hostKey = await generateKeyPair('Ed25519'); const hostId = peerIdFromPrivateKey(hostKey).toString();
    const relay = await createCompanionRelay({ key: await generateKeyPair('Ed25519'), listen: '/ip4/127.0.0.1/tcp/0/ws', hostIds: [hostId] });
    stops.push(() => relay.stop());
    const address = relay.getMultiaddrs()[0]!.toString();
    const port = address.match(/\/tcp\/(\d+)/)![1];
    const phone = await createLibp2p({ transports: [webSockets(), circuitRelayTransport()], connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() } });
    stops.push(() => phone.stop());
    const large = { frame: { payload: { snapshot: { messages: [{ id: 'earlier', text: 'history '.repeat(700_000) }] } } }, hasOlder: true };
    const gateway = { grants: [{ peerId: phone.peerId.toString() }], pairChannels: () => [], request: async () => large } as unknown as CompanionGateway;
    const connector = new CompanionOutboundConnector(hostKey, gateway); stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    expect(await rpc(phone, `${address}/p2p-circuit/p2p/${hostId}`, 'conversation.loadOlder', {})).toMatchObject({ result: large });
  }, 15_000);
  it('establishes a real Noise circuit, requires approval, pins peer identities and revokes reconnects', async () => {
    const hostKey = await generateKeyPair('Ed25519'); const hostId = peerIdFromPrivateKey(hostKey).toString();
    const relayKey = await generateKeyPair('Ed25519');
    const relay = await createCompanionRelay({ key: relayKey, listen: '/ip4/127.0.0.1/tcp/0/ws', hostIds: [hostId] });
    stops.push(() => relay.stop());
    const address = relay.getMultiaddrs()[0]!.toString();
    const port = address.match(/\/tcp\/(\d+)/)![1];
    const connectorRef: { current?: CompanionOutboundConnector } = {};
    const gateway = new CompanionGateway(hostId, { grants: [], commands: {} }, {
      workspace: async () => ({ teams: [{ id: 'team', name: 'Actual gateway team', agentIds: [] }], agents: [] }),
      loadOlderHistory: async () => ({ hasOlder: false }),
      conversation: async () => { throw new Error('No agent'); }, submit: async () => {}, models: async () => [], selectModel: async () => {}, startReview: async () => {}, interrupt: async () => {}, setApprovalPreset: async () => {}, setPermissionMode: async () => {}, save: async () => {},
      revoked: (peer) => connectorRef.current?.revoke(peer),
    });
    const connector = new CompanionOutboundConnector(hostKey, gateway); connectorRef.current = connector;
    stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    expect(connector.connected).toBe(true);
    const phone = await createLibp2p({ transports: [webSockets(), circuitRelayTransport()], connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() } });
    stops.push(() => phone.stop());
    const invite = gateway.invite(); await connector.advertise(invite.expiresAt);
    const circuit = `${address}/p2p-circuit/p2p/${hostId}`;
    const result = await rpc(phone, circuit, 'snapshot.get', {});
    expect(result).toHaveProperty('error');
    // The phone knows only the relay and the code: it finds the laptop through the rendezvous channel.
    const code = normalizePairingCode(invite.code)!;
    expect(await resolveChannel(phone, address, 'ZZZZ')).toBeNull();
    expect(await resolveChannel(phone, address, pairingChannel(code))).toBe(hostId);
    const exchange = createPairingExchange({ role: 'initiator', code, initiatorId: phone.peerId.toString(), responderId: hostId });
    const started = await rpc(phone, circuit, 'pair.start', { channel: pairingChannel(code), message: Buffer.from(exchange.message).toString('base64'), name: 'Phone' }) as { result: { message: string; confirm: string } };
    const confirmations = exchange.finish(new Uint8Array(Buffer.from(started.result.message, 'base64')));
    expect(pairingConfirmationsMatch(confirmations.responderConfirm, new Uint8Array(Buffer.from(started.result.confirm, 'base64')))).toBe(true);
    const pairing = await rpc(phone, circuit, 'pair.confirm', { channel: pairingChannel(code), confirm: Buffer.from(confirmations.initiatorConfirm).toString('base64') }) as { result: { pendingId: string } };
    expect(pairing.result.pendingId).toBeTruthy();
    expect(gateway.pendingRequests[0]?.peerId).toBe(phone.peerId.toString());
    await gateway.decide(pairing.result.pendingId, true); await connector.advertise();
    expect(await rpc(phone, circuit, 'snapshot.get', {})).toMatchObject({ result: { teams: [{ name: 'Actual gateway team' }] } });
    // Restarting the operator relay retains its pinned identity; the laptop makes
    // a new outbound reservation and advertises its persisted device grant.
    await relay.stop();
    await expect.poll(() => connector.connected, { timeout: 3000 }).toBe(false);
    const restarted = await createCompanionRelay({ key: relayKey, listen: `/ip4/127.0.0.1/tcp/${port}/ws`, hostIds: [hostId] });
    stops.push(() => restarted.stop());
    await expect.poll(() => connector.connected, { timeout: 12_000 }).toBe(true);
    expect(await rpc(phone, circuit, 'snapshot.get', {})).toMatchObject({ result: { teams: [{ name: 'Actual gateway team' }] } });
    const wrong = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
    await expect(rpc(phone, `${address}/p2p-circuit/p2p/${wrong}`, 'snapshot.get', {})).rejects.toThrow();
    await gateway.revoke(phone.peerId.toString());
    const revoked = await rpc(phone, circuit, 'snapshot.get', {});
    expect(revoked).toHaveProperty('error');
  }, 25_000);
});
async function rpc(phone: Libp2p, address: string, method: string, args: unknown) {
  const stream = await phone.dialProtocol(multiaddr(address), companionProtocol, { signal: AbortSignal.timeout(5000), runOnLimitedConnection: true });
  stream.maxReadBufferLength = companionResponseLimit + 4;
  const decoder = new CompanionFrameDecoder(companionResponseLimit);
  try {
    stream.send(encodeCompanionFrame({ v: 1, id: randomUUID(), method, args })); await stream.close();
    for await (const chunk of stream) {
      const frames = decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
      if (frames.length) return frames[0];
    }
    throw new Error('No response');
  } finally { stream.abort(new Error('Complete')); }
}
async function resolveChannel(phone: Libp2p, relayAddress: string, channel: string): Promise<string | null> {
  try {
    const stream = await phone.dialProtocol(multiaddr(relayAddress), companionRendezvousProtocol, { signal: AbortSignal.timeout(5000) });
    const decoder = new CompanionFrameDecoder();
    try {
      stream.send(encodeCompanionFrame({ channel })); await stream.close();
      for await (const chunk of stream) {
        const frames = decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
        if (frames.length) return (frames[0] as { hostId: string }).hostId;
      }
      return null;
    } finally { stream.abort(new Error('Complete')); }
  } catch { return null; }
}
