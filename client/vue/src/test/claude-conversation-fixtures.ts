import type { ClaudeConversationSnapshot, RendererMessage } from '@workspace/core/contracts';

export function claudeConversationSnapshot(
  messages: RendererMessage[] = [],
  overrides: Partial<ClaudeConversationSnapshot> = {},
): ClaudeConversationSnapshot {
  return {
    agentId: 'agent-dina',
    sessionId: 'claude-session-1',
    activeTurnId: null,
    turnIds: [],
    turns: [],
    messages,
    answeredClientRequestIds: [],
    busy: false,
    historyLoading: false,
    historyState: { hasOlder: false, loadingOlder: false },
    contextUsage: null,
    plan: null,
    error: null,
    ...overrides,
  };
}
