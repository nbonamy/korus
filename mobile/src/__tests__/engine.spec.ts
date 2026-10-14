import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createDemoConnector } from '../demo-connector';
import { createEngine, type EngineEvent, type EngineState, type EnginePort } from '../engine';
import { createSelectionStore } from '../selection-store';
import type { CompanionHistoryPage } from '../companion-port';

const unpaired = () => { const connector = createDemoConnector(); Object.defineProperty(connector, 'laptops', { value: [] }); return connector; };
function open(connector = createDemoConnector(), selectionStore?: EnginePort['selectionStore']) {
  const events: EngineEvent[] = [];
  const engine = createEngine({ connector, selectionStore, post: (event) => events.push(event) });
  const states = () => events.flatMap((event) => event.type === 'state' ? [event.state] : []);
  const latest = (): EngineState => engine.snapshot();
  return { engine, events, states, latest };
}

describe('companion engine', () => {
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
    let reject!: (error: Error) => void;
    const respondRequest = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    connector.connect = async (id) => {
      const session = await connect(id); const workspace = await session.getWorkspace();
      return { ...session, getWorkspace: async () => ({ ...workspace, agentRequests: { 'demo-agent': [question], 'demo-reviewer': [question] } }), respondRequest };
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
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      expect(latest().requests[0]?.request.id).toBe('same-id');
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
      expect(events.filter((event) => event.type === 'conversation').at(-1)).toMatchObject({ frame: null, ready: true });
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
    { name: 'agent moved to another team', saved: { teamId: 'demo-team', agentId: 'second-agent' }, teamId: 'demo-team', agentId: 'demo-reviewer' },
    { name: 'missing team', saved: { teamId: 'gone', agentId: 'demo-agent' }, teamId: 'demo-team', agentId: 'demo-reviewer' },
    { name: 'empty team', saved: { teamId: 'empty-team', agentId: 'gone' }, teamId: 'empty-team', agentId: '' },
  ])('restores the correct fallback for $name in desktop order', async ({ saved, teamId, agentId }) => {
    const store = selectionStorage(); await store.write('demo-laptop', saved);
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async (id) => {
      const session = await connect(id); const workspace = await session.getWorkspace();
      return { ...session, loadConversation: async () => null, getWorkspace: async () => ({
        teams: [{ ...workspace.teams[0]!, agentIds: ['demo-reviewer', 'demo-agent'] },
          { id: 'second-team', name: 'Second', agentIds: ['second-agent'] }, { id: 'empty-team', name: 'Empty', agentIds: [] }],
        agents: [...workspace.agents, { ...workspace.agents[0]!, id: 'second-agent', teamId: 'second-team' }],
      }) };
    };
    const { engine, latest } = open(connector, store);
    try {
      await engine.start();
      expect(latest()).toMatchObject({ teamId, agentId });
      expect(await store.read('demo-laptop')).toEqual({ teamId, agentId });
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
      expect(events.filter((event) => event.type === 'conversation').at(-1)).toMatchObject({ agentId: 'demo-agent', ready: true, frame: null });
    } finally { engine.dispose(); }
  });
  it('keeps startup loading through saved-pairing restoration and connection', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let initialized!: () => void; let connected!: () => void;
    connector.initialize = () => new Promise<void>((resolve) => { initialized = resolve; });
    connector.connect = async (id) => { await new Promise<void>((resolve) => { connected = resolve; }); return connect(id); };
    const { engine, latest, states } = open(connector);
    expect(latest().startup).toBe('loading');
    const starting = engine.start();
    await Promise.resolve();
    expect(latest().startup).toBe('loading');
    initialized(); await vi.waitFor(() => expect(latest().connection).toBe('connecting'));
    expect(latest().startup).toBe('loading');
    connected(); await starting;
    expect(latest()).toMatchObject({ startup: 'ready', connection: 'connected' });
    expect(states().some((state) => state.startup === 'ready' && state.connection === 'unpaired')).toBe(false);
    engine.dispose();
  });
  it('shows pairing only after checking storage, and permits retry after a storage failure', async () => {
    const connector = unpaired();
    connector.initialize = vi.fn().mockRejectedValueOnce(new Error('Keychain unavailable')).mockResolvedValue(undefined);
    const { engine, latest } = open(connector);
    await engine.start();
    expect(latest().startup).toBe('error');
    await engine.dispatch({ type: 'start' });
    expect(latest()).toMatchObject({ startup: 'ready', connection: 'unpaired', laptops: [] });
    engine.dispose();
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
    await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
    const first = engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
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
    const conversation = () => events.filter((event) => event.type === 'conversation').at(-1)!;
    await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
    const original = conversation().frame;
    await engine.dispatch({ type: 'loadOlder', agentId: 'demo-agent' });
    expect(conversation()).toMatchObject({ frame: original, history: { hasOlder: true, loadingOlder: false, failed: true } });
    await engine.dispatch({ type: 'loadOlder', agentId: 'demo-agent' });
    expect(conversation()).toMatchObject({ frame: earlier, history: { hasOlder: false, loadingOlder: false, failed: false } });
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
  it('lists several saved laptops instead of choosing one', async () => {
    const connector = createDemoConnector(); Object.defineProperty(connector, 'laptops', { value: [{ id: 'demo-laptop', name: 'A' }, { id: 'other', name: 'B' }] });
    const { engine, latest } = open(connector);
    await engine.start();
    expect(latest().connection).toBe('unpaired'); expect(latest().laptops).toHaveLength(2);
    engine.dispose();
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
    expect(sendPrompt).toHaveBeenCalledWith('demo-agent', 'Hello', expect.any(String), expect.anything());
    await engine.dispatch({ type: 'interrupt' });
    expect(interrupt).toHaveBeenCalledWith('demo-agent');
    engine.dispose();
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
      await engine.dispatch({ type: 'send', text: 'Hello' });
      expect(texts(events)).toEqual(['Earlier', 'Hello']);
      published.texts.push('Hello');
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(texts(events)).toEqual(['Earlier', 'Hello']);
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
    it('starts a quick chat in the open team and opens it', async () => {
      const connector = createDemoConnector(); const original = connector.connect; const createQuickChat = vi.fn(async () => 'demo-reviewer');
      connector.connect = async (id) => ({ ...await original(id), createQuickChat });
      const { engine, latest } = open(connector);
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'newQuickChat', backend: 'claude' });
      expect(createQuickChat).toHaveBeenCalledWith({ teamId: 'demo-team', backend: 'claude' });
      expect(latest()).toMatchObject({ agentId: 'demo-reviewer', chatCreation: 'idle' });
      engine.dispose();
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
      expect([...events].reverse().find((event) => event.type === 'conversation')).toMatchObject({ engines: { current: 'claude', choices: ['codex', 'claude'] } });
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
