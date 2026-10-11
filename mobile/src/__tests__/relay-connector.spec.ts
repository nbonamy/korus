// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, publicKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { randomUUID, randomBytes } from 'node:crypto';
import { CompanionFrameDecoder, encodeCompanionFrame } from '@workspace/core/companion-protocol';
const transport = vi.hoisted(() => ({ dial: vi.fn(), stop: vi.fn(), connections: [] as any[], requests: [] as { method: string; args: any }[], response: (method: string, args: any): any => ({}) }));
vi.mock('libp2p', () => ({ createLibp2p: async () => ({ dialProtocol: transport.dial, getConnections: () => transport.connections, stop: transport.stop }) }));
import { createRelayConnector, parseInvitation } from '../relay-connector';
import type { ProtectedVault } from '../protected-storage';
async function invite() {
  const host = await generateKeyPair('Ed25519'); const relay = await generateKeyPair('Ed25519');
  return { v: 1, relayOrigin: 'wss://relay.example', relayPeerId: peerIdFromPrivateKey(relay).toString(), hostId: peerIdFromPrivateKey(host).toString(),
    hostPublicKey: Buffer.from(publicKeyToProtobuf(host.publicKey)).toString('base64'), inviteId: randomUUID(), inviteSecret: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 290_000 };
}
function vault() {
  const values = new Map<string, string>();
  return { read: vi.fn(async ({ key }) => ({ value: values.get(key) ?? null })), write: vi.fn(async ({ key, value }) => { values.set(key, value); }), remove: vi.fn(), values } satisfies ProtectedVault & { values: Map<string, string> };
}
beforeEach(() => {
  transport.requests.length = 0; transport.connections.length = 0; transport.stop.mockClear();
  transport.response = (method) => method === 'pair.request' ? { pendingId: randomUUID() } : method === 'pair.status' ? { state: 'approved', grant: { canSend: true } } : {};
  transport.dial.mockReset().mockImplementation(async () => {
    let reply: unknown;
    return { status: 'open', send(frame: Uint8Array) {
      const request = new CompanionFrameDecoder().push(frame)[0] as { id: string; method: string; args: unknown };
      transport.requests.push(request);
      reply = { v: 1, id: request.id, result: transport.response(request.method, request.args) }; return true;
    }, close: async () => {}, abort: () => {}, async *[Symbol.asyncIterator]() { yield encodeCompanionFrame(reply); } };
  });
});
describe('native relay host adapter', () => {
  it('reuses the limited pinned circuit for approval polls and excludes another relay path', async () => {
    const invitation = await invite(); const connector = createRelayConnector(vault());
    const address = `/dns4/relay.example/tcp/443/tls/ws/p2p/${invitation.relayPeerId}/p2p-circuit/p2p/${invitation.hostId}`;
    const streamFactory = transport.dial.getMockImplementation()!;
    const wrongPath = vi.fn(); const reused = vi.fn(streamFactory);
    transport.connections.push({ status: 'open', remoteAddr: { toString: () => `${address}/other` }, newStream: wrongPath },
      { status: 'open', remoteAddr: { toString: () => address }, newStream: reused });
    try {
      await connector.pair!(JSON.stringify(invitation), 'Phone', () => {});
      expect(reused).toHaveBeenCalledTimes(2);
      expect(reused).toHaveBeenCalledWith('/workspace/companion/1.0.0', expect.objectContaining({ runOnLimitedConnection: true }));
      expect(wrongPath).not.toHaveBeenCalled(); expect(transport.dial).not.toHaveBeenCalled();
    } finally { await connector.dispose!(); }
  });
  it('delivers authoritative updates while connected and reports transport loss without replaying prompts', async () => {
    vi.useFakeTimers();
    const invitation = await invite(); const connector = createRelayConnector(vault());
    try {
      await connector.pair!(JSON.stringify(invitation), 'Phone', () => {});
      const frame = { type: 'codex.conversationSnapshotChanged', agentId: 'agent', backend: 'codex', payload: { revision: 2, snapshot: { messages: [{ text: 'Live response' }] } } };
      transport.response = (method) => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [{ id: 'agent', teamId: 'team', backendSession: { kind: 'codex', threadId: 'thread' } }] } : frame;
      const session = await connector.connect(invitation.hostId); await session.getWorkspace(); await session.loadConversation('agent');
      const update = vi.fn(); const disconnected = vi.fn();
      const stop = session.onUpdate!(update); session.onDisconnect(disconnected);
      await vi.advanceTimersByTimeAsync(1200);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ teams: [expect.objectContaining({ id: 'team' })] }), frame);
      transport.dial.mockRejectedValueOnce(new Error('Relay unavailable'));
      await vi.advanceTimersByTimeAsync(1200);
      expect(disconnected).toHaveBeenCalledOnce();
      expect(transport.requests.some((request) => request.method === 'prompt.submit')).toBe(false);
      stop(); await connector.suspend!();
    } finally { await connector.dispose!(); vi.useRealTimers(); }
  });
  it('holds native networking closed in background and reconnects only after foreground resume', async () => {
    const invitation = await invite(); const connector = createRelayConnector(vault());
    await connector.pair!(JSON.stringify(invitation), 'Phone', () => {});
    await connector.suspend!(); transport.dial.mockClear();
    const session = await connector.connect(invitation.hostId);
    await expect(session.getWorkspace()).rejects.toThrow('paused');
    expect(transport.dial).not.toHaveBeenCalled();
    await connector.resume!();
    transport.response = () => ({ teams: [], agents: [] });
    expect(await session.getWorkspace()).toEqual({ teams: [], agents: [] });
    session.close(); await connector.dispose!();
  });
  it('pins invitation identities, saves native identity once and keeps the invitation secret out of durable pairing', async () => {
    const invitation = await invite(); const storage = vault(); const connector = createRelayConnector(storage);
    const pending = vi.fn(); const hostId = await connector.pair!(JSON.stringify(invitation), 'Phone', pending);
    expect(hostId).toBe(invitation.hostId); expect(pending).toHaveBeenCalledOnce();
    expect(storage.values.get('paired-hosts')).not.toContain(invitation.inviteSecret);
    expect(storage.values.get('paired-hosts')).not.toContain(invitation.inviteId);
    expect(storage.values.has('device-identity')).toBe(true);
    const restored = createRelayConnector(storage); await restored.initialize!();
    expect(restored.laptops).toEqual([{ id: hostId, name: 'Paired laptop' }]);
    await connector.dispose!(); await restored.dispose!();
  });
  it('rejects expired or key-mismatched invitations before dialing; rejects unpaired hosts and corrupt saved identities', async () => {
    const invitation = await invite();
    expect(() => parseInvitation(JSON.stringify({ ...invitation, expiresAt: Date.now() - 1 }))).toThrow('expired');
    expect(() => parseInvitation(JSON.stringify({ ...invitation, hostId: invitation.relayPeerId }))).toThrow('identity');
    expect(() => parseInvitation(JSON.stringify({ ...invitation, relayOrigin: 'ws://relay.example' }))).toThrow('secure');
    const storage = vault(); const connector = createRelayConnector(storage);
    await expect(connector.connect('unpaired')).rejects.toThrow('Pair');
    storage.values.set('paired-hosts', JSON.stringify([{ ...invitation, hostId: invitation.relayPeerId }]));
    const corrupted = createRelayConnector(storage);
    await expect(corrupted.initialize!()).rejects.toThrow('identity');
    expect(transport.dial).not.toHaveBeenCalled();
  });
  it('uses location/session-scoped app operations, reconciles delivery and removes native pairing on forget', async () => {
    const invitation = await invite(); const storage = vault(); const connector = createRelayConnector(storage);
    await connector.pair!(JSON.stringify(invitation), 'Phone', () => {});
    const agent = { id: 'agent', name: 'Agent', teamId: 'team', backend: 'codex', backendSession: { kind: 'codex', threadId: 'thread' }, status: { type: 'idle' }, folder: null, createdAt: '', updatedAt: '' };
    transport.response = (method) => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'], remoteConnectionId: 'remote-host' }], agents: [agent] }
      : method === 'conversation.subscribe' ? { type: 'codex.conversationSnapshotChanged', agentId: 'agent', backend: 'codex', payload: { revision: 1, snapshot: { messages: [] } } }
      : method === 'prompt.submit' || method === 'command.status' ? { state: 'accepted' } : {};
    const session = await connector.connect(invitation.hostId); await session.getWorkspace();
    await session.loadConversation('agent');
    const commandId = randomUUID(); await session.sendPrompt('agent', 'Reply once', commandId);
    expect(transport.requests.find((request) => request.method === 'prompt.submit')?.args).toMatchObject({ clientCommandId: commandId,
      target: { hostId: invitation.hostId, locationId: 'remote-host', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify(agent.backendSession) } });
    expect(await session.commandStatus!(commandId)).toBe('accepted');
    await expect(session.loadConversation('foreign')).rejects.toThrow('scope');
    await connector.revoke(invitation.hostId);
    expect(connector.laptops).toEqual([]); expect(storage.values.get('paired-hosts')).toBe('[]');
    await expect(session.sendPrompt('agent', 'Again')).rejects.toThrow('Disconnected');
    expect(transport.requests.some((request) => request.method === 'device.forget')).toBe(true);
    await connector.dispose!(); expect(transport.stop).toHaveBeenCalledOnce();
  });
});
