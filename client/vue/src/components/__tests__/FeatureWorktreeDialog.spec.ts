import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceBranch } from '@workspace/core/contracts';
import FeatureWorktreeDialog from '../FeatureWorktreeDialog.vue';
import type { SidebarRepositoryTarget } from '../agent-sidebar-contracts';

const repositories: SidebarRepositoryTarget[] = [
  { agentId: 'a1', repositoryName: 'id8', repositoryRoot: '/src/id8' },
  { agentId: 'a2', repositoryName: 'ui', repositoryRoot: '/src/ui' },
];
const NEW_BRANCH = '__new_branch__';

describe('FeatureWorktreeDialog in agent mode', () => {
  const mounted: VueWrapper[] = [];
  afterEach(() => { for (const wrapper of mounted.splice(0)) wrapper.unmount(); });

  it('offers the team repositories, then that repository\'s branches with a new branch option first', async () => {
    const { wrapper } = await mountReady();
    const selects = wrapper.findAllComponents({ name: 'ElSelect' });
    expect(selects).toHaveLength(2);
    expect(selects[0]!.findAllComponents({ name: 'ElOption' }).map(option => (option.props() as { label: string }).label)).toStrictEqual(['id8', 'ui']);
    expect(selects[1]!.findAllComponents({ name: 'ElOption' }).map(option => (option.props() as { value: string }).value)).toStrictEqual([NEW_BRANCH, 'main', 'develop', 'release']);
    // The default branch is preselected; only a new branch asks for a name.
    expect(selects[1]!.props('modelValue')).toBe('main');
    expect(wrapper.find('#feature-worktree-branch').exists()).toBe(false);
    selects[1]!.vm.$emit('update:modelValue', NEW_BRANCH);
    await flushPromises();
    expect(wrapper.find('#feature-worktree-branch').exists()).toBe(true);
  });

  it('creates a worktree from the default branch for a new branch, then an agent in it', async () => {
    const { wrapper, props } = await mountReady();
    wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('update:modelValue', NEW_BRANCH);
    await flushPromises();
    await wrapper.get('#feature-worktree-branch').setValue('feature/login');
    await wrapper.find('.app-button--primary').trigger('click');
    await flushPromises();
    expect(props.createWorktree).toHaveBeenCalledExactlyOnceWith({ repoPath: '/src/id8', branchName: 'feature/login', baseBranch: 'main', requireNewBranch: true });
    expect(props.createAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ folder: '/work/feature-login', sourceRepositoryName: 'id8', teamId: 'team' }), { select: false });
  });

  it('starts in the default branch\'s checkout straight away', async () => {
    const { wrapper, props } = await mountReady();
    await wrapper.find('.app-button--primary').trigger('click');
    await flushPromises();
    expect(props.createWorktree).not.toHaveBeenCalled();
    expect(props.createAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ folder: '/src/id8' }), { select: false });
  });

  it('starts in the worktree an existing branch already has, without creating one', async () => {
    const { wrapper, props } = await mountReady();
    wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('update:modelValue', 'develop');
    await flushPromises();
    expect(wrapper.find('#feature-worktree-branch').exists()).toBe(false);
    await wrapper.find('.app-button--primary').trigger('click');
    await flushPromises();
    expect(props.createWorktree).not.toHaveBeenCalled();
    expect(props.createAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ folder: '/work/develop' }), { select: false });
  });

  it('adds a worktree for an existing branch that has none', async () => {
    const { wrapper, props } = await mountReady();
    wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('update:modelValue', 'release');
    await flushPromises();
    await wrapper.find('.app-button--primary').trigger('click');
    await flushPromises();
    expect(props.createWorktree).toHaveBeenCalledExactlyOnceWith({ repoPath: '/src/id8', branchName: 'release', reuseExisting: true });
    expect(props.createAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ folder: '/work/feature-login' }), { select: false });
  });

  it.each([
    ['has a worktree', 'develop', null, '/work/develop'],
    ['has none', 'release', { repoPath: '/src/id8', branchName: 'release', reuseExisting: true }, '/work/feature-login'],
  ] as const)('falls back to an existing branch typed as a new one when it %s', async (_case, typed, worktreeCall, folder) => {
    const { wrapper, props } = await mountReady();
    wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('update:modelValue', NEW_BRANCH);
    await flushPromises();
    await wrapper.get('#feature-worktree-branch').setValue(typed);
    await wrapper.find('.app-button--primary').trigger('click');
    await flushPromises();
    if (worktreeCall) expect(props.createWorktree).toHaveBeenCalledExactlyOnceWith(worktreeCall);
    else expect(props.createWorktree).not.toHaveBeenCalled();
    expect(props.createAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ folder }), { select: false });
  });

  describe('for a feature branch', () => {
    it('shows the feature branch read-only instead of a branch choice', async () => {
      const { wrapper } = await mountReady({ fixedBranch: 'feature/x' });
      expect(wrapper.findAllComponents({ name: 'ElSelect' })).toHaveLength(1);
      const input = wrapper.get<HTMLInputElement>('#feature-worktree-branch');
      expect(input.element.value).toBe('feature/x');
      expect(input.attributes('readonly')).toBeDefined();
    });

    it('creates the branch from the default branch where the repository does not have it', async () => {
      const { wrapper, props } = await mountReady({ fixedBranch: 'feature/x' });
      await wrapper.find('.app-button--primary').trigger('click');
      await flushPromises();
      expect(props.createWorktree).toHaveBeenCalledExactlyOnceWith({ repoPath: '/src/id8', branchName: 'feature/x', baseBranch: 'main', requireNewBranch: true });
      expect(props.createAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ folder: '/work/feature-login' }), { select: false });
    });

    it('starts in the branch\'s worktree where the repository already has it', async () => {
      const { wrapper, props } = await mountReady({ fixedBranch: 'develop' });
      await wrapper.find('.app-button--primary').trigger('click');
      await flushPromises();
      expect(props.createWorktree).not.toHaveBeenCalled();
      expect(props.createAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ folder: '/work/develop' }), { select: false });
    });
  });

  it('loads the branches of the repository that is picked', async () => {
    const { wrapper, props } = await mountReady();
    wrapper.findAllComponents({ name: 'ElSelect' })[0]!.vm.$emit('update:modelValue', '/src/ui');
    await flushPromises();
    expect(props.listBranches).toHaveBeenLastCalledWith('/src/ui', undefined);
  });

  it('cannot create a new branch without a name', async () => {
    const { wrapper } = await mountReady();
    wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('update:modelValue', NEW_BRANCH);
    await flushPromises();
    expect(wrapper.find('.app-button--primary').attributes('disabled')).toBeDefined();
  });

  async function mountReady(extra: { fixedBranch?: string } = {}) {
    const wrapper = mountDialog(extra);
    await flushPromises();
    return { wrapper, props: wrapper.props() as unknown as ReturnType<typeof dialogProps> };
  }

  function dialogProps() {
    const branches: SourceBranch[] = [
      { name: 'main', isDefault: true, worktreePath: '/src/id8' },
      { name: 'develop', isDefault: false, worktreePath: '/work/develop' },
      { name: 'release', isDefault: false },
    ];
    return {
      mode: 'agent' as const,
      repositories,
      teamId: 'team',
      createAgent: vi.fn().mockResolvedValue({ id: 'agent-1' }),
      createWorktree: vi.fn().mockResolvedValue({ name: 'feature-login', path: '/work/feature-login' }),
      listBranches: vi.fn().mockResolvedValue(branches),
      backendForHost: vi.fn().mockReturnValue('codex'),
    };
  }

  function mountDialog(extra: { fixedBranch?: string } = {}): VueWrapper {
    const wrapper = mount(FeatureWorktreeDialog, {
      props: { ...dialogProps(), ...extra },
      global: { stubs: { ElDialog: { name: 'ElDialog', props: ['modelValue'], template: '<section v-if="modelValue"><slot name="header" /><slot /><slot name="footer" /></section>' } } },
    });
    mounted.push(wrapper);
    return wrapper;
  }
});
