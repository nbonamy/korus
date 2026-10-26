import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessageBox } from 'element-plus';
import type {
  CodexNativeRendererApi,
} from '@codex-app-sdk/vue';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShell from '../AppShell.vue';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import type { Agent, CreateAgentInput, SourceRepository, Team, WorkItem, WorkSource } from '@workspace/core/contracts';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import { useConfetti } from '../../shared/confetti/use-confetti';
import { setElectronTestClient } from '../../test/client';

import {
  clickPortaledMenuItem,
  mountShell as mountRealShell,
  workItem,
  workItemAssignment,
} from './app-shell-test-harness';

const mountShell: typeof mountRealShell = (overrides = {}) => mountRealShell({
  ...overrides,
  stubAgentWorkspace: true,
});

vi.mock('../image-annotation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../image-annotation')>(),
  centeredImageCropDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,centered-fallback'),
}));

vi.mock('../../shared/confetti/canvas-celebration', () => ({
  launchCanvasCelebration: vi.fn(),
}));

afterEach(() => {
  useConfetti().clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.removeItem('cockpitGlobalScope:github');
  window.sessionStorage.clear();
  document.body.innerHTML = '';
  delete window.app;
  delete (window as Window & { codexAppSdkNative?: CodexNativeRendererApi }).codexAppSdkNative;
});

describe('AppShell work routing', () => {
  it.each([
    { provider: 'gitlab' as const, remoteConnectionId: undefined },
    { provider: 'github' as const, remoteConnectionId: undefined },
    { provider: 'gitlab' as const, remoteConnectionId: 'connection-devbox' },
  ])('reopens $provider work from the selected checkout identity on host $remoteConnectionId', async ({ provider, remoteConnectionId }) => {
    const snapshot = createInitialSnapshot();
    const team = snapshot.teams[0]!;
    if (remoteConnectionId) team.remoteConnectionId = remoteConnectionId;
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'gitlab', status: 'connected' }];
    const github: WorkSource = { provider: 'github', id: 'owner/repo', name: 'repo', fullName: 'owner/repo', url: 'https://github.com/owner/repo' };
    const gitlab: WorkSource = { provider: 'gitlab', id: 'gitlab.com/group/sub/repo', name: 'repo', fullName: 'group/sub/repo', url: 'https://gitlab.com/group/sub/repo' };
    const selected = provider === 'github' ? github : gitlab;
    const identity = provider === 'github' ? `github.com/${selected.id}` : selected.id;
    if (remoteConnectionId) setElectronTestClient({ getAutomationSnapshot: async () => snapshot });
    const request = workItem({ provider, kind: 'pullRequest', id: `${selected.id}!7`, sourceId: selected.id, sourceName: selected.fullName, number: 7, title: `${provider} selected request`, branchName: 'feature/selected' });
    const listSourceRepositories = vi.fn().mockResolvedValue([{ name: 'renamed-local', path: '/code/selected', remoteIdentity: identity, worktrees: [] }]);
    const loadWorkRepositories = vi.fn(async (host: string) => host === 'github' ? [github] : [gitlab, { ...gitlab, id: 'gitlab.com/other/repo', fullName: 'other/repo', url: 'https://gitlab.com/other/repo' }]);
    const loadWorkItems = vi.fn().mockResolvedValue([request]);
    const wrapper = mountShell({ snapshot, listSourceRepositories, listSourceBranches: vi.fn().mockResolvedValue([{ name: 'main', isDefault: true }]), loadWorkRepositories, loadWorkItems,
      // An ambient same-named checkout must not override the selected host's scan.
      sourceRepositories: [{ name: 'repo', path: '/code/selected', remoteIdentity: provider === 'gitlab' ? 'github.com/owner/repo' : gitlab.id, worktrees: [] }],
      workRepositoriesByProvider: { github: [github], gitlab: [gitlab] },
    });
    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('create-agent-from-repository', { teamId: team.id, repositoryName: 'repo', repositoryRoot: '/code/selected' });
    await flushPromises();
    expect(listSourceRepositories).toHaveBeenCalledExactlyOnceWith(remoteConnectionId);
    expect(loadWorkRepositories).toHaveBeenCalledExactlyOnceWith(provider, remoteConnectionId ? { kind: 'remote', remoteConnectionId } : undefined);
    expect(loadWorkItems).toHaveBeenCalledExactlyOnceWith(provider, selected.id, remoteConnectionId ? { kind: 'remote', remoteConnectionId } : undefined, { kind: 'all', state: 'open' });
    const dialog = wrapper.getComponent({ name: 'RepositorySessionSourceDialog' });
    expect(dialog.props('selectedRepositoryId')).toBe(selected.id);
    expect(dialog.props('workItems')).toStrictEqual([request]);
    await dialog.findAll('[role="tab"]').find(tab => tab.text() === (provider === 'gitlab' ? 'Merge requests' : 'Pull requests'))!.trigger('click');
    expect(dialog.text()).toContain(request.title);
  });

  it.each([undefined, 'example.com/owner/repo'])('keeps unidentified or unsupported repository sessions branch-only (%s)', async remoteIdentity => {
    const loadWorkRepositories = vi.fn(); const loadWorkItems = vi.fn();
    const wrapper = mountShell({ listSourceRepositories: vi.fn().mockResolvedValue([{ name: 'repo', path: '/code/repo', remoteIdentity, worktrees: [] }]),
      listSourceBranches: vi.fn().mockResolvedValue([{ name: 'main', isDefault: true }]), loadWorkRepositories, loadWorkItems });
    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('create-agent-from-repository', { repositoryName: 'repo', repositoryRoot: '/code/repo' });
    await flushPromises();
    expect(loadWorkRepositories).not.toHaveBeenCalled(); expect(loadWorkItems).not.toHaveBeenCalled();
    const dialog = wrapper.getComponent({ name: 'RepositorySessionSourceDialog' });
    expect(dialog.props('selectedRepositoryId')).toBeNull(); expect(dialog.props('branches')).toStrictEqual([{ name: 'main', isDefault: true }]);
    expect(dialog.props('workItems')).toStrictEqual([]);
  });

  it('resolves a URL checkout from the owning daemon without consulting a same-named GitHub catalog', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'gitlab', status: 'connected' }];
    const source: WorkSource = { provider: 'gitlab', id: 'gitlab.com/group/sub/repo', name: 'repo', fullName: 'group/sub/repo', url: 'https://gitlab.com/group/sub/repo' };
    const checkout = { name: 'repo', path: '/code/url-repo', remoteIdentity: source.id, worktrees: [] };
    const loadWorkRepositories = vi.fn().mockResolvedValue([source]); const loadWorkItems = vi.fn().mockResolvedValue([]);
    const wrapper = mountShell({ snapshot, cloneSourceRepository: vi.fn().mockResolvedValue(checkout), listSourceRepositories: vi.fn().mockResolvedValue([checkout]),
      listSourceBranches: vi.fn().mockResolvedValue([{ name: 'main', isDefault: true }]), loadWorkRepositories, loadWorkItems });
    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('start-work', 'url');
    await flushPromises();
    wrapper.getComponent({ name: 'RepositoryAcquireDialog' }).vm.$emit('clone-url', 'git@gitlab.com:group/sub/repo.git');
    await flushPromises();
    expect(loadWorkRepositories).toHaveBeenCalledExactlyOnceWith('gitlab', undefined);
    expect(loadWorkItems).toHaveBeenCalledExactlyOnceWith('gitlab', source.id, undefined, { kind: 'all', state: 'open' });
    expect(wrapper.getComponent({ name: 'RepositorySessionSourceDialog' }).props('selectedRepositoryId')).toBe(source.id);
  });

  it('resolves a checkout outside the source folder from fresh owning-host metadata instead of its saved remote', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.folder = '/external/renamed';
    agent.workspace = { kind: 'git', folder: '/external/renamed', repositoryName: 'renamed', repositoryRoot: '/external/renamed', primaryWorktreeRoot: '/external/renamed', branch: 'main', isLinkedWorktree: false, originUrl: 'git@github.com:owner/repo.git', updatedAt: 'now' };
    const project: WorkSource = { provider: 'gitlab', id: 'gitlab.com/group/sub/repo', name: 'repo', fullName: 'group/sub/repo', url: 'https://gitlab.com/group/sub/repo' };
    const loadWorkRepositories = vi.fn().mockResolvedValue([project]); const loadWorkItems = vi.fn().mockResolvedValue([]);
    const getAgentGitWorkflow = vi.fn().mockResolvedValue({ repository: 'gitlab.com/group/sub/repo', folder: agent.folder, remote: 'origin', remoteUrl: 'git@gitlab.com:group/sub/repo.git', isLinkedWorktree: false, detached: false, ahead: 0, behind: 0, files: [], stagedFiles: [], unstagedFiles: [], githubConnected: false });
    const wrapper = mountShell({ snapshot, getAgentGitWorkflow, listSourceRepositories: vi.fn().mockResolvedValue([]), listSourceBranches: vi.fn().mockResolvedValue([]), loadWorkRepositories, loadWorkItems });
    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('create-agent-from-repository', { agentId: agent.id, repositoryName: 'renamed', repositoryRoot: '/external/renamed' });
    await flushPromises();
    expect(getAgentGitWorkflow).toHaveBeenCalledExactlyOnceWith(agent.id, { includePullRequest: false });
    expect(loadWorkItems).toHaveBeenCalledExactlyOnceWith('gitlab', project.id, undefined, { kind: 'all', state: 'open' });
  });

  it('discards a late GitLab catalog after another repository session opens', async () => {
    const snapshot = createInitialSnapshot();
    const gl: WorkSource = { provider: 'gitlab', id: 'gitlab.com/group/repo', name: 'repo', fullName: 'group/repo', url: 'https://gitlab.com/group/repo' };
    const gh: WorkSource = { provider: 'github', id: 'owner/repo', name: 'repo', fullName: 'owner/repo', url: 'https://github.com/owner/repo' };
    let resolveGitLab!: (sources: WorkSource[]) => void;
    const loadWorkRepositories = vi.fn((provider: string) => provider === 'gitlab' ? new Promise<WorkSource[]>(resolve => { resolveGitLab = resolve; }) : Promise.resolve([gh]));
    const loadWorkItems = vi.fn().mockResolvedValue([]);
    const wrapper = mountShell({ snapshot, listSourceRepositories: vi.fn().mockResolvedValue([
      { name: 'repo', path: '/code/gitlab', remoteIdentity: gl.id, worktrees: [] },
      { name: 'repo', path: '/code/github', remoteIdentity: 'github.com/owner/repo', worktrees: [] },
    ]), listSourceBranches: vi.fn().mockResolvedValue([]), loadWorkRepositories, loadWorkItems });
    const sidebar = wrapper.getComponent({ name: 'AgentSidebar' });
    sidebar.vm.$emit('create-agent-from-repository', { repositoryName: 'repo', repositoryRoot: '/code/gitlab' });
    await flushPromises();
    expect(loadWorkRepositories).toHaveBeenCalledWith('gitlab', undefined);
    sidebar.vm.$emit('create-agent-from-repository', { repositoryName: 'repo', repositoryRoot: '/code/github' });
    await flushPromises();
    resolveGitLab([gl]); await flushPromises();
    expect(wrapper.getComponent({ name: 'RepositorySessionSourceDialog' }).props('selectedRepositoryId')).toBe(gh.id);
    expect(loadWorkItems).toHaveBeenCalledExactlyOnceWith('github', gh.id, undefined, { kind: 'all', state: 'open' });
  });

  it('opens and closes the resume-session dialog for the agent selected in the sidebar menu', async () => {
    const snapshot = createInitialSnapshot();
    const targetAgent = snapshot.agents[0]!;
    const listAgentConversations = vi.fn().mockResolvedValue([]);
    const wrapper = mountShell({ snapshot, listAgentConversations });

    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('resume-session', targetAgent.id);
    await flushPromises();

    const dialog = wrapper.getComponent({ name: 'ConversationHistoryDialog' });
    expect(dialog.props('agent')).toStrictEqual(targetAgent);
    expect(listAgentConversations).toHaveBeenCalledWith(targetAgent.id, undefined);

    dialog.vm.$emit('close');
    await nextTick();
    expect(wrapper.findComponent({ name: 'ConversationHistoryDialog' }).exists()).toBe(false);
  });

  it('wires repository session actions to agent creation and source selection', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = snapshot.agents.map((agent) => ({
      ...agent,
      workspace: {
        kind: 'git' as const,
        folder: '/Users/nbonamy/src/agent-workspace',
        repositoryName: 'agent-workspace',
        repositoryRoot: '/Users/nbonamy/src/agent-workspace',
        branch: 'main',
        isLinkedWorktree: false,
        primaryWorktreeRoot: '/Users/nbonamy/src/agent-workspace',
        updatedAt: '2026-08-28T00:00:00.000Z',
      },
    }));
    const sourceRepository: SourceRepository = {
      name: 'agent-workspace',
      path: '/Users/nbonamy/src/agent-workspace',
      remoteIdentity: 'github.com/nbonamy/agent-workspace',
      worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
    };
    const githubRepository: WorkSource = {
      provider: 'github',
      id: 'nbonamy/agent-workspace',
      owner: 'nbonamy',
      name: 'agent-workspace',
      fullName: 'nbonamy/agent-workspace',
      url: 'https://github.com/nbonamy/agent-workspace',
      isPrivate: true,
    };
    const issue = workItem({
      id: 'github:nbonamy/agent-workspace#24',
      sourceId: githubRepository.id,
      sourceName: githubRepository.fullName,
      number: 24,
      title: 'Repository-first sessions',
    });
    const preparedAgent: Agent = {
      id: 'agent-prepared-issue',
      teamId: 'team-app',
      name: 'prepared-issue',
      avatar: '🤖',
      folder: '/Users/nbonamy/src/agent-workspace-fix-gh-24',
      backend: 'codex',
      backendDefaults: { kind: 'codex' },
      status: { type: 'idle' },
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    };
    const listSourceBranches = vi.fn().mockResolvedValue([
      { name: 'main', isDefault: true, worktreePath: '/Users/nbonamy/src/agent-workspace' },
      { name: 'feat/work-routing', isDefault: false },
    ]);
    const loadWorkItems = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([issue]);
    const createSourceWorktree = vi.fn().mockResolvedValue({
      name: 'work-routing',
      path: '/Users/nbonamy/src/agent-workspace-work-routing',
    });
    const createAgent = vi.fn().mockResolvedValue(preparedAgent);
    const createAgentGitBranch = vi.fn().mockResolvedValue({});
    const assignWorkItemAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      sourceRepositories: [sourceRepository],
      listSourceRepositories: vi.fn().mockResolvedValue([sourceRepository]),
      listSourceBranches,
      loadWorkItems,
      createSourceWorktree,
      createAgent,
      createAgentGitBranch,
      assignWorkItemAction,
      workRepositoriesByProvider: { github: [githubRepository] },
    });
    const sidebar = wrapper.getComponent({ name: 'AgentSidebar' });

    sidebar.vm.$emit('create-agent-on-branch', {
      agentId: 'agent-dina',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/Users/nbonamy/src/agent-workspace',
      branch: { name: 'main', isDefault: true, worktreePath: '/Users/nbonamy/src/agent-workspace' },
    });
    await flushPromises();
    expect(listSourceBranches).not.toHaveBeenCalled();
    expect(createSourceWorktree).not.toHaveBeenCalled();
    expect(createAgent).toHaveBeenCalledWith({
      name: null,
      folder: '/Users/nbonamy/src/agent-workspace',
      repositorySession: { existingBranch: 'main' },
      backend: 'codex',
      sourceRepositoryName: 'agent-workspace',
      teamId: 'team-app',
    });
    listSourceBranches.mockClear();
    createAgent.mockClear();

    sidebar.vm.$emit('create-agent-from-repository', {
      agentId: 'agent-dina',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/Users/nbonamy/src/agent-workspace',
    });
    await flushPromises();

    const sourceDialog = wrapper.getComponent({ name: 'RepositorySessionSourceDialog' });
    expect(listSourceBranches).toHaveBeenCalledWith('/Users/nbonamy/src/agent-workspace', undefined);
    expect(loadWorkItems).toHaveBeenCalledWith('github', 'nbonamy/agent-workspace', undefined, {
      kind: 'all',
      state: 'open',
    });
    expect(sourceDialog.props('branches')).toHaveLength(2);
    expect(sourceDialog.props('workItems')).toStrictEqual([]);
    expect(sourceDialog.props('selectedRepositoryId')).toBe(githubRepository.id);
    expect(sourceDialog.props('sessions')).toStrictEqual([
      { agentId: 'agent-dina', branch: 'main', label: 'Dina · main' },
      { agentId: 'agent-jesse', branch: 'main', label: 'Jesse · main' },
    ]);

    sourceDialog.vm.$emit('start-work-item', {
      action: 'investigate',
      agentId: 'agent-dina',
      destination: 'existing',
      item: issue,
    });
    await flushPromises();
    expect(createAgentGitBranch).not.toHaveBeenCalled();
    expect(assignWorkItemAction).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-dina',
      item: issue,
    }));
    expect(sourceDialog.props('visible')).toBe(false);

    sidebar.vm.$emit('create-agent-from-repository', {
      agentId: 'agent-dina',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/Users/nbonamy/src/agent-workspace',
    });
    await flushPromises();
    sourceDialog.vm.$emit('start-work-item', {
      action: 'fix',
      destination: 'new',
      item: issue,
    });
    await flushPromises();
    expect(createSourceWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'fix/gh-24',
    });
    expect(assignWorkItemAction).toHaveBeenCalledWith(expect.objectContaining({
      agentId: preparedAgent.id,
      item: issue,
    }));
    expect(sourceDialog.props('visible')).toBe(false);
    expect(wrapper.findAllComponents({ name: 'WorkspaceProvisioningProgressDialog' }).map(dialog => dialog.props('operation'))).toContainEqual(expect.objectContaining({
      mode: 'single',
      progress: expect.objectContaining({ state: 'success', createWorktree: true, branchName: 'fix/gh-24', agentId: preparedAgent.id }),
    }));

    sidebar.vm.$emit('create-agent-from-repository', {
      agentId: 'agent-dina',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/Users/nbonamy/src/agent-workspace',
    });
    await flushPromises();
    createSourceWorktree.mockClear();
    sourceDialog.vm.$emit('select-branch', { name: 'feat/work-routing', isDefault: false });
    await flushPromises();
    expect(createSourceWorktree).not.toHaveBeenCalled();
    expect(createAgent).toHaveBeenCalledWith({
      name: null,
      folder: '/Users/nbonamy/src/agent-workspace',
      repositorySession: { existingBranch: 'feat/work-routing' },
      backend: 'codex',
      sourceRepositoryName: 'agent-workspace',
      teamId: 'team-app',
    });
    expect(wrapper.getComponent({ name: 'RepositorySessionSourceDialog' }).props('visible')).toBe(false);

    createAgent.mockClear();
    sidebar.vm.$emit('create-agent-worktree-in-repository', {
      agentId: 'agent-dina',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/Users/nbonamy/src/agent-workspace',
    });
    await flushPromises();
    const worktreeDialog = wrapper.getComponent({ name: 'NewSourceWorktreeDialog' });
    expect(worktreeDialog.props('visible')).toBe(true);
    expect(worktreeDialog.props('branches')).toStrictEqual([
      { name: 'main', isDefault: true, worktreePath: '/Users/nbonamy/src/agent-workspace' },
      { name: 'feat/work-routing', isDefault: false },
    ]);
    expect(listSourceBranches).toHaveBeenLastCalledWith('/Users/nbonamy/src/agent-workspace', undefined);
    await worktreeDialog.vm.$emit('created', {
      name: 'feature-session',
      path: '/Users/nbonamy/src/agent-workspace-feature-session',
    });
    await flushPromises();
    expect(createAgent).toHaveBeenCalledWith({
      name: null,
      folder: '/Users/nbonamy/src/agent-workspace-feature-session',
      backend: 'codex',
      sourceRepositoryName: 'agent-workspace',
      teamId: 'team-app',
    });
  });

  it('creates quick chats inside the active team', async () => {
    const snapshot = createInitialSnapshot();
    const createQuickChat = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, createQuickChat });

    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('create-quick-chat');
    await flushPromises();

    expect(createQuickChat).toHaveBeenCalledWith({ teamId: 'team-app', backend: 'codex' });
  });

  it('creates a new Git project and opens an agent in it', async () => {
    const snapshot = createInitialSnapshot();
    const createProject = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealShell({ snapshot, createProject });

    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('start-work', 'new');
    await flushPromises();
    const dialog = wrapper.getComponent({ name: 'NewProjectDialog' });
    expect(dialog.props('visible')).toBe(true);

    dialog.vm.$emit('create', 'fresh-project', 'claude');
    await flushPromises();

    expect(createProject).toHaveBeenCalledWith({ name: 'fresh-project', teamId: 'team-app', backend: 'claude' });
    expect(dialog.props('visible')).toBe(false);
  });

  it('creates new Git projects on the active remote team devbox', async () => {
    const snapshot = remoteEmptyTeamSnapshot();
    const createProject = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealShell({ snapshot, createProject });

    wrapper.getComponent({ name: 'AgentEmptyState' }).vm.$emit('start-work', 'new');
    await flushPromises();
    const dialog = wrapper.getComponent({ name: 'NewProjectDialog' });
    await dialog.get('#new-project-name').setValue('fresh-project');
    await dialog.get('.app-button--primary').trigger('click');
    await flushPromises();

    expect(createProject).toHaveBeenCalledWith({ name: 'fresh-project', teamId: 'team-remote', backend: 'codex' });
  });

  it.each([
    ['a Git checkout', '/src/project', [{ name: 'trunk', isDefault: true }, { name: 'feature', isDefault: false }]],
    ['a linked worktree', '/src/project-feature', [{ name: 'feature', isDefault: false, worktreePath: '/src/project-feature' }]],
    ['a plain folder', '/src/notes', []],
    ['a canceled selection', null, []],
  ])('opens %s directly without a branch picker', async (_label, folder, branches) => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const listSourceBranches = vi.fn().mockResolvedValue(branches);
    const wrapper = mountShell({
      chooseAgentFolder: vi.fn().mockResolvedValue(folder), createAgent, listSourceBranches,
    });

    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('start-work', 'local');
    await flushPromises();

    if (folder) {
      expect(createAgent).toHaveBeenCalledExactlyOnceWith({ name: null, folder, backend: 'codex', teamId: 'team-app' });
    } else {
      expect(createAgent).not.toHaveBeenCalled();
    }
    expect(listSourceBranches).not.toHaveBeenCalled();
    expect(wrapper.getComponent({ name: 'RepositorySessionSourceDialog' }).props('visible')).toBe(false);
  });

  it('browses and opens existing folders on the active remote team devbox', async () => {
    const snapshot = remoteEmptyTeamSnapshot();
    const chooseAgentFolder = vi.fn();
    const listSourceFolders = vi.fn().mockResolvedValue({
      path: '/home/nicolas',
      parentPath: '/home',
      entries: [{ name: 'src', path: '/home/nicolas/src' }],
    });
    const listSourceBranches = vi.fn().mockResolvedValue([{ name: 'trunk', isDefault: true }]);
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealShell({
      snapshot,
      chooseAgentFolder,
      createAgent,
      listSourceBranches,
      listSourceFolders,
    });

    wrapper.getComponent({ name: 'AgentEmptyState' }).vm.$emit('start-work', 'local');
    await flushPromises();

    const folderPicker = wrapper.getComponent({ name: 'RemoteFolderPickerDialog' });
    expect(folderPicker.props('visible')).toBe(true);
    expect(folderPicker.props('remoteConnectionId')).toBe('connection-devbox');
    expect(listSourceFolders).toHaveBeenCalledWith({ remoteConnectionId: 'connection-devbox' });
    expect(chooseAgentFolder).not.toHaveBeenCalled();

    folderPicker.vm.$emit('select', '/home/nicolas/src/existing-project');
    await flushPromises();

    expect(listSourceBranches).not.toHaveBeenCalled();
    expect(wrapper.getComponent({ name: 'RepositorySessionSourceDialog' }).props('visible')).toBe(false);
    expect(createAgent).toHaveBeenCalledWith({
      name: null,
      folder: '/home/nicolas/src/existing-project',
      backend: 'codex',
      teamId: 'team-remote',
    });
  });

  it('acquires a nested GitLab project and opens its branch', async () => {
    const snapshot = createEmptySnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected', accountLabel: 'github-user' }, { provider: 'gitlab', status: 'connected', accountLabel: 'gitlab-user' }];
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const project: WorkSource = { provider: 'gitlab', id: '42', fullName: 'group/subgroup/repo', name: 'repo', url: 'https://gitlab.com/group/subgroup/repo', isPrivate: true };
    const loadWorkRepositories = vi.fn(async (_provider: import('@workspace/core/contracts').WorkProviderKind) => [project]);
    const cloneSourceRepository = vi.fn(async () => ({ name: 'repo', path: '/src/repo', worktrees: [] }));
    const listSourceBranches = vi.fn(async () => [{ name: 'main', isDefault: true, worktreePath: '/src/repo' }]);
    const createAgent = vi.fn();
    const loadWorkItems = vi.fn(async () => []);
    const wrapper = mountRealShell({ snapshot, loadWorkRepositories, cloneSourceRepository, listSourceBranches, createAgent, loadWorkItems });
    await wrapper.findAll('[role="menuitem"]').find(item => item.text() === 'GitLab repository…')!.trigger('click');
    await flushPromises();
    const acquire = wrapper.getComponent({ name: 'RepositoryAcquireDialog' });
    expect(acquire.props('connection')).toStrictEqual(snapshot.workBacklog.connections[1]);
    expect(loadWorkRepositories).toHaveBeenCalledWith('gitlab');
    await acquire.get('input').setValue('subgroup');
    await acquire.get('.repository-acquire-dialog__row').trigger('click');
    await flushPromises();
    expect(cloneSourceRepository).toHaveBeenCalledExactlyOnceWith({ url: project.url, reuseExisting: true });
    expect(listSourceBranches).toHaveBeenCalledWith('/src/repo', undefined);
    expect(wrapper.getComponent({ name: 'RepositorySessionSourceDialog' }).props('repositoryName')).toBe('repo');
    expect(loadWorkRepositories.mock.calls.every(([provider]) => provider === 'gitlab')).toBe(true);
    expect(loadWorkItems).toHaveBeenCalledWith('gitlab', project.id, undefined, { kind: 'all', state: 'open' });
    const session = wrapper.getComponent({ name: 'RepositorySessionSourceDialog' });
    expect(session.findAll('button').some(button => button.text() === 'New branch…')).toBe(false);
    await session.get('.repository-session-source-dialog__result').trigger('click');
    await flushPromises();
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ folder: '/src/repo' }));
    expect(snapshot.workBacklog.connections[0]).toStrictEqual({ provider: 'github', status: 'connected', accountLabel: 'github-user' });
  });

  it('recognizes an existing GitLab checkout when the local scan arrives after its catalog', async () => {
    const snapshot = createInitialSnapshot(); snapshot.workBacklog.connections = [{ provider: 'gitlab', status: 'connected' }];
    const project: WorkSource = { provider: 'gitlab', id: '42', name: 'repo', fullName: 'group/subgroup/repo', url: 'https://gitlab.com/group/subgroup/repo' };
    const wrapper = mountRealShell({ snapshot, loadWorkRepositories: vi.fn(async () => [project]) });
    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('start-work', 'gitlab'); await flushPromises();
    const acquire = wrapper.getComponent({ name: 'RepositoryAcquireDialog' });
    expect(acquire.get('.repository-acquire-dialog__row em').text()).toBe('Clone');
    await wrapper.setProps({ sourceRepositories: [{ name: 'renamed', path: '/src/renamed', remoteIdentity: 'gitlab.com/group/subgroup/repo', worktrees: [] }] });
    expect(acquire.get('.repository-acquire-dialog__row em').text()).toBe('Open');
  });

  it('keeps a GitLab clone attached to its team across unrelated workspace updates', async () => {
    const snapshot = createInitialSnapshot(); snapshot.workBacklog.connections = [{ provider: 'gitlab', status: 'connected' }];
    const project: WorkSource = { provider: 'gitlab', id: '42', name: 'repo', fullName: 'group/subgroup/repo', url: 'https://gitlab.com/group/subgroup/repo' };
    let release!: (repository: SourceRepository) => void;
    const cloneSourceRepository = vi.fn(() => new Promise<SourceRepository>(resolve => { release = resolve; }));
    const listSourceBranches = vi.fn(async () => []);
    const wrapper = mountRealShell({ snapshot, cloneSourceRepository, listSourceBranches, loadWorkRepositories: vi.fn(async () => [project]) });
    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('start-work', 'gitlab'); await flushPromises();
    await wrapper.getComponent({ name: 'RepositoryAcquireDialog' }).get('.repository-acquire-dialog__row').trigger('click');
    await wrapper.setProps({ snapshot: structuredClone(snapshot) }); await flushPromises();
    release({ name: 'repo', path: '/src/repo', worktrees: [] }); await flushPromises();
    expect(cloneSourceRepository).toHaveBeenCalledTimes(1);
    expect(listSourceBranches).toHaveBeenCalledWith('/src/repo', undefined);
    expect(wrapper.getComponent({ name: 'RepositorySessionSourceDialog' }).props('visible')).toBe(true);
  });

  it('finishes GitLab device authorization with selectable repository results', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'gitlab', status: 'disconnected' }];
    let release!: () => void;
    const connectWorkProvider = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const project: WorkSource = { provider: 'gitlab', id: '42', name: 'repo', fullName: 'group/subgroup/repo', url: 'https://gitlab.com/group/subgroup/repo' };
    const wrapper = mountRealShell({ snapshot, loadWorkRepositories: vi.fn(async () => [project]) });
    await wrapper.setProps({ connectWorkProvider });
    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('start-work', 'gitlab'); await flushPromises();
    const acquire = wrapper.getComponent({ name: 'RepositoryAcquireDialog' });
    await acquire.get('.repository-acquire-dialog__connect button').trigger('click');
    const connecting = structuredClone(snapshot); connecting.workBacklog.connections[1]!.status = 'connecting';
    await wrapper.setProps({ snapshot: connecting, workProviderAuthorizations: { gitlab: { provider: 'gitlab', verificationUri: 'https://gitlab.com/oauth/device', userCode: 'CODE', expiresAt: '2099-01-01T00:00:00.000Z' } } });
    release(); await flushPromises();
    const connected = structuredClone(connecting); connected.workBacklog.connections[1]!.status = 'connected';
    await wrapper.setProps({ snapshot: connected }); await flushPromises();
    expect(connectWorkProvider).toHaveBeenCalledExactlyOnceWith('gitlab');
    expect(acquire.get('.repository-acquire-dialog__row').attributes('disabled')).toBeUndefined();
  });

  it('shows catalog and Git transport failures independently and ignores dismissed provider results', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'gitlab', status: 'connected' }];
    let release!: (items: WorkSource[]) => void;
    const project: WorkSource = { provider: 'gitlab', id: '42', name: 'repo', fullName: 'group/subgroup/repo', url: 'https://gitlab.com/group/subgroup/repo' };
    const listWorkSources = vi.fn().mockRejectedValueOnce(new Error('GitLab API unavailable')).mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue([project]);
    const cloneSourceRepository = vi.fn().mockRejectedValue(new Error('Git transport authentication failed'));
    const wrapper = mountRealShell({ snapshot, listWorkSources, cloneSourceRepository });
    const sidebar = wrapper.getComponent({ name: 'AgentSidebar' });
    sidebar.vm.$emit('start-work', 'gitlab'); await flushPromises();
    const acquire = wrapper.getComponent({ name: 'RepositoryAcquireDialog' });
    expect(acquire.text()).toContain('GitLab API unavailable');
    acquire.vm.$emit('close'); await flushPromises();
    sidebar.vm.$emit('start-work', 'github'); await flushPromises();
    acquire.vm.$emit('close'); await flushPromises();
    sidebar.vm.$emit('start-work', 'gitlab'); await flushPromises();
    release([{ ...project, provider: 'github', id: 'wrong', fullName: 'wrong/repo' }]); await flushPromises();
    expect(acquire.findAll('.repository-acquire-dialog__row')).toHaveLength(1);
    expect(acquire.text()).not.toContain('wrong/repo');
    await acquire.get('.repository-acquire-dialog__row').trigger('click'); await flushPromises();
    expect(acquire.text()).toContain('Git transport authentication failed');
    expect(acquire.props('connection')).toStrictEqual({ provider: 'gitlab', status: 'connected' });
  });

  it('clones a GitHub repository before opening its contextual session picker', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected', accountLabel: 'nbonamy' }];
    const githubRepository: WorkSource = {
      provider: 'github',
      id: 'nbonamy/new-project',
      owner: 'nbonamy',
      name: 'new-project',
      fullName: 'nbonamy/new-project',
      url: 'https://github.com/nbonamy/new-project',
      isPrivate: true,
    };
    const cloneSourceRepository = vi.fn().mockResolvedValue({
      name: 'new-project',
      path: '/Users/nbonamy/src/new-project',
      worktrees: [{ name: 'main', path: '/Users/nbonamy/src/new-project' }],
    });
    const listSourceBranches = vi.fn().mockResolvedValue([
      { name: 'main', isDefault: true, worktreePath: '/Users/nbonamy/src/new-project' },
    ]);
    const wrapper = mountRealShell({
      snapshot,
      sourceRepositories: [{
        name: 'new-project',
        path: '/Users/nbonamy/src/other-new-project',
        remoteIdentity: 'github.com/another-owner/new-project',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/other-new-project' }],
      }],
      cloneSourceRepository,
      listSourceBranches,
      loadWorkRepositories: vi.fn().mockResolvedValue([githubRepository]),
    });

    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('start-work', 'github');
    await flushPromises();
    const acquire = wrapper.getComponent({ name: 'RepositoryAcquireDialog' });
    expect(acquire.props('repositories')).toStrictEqual([githubRepository]);

    acquire.vm.$emit('select-repository', githubRepository);
    await flushPromises();

    expect(cloneSourceRepository).toHaveBeenCalledWith({ url: githubRepository.url, reuseExisting: true });
    expect(listSourceBranches).toHaveBeenCalledWith('/Users/nbonamy/src/new-project', undefined);
    expect(wrapper.getComponent({ name: 'RepositorySessionSourceDialog' }).props('repositoryName')).toBe('new-project');
  });

  it('discovers and clones GitHub repositories in the active remote team location', async () => {
    const snapshot = remoteEmptyTeamSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected', accountLabel: 'nbonamy' }];
    const githubRepository: WorkSource = {
      provider: 'github',
      id: 'nbonamy/new-project',
      owner: 'nbonamy',
      name: 'new-project',
      fullName: 'nbonamy/new-project',
      url: 'https://github.com/nbonamy/new-project',
      isPrivate: true,
    };
    const loadWorkRepositories = vi.fn().mockResolvedValue([githubRepository]);
    const listSourceRepositories = vi.fn().mockResolvedValue([]);
    const cloneSourceRepository = vi.fn().mockResolvedValue({
      name: 'new-project',
      path: '/home/nicolas/src/new-project',
      worktrees: [{ name: 'main', path: '/home/nicolas/src/new-project' }],
    });
    const listSourceBranches = vi.fn().mockResolvedValue([
      { name: 'main', isDefault: true, worktreePath: '/home/nicolas/src/new-project' },
    ]);
    const wrapper = mountRealShell({
      snapshot,
      sourceRepositories: [{
        name: 'local-match-that-must-be-ignored',
        path: '/Users/nbonamy/src/new-project',
        remoteIdentity: 'github.com/nbonamy/new-project',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/new-project' }],
      }],
      cloneSourceRepository,
      listSourceBranches,
      listSourceRepositories,
      loadWorkRepositories,
    });

    wrapper.getComponent({ name: 'AgentEmptyState' }).vm.$emit('start-work', 'github');
    await flushPromises();

    expect(listSourceRepositories).toHaveBeenCalledWith('connection-devbox');
    expect(loadWorkRepositories).toHaveBeenCalledWith('github', { kind: 'remote', remoteConnectionId: 'connection-devbox' });

    wrapper.getComponent({ name: 'RepositoryAcquireDialog' }).vm.$emit('select-repository', githubRepository);
    await flushPromises();

    expect(cloneSourceRepository).toHaveBeenCalledWith({
      url: githubRepository.url,
      reuseExisting: true,
      remoteConnectionId: 'connection-devbox',
    });
    expect(listSourceBranches).toHaveBeenCalledWith(
      '/home/nicolas/src/new-project',
      'connection-devbox',
    );
  });

  it('opens the existing checkout returned by daemon acquisition', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected', accountLabel: 'nbonamy' }];
    const githubRepository: WorkSource = {
      provider: 'github',
      id: 'nbonamy/existing-project',
      owner: 'nbonamy',
      name: 'existing-project',
      fullName: 'nbonamy/existing-project',
      url: 'https://github.com/nbonamy/existing-project',
      isPrivate: true,
    };
    const cloneSourceRepository = vi.fn().mockResolvedValue({ name: 'renamed-locally', path: '/Users/nbonamy/src/renamed-locally', worktrees: [] });
    const listSourceBranches = vi.fn().mockResolvedValue([]);
    const wrapper = mountShell({
      snapshot,
      sourceRepositories: [{
        name: 'renamed-locally',
        path: '/Users/nbonamy/src/renamed-locally',
        remoteIdentity: 'github.com/nbonamy/existing-project',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/renamed-locally' }],
      }],
      cloneSourceRepository,
      listSourceBranches,
      loadWorkRepositories: vi.fn().mockResolvedValue([githubRepository]),
    });

    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('start-work', 'github');
    await flushPromises();
    wrapper.getComponent({ name: 'RepositoryAcquireDialog' }).vm.$emit('select-repository', githubRepository);
    await flushPromises();

    expect(cloneSourceRepository).toHaveBeenCalledWith({ url: githubRepository.url, reuseExisting: true });
    expect(listSourceBranches).toHaveBeenCalledWith('/Users/nbonamy/src/renamed-locally', undefined);
  });

  it('persists cockpit backlog repository and tag configuration', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    const configureWorkBacklog = vi.fn().mockResolvedValue(undefined);
    const loadWorkItems = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      configureWorkBacklog,
      loadWorkItems,
      workRepositoriesByProvider: {
        github: [{
          provider: 'github',
          id: 'nbonamy/agent-workspace',
          owner: 'nbonamy',
          name: 'agent-workspace',
          fullName: 'nbonamy/agent-workspace',
          url: 'https://github.com/nbonamy/agent-workspace',
          isPrivate: true,
        }],
      },
      workItemsByRepository: {
        'github:nbonamy/agent-workspace': [workItem()],
      },
    });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    const backlog = wrapper.findComponent({ name: 'BacklogView' });
    backlog.vm.$emit('select-work-repository', 'nbonamy/agent-workspace');
    backlog.vm.$emit('select-work-assignee', 'nbonamy');
    backlog.vm.$emit('select-work-tag', 'bug');
    await flushPromises();

    expect(configureWorkBacklog).toHaveBeenNthCalledWith(1, {
      provider: 'github',
      configuration: {
        sourceId: 'nbonamy/agent-workspace',
        assigneeLogin: null,
        tagName: null,
      },
    });
    expect(configureWorkBacklog).toHaveBeenNthCalledWith(2, {
      provider: 'github',
      configuration: {
        sourceId: 'nbonamy/agent-workspace',
        assigneeLogin: 'nbonamy',
        tagName: null,
      },
    });
    expect(configureWorkBacklog).toHaveBeenNthCalledWith(3, {
      provider: 'github',
      configuration: {
        sourceId: 'nbonamy/agent-workspace',
        assigneeLogin: 'nbonamy',
        tagName: 'bug',
      },
    });
    expect(loadWorkItems).toHaveBeenCalledWith('github', 'nbonamy/agent-workspace');
  });

  it('confirms before assigning an already assigned cockpit work item to another agent', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const snapshot = createInitialSnapshot();
    const item = workItem();
    snapshot.workBacklog.assignments = {
      [workItemAssignmentKey(item)]: workItemAssignment(item, 'agent-jesse'),
    };
    const wrapper = mountShell({ snapshot });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    wrapper.findComponent({ name: 'BacklogView' }).vm.$emit('assign-work-item', {
      agentId: 'agent-dina',
      item,
    });
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(
      "GitHub #12 is already assigned to Jesse. We don't know if Jesse is still working on it. Assign it to Dina anyway?",
      'Assign anyway?',
      {
        cancelButtonText: 'Cancel',
        confirmButtonText: 'Assign Anyway',
        type: 'warning',
      },
    );
    expect(wrapper.emitted('assign-work-item')).toStrictEqual([[{
      agentId: 'agent-dina',
      item,
    }]]);
  });

  it('keeps an assigned cockpit work item on the current agent when overriding is canceled', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'));
    const snapshot = createInitialSnapshot();
    const item = workItem();
    snapshot.workBacklog.assignments = {
      [workItemAssignmentKey(item)]: workItemAssignment(item, 'agent-jesse'),
    };
    const wrapper = mountShell({ snapshot });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    wrapper.findComponent({ name: 'BacklogView' }).vm.$emit('assign-work-item', {
      agentId: 'agent-dina',
      item,
    });
    await flushPromises();

    expect(wrapper.emitted('assign-work-item')).toBeUndefined();
  });

  it('shows the empty agent page when the active team has no agents', async () => {
    const snapshot = createEmptySnapshot();
    const connectWorkProvider = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: null,
        isLoading: false,
        isSending: false,
        connectWorkProvider,
      },
      global: {
        },
    });

    expect(wrapper.text()).toContain(`Welcome to ${product.name}`);
    expect(wrapper.text()).toContain('Choose a source to start a session');
    expect(wrapper.find('.agent-header').exists()).toBe(false);
    expect(wrapper.find('.agent-sidebar').exists()).toBe(true);
    expect(wrapper.find('.conversation-pane').exists()).toBe(false);
    expect(wrapper.find('.agent-sidebar__new').exists()).toBe(false);

    await wrapper.findAll('[role="menuitem"]')
      .find((action) => action.text() === 'GitHub repository…')!
      .trigger('click');
    await flushPromises();

    const acquireDialog = wrapper.getComponent({ name: 'RepositoryAcquireDialog' });
    expect(acquireDialog.props('visible')).toBe(true);
    expect(acquireDialog.props('mode')).toBe('github');
    expect(acquireDialog.props('connection')).toStrictEqual({ provider: 'github', status: 'disconnected' });
    expect(acquireDialog.text()).toContain('Connect GitHub');

    acquireDialog.vm.$emit('connect');
    await flushPromises();
    expect(connectWorkProvider).toHaveBeenCalledWith('github');

    const connectedSnapshot = structuredClone(snapshot);
    connectedSnapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    await wrapper.setProps({ snapshot: connectedSnapshot });
    await flushPromises();

    expect(acquireDialog.props('loading')).toBe(true);
    expect(acquireDialog.text()).toContain('Loading repositories…');
    expect(acquireDialog.text()).not.toContain('No matching repositories.');
  });

  it('assigns a ticket to a new agent and can create a ticket-named team', async () => {
    const snapshot = createInitialSnapshot();
    const item = workItem();
    const createdTeam: Team = {
      id: 'team-github-12',
      name: 'GitHub #12',
      color: '#1B4FB2',
      agentIds: [],
    };
    const createdAgent: Agent = {
      id: 'agent-issue',
      teamId: 'team-github-12',
      name: 'issue-agent',
      avatar: '🤖',
      folder: '/Users/nbonamy/src/issue-agent',
      backend: 'codex',
      backendDefaults: { kind: 'codex' },
      status: { type: 'idle' },
      createdAt: '2026-06-09T12:00:00.000Z',
      updatedAt: '2026-06-09T12:00:00.000Z',
    };
    const createTeam = vi.fn().mockResolvedValue(createdTeam);
    const createAgent = vi.fn().mockResolvedValue(createdAgent);
    const createSourceWorktree = vi.fn().mockResolvedValue({
      name: 'fix-gh-12',
      path: '/Users/nbonamy/src/agent-workspace-fix-gh-12',
    });
    const wrapper = mountShell({
      snapshot,
      createAgent,
      createSourceWorktree,
      createTeam,
      listSourceWorktrees: vi.fn().mockResolvedValue([{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }]),
      sourceRepositories: [{
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        remoteIdentity: 'github.com/nbonamy/agent-workspace',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
      }],
    });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    wrapper.findComponent({ name: 'BacklogView' }).vm.$emit('assign-work-item-to-new-agent', { item });
    await flushPromises();

    const agentDialog = wrapper.findComponent({ name: 'AgentDialog' });
    expect(agentDialog.find('#agent-dialog-team').exists()).toBe(true);
    expect(agentDialog.props()).toMatchObject({
      initialAgentName: '',
      initialNewWorktreeBranchName: 'fix/gh-12',
      initialSourceRepositoryName: 'agent-workspace',
    });

    const clientNavigationSelectTeam = agentDialog.findAllComponents({ name: 'ElSelect' }).find((select) => (
      select.find('#agent-dialog-team').exists()
    ));
    await clientNavigationSelectTeam?.vm.$emit('update:modelValue', '__new_team__');
    await nextTick();
    expect(agentDialog.get<HTMLInputElement>('[aria-label="New team name"]').element.value).toBe('GitHub #12');
    expect(agentDialog.getComponent({ name: 'NewSourceWorktreeDialog' }).props('visible')).toBe(false);
    await agentDialog.find('.app-dialog__footer .app-button--primary').trigger('click');
    await flushPromises();

    expect(createSourceWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'fix/gh-12',
    });
    expect(createTeam).toHaveBeenCalledWith({
      name: 'GitHub #12',
      color: '#1B4FB2',
    });
    expect(createAgent).toHaveBeenCalledWith({
      name: null,
      folder: '/Users/nbonamy/src/agent-workspace-fix-gh-12',
      backend: 'codex',
      sourceRepositoryName: 'agent-workspace',
      teamId: 'team-github-12',
    });
    expect(wrapper.emitted('assign-work-item')).toStrictEqual([[{
      agentId: 'agent-issue',
      item,
    }]]);
  });

  it('launches selected Cockpit work in automatic named worktrees and the selected team', async () => {
    const snapshot = createInitialSnapshot();
    const first = workItem();
    const second = { ...workItem(), id: 'nbonamy/agent-workspace#13', number: 13, title: 'Second issue' };
    const createSourceWorktree = vi.fn().mockImplementation(async ({ branchName }: { branchName: string }) => ({
      name: branchName.replace('/', '-'),
      path: `/Users/nbonamy/src/agent-workspace-${branchName.replace('/', '-')}`,
    }));
    const createAgent = vi.fn().mockImplementation(async (input: CreateAgentInput) => ({
      id: `agent-${input.name}`,
      teamId: input.teamId,
      name: input.name,
      avatar: input.avatar,
      folder: input.folder,
      backend: input.backend,
      backendDefaults: { kind: 'codex' as const },
      status: { type: 'idle' as const },
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    }));
    const assignWorkItemAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      assignWorkItemAction,
      createAgent,
      createSourceWorktree,
      sourceRepositories: [{
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        remoteIdentity: 'github.com/nbonamy/agent-workspace',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
      }],
    });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    const startWorkItemsAction = wrapper.findComponent({ name: 'BacklogView' }).props('startWorkItemsAction') as (input: {
      action: 'investigate' | 'fix'; items: WorkItem[]; teamId: string; backend?: Agent['backend'];
    }) => Promise<void>;
    await startWorkItemsAction({ action: 'fix', items: [first, second], teamId: 'team-app', backend: 'claude' });

    expect(createSourceWorktree).toHaveBeenNthCalledWith(1, {
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'fix/gh-12',
    });
    expect(createSourceWorktree).toHaveBeenNthCalledWith(2, {
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'fix/gh-13',
    });
    expect(createAgent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      backend: 'claude',
      name: null,
      folder: '/Users/nbonamy/src/agent-workspace-fix-gh-12',
      sourceRepositoryName: 'agent-workspace',
      teamId: 'team-app',
    }));
    expect(createAgent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      backend: 'claude',
      name: null,
      folder: '/Users/nbonamy/src/agent-workspace-fix-gh-13',
      sourceRepositoryName: 'agent-workspace',
      teamId: 'team-app',
    }));
    expect(assignWorkItemAction).toHaveBeenCalledTimes(2);
    expect(assignWorkItemAction.mock.calls[0]?.[0].prompt).toContain('Fix this GitHub issue');
  });

  it('resolves globally listed pull request branches only when selected work starts', async () => {
    const snapshot = createInitialSnapshot();
    const listedItem = workItem({
      id: 'nbonamy/agent-workspace#38',
      kind: 'pullRequest',
      number: 38,
      title: 'Paginate the Cockpit backlog',
    });
    const resolvedItem = { ...listedItem, branchName: 'feature/paginated-cockpit' };
    const loadWorkItems = vi.fn().mockResolvedValue([resolvedItem]);
    const createSourceWorktree = vi.fn().mockResolvedValue({
      name: 'feature-paginated-cockpit',
      path: '/Users/nbonamy/src/agent-workspace-feature-paginated-cockpit',
    });
    const createAgent = vi.fn().mockResolvedValue({
      id: 'agent-pr-38',
      teamId: 'team-app',
      name: 'agent-workspace - gh-38',
      avatar: '🤖',
      folder: '/Users/nbonamy/src/agent-workspace-feature-paginated-cockpit',
      backend: 'codex',
      backendDefaults: { kind: 'codex' },
      status: { type: 'idle' },
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    const assignWorkItemAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      assignWorkItemAction,
      createAgent,
      createSourceWorktree,
      loadWorkItems,
      sourceRepositories: [{
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        remoteIdentity: 'github.com/nbonamy/agent-workspace',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
      }],
    });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    const startWorkItemsAction = wrapper.findComponent({ name: 'BacklogView' }).props('startWorkItemsAction') as (input: {
      action: 'investigate' | 'fix'; items: WorkItem[]; teamId: string;
    }) => Promise<void>;
    await startWorkItemsAction({ action: 'fix', items: [listedItem], teamId: 'team-app' });

    expect(loadWorkItems).toHaveBeenCalledWith('github', 'nbonamy/agent-workspace', undefined, {
      kind: 'pullRequest',
      state: 'all',
    });
    expect(createSourceWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'feature/paginated-cockpit',
    });
    expect(assignWorkItemAction).toHaveBeenCalledWith(expect.objectContaining({ item: resolvedItem }));
  });


  it('opens the new team dialog from the team rail and forwards create requests', async () => {
    const snapshot = createInitialSnapshot();
    const createTeam = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      createTeam,
    });

    await wrapper.get('[aria-label="Create team"]').trigger('click');

    expect(wrapper.text()).toContain('Create Team');
    await wrapper.get('#team-dialog-name').setValue('Skwad Core');
    await wrapper.findAll('.team-dialog__color')[10]?.trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === 'Create Team')?.trigger('click');

    expect(createTeam).toHaveBeenCalledWith({
      name: 'Skwad Core',
      color: '#46A857',
    });
  });

  it('opens settings on General, remembers the last settings pane, updates appearance, and quits', async () => {
    setElectronTestClient({});
    const snapshot = createInitialSnapshot();
    snapshot.accountRateLimits = {
      limitId: 'codex',
      limitName: 'Codex',
      primary: {
        usedPercent: 41,
        windowDurationMins: 300,
        resetsAt: null,
      },
      secondary: null,
      credits: null,
      individualLimit: null,
      planType: 'pro',
      rateLimitReachedType: null,
    };
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const quit = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, updateSettings, quit });

    expect(wrapper.text()).toContain('59%');
    await wrapper.findAll('button').find((button) => {
      const label = button.find('.app-menu__label');
      return label.exists() && label.text() === 'Settings';
    })?.trigger('click');
    expect(wrapper.find('.settings-view').exists()).toBe(true);
    expect(wrapper.find('.agent-sidebar').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Settings menu"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[aria-label="Settings menu"]').classes()).toContain('settings-menu__trigger--active');
    expect(wrapper.get(`[aria-label="${product.defaultTeamName}"]`).attributes('aria-pressed')).toBe('false');
    expect(wrapper.get(`[aria-label="${product.defaultTeamName}"]`).classes()).not.toContain('team-rail__team--active');
    expect(wrapper.text()).toContain('Accessibility');
    expect(wrapper.text()).not.toContain('Launch ChatGPT');
    expect(wrapper.text()).not.toContain('Theme');

    await wrapper.findAll('.el-menu-item').find((item) => item.text() === 'Appearance')?.trigger('click');
    expect(wrapper.text()).toContain('Theme');
    expect(wrapper.text()).toContain(`${product.name} Light`);

    await wrapper.get('[aria-label="Cockpit"]').trigger('click');
    expect(wrapper.find('.settings-view').exists()).toBe(false);

    await wrapper.findAll('button').find((button) => {
      const label = button.find('.app-menu__label');
      return label.exists() && label.text() === 'Settings';
    })?.trigger('click');
    expect(wrapper.text()).toContain('Theme');
    expect(wrapper.text()).toContain(`${product.name} Light`);

    await wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'github-dark');
    await wrapper.findAll('button').find((button) => button.text() === 'Quit')?.trigger('click');

    expect(updateSettings).toHaveBeenCalledWith({ theme: { id: 'github-dark' } });
    expect(quit).toHaveBeenCalledOnce();
  });

  it('opens the edit team dialog from the team menu and forwards updates', async () => {
    const snapshot = createInitialSnapshot();
    const updateTeam = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      updateTeam,
    });

    await wrapper.get(`[aria-label="${product.defaultTeamName}"]`).trigger('contextmenu');
    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Edit Team')?.trigger('click');

    expect(wrapper.text()).toContain('Edit Team');
    await wrapper.get('#team-dialog-name').setValue('Skwad Core');
    await wrapper.findAll('.team-dialog__color')[10]?.trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === 'Save')?.trigger('click');

    expect(updateTeam).toHaveBeenCalledWith({
      id: 'team-app',
      name: 'Skwad Core',
      color: '#46A857',
    });
  });

  it('confirms before forwarding close team requests', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const snapshot = createInitialSnapshot();
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      avatar: 'SK',
      color: '#46A857',
      agentIds: [],
    });
    const wrapper = mountShell({ snapshot });

    await wrapper.get('[aria-label="Skwad"]').trigger('contextmenu');
    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Close Team')?.trigger('click');
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(
      `Agents, missions and quick chats will be removed from ${product.name}. Mission worktrees will not be deleted.`,
      'Close Skwad?',
      {
        cancelButtonText: 'Cancel',
        confirmButtonText: 'Close Team',
        type: 'warning',
      },
    );
    expect(wrapper.emitted('close-team')).toStrictEqual([['team-skwad']]);
  });

  it('does not close a team when confirmation is canceled', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'));
    const snapshot = createInitialSnapshot();
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      avatar: 'SK',
      color: '#46A857',
      agentIds: [],
    });
    const wrapper = mountShell({ snapshot });

    await wrapper.get('[aria-label="Skwad"]').trigger('contextmenu');
    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Close Team')?.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('close-team')).toBeUndefined();
  });

  it('opens the edit agent dialog from the sidebar context menu and forwards updates', async () => {
    const snapshot = createInitialSnapshot();
    const updateAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      realAgentSidebar: true,
      snapshot,
      updateAgent,
    });

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu', {
      clientX: 120,
      clientY: 80,
    });
    await clickPortaledMenuItem('Rename agent');

    expect(wrapper.text()).toContain('Rename agent');
    await wrapper.get('#agent-dialog-name').setValue('Dina Prime');
    await wrapper.findAll('button').find((button) => button.text() === 'Rename')?.trigger('click');

    expect(updateAgent).toHaveBeenCalledWith({
      id: 'agent-dina',
      name: 'Dina Prime',
    });
  });

  it('forwards agent context menu action intents', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const wrapper = mountShell({ snapshot, realAgentSidebar: true });

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu', {
      clientX: 120,
      clientY: 80,
    });
    await clickPortaledMenuItem('Duplicate Agent');

    expect(wrapper.emitted('duplicate-agent')).toStrictEqual([['agent-dina']]);

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu');
    await clickPortaledMenuItem('Fork Agent');

    expect(wrapper.emitted('fork-agent')).toStrictEqual([['agent-dina']]);

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu', {
      clientX: 120,
      clientY: 80,
    });
    await clickPortaledMenuItem('Restart Agent');

    expect(wrapper.emitted('restart-agent')).toStrictEqual([['agent-dina']]);
  });
});

function remoteEmptyTeamSnapshot() {
  const snapshot = createInitialSnapshot();
  snapshot.remoteConnections.connections = [{ id: 'connection-devbox', kind: 'ssh', host: 'devbox', name: 'Devbox', status: 'ready', createdAt: '', updatedAt: '',
    providerConnections: [{ backend: 'codex', installed: true, connected: true, checking: false }],
  }];
  snapshot.teams = [{
    id: 'team-remote',
    name: 'Devbox',
    color: 'blue',
    agentIds: [],
    remoteConnectionId: 'connection-devbox',
    remoteTeamId: 'remote-team',
  }];
  snapshot.agents = [];
  snapshot.activeTeamId = 'team-remote';
  snapshot.activeAgentId = null;
  return snapshot;
}
