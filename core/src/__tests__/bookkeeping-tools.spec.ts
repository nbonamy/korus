import { describe, expect, it } from 'vitest';
import type { Message, MessagePart } from '@korus-dev/multi-agent-sdk';
import { product } from '../product';
import { isBookkeepingTool } from '../bookkeeping-tools';
import { createScriptedHarness } from '@korus-dev/multi-agent-sdk/testing';

// Korus's own status tools report on a turn; the text before them is still the turn's answer.
const tool = (id: string, metadata?: Record<string, unknown>): MessagePart => ({ type: 'tool', id, kind: 'generic', title: id, status: 'completed', ...(metadata ? { metadata } : {}) });
const turn: Message[] = [{ id: 'a1', agentId: 'agent', turnId: 'turn-1', role: 'assistant', status: 'complete', createdAt: '2026-11-11T10:00:00.000Z', parts: [
  { type: 'text', text: 'Reading.' }, tool('read'), { type: 'text', text: 'All done.' },
  tool('finish', { server: product.mcpServerName, tool: 'finish_turn' }), tool('status', { server: product.mcpServerName, tool: 'set-status' }),
] }];
const phases = (messages: readonly Message[]) => messages.flatMap(m => m.parts.flatMap(part => part.type === 'text' ? [[part.text, part.phase]] : []));
const claude = { agentId: 'agent', sessionId: 's', activeTurnId: null, turnIds: [], turns: [], messages: turn, answeredClientRequestIds: [], busy: false,
  historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null };

const transcript = (provider: 'claude' | 'cursor' | 'antigravity') => provider === 'claude' ? claude
  : { agentId: 'agent', sessionId: 's', activeTurnId: null, turns: [], messages: turn, clientRequests: [], answeredClientRequestIds: [], busy: false, historyLoading: false,
    historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, error: null, ...(provider === 'cursor' ? { plan: null } : {}) };

describe('Korus bookkeeping tools in work phases', () => {
  it.each(['claude', 'cursor', 'antigravity'] as const)('keeps the text before finish-turn and set-status as the %s final answer', provider => {
    const { harness, script } = createScriptedHarness(provider, { isBookkeepingTool });
    const session = harness.open({ id: 'agent', folder: '/work' });
    script.emit({ type: `${provider}.conversationSnapshotChanged`, agentId: 'agent', provider, payload: { revision: 1, snapshot: structuredClone(transcript(provider)) } } as never);
    expect(phases(harness.readSession(session).messages)).toStrictEqual([['Reading.', 'commentary'], ['All done.', 'final_answer']]);
  });
});
