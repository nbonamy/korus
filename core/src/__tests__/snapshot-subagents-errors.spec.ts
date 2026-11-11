import { approvalOutcome } from '@workspace/core/agent-request';
import { describe, expect, it } from 'vitest';
import { decodeAppBackendEvent } from '../backend-protocol/events';
import { updateAgentFolder } from '../agent-manager';
import {
  applyMainEventToSnapshot,
  createInitialSnapshot,
} from '../snapshot';
import type { MainToRendererEvent } from '../contracts';

describe('snapshot reducer', () => {

  it('ignores provider transcript events and applies app-owned agent errors', () => {
    const snapshot = createInitialSnapshot();

    expect(updateAgentFolder(snapshot, 'missing-agent', '/tmp/nope')).toBeNull();

    applyMainEventToSnapshot(snapshot, {
      seq: 1,
      type: 'message.delta',
      payload: { delta: 'ignored without agent' },
      occurredAt: '2026-06-05T00:00:01.000Z',
    } as unknown as MainToRendererEvent);
    expect(() => decodeAppBackendEvent({
      seq: 2,
      agentId: 'agent-dina',
      provider: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-with-empty-delta',
      type: 'message.delta',
      payload: { delta: 123 },
      occurredAt: '2026-06-05T00:00:02.000Z',
    })).toThrow();
    applyMainEventToSnapshot(snapshot, {
      seq: 3,
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'error', message: 'Backend error' },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });

    expect(snapshot.agents[0].status).toStrictEqual({ type: 'error', message: 'Backend error' });
    const approval = {
      id: 'approval-global',
      kind: 'command' as const,
      conversationId: 'thread-1',
      itemId: 'command-1',
      title: 'Run tests',
    };
    snapshot.providerApprovals['agent-dina'] = [approval];
    applyMainEventToSnapshot(snapshot, {
      seq: 4,
      type: 'agentRequest.resolved',
      payload: { id: (approval).id, outcome: approvalOutcome(null, null, 'server') },
      occurredAt: '2026-06-05T00:00:04.000Z',
    } as unknown as MainToRendererEvent);
    applyMainEventToSnapshot(snapshot, {
      seq: 5,
      type: 'error',
      payload: { message: 'ignored without agent' },
      occurredAt: '2026-06-05T00:00:05.000Z',
    } as unknown as MainToRendererEvent);

    expect(snapshot.providerApprovals['agent-dina']).toStrictEqual([approval]);
  });


  it('clears subagents when the agent starts a different root conversation', () => {
    const snapshot = createInitialSnapshot();
    const agentId = snapshot.agents[0].id;
    snapshot.subagentTrees[agentId] = {
      rootConversationId: 'thread-old',
      nodes: {},
      operations: {},
      activities: {},
    };

    applyMainEventToSnapshot(snapshot, { conversationId: 'thread-1',
      seq: 1,
      agentId,
      provider: 'codex',
      threadId: 'thread-new',
      type: 'agent.conversationAttached',
      payload: {},
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    expect(snapshot.subagentTrees[agentId]).toBeUndefined();
  });
});
