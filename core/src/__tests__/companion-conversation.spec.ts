import { describe, expect, it } from 'vitest';
import { followCompanionConversation, followsCompanionConversation, type CompanionConversation, type CompanionConversationPatch } from '../companion-protocol';

const state = { messages: [], busy: false, activeTurnId: null, turns: [], requests: [], error: null, title: null, goal: null, contextUsage: null, plan: null };
const snapshot = (revision: number, epoch = 'epoch', title: string | null = null): CompanionConversation =>
  ({ type: 'conversation.sessionSnapshot', agentId: 'agent', provider: 'cursor', payload: { conversation: 'chat', epoch, snapshot: { revision, state: { ...state, title } } } });
const patch = (revision: number, epoch = 'epoch', ops: CompanionConversationPatch['payload']['patch']['ops'] = [{ op: 'set', key: 'title', value: `title ${revision}` }]): CompanionConversationPatch =>
  ({ type: 'conversation.sessionPatch', agentId: 'agent', provider: 'cursor', payload: { conversation: 'chat', epoch, patch: { revision, ops } } });

describe('following a companion conversation', () => {
  it('applies patches in order within a stream and keeps the state for stale ones', () => {
    const base = snapshot(1);
    const next = followCompanionConversation(base, patch(2))!;
    expect(next.payload.snapshot).toStrictEqual({ revision: 2, state: { ...state, title: 'title 2' } });
    expect(followCompanionConversation(next, patch(2))).toBe(next);
    expect(followCompanionConversation(next, snapshot(1))).toBe(next);
  });
  it('needs a fresh snapshot after a gap, an invalid patch or another stream', () => {
    expect(followCompanionConversation(snapshot(1), patch(3))).toBeNull();
    expect(followCompanionConversation(snapshot(1), patch(2, 'epoch', [{ op: 'spliceMessages', start: 4, deleteCount: 0, messages: [] }]))).toBeNull();
    expect(followCompanionConversation(snapshot(1), patch(2, 'restarted'))).toBeNull();
    expect(followCompanionConversation(null, patch(2))).toBeNull();
  });
  it('lets any snapshot of a new stream replace the conversation, whatever its revision', () => {
    expect(followCompanionConversation(snapshot(9), snapshot(1, 'restarted', 'new'))?.payload.snapshot.state.title).toBe('new');
    expect(followCompanionConversation(null, snapshot(1))?.payload.epoch).toBe('epoch');
  });
  it('belongs to the conversation the agent is attached to, and to any before it attaches', () => {
    const agent = { id: 'agent', provider: 'cursor' as const, providerSession: { kind: 'cursor' as const, conversationId: 'chat' } };
    expect(followsCompanionConversation(snapshot(1), agent)).toBe(true);
    expect(followsCompanionConversation({ ...snapshot(1), payload: { ...snapshot(1).payload, conversation: null } }, agent)).toBe(true);
    expect(followsCompanionConversation(snapshot(1), { ...agent, providerSession: { kind: 'cursor', conversationId: 'other' } })).toBe(false);
    expect(followsCompanionConversation(snapshot(1), { ...agent, provider: 'claude' })).toBe(false);
    expect(followsCompanionConversation(snapshot(1), { ...agent, providerSession: undefined })).toBe(true);
  });
});
