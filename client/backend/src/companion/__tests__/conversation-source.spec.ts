import { describe, expect, it, vi } from 'vitest';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { SessionPatchOp } from '@korus-dev/multi-agent-sdk/contracts';
import { ConversationSource } from '../conversation-source';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';

const state = (messages: unknown[] = []) => ({ messages, busy: false, activeTurnId: null, turns: [], requests: [], error: null, title: null, goal: null, contextUsage: null, plan: null });
const reset = (revision: number, messages: unknown[] = [], agentId = 'agent', epoch = 'epoch') =>
  ({ type: 'conversation.sessionSnapshot', agentId, provider: 'cursor', occurredAt: 'now', payload: { conversation: 'chat', epoch, snapshot: { revision, state: state(messages) } } }) as unknown as AppBackendEvent;
const patch = (revision: number, ops: SessionPatchOp[], epoch = 'epoch') =>
  ({ type: 'conversation.sessionPatch', agentId: 'agent', provider: 'cursor', occurredAt: 'now', payload: { conversation: 'chat', epoch, patch: { revision, ops } } }) as unknown as AppBackendEvent;
const userMessage = (id: string, text = id) => ({ id, role: 'user', status: 'complete', parts: [{ type: 'text', text }] });
const append = (at: number, id: string): SessionPatchOp[] => [{ op: 'spliceMessages', start: at, deleteCount: 0, messages: [userMessage(id) as never] }];
const messages = (frame: { payload: { snapshot: { state: { messages: { id: string }[] } } } }) => frame.payload.snapshot.state.messages.map(message => message.id);

describe('conversation source', () => {
  it('forgets removed agents and bounds inactive conversations without retaining app snapshots', async () => {
    let source!: ConversationSource;
    const load = vi.fn(async (id: string) => { source.observe(reset(1, [], id)); });
    source = new ConversationSource(load);
    const app = createTestSnapshot();
    source.observe({ ...reset(1), snapshot: app } as AppBackendEvent);
    expect(await source.read('agent')).not.toHaveProperty('snapshot');
    expect(await source.read('agent')).not.toHaveProperty('occurredAt');
    source.observe({ type: 'snapshot.updated', payload: app, seq: 2, occurredAt: 'now' });
    await source.read('agent');
    expect(load).toHaveBeenCalledExactlyOnceWith('agent');
    for (let i = 0; i < 65; i++) source.observe(reset(1, [], `chat-${i}`));
    await source.read('chat-64');
    expect(load).toHaveBeenCalledTimes(1);
    await source.read('chat-0');
    expect(load).toHaveBeenLastCalledWith('chat-0');
  });
  it('loads once, then applies the session patches instead of asking again, for every provider', async () => {
    let source!: ConversationSource;
    const load = vi.fn(async () => { source.observe(reset(1, [userMessage('first')])); });
    source = new ConversationSource(load);
    expect(messages(await source.read('agent'))).toStrictEqual(['first']);
    source.observe(patch(2, append(1, 'second')));
    source.observe(patch(3, [{ op: 'set', key: 'activeTurnId', value: 'turn-1' }, { op: 'set', key: 'busy', value: true }]));
    const frame = await source.read('agent');
    expect(messages(frame)).toStrictEqual(['first', 'second']);
    expect(frame).toMatchObject({ type: 'conversation.sessionSnapshot', agentId: 'agent', provider: 'cursor', payload: { epoch: 'epoch', snapshot: { revision: 3, state: { activeTurnId: 'turn-1', busy: true } } } });
    expect(load).toHaveBeenCalledOnce();
  });
  it('asks again when the stream broke, instead of serving a transcript with a hole', async () => {
    let source!: ConversationSource; let calls = 0;
    const load = vi.fn(async () => { calls++; source.observe(reset(calls === 1 ? 1 : 9, [userMessage(calls === 1 ? 'old' : 'fresh')])); });
    source = new ConversationSource(load);
    await source.read('agent');
    source.observe(patch(5, append(1, 'skipped')));
    expect(messages(await source.read('agent'))).toStrictEqual(['fresh']);
    source.observe(patch(10, append(1, 'restarted'), 'other'));
    await source.read('agent');
    source.observe(patch(11, [{ op: 'spliceMessages', start: 7, deleteCount: 0, messages: [] }]));
    await source.read('agent');
    expect(load).toHaveBeenCalledTimes(4);
  });
  it('ignores a late snapshot of its own stream and takes any snapshot of a new one', async () => {
    const source = new ConversationSource(async () => {});
    source.observe(reset(3, [userMessage('current')]));
    source.observe(reset(2, [userMessage('late')]));
    expect(messages(await source.read('agent'))).toStrictEqual(['current']);
    source.observe(reset(1, [userMessage('restarted')], 'agent', 'restarted'));
    expect(messages(await source.read('agent'))).toStrictEqual(['restarted']);
  });
  it('fails clearly when the provider publishes nothing', async () => {
    const source = new ConversationSource(async () => {});
    await expect(source.read('agent')).rejects.toThrow('unavailable');
  });
});

// Failure modes: reconnect retransmits the transcript; missed patches or restarted streams
// silently reuse stale content; an expired journal grows without bound.
describe('resumable companion conversations', () => {
  it('resumes an unchanged or briefly disconnected conversation without another provider read or snapshot', async () => {
    let source: ConversationSource;
    const load = vi.fn(async () => source.observe(reset(1)));
    source = new ConversationSource(load);
    const first = await source.synchronize('agent', null);
    expect(first.frames).toHaveLength(1);
    expect(await source.synchronize('agent', first.checkpoint)).toStrictEqual({ checkpoint: first.checkpoint, frames: [] });
    const update = patch(2, [{ op: 'set', key: 'busy', value: true }]);
    source.observe(update);
    const resumed = await source.synchronize('agent', first.checkpoint);
    expect(resumed.frames).toStrictEqual([{ type: 'conversation.sessionPatch', agentId: 'agent', provider: 'cursor', payload: (update as { payload: unknown }).payload }]);
    expect(resumed.checkpoint.revision).toBe(2);
    expect(load).toHaveBeenCalledTimes(1);
    source.clear();
    const restarted = await source.synchronize('agent', resumed.checkpoint);
    expect(restarted.frames).toHaveLength(1);
    expect(restarted.checkpoint.epoch).not.toBe(first.checkpoint.epoch);
  });
  it('starts a phone over from the conversation it holds when the journal let it go', async () => {
    const source = new ConversationSource(async () => {});
    for (let i = 0; i < 40; i++) source.observe(reset(1, [], `chat-${i}`));
    const sync = await source.synchronize('chat-0', null);
    expect(sync.frames).toHaveLength(1);
    expect(sync.checkpoint.revision).toBe(1);
  });
});
