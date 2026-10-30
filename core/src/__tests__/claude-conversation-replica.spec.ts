import { describe, expect, it } from 'vitest';
import { createClaudeConversationReplica } from '../claude-conversation-replica';
import type { ClaudeConversationEvent, ClaudeConversationSnapshot } from '../contracts';

describe('Claude conversation replica', () => {
  it('prepends history without replacing live rows and ignores pages from another session', () => {
    const live = { id: 'live', agentId: 'agent-1', turnId: 'turn', role: 'assistant' as const, status: 'streaming' as const, createdAt: '', parts: [{ type: 'text' as const, text: 'Authoritative live text' }] };
    const older = { ...live, id: 'older', status: 'complete' as const, parts: [{ type: 'text' as const, text: 'Older text' }] };
    const initial = { ...emptySnapshot(), sessionId: 'session', messages: [live], busy: true, activeTurnId: 'turn' };
    const replica = createClaudeConversationReplica(initial);
    const page = event({ type: 'history.prepended', backendSessionId: 'session', payload: { messages: [older, older, { ...live, parts: [] }], hasOlder: false } });
    replica.apply({ ...page, backendSessionId: 'other' });
    expect(replica.getSnapshot()).toStrictEqual(initial);
    replica.apply(page); replica.apply(page);
    expect(replica.getSnapshot()).toStrictEqual({ ...initial, messages: [older, live], historyState: { hasOlder: false, loadingOlder: false } });
    const detail = { ...older, id: 'earlier-detail', turnId: 'past', parts: [{ type: 'text' as const, text: 'Hydrated earlier detail' }] };
    const replacement = event({ type: 'message.replaced', backendSessionId: 'session', payload: { message: detail, beforeMessageId: older.id } });
    replica.apply({ ...replacement, backendSessionId: 'other' });
    expect(replica.getSnapshot().messages).toStrictEqual([older, live]);
    replica.apply(replacement); replica.apply(replacement);
    expect(replica.getSnapshot().messages).toStrictEqual([detail, older, live]);
    const update = event({ type: 'turn.historyUpdated', backendSessionId: 'session', payload: { turn: {
      id: 'past', status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null,
      itemsView: 'full', detailsLoading: false, detailsError: null,
    } } });
    replica.apply({ ...update, backendSessionId: 'other' });
    expect(replica.getSnapshot().turns).toStrictEqual([]);
    replica.apply(update);
    expect(replica.getSnapshot()).toMatchObject({ busy: true, activeTurnId: 'turn', turns: [update.payload.turn] });
  });
  it('keeps a steering message between the answers received before and after it', () => {
    const replica = createClaudeConversationReplica(emptySnapshot());
    replica.apply(event({ type: 'turn.started', turnId: 'turn-1', payload: { turn: { id: 'turn-1', backend: 'claude' } } }));
    replica.apply(event({ type: 'message.delta', turnId: 'turn-1', payload: { messageId: 'answer', delta: 'Before' } }));
    replica.apply(event({ type: 'message.userSubmitted', turnId: 'turn-1', payload: { message: { id: 'steer-1', agentId: 'agent-1', role: 'user', kind: 'steer', status: 'complete', turnId: 'turn-1', createdAt: '2026-10-04T00:00:00Z', parts: [{ type: 'text', text: 'Change it' }] } } }));
    replica.apply(event({ type: 'message.delta', turnId: 'turn-1', payload: { messageId: 'answer', delta: 'After' } }));
    expect(replica.getSnapshot().messages.map((message) => message.parts)).toEqual([
      [{ type: 'text', text: 'Before' }], [{ type: 'text', text: 'Change it' }], [{ type: 'text', text: 'After' }],
    ]);
  });

  it('owns one turn transcript from prompt submission through completion', () => {
    const replica = createClaudeConversationReplica(emptySnapshot());

    replica.apply(event({
      type: 'turn.started',
      turnId: 'turn-1',
      payload: { turn: { id: 'turn-1', backend: 'claude' } },
    }));
    const submitted = event({
      type: 'message.userSubmitted',
      turnId: 'turn-1',
      payload: {
        message: {
          id: 'user-1', agentId: 'agent-1', role: 'user', status: 'complete', turnId: 'turn-1',
          createdAt: '2026-09-06T00:00:01.000Z', parts: [{ type: 'text', text: 'Fix it' }],
        },
      },
    });
    replica.apply(submitted);
    replica.apply(event({
      type: 'message.delta',
      turnId: 'turn-1',
      payload: { messageId: 'assistant-1', itemId: 'text-1', delta: 'Done' },
    }));
    replica.apply(event({
      type: 'turn.completed',
      turnId: 'turn-1',
      payload: { turn: { id: 'turn-1', status: 'completed' } },
    }));

    expect(replica.getSnapshot()).toMatchObject({
      activeTurnId: null,
      turnIds: ['turn-1'],
      turns: [{ id: 'turn-1', status: 'completed', willRetry: false }],
      busy: false,
      messages: [
        { id: 'user-1', turnId: 'turn-1', parts: [{ type: 'text', text: 'Fix it' }] },
        { id: 'assistant-turn-1', turnId: 'turn-1', parts: [{ type: 'text', text: 'Done', itemId: 'text-1' }] },
      ],
    });
    expect(submitted.payload.message).toStrictEqual({
      id: 'user-1', agentId: 'agent-1', role: 'user', status: 'complete', turnId: 'turn-1',
      createdAt: '2026-09-06T00:00:01.000Z', parts: [{ type: 'text', text: 'Fix it' }],
    });
  });

  it('tracks tools, requests, plans, errors, and resolved request ids inside the provider state', () => {
    const replica = createClaudeConversationReplica(emptySnapshot());
    replica.apply(event({
      type: 'turn.started', turnId: 'turn-1',
      payload: { turn: { id: 'turn-1', backend: 'claude' } },
    }));
    replica.apply(event({
      type: 'item.started', turnId: 'turn-1',
      payload: { toolPart: { id: 'tool-1', type: 'tool', kind: 'command', title: 'npm test', status: 'running' } },
    }));
    replica.apply(event({
      type: 'item.updated', turnId: 'turn-1',
      payload: { itemId: 'tool-1', status: 'completed', output: 'pass' },
    }));
    replica.apply(event({
      type: 'approval.requested', turnId: 'turn-1',
      payload: {
        kind: 'confirm_tool', id: 'approval-1',
        payload: { confirmation: {
          integrationId: 'claude', integrationName: 'Claude', toolName: 'Bash',
          summary: 'Run tests', argumentsPreview: '{"command":"npm test"}',
          allowConversation: false, allowAlways: false,
        } },
      },
    }));
    replica.apply(event({
      type: 'clientRequest.resolved',
      payload: { id: 'approval-1' },
    }));
    replica.apply(event({
      type: 'turn.proposedPlanDelta', threadId: 'session-1', turnId: 'turn-1',
      payload: { itemId: 'plan-1', delta: '1. Test' },
    }));
    replica.apply(event({
      type: 'turn.proposedPlanCompleted', threadId: 'session-1', turnId: 'turn-1',
      payload: { itemId: 'plan-1', markdown: '1. Test' },
    }));
    replica.apply(event({ type: 'error', payload: { message: 'failed' } }));

    expect(replica.getSnapshot()).toMatchObject({
      answeredClientRequestIds: ['approval-1'],
      error: 'failed',
      plan: { turnId: 'turn-1' },
      messages: expect.arrayContaining([expect.objectContaining({
        role: 'assistant',
        parts: expect.arrayContaining([
          expect.objectContaining({ id: 'tool-1', status: 'completed', output: 'pass' }),
          expect.objectContaining({
            id: 'approval-approval-1',
            metadata: expect.objectContaining({ confirmationRequestId: 'approval-1' }),
          }),
          expect.objectContaining({ id: 'plan-turn-1', metadata: expect.objectContaining({ planProgress: true }) }),
        ]),
      })]),
    });
  });

  it('rejects events from another agent', () => {
    const replica = createClaudeConversationReplica(emptySnapshot());
    expect(() => replica.apply({
      ...event({ type: 'error', payload: { message: 'wrong owner' } }),
      agentId: 'agent-2',
    })).toThrow("belongs to 'agent-2'");
  });

  it('keeps published snapshots immutable while applying later events', () => {
    const initial = emptySnapshot();
    const replica = createClaudeConversationReplica(initial);
    const before = replica.getSnapshot();
    const afterStart = replica.apply(event({
      type: 'turn.started', turnId: 'turn-1', payload: { turn: { id: 'turn-1', backend: 'claude' } },
    }));
    const afterDelta = replica.apply(event({
      type: 'message.delta', turnId: 'turn-1', payload: { delta: 'Hello' },
    }));

    expect(initial).toStrictEqual(emptySnapshot());
    expect(before).not.toBe(afterStart);
    expect(afterStart).not.toBe(afterDelta);
    expect(afterStart.messages[0]?.parts).toStrictEqual([]);
    expect(afterDelta.messages[0]?.parts).toStrictEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('deduplicates user messages and resolved requests', () => {
    const replica = createClaudeConversationReplica(emptySnapshot());
    const submitted = event({
      type: 'message.userSubmitted',
      payload: { message: {
        id: 'user-1', agentId: 'agent-1', role: 'user', status: 'complete',
        createdAt, parts: [{ type: 'text', text: 'Fix it' }],
      } },
    });
    replica.apply(submitted);
    replica.apply(submitted);
    replica.apply(event({ type: 'clientRequest.resolved', payload: { id: 'request-1' } }));
    replica.apply(event({ type: 'clientRequest.resolved', payload: { id: 'request-1' } }));

    expect(replica.getSnapshot().messages).toHaveLength(1);
    expect(replica.getSnapshot().answeredClientRequestIds).toStrictEqual(['request-1']);
  });

  it('tracks compaction, ask-user requests, and retryable versus terminal errors', () => {
    const replica = createClaudeConversationReplica(emptySnapshot());
    replica.apply(event({
      type: 'turn.started', turnId: 'turn-1', payload: { turn: { id: 'turn-1', backend: 'claude' } },
    }));
    replica.apply(event({ type: 'context.compactionStarted', turnId: 'turn-1', payload: {} }));
    replica.apply(event({ type: 'context.compactionCompleted', turnId: 'turn-1', payload: { itemId: null } }));
    replica.apply(event({
      type: 'toolInput.requested', turnId: 'turn-1', payload: {
        id: 'request-1', kind: 'ask_user', payload: { request: {
          itemId: 'ask-1',
          questions: [{ id: 'q1', header: 'Choice', question: 'Continue?', isOther: false, isSecret: false, options: [] }],
        } },
      },
    }));
    replica.apply(event({ type: 'error', payload: { message: 'retrying', willRetry: true } }));
    expect(replica.getSnapshot().error).toBeNull();
    expect(replica.getSnapshot().messages.some((message) => message.role === 'system')).toBe(false);
    replica.apply(event({ type: 'error', payload: { message: 'stopped' } }));

    expect(replica.getSnapshot()).toMatchObject({ error: 'stopped' });
    expect(replica.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'compaction', status: 'complete' }),
      expect.objectContaining({ parts: expect.arrayContaining([expect.objectContaining({ id: 'ask-1' })]) }),
      expect.objectContaining({ role: 'system', parts: [{ type: 'status', text: 'stopped' }] }),
    ]));
  });

  it('updates existing lifecycle rows and completes turns that were not observed starting', () => {
    const initial = emptySnapshot();
    initial.activeTurnId = 'turn-other';
    initial.busy = true;
    initial.turnIds = ['turn-1'];
    initial.turns = [{
      id: 'turn-1', status: 'failed', error: null, willRetry: false,
      startedAt: '2026-09-06T00:00:00.000Z', completedAt: null, durationMs: null,
    }];
    const replica = createClaudeConversationReplica(initial);
    replica.apply(event({
      type: 'turn.started', turnId: 'turn-1', payload: { turn: { id: 'turn-1', backend: 'claude' } },
    }));
    replica.apply(event({
      type: 'turn.completed', turnId: 'turn-2', payload: { turn: { id: 'turn-2', status: 'interrupted' } },
    }));

    expect(replica.getSnapshot()).toMatchObject({
      activeTurnId: 'turn-1',
      turnIds: ['turn-1'],
      busy: false,
      turns: [
        { id: 'turn-1', status: 'inProgress', startedAt: createdAt },
        { id: 'turn-2', status: 'interrupted', startedAt: null, durationMs: null },
      ],
    });
  });
});

const createdAt = '2026-09-06T00:00:01.000Z';

function emptySnapshot(): ClaudeConversationSnapshot {
  return {
    agentId: 'agent-1',
    sessionId: 'session-1',
    activeTurnId: null,
    turnIds: [],
    turns: [],
    messages: [],
    answeredClientRequestIds: [],
    busy: false,
    historyLoading: false,
    historyState: { hasOlder: false, loadingOlder: false },
    contextUsage: null,
    plan: null,
    error: null,
  };
}

function event<T extends Omit<ClaudeConversationEvent, 'seq' | 'occurredAt' | 'agentId' | 'backend'>>(
  value: T,
): Extract<ClaudeConversationEvent, { type: T['type'] }> {
  return {
    ...value,
    seq: 1,
    occurredAt: createdAt,
    agentId: 'agent-1',
    backend: 'claude',
  } as unknown as Extract<ClaudeConversationEvent, { type: T['type'] }>;
}
