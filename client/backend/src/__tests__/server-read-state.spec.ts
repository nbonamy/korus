import { describe, expect, it, vi } from 'vitest';
import { CompanionNotifications } from '../companion/notifications';
import { sessionError, turnCompleted, turnStarted } from './support/conversation-activity';
import { AppBackendServer } from '../server';
import { createTestSnapshot } from './server-test-fixtures';
import { sdkAgent } from '../codex/__tests__/sdk-host-fixture';

describe('shared conversation read state', () => {
  it('captures alert revisions before later turns and propagates only the read checkpoint', async () => {
    const snapshot = createTestSnapshot();
    const agent = { ...sdkAgent(), teamId: 'team-test' }; snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = [agent.id];
    const source = new CompanionNotifications('host');
    const captured: ReturnType<CompanionNotifications['capture']> = [];
    const server = new AppBackendServer({ version: 'test', snapshot, onEvent: event => captured.push(...source.capture(event)) });
    try {
      const turn = (id: string) => ({ id, status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null });
      const state = { messages: [], busy: false, activeTurnId: null, turns: [], requests: [], error: null, title: null, goal: null, contextUsage: null, plan: null };
      server.emitEvent({ type: 'conversation.sessionSnapshot', provider: 'codex', agentId: agent.id, payload: { conversation: 'conversation-a', epoch: 'e1', snapshot: { revision: 0, state } } } as never);
      // A finished turn bumps the read state from the harness's turn event, then the session state reports the turn.
      for (const revision of [1, 2]) {
        server.emitEvent(turnCompleted(agent.id, `turn-${revision}`, { conversationId: 'conversation-a' }));
        server.emitEvent({ type: 'conversation.sessionPatch', provider: 'codex', agentId: agent.id, payload: { conversation: 'conversation-a', epoch: 'e1',
          patch: { revision, ops: [{ op: 'set', key: 'turns', value: Array.from({ length: revision }, (_, index) => turn(`turn-${index + 1}`)) }] } } } as never);
      }
      const notifications = captured.map(action => source.create(action.event, snapshot, action.revision));
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/read', params: { agentId: agent.id, revision: 1 } });
      const readAction = captured.at(-1)!; notifications.push(source.create(readAction.event, snapshot, readAction.revision));
      expect(notifications.map(n => [n?.kind, n?.revision])).toStrictEqual([['completed', 1], ['completed', 2], ['read', 1]]);
      const restored = new AppBackendServer({ version: 'test', snapshot: JSON.parse(JSON.stringify(snapshot)) });
      try { expect((await restored.handleMessage({ jsonrpc: '2.0', id: 2, method: 'snapshot/get' })) as unknown).toMatchObject({ result: { snapshot: { agents: [{ readState: { revision: 2, readRevision: 1 } }] } } }); }
      finally { await restored.close(); }
    } finally { await server.close(); }
  });
  it('publishes unread activity and only acknowledges the revision actually seen by a client', async () => {
    const snapshot = createTestSnapshot();
    const agent = { ...sdkAgent(), teamId: 'team-test' };
    snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = [agent.id];
    const events = vi.fn(); const save = vi.fn(async () => {});
    const server = new AppBackendServer({ version: 'test', snapshot, onEvent: events, saveSnapshot: save });
    const attention = (revision: number) => server.emitEvent(turnCompleted(agent.id, `turn-${revision}`, { conversationId: 'conversation-a' }));
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
