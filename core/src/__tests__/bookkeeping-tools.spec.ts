import { describe, expect, it } from 'vitest';
import type { Message, MessagePart } from '@korus-dev/multi-agent-sdk';
import { product } from '../product';
import { isBookkeepingTool } from '../bookkeeping-tools';
import { createClaudeConversationReplica } from '@korus-dev/multi-agent-sdk/contracts';
import { createCursorConversationReplica, emptyCursorSnapshot } from '@korus-dev/multi-agent-sdk/contracts';
import { createAntigravityConversationReplica, emptyAntigravitySnapshot } from '@korus-dev/multi-agent-sdk/contracts';

// Korus's own status tools report on a turn; the text before them is still the turn's answer.
const tool = (id: string, metadata?: Record<string, unknown>): MessagePart => ({ type: 'tool', id, kind: 'generic', title: id, status: 'completed', ...(metadata ? { metadata } : {}) });
const turn: Message[] = [{ id: 'a1', agentId: 'agent', turnId: 'turn-1', role: 'assistant', status: 'complete', createdAt: '2026-11-11T10:00:00.000Z', parts: [
  { type: 'text', text: 'Reading.' }, tool('read'), { type: 'text', text: 'All done.' },
  tool('finish', { server: product.mcpServerName, tool: 'finish_turn' }), tool('status', { server: product.mcpServerName, tool: 'set-status' }),
] }];
const phases = (messages: readonly Message[]) => messages.flatMap(m => m.parts.flatMap(part => part.type === 'text' ? [[part.text, part.phase]] : []));
const claude = { agentId: 'agent', sessionId: 's', activeTurnId: null, turnIds: [], turns: [], messages: turn, answeredClientRequestIds: [], busy: false,
  historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null };

describe('Korus bookkeeping tools in work phases', () => {
  it.each([
    ['claude', () => createClaudeConversationReplica(structuredClone(claude), { isBookkeepingTool })],
    ['cursor', () => createCursorConversationReplica({ ...emptyCursorSnapshot('agent', 's'), messages: structuredClone(turn) }, { isBookkeepingTool })],
    ['antigravity', () => createAntigravityConversationReplica({ ...emptyAntigravitySnapshot('agent', 's'), messages: structuredClone(turn) }, { isBookkeepingTool })],
  ])('keeps the text before finish-turn and set-status as the %s final answer', (_provider, create) => {
    expect(phases(create().getSnapshot().messages)).toStrictEqual([['Reading.', 'commentary'], ['All done.', 'final_answer']]);
  });
});
