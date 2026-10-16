import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { codexConversationSnapshot, codexTextMessage } from '../../../vue/src/test/codex-conversation-fixtures';
import { createDemoConnector } from '../demo-connector';
import type { CompanionConversation, CompanionWorkspace } from '../companion-port';
import { createEngine, type EngineEvent } from '../engine';

/** What crosses the bridge into the transcript web view is the cost: every transfer copies and re-parses a whole conversation. */
type Delivery = (workspace: CompanionWorkspace, frame: CompanionConversation | null) => void;
const transcript = (events: readonly EngineEvent[]) => events.filter((event) => event.type === 'conversation');
/** The bridge serializes every event once; its size is what the native side receives and the page parses. */
const bytes = (events: readonly EngineEvent[]) => events.reduce((sum, event) => sum + JSON.stringify(event).length, 0);
const clock = () => Number(process.hrtime.bigint()) / 1e6;
const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

function frameOf(agentId: string, messages: ReturnType<typeof codexTextMessage>[], revision: number, busy = false): CompanionConversation {
  return { type: 'codex.conversationSnapshotChanged', seq: revision, occurredAt: '2026-10-14T00:00:00Z', agentId, backend: 'codex', threadId: agentId,
    payload: { revision, snapshot: codexConversationSnapshot(messages, { busy }) } } as CompanionConversation;
}
const history = (agentId: string, count: number) => Array.from({ length: count }, (_, index) => codexTextMessage(`${agentId}-${index}`, index % 2 ? 'assistant' : 'user', 'x'.repeat(1000), `turn-${index}`));

async function open(options: { messages?: number } = {}) {
  const connector = createDemoConnector(); const original = connector.connect;
  let deliver: Delivery = () => {}; let workspace!: CompanionWorkspace; const frames = new Map<string, CompanionConversation>();
  frames.set('demo-agent', frameOf('demo-agent', history('demo-agent', options.messages ?? 200), 1));
  frames.set('demo-reviewer', frameOf('demo-reviewer', history('demo-reviewer', 20), 1));
  connector.connect = async (id) => {
    const session = await original(id); const initial = await session.getWorkspace();
    workspace = { ...initial, agents: initial.agents.map(agent => ({ ...agent, backendSession: { kind: 'codex', threadId: agent.id } })) };
    return { ...session, getWorkspace: async () => workspace, loadConversation: async (agentId) => frames.get(agentId) ?? null,
      onUpdate: (listener) => { deliver = listener; return () => { deliver = () => {}; }; } };
  };
  const events: EngineEvent[] = [];
  const engine = createEngine({ connector, post: (event) => events.push(event) });
  await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
  const update = (change: (agents: Agent[]) => Agent[], frame: CompanionConversation | null = null) => { workspace = { ...workspace, agents: change(workspace.agents.map((agent) => ({ ...agent }))) }; deliver(workspace, frame); };
  return { engine, events, update, frames, mark: () => events.length };
}
afterEach(() => { vi.useRealTimers(); });

const mark = (events: readonly EngineEvent[]) => events.length;
describe('what the engine sends the transcript', () => {
  it('sends nothing when other chats change, or when the laptop repeats what it already said', async () => {
    const { engine, events, update, mark } = await open();
    const before = mark(); const started = clock();
    for (let index = 0; index < 20; index++) {
      update((agents) => agents.map((agent) => agent.id === 'demo-reviewer' ? { ...agent, statusText: `step ${index}` } : agent));
      await Promise.resolve();
    }
    const sent = events.slice(before);
    console.info(`[bridge] 20 unrelated workspace updates: ${transcript(sent).length} transcript transfers, ${bytes(sent)} bytes sent, ${(clock() - started).toFixed(1)} ms`);
    expect(transcript(sent)).toHaveLength(0);
    const mid = mark();
    for (let index = 0; index < 20; index++) { update((agents) => agents); await Promise.resolve(); }
    expect(events.slice(mid)).toHaveLength(0);
    engine.dispose();
  });

  it('bounds the transfers of a streaming reply and ends on the final snapshot', async () => {
    fakeTimers();
    const { engine, events, update } = await open();
    const baseMessages = history('demo-agent', 200); const reply = (text: string) => codexTextMessage('reply', 'assistant', text, 'turn-live');
    const before = events.length; const started = clock();
    for (let revision = 2; revision < 102; revision++) {
      update((agents) => agents, frameOf('demo-agent', [...baseMessages, reply('word '.repeat(revision))], revision, true));
      await vi.advanceTimersByTimeAsync(5);
    }
    update((agents) => agents, frameOf('demo-agent', [...baseMessages, reply('final answer')], 102, false));
    await vi.advanceTimersByTimeAsync(500);
    const sent = events.slice(before); const last = transcript(sent).at(-1);
    console.info(`[bridge] 101 streamed snapshots: ${transcript(sent).length} transcript transfers, ${bytes(sent)} bytes sent, ${(clock() - started).toFixed(1)} ms of engine work incl. serializing`);
    expect(transcript(sent).length).toBeLessThanOrEqual(8);
    expect(last).toMatchObject({ type: 'conversation', frame: { payload: { revision: 102 } } });
    engine.dispose();
  });

  it('shows the chat that was selected last when selections come faster than renders', async () => {
    fakeTimers();
    const { engine, events } = await open();
    await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
    await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
    await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
    await vi.advanceTimersByTimeAsync(500);
    const shown = transcript(events).at(-1);
    expect(shown).toMatchObject({ agentId: 'demo-reviewer', frame: { agentId: 'demo-reviewer' } });
    // Every event pairs a frame with its own chat: never one chat's messages under another's name.
    for (const event of transcript(events)) if (event.type === 'conversation' && event.frame) expect(event.frame.agentId).toBe(event.agentId);
    engine.dispose();
  });

  it('sends only a small context update when the open chat itself changes status', async () => {
    const { engine, events, update } = await open();
    const before = mark(events);
    update((agents) => agents.map((agent) => agent.id === 'demo-agent' ? { ...agent, statusText: 'Reading files' } : agent));
    await Promise.resolve();
    const sent = events.slice(before);
    expect(transcript(sent)).toHaveLength(0);
    expect(sent.filter((event) => event.type === 'conversationContext')).toEqual([expect.objectContaining({ agentId: 'demo-agent', agent: expect.objectContaining({ statusText: 'Reading files' }) })]);
    expect(bytes(sent)).toBeLessThan(20_000);
    engine.dispose();
  });

  it('shows another chat at once, even in the middle of a streaming reply', async () => {
    fakeTimers();
    const { engine, events, update } = await open();
    const base = history('demo-agent', 200);
    update((agents) => agents, frameOf('demo-agent', [...base, codexTextMessage('reply', 'assistant', 'one', 'turn-live')], 2, true));
    await vi.advanceTimersByTimeAsync(10);
    update((agents) => agents, frameOf('demo-agent', [...base, codexTextMessage('reply', 'assistant', 'one two', 'turn-live')], 3, true));
    await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
    expect(transcript(events).at(-1)).toMatchObject({ agentId: 'demo-reviewer', frame: { agentId: 'demo-reviewer' } });
    // The late chunk of the chat that was left must not come back over the chat that was opened.
    await vi.advanceTimersByTimeAsync(500);
    expect(transcript(events).at(-1)).toMatchObject({ agentId: 'demo-reviewer', frame: { agentId: 'demo-reviewer' } });
    engine.dispose();
  });
});
