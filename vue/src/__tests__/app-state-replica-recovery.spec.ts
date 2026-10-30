import { approvalAgentRequest } from '@workspace/core/agent-request';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useAppState } from '../app-state';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, BackendApprovalRequest, AppApi, MainToRendererEvent } from '@workspace/core/contracts';
import { clearConfetti } from '../shared/confetti/use-confetti';
import { stubElectronTestWindow } from '../test/client';
import { clearFirstRunOnboardingStage } from '../onboarding-session';
import { deferred } from './app-state-test-harness';

describe('useAppState', () => {
  it('restores the original composer and next prompt options when a completed reviewer disappears', async () => {
    const initial = createInitialSnapshot();
    const owner = initial.agents[0]!;
    owner.backendDefaults = { kind: 'codex', model: 'gpt-6-astra', reasoningEffort: 'high', userSelectedModel: true };
    delete owner.backendSession;
    const reviewer = { ...owner, id: 'reviewer', backend: 'claude' as const, backendDefaults: { kind: 'claude' as const, model: 'sonnet', reasoningEffort: 'high' as const, userSelectedModel: true } };
    initial.agents.push(reviewer);
    initial.teams[0]!.agentIds.push(reviewer.id);
    initial.activeAgentId = reviewer.id;
    const completed = structuredClone(initial);
    completed.agents = completed.agents.filter(agent => agent.id !== reviewer.id);
    completed.teams[0]!.agentIds = completed.teams[0]!.agentIds.filter(id => id !== reviewer.id);
    completed.activeAgentId = owner.id;
    let receive!: (event: MainToRendererEvent) => void;
    const sendPrompt = vi.fn().mockResolvedValue(completed);
    stubElectronTestWindow({ app: {
      getSnapshot: vi.fn().mockResolvedValue(initial),
      listBackendModels: vi.fn(async id => {
        const model = id === reviewer.id ? 'sonnet' : 'gpt-6-astra';
        return [{ id: model, model, displayName: model, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }] }];
      }),
      onEvent: vi.fn(listener => { receive = listener; return () => {}; }),
      sendPrompt,
    } });
    const state = useAppState();
    await state.loadSnapshot();
    expect(state.selectedModelId.value).toBe('sonnet');
    receive({ seq: 1, source: 'backend', occurredAt: '2026-10-05T13:43:29.750Z', type: 'snapshot.updated', payload: completed });
    await vi.waitFor(() => expect(state.selectedModelId.value).toBe('gpt-6-astra'));
    expect(state.activeAgent.value?.id).toBe(owner.id);
    expect(state.selectedReasoningEffort.value).toBe('high');
    await state.sendAgentPrompt(owner.id, 'Continue');
    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(owner.id, 'Continue', expect.objectContaining({ selection: { model: 'gpt-6-astra', reasoningEffort: 'high' } }));
    receive({ seq: 2, source: 'backend', occurredAt: '2026-10-05T13:44:00.000Z', type: 'snapshot.updated', payload: createEmptySnapshot() });
    expect(state.activeAgent.value).toBeNull();
    expect(state.selectedModelId.value).toBeNull();
    expect(state.selectedReasoningEffort.value).toBeNull();
  });

  afterEach(() => {
    clearConfetti();
    clearFirstRunOnboardingStage();
    vi.useRealTimers();
  });

  it('uses the local empty snapshot before preload is available', () => {
    stubElectronTestWindow({});

    const state = useAppState();

    expect(state.snapshot.value).toStrictEqual(createEmptySnapshot());
    expect(state.activeAgent.value).toBeNull();
  });

  it('keeps loading idle when snapshot loading is requested without preload', async () => {
    stubElectronTestWindow({});
    const state = useAppState();
    state.isLoading.value = false;

    await state.loadSnapshot();

    expect(state.isLoading.value).toBe(false);
  });

  it('loads snapshots without subscribing when main events are unavailable', async () => {
    const remoteSnapshot = createInitialSnapshot();
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(state.snapshot.value).toStrictEqual(remoteSnapshot);
  });

  it('loads the snapshot from the preload bridge when available', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0] = {
      ...remoteSnapshot.agents[0],
      id: 'agent-ellie',
      name: 'Ellie',
    };
    remoteSnapshot.activeAgentId = 'agent-ellie';
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    const load = state.loadSnapshot();

    expect(state.isLoading.value).toBe(true);
    await load;
    await nextTick();

    expect(state.isLoading.value).toBe(false);
    expect(state.activeAgent.value?.name).toBe('Ellie');
  });

  it('restores the selected agent when the desktop backend connects after the renderer starts', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-persisted' };
    const getSnapshotState = vi.fn()
      .mockRejectedValueOnce(new Error('daemon snapshot is not available.'))
      .mockResolvedValue({
        snapshot: remoteSnapshot,
        lastBackendEventSeq: 0,
        connection: { status: 'connected' as const },
      });
    const loadConversationHistory = vi.fn().mockResolvedValue(remoteSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshotState,
        loadConversationHistory,
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    state.snapshot.value = createEmptySnapshot();
    await state.loadSnapshot();

    expect(state.connectionState.value).toStrictEqual({
      status: 'error',
      detail: 'daemon snapshot is not available.',
    });
    expect(state.activeAgent.value).toBeNull();

    listeners[0]?.({
      seq: 1,
      source: 'client',
      type: 'client.connectionChanged',
      payload: { status: 'connected' },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });

    await vi.waitFor(() => expect(state.activeAgent.value?.id).toBe('agent-dina'));
    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalledWith('agent-dina'));
    expect(getSnapshotState).toHaveBeenCalledTimes(2);
    expect(state.connectionState.value).toStrictEqual({ status: 'connected' });
  });

  it('subscribes before loading and preserves transient events received with the startup snapshot', async () => {
    const snapshotLoad = deferred<ReturnType<typeof createInitialSnapshot>>();
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const onEvent = vi.fn((nextListener: (event: MainToRendererEvent) => void) => {
      listeners.push(nextListener);
      return () => undefined;
    });
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockReturnValue(snapshotLoad.promise),
        onEvent,
      } satisfies Partial<AppApi>,
    });
    const approval: BackendApprovalRequest = {
      id: 'approval-during-load',
      kind: 'command',
      conversationId: 'thread-dina',
      itemId: 'command-during-load',
      title: 'Run tests',
    };

    const state = useAppState();
    const load = state.loadSnapshot();
    expect(onEvent).toHaveBeenCalledOnce();
    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-dina',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest(approval) },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    snapshotLoad.resolve(createInitialSnapshot());
    await load;

    expect(state.activeBackendApprovals.value).toStrictEqual([approval]);
  });

  it('adopts snapshots from explicit main event snapshot fields', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    const eventSnapshot = createInitialSnapshot();
    eventSnapshot.agents[0] = {
      ...eventSnapshot.agents[0],
      id: 'agent-ellie',
      name: 'Ellie',
    };
    eventSnapshot.activeAgentId = 'agent-ellie';

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
      type: 'snapshot.updated',
      payload: remoteSnapshot,
      occurredAt: '2026-06-05T00:00:01.000Z',
      snapshot: eventSnapshot,
    });

    expect(state.snapshot.value).toStrictEqual(eventSnapshot);
    expect(state.activeAgent.value?.name).toBe('Ellie');
  });

  it('applies snapshot update payloads when an event omits a full snapshot', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    const payloadSnapshot = createInitialSnapshot();
    payloadSnapshot.agents[0] = {
      ...payloadSnapshot.agents[0],
      id: 'agent-ellie',
      name: 'Ellie',
    };
    payloadSnapshot.activeAgentId = 'agent-ellie';

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
      type: 'snapshot.updated',
      payload: payloadSnapshot,
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    expect(state.snapshot.value).toStrictEqual(payloadSnapshot);
    expect(state.activeAgent.value?.id).toBe('agent-ellie');
  });

  it('rejects malformed full snapshot payloads without downgrading them to metadata', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const initialSnapshot = createInitialSnapshot();
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    const rendererSnapshot = state.snapshot.value;
    const malformedSnapshot = structuredClone(initialSnapshot);
    malformedSnapshot.agents[0]!.name = 'Malformed snapshot';
    (malformedSnapshot as unknown as Record<string, unknown>).agents = {};

    listeners[0]?.({
      seq: 1,
      type: 'snapshot.updated',
      payload: malformedSnapshot,
      occurredAt: '2026-06-05T00:00:01.000Z',
    } as unknown as MainToRendererEvent);

    expect(state.snapshot.value).toBe(rendererSnapshot);
    expect(state.activeAgent.value?.name).toBe('Dina');
  });

  it('does not let a stale snapshot event steal the current agent selection', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const initialSnapshot = createInitialSnapshot();
    const selectAgent = vi.fn().mockResolvedValue({
      ...structuredClone(initialSnapshot),
      activeAgentId: 'agent-jesse',
    });
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
        selectAgent,
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.selectAgent('agent-jesse');

    listeners[0]?.({
      seq: 1,
      type: 'snapshot.updated',
      payload: structuredClone(initialSnapshot),
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    expect(state.activeAgent.value?.id).toBe('agent-jesse');
  });

  it.each(['success', 'error'] as const)('retains creation %s covered by a repaired snapshot instead of leaving the dialog running', async terminal => {
    let receive!: (event: MainToRendererEvent) => void;
    const snapshot = createInitialSnapshot();
    const repair = deferred<{ snapshot: AppSnapshot; lastBackendEventSeq: number; connection: { status: 'connected' } }>();
    const getSnapshotState = vi.fn()
      .mockResolvedValueOnce({ snapshot: structuredClone(snapshot), lastBackendEventSeq: 0, connection: { status: 'connected' } })
      .mockReturnValueOnce(repair.promise);
    stubElectronTestWindow({ app: { getSnapshotState, onEvent: vi.fn(listener => { receive = listener; return () => {}; }) } });
    const state = useAppState();
    await state.loadSnapshot();
    const progress = { id: 'create-worker', backend: 'codex' as const, repositoryName: 'korus', createWorktree: false, hasPrompt: true };
    receive({ seq: 1, source: 'backend', occurredAt: '', agentId: snapshot.activeAgentId!, type: 'agentCreation.progress', payload: { ...progress, state: 'running', phase: 'creatingAgent' } });
    expect(state.agentCreationProgresses.value).toMatchObject([{ state: 'running' }]);
    receive({ seq: 3, source: 'backend', occurredAt: '', agentId: snapshot.activeAgentId!, type: 'agent.statusChanged', payload: { type: 'working' } });
    await vi.waitFor(() => expect(getSnapshotState).toHaveBeenCalledTimes(2));
    receive({ seq: 4, source: 'backend', occurredAt: '', agentId: snapshot.activeAgentId!, type: 'agentCreation.progress', payload: { ...progress, state: terminal, agentId: 'worker' } });
    repair.resolve({ snapshot: structuredClone(snapshot), lastBackendEventSeq: 4, connection: { status: 'connected' } });
    await vi.waitFor(() => expect(state.agentCreationProgresses.value).toMatchObject([{ id: 'create-worker', state: terminal }]));
  });

  it('preserves the optimistic agent selection while repairing an event sequence gap', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const backendSnapshot = createInitialSnapshot();
    const getSnapshotState = vi.fn()
      .mockResolvedValueOnce({ snapshot: structuredClone(backendSnapshot), lastBackendEventSeq: 1, connection: { status: 'connected' } })
      .mockResolvedValueOnce({ snapshot: structuredClone(backendSnapshot), lastBackendEventSeq: 3, connection: { status: 'connected' } });
    stubElectronTestWindow({
      app: {
        getSnapshotState,
        selectAgent: vi.fn().mockResolvedValue({ ...structuredClone(backendSnapshot), activeAgentId: 'agent-jesse' }),
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.selectAgent('agent-jesse');
    listeners[0]?.({
      seq: 3,
      source: 'backend',
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'working' },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });
    await vi.waitFor(() => expect(getSnapshotState).toHaveBeenCalledTimes(2));

    expect(state.activeAgent.value?.id).toBe('agent-jesse');
  });

  it('shows the shell before persisted history hydration completes', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-persisted' };
    const hydration = deferred<AppSnapshot>();
    const loadConversationHistory = vi.fn().mockReturnValue(hydration.promise);
    const selectAgent = vi.fn();
    const onEvent = vi.fn();
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        loadConversationHistory,
        selectAgent,
        onEvent,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    const loading = state.loadSnapshot();

    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalledWith('agent-dina'));

    expect(onEvent).toHaveBeenCalledOnce();
    expect(selectAgent).not.toHaveBeenCalled();
    expect(state.isLoading.value).toBe(false);
    expect(state.isHydratingActiveAgentHistory.value).toBe(true);

    hydration.resolve(remoteSnapshot);
    await loading;

    expect(state.isLoading.value).toBe(false);
    expect(state.isHydratingActiveAgentHistory.value).toBe(false);
  });

  it('adopts runtime metadata returned by startup history hydration', async () => {
    const cachedSnapshot = createInitialSnapshot();
    cachedSnapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-persisted' };
    cachedSnapshot.agents[0].status = { type: 'working' };
    const reconciledSnapshot = structuredClone(cachedSnapshot);
    reconciledSnapshot.agents[0].status = { type: 'idle' };
    const loadConversationHistory = vi.fn().mockResolvedValue(reconciledSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(cachedSnapshot),
        loadConversationHistory,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    await vi.waitFor(() => expect(loadConversationHistory).toHaveBeenCalledWith('agent-dina'));
    await vi.waitFor(() => expect(state.activeAgent.value?.status).toStrictEqual({ type: 'idle' }));
    expect(state.isSending.value).toBe(false);
  });

  it('adopts Claude model metadata discovered by startup history hydration', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0] = {
      ...remoteSnapshot.agents[0],
      backend: 'claude',
      backendSession: {
        kind: 'claude',
        sessionId: 'claude-session-existing',
        transport: 'stdio',
      },
      backendDefaults: { kind: 'claude', model: 'haiku' },
    };
    const hydratedSnapshot = structuredClone(remoteSnapshot);
    hydratedSnapshot.agents[0].backendSession = {
      kind: 'claude',
      sessionId: 'claude-session-existing',
      transport: 'stdio',
      model: 'claude-sonnet-5',
      reasoningEffort: 'xhigh',
    };
    const loadConversationHistory = vi.fn().mockResolvedValue(hydratedSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        loadConversationHistory,
        listBackendModels: vi.fn().mockResolvedValue([
          { id: 'haiku', model: 'haiku', displayName: 'Haiku', isDefault: true },
          {
            id: 'sonnet',
            model: 'sonnet',
            displayName: 'Sonnet',
            providerMetadata: { resolvedModel: 'claude-sonnet-5' },
            supportedReasoningEfforts: [
              { reasoningEffort: 'xhigh', description: 'Deeper reasoning' },
            ],
          },
        ]),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    await vi.waitFor(() => expect(state.selectedModelId.value).toBe('sonnet'));
    expect(state.selectedReasoningEffort.value).toBe('xhigh');
  });

  it('does not hydrate startup history for agents without a persisted thread', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const loadConversationHistory = vi.fn();
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        loadConversationHistory,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(loadConversationHistory).not.toHaveBeenCalled();
    expect(state.activeAgent.value?.id).toBe('agent-dina');
  });

  it('does not hydrate startup history when no active agent is selected', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.activeAgentId = null;
    const loadConversationHistory = vi.fn();
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        loadConversationHistory,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(loadConversationHistory).not.toHaveBeenCalled();
    expect(state.activeAgent.value).toBeNull();
  });

  it('loads persisted thread metadata without hydration when the preload bridge cannot hydrate agents', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-persisted' };
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(state.activeAgent.value?.backendSession).toStrictEqual({ kind: 'codex', threadId: 'thread-persisted' });
  });
});
