import { describe, expect, it, vi } from 'vitest';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { ConversationSource } from '../conversation-source';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';

const snapshot = (sessionId = 'session', messages: unknown[] = []) => ({ agentId: 'agent', sessionId, activeTurnId: null, turnIds: [], turns: [], messages, answeredClientRequestIds: [],
  busy: false, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null });
const reset = (revision: number, state = snapshot(), type: string = 'claude.conversationSnapshotChanged', agentId = 'agent') => ({ type, agentId, backend: type.split('.')[0], seq: revision, occurredAt: 'now', payload: { revision, snapshot: { ...state, agentId } } }) as unknown as AppBackendEvent;
const delta = (revision: number, event: Record<string, unknown>) => ({ type: 'claude.conversationEventReceived', agentId: 'agent', backend: 'claude', seq: revision, occurredAt: 'now',
  payload: { revision, event: { agentId: 'agent', occurredAt: 'now', ...event } } }) as unknown as AppBackendEvent;
const userMessage = (id: string, text: string) => ({ id, agentId: 'agent', role: 'user', status: 'complete', parts: [{ type: 'text', text }] });
const messages = (frame: { payload: { snapshot: unknown } }) => (frame.payload.snapshot as { messages: { id: string }[] }).messages.map((message) => message.id);

describe('conversation source', () => {
  it('forgets removed agents and bounds inactive conversations without retaining app snapshots', async () => {
    let source!: ConversationSource;
    const load = vi.fn(async (id: string) => { source.observe(reset(1, snapshot(), 'claude.conversationSnapshotChanged', id)); });
    source = new ConversationSource(load);
    const app = createTestSnapshot();
    source.observe({ ...reset(1), snapshot: app } as AppBackendEvent);
    expect(await source.read('agent')).not.toHaveProperty('snapshot');
    source.observe({ type: 'snapshot.updated', payload: app, seq: 2, occurredAt: 'now' });
    await source.read('agent');
    expect(load).toHaveBeenCalledExactlyOnceWith('agent');
    for (let i = 0; i < 65; i++) source.observe(reset(1, snapshot(), 'claude.conversationSnapshotChanged', `chat-${i}`));
    await source.read('chat-64');
    expect(load).toHaveBeenCalledTimes(1);
    await source.read('chat-0');
    expect(load).toHaveBeenLastCalledWith('chat-0');
  });
  it('rehydrates a bounded provider window instead of replaying accumulated history on reconnect', async () => {
    let source!: ConversationSource;
    const recent = snapshot('session', [userMessage('recent', 'last')]);
    const load = vi.fn(async () => { source.observe(reset(load.mock.calls.length, recent)); });
    source = new ConversationSource(load);
    await source.read('agent');
    source.observe(delta(2, { type: 'history.prepended', backendSessionId: 'session', payload: { messages: Array.from({ length: 60 }, (_, i) => userMessage(`old-${i}`, 'old')), hasOlder: false } }));
    const frame = await source.read('agent');
    expect(messages(frame)).toStrictEqual(['recent']);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('loads once, then follows the provider\'s own updates instead of asking again', async () => {
    let source!: ConversationSource;
    const load = vi.fn(async () => { source.observe(reset(1, snapshot('session', [userMessage('first', 'hello')]))); });
    source = new ConversationSource(load);
    expect(messages(await source.read('agent'))).toStrictEqual(['first']);
    source.observe(delta(2, { type: 'message.userSubmitted', payload: { message: userMessage('second', 'again') } }));
    const frame = await source.read('agent');
    expect(messages(frame)).toStrictEqual(['first', 'second']);
    expect(frame).toMatchObject({ type: 'claude.conversationSnapshotChanged', agentId: 'agent', payload: { revision: 2 } });
    expect(load).toHaveBeenCalledOnce();
  });
  it('shows a turn that streams in after a reset, with the assistant reply growing', async () => {
    let source!: ConversationSource;
    source = new ConversationSource(async () => { source.observe(reset(1)); });
    await source.read('agent');
    source.observe(delta(2, { type: 'message.userSubmitted', payload: { message: userMessage('prompt', 'Fix it') } }));
    source.observe(delta(3, { type: 'turn.started', turnId: 'turn-1', payload: { turn: { id: 'turn-1', backend: 'claude' } } }));
    const frame = await source.read('agent');
    expect(messages(frame)).toContain('prompt');
    expect((frame.payload.snapshot as { busy?: boolean; activeTurnId: string | null }).activeTurnId).toBe('turn-1');
  });
  it('asks again when it missed an update, instead of serving a transcript with a hole', async () => {
    let source!: ConversationSource; let calls = 0;
    const load = vi.fn(async () => { calls++; source.observe(reset(calls === 1 ? 1 : 9, snapshot('session', [userMessage(calls === 1 ? 'old' : 'fresh', 'x')]))); });
    source = new ConversationSource(load);
    await source.read('agent');
    source.observe(delta(5, { type: 'message.userSubmitted', payload: { message: userMessage('skipped', 'x') } }));
    expect(messages(await source.read('agent'))).toStrictEqual(['fresh']);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('asks again once its copy is old, to pick up changes made outside this session', async () => {
    let now = 0; let source!: ConversationSource;
    const load = vi.fn(async () => { source.observe(reset(1)); });
    source = new ConversationSource(load, () => now);
    await source.read('agent'); await source.read('agent');
    expect(load).toHaveBeenCalledOnce();
    now = 31_000; await source.read('agent');
    expect(load).toHaveBeenCalledTimes(2);
    source.observe(delta(2, { type: 'message.userSubmitted', payload: { message: userMessage('live', 'x') } }));
    now = 60_000; await source.read('agent');
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('keeps agents apart and keeps asking for providers it does not follow', async () => {
    let source!: ConversationSource;
    const load = vi.fn(async (agentId: string) => { source.observe(agentId === 'codex-agent' ? reset(1, snapshot(), 'codex.conversationSnapshotChanged', 'codex-agent') : reset(1)); });
    source = new ConversationSource(load);
    await source.read('agent'); await source.read('codex-agent');
    await source.read('codex-agent'); await source.read('agent');
    expect(load.mock.calls.map(([id]) => id)).toStrictEqual(['agent', 'codex-agent', 'codex-agent']);
  });
  it('fails clearly when the provider publishes nothing', async () => {
    const source = new ConversationSource(async () => {});
    await expect(source.read('agent')).rejects.toThrow('unavailable');
  });
});

// Failure modes: reconnect retransmits images; missed updates or restart revisions
// silently reuse stale content; an expired journal grows without bound.
describe('resumable companion conversations', () => {
  it('resumes an unchanged or briefly disconnected conversation without another provider read or snapshot', async () => {
    let source: ConversationSource;
    const load = vi.fn(async () => source.observe(reset(1)));
    source = new ConversationSource(load);
    const first = await source.synchronize('agent', null);
    expect(first.frames).toHaveLength(1);
    expect(await source.synchronize('agent', first.checkpoint)).toStrictEqual({ checkpoint: first.checkpoint, frames: [] });
    const update = delta(2, { type: 'turn.started', turnId: 'turn', payload: { turn: { id: 'turn', backend: 'claude' } } });
    source.observe(update);
    const resumed = await source.synchronize('agent', first.checkpoint);
    expect(resumed.frames).toStrictEqual([update]);
    expect(resumed.checkpoint.revision).toBe(2);
    expect(load).toHaveBeenCalledTimes(1);
    source.clear();
    const restarted = await source.synchronize('agent', resumed.checkpoint);
    expect(restarted.frames).toHaveLength(1);
    expect(restarted.checkpoint.epoch).not.toBe(first.checkpoint.epoch);
  });
});
