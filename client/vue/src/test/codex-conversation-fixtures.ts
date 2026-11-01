import type { CodexConversationSnapshot, SurfaceMessage } from '@codex-app-sdk/core/surface';

export function codexConversationSnapshot(
  messages: SurfaceMessage[] = [],
  overrides: Partial<CodexConversationSnapshot> = {},
): CodexConversationSnapshot {
  return {
    status: 'ready',
    authentication: {
      status: 'loaded', account: null, requiresOpenaiAuth: false,
      error: null, login: { status: 'idle', loginId: null, authUrl: null, error: null },
    },
    conversations: [], activeConversationId: 'thread-1', activeTurnId: null,
    turnIds: [], turns: [], messages,
    clientRequests: [], answeredClientRequestIds: [], approvals: [], models: [],
    modelCatalogStatus: 'loaded', skills: [], skillCatalogStatus: 'loaded',
    plugins: [], pluginCatalogStatus: 'loaded', permissionProfiles: [],
    approvalPresets: [], approvalPreset: null, selectedModelId: null,
    selectedReasoningEffort: null, selectedServiceTier: null, planMode: false,
    contextUsage: null, goal: null, turnGitDiff: null, threadStatus: null,
    rateLimits: null, queuedPrompts: [], busy: false, historyLoading: false,
    error: null,
    ...overrides,
  };
}

export function codexTextMessage(
  id: string,
  role: 'assistant' | 'user',
  text: string,
  turnId = 'turn-1',
): SurfaceMessage {
  return {
    id,
    role,
    status: 'complete',
    turnId,
    parts: [{ type: 'text', text }],
    createdAt: '2026-09-06T00:00:00.000Z',
  };
}
