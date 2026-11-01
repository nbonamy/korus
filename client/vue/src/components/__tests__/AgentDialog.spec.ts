import { product } from '@workspace/core/product';
import { mountProvisioningHost } from './provisioning-host';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, nextTick } from 'vue';
import { backendChoicesKey } from '../backend-selection';
import { describe, expect, it, vi } from 'vitest';
import AgentDialog from '../AgentDialog.vue';
import type { Agent, CreateAgentInput, SourceFolderListing, SourceFolderListInput, SourceRepository, SourceWorktree, Team, UpdateAgentInput } from '@workspace/core/contracts';

const idleAgent: Agent = {
  id: 'agent-dina',
  name: 'Dina',
  avatar: 'DI',
  folder: '/Users/nbonamy/src/agent-workspace',
  backend: 'codex',
  backendDefaults: { kind: 'codex' },
  status: { type: 'idle' },
  createdAt: '2026-06-05T00:00:00.000Z',
  updatedAt: '2026-06-05T00:00:00.000Z',
};

describe('AgentDialog', () => {
  it('leads with repository selection and hides coding-agent selection by default', () => {
    const wrapper = mountDialog();

    expect(wrapper.get('.app-form-dialog__header').text()).toContain('New agent');
    expect(wrapper.get('.app-dialog__title').text()).toBe('New agent');
    expect(wrapper.find('.app-dialog__subtitle').exists()).toBe(false);
    expect(wrapper.findAll('.app-form-dialog__label').map((label) => label.text())).toStrictEqual([
      'Repository',
      'Name',
    ]);
    expect(wrapper.text()).not.toContain('Workspace');
    expect(wrapper.text()).not.toContain('Identity');
    expect(wrapper.text()).not.toContain('Workspace folder');
    expect(wrapper.text()).not.toContain('Pick from ~/src.');
    expect(wrapper.text()).toContain('Repository');
    expect(wrapper.text()).not.toContain('Checkout');
    expect(wrapper.get('[aria-label="Agent name"]').attributes('aria-label')).toBe('Agent name');
    expect(wrapper.find('.agent-avatar-picker').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Resolved path');
    expect(wrapper.text()).not.toContain('Coding agent');
    expect(wrapper.find('#agent-dialog-backend').exists()).toBe(false);
    expect(wrapper.find('.app-form-dialog__footer-left').exists()).toBe(false);
    expect(wrapper.get('#agent-dialog-name').attributes('placeholder')).toBe('Optional');
    expect(wrapper.findAllComponents({ name: 'ElOption' })[0]?.props('label')).toBe('Choose folder...');
    expect(wrapper.findAll('.app-dialog__footer .app-button').map((button) => button.classes())).toStrictEqual([
      ['app-button', 'app-button--tertiary'],
      ['app-button', 'app-button--primary'],
    ]);
    expect(saveButton(wrapper).attributes()).toHaveProperty('disabled');
  });

  it('offers Claude Code when the experimental setting is enabled', () => {
    const wrapper = mountDialog({ claudeCodeEnabled: true });

    expect(wrapper.find('.app-form-dialog__footer-left [aria-label="Coding agent"]').exists()).toBe(true);
    expect(wrapper.find('form [aria-label="Coding agent"]').exists()).toBe(false);
    expect(wrapper.findAllComponents({ name: 'ElOption' }).map((option) => option.props('label'))).toEqual(expect.arrayContaining([
      'Codex',
      'Claude Code',
    ]));
  });

  it('creates an unnamed agent from the chosen folder', async () => {
    const chooseAgentFolder = vi.fn().mockResolvedValue('/Users/nbonamy/src/new-agent');
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({ chooseAgentFolder, createAgent });

    await chooseCustomFolder(wrapper);
    await saveButton(wrapper).trigger('click');

    expect(createAgent).toHaveBeenCalledWith({ name: null, folder: '/Users/nbonamy/src/new-agent', selection: { ...{ backend: 'codex' } } });
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });

  it('keeps a typed name when choosing a folder', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({
      chooseAgentFolder: vi.fn().mockResolvedValue('/Users/nbonamy/src/new-agent'),
      createAgent,
    });

    await wrapper.get('#agent-dialog-name').setValue('Custom Agent');
    await chooseCustomFolder(wrapper);
    await saveButton(wrapper).trigger('click');

    expect(createAgent).toHaveBeenCalledWith({ name: 'Custom Agent', folder: '/Users/nbonamy/src/new-agent', selection: { ...{ backend: 'codex' } } });
  });

  it('creates a Claude Code agent when selected', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({
      claudeCodeEnabled: true,
      chooseAgentFolder: vi.fn().mockResolvedValue('/Users/nbonamy/src/claude-agent'),
      createAgent,
    });

    await chooseCustomFolder(wrapper);
    await emitSelect(wrapper, 'agent-dialog-backend', 'claude');
    await saveButton(wrapper).trigger('click');

    expect(createAgent).toHaveBeenCalledWith({ name: null, folder: '/Users/nbonamy/src/claude-agent', selection: { ...{ backend: 'claude' } } });
  });

  it('keeps the folder empty when folder selection is cancelled', async () => {
    const wrapper = mountDialog({
      chooseAgentFolder: vi.fn().mockResolvedValue(null),
    });

    await wrapper.get('#agent-dialog-name').setValue('Waiting');
    await chooseCustomFolder(wrapper);

    expect(wrapper.get<HTMLInputElement>('[aria-label="Agent name"]').element.value).toBe('Waiting');
    expect(saveButton(wrapper).attributes()).toHaveProperty('disabled');
  });

  it('edits only the optional name of an idle agent', async () => {
    const chooseAgentFolder = vi.fn().mockResolvedValue('/Users/nbonamy/src/agent-workspace-next');
    const updateAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({
      agent: idleAgent,
      chooseAgentFolder,
      mode: 'edit',
      sourceRepositories: [{
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
      }],
      updateAgent,
    });

    expect(wrapper.get('.app-form-dialog__header').text()).toContain('Rename agent');
    expect(wrapper.find('label[for="agent-dialog-name"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Repository');
    expect(wrapper.text()).not.toContain('Work in...');
    expect(wrapper.findComponent({ name: 'ElSelect' }).exists()).toBe(false);
    expect((wrapper.get('#agent-dialog-name').element as HTMLInputElement).value).toBe('Dina');
    expect(wrapper.get('#agent-dialog-name').attributes('placeholder')).toBe('agent-workspace');
    await wrapper.get('#agent-dialog-name').setValue('Dina Prime');
    await saveButton(wrapper).trigger('click');

    expect(chooseAgentFolder).not.toHaveBeenCalled();
    expect(updateAgent).toHaveBeenCalledWith({
      id: 'agent-dina',
      name: 'Dina Prime',
    });
  });

  it('clears the name in place and restores the default only after saving', async () => {
    const updateAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({
      agent: {
        ...idleAgent,
        backend: 'claude',
        backendDefaults: { kind: 'claude' },
      },
      mode: 'edit',
      updateAgent,
    });

    expect(wrapper.text()).not.toContain('Backend');
    expect(wrapper.text()).not.toContain('Claude Code');
    await wrapper.get('button[aria-label="Clear text"]').trigger('click');
    await flushPromises();

    expect(wrapper.get<HTMLInputElement>('#agent-dialog-name').element.value).toBe('');
    expect(updateAgent).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.findAll('.app-dialog__footer button').map((button) => button.text())).toStrictEqual(['Cancel', 'Rename']);
    await saveButton(wrapper).trigger('click');

    expect(updateAgent).toHaveBeenCalledWith({
      id: 'agent-dina',
      name: null,
    });
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });

  it('creates ticket-driven agents in a selected or new team', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({
      chooseAgentFolder: vi.fn().mockResolvedValue('/Users/nbonamy/src/issue-agent'),
      createAgent,
      initialNewTeamName: 'GitHub #12',
      initialTeamId: 'team-app',
      showTeamField: true,
      teams: [{
        id: 'team-app',
        name: `${product.name}`,
        color: '#1B4FB2',
        agentIds: [],
      }],
    });

    await chooseCustomFolder(wrapper);
    await emitSelect(wrapper, 'agent-dialog-team', '__new_team__');
    await nextTick();

    const newTeamInput = wrapper.get<HTMLInputElement>('[aria-label="New team name"]');
    expect(newTeamInput.element.value).toBe('GitHub #12');

    await saveButton(wrapper).trigger('click');

    expect(createAgent).toHaveBeenCalledWith({ name: null, folder: '/Users/nbonamy/src/issue-agent', newTeamName: 'GitHub #12', selection: { ...{ backend: 'codex' } } });
  });

  it('creates ticket-driven agents in an existing selected team', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({
      chooseAgentFolder: vi.fn().mockResolvedValue('/Users/nbonamy/src/existing-team-agent'),
      createAgent,
      initialTeamId: 'team-skwad',
      showTeamField: true,
      teams: [
        {
          id: 'team-app',
          name: `${product.name}`,
          color: '#1B4FB2',
          agentIds: [],
        },
        {
          id: 'team-skwad',
          name: 'Skwad',
          color: '#46A857',
          agentIds: [],
        },
      ],
    });

    await chooseCustomFolder(wrapper);
    await saveButton(wrapper).trigger('click');

    expect(createAgent).toHaveBeenCalledWith({ name: null, folder: '/Users/nbonamy/src/existing-team-agent', teamId: 'team-skwad', selection: { ...{ backend: 'codex' } } });
  });

  it('allows renaming non-idle agents', async () => {
    const updateAgent = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({
      agent: {
        ...idleAgent,
        status: { type: 'working', detail: 'Running tests' },
      },
      mode: 'edit',
      updateAgent,
    });

    expect(wrapper.text()).not.toContain('Agent must be idle before editing.');
    await wrapper.get('#agent-dialog-name').setValue('Dina Live');
    await saveButton(wrapper).trigger('click');

    expect(updateAgent).toHaveBeenCalledWith({ id: 'agent-dina', name: 'Dina Live' });
  });

  it('keeps dialog open and shows errors from create/update failures', async () => {
    const createAgent = vi.fn().mockRejectedValue(new Error('Agent folder must be a directory.'));
    const wrapper = mountDialog({
      chooseAgentFolder: vi.fn().mockResolvedValue('/tmp/not-a-folder'),
      createAgent,
    });

    await chooseCustomFolder(wrapper);
    await wrapper.get('#agent-dialog-name').setValue('Broken');
    await saveButton(wrapper).trigger('click');

    expect(wrapper.text()).toContain('Agent folder must be a directory.');
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('shows folder selection errors and closes from dialog visibility changes', async () => {
    const wrapper = mountDialog({
      chooseAgentFolder: vi.fn().mockRejectedValue('Folder dialog failed.'),
    });

    await chooseCustomFolder(wrapper);
    await flushPromises();

    expect(wrapper.text()).toContain('Folder dialog failed.');

    await wrapper.findComponent({ name: 'ElDialog' }).vm.$emit('update:modelValue', false);

    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });

  it('creates an agent from discovered source repositories and worktrees', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const repositories: SourceRepository[] = [{
      name: 'agent-workspace',
      path: '/Users/nbonamy/src/agent-workspace',
      worktrees: [
        { name: 'main', path: '/Users/nbonamy/src/agent-workspace' },
        { name: 'source-folder', path: '/Users/nbonamy/src/agent-workspace-source-folder' },
      ],
    }];
    const wrapper = mountDialog({
      createAgent,
      sourceFolderPath: '~/src',
      sourceRepositories: repositories,
    });

    expect(wrapper.text()).toContain('Work in...');
    expect(wrapper.findAllComponents({ name: 'ElOption' })[0]?.props('label')).toBe('Choose folder...');
    expect(wrapper.text()).not.toContain('Resolved path');
    await emitSelect(wrapper, 'agent-dialog-repository', '/Users/nbonamy/src/agent-workspace');
    await nextTick();
    await emitSelect(wrapper, 'agent-dialog-worktree', '/Users/nbonamy/src/agent-workspace-source-folder');
    await nextTick();
    expect(wrapper.get('#agent-dialog-name').attributes('placeholder')).toBe('source-folder');
    await saveButton(wrapper).trigger('click');

    expect(createAgent).toHaveBeenCalledWith({ name: null, folder: '/Users/nbonamy/src/agent-workspace-source-folder', sourceRepositoryName: 'agent-workspace', selection: { ...{ backend: 'codex' } } });
  });

  it('prefers an explicitly requested repository for quick agent creation', async () => {
    const repositories: SourceRepository[] = [
      {
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
      },
      {
        name: 'mediastation',
        path: '/Users/nbonamy/src/mediastation',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/mediastation' }],
      },
    ];
    const wrapper = mountDialog({
      initialSourceRepositoryName: 'mediastation',
      sourceRecentRepoNames: ['agent-workspace'],
      sourceRepositories: repositories,
    });
    await flushPromises();

    expect(wrapper.findAllComponents({ name: 'ElSelect' })[0]?.props('modelValue')).toBe('/Users/nbonamy/src/mediastation');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Agent name"]').element.value).toBe('');
  });

  it('prefills ticket-driven agent identity and creates its named worktree automatically', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const createSourceWorktree = vi.fn().mockResolvedValue({
      name: 'fix-gh-24',
      path: '/Users/nbonamy/src/agent-workspace-fix-gh-24',
    });
    const wrapper = mountDialog({
      createAgent,
      createSourceWorktree,
      initialAgentName: 'agent-workspace - gh-24',
      initialNewWorktreeBranchName: 'fix/gh-24',
      initialSourceRepositoryName: 'agent-workspace',
      sourceRepositories: [{
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
      }],
    });

    await flushPromises();

    expect(wrapper.findAllComponents({ name: 'ElSelect' })[0]?.props('modelValue')).toBe('/Users/nbonamy/src/agent-workspace');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Agent name"]').element.value).toBe('agent-workspace - gh-24');
    expect(wrapper.findAllComponents({ name: 'ElSelect' })[1]?.props()).toMatchObject({
      disabled: true,
      modelValue: '__pending_initial_worktree__',
    });
    expect(wrapper.findAllComponents({ name: 'ElOption' }).some((option) => (
      option.props('label') === 'fix/gh-24 (new worktree)'
    ))).toBe(true);
    expect(wrapper.getComponent({ name: 'NewSourceWorktreeDialog' }).props('visible')).toBe(false);

    await saveButton(wrapper).trigger('click');
    await flushPromises();

    expect(createSourceWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'fix/gh-24',
    });
    expect(createAgent).toHaveBeenCalledWith({ name: 'agent-workspace - gh-24', folder: '/Users/nbonamy/src/agent-workspace-fix-gh-24', sourceRepositoryName: 'agent-workspace', selection: { ...{ backend: 'codex' } } });
  });

  it('keeps the selected repository when streaming snapshots replace team state', async () => {
    const teams: Team[] = [{
      id: 'team-app',
      name: `${product.name}`,
      agentIds: ['agent-streaming'],
    }];
    const repositories: SourceRepository[] = [
      {
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
      },
      {
        name: 'mediastation',
        path: '/Users/nbonamy/src/mediastation',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/mediastation' }],
      },
    ];
    const wrapper = mountDialog({ sourceRepositories: repositories, teams });

    await emitSelect(wrapper, 'agent-dialog-repository', '/Users/nbonamy/src/mediastation');
    await nextTick();
    expect(wrapper.getComponent({ name: 'ElSelect' }).props('modelValue')).toBe('/Users/nbonamy/src/mediastation');

    await (wrapper as unknown as { setProps: (props: { teams: Team[] }) => Promise<void> }).setProps({
      teams: [{
        ...teams[0]!,
        agentIds: ['agent-streaming'],
      }],
    });
    await nextTick();

    expect(wrapper.getComponent({ name: 'ElSelect' }).props('modelValue')).toBe('/Users/nbonamy/src/mediastation');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Agent name"]').element.value).toBe('');
  });

  it('creates agents on the requested SSH connection for repositories and worktrees', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const listSourceRepositories = vi.fn().mockResolvedValue([{
      name: 'agent-workspace',
      path: '/home/nicolas/src/agent-workspace',
      worktrees: [{ name: 'main', path: '/home/nicolas/src/agent-workspace' }],
    }] satisfies SourceRepository[]);
    const listSourceWorktrees = vi.fn().mockResolvedValue([
      { name: 'main', path: '/home/nicolas/src/agent-workspace' },
      { name: 'ssh-agent', path: '/home/nicolas/src/agent-workspace-ssh-agent' },
    ] satisfies SourceWorktree[]);
    const wrapper = mountDialog({
      createAgent,
      listSourceRepositories,
      listSourceWorktrees,
      remoteConnectionId: 'connection-devbox',
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.text()).not.toContain('Connection');
    expect(listSourceRepositories).toHaveBeenCalledWith('connection-devbox');
    expect(listSourceWorktrees).toHaveBeenCalledWith('/home/nicolas/src/agent-workspace', 'connection-devbox');
    await emitSelect(wrapper, 'agent-dialog-worktree', '/home/nicolas/src/agent-workspace-ssh-agent');
    await nextTick();
    await saveButton(wrapper).trigger('click');

    expect(createAgent).toHaveBeenCalledWith({ name: null, folder: '/home/nicolas/src/agent-workspace-ssh-agent', sourceRepositoryName: 'agent-workspace', selection: { backend: 'codex' }, remoteConnectionId: 'connection-devbox' });
  });

  it('picks a custom folder through the selected SSH connection', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const listSourceFolders = vi.fn(async (input?: SourceFolderListInput): Promise<SourceFolderListing> => {
      if (input?.path === '/home/nicolas/src') {
        return {
          path: '/home/nicolas/src',
          parentPath: '/home/nicolas',
          entries: [{ name: 'witsy', path: '/home/nicolas/src/witsy' }],
        };
      }
      if (input?.path === '/home/nicolas/src/witsy') {
        return {
          path: '/home/nicolas/src/witsy',
          parentPath: '/home/nicolas/src',
          entries: [],
        };
      }
      return {
        path: '/home/nicolas',
        parentPath: '/home',
        entries: [{ name: 'src', path: '/home/nicolas/src' }],
      };
    });
    const wrapper = mountDialog({
      createAgent,
      listSourceFolders,
      listSourceRepositories: vi.fn().mockResolvedValue([]),
      remoteConnectionId: 'connection-devbox',
    });

    await flushPromises();
    await chooseCustomFolder(wrapper);
    await flushPromises();
    await wrapper.findAll('.remote-folder-picker-dialog__row').find((row) => row.text().includes('src'))?.trigger('click');
    await flushPromises();
    await wrapper.findAll('.remote-folder-picker-dialog__row').find((row) => row.text().includes('witsy'))?.trigger('click');
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'Select this folder')?.trigger('click');
    await saveButton(wrapper).trigger('click');

    expect(listSourceFolders).toHaveBeenCalledWith({ remoteConnectionId: 'connection-devbox' });
    expect(listSourceFolders).toHaveBeenCalledWith({ remoteConnectionId: 'connection-devbox', path: '/home/nicolas/src' });
    expect(listSourceFolders).toHaveBeenCalledWith({ remoteConnectionId: 'connection-devbox', path: '/home/nicolas/src/witsy' });
    expect(createAgent).toHaveBeenCalledWith({ name: null, folder: '/home/nicolas/src/witsy', selection: { backend: 'codex' }, remoteConnectionId: 'connection-devbox' });
  });

  it('loads selected repository worktrees through the backend list action', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const listSourceWorktrees = vi.fn().mockResolvedValue([
      { name: 'main', path: '/Users/nbonamy/src/agent-workspace' },
      { name: 'backend-split', path: '/Users/nbonamy/src/agent-workspace-backend-split' },
    ] satisfies SourceWorktree[]);
    const wrapper = mountDialog({
      createAgent,
      listSourceWorktrees,
      sourceFolderPath: '~/src',
      sourceRepositories: [{
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        worktrees: [{ name: 'stale-scan-result', path: '/Users/nbonamy/src/agent-workspace-stale' }],
      }],
    });

    await flushPromises();

    expect(listSourceWorktrees).toHaveBeenCalledWith('/Users/nbonamy/src/agent-workspace');
    await emitSelect(wrapper, 'agent-dialog-worktree', '/Users/nbonamy/src/agent-workspace-backend-split');
    await nextTick();
    await saveButton(wrapper).trigger('click');

    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: null,
      folder: '/Users/nbonamy/src/agent-workspace-backend-split',
      sourceRepositoryName: 'agent-workspace',
    }));
  });

  it('creates and selects a new source worktree from the dialog', async () => {
    const createAgent = vi.fn().mockResolvedValue(undefined);
    const createSourceWorktree = vi.fn().mockResolvedValue({
      name: 'source-folder',
      path: '/Users/nbonamy/src/agent-workspace-source-folder',
    } satisfies SourceWorktree);
    const wrapper = mountDialog({
      createAgent,
      createSourceWorktree,
      sourceFolderPath: '~/src',
      sourceRepositories: [{
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
      }],
    });

    expect(wrapper.findAllComponents({ name: 'ElOption' }).some((option) => option.props('label') === 'New Worktree...')).toBe(true);
    await emitSelect(wrapper, 'agent-dialog-repository', '/Users/nbonamy/src/agent-workspace');
    await nextTick();
    await emitSelect(wrapper, 'agent-dialog-worktree', '__new_worktree__');
    await nextTick();
    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('feature/source-folder');
    await wrapper.find('.new-source-worktree-dialog .app-button--primary').trigger('click');
    await flushPromises();
    mountProvisioningHost().getComponent({ name: 'StagedOperationProgress' }).vm.$emit('complete');
    await nextTick();
    await saveButton(wrapper).trigger('click');

    expect(createSourceWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'feature/source-folder',
    });
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      folder: '/Users/nbonamy/src/agent-workspace-source-folder',
    }));
  });
});

function mountDialog(overrides: Partial<{
  agent: Agent | null;
  claudeCodeEnabled: boolean;
  chooseAgentFolder: () => Promise<string | null>;
  listSourceFolders: (input?: SourceFolderListInput) => Promise<SourceFolderListing>;
  suggestSourceWorktreePath: (input: { branchName: string; repoPath: string }) => Promise<string>;
  chooseSourceWorktreeDestination: (defaultPath: string) => Promise<string | null>;
  createAgent: (input: CreateAgentInput & { newTeamName?: string; teamId?: string }) => Promise<void>;
  createSourceWorktree: (input: { repoPath: string; branchName: string; destinationPath?: string }) => Promise<SourceWorktree>;
  listSourceRepositories: (remoteConnectionId?: string) => Promise<SourceRepository[]>;
  listSourceWorktrees: (repoPath: string, remoteConnectionId?: string) => Promise<SourceWorktree[]>;
  initialAgentName: string;
  initialNewTeamName: string;
  initialNewWorktreeBranchName: string;
  initialSourceRepositoryName: string | null;
  initialTeamId: string | null;
  mode: 'create' | 'edit';
  remoteConnectionId: string;
  showTeamField: boolean;
  sourceFolderPath: string;
  sourceRecentRepoNames: string[];
  sourceRepositories: SourceRepository[];
  teams: Team[];
  updateAgent: (input: UpdateAgentInput) => Promise<void>;
}> = {}) {
  return mount(AgentDialog, {
    props: {
      agent: null,
      chooseAgentFolder: vi.fn().mockResolvedValue(null),
      listSourceFolders: vi.fn().mockResolvedValue({ path: '', parentPath: null, entries: [] }),
      suggestSourceWorktreePath: vi.fn(async ({ branchName, repoPath }: { branchName: string; repoPath: string }) => {
        const repoName = repoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'repo';
        const parent = repoPath.replace(/[\\/][^\\/]+$/u, '');
        const slug = branchName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'worktree';
        return `${parent}/${repoName}-${slug}`;
      }),
      chooseSourceWorktreeDestination: vi.fn().mockResolvedValue(null),
      createAgent: vi.fn().mockResolvedValue(undefined),
      createSourceWorktree: vi.fn().mockResolvedValue({ name: 'worktree', path: '/tmp/worktree' }),
      listSourceRepositories: vi.fn().mockResolvedValue([]),
      remoteConnectionId: '',
      mode: 'create',
      sourceFolderPath: '',
      sourceRecentRepoNames: [],
      sourceRepositories: [],
      updateAgent: vi.fn().mockResolvedValue(undefined),
      visible: true,
      ...overrides,
    },
    global: {
      provide: { [backendChoicesKey as symbol]: computed(() => overrides.claudeCodeEnabled ? ['codex', 'claude'] : ['codex']) },
      stubs: {
        ElDialog: {
          name: 'ElDialog',
          props: ['modelValue'],
          template: `
            <section v-if="modelValue" class="agent-dialog-test-shell">
              <slot name="header" />
              <slot />
              <slot name="footer" />
            </section>
          `,
        },
      },
    },
  });
}

function saveButton(wrapper: ReturnType<typeof mountDialog>) {
  const button = wrapper.findAll('button').find((candidate) => ['Create agent', 'Rename'].includes(candidate.text()));
  if (!button) {
    throw new Error('Save button not found');
  }

  return button;
}

async function emitSelect(wrapper: ReturnType<typeof mountDialog>, id: string, value: string) {
  const selects = wrapper.findAllComponents({ name: 'ElSelect' });
  const select = id === 'agent-dialog-repository'
    ? selects[0]
    : id === 'agent-dialog-worktree'
      ? selects[1]
      : id === 'agent-dialog-backend'
        ? selects.at(-1)
        : id === 'agent-dialog-team'
          ? (wrapper.find('#agent-dialog-backend').exists() ? selects.at(-2) : selects.at(-1))
          : undefined;
  if (!select) {
    throw new Error(`Select not found: ${id}`);
  }
  await select.vm.$emit('update:modelValue', value);
}

async function chooseCustomFolder(wrapper: ReturnType<typeof mountDialog>) {
  await emitSelect(wrapper, 'agent-dialog-repository', '__custom_folder__');
  await flushPromises();
}
