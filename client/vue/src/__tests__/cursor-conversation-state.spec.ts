import { expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { emptyCursorSnapshot } from '@workspace/core/cursor-conversation-replica';
import { createCursorConversationState } from '../cursor-conversation-state';

it('recovers revision gaps, replaces history atomically, and evicts frames after identity changes', async () => {
  const recover = vi.fn().mockResolvedValue(undefined);
  const state = createCursorConversationState(recover);
  const agent = { ...createInitialSnapshot().agents[0]!, provider: 'cursor' as const, providerSession: { kind: 'cursor' as const, sessionId: 'native' } };
  const identity = { agentId: agent.id, provider: 'cursor' as const, providerSessionId: 'native', seq: 1, occurredAt: '2026-10-06T10:00:00Z' };
  const snapshot = emptyCursorSnapshot(agent.id, 'native');
  state.receive({ ...identity, type: 'cursor.conversationSnapshotChanged', payload: { revision: 1, snapshot } });
  const event = { agentId: agent.id, sessionId: 'native', turnId: 'turn', occurredAt: identity.occurredAt, type: 'turn.started' as const, payload: { turn: { id: 'turn' } } };
  state.receive({ ...identity, type: 'cursor.conversationEventReceived', payload: { revision: 3, event } });
  expect(state.select(agent)).toBeNull();
  expect(recover).toHaveBeenCalledExactlyOnceWith(agent.id);
  await flushPromises();
  state.receive({ ...identity, type: 'cursor.conversationSnapshotChanged', payload: { revision: 4, snapshot } });
  state.receive({ ...identity, type: 'cursor.conversationEventReceived', payload: { revision: 5, event } });
  expect(state.select(agent)).toMatchObject({ busy: true, activeTurnId: 'turn' });
  state.receive({ ...identity, type: 'cursor.conversationSnapshotChanged', payload: { revision: 4, snapshot } });
  expect(state.select(agent)?.busy).toBe(true);
  state.reconcile([{ ...agent, providerSession: { kind: 'cursor', sessionId: 'other' } }]);
  expect(state.select(agent)).toBeNull();
});

it('retains a newly opened frame before attachment but evicts the detached session when its reference is cleared', () => {
  const state = createCursorConversationState(vi.fn());
  const agent = { ...createInitialSnapshot().agents[0]!, provider: 'cursor' as const, providerSession: undefined };
  const native = emptyCursorSnapshot(agent.id, 'native-new');
  state.reconcile([agent]);
  state.receive({ agentId: agent.id, provider: 'cursor', providerSessionId: native.sessionId, seq: 1, occurredAt: '',
    type: 'cursor.conversationSnapshotChanged', payload: { revision: 1, snapshot: native } });
  state.reconcile([agent]);
  expect(state.select(agent)?.sessionId).toBe('native-new');
  state.reconcile([{ ...agent, providerSession: { kind: 'cursor', sessionId: 'native-new' } }]);
  state.reconcile([agent]);
  expect(state.select(agent)).toBeNull();
  state.receive({ agentId: agent.id, provider: 'cursor', providerSessionId: native.sessionId, seq: 2, occurredAt: '',
    type: 'cursor.conversationSnapshotChanged', payload: { revision: 2, snapshot: native } });
  expect(state.select(agent)).toBeNull();
  const next = emptyCursorSnapshot(agent.id, 'native-next');
  state.receive({ agentId: agent.id, provider: 'cursor', providerSessionId: next.sessionId, seq: 3, occurredAt: '',
    type: 'cursor.conversationSnapshotChanged', payload: { revision: 3, snapshot: next } });
  state.reconcile([agent]);
  expect(state.select(agent)?.sessionId).toBe('native-next');
});
