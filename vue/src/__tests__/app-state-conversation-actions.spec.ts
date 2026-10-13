import { approvalAgentRequest, approvalOutcome } from '@workspace/core/agent-request';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { useAppState } from '../app-state';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { BackendApprovalRequest, BackendConversationRef, AppApi, ConversationSummary, MainToRendererEvent } from '@workspace/core/contracts';
import { clearConfetti } from '../shared/confetti/use-confetti';
import { stubElectronTestWindow } from '../test/client';
import { clearFirstRunOnboardingStage } from '../onboarding-session';
import { codexConversationSnapshot, codexTextMessage } from '../test/codex-conversation-fixtures';
import { claudeConversationSnapshot } from '../test/claude-conversation-fixtures';
import { deferred } from './app-state-test-harness';
describe('useAppState', () => {
  it('refreshes an already cached agent workspace on selection without clearing its conversation', async () => {
    const base = createInitialSnapshot();
    base.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-1' };
    let listener!: (event: MainToRendererEvent) => void;
    const loadConversationHistory = vi.fn(async () => structuredClone(base));
    stubElectronTestWindow({ app: {
      getSnapshot: vi.fn(async () => structuredClone(base)),
      selectAgent: vi.fn(async (agentId: string) => ({ ...structuredClone(base), activeAgentId: agentId })),
      loadConversationHistory,
      onEvent: (callback) => { listener = callback; return () => undefined; },
    } satisfies Partial<AppApi> });
    const state = useAppState();
    await state.loadSnapshot();
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalled());
    listener({ seq: 1, occurredAt: 'now', type: 'codex.conversationSnapshotChanged', agentId: 'agent-dina', backend: 'codex', threadId: 'thread-1', payload: { revision: 1, snapshot: codexConversationSnapshot() } });
    await state.selectAgent('agent-jesse');
    const refresh = deferred<ReturnType<typeof createInitialSnapshot>>();
    loadConversationHistory.mockImplementationOnce(() => refresh.promise);
    loadConversationHistory.mockClear();
    const selection = state.selectAgent('agent-dina');
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalledWith('agent-dina'));
    expect(state.activeCodexConversationSnapshot.value).not.toBeNull();
    refresh.resolve(structuredClone(base));
    await selection;
  });
  afterEach(() => {
    clearConfetti();
    clearFirstRunOnboardingStage();
    vi.useRealTimers();
  });

  it('does not send prompts without preload or an active agent', async () => {
    stubElectronTestWindow({});
    const state = useAppState();
    state.snapshot.value.activeAgentId = null;

    await state.sendPrompt('ignored');

    expect(state.isSending.value).toBe(false);
  });

  it('does not mark client requests answered when preload is unavailable', async () => {
    stubElectronTestWindow({});
    const state = useAppState();

    await state.respondToClientRequest({
      id: 'request-local',
      payload: {
        decision: 'deny',
      },
    });

    expect(state.answeredClientRequestIds.value.has('request-local')).toBe(false);
  });

  it('stores detailed approvals by agent and maps every resolution through the existing client-response bridge', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    const respondToClientRequest = vi.fn().mockImplementation(async () => {
      return { ...remoteSnapshot, backendApprovals: {} };
    });
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        respondToClientRequest,
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const approval: BackendApprovalRequest = {
      id: 'approval-native-1',
      kind: 'permissions',
      conversationId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      title: 'Allow workspace and network access',
      description: 'The tool needs both permissions.',
      cwd: '/tmp/project',
      requestedPermissions: [
        { kind: 'filesystem', access: 'write', path: '/tmp/project' },
        { kind: 'network', enabled: true, host: 'example.com', protocol: 'https' },
      ],
      allowedScopes: ['once', 'session'],
      canDeny: true,
    };
    const state = useAppState();
    await state.loadSnapshot();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest(approval) },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-jesse',
      backend: 'codex',
      threadId: 'thread-other',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest({ ...approval, id: 'approval-other', conversationId: 'thread-other' }) },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });

    expect(state.activeBackendApprovals.value).toStrictEqual([approval]);
    await state.resolveBackendApproval('approval-native-1', 'approve', 'session');

    expect(respondToClientRequest).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      id: 'approval-native-1',
      payload: { decision: 'allow_conversation' },
    });
    expect(state.activeBackendApprovals.value).toStrictEqual([]);
    expect(state.answeredClientRequestIds.value.has('approval-native-1')).toBe(true);

    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest({ ...approval, id: 'approval-once' }) },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });
    await state.resolveBackendApproval('approval-once', 'approve', 'once');

    expect(respondToClientRequest).toHaveBeenNthCalledWith(2, {
      agentId: 'agent-dina',
      id: 'approval-once',
      payload: { decision: 'allow' },
    });

    listeners[0]?.({
      seq: 4,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest({ ...approval, id: 'approval-deny' }) },
      occurredAt: '2026-06-05T00:00:04.000Z',
    });
    await state.resolveBackendApproval('approval-deny', 'deny', 'once');

    expect(respondToClientRequest).toHaveBeenNthCalledWith(3, {
      agentId: 'agent-dina',
      id: 'approval-deny',
      payload: { decision: 'deny' },
    });
    expect(state.activeBackendApprovals.value).toStrictEqual([]);
    expect(state.answeredClientRequestIds.value.has('approval-once')).toBe(true);
    expect(state.answeredClientRequestIds.value.has('approval-deny')).toBe(true);
  });

  it('removes externally resolved detailed approvals and marks generic requests answered', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const approval: BackendApprovalRequest = {
      id: 'approval-server',
      kind: 'command',
      conversationId: 'thread-1',
      itemId: 'command-1',
      title: 'Run tests',
      command: 'npm test',
    };
    const state = useAppState();
    await state.loadSnapshot();
    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest(approval) },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'agentRequest.resolved',
      payload: { id: (approval).id, outcome: approvalOutcome(null, null, 'server') },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });
    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      backend: 'codex',
      type: 'agentRequest.resolved',
      payload: { id: 'question-1', outcome: { kind: 'completed' } },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });
    listeners[0]?.({
      seq: 4,
      agentId: 'agent-dina',
      backend: 'codex',
      type: 'clientRequest.resolved',
      payload: { id: 42 },
      occurredAt: '2026-06-05T00:00:04.000Z',
    } as unknown as MainToRendererEvent);

    expect(state.activeBackendApprovals.value).toStrictEqual([]);
    expect(state.answeredClientRequestIds.value.has('approval-server')).toBe(true);
    expect(state.answeredClientRequestIds.value.has('question-1')).toBe(true);
    expect(state.answeredClientRequestIds.value.has('42')).toBe(false);
  });

  it('sets the active approval preset through the preload bridge', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    updatedSnapshot.agents[0].backendDefaults = {
      kind: 'codex',
      approvalPreset: 'approve-for-me',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandboxMode: 'workspace-write',
    };
    const setAgentApprovalPreset = vi.fn().mockResolvedValue(updatedSnapshot);
    stubElectronTestWindow({
      app: {
        setAgentApprovalPreset,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    state.snapshot.value = remoteSnapshot;

    expect(state.activeApprovalPreset.value).toBe('full-access');
    await state.setApprovalPreset('approve-for-me');

    expect(setAgentApprovalPreset).toHaveBeenCalledWith('agent-dina', 'approve-for-me');
    expect(state.snapshot.value).toStrictEqual(updatedSnapshot);
    expect(state.activeApprovalPreset.value).toBe('approve-for-me');
  });

  it('uses the first allowed approval preset when stored defaults are forbidden', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.backendRuntimes = [{
      backend: 'codex',
      status: 'running',
      capabilities: {
        approvalPresets: ['ask-for-approval'],
      },
    }];
    remoteSnapshot.agents[0].backendDefaults = {
      kind: 'codex',
      approvalPreset: 'full-access',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    };
    const setAgentApprovalPreset = vi.fn();
    stubElectronTestWindow({
      app: {
        setAgentApprovalPreset,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    state.snapshot.value = remoteSnapshot;

    expect(state.activeApprovalPreset.value).toBe('ask-for-approval');
    await state.setApprovalPreset('full-access');
    expect(setAgentApprovalPreset).not.toHaveBeenCalled();
  });

  it('restores the selected Antigravity permission mode without borrowing Claude defaults', () => {
    const state = useAppState();
    const snapshot = createInitialSnapshot();
    snapshot.agents[0] = { ...snapshot.agents[0]!, backend: 'antigravity', backendSession: undefined, backendDefaults: { kind: 'antigravity', permissionMode: 'auto_edit' } };
    state.snapshot.value = snapshot;
    expect(state.activePermissionMode.value).toBe('auto_edit');
    expect(state.activeBackendCapabilities.value.permissionModes?.map(option => option.id)).toEqual(['default', 'auto_edit']);
  });

  it('sets Claude permission modes through their separate backend contract', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0] = {
      ...remoteSnapshot.agents[0],
      backend: 'claude',
      backendSession: undefined,
      backendDefaults: { kind: 'claude', model: 'sonnet', permissionMode: 'acceptEdits' },
    };
    const updatedSnapshot = structuredClone(remoteSnapshot);
    updatedSnapshot.agents[0].backendDefaults = {
      kind: 'claude',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
    };
    const setAgentPermissionMode = vi.fn().mockResolvedValue(updatedSnapshot);
    stubElectronTestWindow({
      app: {
        setAgentPermissionMode,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    state.snapshot.value = remoteSnapshot;

    expect(state.activePermissionMode.value).toBe('acceptEdits');
    expect(state.activeBackendCapabilities.value.approvalPresets).toStrictEqual([]);
    expect(state.activeBackendCapabilities.value.permissionModes?.map((option) => option.id)).toStrictEqual([
      'default',
      'acceptEdits',
      'dontAsk',
      'auto',
      'bypassPermissions',
    ]);
    await state.setPermissionMode('bypassPermissions');

    expect(setAgentPermissionMode).toHaveBeenCalledWith('agent-dina', 'bypassPermissions');
    expect(state.activePermissionMode.value).toBe('bypassPermissions');
    await state.setPermissionMode('not-a-claude-mode');
    expect(setAgentPermissionMode).toHaveBeenCalledOnce();
  });

  it('sends prompts through preload without owning the provider transcript', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    const sendPrompt = vi.fn().mockResolvedValue(updatedSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    const send = state.sendPrompt('hello');

    expect(state.isSending.value).toBe(true);
    await send;

    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', 'hello');
    expect(state.isSending.value).toBe(false);
  });

  it('can send prompts to a specific agent from overview surfaces', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    const sendPrompt = vi.fn().mockResolvedValue(updatedSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.sendAgentPrompt('agent-jesse', '  ship this  ');

    expect(sendPrompt).toHaveBeenCalledWith('agent-jesse', 'ship this');
    expect(state.snapshot.value).toStrictEqual(updatedSnapshot);
  });

  it('deletes, edits, and retries active messages through preload message actions', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const deleteTurn = vi.fn().mockResolvedValue(remoteSnapshot);
    const editTurn = vi.fn().mockResolvedValue(remoteSnapshot);
    const retryTurn = vi.fn().mockResolvedValue(remoteSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        deleteTurn,
        editTurn,
        retryTurn,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    await state.deleteTurn('turn-1');
    expect(deleteTurn).toHaveBeenCalledWith('agent-dina', 'turn-1');

    state.snapshot.value = remoteSnapshot;
    await state.editTurn({ content: '  edited prompt  ', turnId: 'turn-1' });
    expect(editTurn).toHaveBeenCalledWith('agent-dina', 'turn-1', 'edited prompt');

    state.snapshot.value = remoteSnapshot;
    await state.retryTurn('turn-1');
    expect(retryTurn).toHaveBeenCalledWith('agent-dina', 'turn-1');
  });

  it('continues a Codex interrupted turn through preload without sending a prompt', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const continuedSnapshot = structuredClone(remoteSnapshot);
    continuedSnapshot.agents[0]!.status = { type: 'working' };
    const continueInterruptedTurn = vi.fn().mockResolvedValue(continuedSnapshot);
    const sendPrompt = vi.fn();
    stubElectronTestWindow({ app: {
      getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
      continueInterruptedTurn,
      sendPrompt,
      onEvent: vi.fn(),
    } satisfies Partial<AppApi> });

    const state = useAppState();
    await state.loadSnapshot();
    await state.continueInterruptedTurn();

    expect(continueInterruptedTurn).toHaveBeenCalledExactlyOnceWith('agent-dina');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(state.snapshot.value.agents[0]?.status).toStrictEqual({ type: 'working' });
  });

  it('blocks message actions when the active backend does not support them', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].backend = 'claude';
    remoteSnapshot.agents[0].backendDefaults = { kind: 'claude' };
    const deleteTurn = vi.fn().mockResolvedValue(remoteSnapshot);
    const editTurn = vi.fn().mockResolvedValue(remoteSnapshot);
    const retryTurn = vi.fn().mockResolvedValue(remoteSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        deleteTurn,
        editTurn,
        retryTurn,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    await state.deleteTurn('turn-1');
    await state.editTurn({ content: 'edited prompt', turnId: 'turn-1' });
    await state.retryTurn('turn-1');

    expect(deleteTurn).not.toHaveBeenCalled();
    expect(editTurn).not.toHaveBeenCalled();
    expect(retryTurn).not.toHaveBeenCalled();
  });

  it('renders backend-owned queues and never drains them from the renderer', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].status = { type: 'working' };
    const queuedSnapshot = createInitialSnapshot();
    queuedSnapshot.agents[0].status = { type: 'working' };
    queuedSnapshot.queuedPrompts = [{
      id: 'prompt-1', agentId: 'agent-dina', text: 'run this after the turn', createdAt: '2026-06-05T00:00:01.000Z',
    }];
    const sendPrompt = vi.fn().mockResolvedValue(queuedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.sendPrompt('run this after the turn');

    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', 'run this after the turn');
    expect(state.activeQueuedPrompts.value).toStrictEqual([
      expect.objectContaining({
        text: 'run this after the turn',
      }),
    ]);

    const drainedSnapshot = createInitialSnapshot();
    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      type: 'agent.promptDequeued',
      payload: { ids: ['prompt-1'] },
      occurredAt: '2026-06-05T00:00:02.000Z',
      snapshot: drainedSnapshot,
    });
    expect(state.activeQueuedPrompts.value).toStrictEqual([]);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('responds to client requests through preload and tracks answered request ids', async () => {
    const updatedSnapshot = createInitialSnapshot();
    updatedSnapshot.agents[0].status = { type: 'working' };
    const respondToClientRequest = vi.fn().mockResolvedValue(updatedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(createInitialSnapshot()),
        onEvent: vi.fn(),
        respondToClientRequest,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.respondToClientRequest({
      id: 'approval-1',
      payload: {
        decision: 'allow',
      },
    });

    expect(respondToClientRequest).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      id: 'approval-1',
      payload: {
        decision: 'allow',
      },
    });
    expect(state.answeredClientRequestIds.value.has('approval-1')).toBe(true);
    expect(state.snapshot.value.agents[0].status).toStrictEqual({ type: 'working' });
  });

  it('lists and resumes active agent conversations through preload', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    const resumedSnapshot = {
      ...remoteSnapshot,
      agents: remoteSnapshot.agents.map((agent) => (
        agent.id === 'agent-dina'
          ? { ...agent, backendSession: { kind: 'codex' as const, threadId: 'thread-dina' } }
          : agent
      )),
      messages: [{
        id: 'user-thread-dina',
        agentId: 'agent-dina',
        role: 'user' as const,
        status: 'complete' as const,
        createdAt: '2026-06-09T10:00:00.000Z',
        parts: [{ type: 'text' as const, text: 'hello again' }],
      }],
    };
    const conversations: ConversationSummary[] = [{
      id: 'thread-dina',
      title: 'hello again',
      updatedAt: '2026-06-09T10:00:00.000Z',
      messageCount: 1,
      storageState: 'archived',
      ref: { backend: 'codex', threadId: 'thread-dina' },
    }];
    const listAgentConversations = vi.fn().mockResolvedValue(conversations);
    const resumeAgentConversation = vi.fn().mockResolvedValue(resumedSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
        listAgentConversations,
        resumeAgentConversation,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await expect(state.listAgentConversations('agent-dina')).resolves.toStrictEqual(conversations);
    listeners[0]?.({
      seq: 1,
      occurredAt: '2026-09-05T00:00:00.000Z',
      agentId: 'agent-dina',
      type: 'conversation.historyLoadFailed',
      payload: { error: 'Unable to load conversation history.' },
    });
    expect(state.isActiveAgentHistoryFailed.value).toBe(true);

    const reactiveConversationRef = reactive({
      backend: 'codex' as const,
      threadId: 'thread-dina',
    });
    const target = { ref: reactiveConversationRef as BackendConversationRef, storageState: 'archived' as const };
    await state.resumeAgentConversation('agent-dina', target);

    expect(listAgentConversations).toHaveBeenCalledWith('agent-dina', undefined);
    expect(resumeAgentConversation).toHaveBeenCalledWith('agent-dina', {
      ref: { backend: 'codex', threadId: 'thread-dina' },
      storageState: 'archived',
    });
    expect(resumeAgentConversation.mock.calls.at(-1)?.[1].ref).not.toBe(reactiveConversationRef);
    expect(state.snapshot.value).toStrictEqual(resumedSnapshot);
    expect(state.isActiveAgentHistoryFailed.value).toBe(false);
  });

  it('switches the Claude composer selection when a different conversation is resumed', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0] = {
      ...remoteSnapshot.agents[0],
      backend: 'claude',
      backendSession: {
        kind: 'claude',
        sessionId: 'claude-session-haiku',
        transport: 'stdio',
        model: 'claude-haiku-4-5-20251001',
      },
      backendDefaults: { kind: 'claude', model: 'haiku' },
    };
    const resumedSnapshot = structuredClone(remoteSnapshot);
    resumedSnapshot.agents[0].backendSession = {
      kind: 'claude',
      sessionId: 'claude-session-sonnet',
      transport: 'stdio',
      model: 'claude-sonnet-5',
      reasoningEffort: 'xhigh',
    };
    const resumeAgentConversation = vi.fn().mockResolvedValue(resumedSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        listBackendModels: vi.fn().mockResolvedValue([
          {
            id: 'haiku',
            model: 'haiku',
            displayName: 'Haiku',
            providerMetadata: { resolvedModel: 'claude-haiku-4-5-20251001' },
            isDefault: true,
          },
          {
            id: 'sonnet',
            model: 'sonnet',
            displayName: 'Sonnet',
            providerMetadata: { resolvedModel: 'claude-sonnet-5' },
            supportedReasoningEfforts: [
              { reasoningEffort: 'high', description: 'Deep reasoning' },
              { reasoningEffort: 'xhigh', description: 'Deeper reasoning' },
            ],
          },
        ]),
        resumeAgentConversation,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    expect(state.selectedModelId.value).toBe('haiku');

    await state.resumeAgentConversation('agent-dina', {
      ref: {
        backend: 'claude',
        folder: remoteSnapshot.agents[0].folder!,
        sessionId: 'claude-session-sonnet',
      },
      storageState: 'active',
    });

    expect(state.selectedModelId.value).toBe('sonnet');
    expect(state.selectedReasoningEffort.value).toBe('xhigh');
  });

  it('adopts the replacement session and clears stale history errors after compression', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-old' };
    const compressedSnapshot = structuredClone(remoteSnapshot);
    compressedSnapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-compressed' };
    const compressAgentSession = vi.fn().mockResolvedValue(compressedSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        compressAgentSession,
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    listeners[0]?.({
      seq: 1,
      occurredAt: '2026-09-07T00:00:00.000Z',
      agentId: 'agent-dina',
      type: 'conversation.historyLoadFailed',
      payload: { error: 'Unable to load conversation history.' },
    });
    expect(state.isActiveAgentHistoryFailed.value).toBe(true);

    await state.compressAgentSession('agent-dina');

    expect(compressAgentSession).toHaveBeenCalledWith('agent-dina');
    expect(state.snapshot.value.agents[0].backendSession).toStrictEqual({
      kind: 'codex',
      threadId: 'thread-compressed',
    });
    expect(state.isActiveAgentHistoryFailed.value).toBe(false);
  });

  it('sets a Codex goal from slash goal without sending a prompt', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    updatedSnapshot.agents[0].goal = {
      threadId: 'thread-1',
      objective: 'ship the feature',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const sendPrompt = vi.fn().mockResolvedValue(createInitialSnapshot());
    const setAgentGoal = vi.fn().mockResolvedValue(updatedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        setAgentGoal,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    await state.sendPrompt('/goal ship the feature');

    expect(setAgentGoal).toHaveBeenCalledWith('agent-dina', 'ship the feature');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(state.activeGoal.value?.objective).toBe('ship the feature');
    expect(state.activeQueuedPrompts.value).toStrictEqual([]);
  });

  it('clears a Codex goal from slash goal clear even while busy', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].status = { type: 'working' };
    remoteSnapshot.agents[0].goal = {
      threadId: 'thread-1',
      objective: 'ship the feature',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const updatedSnapshot = createInitialSnapshot();
    updatedSnapshot.agents[0].status = { type: 'working' };
    const sendPrompt = vi.fn().mockResolvedValue(createInitialSnapshot());
    const clearAgentGoal = vi.fn().mockResolvedValue(updatedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        clearAgentGoal,
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    await state.sendPrompt('/goal clear');

    expect(clearAgentGoal).toHaveBeenCalledWith('agent-dina');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(state.activeGoal.value).toBeNull();
    expect(state.activeQueuedPrompts.value).toStrictEqual([]);
  });

  it('enables plan mode from bare slash plan without sending a prompt', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const sendPrompt = vi.fn().mockResolvedValue(createInitialSnapshot());

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    state.backendModels.value = [];
    state.selectedModelId.value = null;
    state.selectedReasoningEffort.value = null;
    state.setPlanMode(false);

    await state.sendPrompt('/plan');

    expect(state.planMode.value).toBe(true);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(state.activeQueuedPrompts.value).toStrictEqual([]);
  });

  it('strips slash plan arguments and submits the prompt in plan mode', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    const sendPrompt = vi.fn().mockResolvedValue(updatedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    state.backendModels.value = [];
    state.selectedModelId.value = null;
    state.selectedReasoningEffort.value = null;
    state.setPlanMode(false);

    await state.sendPrompt('/plan build the plan');

    expect(state.planMode.value).toBe(true);
    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', 'build the plan', {
      planMode: true,
    });
  });

  it('does not queue or send bare slash plan while an agent is busy', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].status = { type: 'working' };
    const sendPrompt = vi.fn().mockResolvedValue(createInitialSnapshot());

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    state.backendModels.value = [];
    state.selectedModelId.value = null;
    state.selectedReasoningEffort.value = null;
    state.setPlanMode(false);

    await state.sendPrompt('/plan');

    expect(state.planMode.value).toBe(true);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(state.activeQueuedPrompts.value).toStrictEqual([]);
  });

  it('syncs composer settings, mode, and active goal from app-owned main events', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'conversation.settingsUpdated',
      payload: { settings: { model: 'gpt-5.4', reasoningEffort: 'high', serviceTier: 'fast' } },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'conversation.modeUpdated',
      payload: { mode: 'plan' },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });
    const goalSnapshot = createInitialSnapshot();
    goalSnapshot.agents[0].goal = {
      threadId: 'thread-1',
      objective: 'ship it',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 0,
      updatedAt: 0,
    };

    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      threadId: 'thread-1',
      type: 'conversation.goalUpdated',
      payload: {
        goal: {
          threadId: 'thread-1',
          objective: 'ship it',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      },
      occurredAt: '2026-06-05T00:00:03.000Z',
      snapshot: goalSnapshot,
    });

    expect(state.selectedModelId.value).toBe('gpt-5.4');
    expect(state.selectedReasoningEffort.value).toBe('high');
    expect(state.selectedServiceTier.value).toBe('fast');
    expect(state.planMode.value).toBe(true);
    expect(state.activeGoal.value?.objective).toBe('ship it');

    listeners[0]?.({
      seq: 4,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'conversation.modeUpdated',
      payload: { mode: 'default' },
      occurredAt: '2026-06-05T00:00:04.000Z',
    });
    listeners[0]?.({
      seq: 5,
      agentId: 'agent-dina',
      threadId: 'thread-1',
      type: 'conversation.goalCleared',
      payload: {},
      occurredAt: '2026-06-05T00:00:05.000Z',
      snapshot: createInitialSnapshot(),
    });

    expect(state.planMode.value).toBe(false);
    expect(state.activeGoal.value).toBeNull();

    listeners[0]?.({
      seq: 6,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'conversation.settingsUpdated',
      payload: { settings: { serviceTier: null } },
      occurredAt: '2026-06-05T00:00:06.000Z',
    });
    expect(state.selectedServiceTier.value).toBeNull();
  });

  it('keeps the newest provider-owned Codex conversation frame per agent', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-1' };
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();

    for (const [seq, revision, text] of [[1, 2, 'Newest'], [2, 1, 'Stale']] as const) {
      listeners[0]?.({
        seq,
        agentId: 'agent-dina',
        backend: 'codex',
        threadId: 'thread-1',
        type: 'codex.conversationSnapshotChanged',
        payload: {
          revision,
          snapshot: codexConversationSnapshot([
            codexTextMessage(`message-${text}`, 'assistant', text),
          ]),
        },
        occurredAt: `2026-09-06T00:00:0${seq}.000Z`,
      });
    }

    expect(state.activeCodexConversationSnapshot.value?.messages).toStrictEqual([
      expect.objectContaining({ parts: [{ type: 'text', text: 'Newest' }] }),
    ]);
  });

  it('projects only the provider snapshot matching the selected agent session', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-codex' };
    remoteSnapshot.agents[1]!.backend = 'claude';
    remoteSnapshot.agents[1]!.backendDefaults = { kind: 'claude' };
    remoteSnapshot.agents[1]!.backendSession = {
      kind: 'claude', sessionId: 'session-claude', transport: 'stdio',
    };
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-codex',
      type: 'codex.conversationSnapshotChanged',
      payload: {
        revision: 1,
        snapshot: codexConversationSnapshot([
          codexTextMessage('message-codex', 'assistant', 'Codex snapshot'),
        ], { activeConversationId: 'thread-codex' }),
      },
      occurredAt: '2026-09-06T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-jesse',
      backend: 'claude',
      type: 'claude.conversationSnapshotChanged',
      payload: {
        revision: 1,
        snapshot: claudeConversationSnapshot([], {
          agentId: 'agent-jesse',
          sessionId: 'session-claude',
        }),
      },
      occurredAt: '2026-09-06T00:00:02.000Z',
    });

    expect(state.activeCodexConversationSnapshot.value?.messages).toStrictEqual([
      expect.objectContaining({ id: 'message-codex' }),
    ]);
    expect(state.activeClaudeConversationSnapshot.value).toBeNull();

    state.snapshot.value.activeAgentId = 'agent-jesse';
    await nextTick();

    expect(state.activeCodexConversationSnapshot.value).toBeNull();
    expect(state.activeClaudeConversationSnapshot.value?.sessionId).toBe('session-claude');

    state.snapshot.value.agents[1]!.backendSession = undefined;
    await nextTick();

    expect(state.activeClaudeConversationSnapshot.value?.sessionId).toBe('session-claude');

    state.snapshot.value.agents[1]!.backendSession = {
      kind: 'claude', sessionId: 'session-replaced', transport: 'stdio',
    };
    await nextTick();

    expect(state.activeClaudeConversationSnapshot.value).toBeNull();
  });

  it('advances the provider-owned Codex frame with SDK conversation events', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-1' };
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'codex.conversationSnapshotChanged',
      payload: { revision: 1, snapshot: codexConversationSnapshot() },
      occurredAt: '2026-09-06T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 2,
        event: {
          seq: 10,
          occurredAt: '2026-09-06T00:00:02.000Z',
          origin: 'notification',
          type: 'message.appended',
          conversationId: 'thread-1',
          turnId: 'turn-1',
          payload: {
            message: {
              id: 'assistant-1', role: 'assistant', status: 'streaming', turnId: 'turn-1', parts: [],
              createdAt: '2026-09-06T00:00:02.000Z',
            },
          },
        },
      },
      occurredAt: '2026-09-06T00:00:02.000Z',
    });
    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 3,
        event: {
          seq: 11,
          occurredAt: '2026-09-06T00:00:03.000Z',
          origin: 'notification',
          type: 'message.delta',
          conversationId: 'thread-1',
          turnId: 'turn-1',
          payload: { messageId: 'assistant-1', itemId: 'item-1', delta: 'Hello' },
        },
      },
      occurredAt: '2026-09-06T00:00:03.000Z',
    });

    expect(state.activeCodexConversationSnapshot.value?.messages).toStrictEqual([
      expect.objectContaining({
        id: 'assistant-1',
        parts: [{ type: 'text', text: 'Hello', itemId: 'item-1' }],
      }),
    ]);
  });

  it('invalidates and rehydrates a Codex frame after a revision gap', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-1' };
    const loadConversationHistory = vi.fn().mockResolvedValue(remoteSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        loadConversationHistory,
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalled());
    loadConversationHistory.mockClear();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'codex.conversationSnapshotChanged',
      payload: { revision: 4, snapshot: codexConversationSnapshot() },
      occurredAt: '2026-09-06T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 3,
        event: {
          seq: 11,
          occurredAt: '2026-09-06T00:00:02.000Z',
          origin: 'notification',
          type: 'conversation.activityChanged',
          conversationId: 'thread-1',
          payload: { threadStatus: null, busy: false, error: null },
        },
      },
      occurredAt: '2026-09-06T00:00:02.000Z',
    });

    expect(state.activeCodexConversationSnapshot.value).not.toBeNull();
    expect(loadConversationHistory).not.toHaveBeenCalled();

    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 6,
        event: {
          seq: 12,
          occurredAt: '2026-09-06T00:00:03.000Z',
          origin: 'notification',
          type: 'conversation.activityChanged',
          conversationId: 'thread-1',
          payload: { threadStatus: null, busy: true, error: null },
        },
      },
      occurredAt: '2026-09-06T00:00:03.000Z',
    });

    expect(state.activeCodexConversationSnapshot.value).toBeNull();
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalledOnce());
  });

  it('invalidates and rehydrates a Codex frame when a delta targets another conversation', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-1' };
    const loadConversationHistory = vi.fn().mockResolvedValue(remoteSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        loadConversationHistory,
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalled());
    loadConversationHistory.mockClear();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'codex.conversationSnapshotChanged',
      payload: { revision: 1, snapshot: codexConversationSnapshot() },
      occurredAt: '2026-09-06T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-1',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 2,
        event: {
          seq: 2,
          occurredAt: '2026-09-06T00:00:02.000Z',
          origin: 'notification',
          type: 'conversation.activityChanged',
          conversationId: 'thread-other',
          payload: { threadStatus: null, busy: true, error: null },
        },
      },
      occurredAt: '2026-09-06T00:00:02.000Z',
    });

    expect(state.activeCodexConversationSnapshot.value).toBeNull();
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalledOnce());
  });

  it('advances the provider-owned Claude frame without writing the global transcript', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.backend = 'claude';
    remoteSnapshot.agents[0]!.backendDefaults = { kind: 'claude' };
    remoteSnapshot.agents[0]!.backendSession = {
      kind: 'claude', sessionId: 'claude-session-1', transport: 'stdio',
    };
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        loadConversationHistory: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'claude',
      type: 'claude.conversationSnapshotChanged',
      payload: { revision: 1, snapshot: claudeConversationSnapshot() },
      occurredAt: '2026-09-06T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      backend: 'claude',
      type: 'claude.conversationEventReceived',
      payload: {
        revision: 2,
        event: {
          seq: 2,
          occurredAt: '2026-09-06T00:00:02.000Z',
          agentId: 'agent-dina',
          backend: 'claude',
          type: 'turn.started',
          turnId: 'turn-1',
          payload: { turn: { id: 'turn-1', backend: 'claude' } },
        },
      },
      occurredAt: '2026-09-06T00:00:02.000Z',
    });
    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      backend: 'claude',
      type: 'claude.conversationEventReceived',
      payload: {
        revision: 3,
        event: {
          seq: 3,
          occurredAt: '2026-09-06T00:00:03.000Z',
          agentId: 'agent-dina',
          backend: 'claude',
          type: 'message.userSubmitted',
          turnId: 'turn-1',
          payload: { message: {
            id: 'user-1', agentId: 'agent-dina', role: 'user', status: 'complete', turnId: 'turn-1',
            createdAt: '2026-09-06T00:00:03.000Z', parts: [{ type: 'text', text: 'Hello Claude' }],
          } },
        },
      },
      occurredAt: '2026-09-06T00:00:03.000Z',
    });
    listeners[0]?.({
      seq: 4,
      agentId: 'agent-dina',
      backend: 'claude',
      type: 'claude.conversationEventReceived',
      payload: {
        revision: 4,
        event: {
          seq: 4,
          occurredAt: '2026-09-06T00:00:04.000Z',
          agentId: 'agent-dina',
          backend: 'claude',
          type: 'message.delta',
          turnId: 'turn-1',
          payload: { messageId: 'assistant-1', delta: 'Hi' },
        },
      },
      occurredAt: '2026-09-06T00:00:04.000Z',
    });
    listeners[0]?.({
      seq: 5,
      agentId: 'agent-dina',
      backend: 'claude',
      type: 'claude.conversationSnapshotChanged',
      payload: {
        revision: 3,
        snapshot: claudeConversationSnapshot([], { sessionId: 'stale-session' }),
      },
      occurredAt: '2026-09-06T00:00:05.000Z',
    });

    expect(state.activeClaudeConversationSnapshot.value).toMatchObject({
      activeTurnId: 'turn-1',
      busy: true,
      messages: [
        { id: 'user-1', parts: [{ type: 'text', text: 'Hello Claude' }] },
        { id: 'assistant-turn-1', parts: [{ type: 'text', text: 'Hi' }] },
      ],
    });
  });

  it('invalidates and rehydrates a Claude frame after a revision gap', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.backend = 'claude';
    remoteSnapshot.agents[0]!.backendSession = {
      kind: 'claude', sessionId: 'claude-session-1', transport: 'stdio',
    };
    const loadConversationHistory = vi.fn().mockResolvedValue(remoteSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        loadConversationHistory,
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalled());
    loadConversationHistory.mockClear();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'claude',
      type: 'claude.conversationSnapshotChanged',
      payload: { revision: 4, snapshot: claudeConversationSnapshot() },
      occurredAt: '2026-09-06T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      backend: 'claude',
      type: 'claude.conversationEventReceived',
      payload: {
        revision: 3,
        event: {
          seq: 5,
          occurredAt: '2026-09-06T00:00:02.000Z',
          agentId: 'agent-dina',
          backend: 'claude',
          type: 'error',
          payload: { message: 'stale' },
        },
      },
      occurredAt: '2026-09-06T00:00:02.000Z',
    });

    expect(state.activeClaudeConversationSnapshot.value).not.toBeNull();
    expect(loadConversationHistory).not.toHaveBeenCalled();

    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      backend: 'claude',
      type: 'claude.conversationEventReceived',
      payload: {
        revision: 6,
        event: {
          seq: 6,
          occurredAt: '2026-09-06T00:00:03.000Z',
          agentId: 'agent-dina',
          backend: 'claude',
          type: 'error',
          payload: { message: 'gap' },
        },
      },
      occurredAt: '2026-09-06T00:00:03.000Z',
    });

    expect(state.activeClaudeConversationSnapshot.value).toBeNull();
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalledOnce());
  });
});
