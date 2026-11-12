import type { Message, SessionState } from '@korus-dev/multi-agent-sdk';
import type { HarnessProvider } from '@workspace/core/contracts';
import type { CompanionConversation, CompanionConversationPatch } from '@workspace/core/companion-protocol';

export const textMessage = (id: string, role: 'user' | 'assistant', text: string, turnId?: string): Message =>
  ({ id, agentId: 'agent', role, status: 'complete', createdAt: '2026-01-01T00:00:00Z', parts: [{ type: 'text', text }], ...(turnId ? { turnId } : {}) });
const sessionState = (messages: Message[] = [], extra: Partial<SessionState> = {}): SessionState =>
  ({ messages, busy: false, activeTurnId: null, turns: [], requests: [], error: null, title: null, goal: null, contextUsage: null, plan: null, ...extra });
/** An agent's conversation as the laptop sends it: neutral session state on one stream. */
export function conversation(agentId: string, options: { provider?: HarnessProvider; conversation?: string | null; epoch?: string; revision?: number; messages?: Message[]; state?: Partial<SessionState> } = {}): CompanionConversation {
  return { type: 'conversation.sessionSnapshot', agentId, provider: options.provider ?? 'codex',
    payload: { conversation: options.conversation === undefined ? agentId : options.conversation, epoch: options.epoch ?? 'epoch', snapshot: { revision: options.revision ?? 1, state: sessionState(options.messages, options.state) } } };
}
export function conversationPatch(base: CompanionConversation, revision: number, ops: CompanionConversationPatch['payload']['patch']['ops']): CompanionConversationPatch {
  return { type: 'conversation.sessionPatch', agentId: base.agentId, provider: base.provider, payload: { conversation: base.payload.conversation, epoch: base.payload.epoch, patch: { revision, ops } } };
}
