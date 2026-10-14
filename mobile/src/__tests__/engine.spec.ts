import { describe, expect, it, vi } from 'vitest';
import { createDemoConnector } from '../demo-connector';
import { createEngine, type EngineEvent, type EngineState } from '../engine';
import type { CompanionHistoryPage } from '../companion-port';

const unpaired = () => { const connector = createDemoConnector(); Object.defineProperty(connector, 'laptops', { value: [] }); return connector; };
function open(connector = createDemoConnector()) {
  const events: EngineEvent[] = [];
  const engine = createEngine({ connector, post: (event) => events.push(event) });
  const states = () => events.flatMap((event) => event.type === 'state' ? [event.state] : []);
  const latest = (): EngineState => engine.snapshot();
  return { engine, events, states, latest };
}

describe('companion engine', () => {
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
  it('forgets a laptop and reflects the empty list', async () => {
    const { engine, latest } = open();
    await engine.start();
    await engine.dispatch({ type: 'forget' });
    expect(latest().connection).toBe('revoked');
    engine.dispose();
  });
});
