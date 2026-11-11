import { describe, expect, it } from 'vitest';
import { decodeAppBackendEvent } from '../backend-protocol/events';
import { createInitialSnapshot } from '../snapshot';
import { applySubagentEventToSnapshot as applyMainEventToSnapshot } from '../snapshot-subagent-reducer';
import type { SnapshotEventOwnedBy } from '../snapshot-event-ownership';

describe('snapshot subagent reducer', () => {
  it('builds and updates the current subagent tree from app-owned events', () => {
    const snapshot = createInitialSnapshot();
    const agentId = snapshot.agents[0].id;
    snapshot.agents[0].providerSession = { kind: 'codex', threadId: 'thread-root' };

    applyMainEventToSnapshot(snapshot, {
      seq: 1,
      agentId,
      provider: 'codex',
      threadId: 'thread-root',
      turnId: 'turn-1',
      type: 'subagent.operationChanged',
      payload: {
        rootConversationId: 'thread-root',
        operation: {
          id: 'followup-1',
          turnId: 'turn-1',
          lifecycle: 'started',
          kind: 'followupTask',
          status: 'interrupted',
          senderConversationId: 'thread-root',
          receiverConversationIds: ['thread-child'],
          prompt: 'Inspect tests',
          model: 'gpt-5',
          reasoningEffort: 'high',
          occurredAt: '2026-06-05T00:00:01.000Z',
        },
        agentStates: {
          'thread-child': { status: 'running' },
        },
      },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    applyMainEventToSnapshot(snapshot, {
      seq: 2,
      agentId,
      provider: 'codex',
      threadId: 'thread-root',
      turnId: 'turn-1',
      type: 'subagent.activityChanged',
      payload: {
        rootConversationId: 'thread-root',
        parentConversationId: 'thread-root',
        activity: {
          id: 'activity-1',
          turnId: 'turn-1',
          lifecycle: 'completed',
          kind: 'completed',
          conversationId: 'thread-child',
          agentPath: '/root/scout',
          occurredAt: '2026-06-05T00:00:02.000Z',
        },
      },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });
    applyMainEventToSnapshot(snapshot, {
      seq: 3,
      agentId,
      provider: 'codex',
      threadId: 'thread-root',
      type: 'subagent.identityChanged',
      payload: {
        rootConversationId: 'thread-root',
        conversationId: 'thread-child',
        agentNickname: 'Harvey',
        agentRole: 'worker',
      },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });

    expect(snapshot.subagentTrees[agentId]).toStrictEqual({
      rootConversationId: 'thread-root',
      nodes: {
        'thread-child': {
          conversationId: 'thread-child',
          parentConversationId: 'thread-root',
          createdAt: '2026-06-05T00:00:01.000Z',
          status: 'running',
          agentPath: '/root/scout',
          agentNickname: 'Harvey',
          agentRole: 'worker',
          prompt: 'Inspect tests',
          model: 'gpt-5',
          reasoningEffort: 'high',
          updatedAt: '2026-06-05T00:00:02.000Z',
        },
      },
      operations: {
        'followup-1': expect.objectContaining({ kind: 'followupTask', status: 'interrupted', receiverConversationIds: ['thread-child'] }),
      },
      activities: {
        'activity-1': expect.objectContaining({ kind: 'completed', conversationId: 'thread-child' }),
      },
    });

    applyMainEventToSnapshot(snapshot, {
      seq: 4,
      agentId,
      provider: 'codex',
      threadId: 'thread-child',
      turnId: 'turn-child',
      type: 'subagent.activityChanged',
      payload: {
        rootConversationId: 'thread-root',
        parentConversationId: 'thread-child',
        activity: {
          id: 'activity-root',
          turnId: 'turn-child',
          lifecycle: 'completed',
          kind: 'interacted',
          conversationId: 'thread-root',
          agentPath: '/root',
          occurredAt: '2026-06-05T00:00:03.000Z',
        },
      },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });

    expect(snapshot.subagentTrees[agentId]?.nodes['thread-root']).toBeUndefined();
    expect(snapshot.subagentTrees[agentId]?.activities['activity-root']).toBeUndefined();

    applyMainEventToSnapshot(snapshot, {
      seq: 5,
      agentId,
      provider: 'codex',
      threadId: 'thread-root',
      type: 'subagent.identityChanged',
      payload: {
        rootConversationId: 'thread-root',
        conversationId: 'thread-child',
      },
      occurredAt: '2026-06-05T00:00:04.000Z',
    });

    expect(snapshot.subagentTrees[agentId]?.nodes['thread-child']).not.toHaveProperty('agentNickname');
    expect(snapshot.subagentTrees[agentId]?.nodes['thread-child']).not.toHaveProperty('agentRole');
  });

  it('keeps payload identities provider-independent and clones operation receivers', () => {
    const snapshot = createInitialSnapshot();
    const agentId = snapshot.agents[0].id;
    const receiverConversationIds = ['payload-child', 'payload-root'];

    applyMainEventToSnapshot(snapshot, {
      seq: 1,
      agentId,
      provider: 'claude',
      threadId: 'envelope-thread',
      type: 'subagent.operationChanged',
      payload: {
        rootConversationId: 'payload-root',
        operation: {
          id: 'spawn-independent',
          lifecycle: 'started',
          kind: 'spawnAgent',
          status: 'inProgress',
          senderConversationId: 'payload-parent',
          receiverConversationIds,
          prompt: 'Inspect payload ownership',
          model: 'claude-sonnet',
          reasoningEffort: 'high',
          occurredAt: '2026-06-05T00:00:01.000Z',
        },
        agentStates: {
          'payload-child': { status: 'running', message: 'Working' },
        },
      },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });
    receiverConversationIds.push('mutated-after-reduction');

    const tree = snapshot.subagentTrees[agentId];
    expect(tree?.rootConversationId).toBe('payload-root');
    expect(tree?.operations['spawn-independent']).toStrictEqual({
      id: 'spawn-independent',
      lifecycle: 'started',
      kind: 'spawnAgent',
      status: 'inProgress',
      senderConversationId: 'payload-parent',
      receiverConversationIds: ['payload-child', 'payload-root'],
      prompt: 'Inspect payload ownership',
      model: 'claude-sonnet',
      reasoningEffort: 'high',
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    expect(tree?.nodes['payload-root']).toBeUndefined();
    expect(tree?.nodes['payload-child']).toMatchObject({
      parentConversationId: 'payload-parent',
      status: 'running',
      statusMessage: 'Working',
      prompt: 'Inspect payload ownership',
      model: 'claude-sonnet',
      reasoningEffort: 'high',
      updatedAt: '2026-06-05T00:00:01.000Z',
    });
  });

  it('applies terminal child-turn status to an existing subagent node', () => {
    const snapshot = createInitialSnapshot();
    const agentId = snapshot.agents[0].id;
    snapshot.subagentTrees[agentId] = {
      rootConversationId: 'thread-root',
      nodes: {
        'thread-child': {
          conversationId: 'thread-child',
          parentConversationId: 'thread-root',
          createdAt: '2026-06-05T00:00:01.000Z',
          status: 'running',
          statusMessage: 'Starting',
          updatedAt: '2026-06-05T00:00:01.000Z',
        },
      },
      operations: {},
      activities: {},
    };

    applyMainEventToSnapshot(snapshot, {
      seq: 1,
      agentId,
      provider: 'codex',
      threadId: 'thread-root',
      type: 'subagent.statusChanged',
      payload: {
        rootConversationId: 'thread-root',
        conversationId: 'thread-root',
        status: 'completed',
      },
      occurredAt: '2026-06-05T00:00:01.500Z',
    });
    expect(snapshot.subagentTrees[agentId]?.nodes['thread-root']).toBeUndefined();

    applyMainEventToSnapshot(snapshot, {
      seq: 2,
      agentId,
      provider: 'codex',
      threadId: 'thread-root',
      type: 'subagent.statusChanged',
      payload: {
        rootConversationId: 'thread-root',
        conversationId: 'thread-child',
        status: 'completed',
      },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });

    expect(snapshot.subagentTrees[agentId]?.nodes['thread-child']).toStrictEqual({
      conversationId: 'thread-child',
      parentConversationId: 'thread-root',
      createdAt: '2026-06-05T00:00:01.000Z',
      status: 'completed',
      updatedAt: '2026-06-05T00:00:02.000Z',
    });
  });

  it('rejects malformed subagent payloads and keeps missing-agent events as reducer no-ops', () => {
    const snapshot = createInitialSnapshot();
    const subagentTrees = snapshot.subagentTrees;
    const malformedEvents = [
      {
        seq: 1,
        agentId: 'agent-dina',
        provider: 'codex',
        threadId: 'thread-root',
        type: 'subagent.operationChanged',
        payload: {
          rootConversationId: 'thread-root',
          operation: {
            id: 'bad-operation', lifecycle: 'started', kind: 'spawnAgent', status: 'inProgress',
            senderConversationId: 'thread-root', receiverConversationIds: [42],
            occurredAt: '2026-06-05T00:00:01.000Z',
          },
          agentStates: {},
        },
        occurredAt: '2026-06-05T00:00:01.000Z',
      },
      {
        seq: 2,
        agentId: 'agent-dina',
        provider: 'codex',
        threadId: 'thread-root',
        type: 'subagent.activityChanged',
        payload: {
          rootConversationId: 'thread-root',
          parentConversationId: 'thread-root',
          activity: {
            id: 'bad-activity', lifecycle: 'started', kind: 'invalid',
            conversationId: 'thread-child', agentPath: '/root/child',
            occurredAt: '2026-06-05T00:00:02.000Z',
          },
        },
        occurredAt: '2026-06-05T00:00:02.000Z',
      },
      {
        seq: 3,
        agentId: 'agent-dina',
        provider: 'codex',
        threadId: 'thread-root',
        type: 'subagent.identityChanged',
        payload: { rootConversationId: 'thread-root', conversationId: 42 },
        occurredAt: '2026-06-05T00:00:03.000Z',
      },
      {
        seq: 4,
        agentId: 'agent-dina',
        provider: 'codex',
        threadId: 'thread-root',
        type: 'subagent.statusChanged',
        payload: { rootConversationId: 'thread-root', conversationId: 'thread-child', status: 'invalid' },
        occurredAt: '2026-06-05T00:00:04.000Z',
      },
    ];
    const agentlessEvent = {
        seq: 5,
        provider: 'codex',
        threadId: 'thread-root',
        type: 'subagent.operationChanged',
        payload: {
          rootConversationId: 'thread-root',
          operation: {
            id: 'agentless-operation', lifecycle: 'started', kind: 'spawnAgent', status: 'inProgress',
            senderConversationId: 'thread-root', receiverConversationIds: ['thread-child'],
            occurredAt: '2026-06-05T00:00:05.000Z',
          },
          agentStates: {},
        },
        occurredAt: '2026-06-05T00:00:05.000Z',
      } as unknown as SnapshotEventOwnedBy<'subagent'>;

    for (const event of malformedEvents) {
      expect(() => decodeAppBackendEvent(event)).toThrow();
    }
    applyMainEventToSnapshot(snapshot, agentlessEvent);

    expect(snapshot.subagentTrees).toBe(subagentTrees);
    expect(snapshot.subagentTrees).toStrictEqual({});
  });
});
