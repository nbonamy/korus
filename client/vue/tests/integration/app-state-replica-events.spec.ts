import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppState } from '../../src/app-state';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppApi, MainToRendererEvent } from '@workspace/core/contracts';
import { clearConfetti, useConfetti } from '../../src/shared/confetti/use-confetti';
import { stubElectronTestWindow } from '../support/client';
import { clearFirstRunOnboardingStage } from '../../src/onboarding-session';
import { snapshotEventOwnership } from '@workspace/core/snapshot-event-ownership';
import { emptyCursorSnapshot } from '@korus-dev/multi-agent-sdk/contracts';
describe('useAppState', () => {
  afterEach(() => {
    clearConfetti();
    clearFirstRunOnboardingStage();
    vi.useRealTimers();
  });
  it('routes Cursor frames into its own conversation without reducing transcript into the app snapshot', async () => {
    let receive!: (event: MainToRendererEvent) => void;
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.provider = 'cursor'; agent.providerDefaults = { kind: 'cursor' }; agent.providerSession = { kind: 'cursor', sessionId: 'cursor-native' };
    stubElectronTestWindow({ app: { getSnapshot: vi.fn().mockResolvedValue(snapshot), onEvent: vi.fn(listener => { receive = listener; return () => {}; }) } satisfies Partial<AppApi> });
    const state = useAppState(); await state.loadSnapshot();
    const before = state.snapshot.value;
    const identity = { agentId: agent.id, provider: 'cursor' as const, providerSessionId: 'cursor-native', occurredAt: '2026-11-03T12:00:00Z' };
    receive({ ...identity, seq: 1, type: 'cursor.conversationSnapshotChanged', payload: { revision: 1, snapshot: emptyCursorSnapshot(agent.id, 'cursor-native') } });
    const eventIdentity = { agentId: agent.id, sessionId: 'cursor-native', turnId: 'turn', occurredAt: identity.occurredAt };
    receive({ ...identity, seq: 2, type: 'cursor.conversationEventReceived', payload: { revision: 2, event: { ...eventIdentity, type: 'turn.started', payload: { turn: { id: 'turn' } } } } });
    receive({ ...identity, seq: 3, type: 'cursor.conversationEventReceived', payload: { revision: 3, event: { ...eventIdentity, type: 'message.upsert', payload: { message: { agentId: agent.id, id: 'answer', turnId: 'turn', role: 'assistant', status: 'streaming', createdAt: identity.occurredAt, parts: [{ type: 'text', text: 'Native Cursor reply' }] } } } } });
    expect(state.agentConversationFor(agent.id)?.conversation?.messages[0]?.parts).toEqual([{ type: 'text', text: 'Native Cursor reply' }]);
    expect(state.activeConversationPresentation.value?.messages).toStrictEqual(state.agentConversationFor(agent.id)?.conversation?.messages);
    expect(state.activeConversationPresentation.value?.activeTurnId).toBe('turn');
    expect(state.agentConversationFor(agent.id)?.conversation?.latestTurnId).toBe('turn');
    expect(state.snapshot.value).toBe(before);
  });

  it('publishes validated file activity for inactive and active agents', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents.push({
      id: 'agent-jesse', teamId: 'team-app', name: 'Jesse', avatar: 'J',
      folder: '/Users/nbonamy/src/other', provider: 'codex', status: { type: 'working' },
      createdAt: '2026-06-05T00:00:00.000Z', updatedAt: '2026-06-05T00:00:00.000Z',
    });
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
    state.fileActivity.value = null;

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-jesse',
      provider: 'codex',
      threadId: 'thread-jesse',
      turnId: 'turn-jesse',
      type: 'workspace.fileActivityDetected',
      payload: {
        messageId: 'message-files', itemId: 'item-files',
        path: '  /Users/nbonamy/src/other/src/main.ts  ', action: 'edit', status: 'running',
      },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    expect(state.fileActivity.value).toStrictEqual({
      agentId: 'agent-jesse',
      turnId: 'turn-jesse',
      messageId: 'message-files',
      itemId: 'item-files',
      path: '/Users/nbonamy/src/other/src/main.ts',
      action: 'edit',
      status: 'running',
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    listeners[0]?.({
      seq: 2,
      agentId: 'agent-jesse',
      provider: 'codex',
      threadId: 'thread-jesse',
      turnId: 'turn-jesse',
      type: 'workspace.fileActivityDetected',
      payload: { messageId: '', itemId: 'item-files', path: '/tmp/bad.ts', action: 'edit', status: 'running' },
      occurredAt: '2026-06-05T00:00:02.000Z',
    } as unknown as MainToRendererEvent);
    expect(state.fileActivity.value).toMatchObject({ path: '/Users/nbonamy/src/other/src/main.ts' });

    listeners[0]?.({
      seq: 3,
      agentId: 'agent-jesse',
      provider: 'codex',
      threadId: 'thread-jesse',
      type: 'workspace.fileActivityDetected',
      payload: {
        messageId: 'message-without-turn', itemId: 'item-without-turn',
        path: '/tmp/no-turn.ts', action: 'read', status: 'completed',
      },
      occurredAt: '2026-06-05T00:00:03.000Z',
    } as unknown as MainToRendererEvent);
    expect(state.fileActivity.value).toMatchObject({ path: '/Users/nbonamy/src/other/src/main.ts' });
  });

  it('captures side panel requests from main events', async () => {
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
    state.sidePanelRequest.value = null;
    state.markdownDisplayRequests.value = [];

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      type: 'client.markdownDisplayRequested',
      payload: {
        kind: 'markdown',
        purpose: 'plan',
        title: 'Architecture',
        path: 'docs/architecture.md',
        content: '# Architecture',
      },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    expect(state.sidePanelRequest.value).toStrictEqual({
      agentId: 'agent-dina',
      kind: 'markdown',
      purpose: 'plan',
      title: 'Architecture',
      path: 'docs/architecture.md',
      content: '# Architecture',
    });

    listeners[0]?.({
      seq: 2,
      agentId: 'agent-jesse',
      type: 'client.markdownDisplayRequested',
      payload: {
        kind: 'markdown',
        content: '# Other',
      },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });

    listeners[0]?.({
      seq: 3, agentId: 'agent-dina', type: 'client.markdownDisplayRequested',
      payload: { kind: 'markdown', content: '# Another' }, occurredAt: '2026-06-05T00:00:02.500Z',
    });
    expect(state.markdownDisplayRequests.value).toStrictEqual([
      { agentId: 'agent-jesse', kind: 'markdown', content: '# Other' },
      { agentId: 'agent-dina', kind: 'markdown', content: '# Another' },
    ]);
    expect(state.snapshot.value.activeAgentId).toBe('agent-dina');
    state.consumeMarkdownDisplayRequests(2);
    expect(state.markdownDisplayRequests.value).toEqual([]);

    listeners[0]?.({
      seq: 4,
      agentId: 'agent-dina',
      type: 'plan.readyForReview',
      turnId: 'turn-plan',
      payload: {
        markdown: '# Proposed plan\n\n- Build it',
      },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });

    expect(state.sidePanelRequest.value).toStrictEqual({
      kind: 'markdown',
      purpose: 'plan',
      title: 'Proposed plan',
      content: '- Build it',
    });
  });

  it('plays app-owned celebration events only for visible agents when celebrations are enabled', async () => {
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
    const state = useAppState();
    state.setVisibleAgentIds([remoteSnapshot.activeAgentId!]);
    await state.loadSnapshot();
    listeners[0]?.({
      seq: 1,
      agentId: 'agent-jesse',
      type: 'client.celebrationRequested',
      payload: { kind: 'confetti' },
      occurredAt: '2026-06-05T00:00:00.500Z',
    });

    expect(useConfetti().bursts.value).toStrictEqual([]);

    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      type: 'client.celebrationRequested',
      payload: { kind: 'stars' },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    expect(useConfetti().bursts.value).toEqual([
      expect.objectContaining({ kind: 'stars' }),
    ]);
  });

  it('turns a mission focus request into a fresh request for the shell each time', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(createInitialSnapshot()),
        onEvent: vi.fn((listener) => { listeners.push(listener); return () => undefined; }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();
    expect(state.missionFocusRequest.value).toBeNull();
    listeners[0]?.({ seq: 1, type: 'mission.focusRequested', payload: { missionId: 'mission-1' }, occurredAt: '2026-06-05T00:00:01.000Z' });
    const first = state.missionFocusRequest.value;
    expect(first).toMatchObject({ missionId: 'mission-1' });
    listeners[0]?.({ seq: 2, type: 'mission.focusRequested', payload: { missionId: 'mission-1' }, occurredAt: '2026-06-05T00:00:02.000Z' });
    expect(state.missionFocusRequest.value).not.toBe(first);
    expect(state.missionFocusRequest.value?.sequence).toBeGreaterThan(first!.sequence);
  });

  it('shows MCP agent creation progress only for the active caller until dismissed', async () => {
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
    const state = useAppState();
    await state.loadSnapshot();
    const progress = {
      id: 'agent-creation-1',
      state: 'running' as const,
      provider: 'codex' as const,
      repositoryName: 'codex-app-sdk',
      createWorktree: true,
      branchName: 'feature/contracts',
      hasPrompt: true,
    };

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-jesse',
      type: 'agentCreation.progress',
      payload: { ...progress, id: 'ignored' },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    expect(state.agentCreationProgresses.value).toStrictEqual([]);

    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      type: 'agentCreation.progress',
      payload: progress,
      occurredAt: '2026-06-05T00:00:02.000Z',
    });
    expect(state.agentCreationProgresses.value).toStrictEqual([progress]);

    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      type: 'agentCreation.progress',
      payload: { ...progress, state: 'success', agentId: 'agent-worker', agentName: 'feature/contracts' },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });
    expect(state.agentCreationProgresses.value[0]).toMatchObject({ state: 'success', agentName: 'feature/contracts' });

    state.clearAgentCreationProgress('agent-creation-1');
    expect(state.agentCreationProgresses.value).toStrictEqual([]);
  });

  it('tracks concurrent agent creations side by side', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue({ ...createInitialSnapshot(), activeAgentId: 'agent-dina' }),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();
    const base = { state: 'running' as const, provider: 'codex' as const, repositoryName: 'repo', createWorktree: true, hasPrompt: true };
    const emit = (seq: number, payload: Record<string, unknown>) => listeners[0]?.({
      seq, agentId: 'agent-dina', type: 'agentCreation.progress', payload: { ...base, ...payload }, occurredAt: '2026-06-05T00:00:00.000Z',
    } as MainToRendererEvent);
    emit(1, { id: 'a' });
    emit(2, { id: 'b' });
    emit(3, { id: 'a', phase: 'creatingAgent' });
    expect(state.agentCreationProgresses.value).toMatchObject([{ id: 'a', phase: 'creatingAgent' }, { id: 'b' }]);
    emit(4, { id: 'b', state: 'success' });
    expect(state.agentCreationProgresses.value).toMatchObject([{ id: 'a' }, { id: 'b', state: 'success' }]);
    state.clearAgentCreationProgress('b');
    expect(state.agentCreationProgresses.value.map((entry) => entry.id)).toStrictEqual(['a']);
  });

  it('hides agent creation progress in the background and only resurfaces failures', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue({ ...createInitialSnapshot(), activeAgentId: 'agent-dina' }),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();
    const progress = {
      id: 'agent-creation-1',
      state: 'running' as const,
      provider: 'codex' as const,
      repositoryName: 'codex-app-sdk',
      createWorktree: true,
      hasPrompt: true,
    };
    const emit = (seq: number, id: string, payload: Record<string, unknown>) => listeners[0]?.({
      seq, agentId: 'agent-dina', type: 'agentCreation.progress', payload: { ...progress, id, ...payload }, occurredAt: '2026-06-05T00:00:00.000Z',
    } as MainToRendererEvent);

    emit(1, 'agent-creation-1', {});
    expect(state.agentCreationProgresses.value.map((entry) => entry.id)).toStrictEqual(['agent-creation-1']);
    state.backgroundAgentCreationProgress('agent-creation-1');
    expect(state.agentCreationProgresses.value).toStrictEqual([]);
    emit(2, 'agent-creation-1', { phase: 'creatingAgent' });
    emit(3, 'agent-creation-1', { state: 'success', agentId: 'agent-worker' });
    expect(state.agentCreationProgresses.value).toStrictEqual([]);

    emit(4, 'agent-creation-2', {});
    state.backgroundAgentCreationProgress('agent-creation-2');
    emit(5, 'agent-creation-2', { state: 'error', error: 'Backend offline' });
    expect(state.agentCreationProgresses.value).toMatchObject([{ id: 'agent-creation-2', state: 'error', error: 'Backend offline' }]);
  });

  it('tracks aggregate Mission Implementation startup progress', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(createInitialSnapshot()),
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
      type: 'mission.implementationStartProgress',
      payload: {
        missionId: 'mission-1',
        phase: 'initializingWorkspaces',
        repositoryCount: 2,
        ticketCount: 3,
      },
      occurredAt: '2026-09-22T00:00:00.000Z',
    });

    expect(state.missionImplementationStartProgress.value).toEqual({
      missionId: 'mission-1',
      phase: 'initializingWorkspaces',
      repositoryCount: 2,
      ticketCount: 3,
    });
  });

  it('ignores celebration events when the user disabled them', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.general.celebrationsEnabled = false;
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
    state.setVisibleAgentIds([remoteSnapshot.activeAgentId!]);
    await state.loadSnapshot();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      type: 'client.celebrationRequested',
      payload: { kind: 'confetti' },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    expect(useConfetti().bursts.value).toStrictEqual([]);
  });

  it('plays celebrations when a migrated live snapshot omits the setting', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    delete (remoteSnapshot.general as Partial<typeof remoteSnapshot.general>).celebrationsEnabled;
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
    state.setVisibleAgentIds([remoteSnapshot.activeAgentId!]);
    await state.loadSnapshot();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      type: 'client.celebrationRequested',
      payload: { kind: 'shapes' },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    expect(useConfetti().bursts.value).toEqual([
      expect.objectContaining({ kind: 'shapes' }),
    ]);
  });

  it('routes the complete renderer-owned event subset and keeps delegated events as app-state no-ops', async () => {
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
    state.sidePanelRequest.value = null;
    state.fileActivity.value = null;
    state.agentCreationProgresses.value = [];
    state.answeredClientRequestIds.value = new Set();
    const originalSnapshot = state.snapshot.value;

    expect(Object.entries(snapshotEventOwnership)
      .filter(([, owner]) => owner === 'renderer')
      .map(([type]) => type)
      .sort()).toStrictEqual([
      'agentCreation.progress',
      'antigravity.conversationEventReceived',
      'antigravity.conversationSnapshotChanged',
      'cursor.conversationEventReceived',
      'cursor.conversationSnapshotChanged',
      'browser.annotationCreated',
      'client.celebrationRequested',
      'claude.conversationEventReceived',
      'claude.conversationSnapshotChanged',
      'client.connectionChanged',
      'codex.conversationEventReceived',
      'codex.conversationSnapshotChanged',
      'remoteControl.statusChanged',
      'provider.authenticationChanged',
      'workspace.fileActivityDetected',
      'git.branchWorkProgress',
      'git.operationProgress',
      'mission.implementationStartProgress',
      'mission.focusRequested',
      'models.changed',
      'client.markdownDisplayRequested',
      'skills.changed',
      'conversation.historyLoadFailed',
      'conversation.modeUpdated',
      'conversation.shareChanged',
      'conversation.sessionSnapshot',
      'conversation.sessionPatch',
    ].sort());

    listeners[0]?.({
      seq: 1,
      type: 'remoteControl.statusChanged',
      payload: { status: 'connected', serverName: `${product.name} test` },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      type: 'git.operationProgress',
      payload: { operation: 'merge', phase: 'handoff' },
      occurredAt: '2026-06-05T00:00:02.000Z',
    });
    listeners[0]?.({
      seq: 3,
      type: 'browser.annotationCreated',
      payload: {
        id: 'annotation-1',
        agentId: 'agent-dina',
        browserId: 'primary',
        url: 'https://example.com',
        kind: 'element',
        rect: { x: 1, y: 2, width: 3, height: 4 },
      },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });

    listeners[0]?.({
      seq: 4,
      type: 'provider.authenticationChanged',
      payload: { kind: 'claude', connected: false, state: { loggedIn: false } },
      occurredAt: '2026-06-05T00:00:04.000Z',
    });
    listeners[0]?.({
      seq: 5,
      agentId: 'agent-dina',
      type: 'git.branchWorkProgress',
      payload: { id: 'branch-work-1', agentId: 'agent-dina', branchName: 'feat/example', state: 'running', phase: 'movingChanges' },
      occurredAt: '2026-06-05T00:00:05.000Z',
    });

    listeners[0]?.({
      seq: 6, agentId: 'agent-dina', type: 'conversation.shareChanged',
      payload: { active: true, handle: 'a'.repeat(32), connectedGuests: null, availability: 'transportPending' },
      occurredAt: '2026-06-05T00:00:06.000Z',
    });

    expect(state.snapshot.value).toBe(originalSnapshot);
    expect(state.sidePanelRequest.value).toBeNull();
    expect(state.fileActivity.value).toBeNull();
    expect(state.agentCreationProgresses.value).toStrictEqual([]);
    expect(state.answeredClientRequestIds.value).toEqual(new Set());
    expect(useConfetti().bursts.value).toStrictEqual([]);
  });
});
