import { describe, expect, it } from 'vitest';
import type { Message, SessionState } from '@korus-dev/multi-agent-sdk';
import type { Agent } from '@workspace/core/contracts';
import { presentSessionState } from '../../conversation-presentation/presentation';
import { projectSessionConversation } from '../../provider-conversation-bindings';

const state = (patch: Partial<SessionState> = {}): SessionState => ({
  messages: [], busy: false, activeTurnId: null, turns: [], requests: [], error: null, title: null, goal: null, contextUsage: null, plan: null, ...patch,
});
const message = (id: string, parts: Message['parts']): Message => ({ id, agentId: 'a', role: 'assistant', status: 'complete', createdAt: '', parts });
const agent = (patch: Partial<Agent> = {}) => ({ id: 'a', provider: 'codex', providerSession: { kind: 'codex', threadId: 'thread' }, ...patch }) as Agent;

describe('conversation presentation', () => {
  it('shows the harness state as it is, with the latest turn', () => {
    expect(presentSessionState(null)).toBeNull();
    const turns = [{ id: 'first', status: 'completed' }, { id: 'last', status: 'inProgress' }] as SessionState['turns'];
    const source = state({ turns, permission: 'ask-for-approval', selection: { model: 'terra', reasoningEffort: 'high' } });
    const original = structuredClone(source);
    expect(presentSessionState(source)).toMatchObject({ latestTurnId: 'last', permission: 'ask-for-approval', selection: { model: 'terra', reasoningEffort: 'high' }, requests: [] });
    expect(source).toEqual(original);
    expect(presentSessionState(state())?.latestTurnId).toBeNull();
  });

  it('keeps Cursor thoughts out of the pane and drops messages that only held thoughts', () => {
    const messages = [
      message('mixed', [{ type: 'reasoning', itemId: 'r', summary: 'Thought', summaryIndex: 0 }, { type: 'text', text: 'Answer' }]),
      message('thought', [{ type: 'reasoning', itemId: 'r2', summary: 'Thought', summaryIndex: 0 }]),
    ];
    const cursor = projectSessionConversation(state({ messages }), agent({ provider: 'cursor', providerSession: { kind: 'cursor', sessionId: 's' } }))!;
    expect(cursor.messages.map(m => m.parts)).toStrictEqual([[{ type: 'text', text: 'Answer' }]]);
    expect(projectSessionConversation(state({ messages }), agent())!.messages).toHaveLength(2);
  });

  it('leaves a plan under sidebar review out of the pane, for its own conversation and turn only', () => {
    const request = { id: 'plan', kind: 'toolConfirmation', conversationId: 'thread', confirmation: { integrationId: 'x', integrationName: 'x', toolName: 'plan', summary: 'Plan', argumentsPreview: '', allowAlways: false } } as const;
    const pending = { id: 'review', conversationId: 'thread', turnId: 'turn', requestId: 'plan', markdown: '# Plan', status: 'pending' } as const;
    const source = state({ activeTurnId: 'turn', requests: [request] });
    expect(projectSessionConversation(source, agent({ planReview: pending }))!.requests).toStrictEqual([]);
    expect(projectSessionConversation(source, agent({ planReview: { ...pending, conversationId: 'other' } }))!.requests).toStrictEqual([request]);
    expect(projectSessionConversation(source, agent({ planReview: { ...pending, turnId: 'earlier' } }))!.requests).toStrictEqual([request]);
  });
});
