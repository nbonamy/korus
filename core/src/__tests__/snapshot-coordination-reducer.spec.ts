import { product } from '../product';
import { approvalAgentRequest, approvalOutcome } from '@workspace/core/agent-request';
import { describe, expect, it } from 'vitest';
import { applyMainEventToSnapshot, createEmptySnapshot } from '../snapshot';
import type { MainToRendererEvent } from '../contracts';

describe('snapshot coordination reducer', () => {
  it('owns queued prompt lifecycle without touching provider transcripts', () => {
    const snapshot = createEmptySnapshot();
    applyMainEventToSnapshot(snapshot, event({
      type: 'agent.promptQueued',
      agentId: 'agent-1',
      payload: { id: 'prompt-1', text: 'Fix it', submitted: true },
    }));
    applyMainEventToSnapshot(snapshot, event({
      type: 'agent.promptRetryScheduled',
      agentId: 'agent-1',
      payload: { id: 'prompt-1', attempts: 2, lastError: 'busy', retryAt: 'later' },
    }));

    expect(snapshot.queuedPrompts).toEqual([expect.objectContaining({
      id: 'prompt-1', attempts: 2, lastError: 'busy', retryAt: 'later', submitted: true,
    })]);

    applyMainEventToSnapshot(snapshot, event({
      type: 'agent.promptDequeued',
      agentId: 'agent-1',
      payload: { ids: ['prompt-1'] },
    }));
    expect(snapshot.queuedPrompts).toEqual([]);
  });

  it(`owns legacy backend approval lifecycle as ${product.name} coordination state`, () => {
    const snapshot = createEmptySnapshot();
    snapshot.agents.push({
      id: 'agent-1', name: 'Agent', folder: null, backend: 'codex', status: { type: 'idle' },
      createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z',
    });
    const approval = {
      id: 'approval-1', kind: 'command' as const, conversationId: 'thread-1', itemId: 'item-1',
      title: 'Run tests',
    };
    applyMainEventToSnapshot(snapshot, event({
      type: 'agentRequest.created', agentId: 'agent-1', backend: 'codex', threadId: 'thread-1',
      payload: { request: approvalAgentRequest(approval) },
    }));
    expect(snapshot.backendApprovals['agent-1']).toEqual([approval]);
    expect(snapshot.agents[0]?.status).toMatchObject({ type: 'awaitingInput', detail: 'Run tests' });

    applyMainEventToSnapshot(snapshot, event({
      type: 'agentRequest.resolved', agentId: 'agent-1', backend: 'codex', conversationId: 'older-conversation',
      payload: { id: approval.id, outcome: { kind: 'cancelled' } },
    }));
    expect(snapshot.backendApprovals['agent-1']).toEqual([approval]);
    expect(snapshot.agentRequests?.['agent-1']).toHaveLength(1);

    applyMainEventToSnapshot(snapshot, event({
      type: 'agentRequest.resolved', agentId: 'agent-1', backend: 'codex', threadId: 'thread-1',
      payload: { id: (approval).id, outcome: approvalOutcome('approve', 'once', 'host') },
    }));
    expect(snapshot.backendApprovals['agent-1']).toEqual([]);
  });

  it.each(['cancelled', 'allow', 'deny', 'revise'] as const)('settles the matching native plan request on %s without resolving newer reviews', kind => {
    const snapshot = createEmptySnapshot();
    const review = { id: 'review', conversationId: 'session', turnId: 'turn', requestId: 'plan', markdown: '# Plan', status: 'pending' as const };
    const agent = { id: 'agent-1', name: 'Agent', folder: null, backend: 'cursor' as const, status: { type: 'idle' as const }, createdAt: '', updatedAt: '', planReview: review };
    snapshot.agents.push(agent);
    const outcome = kind === 'cancelled' ? { kind: 'cancelled' as const }
      : { kind: 'decision' as const, decision: kind === 'allow' ? 'allow' as const : 'deny' as const, ...(kind === 'revise' ? { feedback: 'Keep English.' } : {}) };
    const resolve = (conversationId: string, id = 'plan') => applyMainEventToSnapshot(snapshot, event({
      type: 'agentRequest.resolved', agentId: agent.id, backend: 'cursor', conversationId, payload: { id, outcome },
    }));
    resolve('older-session');
    resolve('session', 'older-request');
    expect(agent.planReview.status).toBe('pending');
    Object.assign(agent.planReview, { deliveryPending: true });
    resolve('session');
    expect(agent.planReview.status).toBe('pending'); // The sidebar service owns its in-flight decision.
    Object.assign(agent.planReview, { deliveryPending: false });
    resolve('session');
    expect(agent.planReview.status).toBe(kind === 'allow' ? 'accept' : kind === 'revise' ? 'revise' : 'cancel');
  });

  it('stores turn diff summaries without rewriting provider messages', () => {
    const snapshot = createEmptySnapshot();
    applyMainEventToSnapshot(snapshot, event({
      type: 'conversation.turnDiffUpdated', agentId: 'agent-1', backend: 'codex', threadId: 'thread-1', turnId: 'turn-1',
      payload: { addedLines: 3, removedLines: 1, diff: '+three\n-one' },
    }));
    expect(snapshot.turnGitDiffs['turn-1']).toEqual({
      agentId: 'agent-1', turnId: 'turn-1', addedLines: 3, removedLines: 1, diff: '+three\n-one',
      updatedAt: '2026-09-06T00:00:00.000Z',
    });
  });
});

function event<T extends Omit<MainToRendererEvent, 'seq' | 'occurredAt'>>(value: T): MainToRendererEvent {
  return { ...value, seq: 1, occurredAt: '2026-09-06T00:00:00.000Z' } as MainToRendererEvent;
}
