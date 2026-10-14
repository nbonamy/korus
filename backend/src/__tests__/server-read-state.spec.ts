import { describe, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { createTestSnapshot } from './server-test-fixtures';
import { sdkAgent } from '../codex/__tests__/sdk-surface-fixture';

describe('shared conversation read state', () => {
  it('publishes unread activity and only acknowledges the revision actually seen by a client', async () => {
    const snapshot = createTestSnapshot();
    const agent = { ...sdkAgent(), teamId: 'team-test' };
    snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = [agent.id];
    const events = vi.fn(); const save = vi.fn(async () => {});
    const server = new AppBackendServer({ version: 'test', snapshot, onEvent: events, saveSnapshot: save });
    const attention = (revision: number) => server.emitEvent({ type: 'codex.conversationEventReceived', backend: 'codex', agentId: agent.id, threadId: 'conversation-a', payload: { revision, event: {
      type: 'turn.completed', seq: revision, occurredAt: '', origin: 'notification', conversationId: 'conversation-a', turnId: `turn-${revision}`,
      payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null },
    } } });
    const read = (revision: number) => server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/read', params: { agentId: agent.id, revision } });
    try {
      attention(1);
      expect(snapshot.agents[0]!.readState).toEqual({ revision: 1, readRevision: 0 });
      attention(2);
      await read(1);
      expect(snapshot.agents[0]!.readState).toEqual({ revision: 2, readRevision: 1 });
      expect(JSON.parse(JSON.stringify(await read(2))).result).toBeNull();
      expect(snapshot.agents[0]!.readState).toEqual({ revision: 2, readRevision: 2 });
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.updated', payload: expect.objectContaining({ readState: { revision: 2, readRevision: 2 } }) }));
      await read(1);
      expect(snapshot.agents[0]!.readState?.readRevision).toBe(2);
      await expect(read(999)).rejects.toThrow('Unknown read revision');
      expect(save).toHaveBeenCalled();
    } finally { await server.close(); }
  });
});
