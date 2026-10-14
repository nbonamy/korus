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
