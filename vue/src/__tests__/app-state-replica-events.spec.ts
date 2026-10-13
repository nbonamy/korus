import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppState } from '../app-state';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppApi, MainToRendererEvent } from '@workspace/core/contracts';
import { clearConfetti, useConfetti } from '../shared/confetti/use-confetti';
import { stubElectronTestWindow } from '../test/client';
import { clearFirstRunOnboardingStage } from '../onboarding-session';
import { snapshotEventOwnership } from '@workspace/core/snapshot-event-ownership';
describe('useAppState', () => {
  afterEach(() => {
    clearConfetti();
    clearFirstRunOnboardingStage();
    vi.useRealTimers();
  });

  it('publishes validated file activity for inactive and active agents', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents.push({
      id: 'agent-jesse', teamId: 'team-app', name: 'Jesse', avatar: 'J',
      folder: '/Users/nbonamy/src/other', backend: 'codex', status: { type: 'working' },
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
      backend: 'codex',
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
      backend: 'codex',
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
      backend: 'codex',
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

  it('plays app-owned celebration events only for the selected agent without adding conversation content', async () => {
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
      backend: 'codex' as const,
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
    expect(state.agentCreationProgress.value).toBeNull();

    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      type: 'agentCreation.progress',
      payload: progress,
      occurredAt: '2026-06-05T00:00:02.000Z',
    });
    expect(state.agentCreationProgress.value).toStrictEqual(progress);

    listeners[0]?.({
      seq: 3,
      agentId: 'agent-dina',
      type: 'agentCreation.progress',
      payload: { ...progress, state: 'success', agentId: 'agent-worker', agentName: 'feature/contracts' },
      occurredAt: '2026-06-05T00:00:03.000Z',
    });
    expect(state.agentCreationProgress.value).toMatchObject({ state: 'success', agentName: 'feature/contracts' });

    state.clearAgentCreationProgress('agent-creation-1');
    expect(state.agentCreationProgress.value).toBeNull();
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
    state.agentCreationProgress.value = null;
    state.answeredClientRequestIds.value = new Set();
    const originalSnapshot = state.snapshot.value;

    expect(Object.entries(snapshotEventOwnership)
      .filter(([, owner]) => owner === 'renderer')
      .map(([type]) => type)
      .sort()).toStrictEqual([
      'agentCreation.progress',
      'antigravity.conversationEventReceived',
      'antigravity.conversationSnapshotChanged',
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
      'models.changed',
      'client.markdownDisplayRequested',
      'skills.changed',
      'conversation.historyLoadFailed',
      'conversation.modeUpdated',
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

    expect(state.snapshot.value).toBe(originalSnapshot);
    expect(state.sidePanelRequest.value).toBeNull();
    expect(state.fileActivity.value).toBeNull();
    expect(state.agentCreationProgress.value).toBeNull();
    expect(state.answeredClientRequestIds.value).toEqual(new Set());
    expect(useConfetti().bursts.value).toStrictEqual([]);
  });
});
