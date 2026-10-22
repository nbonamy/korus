import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { multiaddr } from '@multiformats/multiaddr';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { sdkSnapshot } from '../../codex/__tests__/sdk-surface-fixture';
import { readCompanionResponses, readFirstCompanionResponse } from '@workspace/core/companion-response';
import { companionProtocol, companionUpdatesProtocol, companionResponseLimit, encodeCompanionFrame, CompanionFrameDecoder } from '@workspace/core/companion-protocol';
import { companionPushAuthorizationMessage } from '@workspace/core/companion-notification';
import { companionRendezvousProtocol } from '@workspace/core/companion-relay';
import { normalizePairingCode } from '@workspace/core/companion-pairing';
import { createCompanionRelay } from '../relay';
import { CompanionOutboundConnector } from '../connector';
import { CompanionGateway } from '../gateway';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { CompanionWorkspace, CompanionReset } from '@workspace/core/companion-protocol';
import type { Libp2p, PrivateKey } from '@libp2p/interface';
import { logMain } from '../../log';
vi.mock('../../log', () => ({ logMain: vi.fn(), warnMain: vi.fn() }));
const stops: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.reverse()) await stop(); stops.length = 0; });
describe('encrypted companion circuit', () => {
  it('rejects oversized rendezvous headers before reading their body', async () => {
    const relay = await createCompanionRelay({ key: await generateKeyPair('Ed25519'), listen: '/ip4/127.0.0.1/tcp/0/ws' });
    stops.push(() => relay.stop());
    const phone = await createLibp2p({ transports: [webSockets()], connectionEncrypters: [noise()], streamMuxers: [yamux()] });
    stops.push(() => phone.stop());
    const stream = await phone.dialProtocol(relay.getMultiaddrs()[0]!, companionRendezvousProtocol);
    stops.push(() => { stream.abort(new Error('Test complete')); });
    const header = new Uint8Array(4); new DataView(header.buffer).setUint32(0, 16_385);
    stream.send(header);
    await expect.poll(() => stream.status, { timeout: 1000 }).not.toBe('open');
  });

  it('delivers push metadata over an authenticated host-to-relay stream and rejects revoked devices', async () => {
    const hostKey = await generateKeyPair('Ed25519'); const hostId = peerIdFromPrivateKey(hostKey).toString();
    const phoneKey = await generateKeyPair('Ed25519');
    const phone = peerIdFromPrivateKey(phoneKey).toString();
    const send = vi.fn(async () => 'sent' as const);
    const relay = await createCompanionRelay({ key: await generateKeyPair('Ed25519'), listen: '/ip4/127.0.0.1/tcp/0/ws', push: { send } });
    stops.push(() => relay.stop());
    const port = relay.getMultiaddrs()[0]!.toString().match(/\/tcp\/(\d+)/)![1];
    const gateway = { grants: [{ peerId: phone }], pairingInvitations: () => [] } as unknown as CompanionGateway;
    const connector = new CompanionOutboundConnector(hostKey, gateway); stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    const token = { token: 'ab'.repeat(32), environment: 'development' as const };
    const expiresAt = Date.now() + 86400_000;
    const registration = { ...token, authorization: { expiresAt, signature: Buffer.from(await phoneKey.sign(
      companionPushAuthorizationMessage(relay.peerId.toString(), hostId, phone, token, expiresAt))).toString('base64') } };
    const notification = { id: 'event', kind: 'completed' as const, name: 'Builder', createdAt: Date.now(), target: { hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null } };
    expect(await connector.push(phone, registration, notification)).toBe('sent');
    expect(send).toHaveBeenCalledExactlyOnceWith(registration, notification);
    gateway.grants.splice(0);
    await connector.advertise();
    expect(await connector.push(phone, registration, notification)).toBe('unavailable');
    expect(send).toHaveBeenCalledTimes(1);
  }, 15000);

  it('transfers a history response larger than four MiB over the encrypted circuit', async () => {
    const { hostKey, hostId, relay, address, port, phone } = await relayAndPhone();
    const large = { frame: { payload: { snapshot: { messages: [{ id: 'earlier', text: 'history '.repeat(700_000) }] } } }, hasOlder: true };
    const gateway = { grants: [{ peerId: phone.peerId.toString() }], pairingInvitations: () => [], request: async () => large } as unknown as CompanionGateway;
    const connector = new CompanionOutboundConnector(hostKey, gateway); stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    expect(await rpc(phone, `${address}/p2p-circuit/p2p/${hostId}`, 'conversation.loadOlder', {})).toMatchObject({ result: large });
  }, 15_000);
  it('loads screenshot-heavy provider data beyond the legacy response limit over a negotiated circuit', async () => {
    const { hostKey, hostId, relay, address, port, phone } = await relayAndPhone();
    const image = `data:image/png;base64,${randomBytes(26 * 1024 * 1024).toString('base64')}`;
    const frame = { type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: 'agent', threadId: 'thread', seq: 1, occurredAt: 'now', payload: { revision: 1, snapshot: sdkSnapshot('thread', { messages: [{ id: 'screenshot', role: 'assistant', status: 'complete', createdAt: '2026-10-17T00:00:00Z', parts: [{ type: 'media', media: { url: image, mimeType: 'image/png' } }] }] }) } } as unknown as CompanionReset;
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeGreaterThan(companionResponseLimit);
    const workspace = { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [{ id: 'agent', teamId: 'team', backend: 'codex', backendSession: { kind: 'codex', threadId: 'thread' } }] } as CompanionWorkspace;
    const gateway = new CompanionGateway(hostId, { grants: [{ peerId: phone.peerId.toString(), name: 'Phone', createdAt: 1 }], commands: {} }, {
      onEvent: () => () => {}, workspace: async () => workspace, conversation: async () => frame,
      loadOlderHistory: async () => ({ hasOlder: false }), save: async () => {},
    } as unknown as ConstructorParameters<typeof CompanionGateway>[2]);
    const connector = new CompanionOutboundConnector(hostKey, gateway); stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    const circuit = multiaddr(`${address}/p2p-circuit/p2p/${hostId}`);
    const stream = await phone.dialProtocol(circuit, ['/workspace/companion-updates/2.0.0', companionUpdatesProtocol], { signal: AbortSignal.timeout(5000), runOnLimitedConnection: true });
    stream.maxReadBufferLength = companionResponseLimit + 4;
    const received: any[] = []; let ended = false;
    const reader = (async () => { try { for await (const value of readCompanionResponses(stream)) received.push(value); } catch { /* Peer reset is observed through ended. */ } finally { ended = true; } })();
    stops.push(async () => { stream.abort(new Error('Test complete')); await reader.catch(() => {}); });
    const request = async (method: string, args: unknown) => {
      const id = randomUUID(); stream.send(encodeCompanionFrame({ v: 1, id, method, args }));
      await expect.poll(() => ended ? 'stream-ended' : received.some(value => value.id === id), { timeout: 15_000 }).toBe(true);
    };
    await request('snapshot.get', {});
    await request('conversation.subscribe', { hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) });
    expect(received.find(value => value.update?.type === 'conversation')?.update.frame).toStrictEqual(frame);
    expect(ended).toBe(false);
    // History reads use the same codec on the one-shot protocol.
    const historyStream = await phone.dialProtocol(circuit, ['/workspace/companion/2.0.0', companionProtocol], { signal: AbortSignal.timeout(5000), runOnLimitedConnection: true });
    historyStream.maxReadBufferLength = companionResponseLimit + 4;
    const id = randomUUID();
    historyStream.send(encodeCompanionFrame({ v: 1, id, method: 'conversation.loadOlder', args: { hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) } }));
    await historyStream.close();
    const page = await readFirstCompanionResponse(historyStream);
    historyStream.abort(new Error('Test complete'));
    expect(page).toStrictEqual({ v: 1, id, result: { frame, hasOlder: false } });
  }, 30_000);
  it('pushes provider events over one authenticated duplex stream and closes it on revocation', async () => {
    const { hostKey, hostId, relay, address, port, phone } = await relayAndPhone();
    const events = new Set<(event: AppBackendEvent) => void>();
    const frame = { type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: 'agent', threadId: 'thread', seq: 1, occurredAt: 'now', payload: { revision: 1, snapshot: {} } } as CompanionReset;
    const workspace = { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [{ id: 'agent', teamId: 'team', backend: 'codex', backendSession: { kind: 'codex', threadId: 'thread' } }] } as CompanionWorkspace;
    workspace.agentRequests = { agent: [{ id: 'question', conversationId: 'thread', kind: 'question', question: { itemId: 'item', delivery: 'tool', blocking: true, questions: [] } }] };
    const responses: unknown[] = [];
    const gateway = new CompanionGateway(hostId, { grants: [{ peerId: phone.peerId.toString(), name: 'Phone', createdAt: 1 }], commands: {} }, {
      respondRequest: async (response) => { responses.push(response); workspace.agentRequests = { agent: [] }; for (const listener of events) listener({ type: 'agentRequest.resolved', agentId: 'agent', payload: { id: 'question' } } as AppBackendEvent); },
      onEvent: (listener) => { events.add(listener); return () => { events.delete(listener); }; },
      workspace: async () => workspace, conversation: async () => frame,
      loadOlderHistory: async () => ({ hasOlder: false }), submit: async () => {}, models: async () => [], skills: async () => [], selectModel: async () => {}, startReview: async () => {}, interrupt: async () => {}, restart: async () => {}, branches: async () => [], createChat: async () => 'created', createQuickChat: async () => 'created', setBackend: async () => {}, close: async () => {}, closePreview: async () => ({ isLinkedWorktree: false, branch: null, upstream: null, hasChanges: false }), setApprovalPreset: async () => {}, setPermissionMode: async () => {}, save: async () => {}, revoked: (peer) => connector.revoke(peer),
    });
    const connector = new CompanionOutboundConnector(hostKey, gateway); stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    const stream = await phone.dialProtocol(multiaddr(`${address}/p2p-circuit/p2p/${hostId}`), companionUpdatesProtocol, { signal: AbortSignal.timeout(5000), runOnLimitedConnection: true });
    const received: any[] = []; const decoder = new CompanionFrameDecoder(companionResponseLimit);
    let ended = false;
    const reader = (async () => { try { for await (const chunk of stream) received.push(...decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())); } catch {} finally { ended = true; } })();
    stops.push(async () => { stream.abort(new Error('Test complete')); await reader; });
    const request = (method: string, args: unknown) => stream.send(encodeCompanionFrame({ v: 1, id: randomUUID(), method, args }));
    request('snapshot.get', {});
    await expect.poll(() => received.some((item) => item.update?.type === 'workspace')).toBe(true);
    request('conversation.subscribe', { hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) });
    await expect.poll(() => received.some((item) => item.update?.frame?.payload.revision === 1)).toBe(true);
    const delta = { ...frame, type: 'codex.conversationEventReceived', payload: { revision: 2, event: { type: 'provider-event', payload: { text: 'Streaming' } } } } as unknown as AppBackendEvent;
    for (const listener of events) listener(delta);
    await expect.poll(() => received.some((item) => item.update?.frame?.payload.revision === 2)).toBe(true);
    expect(received.filter((item) => item.update).map((item) => item.seq)).toStrictEqual([1, 2, 3]);
    expect(received.at(-1).update.frame.payload).toStrictEqual(delta.payload);
    const reply = { target: { hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) }, id: 'question', conversationId: 'thread', outcome: { kind: 'answered', answers: { choice: { answers: ['Yes'] } } } };
    expect(await rpc(phone, `${address}/p2p-circuit/p2p/${hostId}`, 'agent.request.respond', reply)).toMatchObject({ result: {} });
    expect(responses).toStrictEqual([{ agentId: 'agent', id: 'question', outcome: reply.outcome }]);
    await expect.poll(() => received.some((item) => item.update?.workspace?.agentRequests?.agent?.length === 0)).toBe(true);
    await gateway.revoke(phone.peerId.toString());
    await expect.poll(() => ended).toBe(true);
    await expect.poll(() => events.size).toBe(0);
    expect(logMain).toHaveBeenCalledWith('companion', 'updates request', expect.objectContaining({ method: 'conversation.subscribe', requestId: expect.any(String), queuedFrames: expect.any(Number) }));
    expect(logMain).toHaveBeenCalledWith('companion', 'updates ended', expect.objectContaining({ elapsedMs: expect.any(Number), sequence: expect.any(Number) }));
    expect(() => gateway.subscribe(phone.peerId.toString(), () => {}, () => {})).toThrow('authorized');
  }, 15_000);
  it('reconnects to the relay after it restarts and routes again', async () => {
    const hostKey = await generateKeyPair('Ed25519'); const hostId = peerIdFromPrivateKey(hostKey).toString();
    const relayKey = await generateKeyPair('Ed25519');
    const port = await freePort(); const listen = `/ip4/127.0.0.1/tcp/${port}/ws`;
    let relay = await createCompanionRelay({ key: relayKey, listen, hostIds: [hostId] });
    stops.push(() => relay.stop());
    const connector = new CompanionOutboundConnector(hostKey, { grants: [], pairingInvitations: () => [] } as unknown as CompanionGateway); stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    expect(connector.connected).toBe(true);
    await relay.stop();
    await expect.poll(() => connector.connected, { timeout: 5_000 }).toBe(false);
    relay = await createCompanionRelay({ key: relayKey, listen, hostIds: [hostId] });
    await expect.poll(() => connector.connected, { timeout: 20_000, interval: 250 }).toBe(true);
  }, 40_000);
  it('keeps one update channel per phone, replacing a stale one from an older connection', async () => {
    const { hostKey, hostId, relay, address, port, phone, phoneKey } = await relayAndPhone();
    const workspace = { teams: [{ id: 'team', name: 'Team', agentIds: [] }], agents: [] } as CompanionWorkspace;
    const gateway = new CompanionGateway(hostId, { grants: [{ peerId: phone.peerId.toString(), name: 'Phone', createdAt: 1 }], commands: {} }, {
      onEvent: () => () => {}, workspace: async () => workspace, save: async () => {}, revoked: () => {},
    } as never);
    const connector = new CompanionOutboundConnector(hostKey, gateway); stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    const open = async (node: Libp2p) => {
      const stream = await node.dialProtocol(multiaddr(`${address}/p2p-circuit/p2p/${hostId}`), companionUpdatesProtocol, { signal: AbortSignal.timeout(5000), runOnLimitedConnection: true });
      const received: any[] = []; const decoder = new CompanionFrameDecoder(companionResponseLimit); let ended = false;
      const reader = (async () => { try { for await (const chunk of stream) received.push(...decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())); } catch {} finally { ended = true; } })();
      stops.push(async () => { stream.abort(new Error('Test complete')); await reader; });
      stream.send(encodeCompanionFrame({ v: 1, id: randomUUID(), method: 'snapshot.get', args: {} }));
      await expect.poll(() => received.some((item) => item.update?.type === 'workspace')).toBe(true);
      return { ended: () => ended, received };
    };
    const first = await open(phone);
    const second = await open(await newPhone(phoneKey));
    await expect.poll(() => first.ended()).toBe(true);
    expect(second.ended()).toBe(false);
  }, 20_000);
  it('streams a catch-up replay longer than the send queue without aborting the updates stream', async () => {
    const { hostKey, hostId, relay, address, port, phone } = await relayAndPhone();
    const workspace = { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [{ id: 'agent', teamId: 'team', backend: 'codex', backendSession: { kind: 'codex', threadId: 'thread' } }] } as CompanionWorkspace;
    const replay = Array.from({ length: 600 }, (_, index) => ({ type: 'codex.conversationEventReceived', backend: 'codex', agentId: 'agent', threadId: 'thread', seq: index + 2, occurredAt: 'now', payload: { revision: index + 2, event: { type: 'provider-event', payload: { text: `Event ${index}` } } } }));
    const gateway = new CompanionGateway(hostId, { grants: [{ peerId: phone.peerId.toString(), name: 'Phone', createdAt: 1 }], commands: {} }, {
      onEvent: () => () => {}, workspace: async () => workspace, conversation: async () => { throw new Error('No snapshot.'); },
      synchronize: async () => ({ checkpoint: { epoch: 'epoch', revision: 601 }, frames: replay }) as never,
      loadOlderHistory: async () => ({ hasOlder: false }), submit: async () => {}, models: async () => [], skills: async () => [], selectModel: async () => {}, startReview: async () => {}, interrupt: async () => {}, restart: async () => {}, branches: async () => [], createChat: async () => 'created', createQuickChat: async () => 'created', setBackend: async () => {}, close: async () => {}, closePreview: async () => ({ isLinkedWorktree: false, branch: null, upstream: null, hasChanges: false }), setApprovalPreset: async () => {}, setPermissionMode: async () => {}, save: async () => {}, revoked: () => {},
    });
    const connector = new CompanionOutboundConnector(hostKey, gateway); stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    const stream = await phone.dialProtocol(multiaddr(`${address}/p2p-circuit/p2p/${hostId}`), companionUpdatesProtocol, { signal: AbortSignal.timeout(5000), runOnLimitedConnection: true });
    const received: any[] = []; const decoder = new CompanionFrameDecoder(companionResponseLimit);
    const reader = (async () => { try { for await (const chunk of stream) received.push(...decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())); } catch {} })();
    stops.push(async () => { stream.abort(new Error('Test complete')); await reader; });
    const request = (method: string, args: unknown) => stream.send(encodeCompanionFrame({ v: 1, id: randomUUID(), method, args }));
    request('snapshot.get', {});
    await expect.poll(() => received.some((item) => item.update?.type === 'workspace')).toBe(true);
    request('conversation.synchronize', { target: { hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) }, checkpoint: { epoch: 'epoch', revision: 1 } });
    await expect.poll(() => received.some((item) => item.result?.checkpoint), { timeout: 10_000 }).toBe(true);
    expect(received.filter((item) => item.update?.type === 'conversation').map((item) => item.update.frame.payload.revision)).toStrictEqual(replay.map((item) => item.payload.revision));
    expect(stream.status).toBe('open');
  }, 30_000);
  it('establishes a real Noise circuit, requires approval, pins peer identities and revokes reconnects', async () => {
    const hostKey = await generateKeyPair('Ed25519'); const hostId = peerIdFromPrivateKey(hostKey).toString();
    const relayKey = await generateKeyPair('Ed25519');
    const relay = await createCompanionRelay({ key: relayKey, listen: '/ip4/127.0.0.1/tcp/0/ws' });
    stops.push(() => relay.stop());
    const address = relay.getMultiaddrs()[0]!.toString();
    const port = address.match(/\/tcp\/(\d+)/)![1];
    const connectorRef: { current?: CompanionOutboundConnector } = {};
    const gateway = new CompanionGateway(hostId, { grants: [], commands: {} }, {
      workspace: async () => ({ teams: [{ id: 'team', name: 'Actual gateway team', agentIds: [] }], agents: [] }),
      loadOlderHistory: async () => ({ hasOlder: false }),
      conversation: async () => { throw new Error('No agent'); }, submit: async () => {}, models: async () => [], skills: async () => [], selectModel: async () => {}, startReview: async () => {}, interrupt: async () => {}, restart: async () => {}, branches: async () => [], createChat: async () => 'created', createQuickChat: async () => 'created', setBackend: async () => {}, close: async () => {}, closePreview: async () => ({ isLinkedWorktree: false, branch: null, upstream: null, hasChanges: false }), setApprovalPreset: async () => {}, setPermissionMode: async () => {}, save: async () => {},
      revoked: (peer) => connectorRef.current?.revoke(peer),
    });
    const connector = new CompanionOutboundConnector(hostKey, gateway); connectorRef.current = connector;
    stops.push(() => connector.stop());
    await connector.start(`ws://127.0.0.1:${port}`, relay.peerId.toString());
    expect(connector.connected).toBe(true);
    const phone = await createLibp2p({ transports: [webSockets(), circuitRelayTransport()], connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() } });
    stops.push(() => phone.stop());
    const invite = gateway.invite(); await connector.advertise();
    const circuit = `${address}/p2p-circuit/p2p/${hostId}`;
    await expect(rpc(phone, circuit, 'snapshot.get', {})).rejects.toThrow();
    // The pinned relay introduces the laptop; only the phone claiming the full code gets a route.
    const code = normalizePairingCode(invite.code)!;
    expect(await resolveCode(phone, address, 'ZZZZZZZZ')).toBeNull();
    expect(await resolveCode(phone, address, code)).toBe(hostId);
    expect(await rpc(phone, circuit, 'snapshot.get', {})).toHaveProperty('error');
    const competing = await createLibp2p({ transports: [webSockets(), circuitRelayTransport()], connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() } });
    stops.push(() => competing.stop());
    expect(await resolveCode(competing, address, code)).toBeNull();
    await expect(rpc(competing, circuit, 'snapshot.get', {})).rejects.toThrow();
    const pairing = await rpc(phone, circuit, 'pair.claim', { code, name: 'Phone' }) as { result: { pendingId: string } };
    expect(pairing.result.pendingId).toBeTruthy();
    expect(gateway.pendingRequests[0]?.peerId).toBe(phone.peerId.toString());
    await gateway.decide(pairing.result.pendingId, true); await connector.advertise();
    expect(await rpc(phone, circuit, 'snapshot.get', {})).toMatchObject({ result: { teams: [{ name: 'Actual gateway team' }] } });
    // Restarting the operator relay retains its pinned identity; the laptop makes
    // a new outbound reservation and advertises its persisted device grant.
    await relay.stop();
    await expect.poll(() => connector.connected, { timeout: 3000 }).toBe(false);
    const restarted = await createCompanionRelay({ key: relayKey, listen: `/ip4/127.0.0.1/tcp/${port}/ws` });
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
/** A relay that routes one laptop identity, and a phone that has not yet been given a grant. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function relayAndPhone() {
  const hostKey = await generateKeyPair('Ed25519'); const hostId = peerIdFromPrivateKey(hostKey).toString();
  const relay = await createCompanionRelay({ key: await generateKeyPair('Ed25519'), listen: '/ip4/127.0.0.1/tcp/0/ws', hostIds: [hostId] });
  stops.push(() => relay.stop());
  const address = relay.getMultiaddrs()[0]!.toString();
  const port = address.match(/\/tcp\/(\d+)/)![1];
  const phoneKey = await generateKeyPair('Ed25519');
  const phone = await newPhone(phoneKey);
  return { hostKey, hostId, relay, address, port, phone, phoneKey };
}
/** The same phone identity can hold several connections, as after a network change. */
async function newPhone(privateKey?: PrivateKey) {
  const phone = await createLibp2p({ ...(privateKey ? { privateKey } : {}), transports: [webSockets(), circuitRelayTransport()], connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() } });
  stops.push(() => phone.stop());
  return phone;
}
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
async function resolveCode(phone: Libp2p, relayAddress: string, code: string): Promise<string | null> {
  try {
    const stream = await phone.dialProtocol(multiaddr(relayAddress), companionRendezvousProtocol, { signal: AbortSignal.timeout(5000) });
    const decoder = new CompanionFrameDecoder();
    try {
      stream.send(encodeCompanionFrame({ code })); await stream.close();
      for await (const chunk of stream) {
        const frames = decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
        if (frames.length) return (frames[0] as { hostId: string }).hostId;
      }
      return null;
    } finally { stream.abort(new Error('Complete')); }
  } catch { return null; }
}
