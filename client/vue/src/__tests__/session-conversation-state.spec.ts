import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@korus-dev/multi-agent-sdk';
import type { Agent, MainToRendererEvent } from '@workspace/core/contracts';
import { createSessionConversationState } from '../session-conversation-state';

const state = (patch: Partial<SessionState> = {}): SessionState => ({
  messages: [], busy: false, activeTurnId: null, turns: [], requests: [], error: null, title: null, goal: null, contextUsage: null, plan: null, ...patch,
});
const agent = (conversation?: string) => ({ id: 'a', provider: 'claude', ...(conversation ? { providerSession: { kind: 'claude', sessionId: conversation } } : {}) }) as Agent;
const snapshot = (revision: number, value: SessionState, conversation: string | null = 's1') =>
  ({ type: 'conversation.sessionSnapshot', agentId: 'a', provider: 'claude', seq: 0, occurredAt: '', payload: { conversation, snapshot: { revision, state: value } } }) as Extract<MainToRendererEvent, { type: 'conversation.sessionSnapshot' }>;
const patch = (revision: number, busy: boolean, conversation: string | null = 's1') =>
  ({ type: 'conversation.sessionPatch', agentId: 'a', provider: 'claude', seq: 0, occurredAt: '', payload: { conversation, patch: { revision, ops: [{ op: 'set', key: 'busy', value: busy }] } } }) as Extract<MainToRendererEvent, { type: 'conversation.sessionPatch' }>;

describe('session conversation state', () => {
  it('starts from a snapshot and applies patches in revision order, ignoring ones it already has', () => {
    const store = createSessionConversationState(vi.fn(async () => {}));
    store.receive(snapshot(4, state()));
    expect(store.receive(patch(5, true))?.busy).toBe(true);
    expect(store.receive(patch(5, false))).toBeUndefined();
    expect(store.select(agent('s1'))?.busy).toBe(true);
    expect(store.needsHistory(agent('s1'))).toBe(false);
  });

  it('keeps the last state visible and reloads once when a revision is missed, until a snapshot arrives', async () => {
    const recover = vi.fn(async () => {});
    const store = createSessionConversationState(recover);
    store.receive(snapshot(1, state({ title: 'Kept' })));
    store.receive(patch(3, true));
    store.receive(patch(4, true));
    expect(recover).toHaveBeenCalledExactlyOnceWith('a');
    expect(store.select(agent('s1'))?.title).toBe('Kept');
    expect(store.needsHistory(agent('s1'))).toBe(true);
    store.receive(snapshot(0, state({ title: 'Reloaded' })));
    expect(store.select(agent('s1'))?.title).toBe('Reloaded');
    expect(store.needsHistory(agent('s1'))).toBe(false);
  });

  it('reloads instead of patching another conversation, and shows only the agent\'s own conversation', () => {
    const recover = vi.fn(async () => {});
    const store = createSessionConversationState(recover);
    store.receive(snapshot(1, state()));
    store.receive(patch(2, true, 's2'));
    expect(recover).toHaveBeenCalledOnce();
    expect(store.select(agent('s2'))).toBeNull();
    // A new conversation can report before the agent is attached to it; one it was detached from cannot.
    expect(store.select(agent())).not.toBeNull();
    store.reconcile([agent('s1')]);
    expect(store.select(agent())).toBeNull();
  });

  it('forgets agents that no longer exist or no longer own the conversation', () => {
    const store = createSessionConversationState(vi.fn(async () => {}));
    store.receive(snapshot(1, state()));
    store.reconcile([agent('other')]);
    expect(store.select(agent('s1'))).toBeNull();
  });
});
