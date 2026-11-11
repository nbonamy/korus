import { expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { emptyAntigravitySnapshot } from '@workspace/core/antigravity-conversation-replica';
import { deferred } from '../../tests/support/app-state-test-harness';
import { createAntigravityConversationState } from '../antigravity-conversation-state';

it('recovers revision gaps, replaces history atomically, and evicts frames after identity changes', async () => {
  const recovery = deferred<void>();
  const recover = vi.fn().mockReturnValue(recovery.promise);
  const state = createAntigravityConversationState(recover);
  const agent = { ...createInitialSnapshot().agents[0]!, provider: 'antigravity' as const, providerSession: { kind: 'antigravity' as const, sessionId: 'native' } };
  const identity = { agentId: agent.id, provider: 'antigravity' as const, providerSessionId: 'native', seq: 1, occurredAt: '2026-10-06T10:00:00Z' };
  const snapshot = emptyAntigravitySnapshot(agent.id, 'native');
  state.receive({ ...identity, type: 'antigravity.conversationSnapshotChanged', payload: { revision: 40, snapshot } });
  const event = { agentId: agent.id, sessionId: 'native', turnId: 'turn', occurredAt: identity.occurredAt, type: 'turn.started' as const, payload: { turn: { id: 'turn' } } };
  state.receive({ ...identity, type: 'antigravity.conversationEventReceived', payload: { revision: 42, event } });
  expect(state.select(agent)).toEqual(snapshot);
  expect(recover).toHaveBeenCalledExactlyOnceWith(agent.id);
  state.receive({ ...identity, type: 'antigravity.conversationSnapshotChanged', payload: { revision: 1, snapshot } });
  state.receive({ ...identity, type: 'antigravity.conversationEventReceived', payload: { revision: 2, event } });
  expect(state.select(agent)).toMatchObject({ busy: true, activeTurnId: 'turn' });
  recovery.resolve();
  await flushPromises();
  state.receive({ ...identity, type: 'antigravity.conversationSnapshotChanged', payload: { revision: 1, snapshot } });
  expect(state.select(agent)?.busy).toBe(true);
  state.reconcile([{ ...agent, providerSession: { kind: 'antigravity', sessionId: 'other' } }]);
  expect(state.select(agent)).toBeNull();
});

it('retains a newly opened frame before attachment but evicts the detached session when its reference is cleared', () => {
  const state = createAntigravityConversationState(vi.fn());
  const agent = { ...createInitialSnapshot().agents[0]!, provider: 'antigravity' as const, providerSession: undefined };
  const native = emptyAntigravitySnapshot(agent.id, 'native-new');
  state.reconcile([agent]);
  state.receive({ agentId: agent.id, provider: 'antigravity', providerSessionId: native.sessionId, seq: 1, occurredAt: '',
    type: 'antigravity.conversationSnapshotChanged', payload: { revision: 1, snapshot: native } });
  state.reconcile([agent]);
  expect(state.select(agent)?.sessionId).toBe('native-new');
  state.reconcile([{ ...agent, providerSession: { kind: 'antigravity', sessionId: 'native-new' } }]);
  state.reconcile([agent]);
  expect(state.select(agent)).toBeNull();
  state.receive({ agentId: agent.id, provider: 'antigravity', providerSessionId: native.sessionId, seq: 2, occurredAt: '',
    type: 'antigravity.conversationSnapshotChanged', payload: { revision: 2, snapshot: native } });
  expect(state.select(agent)).toBeNull();
  const next = emptyAntigravitySnapshot(agent.id, 'native-next');
  state.receive({ agentId: agent.id, provider: 'antigravity', providerSessionId: next.sessionId, seq: 3, occurredAt: '',
    type: 'antigravity.conversationSnapshotChanged', payload: { revision: 3, snapshot: next } });
  state.reconcile([agent]);
  expect(state.select(agent)?.sessionId).toBe('native-next');
});
