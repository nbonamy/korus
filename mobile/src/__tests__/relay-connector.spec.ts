import { codexConversationSnapshot, codexTextMessage } from '../../../vue/src/test/codex-conversation-fixtures';
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { companionPushAuthorizationMessage } from '@workspace/core/companion-notification';
import { peerIdFromPrivateKey, peerIdFromString } from '@libp2p/peer-id';
import { randomUUID } from 'node:crypto';
import { CompanionFrameDecoder, companionFrameLimit, companionUpdatesProtocol, companionResponseLimit, encodeCompanionFrame } from '@workspace/core/companion-protocol';
const transport = vi.hoisted(() => ({ dial: vi.fn(), stop: vi.fn(), connections: [] as any[], requests: [] as { method: string; args: any }[], rendezvous: [] as { code: string }[], known: '', phone: '', publish: (_update: unknown) => {}, endUpdates: () => {}, response: (method: string, args: any): any => ({}) }));
vi.mock('libp2p', () => ({ createLibp2p: async (config: { privateKey: Parameters<typeof peerIdFromPrivateKey>[0] }) => { transport.phone = peerIdFromPrivateKey(config.privateKey).toString(); return { dialProtocol: transport.dial, getConnections: () => transport.connections, stop: transport.stop, addEventListener: vi.fn() }; } }));
import { createRelayConnector } from '../relay-connector';
import { createEngine } from '../engine';
import { normalizePairingCode } from '@workspace/core/companion-pairing';
import type { ProtectedVault } from '../protected-storage';
import { setConnectionDiagnosticSink } from '../connection-diagnostics';
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));
/** Identities introduced by the pinned relay; transport authenticity is tested with real Noise separately. */
async function laptop(shown = 'K7QD-M2XP') {
  const host = await generateKeyPair('Ed25519'); const relayKey = await generateKeyPair('Ed25519');
  return { hostId: peerIdFromPrivateKey(host).toString(), relay: { origin: 'wss://relay.example', peerId: peerIdFromPrivateKey(relayKey).toString() }, code: normalizePairingCode(shown)!, shown };
}
function vault() {
  const values = new Map<string, string>();
  return { read: vi.fn(async ({ key }) => ({ value: values.get(key) ?? null })), write: vi.fn(async ({ key, value }) => { values.set(key, value); }), remove: vi.fn(), values } satisfies ProtectedVault & { values: Map<string, string> };
}
let host: Awaited<ReturnType<typeof laptop>>;
beforeEach(async () => {
  host = await laptop();
  transport.requests.length = 0; transport.connections.length = 0; transport.stop.mockClear(); transport.rendezvous.length = 0;
  transport.response = (method, args) => method === 'pair.claim'
    ? (args.code === host.code ? { pendingId: randomUUID(), state: 'awaitingApproval' } : (() => { throw new Error('denied'); })())
    : method === 'pair.status' ? { state: 'approved', grant: {} } : {};
  transport.dial.mockReset().mockImplementation(async (_address: unknown, offered: string | string[]) => {
    // This fixture is an older host: multistream negotiation chooses its legacy protocol.
    const protocol = Array.isArray(offered) ? offered.at(-1)! : offered;
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
        if (call.method === 'snapshot.get' && !(result instanceof Error)) transport.publish({ type: 'workspace', workspace: result });
        push(result instanceof Error ? { v: 1, id: call.id, error: result.message } : { v: 1, id: call.id, result: call.method === 'conversation.subscribe' ? {} : result }); return true;
      }, abort() { done = true; wake(); }, async *[Symbol.asyncIterator]() {
        while (!done) { while (queued.length) yield queued.shift()!; if (!done) await new Promise<void>((resolve) => { wake = resolve; }); }
      } };
    }
    let reply: unknown;
    return { status: 'open', send(frame: Uint8Array) {
      const request = new CompanionFrameDecoder().push(frame)[0] as { id: string; method: string; args: unknown };
      if (protocol === '/workspace/companion-rendezvous/2.0.0') { transport.rendezvous.push(request as never); reply = transport.known === (request as never as { code: string }).code ? { hostId: host.hostId } : undefined; return true; }
      transport.requests.push(request);
      reply = { v: 1, id: request.id, result: transport.response(request.method, request.args) }; return true;
    }, close: async () => {}, abort: () => {}, async *[Symbol.asyncIterator]() { if (reply) yield encodeCompanionFrame(reply, companionResponseLimit); } };
  });
  transport.known = 'K7QDM2XP';
});
const pairWith = (connector: ReturnType<typeof createRelayConnector>, code = 'K7QD-M2XP') => connector.pair!(code, 'Phone', () => {});
describe('native relay host adapter', () => {
  it.each(['steer', 'queue'] as const)('sends %s using its compatible wire options without replay', async mode => {
    const connector = createRelayConnector(vault(), host.relay); await pairWith(connector);
    const target = { hostId: host.hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null };
    const clientCommandId = randomUUID();
    transport.response = (method, args) => {
      if (method !== 'prompt.submit') return {};
      // Released desktops steer by default and strictly reject the new option.
      if (mode === 'steer' && args.options?.followUpBehavior !== undefined) throw new Error('Unknown prompt option');
      return { clientCommandId, target, state: 'accepted' };
    };
    const session = await connector.connect(host.hostId);
    try {
      await expect(session.sendPrompt(target, 'Continue', clientCommandId, { followUpBehavior: mode, selection: { model: 'm' } })).resolves.toBeUndefined();
      expect(transport.requests.filter(request => request.method === 'prompt.submit').map(({ args }) => args)).toStrictEqual([
        { target, text: 'Continue', clientCommandId, options: { ...(mode === 'queue' ? { followUpBehavior: 'queue' } : {}), selection: { model: 'm' } } },
      ]);
    } finally { session.close(); await connector.dispose!(); }
  });

  it('retires stale host and relay routes after a failed foreground probe', async () => {
    vi.useFakeTimers();
    const connector = createRelayConnector(vault(), host.relay); await pairWith(connector);
    let parked = false;
    transport.response = () => ({ teams: [], agents: [] });
    const dial = transport.dial.getMockImplementation()!;
    transport.dial.mockImplementation(async (...args) => {
      const source = await dial(...args); const send = source.send.bind(source);
      source.send = (frame: Uint8Array) => parked ? true : send(frame);
      return source;
    });
    const session = await connector.connect(host.hostId);
    const lost = vi.fn(); session.onDisconnect(lost);
    const hostAbort = vi.fn(); const relayAbort = vi.fn(); const otherAbort = vi.fn();
    transport.connections.push(...[[host.hostId, hostAbort], [host.relay.peerId, relayAbort], ['other', otherAbort]].map(([peer, abort]) => ({
      status: 'open', remoteAddr: { toString: () => 'different route' }, remotePeer: { toString: () => peer }, abort,
    })));
    try {
      await session.getWorkspace(); await session.setActive!(false); parked = true;
      const returned = session.setActive!(true); const rejected = expect(returned).rejects.toThrow('Disconnected');
      await vi.advanceTimersByTimeAsync(2_000); await rejected;
      expect(lost).toHaveBeenCalledOnce();
      expect(hostAbort).toHaveBeenCalledOnce(); expect(relayAbort).toHaveBeenCalledOnce();
      expect(otherAbort).not.toHaveBeenCalled();
    } finally { session.close(); await connector.dispose!(); vi.useRealTimers(); }
  });
  it('resumes the live stream without waiting for a slow workspace refresh', async () => {
    vi.useFakeTimers();
    const connector = createRelayConnector(vault(), host.relay); await pairWith(connector);
    let parked = false;
    transport.response = () => ({ teams: [], agents: [] });
    const dial = transport.dial.getMockImplementation()!;
    transport.dial.mockImplementation(async (...args) => {
      const source = await dial(...args);
      const send = source.send.bind(source);
      source.send = (frame: Uint8Array) => {
        const call = new CompanionFrameDecoder().push(frame)[0] as { method: string };
        return parked && call.method === 'snapshot.get' ? true : send(frame);
      };
      return source;
    });
    const session = await connector.connect(host.hostId);
    let resumed: Promise<void> | undefined;
    try {
      await session.getWorkspace(); await session.setActive!(false); parked = true;
      let returned = false;
      resumed = session.setActive!(true).then(() => { returned = true; });
      void resumed.catch(() => {});
      await vi.advanceTimersByTimeAsync(100);
      expect(returned).toBe(true);
      await resumed;
      expect(transport.requests.filter(call => call.method === 'ping').length).toBe(1);
    } finally { session.close(); await resumed?.catch(() => {}); await connector.dispose!(); vi.useRealTimers(); }
  });
  it('reads account quotas through the paired laptop circuit without a selected conversation', async () => {
    const connector = createRelayConnector(vault(), host.relay); await pairWith(connector);
    const providers = [{ backend: 'codex', limits: { primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 2_000_000_000 }, secondary: null }, failed: false }];
    transport.response = () => providers;
    const session = await connector.connect(host.hostId);
    try {
      expect(await session.getUsage!()).toStrictEqual(providers);
      expect(transport.requests.at(-1)).toMatchObject({ method: 'usage.get', args: {} });
    } finally { session.close(); await connector.dispose!(); }
  });

  it('keeps chat connected to older laptops that reject notification subscription flags', async () => {
    const connector = createRelayConnector(vault(), host.relay); await pairWith(connector);
    transport.response = (_method, args) => args.notifications ? new Error('Unknown field') : { teams: [], agents: [] };
    const session = await connector.connect(host.hostId);
    try {
      expect(await session.getWorkspace()).toMatchObject({ teams: [], agents: [] });
      expect(await session.getWorkspace()).toMatchObject({ teams: [], agents: [] });
      expect(transport.requests.filter(request => request.method === 'snapshot.get').map(request => request.args)).toStrictEqual([
        { iconsVersion: '', notifications: true }, { iconsVersion: '' }, { iconsVersion: '' },
      ]);
    } finally { session.close(); await connector.dispose!(); }
  });

  it('registers a phone token and accepts attention only from the paired laptop identity', async () => {
    const connector = createRelayConnector(vault(), host.relay);
    await pairWith(connector);
    transport.response = () => ({ teams: [], agents: [] });
    const session = await connector.connect(host.hostId);
    try {
      await session.getWorkspace();
      const seen = vi.fn(); session.onNotification!(seen);
      const registration = { token: 'ab'.repeat(32), environment: 'development' as const };
      await session.registerPush!(registration);
      expect(transport.requests.at(-1)).toMatchObject({ method: 'notifications.register', args: registration });
      const signed = transport.requests.at(-1)!.args;
      expect(signed.authorization.expiresAt).toBeGreaterThan(Date.now());
      expect(await peerIdFromString(transport.phone).publicKey!.verify(companionPushAuthorizationMessage(
        host.relay.peerId, host.hostId, transport.phone, signed, signed.authorization.expiresAt), unb64(signed.authorization.signature))).toBe(true);
      await session.registerPush!(null);
      expect(transport.requests.at(-1)).toMatchObject({ method: 'notifications.register', args: null });
      const notification = { id: 'event', kind: 'approval', name: 'Builder', createdAt: Date.now(), target: { hostId: host.hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null } };
      transport.publish({ type: 'notification', notification });
      await vi.waitFor(() => expect(seen).toHaveBeenCalledExactlyOnceWith(notification));
      transport.publish({ type: 'notification', notification: { ...notification, target: { ...notification.target, hostId: 'other-host' } } });
      await session.getWorkspace();
      expect(seen).toHaveBeenCalledTimes(1);
    } finally { session.close(); await connector.dispose!(); }
  });

  const connect = (storage = vault()) => createRelayConnector(storage, host.relay);
  it('names a new pairing after what the laptop calls itself, and keeps the old name for laptops that do not say', async () => {
    const claimed = () => ({ pendingId: randomUUID(), state: 'awaitingApproval' });
    transport.response = (method) => method === 'pair.claim' ? claimed() : method === 'pair.status' ? { state: 'approved', grant: {}, hostName: '  Studio\u0000 Mac ' } : {};
    const named = connect(); await pairWith(named);
    expect(named.laptops).toEqual([{ id: host.hostId, name: 'Studio Mac' }]);
    transport.response = (method) => method === 'pair.claim' ? claimed() : method === 'pair.status' ? { state: 'approved', grant: {}, hostName: 42 } : {};
    const older = connect(); await pairWith(older);
    expect(older.laptops).toEqual([{ id: host.hostId, name: 'Paired laptop' }]);
    await named.dispose!(); await older.dispose!();
  });
  it('renames a laptop on the phone and keeps the name, but refuses a blank, overlong or unknown one', async () => {
    const storage = vault(); const connector = connect(storage); await pairWith(connector);
    await connector.rename!(host.hostId, '  Work Mac ');
    expect(connector.laptops).toEqual([{ id: host.hostId, name: 'Work Mac' }]);
    await expect(connector.rename!(host.hostId, '   ')).rejects.toThrow();
    await expect(connector.rename!(host.hostId, 'x'.repeat(61))).rejects.toThrow();
    await expect(connector.rename!('someone-else', 'Other')).rejects.toThrow();
    expect(connector.laptops).toEqual([{ id: host.hostId, name: 'Work Mac' }]);
    const restored = connect(storage); await restored.initialize!();
    expect(restored.laptops).toEqual([{ id: host.hostId, name: 'Work Mac' }]);
    await connector.dispose!(); await restored.dispose!();
  });
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
      const saved = storage.values.get('paired-hosts')!;
      expect(saved).not.toContain('allowLocalDevelopment');
      const production = { origin: 'wss://production.example', peerId: peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString() };
      for (const other of [host.relay, { ...config, origin: 'ws://other.local:47801' }, { ...config, peerId: host.hostId }, null, production]) {
        const resetStorage = vault(); resetStorage.values.set('paired-hosts', saved);
        const reset = createRelayConnector(resetStorage, other);
        transport.dial.mockClear();
        try {
          await reset.initialize!();
          expect(reset.laptops).toStrictEqual([]);
          expect(JSON.parse(resetStorage.values.get('paired-hosts')!)).toStrictEqual([]);
          expect(transport.dial).not.toHaveBeenCalled();
          if (other === production) {
            expect(await pairWith(reset)).toBe(host.hostId);
            expect(JSON.parse(resetStorage.values.get('paired-hosts')!)).toStrictEqual([
              { v: 1, relayOrigin: production.origin, relayPeerId: production.peerId, hostId: host.hostId, name: 'Paired laptop' },
            ]);
          }
        } finally { await reset.dispose!(); }
      }
    } finally { await connector.dispose!(); }
  });
  const agent = { id: 'agent', name: 'Agent', teamId: 'team', backend: 'codex', backendSession: { kind: 'codex', threadId: 'thread' }, status: { type: 'idle' }, folder: null, createdAt: '', updatedAt: '' };
  it('reads an image through the paired host and complete owning conversation target', async () => {
    const connector = connect(); await pairWith(connector);
    const image = { dataUrl: 'data:image/png;base64,cG5n' };
    transport.response = method => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'], remoteConnectionId: 'remote' }], agents: [agent] } : image;
    try {
      const session = await connector.connect(host.hostId); await session.getWorkspace();
      expect(await session.readImage!('agent', '/tmp/shot.png')).toStrictEqual(image);
      expect(transport.requests.at(-1)).toMatchObject({ method: 'conversation.image.read', args: {
        target: { hostId: host.hostId, locationId: 'remote', teamId: 'team', agentId: 'agent', sessionId: '{"kind":"codex","threadId":"thread"}' }, path: '/tmp/shot.png',
      } });
    } finally { await connector.dispose!(); }
  });
  it('receives large history pages from the pinned laptop and owning session', async () => {
    const connector = connect(); await pairWith(connector);
    const page = { frame: { type: 'codex.conversationSnapshotChanged', backend: 'codex', threadId: 'thread', agentId: 'agent', seq: 1, occurredAt: '', payload: { revision: 1, snapshot: { messages: [{ text: 'x'.repeat(companionFrameLimit) }] } } }, hasOlder: false };
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
  it('pins the introduced laptop, claims the code, and reuses the limited pinned circuit for approval polls', async () => {
    const diagnostics = vi.fn(); setConnectionDiagnosticSink(diagnostics);
    const connector = connect();
    const address = `/dns4/relay.example/tcp/443/tls/ws/p2p/${host.relay.peerId}/p2p-circuit/p2p/${host.hostId}`;
    const streamFactory = transport.dial.getMockImplementation()!;
    const wrongPath = vi.fn(); const reused = vi.fn(streamFactory);
    transport.connections.push({ status: 'open', remoteAddr: { toString: () => `${address}/other` }, newStream: wrongPath },
      { id: 'circuit', status: 'open', remoteAddr: { toString: () => address }, limits: { bytes: 67108864n, seconds: 120 }, newStream: reused });
    try {
      const pending = vi.fn();
      expect(await connector.pair!(' k7qd m2xp ', 'Phone', pending)).toBe(host.hostId);
      expect(transport.rendezvous).toStrictEqual([{ code: 'K7QDM2XP' }]);
      expect(transport.requests.map((request) => request.method)).toStrictEqual(['pair.claim', 'pair.status']);
      expect(reused).toHaveBeenCalledTimes(2);
      expect(reused).toHaveBeenCalledWith(['/workspace/companion/2.0.0', '/workspace/companion/1.0.0'], expect.objectContaining({ runOnLimitedConnection: true }));
      expect(wrongPath).not.toHaveBeenCalled(); expect(transport.dial).toHaveBeenCalledTimes(1);
      expect(pending).toHaveBeenCalledOnce();
      expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ event: 'transport.stream-open', reused: true, connectionId: 'circuit', remainingBytes: '67108864', remainingSeconds: 120 }));
    } finally { setConnectionDiagnosticSink(undefined); await connector.dispose!(); }
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
      await session.setActive!(false);
      expect(transport.requests.filter(request => request.method === 'snapshot.get').at(-1)?.args.notifications).toBe(false);
      await session.setActive!(true);
      await vi.advanceTimersByTimeAsync(0); // Presence completes independently of foreground liveness.
      expect(transport.requests.filter(request => request.method === 'snapshot.get').at(-1)?.args.notifications).toBe(true);
      expect(await session.loadConversation('agent')).toStrictEqual(next);
      expect(transport.requests.filter(request => request.method === 'conversation.subscribe')).toHaveLength(1);
      expect(disconnected).not.toHaveBeenCalled();
      transport.endUpdates(); await vi.advanceTimersByTimeAsync(0);
      expect(disconnected).toHaveBeenCalledOnce();
      expect(transport.requests.some((request) => request.method === 'prompt.submit')).toBe(false);
      stop(); await connector.suspend!();
    } finally { await connector.dispose!(); vi.useRealTimers(); }
  });
  it('finishes a streamed Claude turn and keeps the completed reply when selected again', async () => {
    const connector = connect();
    try {
      await pairWith(connector);
      const claude = { ...agent, backend: 'claude', backendSession: { kind: 'claude', sessionId: 'session' } };
      const snapshot = { agentId: agent.id, sessionId: 'session', activeTurnId: null, turnIds: [], turns: [], messages: [], answeredClientRequestIds: [], busy: false,
        historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null };
      const frame = { type: 'claude.conversationSnapshotChanged', agentId: agent.id, backend: 'claude', seq: 1, occurredAt: '2026-10-14T00:00:00Z', payload: { revision: 1, snapshot } };
      transport.response = (method) => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [claude] } : frame;
      const session = await connector.connect(host.hostId); await session.getWorkspace();
      const update = vi.fn(); const disconnected = vi.fn(); session.onUpdate!(update); session.onDisconnect(disconnected);
      await session.loadConversation('agent');
      for (const [index, event] of [
        { type: 'turn.started', payload: { turn: { id: 'turn', backend: 'claude' } } },
        { type: 'message.delta', payload: { itemId: 'answer', delta: 'The completed Claude answer.' } },
        { type: 'turn.completed', payload: { turn: { id: 'turn', status: 'completed' } } },
      ].entries()) transport.publish({ type: 'conversation', frame: { ...frame, type: 'claude.conversationEventReceived', seq: index + 2, payload: {
        revision: index + 2, event: { ...event, agentId: 'agent', backend: 'claude', backendSessionId: 'session', turnId: 'turn', seq: index + 2, occurredAt: '2026-10-14T00:00:01Z' },
      } } });
      await vi.waitFor(() => expect(update.mock.calls.at(-1)?.[1]?.payload.revision).toBe(4));
      expect(disconnected).not.toHaveBeenCalled();
      session.deselectConversation!();
      const completed = await session.loadConversation('agent');
      expect(completed?.payload.snapshot).toMatchObject({ busy: false, activeTurnId: null, messages: [expect.objectContaining({ status: 'complete', parts: [{ type: 'text', itemId: 'answer', text: 'The completed Claude answer.' }] })] });
      const older = { id: 'older', agentId: 'agent', role: 'user', status: 'complete', createdAt: '', parts: [{ type: 'text', text: 'Earlier question' }] };
      const pageFrame = { ...frame, type: 'claude.conversationEventReceived', seq: 5, payload: { revision: 5, event: { seq: 5, occurredAt: '', agentId: 'agent', backend: 'claude', backendSessionId: 'session', type: 'history.prepended', payload: { messages: [older], hasOlder: false } } } };
      const chunk = { data: 'e30=', nextOffset: null, totalBytes: 2 };
      transport.response = (method) => method === 'conversation.loadOlder' ? { frame: pageFrame, hasOlder: false } : chunk;
      const page = await session.loadOlderHistory!('agent');
      expect(page.frame.payload.snapshot.messages).toEqual([older, ...completed!.payload.snapshot.messages]);
      const input = { sessionId: 'session', contentId: 'a'.repeat(64), offset: 0 };
      expect(await session.readConversationContent!('agent', input)).toStrictEqual(chunk);
      expect(transport.requests.at(-1)).toMatchObject({ method: 'conversation.content.read', args: { target: { agentId: 'agent' }, input } });
      session.close();
      await expect(session.readConversationContent!('agent', input)).rejects.toThrow('Disconnected');
    } finally { await connector.dispose!(); }
  });
  it('keeps repository icons across workspace updates and asks the laptop for them only when its copy is stale', async () => {
    const connector = connect(); await pairWith(connector);
    const session = await connector.connect(host.hostId);
    transport.response = () => ({ teams: [], agents: [], iconsVersion: 'v1', repositoryIcons: { '/r': 'GEAR' } });
    expect(await session.getWorkspace()).toMatchObject({ repositoryIcons: { '/r': 'GEAR' } });
    transport.response = () => ({ teams: [], agents: [], iconsVersion: 'v1' });
    expect(await session.getWorkspace()).toMatchObject({ repositoryIcons: { '/r': 'GEAR' } });
    expect(transport.requests.filter((request) => request.method === 'snapshot.get').map((request) => request.args)).toStrictEqual([{ iconsVersion: '', notifications: true }, { iconsVersion: 'v1', notifications: true }]);
    session.close(); await connector.dispose!();
  });
  it('lists models, saves a model choice and sends composer options with a prompt', async () => {
    const connector = connect(); await pairWith(connector);
    const skill = { name: 'review', path: '/skills/review/SKILL.md', enabled: true };
    transport.response = (method) => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [agent] } : method === 'models.list' ? { models: [{ id: 'm', model: 'm', displayName: 'M' }] } : method === 'plugins.list' ? { plugins: [{ id: 'github', name: 'github', displayName: 'GitHub', enabled: true }] } : method === 'skills.list' ? { skills: [skill] } : { state: 'accepted' };
    const session = await connector.connect(host.hostId); await session.getWorkspace();
    expect(await session.listModels!('agent')).toStrictEqual([{ id: 'm', model: 'm', displayName: 'M' }]);
    expect(await session.listSkills!('agent')).toStrictEqual([skill]);
    expect(transport.requests.at(-1)).toMatchObject({ method: 'skills.list', args: { hostId: host.hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) } });
    expect(await session.listPlugins!('agent')).toStrictEqual([{ id: 'github', name: 'github', displayName: 'GitHub', enabled: true }]);
    expect(transport.requests.at(-1)).toMatchObject({ method: 'plugins.list', args: { hostId: host.hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) } });
    await session.selectModel!('agent', {backend: 'codex',  model: 'm', reasoningEffort: 'high', serviceTier: null });
    const selectedTarget = { hostId: host.hostId, locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) };
    await session.sendPrompt(selectedTarget, 'Go', randomUUID(), { planMode: true, selection: { model: 'm' } }, [{ type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', data: 'AAAA' }]);
    expect(transport.requests.find((request) => request.method === 'models.list')?.args).toStrictEqual(selectedTarget);
    expect(transport.requests.find((request) => request.method === 'agent.model.select')?.args).toStrictEqual({ target: selectedTarget, selection: { backend: 'codex', model: 'm', reasoningEffort: 'high', serviceTier: null } });
    expect(transport.requests.find((request) => request.method === 'prompt.submit')?.args).toMatchObject({ target: selectedTarget, text: 'Go', options: { planMode: true, selection: { model: 'm' } }, attachments: [{ name: 'photo.jpg', data: 'AAAA' }] });
    await session.gitDiff!('agent', { type: 'staged' });
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.git.diff', args: { target: selectedTarget, scope: { type: 'staged' } } });
    await session.previewFile!('agent', { path: 'src/app.ts', action: 'edit', turnId: 'turn' });
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.file.preview', args: { target: selectedTarget, input: { path: 'src/app.ts', action: 'edit', turnId: 'turn' } } });
    await session.startReview!(selectedTarget, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.review.start', args: { target: selectedTarget, input: { scope: { type: 'uncommitted' }, threadMode: 'independent' } } });
    await session.interrupt!('agent'); await session.setApprovalPreset!('agent', 'full-access'); await session.setPermissionMode!('agent', 'acceptEdits');
    expect(transport.requests.filter((request) => /^agent\.(interrupt|approvalPreset|permissionMode)/.test(request.method)).map((request) => [request.method, request.args]))
      .toStrictEqual([['agent.interrupt', selectedTarget], ['agent.approvalPreset.set', { target: selectedTarget, preset: 'full-access' }], ['agent.permissionMode.set', { target: selectedTarget, mode: 'acceptEdits' }]]);
    await session.renameAgent!(selectedTarget, 'Mobile work');
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.rename', args: { target: selectedTarget, name: 'Mobile work' } });
    await session.restartSession!('agent');
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.restart', args: selectedTarget });
    await session.previewCloseSession!('agent');
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.close.preview', args: selectedTarget });
    const input = { deleteWorktree: true as const, deleteRemoteBranch: false, discardChanges: true, confirmed: true as const };
    await session.closeSession!(selectedTarget, input);
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.close', args: { target: selectedTarget, input } });
    transport.response = method => method === 'team.create' ? { teamId: 'mobile-team' } : {};
    expect(await session.createTeam!('Mobile team')).toBe('mobile-team');
    expect(transport.requests.at(-1)).toStrictEqual({ v: 1, id: expect.any(String), method: 'team.create', args: { name: 'Mobile team' } });
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
    const identity = storage.values.get('device-identity');
    const restored = connect(storage);
    storage.read.mockRejectedValueOnce(new Error('Device storage locked'));
    const engine = createEngine({ connector: restored, initialActive: false, post: () => {} });
    try {
      await engine.start();
      expect(engine.snapshot().startup).toBe('error');
      expect(storage.values.get('paired-hosts')).toBe(saved);
      transport.response = () => ({ teams: [], agents: [] });
      await engine.dispatch({ type: 'activity', active: true });
      expect(engine.snapshot()).toMatchObject({ startup: 'ready', connection: 'connected', laptopId: host.hostId,
        laptops: [{ id: host.hostId, name: 'Paired laptop' }] });
      expect(storage.values.get('paired-hosts')).toBe(saved);
      expect(storage.values.get('device-identity')).toBe(identity);
    } finally { engine.dispose(); await connector.dispose!(); await restored.dispose!(); }
  });
  it('refuses malformed or unavailable codes and never saves a host before approval', async () => {
    const storage = vault(); const connector = connect(storage);
    await expect(pairWith(connector, 'K7QD-M2X')).rejects.toThrow('codeFormat');
    expect(transport.dial).not.toHaveBeenCalled();
    transport.known = 'ABCDEFGH';
    await expect(pairWith(connector)).rejects.toThrow('noLaptop');
    transport.known = 'K7QDM2XP';
    transport.response = () => { throw new Error('Pairing denied'); };
    await expect(pairWith(connector)).rejects.toThrow('Pairing denied');
    expect(transport.requests.map(request => request.method)).toStrictEqual(['pair.claim']);
    expect(storage.values.get('paired-hosts')).toBeUndefined();
    await connector.dispose!();
    await expect(createRelayConnector(vault(), null).pair!('K7QD-M2XP', 'Phone', () => {})).rejects.toThrow('noRelay');
  });
  it('reconnects using the saved laptop pin without asking the relay for another identity', async () => {
    const storage = vault(); const first = connect(storage);
    const pinnedHost = host.hostId;
    await pairWith(first); await first.dispose!();
    host = await laptop(); // Even a changed relay introduction must not replace the saved laptop.
    const saved = JSON.parse(storage.values.get('paired-hosts')!)[0];
    const restored = createRelayConnector(storage, { origin: saved.relayOrigin, peerId: saved.relayPeerId });
    const lookups = transport.rendezvous.length;
    transport.response = () => ({ teams: [], agents: [] });
    try {
      const session = await restored.connect(pinnedHost);
      await session.getWorkspace();
      expect(transport.rendezvous).toHaveLength(lookups);
      expect(transport.dial.mock.calls.at(-1)![0].toString()).toContain(`/p2p-circuit/p2p/${pinnedHost}`);
      expect(storage.values.get('paired-hosts')).not.toContain('K7QD');
      session.close();
    } finally { await restored.dispose!(); }
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
    const remoteTarget = { hostId: host.hostId, locationId: 'remote-host', teamId: 'team', agentId: 'agent', sessionId: JSON.stringify(agent.backendSession) };
    const commandId = randomUUID(); await session.sendPrompt(remoteTarget, 'Reply once', commandId);
    expect(transport.requests.find((request) => request.method === 'prompt.submit')?.args).toMatchObject({ clientCommandId: commandId, target: remoteTarget });
    expect(await session.commandStatus!(commandId)).toBe('accepted');
    await expect(session.loadConversation('foreign')).rejects.toThrow('scope');
    await connector.revoke(host.hostId);
    expect(connector.laptops).toEqual([]); expect(storage.values.get('paired-hosts')).toBe('[]');
    await expect(session.sendPrompt(remoteTarget, 'Again')).rejects.toThrow('Disconnected');
    expect(transport.requests.some((request) => request.method === 'device.forget')).toBe(true);
    await connector.dispose!(); expect(transport.stop).toHaveBeenCalledOnce();
  });
  it('preserves the captured goal target rather than retargeting to a changed session', async () => {
    const connector = connect(); await pairWith(connector);
    try {
      const session = await connector.connect(host.hostId);
      const target = { hostId: host.hostId, locationId: 'remote', teamId: 'team', agentId: 'agent', sessionId: 'original' };
      await session.changeGoal!(target, 'Ship');
      await session.changeGoal!(target, null);
      expect(transport.requests.filter(call => call.method === 'agent.goal.set').map(call => call.args)).toStrictEqual([
        { target, objective: 'Ship' }, { target, objective: null },
      ]);
      session.close();
      await expect(session.changeGoal!(target, 'Again')).rejects.toThrow('Disconnected');
    } finally { await connector.dispose!(); }
  });
  it('loads branch choices for the requested team and repository over the paired connection', async () => {
    const connector = connect(vault()); await pairWith(connector);
    const branches = [{ name: 'feature', isDefault: false, isCheckedOut: true }];
    transport.response = (method) => method === 'repository.branches' ? branches : {};
    const session = await connector.connect(host.hostId);
    expect(await session.listBranches!('team', 'repo')).toStrictEqual(branches);
    expect(transport.requests.find((request) => request.method === 'repository.branches')?.args).toStrictEqual({ teamId: 'team', repositoryId: 'repo' });
    await connector.dispose!();
  });
  it('asks the laptop how a new chat is going until it is ready, reports why it failed and changes its engine', async () => {
    const connector = connect(vault()); await pairWith(connector);
    const answers: unknown[] = [{ state: 'running' }, { state: 'running' }, { state: 'success', agentId: 'new-chat' }];
    transport.response = (method) => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: [] }], agents: [] }
      : method === 'agent.create' ? { creationId: 'creation' } : method === 'agent.create.status' ? answers.shift() : {};
    const session = await connector.connect(host.hostId); await session.getWorkspace();
    vi.useFakeTimers();
    try {
      const chat = { teamId: 'team', repositoryId: 'repo', worktree: { branchName: 'feature' }, selection: { backend: 'claude' as const } };
      const created = session.createChat!(chat);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await created).toBe('new-chat');
      expect(transport.requests.find((request) => request.method === 'agent.create')?.args).toStrictEqual(chat);
      expect(transport.requests.filter((request) => request.method === 'agent.create.status')).toHaveLength(3);
      answers.push({ state: 'error', error: 'Branch exists' });
      const failed = expect(session.createChat!(chat)).rejects.toThrow('Branch exists');
      await vi.advanceTimersByTimeAsync(1000);
      await failed;
    } finally { vi.useRealTimers(); }
    answers.push({ state: 'success', agentId: 'quick-chat' });
    transport.response = (method) => method === 'agent.quickChat.create' ? { creationId: 'quick' } : method === 'agent.create.status' ? answers.shift() : {};
    vi.useFakeTimers();
    try {
      const quick = session.createQuickChat!({ teamId: 'team', backend: 'claude' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await quick).toBe('quick-chat');
    } finally { vi.useRealTimers(); }
    expect(transport.requests.find((request) => request.method === 'agent.quickChat.create')?.args).toStrictEqual({ teamId: 'team', backend: 'claude' });
    const projectRepositories = [{ id: 'org/repo', name: 'org/repo' }];
    transport.response = method => method === 'project.github.list' ? projectRepositories : method === 'project.create' ? { creationId: 'project' } : { state: 'success', agentId: 'project-agent' };
    expect(await session.githubRepositories!('team')).toStrictEqual(projectRepositories);
    expect(transport.requests.at(-1)?.args).toStrictEqual({ teamId: 'team' });
    const projectBranches = [{ name: 'main', isDefault: true }];
    transport.response = method => method === 'project.github.branches' ? projectBranches : method === 'project.create' ? { creationId: 'project' } : { state: 'success', agentId: 'project-agent' };
    expect(await session.githubBranches!('team', 'org/repo')).toStrictEqual(projectBranches);
    expect(transport.requests.at(-1)?.args).toStrictEqual({ teamId: 'team', repositoryId: 'org/repo' });
    transport.response = method => method === 'project.repositories.list' ? [{ id: 'repo:opaque', name: 'group/subgroup/repo' }] : projectBranches;
    expect(await session.repositoryCatalog!('team', 'gitlab')).toStrictEqual([{ id: 'repo:opaque', name: 'group/subgroup/repo' }]);
    expect(transport.requests.at(-1)).toMatchObject({ method: 'project.repositories.list', args: { teamId: 'team', provider: 'gitlab' } });
    expect(await session.repositoryBranches!('team', 'gitlab', 'repo:opaque')).toStrictEqual(projectBranches);
    expect(transport.requests.at(-1)).toMatchObject({ method: 'project.repositories.branches', args: { teamId: 'team', provider: 'gitlab', repositoryId: 'repo:opaque' } });
    transport.response = method => method === 'project.create' ? { creationId: 'project' } : { state: 'success', agentId: 'project-agent' };
    const projectInput = { teamId: 'team', source: 'github' as const, value: 'org/repo', branch: 'feature/mobile', selection: { backend: 'claude' as const } };
    expect(await session.createProject!(projectInput)).toBe('project-agent');
    expect(transport.requests.find(request => request.method === 'project.create')?.args).toStrictEqual(projectInput);
    transport.response = method => method === 'project.local.list' ? [{ id: 'opaque-repository', name: 'Local repository' }]
      : method === 'project.local.branches' ? projectBranches : method === 'agent.duplicate' ? { agentId: 'duplicate-agent' } : {};
    expect(await session.localRepositories!('team')).toStrictEqual([{ id: 'opaque-repository', name: 'Local repository' }]);
    expect(transport.requests.at(-1)).toMatchObject({ method: 'project.local.list', args: { teamId: 'team' } });
    expect(await session.localBranches!('team', 'opaque-repository')).toStrictEqual(projectBranches);
    expect(transport.requests.at(-1)).toMatchObject({ method: 'project.local.branches', args: { teamId: 'team', repositoryId: 'opaque-repository' } });
    const duplicateTarget = { hostId: host.hostId, locationId: 'local', teamId: 'team', agentId: agent.id, sessionId: null };
    expect(await session.duplicateAgent!(duplicateTarget, 'claude')).toBe('duplicate-agent');
    expect(transport.requests.at(-1)).toMatchObject({ method: 'agent.duplicate', args: { target: duplicateTarget, backend: 'claude' } });
    transport.response = (method) => method === 'snapshot.get' ? { teams: [{ id: 'team', name: 'Team', agentIds: ['new-chat'] }], agents: [{ ...agent, id: 'new-chat', backendSession: undefined }] } : {};
    await session.getWorkspace();
    await session.setBackend!('new-chat', 'claude');
    expect(transport.requests.find((request) => request.method === 'agent.backend.set')?.args).toStrictEqual({ target: { hostId: host.hostId, locationId: 'local', teamId: 'team', agentId: 'new-chat', sessionId: null }, backend: 'claude' });
    await connector.dispose!();
  });
});

it('retains paired-host conversations across reconnects and uses checkpoints only when the host advertises support', async () => {
  const connector = createRelayConnector(vault(), host.relay);
  await pairWith(connector);
  const claude = { id: 'agent', teamId: 'team', backend: 'claude', backendSession: { kind: 'claude', sessionId: 'session' } };
  const workspace = { conversationSync: true, teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [claude] };
  const snapshot = { agentId: 'agent', sessionId: 'session', activeTurnId: null, turnIds: [], turns: [], messages: [], answeredClientRequestIds: [], busy: false, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null };
  const frame = { type: 'claude.conversationSnapshotChanged', backend: 'claude', agentId: 'agent', seq: 1, occurredAt: 'now', payload: { revision: 1, snapshot } };
  transport.response = (method, args) => {
    if (method === 'snapshot.get') return workspace;
    if (method === 'conversation.synchronize') {
      if (!args.checkpoint) transport.publish({ type: 'conversation', frame });
      return { checkpoint: { epoch: 'host-generation', revision: args.checkpoint?.revision ?? 1 } };
    }
    return {};
  };
  try {
    const first = await connector.connect(host.hostId); await first.getWorkspace(); await first.loadConversation('agent');
    transport.publish({ type: 'conversation', frame: { ...frame, type: 'claude.conversationEventReceived', seq: 2, payload: { revision: 2, event: { type: 'turn.started', seq: 2, agentId: 'agent', backend: 'claude', backendSessionId: 'session', turnId: 'live-turn', occurredAt: 'now', payload: { turn: { id: 'live-turn', backend: 'claude' } } } } } });
    await vi.waitFor(() => expect(first.cachedConversation!('agent')?.payload.revision).toBe(2));
    first.close();
    const second = await connector.connect(host.hostId); await second.getWorkspace();
    expect(second.cachedConversation!('agent')?.payload.snapshot.activeTurnId).toBe('live-turn');
    await second.loadConversation('agent');
    first.close(); // A delayed close from the old connection must not suspend the new cache.
    expect(second.isConversationCurrent!('agent')).toBe(true);
    const syncs = transport.requests.filter(request => request.method === 'conversation.synchronize');
    expect(syncs.map(call => call.args.checkpoint)).toStrictEqual([null, { epoch: 'host-generation', revision: 2 }]);
    expect(transport.requests.some(call => call.method === 'conversation.subscribe')).toBe(false);
    second.close();
    await connector.revoke(host.hostId);
    expect(connector.cachedConversation!({ hostId: host.hostId, teamId: 'team', locationId: 'local', agentId: 'agent', sessionId: JSON.stringify({ kind: 'claude', sessionId: 'session' }) })).toBeUndefined();
  } finally { await connector.dispose!(); }
});
