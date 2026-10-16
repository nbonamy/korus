import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { useAppState } from '../app-state';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { BackendConversationRef, AppApi, RendererMessage, WorkSource } from '@workspace/core/contracts';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import { clearConfetti, useConfetti } from '../shared/confetti/use-confetti';
import { stubElectronTestWindow, stubLegacyElectronTestWindow } from '../test/client';
import { configureAppClient } from '../platform-api';
import { clearFirstRunOnboardingStage, setFirstRunOnboardingStage } from '../onboarding-session';
import { workItem } from './app-state-test-harness';

describe('useAppState', () => {
  afterEach(() => {
    clearConfetti();
    clearFirstRunOnboardingStage();
    vi.useRealTimers();
  });

  it('connects work providers and hydrates the selected repository backlog', async () => {
    vi.useFakeTimers();
    const initialSnapshot = createInitialSnapshot();
    const connectingSnapshot = createInitialSnapshot();
    connectingSnapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connecting',
      detail: 'Enter code ABCD-1234 in GitHub.',
    }];
    const connectedSnapshot = createInitialSnapshot();
    connectedSnapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    const selectedSnapshot = createInitialSnapshot();
    selectedSnapshot.workBacklog.connections = connectedSnapshot.workBacklog.connections;
    selectedSnapshot.workBacklog.providerConfigurations.github = {
      sourceId: 'nbonamy/agent-workspace',
    };
    const repository = workRepository();
    const item = workItem();
    const connectWorkProvider = vi.fn().mockResolvedValue({
      snapshot: connectingSnapshot,
      authorization: {
        provider: 'github',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresAt: '2026-06-09T12:05:00.000Z',
      },
    });
    const openExternal = vi.spyOn(window, 'open').mockReturnValue(null);
    const pollWorkProviderAuthorization = vi.fn().mockResolvedValue(connectedSnapshot);
    const listWorkSources = vi.fn().mockResolvedValue([repository]);
    const configureWorkBacklog = vi.fn().mockResolvedValue(selectedSnapshot);
    const listWorkItems = vi.fn().mockResolvedValue([item]);
    stubElectronTestWindow({
      app: {
        connectWorkProvider,
        pollWorkProviderAuthorization,
        listWorkSources,
        configureWorkBacklog,
        listWorkItems,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    state.snapshot.value = initialSnapshot;

    await state.connectWorkProvider('github');
    expect(state.snapshot.value).toStrictEqual(connectingSnapshot);
    expect(state.workProviderAuthorization.value?.userCode).toBe('ABCD-1234');
    expect(openExternal).not.toHaveBeenCalled();

    await state.openWorkProviderAuthorization('github');
    expect(openExternal).toHaveBeenCalledWith('https://github.com/login/device', '_blank', 'noopener,noreferrer');
    openExternal.mockRestore();
    expect(state.snapshot.value).toStrictEqual(connectingSnapshot);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(pollWorkProviderAuthorization).toHaveBeenCalledWith('github');
    expect(useConfetti().bursts.value).toHaveLength(1);
    expect(listWorkSources).toHaveBeenCalledWith('github');
    expect(configureWorkBacklog).toHaveBeenCalledWith({
      provider: 'github',
      configuration: {
        sourceId: 'nbonamy/agent-workspace',
        assigneeLogin: null,
        tagName: null,
      },
    });
    expect(listWorkItems).toHaveBeenCalledWith('github', 'nbonamy/agent-workspace');
    expect(state.workProviderAuthorization.value).toBeNull();
    expect(state.workRepositoriesByProvider.value.github).toStrictEqual([repository]);
    expect(state.workItemsByRepository.value['github:nbonamy/agent-workspace']).toStrictEqual([item]);
  });

  it('leaves first-run onboarding to own the GitHub connection celebration', async () => {
    const connectedSnapshot = createInitialSnapshot();
    connectedSnapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    stubElectronTestWindow({
      app: {
        pollWorkProviderAuthorization: vi.fn().mockResolvedValue(connectedSnapshot),
        listWorkSources: vi.fn().mockResolvedValue([]),
      } satisfies Partial<AppApi>,
    });
    setFirstRunOnboardingStage('github');
    const state = useAppState();

    await state.pollWorkProviderAuthorization('github');

    expect(useConfetti().bursts.value).toHaveLength(0);
  });

  it('opens provider authorization in the browser for the web platform', async () => {
    vi.useFakeTimers();
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connecting' }];
    const connectWorkProvider = vi.fn().mockResolvedValue({
      snapshot,
      authorization: {
        provider: 'github',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresAt: '2026-06-09T12:05:00.000Z',
      },
    });
    const backendOpenAuthorization = vi.fn();
    const openExternal = vi.spyOn(window, 'open').mockReturnValue(null);
    const api = {
      connectWorkProvider,
      openWorkProviderAuthorization: backendOpenAuthorization,
    } as unknown as AppApi;
    configureAppClient({ api, platform: 'web' });
    const state = useAppState();
    state.snapshot.value = createInitialSnapshot();

    await state.connectWorkProvider('github');
    await state.openWorkProviderAuthorization('github');

    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/login/device',
      '_blank',
      'noopener,noreferrer',
    );
    expect(backendOpenAuthorization).not.toHaveBeenCalled();
    expect(state.workBacklogStatus.value).toBe('loaded');
    openExternal.mockRestore();
  });

  it('assigns work items through the existing agent prompt path', async () => {
    const snapshot = createInitialSnapshot();
    const assignment = {
      provider: 'github' as const,
      itemId: 'nbonamy/agent-workspace#12',
      agentId: 'agent-dina',
      assignedAt: '2026-06-09T13:00:00.000Z',
      policy: 'review' as const,
      status: 'inProgress' as const,
    };
    const assignedSnapshot = createInitialSnapshot();
    assignedSnapshot.workBacklog.assignments = {
      'github:nbonamy/agent-workspace#12': assignment,
    };
    const updatedSnapshot = createInitialSnapshot();
    updatedSnapshot.workBacklog.assignments = assignedSnapshot.workBacklog.assignments;
    const assignWorkItemToAgent = vi.fn().mockResolvedValue(assignedSnapshot);
    const sendPrompt = vi.fn().mockResolvedValue(updatedSnapshot);
    stubElectronTestWindow({
      app: {
        assignWorkItemToAgent,
        sendPrompt,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = snapshot;

    const item = reactive(workItem());
    await state.assignWorkItemToAgent({
      agentId: 'agent-dina',
      item,
    });

    expect(assignWorkItemToAgent).toHaveBeenCalledWith('agent-dina', workItem());
    expect(assignWorkItemToAgent.mock.calls[0]?.[1]).not.toBe(item);
    expect(sendPrompt.mock.calls[0]?.[0]).toBe('agent-dina');
    expect(sendPrompt.mock.calls[0]?.[1]).toContain('Issue: #12 Fix cockpit drag target');
    expect(sendPrompt.mock.calls[0]?.[1]).toContain('URL: https://github.com/nbonamy/agent-workspace/issues/12');
    expect(state.snapshot.value.workBacklog.assignments).toStrictEqual(assignedSnapshot.workBacklog.assignments);
  });

  it('dispatches an explicit work item action prompt after assignment', async () => {
    const assignedSnapshot = createInitialSnapshot();
    const assignWorkItemToAgent = vi.fn().mockResolvedValue(assignedSnapshot);
    const sendPrompt = vi.fn().mockResolvedValue(assignedSnapshot);
    stubElectronTestWindow({
      app: {
        assignWorkItemToAgent,
        sendPrompt,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = createInitialSnapshot();

    await state.assignWorkItemToAgent({
      agentId: 'agent-dina',
      item: workItem(),
      prompt: 'Investigate only. Do not fix.',
    });

    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', 'Investigate only. Do not fix.');
  });

  it('removes work item assignments through preload without prompting the agent', async () => {
    const assignedSnapshot = createInitialSnapshot();
    const item = reactive(workItem());
    assignedSnapshot.workBacklog.assignments = {
      [workItemAssignmentKey(item)]: {
        provider: 'github',
        itemId: item.id,
        agentId: 'agent-dina',
        assignedAt: '2026-06-09T13:00:00.000Z',
        policy: 'review',
        status: 'inProgress',
      },
    };
    const unassignedSnapshot = createInitialSnapshot();
    const removeWorkItemAssignment = vi.fn().mockResolvedValue(unassignedSnapshot);
    const sendPrompt = vi.fn();
    stubElectronTestWindow({
      app: {
        removeWorkItemAssignment,
        sendPrompt,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = assignedSnapshot;

    await state.removeWorkItemAssignment(item);

    expect(removeWorkItemAssignment).toHaveBeenCalledWith(workItem());
    expect(removeWorkItemAssignment.mock.calls[0]?.[0]).not.toBe(item);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(state.snapshot.value).toStrictEqual(unassignedSnapshot);
  });

  it('handles missing work provider bridge methods as no-ops', async () => {
    stubLegacyElectronTestWindow({ app: {} });
    const state = useAppState();
    state.snapshot.value = createInitialSnapshot();

    await state.connectWorkProvider('github');
    await state.pollWorkProviderAuthorization('github');
    await state.disconnectWorkProvider('github');
    await state.loadWorkRepositories('github');
    await state.configureWorkBacklog({
      provider: 'github',
      configuration: {
        sourceId: null,
        tagName: null,
      },
    });
    await state.loadWorkItems('github', '');

    expect(state.workBacklogStatus.value).toBe('notLoaded');
  });

  it('records work provider bridge errors without marking integrations connected', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    const connectWorkProvider = vi.fn().mockRejectedValue('connect failed');
    const pollWorkProviderAuthorization = vi.fn().mockRejectedValue('finish failed');
    const listWorkSources = vi.fn().mockRejectedValue('repos failed');
    const listWorkItems = vi.fn().mockRejectedValue('items failed');
    stubElectronTestWindow({
      app: {
        connectWorkProvider,
        pollWorkProviderAuthorization,
        listWorkSources,
        listWorkItems,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = snapshot;

    await expect(state.connectWorkProvider('github')).rejects.toBe('connect failed');
    expect(state.workBacklogStatus.value).toBe('error');
    expect(state.workBacklogError.value).toBe('connect failed');

    await expect(state.pollWorkProviderAuthorization('github')).rejects.toBe('finish failed');
    expect(state.workBacklogError.value).toBe('finish failed');

    await state.loadWorkRepositories('github');
    expect(state.workRepositoriesByProvider.value.github).toStrictEqual([]);
    expect(state.workBacklogError.value).toBe('repos failed');

    await expect(state.loadWorkItems('github', 'nbonamy/agent-workspace')).resolves.toBeUndefined();
    expect(state.workBacklogError.value).toBe('items failed');
  });

  it('records Error objects from work provider bridge failures', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    stubElectronTestWindow({
      app: {
        connectWorkProvider: vi.fn().mockRejectedValue(new Error('connect object failed')),
        listWorkSources: vi.fn().mockRejectedValue(new Error('repo object failed')),
        listWorkItems: vi.fn().mockRejectedValue(new Error('item object failed')),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = snapshot;

    await expect(state.connectWorkProvider('github')).rejects.toThrow('connect object failed');
    expect(state.workBacklogError.value).toBe('connect object failed');

    await state.loadWorkRepositories('github');
    expect(state.workBacklogError.value).toBe('repo object failed');

    await expect(state.loadWorkItems('github', 'nbonamy/agent-workspace')).resolves.toBeUndefined();
    expect(state.workBacklogError.value).toBe('item object failed');
  });

  it('keeps pending work provider completion in a loaded state', async () => {
    const connectingSnapshot = createInitialSnapshot();
    connectingSnapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connecting',
      detail: 'GitHub authorization is still pending.',
    }];
    const pollWorkProviderAuthorization = vi.fn().mockResolvedValue(connectingSnapshot);
    const listWorkSources = vi.fn();
    stubElectronTestWindow({
      app: {
        pollWorkProviderAuthorization,
        listWorkSources,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();

    await state.pollWorkProviderAuthorization('github');

    expect(state.snapshot.value.workBacklog.connections[0]?.status).toBe('connecting');
    expect(state.workBacklogStatus.value).toBe('loaded');
    expect(listWorkSources).not.toHaveBeenCalled();
  });

  it('disconnects work providers and handles null repository selection', async () => {
    const connectedSnapshot = createInitialSnapshot();
    connectedSnapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    connectedSnapshot.workBacklog.providerConfigurations.github = {
      sourceId: 'nbonamy/agent-workspace',
      tagName: 'bug',
    };
    const disconnectedSnapshot = createInitialSnapshot();
    disconnectedSnapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'disconnected',
    }];
    const disconnectWorkProvider = vi.fn().mockResolvedValue(disconnectedSnapshot);
    const configureWorkBacklog = vi.fn().mockResolvedValue(disconnectedSnapshot);
    const listWorkItems = vi.fn();
    stubElectronTestWindow({
      app: {
        disconnectWorkProvider,
        configureWorkBacklog,
        listWorkItems,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = connectedSnapshot;
    state.workProviderAuthorization.value = {
      provider: 'github',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresAt: '2026-06-09T12:05:00.000Z',
    };
    state.workRepositoriesByProvider.value = { github: [workRepository()] };
    state.workItemsByRepository.value = { 'github:nbonamy/agent-workspace': [workItem()] };

    await state.configureWorkBacklog({
      provider: 'github',
      configuration: {
        sourceId: null,
        tagName: null,
      },
    });
    await state.disconnectWorkProvider('github');

    expect(configureWorkBacklog).toHaveBeenCalledWith({
      provider: 'github',
      configuration: {
        sourceId: null,
        tagName: null,
      },
    });
    expect(listWorkItems).not.toHaveBeenCalled();
    expect(disconnectWorkProvider).toHaveBeenCalledWith('github');
    expect(state.workProviderAuthorization.value).toBeNull();
    expect(state.workRepositoriesByProvider.value.github).toStrictEqual([]);
    expect(state.workItemsByRepository.value).toStrictEqual({});
    expect(state.workBacklogStatus.value).toBe('notLoaded');
  });

  it('configures remote work backlog without adopting the remote snapshot locally', async () => {
    const localSnapshot = createInitialSnapshot();
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.teams[0]!.id = 'team-remote';
    remoteSnapshot.workBacklog.providerConfigurations.github = {
      sourceId: 'nbonamy/remote',
    };
    const configureWorkBacklog = vi.fn().mockResolvedValue(remoteSnapshot);
    stubElectronTestWindow({
      app: {
        configureWorkBacklog,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = localSnapshot;
    const location = { kind: 'remote' as const, remoteConnectionId: 'connection-devbox' };

    await state.configureWorkBacklog({
      provider: 'github',
      configuration: {
        sourceId: 'nbonamy/remote',
        tagName: null,
      },
    }, location);

    expect(configureWorkBacklog).toHaveBeenCalledWith({
      provider: 'github',
      configuration: {
        sourceId: 'nbonamy/remote',
        tagName: null,
      },
    }, location);
    expect(state.snapshot.value).toStrictEqual(localSnapshot);
    expect(state.snapshot.value.workBacklog.providerConfigurations.github).toBeUndefined();
  });

  it('loads selected work repositories and empty repository lists', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    snapshot.workBacklog.providerConfigurations.github = {
      sourceId: 'nbonamy/agent-workspace',
    };
    const listWorkSources = vi.fn()
      .mockResolvedValueOnce([workRepository()])
      .mockResolvedValueOnce([]);
    const listWorkItems = vi.fn().mockResolvedValue([workItem()]);
    const configureWorkBacklog = vi.fn();
    stubElectronTestWindow({
      app: {
        listWorkSources,
        listWorkItems,
        configureWorkBacklog,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    state.snapshot.value = snapshot;

    await state.loadWorkRepositories('github');
    expect(listWorkItems).toHaveBeenCalledWith('github', 'nbonamy/agent-workspace');
    expect(configureWorkBacklog).not.toHaveBeenCalled();

    delete state.snapshot.value.workBacklog.providerConfigurations.github;
    await state.loadWorkRepositories('github');
    expect(state.workRepositoriesByProvider.value.github).toStrictEqual([]);
  });

  it('creates, updates, and deletes automations through the preload bridge', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const automationInput = {
      name: 'GitHub bugs',
      prompt: 'Check tasks', target: { kind: 'newQuickChat' as const, teamId: 'team-app', backend: 'codex' as const },

      schedule: { intervalMinutes: 60 },
    };
    const createdSnapshot = {
      ...remoteSnapshot,
      automations: [{
        id: 'automation-bugs',
        enabled: true,
        executionLog: [],
        createdAt: '2026-06-09T10:01:00.000Z',
        updatedAt: '2026-06-09T10:01:00.000Z',
        ...automationInput,
      }],
    };
    const updatedSnapshot = {
      ...createdSnapshot,
      automations: [{
        ...createdSnapshot.automations[0],
        enabled: false,
        name: 'Paused bugs',
      }],
    };
    const historyClearedSnapshot = {
      ...updatedSnapshot,
      automations: [{
        ...updatedSnapshot.automations[0],
        executionLog: [],
      }],
    };
    const runSnapshot = {
      ...updatedSnapshot,
      automations: [{
        ...updatedSnapshot.automations[0],
        lastRunAt: '2026-06-09T10:02:00.000Z',
        executionLog: [{
          id: 'automation-exec-1',
          automationId: 'automation-bugs',
          startedAt: '2026-06-09T10:02:00.000Z',
          status: 'working' as const,


        }],
      }],
    };
    const executionDeletedSnapshot = {
      ...runSnapshot,
      automations: [{
        ...runSnapshot.automations[0],
        executionLog: [],
      }],
    };
    const deletedSnapshot = {
      ...historyClearedSnapshot,
      automations: [],
    };
    const createAutomation = vi.fn().mockResolvedValue(createdSnapshot);
    const updateAutomation = vi.fn().mockResolvedValue(updatedSnapshot);
    const runAutomation = vi.fn().mockResolvedValue(runSnapshot);
    const clearAutomationHistory = vi.fn().mockResolvedValue(historyClearedSnapshot);
    const deleteAutomationExecution = vi.fn().mockResolvedValue(executionDeletedSnapshot);
    const deleteAutomation = vi.fn().mockResolvedValue(deletedSnapshot);
    const conversationMessages: RendererMessage[] = [{
      id: 'message-dina-user',
      agentId: 'agent-dina',
      role: 'user',
      status: 'complete',
      createdAt: '2026-06-09T10:00:00.000Z',
      parts: [{ type: 'text', text: 'hello' }],
    }];
    const readConversationMessages = vi.fn().mockResolvedValue(conversationMessages);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn(),
        createAutomation,
        updateAutomation,
        runAutomation,
        clearAutomationHistory,
        deleteAutomationExecution,
        deleteAutomation,
        readConversationMessages,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.createAutomation(automationInput);
    await state.updateAutomation({
      ...automationInput,
      id: 'automation-bugs',
      enabled: false,
      name: 'Paused bugs',
    });
    await state.runAutomation('automation-bugs');
    await state.deleteAutomationExecution('automation-bugs', 'automation-exec-1');
    await state.clearAutomationHistory('automation-bugs');
    await state.deleteAutomation('automation-bugs');
    await expect(state.readConversationMessages({ backend: 'codex', threadId: 'thread-dina' }, 'agent-dina')).resolves.toStrictEqual(conversationMessages);
    const reactiveConversationRef = reactive({
      backend: 'claude' as const,
      folder: '/Users/nbonamy/src/agent-workspace',
      sessionId: 'session-dina',
      subagentId: 'child-explore',
    });
    await expect(state.readConversationMessages(reactiveConversationRef as BackendConversationRef, 'agent-dina')).resolves.toStrictEqual(conversationMessages);

    expect(createAutomation).toHaveBeenCalledWith(automationInput);
    expect(updateAutomation).toHaveBeenCalledWith({
      ...automationInput,
      id: 'automation-bugs',
      enabled: false,
      name: 'Paused bugs',
    });
    expect(runAutomation).toHaveBeenCalledWith('automation-bugs');
    expect(deleteAutomationExecution).toHaveBeenCalledWith('automation-bugs', 'automation-exec-1');
    expect(clearAutomationHistory).toHaveBeenCalledWith('automation-bugs');
    expect(deleteAutomation).toHaveBeenCalledWith('automation-bugs');
    expect(readConversationMessages).toHaveBeenCalledWith({ backend: 'codex', threadId: 'thread-dina' }, 'agent-dina');
    expect(readConversationMessages).toHaveBeenLastCalledWith({
      backend: 'claude',
      folder: '/Users/nbonamy/src/agent-workspace',
      sessionId: 'session-dina',
      subagentId: 'child-explore',
    }, 'agent-dina');
    expect(readConversationMessages.mock.calls.at(-1)?.[0]).not.toBe(reactiveConversationRef);
    expect(state.snapshot.value).toStrictEqual(deletedSnapshot);
  });
});

function workRepository(): WorkSource {
  return {
    provider: 'github',
    id: 'nbonamy/agent-workspace',
    owner: 'nbonamy',
    name: 'agent-workspace',
    fullName: 'nbonamy/agent-workspace',
    url: 'https://github.com/nbonamy/agent-workspace',
    isPrivate: true,
  };
}
