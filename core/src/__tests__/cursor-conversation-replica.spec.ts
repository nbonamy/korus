import { describe, expect, it } from 'vitest';
import { createCursorConversationReplica, emptyCursorSnapshot } from '../cursor-conversation-replica';
import { decodeAppBackendEvent } from '../backend-protocol/events';

const identity = { agentId: 'cursor-agent', sessionId: 'native-session', turnId: 'turn-1', occurredAt: '2026-11-03T12:00:00Z' };
describe('Cursor conversation ownership', () => {
  it('keeps interrupted turns terminal and rejects cross-session or stale message mutations', () => {
    const replica = createCursorConversationReplica(emptyCursorSnapshot(identity.agentId, identity.sessionId));
    const started = { ...identity, type: 'turn.started' as const, payload: { turn: { id: identity.turnId } } };
    replica.apply(started);
    replica.apply({ ...identity, type: 'turn.completed', payload: { turn: { id: identity.turnId, status: 'interrupted' } } });
    replica.apply({ ...started, turnId: 'turn-2', payload: { turn: { id: 'turn-2' } } });
    replica.apply({ ...identity, type: 'turn.completed', payload: { turn: { id: identity.turnId, status: 'completed' } } });
    expect(replica.getSnapshot()).toMatchObject({ activeTurnId: 'turn-2', busy: true, turns: [{ status: 'interrupted' }, { status: 'inProgress' }] });
    expect(() => replica.apply({ ...started, sessionId: 'wrong-session' })).toThrow('identity');
  });

  it('validates provider frames and binds inner and outer conversation identities', () => {
    const frame = { seq: 1, occurredAt: identity.occurredAt, agentId: identity.agentId, provider: 'cursor', providerSessionId: identity.sessionId,
      type: 'cursor.conversationSnapshotChanged', payload: { revision: 1, snapshot: emptyCursorSnapshot(identity.agentId, identity.sessionId) } };
    expect(decodeAppBackendEvent(frame)).toEqual(frame);
    expect(() => decodeAppBackendEvent({ ...frame, providerSessionId: 'another-session' })).toThrow();
    expect(() => decodeAppBackendEvent({ ...frame, payload: { ...frame.payload, revision: -1 } })).toThrow();
  });
});
