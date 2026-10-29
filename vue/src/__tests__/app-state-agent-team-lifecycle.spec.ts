import { product } from '@workspace/core/product';
import { approvalAgentRequest } from '@workspace/core/agent-request';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { useAppState } from '../app-state';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, AppApi, DevicePairingSession, MainToRendererEvent, SourceRepository } from '@workspace/core/contracts';
import { clearConfetti } from '../shared/confetti/use-confetti';
import { stubElectronTestWindow, stubLegacyElectronTestWindow } from '../test/client';
import { clearFirstRunOnboardingStage } from '../onboarding-session';
import { workItem, deferred } from './app-state-test-harness';
import { claudeConversationSnapshot } from '../test/claude-conversation-fixtures';
import { emptyAntigravitySnapshot } from '@workspace/core/antigravity-conversation-replica';

describe('useAppState', () => {
  afterEach(() => {
    clearConfetti();
    clearFirstRunOnboardingStage();
    vi.useRealTimers();
  });

  it('loads native Open In applications and adopts the remembered agent choice after opening', async () => {
    const initialSnapshot = createInitialSnapshot();
    const openedSnapshot = structuredClone(initialSnapshot);
    openedSnapshot.agents[0].openInApplication = 'xcode';
    const catalog = {
      defaultApplication: 'vscode' as const,
      applications: [
        { id: 'vscode' as const, label: 'VS Code' },
        { id: 'xcode' as const, label: 'Xcode' },
      ],
    };
    const getOpenInApplications = vi.fn().mockResolvedValue(catalog);
    const openAgentPath = vi.fn().mockResolvedValue(openedSnapshot);
    stubElectronTestWindow({
      app: {
        getOpenInApplications,
        openAgentPath,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = initialSnapshot;

    await state.loadOpenInApplications();
    await state.openAgentPath('agent-dina', 'xcode', 'src/main.ts');

    expect(state.openInApplications.value).toStrictEqual(catalog);
    expect(openAgentPath).toHaveBeenCalledWith('agent-dina', 'xcode', 'src/main.ts');
    expect(state.snapshot.value.agents[0].openInApplication).toBe('xcode');
  });

  it('ignores missing agent selections and does not local-select without preload', async () => {
    stubElectronTestWindow({});
    const state = useAppState();
    state.snapshot.value = createInitialSnapshot();
    state.snapshot.value.agents.push({
      id: 'agent-jesse',
      teamId: 'team-app',
      name: 'Jesse',
      folder: '/Users/nbonamy/src/multi-llm-ts',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });

    await state.selectAgent('agent-missing');
    expect(state.activeAgent.value?.id).toBe('agent-dina');

    await state.selectAgent('agent-jesse');
    expect(state.activeAgent.value?.id).toBe('agent-dina');
  });

  it('loads, clones, and creates worktrees through daemon', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.sourceFolder = {
      path: '~/src',
      initialized: true,
      recentRepoNames: [],
    };
    const repositories: SourceRepository[] = [{
      name: 'agent-workspace',
      path: '/Users/nbonamy/src/agent-workspace',
      worktrees: [{
        name: 'main',
        path: '/Users/nbonamy/src/agent-workspace',
      }],
    }];
    const listSourceRepositories = vi.fn().mockResolvedValue(repositories);
    const listSourceWorktrees = vi.fn().mockResolvedValue([
      { name: 'main', path: '/Users/nbonamy/src/agent-workspace' },
      { name: 'source-folder', path: '/Users/nbonamy/src/agent-workspace-source-folder' },
    ]);
    const createSourceWorktree = vi.fn().mockResolvedValue({
      name: 'source-folder',
      path: '/Users/nbonamy/src/agent-workspace-source-folder',
    });
    const cloneSourceRepository = vi.fn().mockResolvedValue(repositories[0]);
    const createSourceRepository = vi.fn().mockResolvedValue(repositories[0]);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        listSourceRepositories,
        cloneSourceRepository,
        createSourceRepository,
        listSourceWorktrees,
        createSourceWorktree,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(state.sourceRepositoryStatus.value).toBe('loaded');
    expect(state.sourceRepositories.value).toStrictEqual(repositories);
    await expect(state.listSourceWorktrees('/Users/nbonamy/src/agent-workspace')).resolves.toStrictEqual([
      { name: 'main', path: '/Users/nbonamy/src/agent-workspace' },
      { name: 'source-folder', path: '/Users/nbonamy/src/agent-workspace-source-folder' },
    ]);

    await expect(state.createSourceWorktree({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'feature/source-folder',
    })).resolves.toStrictEqual({
      name: 'source-folder',
      path: '/Users/nbonamy/src/agent-workspace-source-folder',
    });
    await expect(state.cloneSourceRepository({
      url: 'https://github.com/nbonamy/agent-workspace',
    })).resolves.toStrictEqual(repositories[0]);
    expect(cloneSourceRepository).toHaveBeenCalledWith({
      url: 'https://github.com/nbonamy/agent-workspace',
    });
    await expect(state.createSourceRepository({ name: 'agent-workspace' })).resolves.toStrictEqual(repositories[0]);
    expect(createSourceRepository).toHaveBeenCalledWith({ name: 'agent-workspace' });
    expect(listSourceRepositories).toHaveBeenCalledTimes(4);
  });

  it('adopts the new project agent and refreshes repository discovery', async () => {
    const initial = createInitialSnapshot();
    initial.sourceFolder = { path: '/src', initialized: true, recentRepoNames: [] };
    const created = structuredClone(initial);
    created.agents.push({ ...created.agents[0]!, id: 'agent-project', folder: '/src/new-product', name: null });
    created.teams[0]!.agentIds.push('agent-project');
    created.activeAgentId = 'agent-project';
    const repository: SourceRepository = {
      name: 'new-product', path: '/src/new-product', worktrees: [{ name: 'main', path: '/src/new-product' }],
    };
    const createProject = vi.fn().mockResolvedValue(created);
    const listSourceRepositories = vi.fn().mockResolvedValue([repository]);
    stubElectronTestWindow({ app: { createProject, listSourceRepositories } satisfies Partial<AppApi> });
    const state = useAppState();
    state.snapshot.value = initial;

    await state.createProject({ name: 'new-product', teamId: 'team-app' });

    expect(createProject).toHaveBeenCalledWith({ name: 'new-product', teamId: 'team-app' });
    expect(state.activeAgent.value?.id).toBe('agent-project');
    expect(state.sourceRepositories.value).toStrictEqual([repository]);
  });

  it('uses source repository fallbacks when preload helpers are unavailable', async () => {
    stubLegacyElectronTestWindow({ app: {} });
    const state = useAppState();
    state.snapshot.value = createInitialSnapshot();
    state.snapshot.value.sourceFolder = {
      path: '~/src',
      initialized: true,
      recentRepoNames: [],
    };

    await expect(state.chooseSourceFolder()).resolves.toBeNull();
    await expect(state.suggestSourceWorktreePath({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'feature/source-folder',
    })).resolves.toBe('');
    await expect(state.listSourceWorktrees('/Users/nbonamy/src/agent-workspace')).resolves.toStrictEqual([]);
    await expect(state.chooseSourceWorktreeDestination('/Users/nbonamy/src/agent-workspace-source-folder')).resolves.toBeNull();
    await expect(state.createSourceWorktree({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'feature/source-folder',
    })).rejects.toThrow('Source worktree creation is not available.');

    await state.loadSourceRepositories();

    expect(state.sourceRepositories.value).toStrictEqual([]);
    expect(state.sourceRepositoryStatus.value).toBe('notLoaded');
    expect(state.sourceRepositoryError.value).toBeNull();
    expect(state.snapshot.value.sourceFolder.recentRepoNames).toStrictEqual([]);
  });

  it('records source repository loading errors', async () => {
    const listSourceRepositories = vi.fn().mockRejectedValueOnce(new Error('source folder disappeared'))
      .mockRejectedValueOnce('plain failure');
    stubElectronTestWindow({
      app: {
        listSourceRepositories,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = createInitialSnapshot();
    state.snapshot.value.sourceFolder = {
      path: '~/src',
      initialized: true,
      recentRepoNames: [],
    };

    await state.loadSourceRepositories();

    expect(state.sourceRepositories.value).toStrictEqual([]);
    expect(state.sourceRepositoryStatus.value).toBe('error');
    expect(state.sourceRepositoryError.value).toBe('source folder disappeared');

    await state.loadSourceRepositories();

    expect(state.sourceRepositoryError.value).toBe('plain failure');
  });

  it('switches the active agent through the preload bridge', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const jesseSnapshot = {
      ...remoteSnapshot,
      activeAgentId: 'agent-jesse',
    };
    const selectAgent = vi.fn().mockResolvedValue(jesseSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        selectAgent,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(state.activeAgent.value?.id).toBe('agent-dina');

    await state.selectAgent('agent-jesse');

    expect(selectAgent).toHaveBeenCalledWith('agent-jesse');
    expect(state.activeAgent.value?.id).toBe('agent-jesse');
  });

  it('ignores missing team selections without calling main', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const selectTeam = vi.fn();
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        selectTeam,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.selectTeam('team-missing');

    expect(selectTeam).not.toHaveBeenCalled();
    expect(state.snapshot.value.activeTeamId).toBe('team-app');
  });

  it('ignores stale agent selection responses when switching quickly', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const jesseSelection = deferred<AppSnapshot>();
    const dinaSelection = deferred<AppSnapshot>();
    const selectAgent = vi.fn((agentId: string) => agentId === 'agent-jesse' ? jesseSelection.promise : dinaSelection.promise);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        selectAgent,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    void state.selectAgent('agent-jesse');
    void state.selectAgent('agent-dina');
    expect(state.activeAgent.value?.id).toBe('agent-dina');

    jesseSelection.resolve({ ...remoteSnapshot, activeAgentId: 'agent-jesse' });
    dinaSelection.resolve({ ...remoteSnapshot, activeAgentId: 'agent-dina' });
    await vi.waitFor(() => expect(state.activeAgent.value?.id).toBe('agent-dina'));
    expect(selectAgent).toHaveBeenNthCalledWith(1, 'agent-jesse');
    expect(selectAgent).toHaveBeenNthCalledWith(2, 'agent-dina');
  });

  it('updates agent and team selection immediately while loading their conversations', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents.push({
      ...remoteSnapshot.agents[0],
      id: 'agent-joel',
      teamId: 'team-other',
      name: 'Joel',
      backendSession: { kind: 'codex', threadId: 'thread-joel' },
    });
    remoteSnapshot.teams.push({
      id: 'team-other',
      name: 'Other',
      avatar: 'OT',
      color: '#123456',
      agentIds: ['agent-joel'],
    });
    const agentSelection = deferred<AppSnapshot>();
    const clientNavigationSelectTeamion = deferred<AppSnapshot>();
    const selectAgent = vi.fn().mockReturnValue(agentSelection.promise);
    const selectTeam = vi.fn().mockReturnValue(clientNavigationSelectTeamion.promise);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        selectAgent,
        selectTeam,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    const agentPromise = state.selectAgent('agent-jesse');
    expect(state.isLoading.value).toBe(false);
    expect(state.activeAgent.value?.id).toBe('agent-jesse');
    agentSelection.resolve({
      ...remoteSnapshot,
      activeAgentId: 'agent-jesse',
    });
    await agentPromise;
    expect(state.isLoading.value).toBe(false);
    expect(state.activeAgent.value?.id).toBe('agent-jesse');

    const teamPromise = state.selectTeam('team-other');
    expect(state.isLoading.value).toBe(false);
    expect(state.snapshot.value.activeTeamId).toBe('team-other');
    expect(state.activeAgent.value?.id).toBe('agent-joel');
    expect(state.isHydratingActiveAgentHistory.value).toBe(true);
    expect(selectTeam).toHaveBeenCalledWith('team-other');
    clientNavigationSelectTeamion.resolve({
      ...remoteSnapshot,
      activeAgentId: 'agent-joel',
      activeTeamId: 'team-other',
    });
    await teamPromise;
    expect(state.isLoading.value).toBe(false);
    expect(state.activeAgent.value?.id).toBe('agent-joel');
    expect(state.isHydratingActiveAgentHistory.value).toBe(false);
  });

  it('tracks unread agent threads and keeps the Dock badge in sync with window focus', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents.push({
      ...remoteSnapshot.agents[0],
      id: 'agent-jesse',
      name: 'Jesse',
      backendSession: { kind: 'codex', threadId: 'thread-jesse' },
    });
    const setDockBadgeCount = vi.fn().mockResolvedValue(undefined);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        selectAgent: vi.fn().mockResolvedValue(remoteSnapshot),
        setDockBadgeCount,
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.setRendererWindowFocused(true);
    await state.loadSnapshot();

    setDockBadgeCount.mockClear();
    state.setRendererWindowFocused(true);
    expect(setDockBadgeCount).toHaveBeenLastCalledWith(0);

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-jesse',
      backend: 'codex',
      threadId: 'thread-jesse',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 1,
        event: {
          seq: 1,
          occurredAt: '2026-08-07T10:00:00.000Z',
          origin: 'notification',
          conversationId: 'thread-jesse',
          turnId: 'turn-jesse',
          type: 'turn.completed',
          payload: {
            status: 'completed', error: null, willRetry: false,
            startedAt: null, completedAt: '2026-08-07T10:00:00.000Z', durationMs: null,
          },
        },
      },
      occurredAt: '2026-08-07T10:00:00.000Z',
    });

    expect(state.unreadAgentIds.value).toStrictEqual(['agent-jesse']);
    expect(setDockBadgeCount).toHaveBeenLastCalledWith(1);

    await state.selectAgent('agent-jesse');
    expect(state.unreadAgentIds.value).toStrictEqual([]);
    expect(setDockBadgeCount).toHaveBeenLastCalledWith(0);

    setDockBadgeCount.mockClear();
    await state.selectAgent('agent-jesse');
    expect(setDockBadgeCount).toHaveBeenLastCalledWith(0);

    state.setRendererWindowFocused(false);
    listeners[0]?.({
      seq: 2,
      agentId: 'agent-jesse',
      backend: 'codex',
      threadId: 'thread-jesse',
      type: 'subagent.statusChanged',
      payload: {
        rootConversationId: 'thread-jesse',
        conversationId: 'thread-child',
        status: 'completed',
      },
      occurredAt: '2026-08-07T10:00:30.000Z',
    });
    expect(state.unreadAgentIds.value).toStrictEqual([]);
    expect(setDockBadgeCount).toHaveBeenLastCalledWith(0);
    expect(setDockBadgeCount).toHaveBeenCalledTimes(1);

    listeners[0]?.({
      seq: 3,
      agentId: 'agent-jesse',
      backend: 'codex',
      threadId: 'thread-jesse',
      turnId: 'turn-jesse-2',
      type: 'agentRequest.created',
      payload: { request: approvalAgentRequest({
          id: 'approval-jesse',
          kind: 'command',
          conversationId: 'thread-jesse',
          turnId: 'turn-jesse-2',
          itemId: 'command-jesse',
          title: 'Run tests',
        }) },
      occurredAt: '2026-08-07T10:01:00.000Z',
    });
    expect(state.unreadAgentIds.value).toStrictEqual(['agent-jesse']);

    const snapshotWithoutJesse = structuredClone(remoteSnapshot);
    snapshotWithoutJesse.agents = snapshotWithoutJesse.agents.filter((agent) => agent.id !== 'agent-jesse');
    for (const team of snapshotWithoutJesse.teams) {
      team.agentIds = team.agentIds.filter((agentId) => agentId !== 'agent-jesse');
    }
    listeners[0]?.({
      seq: 4,
      type: 'snapshot.updated',
      payload: snapshotWithoutJesse,
      occurredAt: '2026-08-07T10:02:00.000Z',
    });
    expect(state.unreadAgentIds.value).toStrictEqual([]);

    state.setRendererWindowFocused(true);
    expect(state.unreadAgentIds.value).toStrictEqual([]);
    expect(setDockBadgeCount).toHaveBeenLastCalledWith(0);
  });

  it('clears desktop unread and Dock badges when mobile acknowledges activity, and marks focused activity read', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remote = createInitialSnapshot();
    const agent = remote.agents[0]!;
    agent.readState = { revision: 2, readRevision: 0 };
    const markAgentRead = vi.fn().mockResolvedValue(undefined);
    const setDockBadgeCount = vi.fn().mockResolvedValue(undefined);
    stubElectronTestWindow({ app: { getSnapshot: vi.fn().mockResolvedValue(remote), markAgentRead, setDockBadgeCount,
      onEvent: vi.fn(listener => { listeners.push(listener); return () => {}; }) } });
    const state = useAppState();
    state.setRendererWindowFocused(false);
    await state.loadSnapshot();
    expect(state.unreadAgentIds.value).toContain(agent.id);
    expect(markAgentRead).not.toHaveBeenCalled();
    listeners[0]!({ type: 'agent.updated', seq: 1, occurredAt: '', agentId: agent.id, payload: { id: agent.id, readState: { revision: 2, readRevision: 2 } } });
    expect(state.unreadAgentIds.value).not.toContain(agent.id);
    expect(setDockBadgeCount).toHaveBeenLastCalledWith(0);
    listeners[0]!({ type: 'agent.updated', seq: 2, occurredAt: '', agentId: agent.id, payload: { id: agent.id, readState: { revision: 3, readRevision: 2 } } });
    expect(state.unreadAgentIds.value).toContain(agent.id);
    state.setRendererWindowFocused(true);
    await nextTick();
    expect(markAgentRead).toHaveBeenCalledWith(agent.id, 3);
  });

  it('marks an inactive current-team agent and an agent from another non-empty team unread for Debug', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const otherAgents = [
      { ...remoteSnapshot.agents[0], id: 'agent-ellie', teamId: 'team-other', name: 'Ellie' },
      { ...remoteSnapshot.agents[0], id: 'agent-joel', teamId: 'team-other', name: 'Joel' },
    ];
    remoteSnapshot.agents.push(...otherAgents);
    remoteSnapshot.teams.push({
      id: 'team-other',
      name: 'Other',
      avatar: 'OT',
      color: '#123456',
      agentIds: otherAgents.map((agent) => agent.id),
    }, {
      id: 'team-empty',
      name: 'Empty',
      avatar: 'EM',
      color: '#654321',
      agentIds: [],
    });
    const setDockBadgeCount = vi.fn().mockResolvedValue(undefined);
    const selectedTeamSnapshot = structuredClone(remoteSnapshot);
    selectedTeamSnapshot.activeTeamId = 'team-other';
    selectedTeamSnapshot.activeAgentId = 'agent-joel';
    selectedTeamSnapshot.teams.find((team) => team.id === 'team-other')!.activeAgentId = 'agent-joel';
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        selectTeam: vi.fn().mockResolvedValue(selectedTeamSnapshot),
        loadConversationHistory: vi.fn().mockResolvedValue(selectedTeamSnapshot),
        setDockBadgeCount,
        onEvent: vi.fn(() => () => undefined),
      } satisfies Partial<AppApi>,
    });
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.99);
    const state = useAppState();
    await state.loadSnapshot();

    state.markDebugAgentsUnread();

    expect(state.unreadAgentIds.value).toStrictEqual(['agent-jesse', 'agent-joel']);
    expect(setDockBadgeCount).toHaveBeenLastCalledWith(2);

    await state.selectTeam('team-other');

    expect(state.activeAgent.value?.id).toBe('agent-joel');
    expect(state.unreadAgentIds.value).toStrictEqual(['agent-jesse']);
    expect(setDockBadgeCount).toHaveBeenLastCalledWith(1);
  });

  it('chooses folders and replaces the snapshot after agent metadata actions', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const teamSnapshot = {
      ...remoteSnapshot,
      teams: [
        ...remoteSnapshot.teams,
        {
          id: 'team-skwad-core',
          name: 'Skwad Core',
          avatar: 'SC',
          color: '#46A857',
          agentIds: [],
        },
      ],
      activeTeamId: 'team-skwad-core',
      activeAgentId: null,
    };
    const selectedTeamSnapshot = {
      ...teamSnapshot,
      teams: [teamSnapshot.teams[1]!, teamSnapshot.teams[0]!],
      activeTeamId: 'team-skwad-core',
      activeAgentId: null,
    };
    const selectedCoreTeamSnapshot = {
      ...selectedTeamSnapshot,
      activeTeamId: 'team-app',
      activeAgentId: 'agent-dina',
    };
    const updatedTeamSnapshot = {
      ...selectedCoreTeamSnapshot,
      teams: selectedCoreTeamSnapshot.teams.map((team) => team.id === 'team-app'
        ? { ...team, name: 'Core Team', avatar: 'CT', color: '#46A857' }
        : team),
    };
    const reorderedAgentsSnapshot = {
      ...updatedTeamSnapshot,
      teams: updatedTeamSnapshot.teams.map((team) => team.id === 'team-app'
        ? { ...team, agentIds: ['agent-jesse', 'agent-dina'] }
        : team),
    };
    const createdSnapshot = {
      ...reorderedAgentsSnapshot,
      agents: [
        ...reorderedAgentsSnapshot.agents,
        {
          id: 'agent-jules',
          teamId: 'team-app',
          name: 'Jules',
          avatar: '🤖',
          folder: '/Users/nbonamy/src/jules',
          status: { type: 'idle' as const },
          createdAt: '2026-06-05T00:00:00.000Z',
          updatedAt: '2026-06-05T00:00:00.000Z',
        },
      ],
      activeAgentId: 'agent-jules',
    };
    const updatedSnapshot = {
      ...createdSnapshot,
      agents: createdSnapshot.agents.map((agent) => agent.id === 'agent-jules' ? { ...agent, name: 'Jules Prime' } : agent),
    };
    const duplicatedSnapshot = {
      ...updatedSnapshot,
      activeAgentId: 'agent-jules-copy',
    };
    const movedSnapshot = {
      ...duplicatedSnapshot,
      activeTeamId: 'team-skwad-core',
      agents: duplicatedSnapshot.agents.map((agent) => agent.id === 'agent-jules'
        ? { ...agent, teamId: 'team-skwad-core' }
        : agent),
    };
    const restartedSnapshot = {
      ...movedSnapshot,
      messages: [],
    };
    const closedSnapshot = {
      ...restartedSnapshot,
      agents: restartedSnapshot.agents.filter((agent) => agent.id !== 'agent-jules'),
      activeAgentId: 'agent-dina',
    };
    const closedTeamSnapshot = {
      ...closedSnapshot,
      teams: closedSnapshot.teams.filter((team) => team.id !== 'team-skwad-core'),
      activeTeamId: 'team-app',
    };
    const chooseAgentFolder = vi.fn().mockResolvedValue('/Users/nbonamy/src/jules');
    const createTeam = vi.fn().mockResolvedValue(teamSnapshot);
    const updateTeam = vi.fn().mockResolvedValue(updatedTeamSnapshot);
    const reorderTeams = vi.fn().mockResolvedValue(selectedTeamSnapshot);
    const reorderAgents = vi.fn().mockResolvedValue(reorderedAgentsSnapshot);
    const closeTeam = vi.fn().mockResolvedValue(closedTeamSnapshot);
    const selectTeam = vi.fn().mockResolvedValue(selectedCoreTeamSnapshot);
    const createAgent = vi.fn().mockResolvedValue(createdSnapshot);
    const updateAgent = vi.fn().mockResolvedValue(updatedSnapshot);
    const duplicateAgent = vi.fn().mockResolvedValue(duplicatedSnapshot);
    const forkAgent = vi.fn().mockResolvedValue(duplicatedSnapshot);
    const moveAgentToTeam = vi.fn().mockResolvedValue(movedSnapshot);
    const restartAgent = vi.fn().mockResolvedValue(restartedSnapshot);
    const closeAgent = vi.fn().mockResolvedValue(closedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn(),
        chooseAgentFolder,
        createTeam,
        updateTeam,
        reorderTeams,
        closeTeam,
        selectTeam,
        createAgent,
        updateAgent,
        duplicateAgent,
        forkAgent,
        moveAgentToTeam,
        reorderAgents,
        restartAgent,
        closeAgent,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    await expect(state.chooseAgentFolder()).resolves.toBe('/Users/nbonamy/src/jules');
    await state.createTeam({ name: 'Skwad Core', color: '#46A857' });
    await state.reorderTeams({ teamId: 'team-skwad-core', beforeTeamId: 'team-app' });
    await state.selectTeam('team-app');
    await state.updateTeam({ id: 'team-app', name: 'Core Team', color: '#46A857' });
    await state.reorderAgents({ teamId: 'team-app', agentId: 'agent-jesse', beforeAgentId: 'agent-dina' });
    await state.createAgent({ name: 'Jules', avatar: '🤖', folder: '/Users/nbonamy/src/jules', selection: { backend: 'claude' } });
    await state.updateAgent({ id: 'agent-jules', name: 'Jules Prime' });
    await state.forkActiveAgentTurn('turn-4');
    await state.duplicateAgent('agent-jules');
    await state.forkAgent('agent-jules');
    await state.moveAgentToTeam({ agentId: 'agent-jules', teamId: 'team-skwad-core' });
    await state.restartAgent('agent-jules');
    await state.closeAgent('agent-jules');
    await state.closeTeam('team-skwad-core');

    expect(createTeam).toHaveBeenCalledWith({ name: 'Skwad Core', color: '#46A857' });
    expect(reorderTeams).toHaveBeenCalledWith({ teamId: 'team-skwad-core', beforeTeamId: 'team-app' });
    expect(selectTeam).toHaveBeenCalledWith('team-app');
    expect(updateTeam).toHaveBeenCalledWith({ id: 'team-app', name: 'Core Team', color: '#46A857' });
    expect(reorderAgents).toHaveBeenCalledWith({ teamId: 'team-app', agentId: 'agent-jesse', beforeAgentId: 'agent-dina' });
    expect(createAgent).toHaveBeenCalledWith({ name: 'Jules', avatar: '🤖', folder: '/Users/nbonamy/src/jules', selection: { ...{ backend: 'claude' } } });
    expect(updateAgent).toHaveBeenCalledWith({ id: 'agent-jules', name: 'Jules Prime' });
    expect(duplicateAgent).toHaveBeenCalledWith('agent-jules');
    expect(forkAgent).toHaveBeenNthCalledWith(1, 'agent-jules', 'turn-4');
    expect(forkAgent).toHaveBeenNthCalledWith(2, 'agent-jules');
    expect(moveAgentToTeam).toHaveBeenCalledWith({ agentId: 'agent-jules', teamId: 'team-skwad-core' });
    expect(restartAgent).toHaveBeenCalledWith('agent-jules');
    expect(closeAgent).toHaveBeenCalledWith('agent-jules');
    expect(closeTeam).toHaveBeenCalledWith('team-skwad-core');
    expect(state.snapshot.value).toStrictEqual(closedTeamSnapshot);
  });


  it('shows a failed team move as a toast and preserves the current membership and selection', async () => {
    const initialSnapshot = createInitialSnapshot();
    initialSnapshot.teams.push({ id: 'team-other', name: 'Other', agentIds: [] });
    const moveAgentToTeam = vi.fn().mockRejectedValue(new Error('Unable to save team membership.'));
    stubElectronTestWindow({ app: { moveAgentToTeam } });
    const state = useAppState();
    state.snapshot.value = structuredClone(initialSnapshot);

    try {
      await expect(state.moveAgentToTeam({ agentId: 'agent-dina', teamId: 'team-other' })).resolves.toBeUndefined();
      await nextTick();
      expect(document.querySelector('.el-message--error')?.textContent).toContain('Unable to save team membership.');
      expect(state.snapshot.value).toStrictEqual(structuredClone(initialSnapshot));
    } finally {
      ElMessage.closeAll();
    }
  });

  it('returns safe defaults when optional agent preload helpers are unavailable', async () => {
    const remoteSnapshot = createInitialSnapshot();
    stubLegacyElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    const before = state.snapshot.value;

    await expect(state.chooseAgentFolder()).resolves.toBeNull();
    await expect(state.chooseSourceFolder()).resolves.toBeNull();
    await expect(state.listSourceFolders()).resolves.toStrictEqual({ path: '', parentPath: null, entries: [] });
    await expect(state.listSourceRepositories()).resolves.toStrictEqual([]);
    await expect(state.cloneSourceRepository({ url: 'https://github.com/nbonamy/repo' })).rejects.toThrow('Repository cloning is not available.');
    await expect(state.createSourceRepository({ name: 'repo' })).rejects.toThrow('Project creation is not available.');
    await expect(state.listSourceWorktrees('/repo')).resolves.toStrictEqual([]);
    await expect(state.suggestSourceWorktreePath({ repoPath: '/repo', branchName: 'feature' })).resolves.toBe('');
    await expect(state.chooseSourceWorktreeDestination('/repo-feature')).resolves.toBeNull();
    await expect(state.createSourceWorktree({} as never)).rejects.toThrow('Source worktree creation is not available.');
    await expect(state.previewAgentFile('agent-dina', 'README.md')).rejects.toThrow('File preview is not available.');
    await expect(state.getAgentGitDiff('agent-dina')).rejects.toThrow('Git diff preview is not available.');
    await expect(state.openAgentPath('agent-dina', 'finder')).rejects.toThrow('Open In is not available.');
    await state.createTeam({ name: 'Ignored Team', color: '#46A857' });
    await state.updateTeam({ id: 'team-app', name: 'Ignored Team', color: '#46A857' });
    await state.reorderTeams({ teamId: 'team-app', beforeTeamId: null });
    await state.closeTeam('team-app');
    await state.selectTeam('team-app');
    await state.createAgent({ name: 'Ignored', folder: '/tmp/ignored' });
    await state.updateAgent({ id: 'agent-dina', name: 'Ignored' });
    await state.duplicateAgent('agent-dina');
    await state.moveAgentToTeam({ agentId: 'agent-dina', teamId: 'team-app' });
    await state.reorderAgents({ teamId: 'team-app', agentId: 'agent-dina', beforeAgentId: null });
    await state.restartAgent('agent-dina');
    await state.closeAgent('agent-dina');
    await expect(state.getAutomationSnapshot({ kind: 'remote', remoteConnectionId: 'ssh-1' })).resolves.toBe(before);
    await expect(state.createAutomation({} as never)).resolves.toBeUndefined();
    await expect(state.updateAutomation({ id: 'missing' } as never)).resolves.toBeUndefined();
    await expect(state.runAutomation('missing')).resolves.toBeUndefined();
    await expect(state.clearAutomationHistory('missing')).resolves.toBeUndefined();
    await expect(state.deleteAutomationExecution('missing', 'execution')).resolves.toBeUndefined();
    await expect(state.deleteAutomation('missing')).resolves.toBeUndefined();
    await expect(state.readConversationMessages({ backend: 'codex', threadId: 'thread' }, 'agent-dina')).resolves.toStrictEqual([]);
    await expect(state.listAgentConversations('agent-dina')).resolves.toStrictEqual([]);
    await state.resumeAgentConversation('agent-dina', {
      ref: { backend: 'codex', threadId: 'thread' },
      storageState: 'archived',
    });
    await state.updateSettings({});
    await state.setCodexResourceSharing({ enabled: true });
    await expect(state.getPluginStatus()).resolves.toStrictEqual({ chromeEnabled: false });
    await expect(state.listSshHosts()).resolves.toStrictEqual([]);
    await state.addSshConnection({} as never);
    await state.checkRemoteConnection('ssh-1');
    await state.updateRemoteConnection('ssh-1', {} as never);
    await state.removeRemoteConnection('ssh-1');
    await expect(state.getRemoteControlStatus()).resolves.toStrictEqual({ status: 'disabled' });
    await expect(state.enableRemoteControl()).resolves.toStrictEqual({ status: 'disabled' });
    await expect(state.disableRemoteControl()).resolves.toStrictEqual({ status: 'disabled' });
    await expect(state.startDevicePairing()).rejects.toThrow('Device pairing is not available.');
    await expect(state.checkDevicePairing({} as never)).resolves.toBe(false);
    await expect(state.listPairedDevices('environment')).resolves.toStrictEqual([]);
    await state.revokePairedDevice('environment', 'client');
    await state.loadDaemonStatus();
    await state.setDaemonEnabled(true);
    await state.connectWorkProvider('github');
    await expect(state.openWorkProviderAuthorization('github')).rejects.toThrow('Start authorization');
    await state.pollWorkProviderAuthorization('github');
    await state.disconnectWorkProvider('github');
    await expect(state.loadWorkRepositories('github')).resolves.toStrictEqual([]);
    await expect(state.loadWorkItems('github', '')).resolves.toStrictEqual([]);
    await state.configureWorkBacklog({} as never);
    await state.assignWorkItemToAgent({ agentId: 'agent-dina', item: workItem() });
    await state.removeWorkItemAssignment(workItem());
    await state.forkAgent('agent-dina');
    state.snapshot.value.activeAgentId = null;
    await state.forkActiveAgentTurn('turn-1');
    await state.resolveBackendApproval('missing', 'approve', 'once');
    state.selectModel('missing');
    state.selectReasoningEffort('high');
    state.selectServiceTier('fast');
    await state.setApprovalPreset('full-access');
    state.updateComposerState('missing', { text: 'ignored', selectionStart: 0, selectionEnd: 0 });
    state.updateComposerAttachments('missing', []);
    await state.loadOlderAgentHistory('agent-dina');

    expect(state.snapshot.value).toBe(before);
  });

  it('clears the visible Antigravity conversation when restarting without disturbing another agent', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const initialSnapshot = createInitialSnapshot();
    const first = initialSnapshot.agents[0]!;
    first.backend = 'antigravity';
    first.backendSession = { kind: 'antigravity', sessionId: 'native-first' };
    const second = { ...first, id: 'other-antigravity', backendSession: { kind: 'antigravity' as const, sessionId: 'native-second' } };
    initialSnapshot.agents.push(second);
    const restartedSnapshot = structuredClone(initialSnapshot);
    delete restartedSnapshot.agents[0]!.backendSession;
    stubElectronTestWindow({ app: {
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      onEvent: vi.fn(listener => { listeners.push(listener); return () => {}; }),
      restartAgent: vi.fn().mockResolvedValue(restartedSnapshot),
    } satisfies Partial<AppApi> });
    const state = useAppState();
    await state.loadSnapshot();
    for (const [index, agent] of [first, second].entries()) {
      if (agent.backendSession?.kind !== 'antigravity') throw new Error('Missing fixture native session');
      const native = emptyAntigravitySnapshot(agent.id, agent.backendSession.sessionId);
      native.messages = [{ id: agent.id + '-answer', agentId: agent.id, role: 'assistant', status: 'complete', createdAt: '', parts: [{ type: 'text', text: agent.id + ' previous answer' }] }];
      listeners[0]?.({ seq: index + 1, occurredAt: '', agentId: agent.id, backend: 'antigravity', backendSessionId: native.sessionId,
        type: 'antigravity.conversationSnapshotChanged', payload: { revision: 1, snapshot: native } });
    }
    expect(state.activeAntigravityConversationSnapshot.value?.messages).toHaveLength(1);
    await state.restartAgent(first.id);
    expect(state.activeAgent.value?.backendSession).toBeUndefined();
    expect(state.activeAntigravityConversationSnapshot.value).toBeNull();
    expect(state.agentConversationFor(second.id)?.antigravitySnapshot?.messages).toHaveLength(1);
  });

  it('clears the visible Claude conversation when restarting', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const initialSnapshot = createInitialSnapshot();
    const agent = initialSnapshot.agents[0]!;
    agent.backend = 'claude';
    agent.backendSession = { kind: 'claude', sessionId: 'claude-session-1', transport: 'stdio' };
    const restartedSnapshot = structuredClone(initialSnapshot);
    delete restartedSnapshot.agents[0]!.backendSession;
    stubElectronTestWindow({ app: {
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      onEvent: vi.fn(listener => { listeners.push(listener); return () => {}; }),
      restartAgent: vi.fn().mockResolvedValue(restartedSnapshot),
    } satisfies Partial<AppApi> });
    const state = useAppState();
    await state.loadSnapshot();
    listeners[0]?.({ seq: 1, occurredAt: '', agentId: agent.id, backend: 'claude',
      type: 'claude.conversationSnapshotChanged',
      payload: { revision: 1, snapshot: claudeConversationSnapshot([], { agentId: agent.id, sessionId: 'claude-session-1' }) } });
    expect(state.activeClaudeConversationSnapshot.value).not.toBeNull();

    await state.restartAgent(agent.id);

    expect(state.activeAgent.value?.backendSession).toBeUndefined();
    expect(state.activeClaudeConversationSnapshot.value).toBeNull();
    expect(state.agentConversationFor(agent.id)?.claudeSnapshot).toBeNull();
  });

  it('loads the conversation of a freshly forked Claude agent', async () => {
    const initialSnapshot = createInitialSnapshot();
    const source = initialSnapshot.agents[0]!;
    source.backend = 'claude';
    source.backendSession = { kind: 'claude', sessionId: 'claude-session-1', transport: 'stdio' };
    const forkedSnapshot = structuredClone(initialSnapshot);
    const fork = { ...structuredClone(source), id: 'agent-fork', backendSession: { kind: 'claude' as const, sessionId: 'claude-fork-1', transport: 'stdio' as const } };
    forkedSnapshot.agents.push(fork);
    forkedSnapshot.activeAgentId = fork.id;
    const loadConversationHistory = vi.fn().mockResolvedValueOnce(structuredClone(initialSnapshot)).mockResolvedValue(forkedSnapshot);
    stubElectronTestWindow({ app: {
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      onEvent: vi.fn(() => () => {}),
      forkAgent: vi.fn().mockResolvedValue(forkedSnapshot),
      loadConversationHistory,
    } satisfies Partial<AppApi> });
    const state = useAppState();
    await state.loadSnapshot();

    loadConversationHistory.mockClear();
    await state.forkAgent(source.id);

    expect(loadConversationHistory).toHaveBeenCalledWith(fork.id);
  });

  it('clears a failed history state when the agent is restarted', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const restartedSnapshot = structuredClone(remoteSnapshot);
    delete restartedSnapshot.agents[0]!.backendSession;
    const restartAgent = vi.fn().mockResolvedValue(restartedSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
        restartAgent,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    listeners[0]?.({
      seq: 1,
      occurredAt: '2026-09-05T00:00:00.000Z',
      agentId: 'agent-dina',
      type: 'conversation.historyLoadFailed',
      payload: { error: 'Unable to load conversation history.' },
    });
    expect(state.isActiveAgentHistoryFailed.value).toBe(true);

    await state.restartAgent('agent-dina');

    expect(restartAgent).toHaveBeenCalledWith('agent-dina');
    expect(state.snapshot.value).toStrictEqual(restartedSnapshot);
    expect(state.isActiveAgentHistoryFailed.value).toBe(false);
  });

  it('keeps the current agent selected when duplicating in the background', async () => {
    const initialSnapshot = createInitialSnapshot();
    const copy = {
      ...initialSnapshot.agents[0]!,
      id: 'agent-dina-copy',
      name: 'Dina (copy)',
    };
    const duplicatedSnapshot = {
      ...initialSnapshot,
      agents: [initialSnapshot.agents[0]!, copy],
      teams: initialSnapshot.teams.map((team) => team.id === initialSnapshot.activeTeamId
        ? { ...team, agentIds: [initialSnapshot.agents[0]!.id, copy.id] }
        : team),
      activeAgentId: copy.id,
    };
    const duplicateAgent = vi.fn().mockResolvedValue(duplicatedSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
        onEvent: vi.fn(),
        duplicateAgent,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    await expect(state.duplicateAgent('agent-dina', { select: false })).resolves.toMatchObject({ id: copy.id });

    expect(duplicateAgent).toHaveBeenCalledWith('agent-dina', { select: false });
    expect(state.snapshot.value.activeAgentId).toBe('agent-dina');
    expect(state.snapshot.value.agents).toContainEqual(copy);
  });

  it('routes optional desktop operations through the preload bridge and adopts their results', async () => {
    const initialSnapshot = createInitialSnapshot();
    initialSnapshot.sourceFolder.path = '/Users/nbonamy/src';
    initialSnapshot.teams.push({
      id: 'team-other',
      name: 'Other',
      color: '#123456',
      agentIds: [],
    });
    const updatedSnapshot = structuredClone(initialSnapshot);
    updatedSnapshot.sourceFolder.path = '/Users/nbonamy/projects';
    const repositories: SourceRepository[] = [{
      name: 'agent-workspace',
      path: '/Users/nbonamy/projects/agent-workspace',
      worktrees: [],
    }];
    const pairingSession: DevicePairingSession = {
      pairingCode: 'ABCD-EFGH',
      environmentId: 'environment-1',
      expiresAt: '2026-06-05T00:10:00.000Z',
    };
    const daemonStatus = {
      supported: true,
      installed: true,
      running: true,
      socketPath: '/tmp/daemon.sock',
      pid: 1234,
    };
    const api = {
      listSourceRepositories: vi.fn().mockResolvedValue(repositories),
      previewAgentFile: vi.fn().mockResolvedValue({ path: 'README.md', content: `# ${product.name}` }),
      getAgentGitDiff: vi.fn().mockResolvedValue(undefined),
      getAutomationSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      updateSettings: vi.fn().mockResolvedValue(updatedSnapshot),
      listSshHosts: vi.fn().mockResolvedValue([{ host: 'devbox' }]),
      addSshConnection: vi.fn().mockResolvedValue(initialSnapshot),
      checkRemoteConnection: vi.fn().mockResolvedValue(initialSnapshot),
      updateRemoteConnection: vi.fn().mockResolvedValue(initialSnapshot),
      removeRemoteConnection: vi.fn().mockResolvedValue(initialSnapshot),
      getRemoteControlStatus: vi.fn().mockResolvedValue({ status: 'connected', environmentId: 'environment-1' }),
      enableRemoteControl: vi.fn().mockResolvedValue({ status: 'connecting' }),
      disableRemoteControl: vi.fn().mockResolvedValue({ status: 'disabled' }),
      startDevicePairing: vi.fn().mockResolvedValue(pairingSession),
      checkDevicePairing: vi.fn().mockResolvedValue(true),
      listPairedDevices: vi.fn().mockResolvedValue([{ clientId: 'client-1', displayName: 'Phone' }]),
      revokePairedDevice: vi.fn().mockResolvedValue(undefined),
      getDaemonStatus: vi.fn().mockResolvedValue(daemonStatus),
      setDaemonEnabled: vi.fn().mockResolvedValue(daemonStatus),
      loadOlderAgentHistory: vi.fn().mockResolvedValue({ hasOlder: false }),
    } satisfies Partial<AppApi>;
    stubElectronTestWindow({ app: api });

    const state = useAppState();
    state.snapshot.value = initialSnapshot;

    await expect(state.listSourceRepositories('ssh-1')).resolves.toStrictEqual(repositories);
    await expect(state.previewAgentFile('agent-dina', 'README.md')).resolves.toStrictEqual({ path: 'README.md', content: `# ${product.name}` });
    await state.getAgentGitDiff('agent-dina');
    await expect(state.getAutomationSnapshot({ kind: 'remote', remoteConnectionId: 'ssh-1' })).resolves.toBe(initialSnapshot);
    await state.updateSettings({ sourceFolder: { path: '/Users/nbonamy/projects' } });
    await expect(state.listSshHosts()).resolves.toStrictEqual([{ host: 'devbox' }]);
    await state.addSshConnection({ host: 'devbox' });
    await state.checkRemoteConnection('ssh-1');
    await state.updateRemoteConnection('ssh-1', { sourceFolderPath: '/srv/src' });
    await state.removeRemoteConnection('ssh-1');
    await expect(state.getRemoteControlStatus()).resolves.toMatchObject({ status: 'connected' });
    await expect(state.enableRemoteControl()).resolves.toMatchObject({ status: 'connecting' });
    await expect(state.disableRemoteControl()).resolves.toMatchObject({ status: 'disabled' });
    await expect(state.startDevicePairing()).resolves.toBe(pairingSession);
    await expect(state.checkDevicePairing(pairingSession)).resolves.toBe(true);
    await expect(state.listPairedDevices('environment-1')).resolves.toMatchObject([{ clientId: 'client-1' }]);
    await state.revokePairedDevice('environment-1', 'client-1');
    await state.loadDaemonStatus();
    await state.setDaemonEnabled(true);
    await state.loadOlderAgentHistory('agent-dina');

    expect(api.listSourceRepositories).toHaveBeenCalledWith('ssh-1');
    expect(api.updateSettings).toHaveBeenCalledWith({ sourceFolder: { path: '/Users/nbonamy/projects' } });
    expect(state.sourceRepositories.value).toStrictEqual(repositories);
    expect(state.daemonStatus.value).toStrictEqual(daemonStatus);
    expect(state.daemonStatusError.value).toBeNull();
    expect(state.activeHistoryHasOlder.value).toBe(false);
  });

  it('normalizes reactive Git diff targets before crossing the preload boundary', async () => {
    const getAgentGitDiff = vi.fn(async (_agentId: string, target?: object) => {
      structuredClone(target);
      return { target: { type: 'branch' as const, baseRef: 'origin/main' }, diff: '', sections: [], summary: { addedLines: 0, removedLines: 0, changedFiles: 0 } };
    });
    stubElectronTestWindow({ app: { getAgentGitDiff } satisfies Partial<AppApi> });
    const state = useAppState();

    await expect(state.getAgentGitDiff(
      'agent-dina',
      reactive({ type: 'branch' as const, baseRef: 'origin/main' }),
    )).resolves.toMatchObject({ target: { type: 'branch', baseRef: 'origin/main' }, diff: '' });

    expect(getAgentGitDiff).toHaveBeenCalledWith('agent-dina', {
      type: 'branch',
      baseRef: 'origin/main',
    });
  });

  it('recovers from optional desktop operation failures without leaving stale loading state', async () => {
    const initialSnapshot = createInitialSnapshot();
    const history = deferred<{ hasOlder: boolean }>();
    const getDaemonStatus = vi.fn()
      .mockRejectedValueOnce('daemon unavailable')
      .mockRejectedValueOnce(new Error('refresh unavailable'));
    const setCodexResourceSharing = vi.fn()
      .mockResolvedValueOnce(initialSnapshot)
      .mockRejectedValueOnce(new Error('migration failed'));
    const api = {
      setCodexResourceSharing,
      reloadRenderer: vi.fn().mockResolvedValue(undefined),
      getDaemonStatus,
      setDaemonEnabled: vi.fn().mockRejectedValue(new Error('cannot stop daemon')),
      listBackendSkills: vi.fn().mockRejectedValue('skills unavailable'),
      listAgentFiles: vi.fn().mockRejectedValue(new Error('files unavailable')),
      loadOlderAgentHistory: vi.fn().mockReturnValue(history.promise),
    } satisfies Partial<AppApi>;
    stubElectronTestWindow({ app: api });

    const state = useAppState();
    state.snapshot.value = initialSnapshot;

    await state.setCodexResourceSharing({ enabled: true });
    expect(api.reloadRenderer).toHaveBeenCalledOnce();
    expect(state.backendRestartInProgress.value).toBe(true);
    await expect(state.setCodexResourceSharing({ enabled: true })).rejects.toThrow('migration failed');
    expect(state.backendRestartInProgress.value).toBe(false);

    await state.loadDaemonStatus();
    expect(state.daemonStatusError.value).toBe('daemon unavailable');
    await state.setDaemonEnabled(false);
    expect(state.daemonStatusError.value).toBe('cannot stop daemon');

    await expect(state.openWorkProviderAuthorization('github')).rejects.toThrow('Start authorization');
    expect(state.workBacklogStatus.value).toBe('error');
    expect(state.workBacklogError.value).toBe('Start authorization before opening the provider login page.');

    await state.loadBackendSkills();
    expect(state.skillCatalogStatus.value).toBe('error');
    expect(state.skillCatalogError.value).toBe('skills unavailable');
    await state.loadAgentFiles();
    expect(state.fileCatalogStatus.value).toBe('error');
    expect(state.fileCatalogError.value).toBe('files unavailable');

    const firstHistoryLoad = state.loadOlderAgentHistory('agent-dina');
    await state.loadOlderAgentHistory('agent-dina');
    expect(api.loadOlderAgentHistory).toHaveBeenCalledTimes(1);
    history.resolve({ hasOlder: true });
    await firstHistoryLoad;
    expect(state.isLoadingOlderHistory.value).toBe(false);
    expect(state.activeHistoryHasOlder.value).toBe(true);
  });

  it('ignores invalid reorder requests before calling main', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const reorderTeams = vi.fn().mockResolvedValue(remoteSnapshot);
    const reorderAgents = vi.fn().mockResolvedValue(remoteSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn(),
        reorderTeams,
        reorderAgents,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    await state.reorderTeams({ teamId: 'missing-team', beforeTeamId: null });
    await state.reorderTeams({ teamId: 'team-app', beforeTeamId: 'missing-team' });
    await state.reorderAgents({ teamId: 'missing-team', agentId: 'agent-dina', beforeAgentId: null });
    await state.reorderAgents({ teamId: 'team-app', agentId: 'missing-agent', beforeAgentId: null });
    await state.reorderAgents({ teamId: 'team-app', agentId: 'agent-dina', beforeAgentId: 'missing-agent' });

    expect(reorderTeams).not.toHaveBeenCalled();
    expect(reorderAgents).not.toHaveBeenCalled();
  });

  it('forwards repository reorders after validating both repository roots', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0]!.workspace = {
      kind: 'git',
      folder: '/Users/nbonamy/src/agent-workspace',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/Users/nbonamy/src/agent-workspace',
      primaryWorktreeRoot: '/Users/nbonamy/src/agent-workspace',
      branch: 'main',
      isLinkedWorktree: false,
      updatedAt: '2026-06-05T00:00:00.000Z',
    };
    remoteSnapshot.agents[1]!.workspace = {
      kind: 'git',
      folder: '/Users/nbonamy/src/id8',
      repositoryName: 'id8',
      repositoryRoot: '/Users/nbonamy/src/id8',
      primaryWorktreeRoot: '/Users/nbonamy/src/id8',
      branch: 'main',
      isLinkedWorktree: false,
      updatedAt: '2026-06-05T00:00:00.000Z',
    };
    const reorderRepositories = vi.fn().mockResolvedValue(remoteSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn(),
        reorderRepositories,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    const input = {
      teamId: 'team-app',
      repositoryKey: '/Users/nbonamy/src/id8',
      beforeRepositoryKey: '/Users/nbonamy/src/agent-workspace',
    };
    await state.reorderRepositories(input);
    await state.reorderRepositories({ ...input, repositoryKey: '/missing' });
    await state.reorderRepositories({ ...input, beforeRepositoryKey: '/missing' });

    expect(reorderRepositories).toHaveBeenCalledOnce();
    expect(reorderRepositories).toHaveBeenCalledWith(input);
  });
});
