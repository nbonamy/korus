import { codexConversationSnapshot, codexTextMessage } from '../../../vue/src/test/codex-conversation-fixtures';
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { randomUUID } from 'node:crypto';
import { CompanionFrameDecoder, companionFrameLimit, companionUpdatesProtocol, companionResponseLimit, encodeCompanionFrame } from '@workspace/core/companion-protocol';
const transport = vi.hoisted(() => ({ dial: vi.fn(), stop: vi.fn(), connections: [] as any[], requests: [] as { method: string; args: any }[], rendezvous: [] as { channel: string }[], known: '', phone: '', publish: (_update: unknown) => {}, endUpdates: () => {}, response: (method: string, args: any): any => ({}) }));
vi.mock('libp2p', () => ({ createLibp2p: async (config: { privateKey: Parameters<typeof peerIdFromPrivateKey>[0] }) => { transport.phone = peerIdFromPrivateKey(config.privateKey).toString(); return { dialProtocol: transport.dial, getConnections: () => transport.connections, stop: transport.stop }; } }));
import { createRelayConnector } from '../relay-connector';
import { createPairingExchange, normalizePairingCode } from '@workspace/core/companion-pairing';
import type { ProtectedVault } from '../protected-storage';
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));
/** A laptop that follows the pairing exchange for one code; nothing else is simulated. */
async function laptop(shown = 'K7QD-M2XP') {
  const host = await generateKeyPair('Ed25519'); const relayKey = await generateKeyPair('Ed25519');
  const code = normalizePairingCode(shown)!; let responder: ReturnType<typeof createPairingExchange> | undefined; let confirmations: ReturnType<ReturnType<typeof createPairingExchange>['finish']> | undefined;
  return { hostId: peerIdFromPrivateKey(host).toString(), relay: { origin: 'wss://relay.example', peerId: peerIdFromPrivateKey(relayKey).toString() }, code, shown,
    start(peerId: string, message: string) {
      responder = createPairingExchange({ role: 'responder', code, initiatorId: peerId, responderId: peerIdFromPrivateKey(host).toString() });
      confirmations = responder.finish(unb64(message));
      return { message: b64(responder.message), confirm: b64(confirmations.responderConfirm) };
    },
    confirmed(confirm: string) { return b64(confirmations!.initiatorConfirm) === confirm; } };
}
function vault() {
  const values = new Map<string, string>();
  return { read: vi.fn(async ({ key }) => ({ value: values.get(key) ?? null })), write: vi.fn(async ({ key, value }) => { values.set(key, value); }), remove: vi.fn(), values } satisfies ProtectedVault & { values: Map<string, string> };
}
let host: Awaited<ReturnType<typeof laptop>>;
beforeEach(async () => {
  host = await laptop();
  transport.requests.length = 0; transport.connections.length = 0; transport.stop.mockClear(); transport.rendezvous.length = 0;
  transport.response = (method, args) => method === 'pair.start' ? host.start(transport.phone, args.message)
    : method === 'pair.confirm' ? (host.confirmed(args.confirm) ? { pendingId: randomUUID(), state: 'awaitingApproval' } : (() => { throw new Error('denied'); })())
    : method === 'pair.status' ? { state: 'approved', grant: {} } : {};
  transport.dial.mockReset().mockImplementation(async (_address: unknown, protocol: string) => {
    if (protocol === companionUpdatesProtocol) {
      let done = false; let wake = () => {}; let seq = 0; const queued: Uint8Array[] = [];
      const push = (value: unknown) => { queued.push(encodeCompanionFrame(value, companionResponseLimit)); wake(); };
      transport.publish = (update) => push({ v: 1, seq: ++seq, update });
      transport.endUpdates = () => { done = true; wake(); };
      return { status: 'open', send(frame: Uint8Array) {
        const call = new CompanionFrameDecoder().push(frame)[0] as { id: string; method: string; args: unknown };
        transport.requests.push(call);
        const result = transport.response(call.method, call.args);
        if (call.method === 'conversation.subscribe') transport.publish({ type: 'conversation', frame: result });
        if (call.method === 'snapshot.get') transport.publish({ type: 'workspace', workspace: result });
        push({ v: 1, id: call.id, result: call.method === 'conversation.subscribe' ? {} : result }); return true;
      }, abort() { done = true; wake(); }, async *[Symbol.asyncIterator]() {
        while (!done) { while (queued.length) yield queued.shift()!; if (!done) await new Promise<void>((resolve) => { wake = resolve; }); }
      } };
    }
    let reply: unknown;
    return { status: 'open', send(frame: Uint8Array) {
      const request = new CompanionFrameDecoder().push(frame)[0] as { id: string; method: string; args: unknown };
      if (protocol === '/workspace/companion-rendezvous/1.0.0') { transport.rendezvous.push(request as never); reply = transport.known === (request as never as { channel: string }).channel ? { hostId: host.hostId } : undefined; return true; }
      transport.requests.push(request);
      reply = { v: 1, id: request.id, result: transport.response(request.method, request.args) }; return true;
    }, close: async () => {}, abort: () => {}, async *[Symbol.asyncIterator]() { if (reply) yield encodeCompanionFrame(reply, companionResponseLimit); } };
  });
  transport.known = 'K7QD';
});
const pairWith = (connector: ReturnType<typeof createRelayConnector>, code = 'K7QD-M2XP') => connector.pair!(code, 'Phone', () => {});
describe('native relay host adapter', () => {
  const connect = (storage = vault()) => createRelayConnector(storage, host.relay);
  it('pairs and restores over local WS only for the native Debug relay configuration', async () => {
    host.relay.origin = 'ws://laptop.local:47801';
    const storage = vault();
    const config = { ...host.relay, allowLocalDevelopment: true };
    const connector = createRelayConnector(storage, config);
    try {
      expect(await pairWith(connector)).toBe(host.hostId);
      expect(transport.dial.mock.calls[0]![0].toString()).toBe(`/dns4/laptop.local/tcp/47801/ws/p2p/${host.relay.peerId}`);
      const restored = createRelayConnector(storage, config);
      await restored.initialize!();
      expect(restored.laptops).toEqual([{ id: host.hostId, name: 'Paired laptop' }]);
      await restored.dispose!();
      for (const other of [host.relay, { ...config, origin: 'ws://other.local:47801' }, { ...config, peerId: host.hostId }, null]) {
        await expect(createRelayConnector(storage, other).initialize!()).rejects.toThrow('Invalid secure relay configuration');
      }
      expect(storage.values.get('paired-hosts')).not.toContain('allowLocalDevelopment');
    } finally { await connector.dispose!(); }
  });
  const agent = { id: 'agent', name: 'Agent', teamId: 'team', backend: 'codex', backendSession: { kind: 'codex', threadId: 'thread' }, status: { type: 'idle' }, folder: null, createdAt: '', updatedAt: '' };
  it('receives large history pages from the pinned laptop and owning session', async () => {
    const connector = connect(); await pairWith(connector);
    const page = { frame: { agentId: 'agent', payload: { snapshot: { messages: [{ text: 'x'.repeat(companionFrameLimit) }] } } }, hasOlder: false };
    transport.response = (method) => method === 'snapshot.get'
      ? { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'], remoteConnectionId: 'remote' }], agents: [agent] } : page;
    try {
      const session = await connector.connect(host.hostId); await session.getWorkspace();
      expect(await session.loadOlderHistory!('agent')).toStrictEqual(page);
      expect(transport.requests.at(-1)).toMatchObject({ method: 'conversation.loadOlder', args: {
        hostId: host.hostId, locationId: 'remote', teamId: 'team', agentId: 'agent', sessionId: '{"kind":"codex","threadId":"thread"}',
      } });
      await expect(session.loadOlderHistory!('unknown')).rejects.toThrow();
    } finally { await connector.dispose!(); }
  });
  it('finds the laptop from the code, proves the code, and reuses the limited pinned circuit for approval polls', async () => {
    const connector = connect();
    const address = `/dns4/relay.example/tcp/443/tls/ws/p2p/${host.relay.peerId}/p2p-circuit/p2p/${host.hostId}`;
    const streamFactory = transport.dial.getMockImplementation()!;
    const wrongPath = vi.fn(); const reused = vi.fn(streamFactory);
    transport.connections.push({ status: 'open', remoteAddr: { toString: () => `${address}/other` }, newStream: wrongPath },
      { status: 'open', remoteAddr: { toString: () => address }, newStream: reused });
    try {
      const pending = vi.fn();
      expect(await connector.pair!(' k7qd m2xp ', 'Phone', pending)).toBe(host.hostId);
      expect(transport.rendezvous).toStrictEqual([{ channel: 'K7QD' }]);
      expect(transport.requests.map((request) => request.method)).toStrictEqual(['pair.start', 'pair.confirm', 'pair.status']);
      expect(reused).toHaveBeenCalledTimes(3);
      expect(reused).toHaveBeenCalledWith('/workspace/companion/1.0.0', expect.objectContaining({ runOnLimitedConnection: true }));
      expect(wrongPath).not.toHaveBeenCalled(); expect(transport.dial).toHaveBeenCalledTimes(1);
      expect(pending).toHaveBeenCalledOnce();
    } finally { await connector.dispose!(); }
  });
  it('streams updates immediately without polling and reports transport loss without replaying prompts', async () => {
    vi.useFakeTimers();
    const connector = connect();
    try {
      await pairWith(connector);
      const frame = { type: 'codex.conversationSnapshotChanged', agentId: 'agent', backend: 'codex', threadId: 'thread', seq: 1, occurredAt: '2026-10-14T00:00:00Z', payload: { revision: 2, snapshot: codexConversationSnapshot([codexTextMessage('response', 'assistant', 'Live response')], { activeConversationId: 'thread', historyState: { loadingStrategy: 'lazy', fullyLoaded: true, hasOlder: false, loadingOlder: false } }) } };
      transport.response = (method) => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [agent] } : frame;
      const session = await connector.connect(host.hostId); await session.getWorkspace();
      const update = vi.fn(); const disconnected = vi.fn();
      const stop = session.onUpdate!(update); session.onDisconnect(disconnected);
      await session.loadConversation('agent');
      const next = { ...frame, payload: { ...frame.payload, revision: 3 } };
      transport.publish({ type: 'conversation', frame: next });
      await vi.advanceTimersByTimeAsync(0);
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ teams: [expect.objectContaining({ id: 'team' })] }), next);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(transport.requests.filter((request) => request.method === 'snapshot.get')).toHaveLength(1);
      expect(transport.requests.filter((request) => request.method === 'conversation.subscribe')).toHaveLength(1);
      transport.endUpdates(); await vi.advanceTimersByTimeAsync(0);
      expect(disconnected).toHaveBeenCalledOnce();
      expect(transport.requests.some((request) => request.method === 'prompt.submit')).toBe(false);
      stop(); await connector.suspend!();
    } finally { await connector.dispose!(); vi.useRealTimers(); }
  });
  it('keeps repository icons across workspace updates and asks the laptop for them only when its copy is stale', async () => {
    const connector = connect(); await pairWith(connector);
    const session = await connector.connect(host.hostId);
    transport.response = () => ({ teams: [], agents: [], iconsVersion: 'v1', repositoryIcons: { '/r': 'GEAR' } });
    expect(await session.getWorkspace()).toMatchObject({ repositoryIcons: { '/r': 'GEAR' } });
    transport.response = () => ({ teams: [], agents: [], iconsVersion: 'v1' });
    expect(await session.getWorkspace()).toMatchObject({ repositoryIcons: { '/r': 'GEAR' } });
    expect(transport.requests.filter((request) => request.method === 'snapshot.get').map((request) => request.args)).toStrictEqual([{ iconsVersion: '' }, { iconsVersion: 'v1' }]);
    session.close(); await connector.dispose!();
  });
  it('lists models, saves a model choice and sends composer options with a prompt', async () => {
    const connector = connect(); await pairWith(connector);
    transport.response = (method) => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [agent] } : method === 'models.list' ? { models: [{ id: 'm', model: 'm', displayName: 'M' }] } : { state: 'accepted' };
    const session = await connector.connect(host.hostId); await session.getWorkspace();
    expect(await session.listModels!('agent')).toStrictEqual([{ id: 'm', model: 'm', displayName: 'M' }]);
    await session.selectModel!('agent', { model: 'm', reasoningEffort: 'high', serviceTier: null });
    await session.sendPrompt('agent', 'Go', randomUUID(), { model: 'm', planMode: true }, [{ type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', data: 'AAAA' }]);
    expect(transport.requests.find((request) => request.method === 'agent.model.select')?.args).toStrictEqual({ agentId: 'agent', model: 'm', reasoningEffort: 'high', serviceTier: null });
    expect(transport.requests.find((request) => request.method === 'prompt.submit')?.args).toMatchObject({ text: 'Go', options: { model: 'm', planMode: true }, attachments: [{ name: 'photo.jpg', data: 'AAAA' }] });
    await session.startReview!('agent', { scope: { type: 'uncommitted' }, threadMode: 'independent' });
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.review.start', args: { agentId: 'agent', input: { scope: { type: 'uncommitted' }, threadMode: 'independent' } } });
    await session.interrupt!('agent'); await session.setApprovalPreset!('agent', 'full-access'); await session.setPermissionMode!('agent', 'acceptEdits');
    expect(transport.requests.filter((request) => /^agent\.(interrupt|approvalPreset|permissionMode)/.test(request.method)).map((request) => [request.method, request.args]))
      .toStrictEqual([['agent.interrupt', { agentId: 'agent' }], ['agent.approvalPreset.set', { agentId: 'agent', preset: 'full-access' }], ['agent.permissionMode.set', { agentId: 'agent', mode: 'acceptEdits' }]]);
    await session.restartSession!('agent');
    const selectedTarget = { hostId: host.hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) };
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.restart', args: selectedTarget });
    await session.previewCloseSession!('agent');
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.close.preview', args: selectedTarget });
    const input = { deleteWorktree: true as const, deleteRemoteBranch: false, discardChanges: true, confirmed: true as const };
    await session.closeSession!(selectedTarget, input);
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.close', args: { target: selectedTarget, input } });
    session.close(); await connector.dispose!();
  });
  it('holds native networking closed in background and reconnects only after foreground resume', async () => {
    const connector = connect();
    await pairWith(connector);
    await connector.suspend!(); transport.dial.mockClear();
    const session = await connector.connect(host.hostId);
    await expect(session.getWorkspace()).rejects.toThrow('paused');
    expect(transport.dial).not.toHaveBeenCalled();
    await connector.resume!();
    transport.response = () => ({ teams: [], agents: [] });
    const resumed = await connector.connect(host.hostId);
    expect(await resumed.getWorkspace()).toEqual({ teams: [], agents: [], repositoryIcons: {} });
    resumed.close();
    session.close(); await connector.dispose!();
  });
  it('keeps only the pinned laptop and relay identities, never the code, and restores them after restart', async () => {
    const storage = vault(); const connector = connect(storage);
    expect(await pairWith(connector)).toBe(host.hostId);
    const saved = storage.values.get('paired-hosts')!;
    expect(saved).not.toContain('K7QD'); expect(saved).not.toContain('M2XP');
    expect(JSON.parse(saved)).toStrictEqual([{ v: 1, relayOrigin: 'wss://relay.example', relayPeerId: host.relay.peerId, hostId: host.hostId, name: 'Paired laptop' }]);
    expect(storage.values.has('device-identity')).toBe(true);
    const restored = connect(storage); await restored.initialize!();
    expect(restored.laptops).toEqual([{ id: host.hostId, name: 'Paired laptop' }]);
    await connector.dispose!(); await restored.dispose!();
  });
  it('refuses a mistyped code, an unknown channel, a laptop that cannot prove the code and a build without a relay', async () => {
    const connector = connect();
    await expect(pairWith(connector, 'K7QD-M2X')).rejects.toThrow('codeFormat');
    expect(transport.dial).not.toHaveBeenCalled();
    transport.known = 'ABCD';
    await expect(pairWith(connector)).rejects.toThrow('noLaptop');
    transport.known = 'K7QD';
    const imposter = await laptop('K7QD-M2XQ'); host.start = imposter.start; host.confirmed = imposter.confirmed;
    await expect(pairWith(connector)).rejects.toThrow('codeMismatch');
    expect(transport.requests.map((request) => request.method)).toStrictEqual(['pair.start']);
    await connector.dispose!();
    await expect(createRelayConnector(vault(), null).pair!('K7QD-M2XP', 'Phone', () => {})).rejects.toThrow('noRelay');
  });
  it('rejects unpaired hosts and corrupt saved identities without dialing', async () => {
    const storage = vault(); const connector = connect(storage);
    await expect(connector.connect('unpaired')).rejects.toThrow('Pair');
    storage.values.set('paired-hosts', JSON.stringify([{ v: 1, relayOrigin: 'wss://relay.example', relayPeerId: host.relay.peerId, hostId: 'not-an-identity', name: 'Laptop' }]));
    await expect(connect(storage).initialize!()).rejects.toThrow('identity');
    expect(transport.dial).not.toHaveBeenCalled();
  });
  it('uses location/session-scoped app operations, reconciles delivery and removes native pairing on forget', async () => {
    const storage = vault(); const connector = connect(storage);
    await pairWith(connector);
    transport.response = (method) => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'], remoteConnectionId: 'remote-host' }], agents: [agent] }
      : method === 'conversation.subscribe' ? { type: 'codex.conversationSnapshotChanged', agentId: 'agent', backend: 'codex', threadId: 'thread', seq: 1, occurredAt: '2026-10-14T00:00:00Z', payload: { revision: 1, snapshot: codexConversationSnapshot([], { activeConversationId: 'thread', historyState: { loadingStrategy: 'lazy', fullyLoaded: true, hasOlder: false, loadingOlder: false } }) } }
      : method === 'prompt.submit' || method === 'command.status' ? { state: 'accepted' } : {};
    const session = await connector.connect(host.hostId); await session.getWorkspace();
    await session.loadConversation('agent');
    const commandId = randomUUID(); await session.sendPrompt('agent', 'Reply once', commandId);
    expect(transport.requests.find((request) => request.method === 'prompt.submit')?.args).toMatchObject({ clientCommandId: commandId,
      target: { hostId: host.hostId, locationId: 'remote-host', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify(agent.backendSession) } });
    expect(await session.commandStatus!(commandId)).toBe('accepted');
    await expect(session.loadConversation('foreign')).rejects.toThrow('scope');
    await connector.revoke(host.hostId);
    expect(connector.laptops).toEqual([]); expect(storage.values.get('paired-hosts')).toBe('[]');
    await expect(session.sendPrompt('agent', 'Again')).rejects.toThrow('Disconnected');
    expect(transport.requests.some((request) => request.method === 'device.forget')).toBe(true);
    await connector.dispose!(); expect(transport.stop).toHaveBeenCalledOnce();
  });
});
