import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createDemoConnector } from '../demo-connector';
import { createEngine, type EngineEvent, type EngineState, type EnginePort } from '../engine';
import { createSelectionStore } from '../selection-store';
import type { CompanionHistoryPage, CompanionSession, CompanionWorkspace } from '../companion-port';

/** What the transcript page shows: the last conversation it was sent, with the context updates that followed applied to it. */
function shown(events: readonly EngineEvent[]) {
  let index = events.length - 1;
  while (index >= 0 && events[index]!.type !== 'conversation') index--;
  if (index < 0) return undefined;
  const base = events[index] as Extract<EngineEvent, { type: 'conversation' }>;
  return events.slice(index + 1).reduce<typeof base>((view, event) => event.type === 'conversationContext' && event.agentId === view.agentId ? { ...view, ...event, type: 'conversation' } : view, base);
}
const unpaired = () => { const connector = createDemoConnector(); Object.defineProperty(connector, 'laptops', { value: [] }); return connector; };
function open(connector = createDemoConnector(), selectionStore?: EnginePort['selectionStore']) {
  const events: EngineEvent[] = [];
  const engine = createEngine({ connector, selectionStore, post: (event) => events.push(event) });
  const states = () => events.flatMap((event) => event.type === 'state' ? [event.state] : []);
  const latest = (): EngineState => engine.snapshot();
  return { engine, events, states, latest };
}

it('tells the session it is in the background when the app is launched there', async () => {
  const connector = createDemoConnector(); const original = connector.connect; const setActive = vi.fn(async () => {});
  connector.connect = async id => ({ ...(await original(id)), setActive });
  const engine = createEngine({ connector, initialActive: false, post: () => {} });
  try {
    await engine.start();
    await engine.dispatch({ type: 'connect', laptopId: connector.laptops[0]!.id });
    expect(setActive).toHaveBeenCalledWith(false);
  } finally { engine.dispose(); }
});

describe('companion engine', () => {
  it('lets manual reconnect replace a stalled automatic attempt while preserving the selected conversation', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    let lost = () => {}; let release!: (session: Awaited<ReturnType<typeof original>>) => void;
    const stalled = new Promise<Awaited<ReturnType<typeof original>>>(resolve => { release = resolve; });
    const abandonedClose = vi.fn();
    connector.connect = vi.fn(async id => ({ ...await original(id), onDisconnect(listener: () => void) { lost = listener; return () => {}; } }));
    const { engine } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await engine.dispatch({ type: 'activity', active: false });
      lost();
      vi.mocked(connector.connect).mockImplementationOnce(() => stalled);
      const automatic = engine.dispatch({ type: 'activity', active: true });
      await vi.waitFor(() => expect(engine.snapshot().connection).toBe('reconnecting'));
      expect(engine.snapshot()).toMatchObject({ agentId: 'demo-agent', canSend: false });
      await engine.dispatch({ type: 'reconnect' });
      expect(connector.connect).toHaveBeenCalledTimes(3);
      expect(engine.snapshot()).toMatchObject({ connection: 'connected', agentId: 'demo-agent', conversationReady: true });
      release({ ...await original('demo-laptop'), close: abandonedClose }); await automatic;
      expect(abandonedClose).toHaveBeenCalledOnce();
      expect(engine.snapshot()).toMatchObject({ connection: 'connected', agentId: 'demo-agent', conversationReady: true });
    } finally { release?.({ ...await original('demo-laptop'), close() {} }); engine.dispose(); }
  });
  it('reuses the connection and selected conversation during the five-minute background grace period', async () => {
    vi.useFakeTimers();
    const connector = createDemoConnector(); const original = connector.connect;
    const close = vi.fn(); const setActive = vi.fn(async () => {});
    connector.connect = vi.fn(async id => ({ ...await original(id), close, setActive }));
    connector.suspend = vi.fn(async () => {});
    const { engine } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const before = engine.snapshot();
      await engine.dispatch({ type: 'activity', active: false });
      await vi.advanceTimersByTimeAsync(240_000);
      await engine.dispatch({ type: 'activity', active: false }); // Duplicate native callbacks do not extend the deadline.
      await vi.advanceTimersByTimeAsync(59_999);
      expect(engine.snapshot().connection).toBe('connected');
      expect(close).not.toHaveBeenCalled(); expect(connector.suspend).not.toHaveBeenCalled();
      await engine.dispatch({ type: 'activity', active: true });
      expect(connector.connect).toHaveBeenCalledOnce();
      expect(engine.snapshot()).toMatchObject({ agentId: before.agentId, conversationGeneration: before.conversationGeneration, conversationReady: true });
      expect(setActive.mock.calls).toStrictEqual([[false], [true]]);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(connector.suspend).not.toHaveBeenCalled();
    } finally { engine.dispose(); vi.useRealTimers(); }
  });
  it.each(['timer', 'suspended clock'] as const)('expires the five-minute grace period with a %s and reconnects on return', async mode => {
    vi.useFakeTimers();
    const connector = createDemoConnector(); const connect = vi.spyOn(connector, 'connect');
    connector.suspend = vi.fn(async () => {}); connector.resume = vi.fn(async () => {});
    const { engine } = open(connector);
    try {
      await engine.start();
      await engine.dispatch({ type: 'activity', active: false });
      expect(connector.suspend).not.toHaveBeenCalled();
      if (mode === 'timer') {
        await vi.advanceTimersByTimeAsync(300_000);
        expect(connector.suspend).toHaveBeenCalledOnce();
        expect(engine.snapshot().connection).toBe('disconnected');
      } else vi.setSystemTime(Date.now() + 300_001);
      await engine.dispatch({ type: 'activity', active: true });
      expect(connector.suspend).toHaveBeenCalledOnce(); expect(connector.resume).toHaveBeenCalledOnce();
      expect(connect).toHaveBeenCalledTimes(2); expect(engine.snapshot().connection).toBe('connected');
    } finally { engine.dispose(); vi.useRealTimers(); }
  });
  it('defers reconnecting a lost background connection until the app returns', async () => {
    vi.useFakeTimers();
    const connector = createDemoConnector(); const original = connector.connect;
    let lost = () => {};
    connector.connect = vi.fn(async id => ({ ...await original(id), onDisconnect(listener: () => void) { lost = listener; return () => {}; } }));
    const { engine } = open(connector);
    try {
      await engine.start();
      await engine.dispatch({ type: 'activity', active: false });
      lost();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(connector.connect).toHaveBeenCalledOnce();
      await engine.dispatch({ type: 'activity', active: true });
      expect(connector.connect).toHaveBeenCalledTimes(2);
      expect(engine.snapshot().connection).toBe('connected');
      await engine.dispatch({ type: 'activity', active: false }); engine.dispose();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(connector.connect).toHaveBeenCalledTimes(2);
    } finally { engine.dispose(); vi.useRealTimers(); }
  });
  it('does not reopen networking when the app backgrounds during an expired connection teardown', async () => {
    vi.useFakeTimers();
    const connector = createDemoConnector(); const connect = vi.spyOn(connector, 'connect');
    let finish!: () => void;
    connector.suspend = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    connector.resume = vi.fn(async () => {});
    const { engine } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'activity', active: false });
      await vi.advanceTimersByTimeAsync(300_000);
      const returning = engine.dispatch({ type: 'activity', active: true });
      await engine.dispatch({ type: 'activity', active: false });
      finish(); await returning;
      expect(connector.resume).not.toHaveBeenCalled(); expect(connect).toHaveBeenCalledOnce();
      await engine.dispatch({ type: 'activity', active: true });
      expect(connect).toHaveBeenCalledTimes(2);
    } finally { finish?.(); engine.dispose(); vi.useRealTimers(); }
  });
  it.each([true, false])('returns from a long background launch to a saved laptop or pairing (paired=%s)', async paired => {
    vi.useFakeTimers();
    const connector = paired ? createDemoConnector() : unpaired(); const connect = vi.spyOn(connector, 'connect');
    const engine = createEngine({ connector, initialActive: false, post: () => {} });
    try {
      await engine.start();
      expect(engine.snapshot().startup).toBe('ready');
      expect(connect).not.toHaveBeenCalled();
      expect(engine.snapshot().canSend).toBe(false);
      await engine.dispatch({ type: 'activity', active: false });
      await vi.advanceTimersByTimeAsync(300_000);
      expect(engine.snapshot().connection).toBe('unpaired');
      await engine.dispatch({ type: 'activity', active: true });
      if (paired) {
        expect(connect).toHaveBeenCalledExactlyOnceWith('demo-laptop');
        expect(engine.snapshot().connection).toBe('connected');
      } else {
        expect(connect).not.toHaveBeenCalled();
        expect(engine.snapshot()).toMatchObject({ startup: 'ready', connection: 'unpaired', laptops: [] });
      }
    } finally { engine.dispose(); vi.useRealTimers(); }
  });
  it('routes requested content as a separate chunk reply and rejects responses after selection changes', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const chunk = { data: 'e30=', totalBytes: 2, nextOffset: null };
    let finish!: (value: typeof chunk) => void;
    const readConversationContent = vi.fn().mockResolvedValueOnce(chunk).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    connector.connect = async (id) => {
      const session = await connect(id); const workspace = await session.getWorkspace();
      workspace.agents[0] = { ...workspace.agents[0]!, backend: 'claude', backendSession: { kind: 'claude', sessionId: 'session', transport: 'stdio' } };
      return { ...session, getWorkspace: async () => workspace, readConversationContent };
    };
    const { engine, events } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' }); await nextTick();
      expect(readConversationContent).not.toHaveBeenCalled();
      const command = { type: 'readConversationContent' as const, requestId: 'one', agentId: 'demo-agent', input: { sessionId: 'session', contentId: 'a'.repeat(64), offset: 0 } };
      await engine.dispatch(command);
      expect(events.filter((event) => event.type === 'conversationContent')).toStrictEqual([{ type: 'conversationContent', requestId: 'one', agentId: 'demo-agent', sessionId: 'session', chunk }]);
      const pending = engine.dispatch({ ...command, requestId: 'two' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      finish(chunk); await pending;
      expect(events.filter((event) => event.type === 'conversationContent').at(-1)).toMatchObject({ requestId: 'two', error: expect.any(String) });
      expect(events.filter((event) => event.type === 'conversation').every((event) => !JSON.stringify(event).includes('e30='))).toBe(true);
    } finally { engine.dispose(); }
  });
  it('publishes each cached selection with its own transcript, never the previous agent identity', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async (id) => {
      const session = await connect(id);
      const frames = new Map(await Promise.all(['demo-agent', 'demo-reviewer'].map(async (id) => [id, await session.loadConversation(id)] as const)));
      return { ...session, cachedConversation: (id) => frames.get(id), loadConversation: async (id) => frames.get(id) ?? null };
    };
    const { engine, events } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      events.length = 0;
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      const conversations = events.filter((event) => event.type === 'conversation');
      expect(conversations.length).toBeGreaterThan(0);
      for (const event of conversations) {
        expect(event.agent?.id).toBe('demo-reviewer');
        expect(event.frame?.agentId).toBe('demo-reviewer');
      }
    } finally { engine.dispose(); }
  });

  it('keeps failed answers available, prevents double responses, and never retargets a response after navigation', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const question = { id: 'same-id', conversationId: 'conversation', kind: 'question' as const,
      question: { itemId: 'item', delivery: 'tool' as const, blocking: true, questions: [{ id: 'q', header: 'Choice', question: 'Which?', isOther: true, isSecret: false, options: null }] } };
    let reviewerPending = true;
    let reject!: (error: Error) => void;
    const respondRequest = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    connector.connect = async (id) => {
      const session = await connect(id); const workspace = await session.getWorkspace();
      return { ...session, getWorkspace: async () => ({ ...workspace, agentRequests: { 'demo-agent': [question], 'demo-reviewer': reviewerPending ? [question] : [] } }), respondRequest };
    };
    const { engine, latest } = open(connector);
    try {
      await engine.start();
      await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const first = latest().requests[0]!;
      const reply = { target: { sessionId: first.target.sessionId, agentId: first.target.agentId, teamId: first.target.teamId, locationId: first.target.locationId, hostId: first.target.hostId }, id: first.request.id, conversationId: first.request.conversationId,
        outcome: { kind: 'answered' as const, answers: { q: { answers: ['My answer'] } } } };
      const sending = engine.dispatch({ type: 'respondRequest', reply });
      await engine.dispatch({ type: 'respondRequest', reply });
      expect(respondRequest).toHaveBeenCalledExactlyOnceWith(reply);
      expect(latest().respondingRequest).toBe(first.key);
      reject(new Error('Network interrupted')); await sending;
      expect(latest().failedRequest).toBe(first.key);
      expect(latest().requests).toHaveLength(1);
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      await engine.dispatch({ type: 'respondRequest', reply });
      expect(respondRequest).toHaveBeenCalledTimes(1);
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      respondRequest.mockResolvedValueOnce(undefined);
      await engine.dispatch({ type: 'respondRequest', reply });
      expect(latest().requests).toHaveLength(0);
      expect(latest().failedRequest).toBeNull();
      await engine.dispatch({ type: 'disconnect' }); await engine.dispatch({ type: 'reconnect' });
      expect(latest().requests).toHaveLength(0);
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      const other = latest().requests[0]!;
      expect(other.request.id).toBe('same-id');
      respondRequest.mockImplementationOnce(async () => { reviewerPending = false; throw new Error('Already answered on desktop'); });
      await engine.dispatch({ type: 'respondRequest', reply: { target: other.target, id: other.request.id, conversationId: other.request.conversationId, outcome: { kind: 'cancelled' } } });
      expect(latest()).toMatchObject({ requests: [], failedRequest: null, respondingRequest: null });
      reviewerPending = true;
      await engine.dispatch({ type: 'disconnect' }); await engine.dispatch({ type: 'reconnect' });
      expect(latest().requests).toHaveLength(0);
    } finally { engine.dispose(); }
  });

  it('dismisses questions locally across catch-up without hiding approvals, another agent or a changed question', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let text = 'Old question';
    const respondRequest = vi.fn(async (_reply: import('@workspace/core/companion-protocol').CompanionRequestReply) => {});
    connector.connect = async id => {
      const session = await connect(id);
      return { ...session, respondRequest, getWorkspace: async () => ({ ...await session.getWorkspace(), agentRequests: Object.fromEntries(['demo-agent', 'demo-reviewer'].map(id => [id, [
        { id: 'q', conversationId: 'conversation', kind: 'question' as const, question: { itemId: 'q', delivery: 'async' as const, blocking: false, questions: [{ id: 'q', header: 'Choice', question: text, isOther: true, isSecret: false, options: null }] } },
        { id: 'approval', conversationId: 'conversation', kind: 'approval' as const, approval: { id: 'approval', itemId: 'approval-item', conversationId: 'conversation', kind: 'command' as const, title: 'Run?', allowedScopes: ['once' as const] } },
      ]])) }) };
    };
    const { engine, latest } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'draft', text: 'Keep my prompt' });
      const [question, approval] = latest().requests;
      await engine.dispatch({ type: 'dismissRequest', key: approval!.key });
      expect(latest().requests).toHaveLength(2);
      await engine.dispatch({ type: 'disconnect' });
      await engine.dispatch({ type: 'dismissRequest', key: question!.key });
      expect(latest().requests.map(entry => entry.request.kind)).toEqual(['approval']);
      expect(respondRequest).not.toHaveBeenCalled();
      await engine.dispatch({ type: 'reconnect' });
      expect(latest().requests.map(entry => entry.request.kind)).toEqual(['approval']);
      expect(latest().draft).toBe('Keep my prompt');
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      expect(latest().requests).toHaveLength(2);
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(latest().requests).toHaveLength(1);
      text = 'A new question';
      await engine.dispatch({ type: 'disconnect' }); await engine.dispatch({ type: 'reconnect' });
      expect(latest().requests).toHaveLength(2);
      const optional = latest().requests.find(entry => entry.request.kind === 'question')!;
      respondRequest.mockRejectedValueOnce(new Error('Cancellation could not be confirmed'));
      await engine.dispatch({ type: 'respondRequest', reply: { target: optional.target, id: optional.request.id, conversationId: optional.request.conversationId, outcome: { kind: 'cancelled' } } });
      expect(latest().requests.map(entry => entry.request.kind)).toEqual(['approval']);
      expect(latest().failedRequest).toBeNull();
      expect(respondRequest).toHaveBeenCalledExactlyOnceWith({ target: optional.target, id: optional.request.id, conversationId: optional.request.conversationId, outcome: { kind: 'cancelled' } });
    } finally { engine.dispose(); }
  });

  it('reports stop failures, prevents duplicate actions, and rehydrates an empty restarted session without losing the draft', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    const interrupt = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined);
    let finish!: () => void; let restarted = false;
    const restartSession = vi.fn(async () => { await new Promise<void>((resolve) => { finish = resolve; }); restarted = true; });
    connector.connect = async (id) => {
      const session = await original(id);
      return { ...session, interrupt, restartSession, loadConversation: async (id: string) => restarted ? null : session.loadConversation(id) };
    };
    const { engine, latest, events } = open(connector);
    try {
      await engine.start();
      await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await engine.dispatch({ type: 'draft', text: 'Keep my draft' });
      await engine.dispatch({ type: 'interrupt' });
      expect(latest().sessionActionFailed).toBe(true);
      await engine.dispatch({ type: 'dismissSessionError' });
      expect(latest().sessionActionFailed).toBe(false);
      await engine.dispatch({ type: 'interrupt' });
      const restarting = engine.dispatch({ type: 'restartSession' });
      expect(latest()).toMatchObject({ sessionAction: 'restart', canSend: false });
      await engine.dispatch({ type: 'restartSession' });
      expect(restartSession).toHaveBeenCalledExactlyOnceWith('demo-agent');
      finish(); await restarting;
      expect(latest()).toMatchObject({ agentId: 'demo-agent', sessionAction: null, sessionActionFailed: false, draft: 'Keep my draft', canSend: true });
      expect(shown(events)).toMatchObject({ frame: null, ready: true });
    } finally { engine.dispose(); }
  });
  function selectionStorage() {
    const values = new Map<string, string>();
    return createSelectionStore({
      read: async ({ key }) => ({ value: values.get(key) ?? null }),
      write: async ({ key, value }) => { values.set(key, value); },
      remove: async ({ key }) => { values.delete(key); },
    });
  }
  it('shows all teams from the loaded workspace without extra reads and keeps chat actions and saved selection on the owning team', async () => {
    const store = selectionStorage();
    const connector = createDemoConnector(); const connect = connector.connect;
    let workspace: CompanionWorkspace;
    let update!: Parameters<NonNullable<CompanionSession['onUpdate']>>[0];
    const getWorkspace = vi.fn(async () => workspace);
    const sendPrompt = vi.fn<CompanionSession['sendPrompt']>(async () => {});
    const createQuickChat = vi.fn(async () => 'demo-reviewer');
    const loadConversation = vi.fn();
    connector.connect = async id => {
      const session = await connect(id);
      workspace ??= { ...await session.getWorkspace(),
        teams: [{ id: 'demo-team', name: 'First', agentIds: ['demo-agent'] }, { id: 'second-team', name: 'Second', agentIds: ['demo-reviewer'] }],
        agents: (await session.getWorkspace()).agents.map(agent => ({ ...agent, teamId: agent.id === 'demo-reviewer' ? 'second-team' : 'demo-team' })),
        backends: { 'demo-team': ['codex'], 'second-team': ['codex'] } };
      return { ...session, getWorkspace, sendPrompt, createQuickChat,
        loadConversation: async agentId => { loadConversation(agentId); return session.loadConversation(agentId); },
        onUpdate(listener) { update = listener; return () => {}; } };
    };
    const first = open(connector, store);
    const ids = () => first.latest().groups.flatMap(group => group.sessions.map(agent => agent.agentId));
    try {
      await first.engine.start();
      expect(ids()).toEqual(['demo-agent']);
      const loads = loadConversation.mock.calls.length;
      await first.engine.dispatch({ type: 'selectAllTeams' });
      expect(first.latest()).toMatchObject({ allTeams: true, agentId: 'demo-agent', teamId: 'demo-team' });
      expect(ids()).toEqual(['demo-agent', 'demo-reviewer']);
      expect(first.latest().activityGroups.flatMap(group => group.sessions.map(agent => agent.agentId))).toEqual(ids());
      expect(getWorkspace).toHaveBeenCalledTimes(1);
      expect(loadConversation).toHaveBeenCalledTimes(loads);
      workspace = { ...workspace!, agents: workspace!.agents.map(agent => agent.id === 'demo-reviewer' ? { ...agent, status: { type: 'working' } } : agent) };
      update(workspace, null); await nextTick();
      expect(first.latest().activityGroups.find(group => group.activity === 'working')?.sessions.map(agent => agent.agentId)).toEqual(['demo-reviewer']);
      expect(getWorkspace).toHaveBeenCalledTimes(1);
      await first.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      expect(first.latest()).toMatchObject({ allTeams: true, teamId: 'second-team', agentId: 'demo-reviewer', composerTarget: { teamId: 'second-team', agentId: 'demo-reviewer' } });
      expect(ids()).toHaveLength(2);
      expect(getWorkspace).toHaveBeenCalledTimes(1);
      await first.engine.dispatch({ type: 'send', text: 'For the second team' });
      expect(sendPrompt.mock.calls[0]?.[0]).toMatchObject({ teamId: 'second-team', agentId: 'demo-reviewer' });
      await first.engine.dispatch({ type: 'newQuickChat', backend: 'codex' });
      expect(createQuickChat).toHaveBeenCalledExactlyOnceWith({ teamId: 'second-team', backend: 'codex' });
      expect(await store.read('demo-laptop')).toEqual({ teamId: 'second-team', agentId: 'demo-reviewer', allTeams: true });
    } finally { first.engine.dispose(); }
    const restored = open(connector, store);
    try {
      await restored.engine.start();
      expect(restored.latest()).toMatchObject({ allTeams: true, teamId: 'second-team', agentId: 'demo-reviewer' });
      expect(restored.latest().groups.flatMap(group => group.sessions)).toHaveLength(2);
      await restored.engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      expect(restored.latest()).toMatchObject({ allTeams: false, teamId: 'demo-team', agentId: 'demo-agent' });
      expect(restored.latest().groups.flatMap(group => group.sessions.map(agent => agent.agentId))).toEqual(['demo-agent']);
      await restored.engine.dispatch({ type: 'selectAllTeams' });
      workspace = { ...workspace!, teams: [workspace!.teams[0]!], agents: [workspace!.agents[0]!] };
      update(workspace, null); await nextTick();
      expect(restored.latest().allTeams).toBe(false);
      expect(restored.latest().groups.flatMap(group => group.sessions)).toHaveLength(1);
    } finally { restored.engine.dispose(); }
  });
  it('routes repository branch reads and creation from All to the repository owner without changing scope', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const listBranches = vi.fn(async () => []);
    const createChat = vi.fn(async () => 'demo-reviewer');
    connector.connect = async id => {
      const session = await connect(id); const workspace = await session.getWorkspace();
      return { ...session, listBranches, createChat, getWorkspace: async () => ({ ...workspace,
        teams: [{ id: 'demo-team', name: 'First', agentIds: ['demo-agent'] }, { id: 'second-team', name: 'Second', agentIds: ['demo-reviewer'] }],
        agents: workspace.agents.map(agent => agent.id !== 'demo-reviewer' ? agent : { ...agent, teamId: 'second-team', workspace: {
          kind: 'git' as const, folder: '/second/repo', repositoryRoot: '/second/repo', primaryWorktreeRoot: '/second/repo',
          repositoryName: 'Second repo', branch: 'main', defaultBranch: 'main', isLinkedWorktree: false, updatedAt: agent.updatedAt,
        } }), backends: { 'demo-team': ['codex'], 'second-team': ['codex'] } }) };
    };
    const { engine, latest } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'selectAllTeams' });
      await engine.dispatch({ type: 'loadBranches', repositoryId: '/second/repo' });
      expect(listBranches).toHaveBeenCalledExactlyOnceWith('second-team', '/second/repo');
      expect(latest()).toMatchObject({ teamId: 'demo-team', allTeams: true });
      await engine.dispatch({ type: 'newChat', repositoryId: '/second/repo', backend: 'codex', existingBranch: 'main' });
      expect(createChat).toHaveBeenCalledExactlyOnceWith({ teamId: 'second-team', repositoryId: '/second/repo', backend: 'codex', existingBranch: 'main' });
      expect(latest()).toMatchObject({ teamId: 'second-team', agentId: 'demo-reviewer', allTeams: true, chatCreation: 'idle' });
    } finally { engine.dispose(); }
  });
  it('creates a named team once, keeps errors retryable, and selects its empty workspace without losing the previous draft', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let workspace: CompanionWorkspace;
    let finish!: () => void;
    const createTeam = vi.fn<(name: string) => Promise<string>>(async () => { throw new Error('Unavailable'); });
    connector.connect = async id => {
      const session = await connect(id); workspace ??= await session.getWorkspace();
      return { ...session, getWorkspace: async () => workspace, createTeam };
    };
    const store = selectionStorage(); const { engine, latest } = open(connector, store);
    try {
      await engine.start(); await engine.dispatch({ type: 'draft', text: 'Keep this draft' });
      await engine.dispatch({ type: 'createTeam', name: '  ' });
      expect(createTeam).not.toHaveBeenCalled();
      await engine.dispatch({ type: 'createTeam', name: '  Mobile team  ' });
      expect(createTeam).toHaveBeenCalledExactlyOnceWith('Mobile team');
      expect(latest()).toMatchObject({ teamCreation: 'failed', teamId: 'demo-team', draft: 'Keep this draft' });
      await engine.dispatch({ type: 'dismissTeamCreation' });
      expect(latest().teamCreation).toBe('idle');
      createTeam.mockImplementation(async name => {
        await new Promise<void>(resolve => { finish = resolve; });
        workspace = { ...workspace, teams: [...workspace.teams, { id: 'new-team', name, agentIds: [] }] };
        return 'new-team';
      });
      const creating = engine.dispatch({ type: 'createTeam', name: 'Mobile team' });
      expect(latest().teamCreation).toBe('creating');
      await engine.dispatch({ type: 'createTeam', name: 'Duplicate' });
      expect(createTeam).toHaveBeenCalledTimes(2);
      finish(); await creating;
      expect(latest()).toMatchObject({ teamCreation: 'idle', teamId: 'new-team', agentId: '', allTeams: false, groups: [], canSend: false });
      expect(latest().teams.find(team => team.id === 'new-team')?.name).toBe('Mobile team');
      expect(await store.read('demo-laptop')).toEqual({ teamId: 'new-team', agentId: '' });
      await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      expect(latest().draft).toBe('Keep this draft');
      await engine.dispatch({ type: 'disconnect' });
      await engine.dispatch({ type: 'createTeam', name: 'Offline' });
      expect(createTeam).toHaveBeenCalledTimes(2);
    } finally { engine.dispose(); }
  });
  it('restores the last opened team and agent after restarting, separately for each laptop', async () => {
    const store = selectionStorage();
    await store.write('another-laptop', { teamId: 'other-team', agentId: 'other-agent' });
    const first = open(createDemoConnector(), store);
    await first.engine.start();
    expect(first.latest()).toMatchObject({ teamId: 'demo-team', agentId: 'demo-agent' });
    await first.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
    first.engine.dispose();
    const restored = open(createDemoConnector(), store);
    try {
      await restored.engine.start();
      expect(restored.latest()).toMatchObject({ teamId: 'demo-team', agentId: 'demo-reviewer', canSend: true });
      expect(await store.read('another-laptop')).toEqual({ teamId: 'other-team', agentId: 'other-agent' });
      await restored.engine.dispatch({ type: 'forget' });
      expect(await store.read('demo-laptop')).toBeNull();
    } finally { restored.engine.dispose(); }
  });
  it.each([
    { name: 'missing agent', saved: { teamId: 'second-team', agentId: 'gone' }, teamId: 'second-team', agentId: 'second-agent' },
    { name: 'agent moved to another team', saved: { teamId: 'demo-team', agentId: 'second-agent' }, teamId: 'demo-team', agentId: 'demo-agent' },
    { name: 'missing team', saved: { teamId: 'gone', agentId: 'demo-agent' }, teamId: 'demo-team', agentId: 'demo-agent' },
    { name: 'no saved agent', saved: { teamId: 'demo-team', agentId: '' }, teamId: 'demo-team', agentId: 'demo-agent' },
    { name: 'valid saved agent', saved: { teamId: 'demo-team', agentId: 'demo-reviewer' }, teamId: 'demo-team', agentId: 'demo-reviewer' },
    { name: 'empty team', saved: { teamId: 'empty-team', agentId: 'gone' }, teamId: 'empty-team', agentId: '' },
  ])('restores the saved selection or most recent fallback for $name', async ({ saved, teamId, agentId }) => {
    const store = selectionStorage(); await store.write('demo-laptop', saved);
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async (id) => {
      const session = await connect(id); const workspace = await session.getWorkspace();
      return { ...session, loadConversation: async () => null, getWorkspace: async () => ({
        teams: [{ ...workspace.teams[0]!, agentIds: ['demo-reviewer', 'demo-agent'] },
          { id: 'second-team', name: 'Second', agentIds: ['second-agent'] }, { id: 'empty-team', name: 'Empty', agentIds: [] }],
        agents: [...workspace.agents.map(agent => ({ ...agent,
          lastActivityAt: agent.id === 'demo-agent' ? '2026-10-16T12:00:00Z' : '2026-10-16T11:00:00Z',
          updatedAt: agent.id === 'demo-reviewer' ? '2027-01-01T00:00:00Z' : agent.updatedAt,
        })), { ...workspace.agents[0]!, id: 'second-agent', teamId: 'second-team', lastActivityAt: '2026-10-16T13:00:00Z' }],
      }) };
    };
    const { engine, latest } = open(connector, store);
    try {
      await engine.start();
      expect(latest()).toMatchObject({ teamId, agentId });
      expect(await store.read('demo-laptop')).toEqual({ teamId, agentId });
    } finally { engine.dispose(); }
  });
  it('opens the most recent conversation when selection is empty, preserving valid choices through updates and reconnects', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let workspace: CompanionWorkspace;
    let update!: Parameters<NonNullable<CompanionSession['onUpdate']>>[0];
    connector.connect = async id => {
      const session = await connect(id);
      workspace ??= await session.getWorkspace();
      if (workspace.teams.length === 1) {
        workspace = { ...workspace, teams: [...workspace.teams, { id: 'empty', name: 'Empty', agentIds: [] }],
          agents: workspace.agents.map(agent => ({ ...agent, lastActivityAt: agent.id === 'demo-reviewer'
            ? '2026-10-16T12:00:00Z' : '2026-10-16T11:00:00Z' })) };
      }
      return { ...session, getWorkspace: async () => workspace,
        onUpdate(listener) { update = listener; return () => {}; } };
    };
    const { engine, latest } = open(connector);
    const publish = async () => { update(workspace, null); await nextTick(); };
    try {
      // No selection store: fresh launch must still load a real conversation.
      await engine.start();
      expect(latest()).toMatchObject({ teamId: 'demo-team', agentId: 'demo-reviewer', conversationReady: true, canSend: true });
      workspace = { ...workspace!, agents: workspace!.agents.map(agent => agent.id === 'demo-agent'
        ? { ...agent, lastActivityAt: '2026-10-16T13:00:00Z' } : agent) };
      await publish();
      expect(latest().agentId).toBe('demo-reviewer');
      await engine.dispatch({ type: 'selectTeam', id: 'empty' });
      expect(latest()).toMatchObject({ teamId: 'empty', agentId: '', canSend: false });
      await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      expect(latest()).toMatchObject({ agentId: 'demo-agent', conversationReady: true });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      expect(latest().agentId).toBe('demo-reviewer');
      // A workspace push removes the selected agent; load the remaining conversation.
      const reviewer = workspace.agents.find(agent => agent.id === 'demo-reviewer')!;
      workspace = { ...workspace, agents: workspace.agents.filter(agent => agent.id !== reviewer.id) };
      await publish();
      await vi.waitFor(() => expect(latest()).toMatchObject({ agentId: 'demo-agent', conversationReady: true }));
      await engine.dispatch({ type: 'disconnect' });
      workspace = { ...workspace, agents: [reviewer] };
      await engine.dispatch({ type: 'reconnect' });
      expect(latest()).toMatchObject({ agentId: 'demo-reviewer', conversationReady: true });
      await engine.dispatch({ type: 'selectTeam', id: 'empty' });
      workspace = { ...workspace, agents: [...workspace.agents, { ...reviewer, id: 'demo-agent', teamId: 'empty' }] };
      await publish();
      await vi.waitFor(() => expect(latest()).toMatchObject({ teamId: 'empty', agentId: 'demo-agent', conversationReady: true }));
    } finally { engine.dispose(); }
  });
  it('does not replace a user selection when a slow saved-selection read completes', async () => {
    const store = selectionStorage();
    let finish!: (selection: { teamId: string; agentId: string }) => void;
    store.read = () => new Promise((resolve) => { finish = resolve; });
    const { engine, latest } = open(createDemoConnector(), store);
    try {
      const starting = engine.start();
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      finish({ teamId: 'demo-team', agentId: 'demo-agent' }); await starting;
      expect(latest()).toMatchObject({ teamId: 'demo-team', agentId: 'demo-reviewer' });
    } finally { engine.dispose(); }
  });
  it('opens an empty workspace without a stale selection', async () => {
    const store = selectionStorage(); await store.write('demo-laptop', { teamId: 'gone', agentId: 'gone' });
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async (id) => ({ ...await connect(id), getWorkspace: async () => ({ teams: [], agents: [] }) });
    const { engine, latest } = open(connector, store);
    try {
      await engine.start();
      expect(latest()).toMatchObject({ startup: 'ready', teamId: '', agentId: '', canSend: false });
    } finally { engine.dispose(); }
  });
  it('keeps an already displayed conversation visible while reconnecting', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let finish!: () => void;
    const { engine, latest, events } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const frame = events.filter((event) => event.type === 'conversation').at(-1)!.frame;
      await engine.dispatch({ type: 'disconnect' });
      connector.connect = async (id) => {
        const session = await connect(id);
        return { ...session, loadConversation: async (agentId) => {
          await new Promise<void>((resolve) => { finish = resolve; });
          return session.loadConversation(agentId);
        } };
      };
      const reconnected = engine.dispatch({ type: 'reconnect' });
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      expect(latest()).toMatchObject({ loading: false, canSend: false });
      expect(events.filter((event) => event.type === 'conversation').at(-1)!.frame).toEqual(frame);
      finish(); await reconnected;
      expect(latest()).toMatchObject({ loading: false, canSend: true });
    } finally { engine.dispose(); }
  });
  it('marks a new conversation ready even before it has a provider session', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async (id) => ({ ...await connect(id), loadConversation: async () => null });
    const { engine, events } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(shown(events)).toMatchObject({ agentId: 'demo-agent', ready: true, frame: null });
    } finally { engine.dispose(); }
  });
  it.each([true, false])('restores saved pairing and offers connect when its host is unavailable (available=%s)', async available => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let initialized!: () => void; let connected!: () => void;
    connector.initialize = () => new Promise<void>((resolve) => { initialized = resolve; });
    connector.connect = vi.fn(async (id) => { await new Promise<void>((resolve) => { connected = resolve; }); if (!available) throw new Error('Host unavailable'); return connect(id); });
    const { engine, latest, states } = open(connector);
    expect(latest().startup).toBe('loading');
    const starting = engine.start();
    await Promise.resolve();
    expect(latest().startup).toBe('loading');
    initialized(); await vi.waitFor(() => expect(latest().connection).toBe('connecting'));
    expect(latest().startup).toBe('loading');
    connected(); await starting;
    expect(latest()).toMatchObject({ startup: 'ready', connection: available ? 'connected' : 'unpaired' });
    if (available) expect(states().some((state) => state.startup === 'ready' && state.connection === 'unpaired')).toBe(false);
    else {
      expect(latest().laptops).toHaveLength(1);
      connector.connect = connect;
      await engine.dispatch({ type: 'connect', laptopId: 'demo-laptop' });
      expect(latest().connection).toBe('connected');
    }
    engine.dispose();
  });
  it.each(['retry', 'foreground', 'during restore'])('checks storage before pairing and recovers from a storage failure on %s', async recovery => {
    const connector = unpaired();
    let fail!: (error: Error) => void;
    connector.initialize = vi.fn().mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; })).mockResolvedValue(undefined);
    const { engine, latest } = open(connector);
    try {
      const starting = engine.start();
      expect(latest().startup).toBe('loading');
      const resumed = recovery === 'during restore' ? engine.dispatch({ type: 'activity', active: true }) : undefined;
      fail(new Error('Keychain unavailable')); await starting;
      if (resumed) await resumed;
      else {
        expect(latest().startup).toBe('error');
        await engine.dispatch(recovery === 'retry' ? { type: 'start' } : { type: 'activity', active: true });
      }
      expect(latest()).toMatchObject({ startup: 'ready', connection: 'unpaired', laptops: [] });
      expect(connector.initialize).toHaveBeenCalledTimes(2);
    } finally { engine.dispose(); }
  });
  it('publishes conversation loading until the selected thread arrives and clears it on failure', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let complete!: () => void; let fail = false;
    connector.connect = async (id) => {
      const session = await connect(id);
      return { ...session, loadConversation: async (agentId) => {
        await new Promise<void>((resolve) => { complete = resolve; });
        if (fail) throw new Error('Unavailable');
        return session.loadConversation(agentId);
      } };
    };
    const { engine, latest, events } = open(connector);
    const first = engine.start();
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    expect(latest()).toMatchObject({ loading: true, canSend: false, agentId: 'demo-agent' });
    complete(); await first;
    expect(latest()).toMatchObject({ loading: false, canSend: true });
    fail = true;
    const second = engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
    await nextTick();
    expect(latest()).toMatchObject({ loading: true, canSend: false, agentId: 'demo-reviewer' });
    expect(events.filter((event) => event.type === 'conversation').at(-1)).toMatchObject({ frame: null, agentId: 'demo-reviewer' });
    complete(); await second;
    expect(latest()).toMatchObject({ loading: false, canSend: false, error: 'mobile.errors.loadConversation' });
    engine.dispose();
  });
  it('deduplicates history loads and ignores a result after the selected agent changes', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let complete!: (value: CompanionHistoryPage) => void;
    const loadOlderHistory = vi.fn(() => new Promise<CompanionHistoryPage>((resolve) => { complete = resolve; }));
    connector.connect = async (id) => ({ ...await connect(id), loadOlderHistory });
    const { engine, events } = open(connector);
    await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
    const first = engine.dispatch({ type: 'loadOlder', agentId: 'demo-agent' });
    await engine.dispatch({ type: 'loadOlder', agentId: 'demo-agent' });
    expect(loadOlderHistory).toHaveBeenCalledTimes(1);
    await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
    const old = await (await connect('demo-laptop')).loadConversation('demo-agent');
    complete({ frame: old!, hasOlder: false }); await first;
    const last = events.filter((event) => event.type === 'conversation').at(-1);
    expect(last).toMatchObject({ agentId: 'demo-reviewer', frame: { agentId: 'demo-reviewer' }, history: { loadingOlder: false } });
    engine.dispose();
  });
  it('keeps existing messages after a failed history request, allows retry, and stops at the oldest page', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const earlier = (await (await connect('demo-laptop')).loadConversation('demo-agent'))!;
    const loadOlderHistory = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ frame: earlier, hasOlder: false });
    connector.connect = async (id) => ({ ...await connect(id), loadOlderHistory });
    const { engine, events } = open(connector);
    const conversation = () => shown(events)!;
    await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
    const original = conversation().frame;
    await engine.dispatch({ type: 'loadOlder', agentId: 'demo-agent' });
    await vi.waitFor(() => expect(conversation()).toMatchObject({ frame: original, history: { hasOlder: true, loadingOlder: false, failed: true } }));
    await engine.dispatch({ type: 'loadOlder', agentId: 'demo-agent' });
    await vi.waitFor(() => expect(conversation()).toMatchObject({ frame: earlier, history: { hasOlder: false, loadingOlder: false, failed: false } }));
    await engine.dispatch({ type: 'loadOlder', agentId: 'demo-agent' });
    expect(loadOlderHistory).toHaveBeenCalledTimes(2);
    engine.dispose();
  });
  it('opens its single saved laptop, then shows the first agent\'s group, header and conversation', async () => {
    const { engine, events, states } = open();
    await engine.start();
    await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
    await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
    await vi.waitFor(() => expect(states().at(-1)?.agentId).toBe('demo-agent'));
    const state = states().at(-1)!;
    expect(state.connection).toBe('connected');
    expect(state.groups.map((group) => group.label)).toStrictEqual(['Builder', 'Reviewer']);
    expect(state.header).toMatchObject({ title: 'Builder', repository: null, status: 'idle' });
    const conversation = [...events].reverse().find((event) => event.type === 'conversation');
    expect(conversation).toMatchObject({ type: 'conversation', agentId: 'demo-agent', agent: { id: 'demo-agent' } });
    engine.dispose();
  });
  it.each([true, false])('reopens the last successful laptop among several, including after unlocking (foreground=%s)', async foreground => {
    const store = selectionStorage();
    const makeConnector = () => {
      const connector = createDemoConnector();
      connector.laptops = [{ id: 'other', name: 'Other computer' }, { id: 'demo-laptop', name: 'My laptop' }];
      return connector;
    };
    await store.writeLastLaptop('forgotten-host');
    const first = open(makeConnector(), store);
    await first.engine.start();
    expect(first.latest().connection).toBe('unpaired');
    await first.engine.dispatch({ type: 'connect', laptopId: 'demo-laptop' });
    await first.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
    first.engine.dispose();
    const connector = makeConnector(); const connect = vi.spyOn(connector, 'connect');
    const engine = createEngine({ connector, selectionStore: store, initialActive: foreground, post: () => {} });
    try {
      await engine.start();
      if (!foreground) {
        expect(connect).not.toHaveBeenCalled();
        await engine.dispatch({ type: 'activity', active: true });
      }
      expect(engine.snapshot()).toMatchObject({ laptopId: 'demo-laptop', connection: 'connected', agentId: 'demo-reviewer' });
      expect(connect).toHaveBeenCalledExactlyOnceWith('demo-laptop');
      connector.connect = vi.fn(async () => { throw new Error('Unavailable'); });
      await engine.dispatch({ type: 'connect', laptopId: 'other' });
      expect(await store.readLastLaptop()).toBe('demo-laptop');
    } finally { engine.dispose(); }
  });
  it('manages saved connections without forgetting the active laptop or losing its draft', async () => {
    const store = selectionStorage();
    const connector = createDemoConnector();
    connector.laptops = [{ id: 'other', name: 'Other computer' }, { id: 'demo-laptop', name: 'My laptop' }];
    connector.revoke = vi.fn(async id => {
      connector.laptops = connector.laptops.filter(laptop => laptop.id !== id);
      if (id === 'other') throw new Error('Old computer offline');
    });
    const { engine, latest } = open(connector, store);
    try {
      await engine.start();
      await engine.dispatch({ type: 'connect', laptopId: 'demo-laptop' });
      await engine.dispatch({ type: 'draft', text: 'Keep my draft' });
      await engine.dispatch({ type: 'forget', laptopId: 'other' });
      expect(latest()).toMatchObject({ laptopId: 'demo-laptop', connection: 'connected', draft: 'Keep my draft', laptops: [{ id: 'demo-laptop', name: 'My laptop' }] });
      expect(await store.readLastLaptop()).toBe('demo-laptop');
      await engine.dispatch({ type: 'chooseConnection' });
      expect(latest()).toMatchObject({ laptopId: '', connection: 'unpaired', teamId: '', agentId: '' });
      expect(latest().laptops).toHaveLength(1);
      await engine.dispatch({ type: 'activity', active: false });
      await engine.dispatch({ type: 'activity', active: true });
      expect(latest().connection).toBe('unpaired');
      await engine.dispatch({ type: 'connect', laptopId: 'demo-laptop' });
      expect(latest()).toMatchObject({ connection: 'connected', draft: 'Keep my draft' });
      await engine.dispatch({ type: 'forget', laptopId: 'demo-laptop' });
      expect(latest()).toMatchObject({ connection: 'revoked', laptops: [] });
      expect(await store.readLastLaptop()).toBeNull();
    } finally { engine.dispose(); }
  });
  it('keeps follow-up suggestions scoped to the selected agent, updates them live and leaves drafts untouched', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let publish!: () => void;
    let suggestion: string | undefined = 'Run the tests';
    connector.connect = async id => {
      const session = await connect(id);
      const getWorkspace = async () => {
        const workspace = await session.getWorkspace();
        return { ...workspace, agents: workspace.agents.map(agent => agent.id === 'demo-agent' ? { ...agent, suggestedPrompt: suggestion } : agent) };
      };
      return { ...session, getWorkspace, onUpdate(listener) {
        publish = async () => listener(await getWorkspace(), null);
        return () => {};
      } };
    };
    const { engine, latest } = open(connector);
    try {
      await engine.start();
      expect(latest().suggestedPrompt).toBe('Run the tests');
      expect(latest().draft).toBe('');
      await engine.dispatch({ type: 'draft', text: 'My own request' });
      suggestion = 'Review the changes'; await publish(); await nextTick();
      expect(latest()).toMatchObject({ suggestedPrompt: suggestion, draft: 'My own request' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      expect(latest().suggestedPrompt).toBeNull();
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(latest()).toMatchObject({ suggestedPrompt: suggestion, draft: 'My own request' });
      suggestion = undefined; await publish(); await nextTick();
      expect(latest()).toMatchObject({ suggestedPrompt: null, draft: 'My own request' });
    } finally { engine.dispose(); }
  });
  it('pairs with a code, reports awaiting approval, then connects', async () => {
    const connector = unpaired();
    connector.pair = vi.fn(async (_code, _name, pending) => { pending(); Object.defineProperty(connector, 'laptops', { value: [{ id: 'demo-laptop', name: 'Laptop' }] }); return 'demo-laptop'; });
    const { engine, states } = open(connector);
    await engine.start();
    await engine.dispatch({ type: 'pair', code: 'K7QDM2XP', deviceName: 'iPhone' });
    expect(connector.pair).toHaveBeenCalledWith('K7QDM2XP', 'iPhone', expect.any(Function));
    await vi.waitFor(() => expect(states().at(-1)?.connection).toBe('connected'));
    expect(states().some((state) => state.pairing === 'awaitingApproval')).toBe(true);
    expect(states().at(-1)).toMatchObject({ pairing: 'idle', pairingError: '', laptops: [{ id: 'demo-laptop' }] });
    engine.dispose();
  });
  it('reports a failed pairing and lets the person try again', async () => {
    const connector = unpaired();
    connector.pair = vi.fn().mockRejectedValueOnce(new Error('mobile.errors.noLaptop')).mockResolvedValue('demo-laptop');
    const { engine, states } = open(connector);
    await engine.dispatch({ type: 'pair', code: 'AAAABBBB', deviceName: 'iPhone' });
    await vi.waitFor(() => expect(states().at(-1)?.pairingError).toBe('mobile.errors.noLaptop'));
    expect(states().at(-1)?.pairing).toBe('idle');
    engine.dispose();
  });
  it('sends prompts, keeps the draft in step and forwards composer commands', async () => {
    const connector = createDemoConnector(); const original = connector.connect; const sendPrompt = vi.fn(async () => {}); const interrupt = vi.fn(async () => {});
    connector.connect = async (id) => ({ ...await original(id), sendPrompt, interrupt });
    const { engine, latest } = open(connector);
    await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
    await engine.dispatch({ type: 'draft', text: 'Hello' });
    expect(latest().draft).toBe('Hello');
    await engine.dispatch({ type: 'send', text: 'Hello' });
    expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'demo-agent' }), 'Hello', expect.any(String), expect.anything());
    await engine.dispatch({ type: 'interrupt' });
    expect(interrupt).toHaveBeenCalledWith('demo-agent');
    engine.dispose();
  });
  it('exposes service tiers to native controls and saves Fast and Standard for subsequent prompts', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    const selectModel = vi.fn(async () => {}); const sendPrompt = vi.fn(async () => {});
    connector.connect = async id => ({ ...await original(id), selectModel, sendPrompt,
      listModels: async () => [{ id: 'model', model: 'model', displayName: 'Model', isDefault: true,
        defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }],
        serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }], defaultServiceTier: null }],
    });
    const { engine, latest } = open(connector);
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await vi.waitFor(() => expect(latest().models).toStrictEqual([{ id: 'model', name: 'Model', efforts: ['high'], tiers: [{ id: 'fast', name: 'Fast' }] }]));
      expect(latest().capabilities.serviceTier).toBe(true);
      for (const serviceTier of ['fast', null]) {
        await engine.dispatch({ type: 'composer', change: { serviceTier } });
        expect(latest().composer.serviceTier).toBe(serviceTier);
        expect(selectModel).toHaveBeenLastCalledWith('demo-agent', { model: 'model', reasoningEffort: 'high', serviceTier });
        await engine.dispatch({ type: 'send', text: 'Continue' });
        expect(sendPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'demo-agent' }), 'Continue', expect.any(String), expect.objectContaining({ serviceTier }));
      }
    } finally { engine.dispose(); }
  });
  describe('a prompt Claude has not published yet', () => {
    // Claude publishes the prompt on the next read; the phone has to show it before that.
    function claude(published: { texts: string[] }, sendPrompt: () => Promise<void> = async () => {}) {
      const connector = createDemoConnector(); const original = connector.connect;
      connector.connect = async (id) => {
        const session = await original(id); const workspace = await session.getWorkspace();
        return { ...session, sendPrompt,
          getWorkspace: async () => ({ ...workspace, agents: workspace.agents.map((agent) => ({ ...agent, backend: 'claude' as const })) }),
          loadConversation: async (agentId) => ({ type: 'claude.conversationSnapshotChanged', seq: 1, occurredAt: '2026-01-01T00:00:00Z', agentId, backend: 'claude', payload: { revision: 1, snapshot: {
            agentId, sessionId: 's', activeTurnId: null, turnIds: [], turns: [], answeredClientRequestIds: [], busy: false, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false },
            contextUsage: null, plan: null, error: null,
            messages: published.texts.map((text, index) => ({ id: `m${index}`, agentId, role: 'user' as const, status: 'complete' as const, createdAt: '2026-01-01T00:00:00Z', parts: [{ type: 'text' as const, text }] })),
          } } }) };
      };
      return connector;
    }
    const texts = (events: EngineEvent[]) => { const last = events.filter((event) => event.type === 'conversation').at(-1); return last?.type === 'conversation' && last.frame && 'messages' in last.frame.payload.snapshot ? last.frame.payload.snapshot.messages.map((message) => message.parts.map((part) => part.type === 'text' ? part.text : '').join('')) : []; };
    async function opened(published: { texts: string[] }, sendPrompt?: () => Promise<void>) {
      const harness = open(claude(published, sendPrompt));
      await harness.engine.start(); await harness.engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await harness.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      return harness;
    }
    it('shows it at once and does not duplicate it once it is published', async () => {
      const published = { texts: ['Earlier'] }; const { engine, events } = await opened(published);
      const content = [{ type: 'mention' as const, kind: 'skill' as const, id: '/skills/review/SKILL.md', label: 'Review', value: 'review' }];
      await engine.dispatch({ type: 'send', text: '$review', options: { content } });
      expect(texts(events)).toEqual(['Earlier', 'Review']);
      const shown = events.filter(event => event.type === 'conversation').at(-1);
      expect(shown?.type === 'conversation' && shown.frame?.payload.snapshot.messages.at(-1)).toMatchObject({ metadata: { promptContent: content } });
      published.texts.push('Review');
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(texts(events)).toEqual(['Earlier', 'Review']);
      engine.dispose();
    });
    it('is not hidden by an earlier identical prompt', async () => {
      const { engine, events } = await opened({ texts: ['Hello'] });
      await engine.dispatch({ type: 'send', text: 'Hello' });
      expect(texts(events)).toEqual(['Hello', 'Hello']);
      engine.dispose();
    });
    it('is withdrawn when delivery fails and after thirty quiet seconds', async () => {
      const failed = await opened({ texts: [] }, async () => { throw new Error('offline'); });
      await failed.engine.dispatch({ type: 'send', text: 'Hello' });
      expect(texts(failed.events)).toEqual([]);
      failed.engine.dispose();
      vi.useFakeTimers();
      try {
        const quiet = await opened({ texts: [] });
        await quiet.engine.dispatch({ type: 'send', text: 'Hello' });
        expect(texts(quiet.events)).toEqual(['Hello']);
        await vi.advanceTimersByTimeAsync(30_001);
        expect(texts(quiet.events)).toEqual([]);
        quiet.engine.dispose();
      } finally { vi.useRealTimers(); }
    });
  });
  describe('starting a chat in a repository', () => {
    function withCreation(createChat: NonNullable<Awaited<ReturnType<ReturnType<typeof createDemoConnector>['connect']>>['createChat']>) {
      const connector = createDemoConnector(); const original = connector.connect;
      connector.connect = async (id) => {
        const session = await original(id);
        return { ...session, createChat, getWorkspace: async () => ({ ...await session.getWorkspace(), backends: { 'demo-team': ['codex', 'claude'] as ('codex' | 'claude')[] } }) };
      };
      return connector;
    }
    async function opened(createChat: Parameters<typeof withCreation>[0]) {
      const harness = open(withCreation(createChat));
      await harness.engine.start(); await harness.engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      return harness;
    }
    it('offers the team\'s engines, then opens the chat the laptop made', async () => {
      const createChat = vi.fn(async () => 'demo-reviewer');
      const { engine, latest } = await opened(createChat);
      expect(latest()).toMatchObject({ backends: ['codex', 'claude'], chatCreation: 'idle' });
      await engine.dispatch({ type: 'newChat', repositoryId: '/abc/repo', backend: 'claude', branchName: 'feature' });
      expect(createChat).toHaveBeenCalledWith({ teamId: 'demo-team', repositoryId: '/abc/repo', backend: 'claude', worktree: { branchName: 'feature' } });
      expect(latest()).toMatchObject({ agentId: 'demo-reviewer', chatCreation: 'idle' });
      engine.dispose();
    });
    it('presents a newly created empty quick chat with a render acknowledgment and engine choices', async () => {
      const connector = createDemoConnector(); const original = connector.connect; let created = false;
      let finishLoad!: (value: null) => void;
      const empty = new Promise<null>((resolve) => { finishLoad = resolve; });
      const createQuickChat = vi.fn(async () => { created = true; return 'new-chat'; });
      connector.connect = async (id) => {
        const session = await original(id);
        return { ...session, createQuickChat,
          loadConversation: (agentId) => agentId === 'new-chat' ? empty : session.loadConversation(agentId),
          getWorkspace: async () => {
            const workspace = await session.getWorkspace();
            return { ...workspace, backends: { 'demo-team': ['codex', 'claude'] as ('codex' | 'claude')[] },
              agents: [...workspace.agents, ...(created ? [{ ...workspace.agents[0]!, id: 'new-chat', backend: 'claude' as const, backendSession: undefined, sessionKind: 'quickChat' as const, hasSubmittedPrompt: false }] : [])] };
          } };
      };
      const { engine, latest, events } = open(connector);
      try {
        await engine.start();
        await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
        const creating = engine.dispatch({ type: 'newQuickChat', backend: 'claude' });
        await vi.waitFor(() => expect(latest()).toMatchObject({ agentId: 'new-chat', loading: true }));
        expect(events.filter((event) => event.type === 'conversation').at(-1)).toMatchObject({ agentId: 'new-chat', ready: false, frame: null });
        finishLoad(null); await creating;
        expect(createQuickChat).toHaveBeenCalledWith({ teamId: 'demo-team', backend: 'claude' });
        expect(latest()).toMatchObject({ agentId: 'new-chat', chatCreation: 'idle', loading: false, canSend: true });
        // Context-only updates cannot acknowledge painting to the native loading overlay.
        expect(events.filter((event) => event.type === 'conversation').at(-1)).toMatchObject({ agentId: 'new-chat', ready: true, frame: null,
          engines: { current: 'claude', choices: ['codex', 'claude'] } });
      } finally { engine.dispose(); }
    });
    it('uses the default checkout without a branch, reports a failure and lets it be dismissed', async () => {
      const createChat = vi.fn<Parameters<typeof withCreation>[0]>().mockRejectedValueOnce(new Error('Branch exists'));
      const { engine, latest } = await opened(createChat);
      const before = latest().agentId;
      await engine.dispatch({ type: 'newChat', repositoryId: '/abc/repo', backend: 'codex' });
      expect(createChat).toHaveBeenCalledWith({ teamId: 'demo-team', repositoryId: '/abc/repo', backend: 'codex' });
      expect(latest()).toMatchObject({ chatCreation: 'failed', agentId: before });
      await engine.dispatch({ type: 'dismissNewChat' });
      expect(latest().chatCreation).toBe('idle');
      engine.dispose();
    });
  });
  describe('choosing the engine of an empty chat', () => {
    function withBackends(setBackend: (agentId: string, backend: string) => Promise<void>, started = false) {
      const connector = createDemoConnector(); const original = connector.connect; let backend = 'codex';
      connector.connect = async (id) => {
        const session = await original(id);
        return { ...session, loadConversation: async () => null, setBackend: async (agentId, next) => { await setBackend(agentId, next); backend = next; },
          listModels: async () => [{ id: `${backend}-model`, model: `${backend}-model`, displayName: `${backend} model`, isDefault: true, hidden: false, supportedReasoningEfforts: [] } as never],
          getWorkspace: async () => { const workspace = await session.getWorkspace();
            return { ...workspace, backends: { 'demo-team': ['codex', 'claude'] as ('codex' | 'claude')[] },
              agents: workspace.agents.map((agent) => ({ ...agent, backend: backend as 'codex' | 'claude', ...(started ? { hasSubmittedPrompt: true } : {}) })) }; } };
      };
      return connector;
    }
    it('offers the choice before the first prompt and applies it', async () => {
      const setBackend = vi.fn(async () => {});
      const { engine, latest, events } = open(withBackends(setBackend));
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(latest()).toMatchObject({ backend: 'codex', canSelectBackend: true });
      await engine.dispatch({ type: 'backend', backend: 'claude' });
      expect(setBackend).toHaveBeenCalledWith('demo-agent', 'claude');
      expect(latest()).toMatchObject({ backend: 'claude', agentId: 'demo-agent' });
      // The old engine's models must not stay selectable for the new one.
      await vi.waitFor(() => expect(latest().models.map((model) => model.id)).toEqual(['claude-model']));
      expect(shown(events)).toMatchObject({ engines: { current: 'claude', choices: ['codex', 'claude'] } });
      engine.dispose();
    });
    it('ignores a model list that arrives late from the engine it replaced', async () => {
      const connector = createDemoConnector(); const original = connector.connect; let backend = 'codex'; let release = () => {};
      connector.connect = async (id) => {
        const session = await original(id); let first = true;
        return { ...session, loadConversation: async () => null, setBackend: async (_agent, next) => { backend = next; },
          listModels: async () => { const asked = backend; const model = { id: `${asked}-model`, model: `${asked}-model`, displayName: asked, isDefault: true, hidden: false, supportedReasoningEfforts: [] } as never;
            if (first) { first = false; await new Promise<void>((resolve) => { release = resolve; }); }
            return [model]; },
          getWorkspace: async () => { const workspace = await session.getWorkspace();
            return { ...workspace, backends: { 'demo-team': ['codex', 'claude'] as ('codex' | 'claude')[] }, agents: workspace.agents.map((agent) => ({ ...agent, backend: backend as 'codex' | 'claude' })) }; } };
      };
      const { engine, latest } = open(connector);
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await engine.dispatch({ type: 'backend', backend: 'claude' });
      await vi.waitFor(() => expect(latest().models.map((model) => model.id)).toEqual(['claude-model']));
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(latest().models.map((model) => model.id)).toEqual(['claude-model']);
      engine.dispose();
    });
    it('hides the choice once a prompt was sent, and reports a refusal', async () => {
      const started = open(withBackends(async () => {}, true));
      await started.engine.start(); await started.engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await started.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(started.latest().canSelectBackend).toBe(false);
      started.engine.dispose();
      const refused = open(withBackends(async () => { throw new Error('no'); }));
      await refused.engine.start(); await refused.engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await refused.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await refused.engine.dispatch({ type: 'backend', backend: 'claude' });
      expect(refused.latest()).toMatchObject({ backend: 'codex', error: 'mobile.errors.commandFailed' });
      refused.engine.dispose();
    });
  });
  it('forgets a laptop and reflects the empty list', async () => {
    const { engine, latest } = open();
    await engine.start();
    await engine.dispatch({ type: 'forget' });
    expect(latest().connection).toBe('revoked');
    engine.dispose();
  });
});

it('uses acknowledged transcript checkpoints for warm agent switching and recovers a lost native page', async () => {
  const connector = createDemoConnector();
  const connect = connector.connect;
  const { ConversationCache } = await import('../conversation-cache');
  const { companionTarget } = await import('@workspace/core/companion-protocol');
  let cache: InstanceType<typeof ConversationCache>;
  let workspace: CompanionWorkspace;
  const target = (id: string) => companionTarget('demo-laptop', workspace.teams[0]!, workspace.agents.find(a => a.id === id)!);
  const extended: import('../companion-port').CompanionConnector = { ...connector,
    cachedConversation: value => cache?.peek(value), conversationUpdates: (value, since) => cache?.updates(value, since) ?? null,
    async connect(id) {
      const session = await connect(id); const base = await session.getWorkspace(); workspace = { ...base, agents: base.agents.map(agent => ({ ...agent, backendSession: { kind: 'codex' as const, threadId: agent.id } })) };
      cache = new ConversationCache(async (_method, value) => { cache.receive((await session.loadConversation(value.agentId))!); }, () => {});
      return { ...session, getWorkspace: async () => workspace, cachedConversation: id => cache.peek(target(id)), loadConversation: id => cache.select(target(id)) };
    },
  };
  const events: EngineEvent[] = [];
  const engine = createEngine({ connector: extended, incrementalTranscript: true, post: event => { events.push(event); } });
  const transfers = () => events.filter(event => event.type === 'conversationTransfer');
  try {
    await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await nextTick();
    const first = transfers().at(-1)!;
    expect(first.frames).toHaveLength(1);
    await engine.dispatch({ type: 'transcriptApplied', identity: first.identity, checkpoint: first.checkpoint });
    await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
    await engine.dispatch({ type: 'selectAgent', id: first.agentId }); await nextTick();
    const warm = transfers().at(-1)!;
    expect(warm.identity).toBe(first.identity); expect(warm.frames).toStrictEqual([]);
    await engine.dispatch({ type: 'transcriptReset', identity: warm.identity }); await nextTick();
    expect(transfers().at(-1)!.frames).toHaveLength(1);
  } finally { engine.dispose(); cache!.close(); }
});

it('renames a paired laptop and shows the new name, leaving it alone when the name is refused', async () => {
  const connector = createDemoConnector(); const events: EngineEvent[] = [];
  const engine = createEngine({ connector, post: event => events.push(event) });
  const shownName = () => engine.snapshot().laptops[0]?.name;
  try {
    await engine.start();
    expect(shownName()).toBe('Demo laptop');
    await engine.dispatch({ type: 'renameLaptop', laptopId: 'demo-laptop', name: 'Work Mac' });
    expect(shownName()).toBe('Work Mac');
    await engine.dispatch({ type: 'renameLaptop', laptopId: 'someone-else', name: 'Other' });
    expect(shownName()).toBe('Work Mac');
  } finally { engine.dispose(); }
});
