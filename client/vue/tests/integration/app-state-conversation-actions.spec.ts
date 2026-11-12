import { approvalAgentRequest, approvalOutcome } from '@workspace/core/agent-request';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { useAppState } from '../../src/app-state';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { ProviderApprovalRequest, ProviderConversationRef, AppApi, ConversationSummary, MainToRendererEvent } from '@workspace/core/contracts';
import { clearConfetti } from '../../src/shared/confetti/use-confetti';
import { stubElectronTestWindow } from '../support/client';
import { clearFirstRunOnboardingStage } from '../../src/onboarding-session';
import { appendMessages, replaceMessage, runningTurn, sessionPatchEvent, sessionSnapshotEvent, sessionState, setOps, textMessage } from '../support/conversation-fixtures';
import { deferred } from '../support/app-state-test-harness';
describe('useAppState', () => {
  it('keeps history failures in the conversation pane without rejecting preparation or retry actions', async () => {
    const remote = createInitialSnapshot();
    const agent = remote.agents[0]!;
    agent.providerSession = { kind: 'codex', threadId: 'locked-thread' };
    const load = vi.fn().mockResolvedValue(remote);
    stubElectronTestWindow({ app: {
      getSnapshot: vi.fn().mockResolvedValue(remote),
      loadConversationHistory: load,
    } satisfies Partial<AppApi> });
    const state = useAppState();
    await state.loadSnapshot();
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    const error = new Error("Error occurred in handler for 'agent:history:hydrate': Error: Unable to load conversation history.");
    load.mockRejectedValue(error);

    await expect(state.prepareAgentConversation(agent.id)).resolves.toBeUndefined();
    expect(state.agentConversationFor(agent.id)?.history).toMatchObject({ failed: true, hydrating: false });
    await expect(state.retryActiveAgentHistory()).resolves.toBeUndefined();
    expect(state.isActiveAgentHistoryFailed.value).toBe(true);

    load.mockResolvedValue(remote);
    await state.retryActiveAgentHistory();
    expect(state.isActiveAgentHistoryFailed.value).toBe(false);
  });

  it('refreshes an already cached agent workspace on selection without clearing its conversation', async () => {
    const base = createInitialSnapshot();
    base.agents[0]!.providerSession = { kind: 'codex', threadId: 'thread-1' };
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
    listener(sessionSnapshotEvent('agent-dina', sessionState(), { seq: 1, conversation: 'thread-1' }));
    await state.selectAgent('agent-jesse');
    const refresh = deferred<ReturnType<typeof createInitialSnapshot>>();
    loadConversationHistory.mockImplementationOnce(() => refresh.promise);
    loadConversationHistory.mockClear();
    const selection = state.selectAgent('agent-dina');
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalledWith('agent-dina'));
    expect(state.activeConversationPresentation.value).not.toBeNull();
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

    await state.respondToActiveAgentRequest({ id: 'request-local', outcome: { kind: 'decision', decision: 'deny' } });

    expect(state.answeredClientRequestIds.value.has('request-local')).toBe(false);
  });

  it('stores detailed approvals by agent and maps every resolution through the agent-response bridge', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    const respondToAgentRequest = vi.fn().mockImplementation(async () => {
      return { ...remoteSnapshot, providerApprovals: {} };
    });
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        respondToAgentRequest,
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const approval: ProviderApprovalRequest = {
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
      provider: 'codex',
      conversationId: 'thread-1',
      turnId: 'turn-1',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest(approval) },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-jesse',
      provider: 'codex',
      conversationId: 'thread-other',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest({ ...approval, id: 'approval-other', conversationId: 'thread-other' }) },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });

    expect(state.activeProviderApprovals.value).toStrictEqual([approval]);
    await state.resolveProviderApproval('approval-native-1', 'approve', 'session');

    expect(respondToAgentRequest).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      id: 'approval-native-1',
      outcome: { kind: 'decision', decision: 'allow_conversation' },
    });
    expect(state.activeProviderApprovals.value).toStrictEqual([]);
    expect(state.answeredClientRequestIds.value.has('approval-native-1')).toBe(true);

    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      provider: 'codex',
      conversationId: 'thread-1',
      turnId: 'turn-1',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest({ ...approval, id: 'approval-once' }) },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });
    await state.resolveProviderApproval('approval-once', 'approve', 'once');

    expect(respondToAgentRequest).toHaveBeenNthCalledWith(2, {
      agentId: 'agent-dina',
      id: 'approval-once',
      outcome: { kind: 'decision', decision: 'allow' },
    });

    listeners[0]?.({
      seq: 4,
      agentId: 'agent-dina',
      provider: 'codex',
      conversationId: 'thread-1',
      turnId: 'turn-1',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest({ ...approval, id: 'approval-deny' }) },
      occurredAt: '2026-06-05T00:00:04.000Z',
    });
    await state.resolveProviderApproval('approval-deny', 'deny', 'once');

    expect(respondToAgentRequest).toHaveBeenNthCalledWith(3, {
      agentId: 'agent-dina',
      id: 'approval-deny',
      outcome: { kind: 'decision', decision: 'deny' },
    });
    expect(state.activeProviderApprovals.value).toStrictEqual([]);
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
    const approval: ProviderApprovalRequest = {
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
      provider: 'codex',
      conversationId: 'thread-1',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest(approval) },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      provider: 'codex',
      conversationId: 'thread-1',
      type: 'agentRequest.resolved',
      payload: { id: (approval).id, outcome: approvalOutcome(null, null, 'server') },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });
    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      provider: 'codex',
      type: 'agentRequest.resolved',
      payload: { id: 'question-1', outcome: { kind: 'completed' } },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });
    listeners[0]?.({
      seq: 4,
      agentId: 'agent-dina',
      provider: 'codex',
      type: 'clientRequest.resolved',
      payload: { id: 42 },
      occurredAt: '2026-06-05T00:00:04.000Z',
    } as unknown as MainToRendererEvent);

    expect(state.activeProviderApprovals.value).toStrictEqual([]);
    expect(state.answeredClientRequestIds.value.has('approval-server')).toBe(true);
    expect(state.answeredClientRequestIds.value.has('question-1')).toBe(true);
    expect(state.answeredClientRequestIds.value.has('42')).toBe(false);
  });

  it('sets the active approval preset through the preload bridge', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    updatedSnapshot.agents[0].providerDefaults = {
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
    remoteSnapshot.providerRuntimes = [{
      provider: 'codex',
      status: 'running',
      capabilities: {
        approvalPresets: ['ask-for-approval'],
      },
    }];
    remoteSnapshot.agents[0].providerDefaults = {
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
    snapshot.agents[0] = { ...snapshot.agents[0]!, provider: 'antigravity', providerSession: undefined, providerDefaults: { kind: 'antigravity', permissionMode: 'accept-edits' } };
    state.snapshot.value = snapshot;
    expect(state.activePermissionMode.value).toBe('accept-edits');
    expect(state.activeProviderCapabilities.value.permissionModes?.map(option => option.id)).toEqual(['default', 'accept-edits', 'auto']);
  });

  it('sets Claude permission modes through their separate backend contract', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0] = {
      ...remoteSnapshot.agents[0],
      provider: 'claude',
      providerSession: undefined,
      providerDefaults: { kind: 'claude', model: 'sonnet', permissionMode: 'acceptEdits' },
    };
    const updatedSnapshot = structuredClone(remoteSnapshot);
    updatedSnapshot.agents[0].providerDefaults = {
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
    expect(state.activeProviderCapabilities.value.approvalPresets).toStrictEqual([]);
    expect(state.activeProviderCapabilities.value.permissionModes?.map((option) => option.id)).toStrictEqual([
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

  it.each(['codex', 'claude', 'antigravity', 'cursor'] as const)('continues a %s interrupted turn through preload without sending a prompt', async backend => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.provider = backend;
    remoteSnapshot.agents[0]!.providerDefaults = { kind: backend };
    remoteSnapshot.agents[0]!.providerSession = backend === 'codex' ? { kind: backend, threadId: 'thread-dina' }
      : backend === 'claude' ? { kind: backend, sessionId: 'session-dina', transport: 'stdio' }
        : { kind: backend, sessionId: 'session-dina' };
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
    remoteSnapshot.agents[0].provider = 'claude';
    remoteSnapshot.agents[0].providerDefaults = { kind: 'claude' };
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
    const respondToAgentRequest = vi.fn().mockResolvedValue(updatedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(createInitialSnapshot()),
        onEvent: vi.fn(),
        respondToAgentRequest,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.respondToActiveAgentRequest({ id: 'approval-1', outcome: { kind: 'decision', decision: 'allow' } });

    expect(respondToAgentRequest).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      id: 'approval-1',
      outcome: { kind: 'decision', decision: 'allow' },
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
          ? { ...agent, providerSession: { kind: 'codex' as const, threadId: 'thread-dina' } }
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
      ref: { provider: 'codex', threadId: 'thread-dina' },
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
      provider: 'codex' as const,
      threadId: 'thread-dina',
    });
    const target = { ref: reactiveConversationRef as ProviderConversationRef, storageState: 'archived' as const };
    await state.resumeAgentConversation('agent-dina', target);

    expect(listAgentConversations).toHaveBeenCalledWith('agent-dina', undefined);
    expect(resumeAgentConversation).toHaveBeenCalledWith('agent-dina', {
      ref: { provider: 'codex', threadId: 'thread-dina' },
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
      provider: 'claude',
      providerSession: {
        kind: 'claude',
        sessionId: 'claude-session-haiku',
        transport: 'stdio',
        model: 'claude-haiku-4-5-20251001',
      },
      providerDefaults: { kind: 'claude', model: 'haiku' },
    };
    const resumedSnapshot = structuredClone(remoteSnapshot);
    resumedSnapshot.agents[0].providerSession = {
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
        listProviderModels: vi.fn().mockResolvedValue([
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
        provider: 'claude',
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
    remoteSnapshot.agents[0].providerSession = { kind: 'codex', threadId: 'thread-old' };
    const compressedSnapshot = structuredClone(remoteSnapshot);
    compressedSnapshot.agents[0].providerSession = { kind: 'codex', threadId: 'thread-compressed' };
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
    expect(state.snapshot.value.agents[0].providerSession).toStrictEqual({
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
    state.providerModels.value = [];
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
    state.providerModels.value = [];
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
    state.providerModels.value = [];
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
      provider: 'codex',
      conversationId: 'thread-1',
      type: 'conversation.settingsUpdated',
      payload: { settings: { model: 'gpt-5.4', reasoningEffort: 'high', serviceTier: 'fast' } },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      provider: 'codex',
      conversationId: 'thread-1',
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
      conversationId: 'thread-1',
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
      provider: 'codex',
      conversationId: 'thread-1',
      type: 'conversation.modeUpdated',
      payload: { mode: 'default' },
      occurredAt: '2026-06-05T00:00:04.000Z',
    });
    listeners[0]?.({
      seq: 5,
      agentId: 'agent-dina',
      conversationId: 'thread-1',
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
      provider: 'codex',
      conversationId: 'thread-1',
      type: 'conversation.settingsUpdated',
      payload: { settings: { serviceTier: null } },
      occurredAt: '2026-06-05T00:00:06.000Z',
    });
    expect(state.selectedServiceTier.value).toBeNull();
  });

  it('keeps the newest snapshot of a conversation per agent and follows its plan mode', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.providerSession = { kind: 'codex', threadId: 'thread-1' };
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
    const stream = { conversation: 'thread-1' };

    for (const [seq, revision, text] of [[1, 2, 'Newest'], [2, 1, 'Stale']] as const) {
      listeners[0]?.(sessionSnapshotEvent('agent-dina', sessionState({
        messages: [textMessage(`message-${text}`, 'assistant', text)], planMode: text === 'Newest',
      }), { ...stream, seq, revision, occurredAt: `2026-09-06T00:00:0${seq}.000Z` }));
    }

    expect(state.activeConversationPresentation.value?.messages).toStrictEqual([
      expect.objectContaining({ parts: [{ type: 'text', text: 'Newest' }] }),
    ]);
    // A recovered snapshot must restore the composer even if its
    // transient modeUpdated notification never reached this renderer.
    expect(state.planMode.value).toBe(true);

    listeners[0]?.(sessionPatchEvent('agent-dina', 3, setOps({ planMode: false }), { ...stream, seq: 3 }));
    expect(state.planMode.value).toBe(false);

    state.setPlanMode(true);
    listeners[0]?.(sessionSnapshotEvent('agent-dina', sessionState({ planMode: false }), { ...stream, seq: 4, revision: 4 }));
    // Unchanged provider settings do not erase an unsent manual toggle.
    expect(state.planMode.value).toBe(true);
  });

  it('projects only the conversation matching the selected agent session', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.providerSession = { kind: 'codex', threadId: 'thread-codex' };
    remoteSnapshot.agents[1]!.provider = 'claude';
    remoteSnapshot.agents[1]!.providerDefaults = { kind: 'claude' };
    remoteSnapshot.agents[1]!.providerSession = {
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

    listeners[0]?.(sessionSnapshotEvent('agent-dina', sessionState({
      messages: [textMessage('message-codex', 'assistant', 'Codex snapshot')],
    }), { seq: 1, conversation: 'thread-codex' }));
    listeners[0]?.(sessionSnapshotEvent('agent-jesse', sessionState(), { seq: 2, provider: 'claude', conversation: 'session-claude' }));

    expect(state.activeConversationPresentation.value?.messages).toStrictEqual([
      expect.objectContaining({ id: 'message-codex' }),
    ]);

    state.snapshot.value.activeAgentId = 'agent-jesse';
    await nextTick();

    expect(state.activeConversationPresentation.value).toMatchObject({ messages: [] });

    // A conversation the agent was detached from is not its conversation any more.
    state.snapshot.value.agents[1]!.providerSession = undefined;
    await nextTick();

    expect(state.activeConversationPresentation.value).toBeNull();

    state.snapshot.value.agents[1]!.providerSession = {
      kind: 'claude', sessionId: 'session-replaced', transport: 'stdio',
    };
    await nextTick();

    expect(state.activeConversationPresentation.value).toBeNull();
  });

  it('advances the conversation with session patches', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.providerSession = { kind: 'codex', threadId: 'thread-1' };
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
    const stream = { conversation: 'thread-1' };
    const streaming = { ...textMessage('assistant-1', 'assistant', '', { status: 'streaming', createdAt: '2026-09-06T00:00:02.000Z' }), parts: [] };

    listeners[0]?.(sessionSnapshotEvent('agent-dina', sessionState(), { ...stream, seq: 1, revision: 1 }));
    listeners[0]?.(sessionPatchEvent('agent-dina', 2, [appendMessages(0, streaming)], { ...stream, seq: 2 }));
    listeners[0]?.(sessionPatchEvent('agent-dina', 3, [replaceMessage(0, { ...streaming, parts: [{ type: 'text', text: 'Hello', itemId: 'item-1' }] })], { ...stream, seq: 3 }));

    expect(state.activeConversationPresentation.value?.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        parts: [{ type: 'text', text: 'Hello', itemId: 'item-1' }],
      }),
    ]);
  });

  it('coalesces transport repair storms and serializes cached Codex and Claude recovery without blanking either pane', async () => {
    const remote = createInitialSnapshot();
    const codex = remote.agents[0]!;
    codex.providerSession = { kind: 'codex', threadId: 'thread-1' };
    const claude = remote.agents[1]!;
    claude.provider = 'claude';
    claude.providerSession = { kind: 'claude', sessionId: 'claude-session-1', transport: 'stdio' };
    let receive!: (event: MainToRendererEvent) => void;
    const load = vi.fn().mockResolvedValue(remote);
    const getSnapshotState = vi.fn().mockResolvedValue({ snapshot: remote, lastBackendEventSeq: 0, connection: { status: 'connected' } });
    stubElectronTestWindow({ app: { getSnapshotState, loadConversationHistory: load, onEvent: listener => { receive = listener; return () => {}; } } });
    const state = useAppState();
    await state.loadSnapshot();
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    await nextTick();
    receive(sessionSnapshotEvent(codex.id, sessionState(), { seq: 1, conversation: 'thread-1', revision: 40 }));
    receive(sessionSnapshotEvent(claude.id, sessionState(), { seq: 2, provider: 'claude', conversation: 'claude-session-1', revision: 40 }));
    getSnapshotState.mockResolvedValue({ snapshot: remote, lastBackendEventSeq: 2, connection: { status: 'connected' } });
    const first = deferred<ReturnType<typeof createInitialSnapshot>>();
    const second = deferred<ReturnType<typeof createInitialSnapshot>>();
    load.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const repair = () => receive({ seq: 0, source: 'client', occurredAt: '', type: 'snapshot.updated', payload: structuredClone(remote) });
    repair();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    receive(sessionSnapshotEvent(codex.id, sessionState({ busy: true }), { seq: 3, conversation: 'thread-1', revision: 41 }));
    for (let n = 0; n < 20; n++) repair();
    expect(state.activeConversationPresentation.value?.busy).toBe(true);
    expect(state.agentConversationFor(claude.id)?.conversation).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve(remote);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load.mock.calls.map(call => call[0])).toEqual([codex.id, claude.id]);
    getSnapshotState.mockResolvedValue({ snapshot: remote, lastBackendEventSeq: 6, connection: { status: 'connected' } });
    for (let n = 0; n < 20; n++) repair();
    receive({ seq: 5, source: 'provider', occurredAt: '', agentId: codex.id, type: 'agent.statusChanged', payload: { type: 'working' } });
    // Repairs in the window re-read the app snapshot, but concurrent ones coalesce.
    await vi.waitFor(() => expect(getSnapshotState.mock.calls.length).toBeGreaterThanOrEqual(3));
    await nextTick();
    const snapshotFetches = getSnapshotState.mock.calls.length;
    expect(snapshotFetches).toBeLessThan(8);
    receive(sessionSnapshotEvent(claude.id, sessionState({ busy: true }), { seq: 6, provider: 'claude', conversation: 'claude-session-1', revision: 41 }));
    await vi.waitFor(() => expect(state.agentConversationFor(claude.id)?.conversation?.busy).toBe(true));
    second.resolve(remote);
    // The repair burst reached the Codex pane after its first recovery completed, so it gets one catch-up load.
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(load.mock.calls.map(call => call[0])).toEqual([codex.id, claude.id, codex.id]);
    expect(getSnapshotState).toHaveBeenCalledTimes(snapshotFetches);
    receive({ seq: 7, source: 'provider', occurredAt: '', agentId: codex.id, type: 'agent.statusChanged', payload: { type: 'working' } });
    expect(state.activeAgent.value?.status.type).toBe('working');
    expect(state.activeConversationPresentation.value?.busy).toBe(true);
    expect(state.agentConversationFor(claude.id)?.conversation).not.toBeNull();
    // The owner restarted: its revisions start over, yet its snapshot replaces the frame and its patches follow it.
    const restarted = { conversation: 'thread-1', epoch: 'restarted' };
    receive(sessionSnapshotEvent(codex.id, sessionState(), { ...restarted, seq: 8, revision: 0 }));
    expect(state.activeConversationPresentation.value?.busy).toBe(false);
    receive(sessionPatchEvent(codex.id, 1, setOps({ busy: true }), { ...restarted, seq: 9 }));
    expect(state.activeConversationPresentation.value?.busy).toBe(true);
  });

  it('restores the active agent after reconnect while cached recoveries are still loading', async () => {
    const remote = createInitialSnapshot();
    const codex = remote.agents[0]!;
    codex.providerSession = { kind: 'codex', threadId: 'thread-1' };
    let receive!: (event: MainToRendererEvent) => void;
    const load = vi.fn().mockResolvedValue(remote);
    const getSnapshotState = vi.fn().mockResolvedValue({ snapshot: remote, lastBackendEventSeq: 0, connection: { status: 'reconnecting' } });
    stubElectronTestWindow({ app: { getSnapshotState, loadConversationHistory: load, onEvent: listener => { receive = listener; return () => {}; } } });
    const state = useAppState();
    await state.loadSnapshot();
    receive(sessionSnapshotEvent(codex.id, sessionState(), { seq: 1, conversation: 'thread-1', revision: 40 }));
    const stuck = deferred<ReturnType<typeof createInitialSnapshot>>();
    load.mockReset().mockReturnValueOnce(stuck.promise).mockResolvedValue(remote);
    getSnapshotState.mockResolvedValue({ snapshot: remote, lastBackendEventSeq: 1, connection: { status: 'connected' } });
    receive({ seq: 0, source: 'client', occurredAt: '', type: 'client.connectionChanged', payload: { status: 'connected' } });
    try {
      // The stuck cached-pane recovery must not hold back the active agent's history load.
      await vi.waitFor(() => expect(load.mock.calls.length).toBeGreaterThanOrEqual(2));
    } finally {
      stuck.resolve(remote);
    }
    await nextTick();
  });

  it('releases the recovery queue when one load never settles and retries after a failed hydrate', async () => {
    vi.useFakeTimers();
    try {
      const remote = createInitialSnapshot();
      const codex = remote.agents[0]!;
      codex.providerSession = { kind: 'codex', threadId: 'thread-1' };
      const claude = remote.agents[1]!;
      claude.provider = 'claude';
      claude.providerSession = { kind: 'claude', sessionId: 'claude-session-1', transport: 'stdio' };
      let receive!: (event: MainToRendererEvent) => void;
      const load = vi.fn().mockResolvedValue(remote);
      const getSnapshotState = vi.fn().mockResolvedValue({ snapshot: remote, lastBackendEventSeq: 0, connection: { status: 'connected' } });
      stubElectronTestWindow({ app: { getSnapshotState, loadConversationHistory: load, onEvent: listener => { receive = listener; return () => {}; } } });
      const state = useAppState();
      await state.loadSnapshot();
      await vi.advanceTimersByTimeAsync(0);
      receive(sessionSnapshotEvent(codex.id, sessionState(), { seq: 1, conversation: 'thread-1', revision: 40 }));
      receive(sessionSnapshotEvent(claude.id, sessionState(), { seq: 2, provider: 'claude', conversation: 'claude-session-1', revision: 40 }));
      load.mockReset().mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(remote);
      receive({ seq: 0, source: 'client', occurredAt: '', type: 'snapshot.updated', payload: structuredClone(remote) });
      await vi.advanceTimersByTimeAsync(0);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(load.mock.calls.map(call => call[0])).toEqual([codex.id, claude.id]);
      // The Codex hydrate produced no snapshot: its frame stays visible, and the next live event retries.
      expect(state.activeConversationPresentation.value).not.toBeNull();
      receive(sessionPatchEvent(codex.id, 41, setOps({ busy: true }), { seq: 3, conversation: 'thread-1' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(load.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(load.mock.calls[2]![0]).toBe(codex.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads the app snapshot and hydrates a marked pane on selection while recovery is queued', async () => {
    const remote = createInitialSnapshot();
    const codex = remote.agents[0]!;
    codex.providerSession = { kind: 'codex', threadId: 'thread-1' };
    let receive!: (event: MainToRendererEvent) => void;
    const load = vi.fn().mockResolvedValue(remote);
    const getSnapshotState = vi.fn().mockResolvedValue({ snapshot: remote, lastBackendEventSeq: 0, connection: { status: 'connected' } });
    stubElectronTestWindow({ app: { getSnapshotState, loadConversationHistory: load, onEvent: listener => { receive = listener; return () => {}; } } });
    const state = useAppState();
    await state.loadSnapshot();
    receive(sessionSnapshotEvent(codex.id, sessionState(), { seq: 1, conversation: 'thread-1', revision: 40 }));
    getSnapshotState.mockResolvedValue({ snapshot: remote, lastBackendEventSeq: 1, connection: { status: 'connected' } });
    const stuck = deferred<ReturnType<typeof createInitialSnapshot>>();
    load.mockReset().mockReturnValueOnce(stuck.promise).mockResolvedValue(remote);
    try {
      receive({ seq: 0, source: 'client', occurredAt: '', type: 'snapshot.updated', payload: structuredClone(remote) });
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      const fetches = getSnapshotState.mock.calls.length;
      // The recovery window is still open: a later repair must still re-read the app snapshot.
      receive({ seq: 0, source: 'client', occurredAt: '', type: 'snapshot.updated', payload: structuredClone(remote) });
      await vi.waitFor(() => expect(getSnapshotState.mock.calls.length).toBeGreaterThan(fetches));
      // The marked frame is not hydrated: selecting the pane loads it without waiting for the queue.
      await state.prepareAgentConversation(codex.id);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      stuck.resolve(remote);
    }
    await nextTick();
  });

  it.each([
    ['codex', { kind: 'codex', threadId: 'thread-1' }],
    ['claude', { kind: 'claude', sessionId: 'thread-1', transport: 'stdio' }],
  ] as const)('ignores a late %s patch and reloads the conversation after a revision gap', async (provider, session) => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.provider = provider;
    remoteSnapshot.agents[0]!.providerSession = session;
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
    const stream = { provider, conversation: 'thread-1' };

    listeners[0]?.(sessionSnapshotEvent('agent-dina', sessionState(), { ...stream, seq: 1, revision: 4 }));
    listeners[0]?.(sessionPatchEvent('agent-dina', 3, setOps({ error: 'stale' }), { ...stream, seq: 2 }));

    expect(state.activeConversationPresentation.value).not.toBeNull();
    expect(loadConversationHistory).not.toHaveBeenCalled();

    listeners[0]?.(sessionPatchEvent('agent-dina', 6, setOps({ busy: true }), { ...stream, seq: 3 }));

    expect(state.activeConversationPresentation.value).not.toBeNull();
    expect(state.activeConversationPresentation.value?.busy).toBe(false);
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalledOnce());
  });

  it('advances a Claude conversation without writing the global transcript and ignores a late snapshot', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.provider = 'claude';
    remoteSnapshot.agents[0]!.providerDefaults = { kind: 'claude' };
    remoteSnapshot.agents[0]!.providerSession = {
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
    const before = state.snapshot.value;
    const stream = { provider: 'claude' as const, conversation: 'claude-session-1' };
    const user = textMessage('user-1', 'user', 'Hello Claude', { agentId: 'agent-dina', createdAt: '2026-09-06T00:00:03.000Z' });
    const reply = textMessage('assistant-turn-1', 'assistant', 'Hi', { agentId: 'agent-dina', status: 'streaming', createdAt: '2026-09-06T00:00:04.000Z' });

    listeners[0]?.(sessionSnapshotEvent('agent-dina', sessionState(), { ...stream, seq: 1, revision: 1 }));
    listeners[0]?.(sessionPatchEvent('agent-dina', 2, setOps({ busy: true, activeTurnId: 'turn-1', turns: [runningTurn('turn-1')] }), { ...stream, seq: 2 }));
    listeners[0]?.(sessionPatchEvent('agent-dina', 3, [appendMessages(0, user)], { ...stream, seq: 3 }));
    listeners[0]?.(sessionPatchEvent('agent-dina', 4, [appendMessages(1, reply)], { ...stream, seq: 4 }));
    listeners[0]?.(sessionSnapshotEvent('agent-dina', sessionState(), { ...stream, seq: 5, revision: 3 }));

    expect(state.activeConversationPresentation.value).toMatchObject({
      activeTurnId: 'turn-1',
      busy: true,
      messages: [
        { id: 'user-1', parts: [{ type: 'text', text: 'Hello Claude' }] },
        { id: 'assistant-turn-1', parts: [{ type: 'text', text: 'Hi' }] },
      ],
    });
    expect(state.snapshot.value).toBe(before);
  });
});
