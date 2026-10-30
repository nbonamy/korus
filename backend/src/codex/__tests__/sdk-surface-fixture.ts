import { vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import type { BackendEvent } from '@workspace/core/backend-driver';
import type { CodexConversation, CodexSurface } from '@codex-app-sdk/backend';
import type { CodexConversationEvent, CodexConversationSnapshot, CodexConversationSummary, CodexSurfaceEvent } from '@codex-app-sdk/core/surface';
import { CodexBackendDriver } from '../codex-driver';
import { CodexSurfaceAgentAdapter } from '../codex-surface-adapter';

export function sdkSnapshot(id = 'conversation-a', overrides: Partial<CodexConversationSnapshot> = {}): CodexConversationSnapshot {
  return {
    status: 'ready', authentication: {
      status: 'loaded', account: null, requiresOpenaiAuth: false, error: null,
      login: { status: 'idle', loginId: null, authUrl: null, error: null },
    },
    conversations: [], activeConversationId: id, activeTurnId: null, turnIds: [], turns: [], messages: [],
    clientRequests: [], answeredClientRequestIds: [], approvals: [], models: [],
    modelCatalogStatus: 'loaded', skills: [], skillCatalogStatus: 'loaded', plugins: [], pluginCatalogStatus: 'loaded',
    permissionProfiles: [], approvalPresets: [], approvalPreset: null, selectedModelId: null,
    selectedReasoningEffort: null, selectedServiceTier: null, planMode: false, contextUsage: null,
    goal: null, turnGitDiff: null, threadStatus: null, rateLimits: null, queuedPrompts: [],
    busy: false, historyLoading: false, error: null, ...overrides,
  };
}

export function sdkAgent(id = 'agent-a', conversationId = 'conversation-a'): Agent {
  return {
    id, name: id, avatar: 'A', folder: '/repo', backend: 'codex',
    backendSession: { kind: 'codex', threadId: conversationId },
    status: { type: 'idle' }, createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z',
  };
}

export function sdkSummary(id: string, overrides: Partial<CodexConversationSummary> = {}): CodexConversationSummary {
  return { id, title: id, preview: '', cwd: '/repo', status: 'idle', turnCount: 0, createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z', ...overrides };
}

/** A scripted SDK boundary, not an SDK reducer: tests supply snapshots and events explicitly. */
function conversationFixture(id: string) {
  let snapshot = sdkSnapshot(id);
  const listeners = new Set<(event: CodexConversationEvent) => void>();
  const handle = {
    id,
    getSnapshot: vi.fn(() => snapshot),
    onEvent: vi.fn((listener: (event: CodexConversationEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }),
    load: vi.fn<CodexConversation['load']>(async () => snapshot),
    sendMessage: vi.fn<CodexConversation['sendMessage']>(async () => snapshot),
    steerMessage: vi.fn<CodexConversation['steerMessage']>(async () => snapshot),
    interrupt: vi.fn<CodexConversation['interrupt']>(async () => snapshot),
    rename: vi.fn<CodexConversation['rename']>(async () => snapshot),
    updateSettings: vi.fn<CodexConversation['updateSettings']>(async () => snapshot),
    setGoal: vi.fn<CodexConversation['setGoal']>(async () => snapshot),
    clearGoal: vi.fn<CodexConversation['clearGoal']>(async () => snapshot),
    startReview: vi.fn<CodexConversation['startReview']>(async () => snapshot),
    resolveApproval: vi.fn<CodexConversation['resolveApproval']>(async () => snapshot),
    respondToClientRequest: vi.fn<CodexConversation['respondToClientRequest']>(async () => snapshot),
    editTurn: vi.fn<CodexConversation['editTurn']>(async () => snapshot),
    deleteTurn: vi.fn<CodexConversation['deleteTurn']>(async () => snapshot),
    retryTurn: vi.fn<CodexConversation['retryTurn']>(async () => snapshot),
    continueInterruptedTurn: vi.fn<CodexConversation['continueInterruptedTurn']>(async () => snapshot),
    fork: vi.fn<CodexConversation['fork']>(),
    forkTurn: vi.fn<CodexConversation['forkTurn']>(),
    readContent: vi.fn<CodexConversation['readContent']>(),
    readHistory: vi.fn<CodexConversation['readHistory']>(),
    loadOlderHistory: vi.fn<CodexConversation['loadOlderHistory']>(),
    loadTurnHistory: vi.fn<CodexConversation['loadTurnHistory']>(async () => snapshot),
  } satisfies Partial<CodexConversation>;
  return {
    handle,
    setSnapshot(next: Partial<CodexConversationSnapshot>) { snapshot = sdkSnapshot(id, next); },
    emit(event: CodexConversationEvent) { for (const listener of listeners) listener(event); },
    listenerCount: () => listeners.size,
  };
}

export function codexSdkFixture(closeRuntime?: () => Promise<void>) {
  const conversations = new Map<string, ReturnType<typeof conversationFixture>>();
  const listeners = new Set<(event: CodexSurfaceEvent) => void>();
  const conversation = (id: string) => {
    if (!conversations.has(id)) conversations.set(id, conversationFixture(id));
    return conversations.get(id)!;
  };
  const surface = {
    connect: vi.fn<CodexSurface['connect']>(),
    close: vi.fn<CodexSurface['close']>(),
    getSnapshot: vi.fn<CodexSurface['getSnapshot']>(() => sdkSnapshot()),
    onEvent: vi.fn((listener: (event: CodexSurfaceEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }),
    conversation: vi.fn((id: string) => conversation(id).handle as unknown as CodexConversation),
    forgetConversation: vi.fn<CodexSurface['forgetConversation']>(),
    createConversation: vi.fn<CodexSurface['createConversation']>(),
    archiveConversation: vi.fn<CodexSurface['archiveConversation']>(async (id) => sdkSnapshot(id)),
    deleteConversation: vi.fn<CodexSurface['deleteConversation']>(async (id) => sdkSnapshot(id)),
    unarchiveConversation: vi.fn<CodexSurface['unarchiveConversation']>(async (id) => sdkSnapshot(id)),
    listConversations: vi.fn<CodexSurface['listConversations']>().mockResolvedValue([]),
    listModels: vi.fn<CodexSurface['listModels']>().mockResolvedValue([]),
    listSkills: vi.fn<CodexSurface['listSkills']>().mockResolvedValue([]),
    readConversationSummary: vi.fn<CodexSurface['readConversationSummary']>(),
    generateText: vi.fn<CodexSurface['generateText']>(),
    refreshAccount: vi.fn<CodexSurface['refreshAccount']>(),
    startChatGptLogin: vi.fn<CodexSurface['startChatGptLogin']>(),
    startChatGptDeviceCodeLogin: vi.fn<CodexSurface['startChatGptDeviceCodeLogin']>(),
    cancelLogin: vi.fn<CodexSurface['cancelLogin']>(),
    logout: vi.fn<CodexSurface['logout']>(),
    readRemoteControlStatus: vi.fn<CodexSurface['readRemoteControlStatus']>(),
    readConfigRequirements: vi.fn<CodexSurface['readConfigRequirements']>().mockResolvedValue(null),
    enableRemoteControl: vi.fn<CodexSurface['enableRemoteControl']>(),
    disableRemoteControl: vi.fn<CodexSurface['disableRemoteControl']>(),
    startRemoteControlPairing: vi.fn<CodexSurface['startRemoteControlPairing']>(),
    readRemoteControlPairingStatus: vi.fn<CodexSurface['readRemoteControlPairingStatus']>(),
    listRemoteControlClients: vi.fn<CodexSurface['listRemoteControlClients']>(),
    revokeRemoteControlClient: vi.fn<CodexSurface['revokeRemoteControlClient']>(),
    respondToClientRequest: vi.fn<CodexSurface['respondToClientRequest']>(),
  } satisfies Partial<CodexSurface>;
  // SDK classes have private members; each implemented public member is checked above.
  const adapter = new CodexSurfaceAgentAdapter(surface as unknown as CodexSurface, closeRuntime);
  const driver = new CodexBackendDriver(adapter);
  const events: BackendEvent[] = [];
  driver.onEvent((event) => events.push(event));
  return { driver, adapter, surface, conversation, events,
    emit(event: CodexSurfaceEvent) { for (const listener of listeners) listener(event); },
  };
}
