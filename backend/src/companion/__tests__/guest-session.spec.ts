import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { createServer } from 'node:net';
import type { Stream } from '@libp2p/interface';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { Agent, ProviderConversationFrame } from '@workspace/core/contracts';
import type { CompanionReset } from '@workspace/core/companion-protocol';
import { encodeCompanionFrame, readCompanionFrames } from '@workspace/core/companion-protocol';
import { decodeConversationShareLink, conversationShareTarget } from '@workspace/core/conversation-sharing';
import { emptyAntigravitySnapshot } from '@workspace/core/antigravity-conversation-replica';
import { ConversationShares } from '../../sharing/conversation-shares';
import { GuestConversationGateway } from '../../sharing/guest-gateway';
import { GuestJoins } from '../../sharing/guest-joins';
import { encodeConversationShareLink } from '@workspace/core/conversation-sharing';
import { GuestConversationClient } from '../../sharing/guest-client';
import { GuestConversationTransport } from '../../sharing/guest-transport';
import { CompanionManager } from '../manager';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { CompanionOutboundConnector } from '../connector';
import { CompanionGateway } from '../gateway';
import { ConversationSource } from '../conversation-source';
import { createCompanionRelay } from '../relay';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { sdkSnapshot } from '../../codex/__tests__/sdk-surface-fixture';
import { AppBackendServer } from '../../server';

vi.mock('../../log', () => ({ logMain: vi.fn(), warnMain: vi.fn() }));
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const stop of cleanup.reverse()) await stop(); cleanup.length = 0; });
// Failure modes: a bearer is claimed once; foreign targets or phone operations leak data;
// async reads/event replay outlive revocation; cached pages cross sessions; slow peers grow queues.
async function fixture(backend: Agent['backend'] = 'claude', submit?: (target: import('@workspace/core/conversation-sharing').ConversationShareTarget, text: string) => Promise<{ turnId: string; messageId: string }>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-boundary-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const relay = await createCompanionRelay({ key: await generateKeyPair('Ed25519'), listen: `/ip4/127.0.0.1/tcp/${await freePort()}/ws` }); cleanup.push(() => relay.stop());
  const address = relay.getMultiaddrs()[0]!.toString();
  const pin = { origin: `ws://127.0.0.1:${/\/tcp\/(\d+)/.exec(address)![1]}`, peerId: relay.peerId.toString() };
  const key = await generateKeyPair('Ed25519'); const ownerId = peerIdFromPrivateKey(key).toString();
  const snapshot = createTestSnapshot();
  const agent: Agent = { id: 'shared', name: 'Synthetic shared chat', teamId: 'team-test', backend, folder: '/fixture', backendSession: backend === 'codex' ? { kind: 'codex', threadId: 'bound' } : backend === 'claude' ? { kind: 'claude', sessionId: 'bound', transport: 'stdio' } : { kind: 'antigravity', sessionId: 'bound' }, status: { type: 'idle' }, createdAt: 'now', updatedAt: 'now' };
  snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = ['shared'];
  let shareChanged: (agentId: string, state: import('@workspace/core/conversation-sharing').ConversationShareState) => void = () => {};
  const shares = new ConversationShares({ directory: path.join(directory, 'shares'), endpoint: async () => ({ ownerId, relay: pin }), submit, canSubmit: () => !['working', 'awaitingInput'].includes(agent.status.type) }, () => snapshot, (agentId, state) => shareChanged(agentId, state)); cleanup.push(() => shares.close());
  const target = conversationShareTarget(agent)!;
  const handles: string[] = [];
  const created = await shares.control({ action: 'create', target }); const link = decodeConversationShareLink(created.link!, pin)!; handles.push(link.handle);
  const listeners = new Set<(event: AppBackendEvent) => void>();
  let revision = 1; let messages = [message('before-share')]; let blocked: (() => Promise<void>) | undefined;
  const reset = (): CompanionReset => ({ type: `${backend}.conversationSnapshotChanged`, backend, agentId: agent.id, threadId: backend === 'codex' ? 'bound' : undefined, backendSessionId: backend === 'codex' ? undefined : 'bound', conversationId: 'bound', seq: revision, occurredAt: 'now', payload: { revision,
    snapshot: backend === 'codex' ? sdkSnapshot('bound', { messages: messages as never, conversations: [{ id: 'PRIVATE_OTHER_CHAT' }] as never, queuedPrompts: [{ text: 'PRIVATE_QUEUED' }] as never }) : backend === 'antigravity' ? { ...emptyAntigravitySnapshot(agent.id, 'bound'), messages } : { agentId: agent.id, sessionId: 'bound', activeTurnId: null, turnIds: [], turns: [], messages, answeredClientRequestIds: [], busy: false, historyLoading: false, historyState: { hasOlder: true, loadingOlder: false }, contextUsage: null, plan: null, error: null },
  } }) as CompanionReset;
  const source = new ConversationSource(async id => {
    await blocked?.(); const frame = reset();
    if (id !== agent.id && frame.type === 'claude.conversationSnapshotChanged') {
      const other = snapshot.agents.find(candidate => candidate.id === id)!; const sessionId = other.backendSession!.kind === 'claude' ? other.backendSession!.sessionId : '';
      frame.agentId = id; frame.backendSessionId = sessionId; frame.conversationId = sessionId; frame.payload.snapshot = { ...frame.payload.snapshot, agentId: id, sessionId };
    }
    emit(frame);
  });
  function emit(event: AppBackendEvent) { source.observe(event); for (const listener of listeners) listener(event); }
  shareChanged = (agentId, state) => emit({ type: 'conversation.shareChanged', agentId, payload: state, seq: revision, occurredAt: 'now' });
  const port = {
    propose: (handle: string, peer: string, name: string, input: { id: string; text: string }) => shares.propose(handle, peer, name, input),
    proposals: (handle: string, peer: string) => shares.guestState(handle, peer),
    withdraw: (handle: string, peer: string, proposalId: string) => shares.withdraw(handle, peer, proposalId),
    authorize: (handle: string, credential: string) => shares.authorize(handle, credential),
    connected: (handle: string, count: number) => shares.connected(handle, count),
    onEvent: (listener: (event: AppBackendEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    synchronize: (id: string, checkpoint: Parameters<ConversationSource['synchronize']>[1]) => source.synchronize(id, checkpoint),
    conversation: (id: string) => source.read(id),
    loadOlderHistory: vi.fn(async () => {
      await blocked?.(); const older = Array.from({ length: 120 }, (_, i) => message(`old-${i}`)); messages = [...older, ...messages]; revision++;
      if (backend === 'claude') {
        const frame = { ...reset(), type: 'claude.conversationEventReceived', payload: { revision, event: { type: 'history.prepended', agentId: 'shared', backend: 'claude', backendSessionId: 'bound', seq: revision, occurredAt: 'now', payload: { messages: older, hasOlder: false } } } } as Extract<ProviderConversationFrame, { type: 'claude.conversationEventReceived' }>;
        emit(frame); return { frame, hasOlder: false };
      }
      emit(reset()); return { hasOlder: false };
    }),
    readConversationContent: vi.fn(async () => { await blocked?.(); return { data: 'expanded transcript', nextOffset: null, totalBytes: 19 }; }),
    readImage: vi.fn(async () => { await blocked?.(); return { dataUrl: 'data:image/png;base64,YQ==' }; }),
  };
  const gateway = new GuestConversationGateway(port);
  const phone = { grants: [], pairingInvitations: () => [] } as unknown as CompanionGateway;
  const connector = new CompanionOutboundConnector(key, phone, { phoneEnabled: () => false, sharing: { handles: () => handles, accept: (stream, peer) => gateway.accept(stream, peer) } }); cleanup.push(() => connector.stop());
  await connector.start(pin.origin, pin.peerId);
  const transports = new Map<number, GuestConversationTransport>();
  async function open(route = link, identity?: number) { let transport = identity === undefined ? undefined : transports.get(identity); if (!transport) { transport = new GuestConversationTransport(await generateKeyPair('Ed25519'), pin); cleanup.push(() => transport!.stop()); if (identity !== undefined) transports.set(identity, transport); } const opened = await transport.open(route); if (opened.status !== 'ready') throw new Error(opened.status); return opened.stream; }
  async function client(name = ' Alex ', route = link, identity?: number) { const stream = await open(route, identity); const client = new GuestConversationClient(stream); cleanup.push(() => client.close()); const joined = await client.join(route, name); return { client, joined }; }
  return { manyReferences: () => { messages = [{ ...message('many-media'), parts: [{ type: 'text', text: Array.from({ length: 2049 }, (_, index) => `![image](/fixture/${index}.png)`).join('\n') }] }]; revision++; }, forgetMedia: () => { messages = [message('recent-only')]; revision++; source.clear(); }, addLink: async (index: number) => {
    const other = { ...agent, id: `shared-${index}`, backendSession: { kind: 'claude' as const, sessionId: `bound-${index}`, transport: 'stdio' as const } }; snapshot.agents.push(other);
    const value = await shares.control({ action: 'create', target: conversationShareTarget(other)! });
    const route = decodeConversationShareLink(value.link!, pin)!; handles.push(route.handle); await connector.advertise(); return route;
  }, delta: (gap = false) => {
    messages.push(message(gap ? 'after-gap' : 'delta')); revision += gap ? 3 : 1;
    const event = backend === 'codex' ? { type: 'message.appended', origin: 'notification', conversationId: 'bound', seq: revision, occurredAt: 'now', payload: { message: messages.at(-1) } }
      : backend === 'claude' ? { type: 'message.userSubmitted', agentId: 'shared', backendSessionId: 'bound', seq: revision, occurredAt: 'now', payload: { message: messages.at(-1) } }
      : { type: 'message.upsert', agentId: 'shared', sessionId: 'bound', turnId: 'turn', occurredAt: 'now', payload: { message: messages.at(-1) } };
    emit({ ...reset(), type: `${backend}.conversationEventReceived`, payload: { revision, event } } as ProviderConversationFrame);
  }, directory, pin, connector, gateway, shares, target, link, snapshot, port, listeners, client, open, emit, reset, source, block: (work?: () => Promise<void>) => { blocked = work; }, addMedia: () => { messages.push({ ...message('media'), parts: [{ type: 'text', text: '![image](/fixture/output.png)' }], deferredContent: { contentId: 'a'.repeat(64), byteLength: 19 } } as never); revision++; }, live: () => { messages.push(message('live')); revision++; emit(reset()); }, replace: () => { agent.backendSession = backend === 'codex' ? { kind: 'codex', threadId: 'OTHER' } : backend === 'claude' ? { kind: 'claude', sessionId: 'OTHER', transport: 'stdio' } : { kind: 'antigravity', sessionId: 'OTHER' }; void shares.reconcile(); } };
}
function message(id: string) { return { id, agentId: 'shared', role: 'user' as const, status: 'complete' as const, parts: [{ type: 'text' as const, text: id }], createdAt: '2026-01-01T00:00:00Z' }; }
async function freePort() { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port; }
async function wire(stream: Stream) { const frames = readCompanionFrames(stream, 5 * 1024 * 1024)[Symbol.asyncIterator](); return async (method: string, args: unknown) => { const id = randomUUID(); stream.send(encodeCompanionFrame({ v: 1, id, method, args })); for (;;) { const next = await frames.next(); if (next.done) throw new Error('closed'); const value = next.value as { id?: string; result?: unknown; error?: string }; if (value.id === id) return value; } }; }

describe('encrypted guest conversation authorization', () => {
  it('joins into team Quick Chats without local provider execution and reopens the original team', async () => {
    const f = await fixture('codex');
    const joins = new GuestJoins({ directory: path.join(f.directory, 'quick-chat-guest'), relay: f.pin });
    const snapshot = createTestSnapshot(); snapshot.agents = []; snapshot.teams[0]!.agentIds = [];
    snapshot.teams.push({ ...snapshot.teams[0]!, id: 'another-team', name: 'Another team', agentIds: [] });
    const server = new AppBackendServer({ version: 'test', snapshot, guestJoins: joins }); cleanup.push(() => server.close());
    const call = async (input: unknown) => {
      const response = await server.handleMessage({ jsonrpc: '2.0', id: 'guest', method: backendMethods.guestConversationControl, params: { input } });
      if (!response || 'error' in response) throw new Error(JSON.stringify(response));
      return response.result as import('@workspace/core/guest-navigation').GuestJoinState;
    };
    const invitation = `KORUS1.${Buffer.from(JSON.stringify(f.link)).toString('base64url')}`;
    const prepared = await call({ action: 'prepare', link: invitation, teamId: 'team-test' });
    expect(prepared.view?.status).toBe('needsName');
    const canceled = await call({ action: 'cancel', id: prepared.view!.id });
    expect(canceled).toStrictEqual({ entries: [], view: null });
    expect(snapshot.agents).toStrictEqual([]);
    await expect(call({ action: 'join', id: prepared.view!.id, name: 'Alex' })).rejects.toThrow();
    const retried = await call({ action: 'prepare', link: invitation, teamId: 'team-test' });
    expect(retried.view?.id).toBe(prepared.view!.id);
    await call({ action: 'join', id: prepared.view!.id, name: 'Alex' });
    await call({ action: 'join', id: prepared.view!.id, name: 'Alex' });
    await call({ action: 'cancel', id: prepared.view!.id });
    await vi.waitFor(async () => expect((await call({ action: 'state' })).view?.status).toBe('ready'));
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0]).toMatchObject({ teamId: 'team-test', sessionKind: 'quickChat', sharedConversation: { joinId: prepared.view!.id } });
    expect(snapshot.agents[0]!.backendSession).toBeUndefined();
    const suggestion = { id: randomUUID(), text: 'A suggestion to withdraw' };
    await call({ action: 'propose', id: prepared.view!.id, proposalId: suggestion.id, text: suggestion.text });
    const withdrawn = await call({ action: 'withdraw', id: prepared.view!.id, proposalId: suggestion.id });
    expect(withdrawn.view?.proposalState?.proposals).toContainEqual(expect.objectContaining({ id: suggestion.id, status: 'dismissed', text: '' }));
    for (const method of [backendMethods.agentPromptSend, backendMethods.clientWorkspaceApply, backendMethods.clientDocumentRead]) {
      const denied = await server.handleMessage({ jsonrpc: '2.0', id: 'denied', method, params: { agentId: snapshot.agents[0]!.id, prompt: 'Must not execute locally', change: { upsert: [] }, tabId: 'private-file' } });
      expect(denied).toHaveProperty('error');
    }
    snapshot.activeTeamId = 'another-team'; snapshot.activeAgentId = null;
    await call({ action: 'prepare', link: encodeConversationShareLink(f.link) });
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.activeTeamId).toBe('team-test');
    expect(snapshot.activeAgentId).toBe(snapshot.agents[0]!.id);
  }, 30_000);
  // Moderation failures: pending text leaks to other guests, Dismiss dispatches,
  // retry/late owner decisions duplicate execution, or saved identity bindings disappear.
  it('moderates private proposals once and restores canonical authorship after owner-state reload', async () => {
    const submit = vi.fn(async () => ({ turnId: 'native-turn', messageId: 'native-user-id' }));
    const f = await fixture('codex', submit);
    const one = await f.client('Alex'); const two = await f.client('Alex');
    const withdrawn = { id: randomUUID(), text: 'Only I can withdraw this suggestion' };
    await one.client.propose(withdrawn);
    await expect(two.client.withdraw(withdrawn.id)).rejects.toThrow();
    expect((await one.client.proposals()).proposals).toContainEqual(expect.objectContaining({ id: withdrawn.id, status: 'pending' }));
    await one.client.withdraw(withdrawn.id);
    await one.client.withdraw(withdrawn.id);
    await one.client.propose(withdrawn);
    expect((await one.client.proposals()).proposals).toContainEqual(expect.objectContaining({ id: withdrawn.id, status: 'dismissed', text: '' }));
    expect(await readFile(path.join(f.directory, 'shares/state.json'), 'utf8')).not.toContain(withdrawn.text);
    const dismissed = { id: randomUUID(), text: 'Private draft' };
    await one.client.propose(dismissed);
    await vi.waitFor(() => expect(one.client.proposalState?.proposals).toContainEqual(expect.objectContaining({ id: dismissed.id, status: 'pending' })));
    expect(two.client.proposalState?.proposals ?? []).toStrictEqual([]);
    expect((await two.client.proposals()).proposals).toStrictEqual([]);
    await f.shares.control({ action: 'dismiss', target: f.target, handle: f.link.handle, proposalId: dismissed.id });
    expect(submit).not.toHaveBeenCalled();
    expect(await readFile(path.join(f.directory, 'shares/state.json'), 'utf8')).not.toContain(dismissed.text);
    expect((await one.client.proposals()).proposals).toEqual([expect.objectContaining({ id: withdrawn.id, status: 'dismissed' }), expect.objectContaining({ id: dismissed.id, status: 'dismissed' })]);
    const accepted = { id: randomUUID(), text: 'Identical prompt' };
    await Promise.all([one.client.propose(accepted), one.client.propose(accepted)]);
    await Promise.all([f.shares.control({ action: 'send', target: f.target, handle: f.link.handle, proposalId: accepted.id }), f.shares.control({ action: 'send', target: f.target, handle: f.link.handle, proposalId: accepted.id })]);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect((await one.client.proposals()).proposals).toContainEqual(expect.objectContaining({ id: accepted.id, status: 'submitted', messageId: 'native-user-id' })));
    const other = await two.client.proposals();
    expect(other.proposals).toStrictEqual([]);
    expect(other.authors).toContainEqual(expect.objectContaining({ messageId: 'native-user-id', name: 'Alex' }));
    expect(JSON.stringify(other)).not.toContain('Private draft');
    await expect(one.client.propose({ ...accepted, text: 'Changed on retry' })).rejects.toThrow();
    const saved = JSON.parse(await readFile(path.join(f.directory, 'shares/state.json'), 'utf8'));
    expect(saved.proposals.filter((p: { status: string }) => p.status === 'submitted')).toHaveLength(1);
    expect(saved.proposals.find((p: { id: string }) => p.id === accepted.id).messageId).toBe('native-user-id');
    await f.shares.control({ action: 'dismiss', target: f.target, handle: f.link.handle, proposalId: accepted.id });
    expect(submit).toHaveBeenCalledTimes(1);
    f.shares.close();
    const restored = new ConversationShares({ directory: path.join(f.directory, 'shares'), endpoint: async () => ({ ownerId: f.link.ownerId, relay: f.pin }), submit }, () => f.snapshot, () => {});
    cleanup.push(() => restored.close());
    expect((await restored.authorize(f.link.handle, f.link.credential)).valid()).toBe(true);
    const recovered = await restored.guestState(f.link.handle, one.joined.participant.identity);
    expect(await restored.propose(f.link.handle, one.joined.participant.identity, 'Alex', withdrawn)).toMatchObject({ status: 'dismissed', text: '' });
    expect(recovered.authors).toContainEqual(expect.objectContaining({ messageId: 'native-user-id', name: 'Alex' }));
    await restored.propose(f.link.handle, one.joined.participant.identity, 'Alex', accepted);
    await restored.control({ action: 'send', target: f.target, handle: f.link.handle, proposalId: accepted.id });
    await restored.dispatchQueued();
    expect(submit).toHaveBeenCalledTimes(1);
    await restored.control({ action: 'revoke', target: f.target, handle: f.link.handle });
    const replacement = await restored.control({ action: 'create', target: f.target });
    expect((await restored.guestState(replacement.state.handle!, 'new-guest')).authors).toContainEqual(expect.objectContaining({ messageId: 'native-user-id', name: 'Alex' }));
  }, 30_000);
  it('holds approved proposals while busy, preserves them across restart and rejects unsent work on revoke', async () => {
    const submit = vi.fn(async () => ({ turnId: 'queued-turn', messageId: 'queued-message' }));
    const f = await fixture('codex', submit); const one = await f.client();
    f.snapshot.agents[0]!.status = { type: 'working' };
    const proposal = { id: randomUUID(), text: 'Wait for the owner agent' }; await one.client.propose(proposal);
    await f.shares.control({ action: 'send', target: f.target, handle: f.link.handle, proposalId: proposal.id });
    await f.shares.dispatchQueued(); expect(submit).not.toHaveBeenCalled();
    expect((await one.client.proposals()).proposals).toContainEqual(expect.objectContaining({ id: proposal.id, status: 'queued' }));
    f.shares.close();
    const restored = new ConversationShares({ directory: path.join(f.directory, 'shares'), endpoint: async () => ({ ownerId: f.link.ownerId, relay: f.pin }), submit, canSubmit: () => f.snapshot.agents[0]!.status.type === 'idle' }, () => f.snapshot, () => {});
    cleanup.push(() => restored.close());
    await restored.dispatchQueued(); expect(submit).not.toHaveBeenCalled();
    f.snapshot.agents[0]!.status = { type: 'idle' }; await restored.dispatchQueued(); expect(submit).toHaveBeenCalledTimes(1);
    f.snapshot.agents[0]!.status = { type: 'working' };
    const unsent = { id: randomUUID(), text: 'Never admit after revoke' };
    await restored.propose(f.link.handle, one.joined.participant.identity, 'Alex', unsent);
    await restored.control({ action: 'send', target: f.target, handle: f.link.handle, proposalId: unsent.id });
    await restored.control({ action: 'revoke', target: f.target, handle: f.link.handle });
    f.snapshot.agents[0]!.status = { type: 'idle' }; await restored.dispatchQueued();
    expect(submit).toHaveBeenCalledTimes(1);
    expect((await restored.guestState(f.link.handle, one.joined.participant.identity)).proposals).toContainEqual(expect.objectContaining({ id: unsent.id, status: 'rejected' }));
  }, 30_000);
  it('retains uncertain dispatch across owner restart and never retries it', async () => {
    let complete!: (result: { turnId: string; messageId: string }) => void;
    const submit = vi.fn(() => new Promise<{ turnId: string; messageId: string }>(resolve => { complete = resolve; }));
    const f = await fixture('codex', submit); const one = await f.client();
    const proposal = { id: randomUUID(), text: 'One uncertain prompt' }; await one.client.propose(proposal);
    await f.shares.control({ action: 'send', target: f.target, handle: f.link.handle, proposalId: proposal.id });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    f.shares.close();
    const restored = new ConversationShares({ directory: path.join(f.directory, 'shares'), endpoint: async () => ({ ownerId: f.link.ownerId, relay: f.pin }), submit }, () => f.snapshot, () => {});
    cleanup.push(() => restored.close());
    const status = await restored.guestState(f.link.handle, one.joined.participant.identity);
    expect(status.proposals).toContainEqual(expect.objectContaining({ id: proposal.id, status: 'unresolved' }));
    await restored.propose(f.link.handle, one.joined.participant.identity, 'Alex', proposal);
    await restored.control({ action: 'send', target: f.target, handle: f.link.handle, proposalId: proposal.id });
    await restored.dispatchQueued(); expect(submit).toHaveBeenCalledTimes(1);
    complete({ turnId: 'late', messageId: 'late' });
  }, 30_000);
  // Saved-join failure modes: duplicate URL races create sessions; restart loses pins/identity;
  // disconnect is mistaken for revoke; stale async joins reappear after Leave; secrets enter UI state.
  it('joins without local setup, deduplicates opens, returns with the same protected identity and clears learned revocation', async () => {
    const f = await fixture(); const directory = path.join(f.directory, 'joined');
    let joins = new GuestJoins({ directory, relay: f.pin }); cleanup.push(() => joins.close());
    const url = encodeConversationShareLink(f.link);
    const [first, duplicate] = await Promise.all([joins.control({ action: 'prepare', link: url }), joins.control({ action: 'prepare', link: url })]);
    expect(first.view?.id).toBe(duplicate.view?.id); expect(first.view?.status).toBe('needsName');
    expect(f.listeners.size).toBe(0);
    const id = first.view!.id;
    await expect(joins.control({ action: 'join', id, name: '  ' })).rejects.toThrow('Invalid display name');
    await joins.control({ action: 'join', id, name: ' Alex ' });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('ready'));
    const joined = await joins.control({ action: 'state' });
    expect(joined.entries).toHaveLength(1); expect(joined.view?.frame?.payload.snapshot.messages[0]?.id).toBe('before-share');
    expect(JSON.stringify(joined)).not.toContain(f.link.credential);
    await Promise.all([joins.control({ action: 'prepare', link: url }), joins.control({ action: 'open', id }), joins.control({ action: 'open', id })]);
    expect(f.listeners.size).toBe(1);
    const identity = joined.view!.participant!.identity;
    const saved = await readFile(path.join(directory, 'state.json'), 'utf8');
    expect(saved).toContain(f.link.credential); expect(saved).not.toContain('before-share');
    expect((await stat(path.join(directory, 'state.json'))).mode & 0o777).toBe(0o600);
    await joins.close(); await vi.waitFor(() => expect(f.listeners.size).toBe(0));
    joins = new GuestJoins({ directory, relay: f.pin });
    expect((await joins.control({ action: 'state' })).entries).toHaveLength(1);
    await joins.control({ action: 'open', id });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('ready'));
    expect((await joins.control({ action: 'state' })).view!.participant!.identity).toBe(identity);
    await f.shares.control({ action: 'revoke', handle: f.link.handle, target: f.target });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('rejected'));
    expect((await joins.control({ action: 'state' })).entries).toHaveLength(0);
    expect(await readFile(path.join(directory, 'state.json'), 'utf8')).not.toContain(f.link.credential);
    expect((await joins.control({ action: 'state' })).view?.frame).toBeNull();
  }, 30_000);
  it('blocks access and reports failed authorization removal when local storage becomes inaccessible during revocation', async () => {
    const f = await fixture(); const directory = path.join(f.directory, 'joined');
    const joins = new GuestJoins({ directory, relay: f.pin }); cleanup.push(() => joins.close());
    const id = (await joins.control({ action: 'prepare', link: encodeConversationShareLink(f.link) })).view!.id;
    await joins.control({ action: 'join', id, name: 'Alex' });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('ready'));
    await rename(directory, directory + '-held'); await writeFile(directory, 'blocked');
    await f.shares.control({ action: 'revoke', handle: f.link.handle, target: f.target });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('storageUnavailable'));
    expect((await joins.control({ action: 'state' })).view?.frame).toBeNull();
    await joins.control({ action: 'open', id }); expect(f.listeners.size).toBe(0);
    await unlink(directory); await rename(directory + '-held', directory);
    await joins.control({ action: 'leave', id });
    expect(await readFile(path.join(directory, 'state.json'), 'utf8')).not.toContain(f.link.credential);
  }, 30_000);
  it('switches saved conversations without leaving background sessions or a stale ready view', async () => {
    const f = await fixture(); const directory = path.join(f.directory, 'joined');
    let joins = new GuestJoins({ directory, relay: f.pin }); cleanup.push(() => joins.close());
    f.snapshot.agents[0]!.conversationTitle = 'Investigate login failures';
    const first = (await joins.control({ action: 'prepare', link: encodeConversationShareLink(f.link) })).view!.id;
    await joins.control({ action: 'join', id: first, name: 'Alex' });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('ready'));
    const link = await f.addLink(2);
    f.snapshot.agents.find(agent => agent.id === 'shared-2')!.conversationTitle = 'Prepare the release';
    const second = (await joins.control({ action: 'prepare', link: encodeConversationShareLink(link) })).view!.id;
    await joins.control({ action: 'join', id: second, name: 'Alex' });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('ready'));
    const expected = [
      { id: first, name: 'Alex', title: 'Investigate login failures' },
      { id: second, name: 'Alex', title: 'Prepare the release' },
    ];
    expect((await joins.control({ action: 'state' })).entries).toStrictEqual(expected);
    expect(f.listeners.size).toBe(1);
    await joins.control({ action: 'open', id: first });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.frame?.agentId).toBe('shared'));
    expect(f.listeners.size).toBe(1); expect((await joins.control({ action: 'state' })).entries).toHaveLength(2);
    expect((await joins.control({ action: 'state' })).view?.title).toBe(expected[0]!.title);
    await joins.close(); joins = new GuestJoins({ directory, relay: f.pin });
    // Saved labels must be useful before networking, including when the owner is offline.
    const restored = await joins.control({ action: 'state' });
    expect(restored).toStrictEqual({ entries: expected, view: null });
    expect(JSON.stringify(restored)).not.toContain(link.credential);
    expect(JSON.stringify(restored)).not.toContain(f.link.credential);
    await joins.control({ action: 'open', id: second });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('ready'));
    expect((await joins.control({ action: 'state' })).view?.title).toBe(expected[1]!.title);
    f.snapshot.agents.find(agent => agent.id === 'shared-2')!.conversationTitle = expected[0]!.title;
    await joins.close(); joins = new GuestJoins({ directory, relay: f.pin });
    await joins.control({ action: 'open', id: second });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('ready'));
    const duplicates = await joins.control({ action: 'state' });
    expect(duplicates.entries.map(entry => entry.title)).toStrictEqual([
      'Investigate login failures',
      'Investigate login failures',
    ]);
    expect(duplicates.view?.title).toBe(duplicates.entries[1]!.title);
    await joins.close();
    const legacy = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
    for (const record of legacy.joins) delete record.title;
    await writeFile(path.join(directory, 'state.json'), JSON.stringify(legacy));
    joins = new GuestJoins({ directory, relay: f.pin });
    expect((await joins.control({ action: 'state' })).entries.map(entry => entry.title)).toStrictEqual([
      'Shared conversation',
      'Shared conversation',
    ]);
  }, 30_000);
  it('keeps unavailable distinct from rejection, reconnects on open, and Leave cancels an in-flight read', async () => {
    const f = await fixture(); const joins = new GuestJoins({ directory: path.join(f.directory, 'joined'), relay: f.pin }); cleanup.push(() => joins.close());
    const state = await joins.control({ action: 'prepare', link: encodeConversationShareLink(f.link) }); const id = state.view!.id;
    await joins.control({ action: 'join', id, name: 'Alex' });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('ready'));
    await f.connector.stop();
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('unavailable'));
    expect((await joins.control({ action: 'state' })).view?.frame?.payload.snapshot.messages).toHaveLength(1);
    expect((await joins.control({ action: 'state' })).entries).toHaveLength(1);
    await f.connector.start(f.pin.origin, f.pin.peerId);
    await joins.control({ action: 'open', id });
    await vi.waitFor(async () => expect((await joins.control({ action: 'state' })).view?.status).toBe('ready'));
    let release!: () => void; f.block(() => new Promise<void>(resolve => { release = resolve; }));
    const older = joins.control({ action: 'history', id });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await joins.control({ action: 'leave', id }); release(); await older.catch(() => {});
    expect(await joins.control({ action: 'state' })).toStrictEqual({ entries: [], view: null });
    expect(await readFile(path.join(f.directory, 'joined/state.json'), 'utf8')).not.toContain(f.link.credential);
  }, 30_000);
  it('rejects malformed, unsupported and foreign relay links before networking and fails closed on storage', async () => {
    const f = await fixture(); const joins = new GuestJoins({ directory: path.join(f.directory, 'joined'), relay: f.pin }); cleanup.push(() => joins.close());
    const url = encodeConversationShareLink(f.link);
    expect((await joins.control({ action: 'prepare', link: url.replace('v=1', 'v=2') })).view?.status).toBe('upgradeRequired');
    for (const link of ['garbage', url + 'extra', url.replace('handle=', 'other='), encodeConversationShareLink({ ...f.link, relay: { ...f.pin, origin: 'wss://untrusted.example' } })]) {
      expect((await joins.control({ action: 'prepare', link })).view?.status).toBe('invalid');
    }
    expect(f.listeners.size).toBe(0);
    const directory = path.join(f.directory, 'blocked'); await writeFile(directory, 'not a directory');
    const blocked = new GuestJoins({ directory, relay: f.pin }); cleanup.push(() => blocked.close());
    await expect(blocked.control({ action: 'state' })).rejects.toThrow('Guest storage is unavailable');
    expect(f.listeners.size).toBe(0);
  }, 30_000);
  it.each(['codex', 'claude', 'antigravity'] as const)('serves only the bound %s conversation to multiple holders, including history and live provider frames', async backend => {
    const f = await fixture(backend); const first = await f.client(); const second = await f.client('Alex');
    expect(first.joined.participant.name).toBe('Alex'); expect(first.joined.participant.discriminator).not.toBe(second.joined.participant.discriminator);
    await first.client.synchronize(); await second.client.synchronize();
    expect(first.client.snapshot?.payload.snapshot.messages.map(m => m.id)).toStrictEqual(['before-share']);
    expect(JSON.stringify(first.client.snapshot)).not.toMatch(/PRIVATE_OTHER_CHAT|PRIVATE_QUEUED|team-test/);
    expect((await f.shares.control({ action: 'status', target: f.target })).state.connectedGuests).toBe(2);
    await first.client.loadOlder(); expect(first.client.snapshot?.payload.snapshot.messages).toHaveLength(121);
    f.delta(); await vi.waitFor(() => expect(second.client.snapshot?.payload.snapshot.messages.at(-1)?.id).toBe('delta'));
    f.delta(true); await vi.waitFor(() => expect(second.client.snapshot?.payload.snapshot.messages.at(-1)?.id).toBe('after-gap'));
    f.live(); await vi.waitFor(() => expect(second.client.snapshot?.payload.snapshot.messages.at(-1)?.id).toBe('live'));
    if (backend === 'codex') { const privateEvent = { ...f.reset(), type: 'codex.conversationEventReceived', payload: { revision: (first.client.snapshot?.payload.revision ?? 0) + 1, event: { type: 'conversation.queueChanged', origin: 'notification', conversationId: 'bound', seq: 999, occurredAt: 'now', payload: { queuedPrompts: [{ id: 'private-queued', text: 'PRIVATE_PENDING' }] } } } } as ProviderConversationFrame; f.emit(privateEvent); await vi.waitFor(() => expect(first.client.snapshot?.payload.revision).toBe(privateEvent.payload.revision)); expect(JSON.stringify(first.client.snapshot)).not.toContain('PRIVATE_PENDING'); }
    const checkpoint = first.client.checkpoint; await first.client.synchronize(checkpoint); expect(first.client.snapshot?.payload.snapshot.messages.at(-1)?.id).toBe('live');
    f.source.clear(); await first.client.synchronize(checkpoint); expect(first.client.snapshot?.payload.snapshot.messages.at(-1)?.id).toBe('live');
    await f.shares.control({ action: 'revoke', handle: f.link.handle, target: f.target });
    await vi.waitFor(() => expect(f.listeners.size).toBe(0)); await vi.waitFor(() => expect(first.client.snapshot).toBeNull());
    expect(second.client.snapshot).toBeNull();
    await evidence(backend, { holders: 2, historyRows: 121, revokedSubscriptions: f.listeners.size, fixtureOnly: true });
  }, 30_000);
  it('keeps admitted guest streams alive when mobile access is disabled through the daemon manager', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'guest-manager-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const port = await freePort(); const relay = await createCompanionRelay({ key: await generateKeyPair('Ed25519'), listen: `/ip4/127.0.0.1/tcp/${port}/ws` }); cleanup.push(() => relay.stop());
    const pin = { origin: `ws://127.0.0.1:${port}`, peerId: relay.peerId.toString() };
    const snapshot = createTestSnapshot(); const agent: Agent = { id: 'shared', teamId: 'team-test', name: 'Synthetic', folder: null, backend: 'antigravity', backendSession: { kind: 'antigravity', sessionId: 'bound' }, status: { type: 'idle' }, createdAt: 'now', updatedAt: 'now' }; snapshot.agents = [agent];
    let shares!: ConversationShares; let manager!: CompanionManager;
    manager = new CompanionManager(path.join(directory, 'companion'), {
      authorizeGuest: (handle, credential) => shares.authorize(handle, credential), guestCount: (handle, count) => shares.connected(handle, count),
      request: async <T>(method: string): Promise<T> => {
        if (method !== backendMethods.agentConversationLoad) throw new Error('Unexpected owner operation');
        manager.event({ type: 'antigravity.conversationSnapshotChanged', agentId: 'shared', backend: 'antigravity', backendSessionId: 'bound', seq: 1, occurredAt: 'now', payload: { revision: 1, snapshot: { ...emptyAntigravitySnapshot('shared', 'bound'), messages: [message('before-share')] } } }); return undefined as T;
      },
    }, { APP_COMPANION_RELAY_URL: pin.origin, APP_COMPANION_RELAY_PEER_ID: pin.peerId }); cleanup.push(() => manager.stop());
    const endpoint = (await manager.shareEndpoint())!;
    shares = new ConversationShares({ directory: path.join(directory, 'shares'), endpoint: async () => endpoint, routing: { update: routes => manager.updateShareRoutes(routes), subscribe: listener => manager.onShareRoutingStatus(listener) } }, () => snapshot, () => {}); cleanup.push(() => shares.close());
    const target = conversationShareTarget(agent)!; const created = await shares.control({ action: 'create', target }); const link = decodeConversationShareLink(created.link!, pin)!;
    const transport = new GuestConversationTransport(await generateKeyPair('Ed25519'), pin); cleanup.push(() => transport.stop()); const opened = await transport.open(link); if (opened.status !== 'ready') throw new Error(opened.status);
    const client = new GuestConversationClient(opened.stream); cleanup.push(() => client.close()); await client.join(link, 'Alex'); await client.synchronize();
    await manager.control({ action: 'resume' }); await manager.control({ action: 'disable' });
    await client.synchronize(); expect(client.snapshot?.payload.snapshot.messages[0]?.id).toBe('before-share');
    expect((await shares.control({ action: 'status', target })).state.connectedGuests).toBe(1);
    expect((await manager.control({ action: 'status' })).status.enabled).toBe(false);
  }, 30_000);
  it('bounds admitted guests at eight per link and thirty-two per owner, then frees closed slots', async () => {
    const f = await fixture(); const clients: GuestConversationClient[] = [];
    for (let group = 0; group < 4; group++) {
      const route = group ? await f.addLink(group) : f.link;
      for (let i = 0; i < 8; i++) clients.push((await f.client('Alex', route, group * 4 + Math.floor(i / 2))).client);
      const extra = new GuestConversationClient(await f.open(route, 999)); cleanup.push(() => extra.close());
      await expect(extra.join(route, 'Ninth')).rejects.toThrow('busy'); extra.close();
    }
    const fifth = await f.addLink(4); const extra = new GuestConversationClient(await f.open(fifth, 999)); cleanup.push(() => extra.close());
    await expect(extra.join(fifth, 'Thirty-third')).rejects.toThrow('busy');
    clients[0]!.close(); await vi.waitFor(() => expect(f.listeners.size).toBe(31));
    expect((await extra.join(fifth, 'Replacement')).participant.name).toBe('Replacement');
    await evidence('limits', { perConversation: 8, owner: 32, ninth: 'busy', thirtyThird: 'busy', closedSlotReused: true });
  }, 60_000);
  it('subscribes before reading, flushes live work after the baseline, and drops foreign provider targets', async () => {
    const f = await fixture(); const { client } = await f.client();
    const original = f.port.synchronize; let release!: () => void; let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const reading = new Promise<void>(resolve => { started = resolve; });
    f.port.synchronize = async (...args) => { const value = await original(...args); started(); await gate; return value; };
    const sync = client.synchronize(); await reading; f.delta();
    f.emit({ ...f.reset(), conversationId: 'OTHER', payload: { ...f.reset().payload, revision: 999 } } as ProviderConversationFrame);
    release(); await sync; expect(client.snapshot?.payload.snapshot.messages.map(m => m.id)).toStrictEqual(['before-share', 'delta']);
    expect(client.snapshot?.payload.revision).toBe(2);
  }, 30_000);
  it('recovers a revision gap that occurs while the initial baseline read is in flight', async () => {
    const f = await fixture(); const { client } = await f.client(); const original = f.port.synchronize;
    let release!: () => void; let started!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const reading = new Promise<void>(resolve => { started = resolve; }); let first = true;
    f.port.synchronize = async (...args) => { const value = await original(...args); if (first) { first = false; started(); await gate; } return value; };
    const sync = client.synchronize(); await reading; f.delta(true); release(); await sync;
    expect(client.snapshot?.payload.snapshot.messages.map(m => m.id)).toStrictEqual(['before-share', 'after-gap']); expect(client.snapshot?.payload.revision).toBe(4);
  }, 30_000);
  it('reports an explicit busy response when transcript ownership references exceed the session budget', async () => {
    const f = await fixture(); f.manyReferences(); const { client } = await f.client(); await expect(client.synchronize()).rejects.toThrow('busy');
    await vi.waitFor(() => expect(f.listeners.size).toBe(0)); expect(client.snapshot).toBeNull();
  }, 30_000);
  it('clears subscribe-before-read buffers immediately when the link is revoked during catch-up', async () => {
    const f = await fixture(); const { client } = await f.client(); const original = f.port.synchronize;
    let release!: () => void; let started!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const reading = new Promise<void>(resolve => { started = resolve; });
    f.port.synchronize = async (...args) => { const value = await original(...args); started(); await gate; return value; };
    const sync = client.synchronize().then(() => 'leaked', () => 'closed'); await reading; f.delta();
    await f.shares.control({ action: 'revoke', handle: f.link.handle, target: f.target });
    expect(f.listeners.size).toBe(0); release(); expect(await sync).toBe('closed'); expect(client.snapshot).toBeNull();
  }, 30_000);
  it('limits guest request work and closes its subscription after a request flood', async () => {
    const f = await fixture(); const request = await wire(await f.open());
    await request('guest.join', { handle: f.link.handle, credential: f.link.credential, name: 'Alex' });
    for (let i = 0; i < 119; i++) expect((await request('ping', {})).error).toBeUndefined();
    expect((await request('ping', {})).error).toBe('rateLimited'); await vi.waitFor(() => expect(f.listeners.size).toBe(0));
  }, 30_000);
  it('rejects invalid credentials, names, target substitution and every phone/control method without reading anything else', async () => {
    const f = await fixture(); const request = await wire(await f.open());
    const invalid = await request('guest.join', { handle: f.link.handle, credential: 'b'.repeat(43), name: 'Alex' }); expect(invalid.error).toBe('denied');
    expect((await request('guest.join', { ...f.link, name: 'Alex' })).error).toBe('denied');
    for (const name of ['', '  ', 'A\nB', 'A\u202eB', 'a'.repeat(81)]) expect((await request('guest.join', { handle: f.link.handle, credential: f.link.credential, name })).error).toBe('denied');
    expect((await request('guest.join', { handle: f.link.handle, credential: f.link.credential, name: 'Alex' })).result).toBeDefined();
    const denied = ['snapshot.get', 'pair.claim', 'agent.prompt', 'prompt.send', 'prompt.submit', 'agent/prompt/send', 'conversation/read', 'skills.list', 'agent.git.diff', 'team.create', 'agent.backend.set', 'agent.approvalPreset.set', 'agent.interrupt', 'agent.request.respond', 'agent.model.select', 'agent.permissionMode.set', 'rpc', 'conversation.subscribe'];
    for (const method of denied) expect((await request(method, {})).error).toBe('denied');
    expect((await request('conversation.synchronize', { checkpoint: null, target: { agentId: 'other' } })).error).toBe('denied');
    expect((await request('conversation.image.read', { path: '/private/secret.png' })).error).toBe('denied');
    expect((await request('conversation.content.read', { input: { sessionId: 'bound', contentId: 'b'.repeat(64), offset: 0 } })).error).toBe('denied');
    expect(f.port.readImage).not.toHaveBeenCalled(); expect(f.port.readConversationContent).not.toHaveBeenCalled();
    await evidence('denied', { methods: denied, targetSubstitution: 'denied', arbitraryPaths: 'denied', missingContentReference: 'denied' });
  }, 30_000);
  it('keeps content ownership from older delivered history when the provider reloads its recent window', async () => {
    const f = await fixture(); f.addMedia(); const { client } = await f.client(); await client.synchronize(); await client.loadOlder();
    f.forgetMedia();
    expect(await client.readImage('/fixture/output.png')).toStrictEqual({ dataUrl: 'data:image/png;base64,YQ==' });
    expect(await client.readContent({ sessionId: 'bound', contentId: 'a'.repeat(64), offset: 0 })).toStrictEqual({ data: 'expanded transcript', nextOffset: null, totalBytes: 19 });
    await expect(client.readContent({ sessionId: 'OTHER', contentId: 'a'.repeat(64), offset: 0 })).rejects.toThrow('denied');
    expect(f.port.readConversationContent).toHaveBeenCalledTimes(1);
  }, 30_000);
  it.each(['revoke', 'replace'] as const)('drops delayed reads and subscribed buffered work on %s', async action => {
    const f = await fixture(); f.addMedia(); const { client } = await f.client(); await client.synchronize();
    expect(await client.readImage('/fixture/output.png')).toStrictEqual({ dataUrl: 'data:image/png;base64,YQ==' });
    expect(await client.readContent({ sessionId: 'bound', contentId: 'a'.repeat(64), offset: 0 })).toStrictEqual({ data: 'expanded transcript', nextOffset: null, totalBytes: 19 });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); f.block(() => gate);
    const read = client.readContent({ sessionId: 'bound', contentId: 'a'.repeat(64), offset: 0 }).then(() => 'leaked', () => 'closed');
    await vi.waitFor(() => expect(f.port.readConversationContent).toHaveBeenCalledTimes(2));
    if (action === 'revoke') await f.shares.control({ action: 'revoke', handle: f.link.handle, target: f.target }); else f.replace();
    release(); expect(await read).toBe('closed'); await vi.waitFor(() => expect(f.listeners.size).toBe(0)); expect(client.snapshot).toBeNull();
  }, 30_000);
});
async function evidence(name: string, result: unknown) { const directory = process.env.APP_SHARE_SESSION_EVIDENCE; if (!directory) return; await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, `${name}.json`), JSON.stringify(result, null, 2)); }
