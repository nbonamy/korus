import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountProvisioningHost } from './provisioning-host';
import { activeProvisioningOperation, backgroundProvisioningOperation } from '../provisioning-operations';
import type { SourceRepository } from '@workspace/core/contracts';
import NewSourceWorktreeDialog from '../NewSourceWorktreeDialog.vue';

describe('NewSourceWorktreeDialog', () => {
  let mountedHost: ReturnType<typeof mountProvisioningHost> | undefined;
  const host = () => mountedHost ??= mountProvisioningHost();
  beforeEach(() => { mountedHost = undefined; });
  it('can prompt only for the worktree branch', () => {
    const wrapper = mountDialog({ allowDestinationOverride: false } as never);

    expect(wrapper.get('.new-source-worktree-dialog__branch-input').attributes('placeholder')).toBe('feature/new-worktree');
    expect(wrapper.find('.new-source-worktree-dialog__folder-input').exists()).toBe(false);
  });

  it('starts new branches from the selected repository branch with the default first', async () => {
    const createWorktree = vi.fn().mockResolvedValue({
      name: 'feature-session',
      path: '/Users/nbonamy/src/agent-workspace-feature-session',
    });
    const wrapper = mountDialog({
      branches: [
        { name: 'release', isDefault: false },
        { name: 'main', isDefault: true },
        { name: 'develop', isDefault: false },
      ],
      createWorktree,
    });

    expect(wrapper.findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))).toStrictEqual([
      'main',
      'develop',
      'release',
    ]);
    expect(wrapper.getComponent({ name: 'ElSelect' }).props('modelValue')).toBe('main');

    wrapper.getComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'release');
    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('feature/session');
    await wrapper.find('.new-source-worktree-dialog .app-button--primary').trigger('click');
    await flushPromises();

    expect(createWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'feature/session',
      baseBranch: 'release',
    });
  });

  it('resolves the destination from the repo root and normalized branch name', async () => {
    const chooseDestination = vi.fn();
    const createWorktree = vi.fn().mockResolvedValue({
      name: 'fix-source-folder',
      path: '/Users/nbonamy/src/agent-workspace-fix-source-folder',
    });
    const wrapper = mountDialog({ chooseDestination, createWorktree });
    expect(wrapper.find('.app-form-dialog__footer-left').exists()).toBe(false);

    expect(wrapper.findAll('.app-dialog__footer .app-button').map((button) => button.classes())).toStrictEqual([
      ['app-button', 'app-button--tertiary'],
      ['app-button', 'app-button--primary'],
    ]);

    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('Fix/source folder!!');
    await flushPromises();

    expect(wrapper.get<HTMLInputElement>('.new-source-worktree-dialog__folder-input').element.value).toBe('/Users/nbonamy/src/agent-workspace-fix-source-folder');

    await wrapper.find('.new-source-worktree-dialog .app-button--primary').trigger('click');
    await flushPromises();

    expect(chooseDestination).not.toHaveBeenCalled();
    expect(createWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'Fix/source folder!!',
    });
    const progress = host().getComponent({ name: 'StagedOperationProgress' });
    expect(progress.props('state')).toBe('success');
    expect(progress.props('completeTitle')).toBe('Fix/source folder!! is ready');
    progress.vm.$emit('complete');
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('created')).toStrictEqual([[{
      name: 'fix-source-folder',
      path: '/Users/nbonamy/src/agent-workspace-fix-source-folder',
    }]]);
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });

  it('replaces the branch form with staged progress while creating the worktree', async () => {
    let resolveCreation!: (worktree: { name: string; path: string }) => void;
    const createWorktree = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveCreation = resolve;
    }));
    const wrapper = mountDialog({ createWorktree });

    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('feature/progress');
    await flushPromises();
    await wrapper.get('.new-source-worktree-dialog .app-button--primary').trigger('click');

    expect(wrapper.find('.new-source-worktree-dialog__branch-input').exists()).toBe(false);
    expect(host().getComponent({ name: 'WorkspaceProvisioningProgressDialog' }).props('operation')).toMatchObject({
      mode: 'single',
      progress: {
        state: 'running',
        repositoryName: 'agent-workspace',
        createWorktree: true,
        branchName: 'feature/progress',
      },
    });
    const progress = host().getComponent({ name: 'StagedOperationProgress' });
    expect(progress.props()).toMatchObject({
      state: 'running',
      title: 'Building an isolated home in agent-workspace…',
    });
    expect(progress.text()).toContain('Creating isolated worktree');
    expect(progress.text()).toContain('feature/progress');
    expect(progress.text()).toContain('Initializing worktree');
    expect(progress.text()).toContain('Starting agent session');
    expect(progress.text()).toContain('Finishing agent setup');

    resolveCreation({ name: 'feature/progress', path: '/tmp/agent-workspace-feature-progress' });
    await flushPromises();

    expect(progress.props('state')).toBe('success');
    expect(wrapper.emitted('created')).toBeUndefined();
    progress.vm.$emit('complete');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('created')).toStrictEqual([[{
      name: 'feature/progress',
      path: '/tmp/agent-workspace-feature-progress',
    }]]);
  });

  it('lets the user override the resolved destination with the folder picker', async () => {
    const chooseDestination = vi.fn().mockResolvedValue('/Users/nbonamy/custom/worktree');
    const createWorktree = vi.fn().mockResolvedValue({
      name: 'custom',
      path: '/Users/nbonamy/custom/worktree',
    });
    const wrapper = mountDialog({ chooseDestination, createWorktree });

    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('feature/source-folder');
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('.new-source-worktree-dialog__folder-input').element.value).toBe('/Users/nbonamy/src/agent-workspace-feature-source-folder');

    await wrapper.get('.new-source-worktree-dialog__folder-picker').trigger('click');
    await flushPromises();

    expect(chooseDestination).toHaveBeenCalledWith('/Users/nbonamy/src/agent-workspace-feature-source-folder');
    expect(wrapper.get<HTMLInputElement>('.new-source-worktree-dialog__folder-input').element.value).toBe('/Users/nbonamy/custom/worktree');

    await wrapper.find('.new-source-worktree-dialog .app-button--primary').trigger('click');
    await flushPromises();

    expect(createWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'feature/source-folder',
      destinationPath: '/Users/nbonamy/custom/worktree',
    });
  });

  it('keeps the generated destination when the folder picker is cancelled', async () => {
    const chooseDestination = vi.fn().mockResolvedValue(null);
    const wrapper = mountDialog({ chooseDestination });

    await wrapper.get('.new-source-worktree-dialog__folder-picker').trigger('click');
    await flushPromises();

    expect(chooseDestination).toHaveBeenCalledWith('/Users/nbonamy/src/agent-workspace-worktree');
    expect(wrapper.get<HTMLInputElement>('.new-source-worktree-dialog__folder-input').element.value).toBe('');

    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('feature/source-folder');
    await flushPromises();
    await wrapper.get('.new-source-worktree-dialog__folder-picker').trigger('click');
    await flushPromises();

    expect(wrapper.get<HTMLInputElement>('.new-source-worktree-dialog__folder-input').element.value).toBe('/Users/nbonamy/src/agent-workspace-feature-source-folder');
  });

  it('resets state when reopened and surfaces creation failures', async () => {
    const wrapper = mountDialog({
      createWorktree: vi.fn().mockRejectedValue(new Error('worktree failed')),
    });

    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('feature/broken');
    await flushPromises();
    await wrapper.find('.new-source-worktree-dialog .app-button--primary').trigger('click');
    await flushPromises();

    expect(activeProvisioningOperation.value).toMatchObject({ mode: 'single', progress: { state: 'error', error: 'worktree failed' } });

    await wrapper.setProps({ visible: false } as never);
    await wrapper.setProps({ visible: true } as never);
    expect(wrapper.get<HTMLInputElement>('.new-source-worktree-dialog__branch-input').element.value).toBe('');
    expect(activeProvisioningOperation.value).toBeNull();
  });

  it('finishes a backgrounded creation without showing progress again', async () => {
    let resolveCreation!: (worktree: { name: string; path: string }) => void;
    const createWorktree = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveCreation = resolve; }));
    const wrapper = mountDialog({ createWorktree });
    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('feature/later');
    await flushPromises();
    await wrapper.get('.new-source-worktree-dialog .app-button--primary').trigger('click');
    backgroundProvisioningOperation('manual-worktree-creation');
    expect(activeProvisioningOperation.value).toBeNull();

    resolveCreation({ name: 'feature/later', path: '/tmp/agent-workspace-feature-later' });
    await flushPromises();
    expect(wrapper.emitted('created')).toStrictEqual([[{ name: 'feature/later', path: '/tmp/agent-workspace-feature-later' }]]);
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
    expect(activeProvisioningOperation.value).toBeNull();
  });

  it('closes when the dialog visibility changes and ignores missing repositories', async () => {
    const createWorktree = vi.fn();
    const chooseDestination = vi.fn();
    const wrapper = mountDialog({
      chooseDestination,
      createWorktree,
      repo: null,
    });

    await wrapper.findComponent({ name: 'ElDialog' }).vm.$emit('update:modelValue', false);
    await wrapper.get('.new-source-worktree-dialog__folder-picker').trigger('click');
    await wrapper.find('.new-source-worktree-dialog .app-button--primary').trigger('click');

    expect(wrapper.emitted('close')).toStrictEqual([[]]);
    expect(chooseDestination).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('keeps destination empty until a branch name is entered', async () => {
    const chooseDestination = vi.fn().mockResolvedValue(null);
    const createWorktree = vi.fn().mockResolvedValue({
      name: 'source-folder',
      path: '/Users/nbonamy/src/agent-workspace-source-folder',
    });
    const wrapper = mountDialog({ chooseDestination, createWorktree });

    expect(wrapper.get<HTMLInputElement>('.new-source-worktree-dialog__folder-input').element.value).toBe('');

    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('feature/source-folder');
    await flushPromises();
    await wrapper.find('.new-source-worktree-dialog .app-button--primary').trigger('click');
    await flushPromises();

    expect(createWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'feature/source-folder',
    });
  });

  it('asks before reusing an existing worktree', async () => {
    const createWorktree = vi.fn().mockResolvedValue({
      name: 'feature/existing',
      path: '/Users/nbonamy/src/agent-workspace-feature-existing',
    });
    const wrapper = mountDialog({
      branches: [{
        name: 'feature/existing',
        isDefault: false,
        worktreePath: '/Users/nbonamy/src/agent-workspace-feature-existing',
      }],
      createWorktree,
    });

    await wrapper.get('.new-source-worktree-dialog__branch-input').setValue('feature/existing');
    await wrapper.get('.new-source-worktree-dialog .app-button--primary').trigger('click');

    expect(createWorktree).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Worktree already exists');
    expect(wrapper.text()).toContain('/Users/nbonamy/src/agent-workspace-feature-existing');

    await wrapper.get('.new-source-worktree-dialog .app-button--primary').trigger('click');
    await flushPromises();

    expect(createWorktree).toHaveBeenCalledWith({
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'feature/existing',
      reuseExisting: true,
    });
    expect(wrapper.emitted('created')).toStrictEqual([[
      { name: 'feature/existing', path: '/Users/nbonamy/src/agent-workspace-feature-existing' },
    ]]);
  });
});

function mountDialog(overrides: Partial<{
  chooseDestination: (defaultPath: string) => Promise<string | null>;
  createWorktree: (input: { repoPath: string; branchName: string; destinationPath?: string; reuseExisting?: boolean }) => Promise<{ name: string; path: string }>;
  branches: Array<{ name: string; isDefault: boolean; worktreePath?: string }>;
  repo: SourceRepository | null;
  suggestDestination: (input: { branchName: string; repoPath: string }) => Promise<string>;
  visible: boolean;
}> = {}) {
  return mount(NewSourceWorktreeDialog, {
    props: {
      chooseDestination: vi.fn().mockResolvedValue(null),
      createWorktree: vi.fn().mockResolvedValue({ name: 'source-folder', path: '/tmp/source-folder' }),
      suggestDestination: vi.fn(async ({ branchName, repoPath }: { branchName: string; repoPath: string }) => {
        const repoName = repoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'repo';
        const parent = repoPath.replace(/[\\/][^\\/]+$/u, '');
        const slug = branchName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'worktree';
        return `${parent}/${repoName}-${slug}`;
      }),
      repo: {
        name: 'agent-workspace',
        path: '/Users/nbonamy/src/agent-workspace',
        worktrees: [],
      },
      visible: true,
      ...overrides,
    },
    global: {
      stubs: {
        ElDialog: {
          name: 'ElDialog',
          props: ['modelValue'],
          template: `
            <section v-if="modelValue" class="new-source-worktree-dialog">
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
