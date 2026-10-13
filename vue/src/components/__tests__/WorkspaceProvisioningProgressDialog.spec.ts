import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import WorkspaceProvisioningProgressDialog from '../WorkspaceProvisioningProgressDialog.vue';

describe('WorkspaceProvisioningProgressDialog', () => {
  afterEach(() => vi.useRealTimers());

  it('shows branch-move stages without setup scripts or a task handoff', async () => {
    const progress = { id: 'move', agentId: 'parent', branchName: 'feature/work', state: 'running' as const, phase: 'movingChanges' as const };
    const wrapper = mount(WorkspaceProvisioningProgressDialog, { props: { operation: { mode: 'branchMove', progress } } });
    expect(wrapper.findAll('.staged-operation-progress li')).toHaveLength(4);
    expect(wrapper.findAll('.staged-operation-progress li')[1]!.classes()).toContain('is-active');
    expect(wrapper.text()).toContain('uncommitted');
    await wrapper.setProps({ operation: { mode: 'branchMove', progress: { ...progress, phase: 'resettingSource', state: 'error', error: 'Source work preserved' } } });
    expect(wrapper.findAll('.staged-operation-progress li')[3]!.classes()).toContain('is-error');
    expect(wrapper.text()).toContain('Source work preserved');
    await wrapper.findAll('button').find(button => button.text() === 'Close')!.trigger('click');
    expect(wrapper.emitted('close')).toStrictEqual([['move']]);
    wrapper.unmount();
  });

  it.each(['codex', 'antigravity'] as const)('shows %s project creation stages and retains handoff failures', async backend => {
    const progress = {
      id: 'project-1', state: 'running' as const, backend,
      repositoryName: 'new-product', createWorktree: false, createProject: true,
      hasPrompt: true, phase: 'creatingProject' as const,
    };
    const wrapper = mount(WorkspaceProvisioningProgressDialog, {
      props: { operation: { mode: 'single', progress } },
    });
    expect(wrapper.text()).toContain('Creating new-product');
    const steps = () => wrapper.findAll('.staged-operation-progress li');
    expect(steps()).toHaveLength(3);
    expect(steps()[0]!.text()).toContain('Creating project folder');
    expect(steps()[0]!.classes()).toContain('is-active');
    await wrapper.setProps({ operation: { mode: 'single', progress: { ...progress, phase: 'creatingAgent' } } });
    expect(steps()[1]!.classes()).toContain('is-active');
    expect(steps()[1]!.text()).toContain(backend === 'antigravity' ? 'Antigravity' : 'Codex');
    await wrapper.setProps({ operation: { mode: 'single', progress: { ...progress, phase: 'startingPrompt' } } });
    expect(steps()[2]!.classes()).toContain('is-active');
    await wrapper.setProps({ operation: { mode: 'single', progress: {
      ...progress, phase: 'startingPrompt', state: 'error', error: 'Project remains available; backend offline.',
    } } });
    expect(wrapper.get('[role="status"]').text()).toContain('Project remains available; backend offline.');
    await wrapper.get('.app-dialog__footer button').trigger('click');
    expect(wrapper.emitted('close')).toStrictEqual([['project-1']]);
  });

  it('shows the delegated worktree handoff and closes after the success animation', async () => {
    vi.useFakeTimers();
    const initialProgress = {
      id: 'agent-creation-1',
      state: 'running' as const,
      backend: 'codex' as const,
      repositoryName: 'codex-app-sdk',
      createWorktree: true,
      branchName: 'feature/contracts',
      hasPrompt: true,
      phase: 'creatingWorktree' as const,
    };
    const wrapper = mount(WorkspaceProvisioningProgressDialog, {
      props: {
        operation: {
          mode: 'single',
          progress: initialProgress,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Building an isolated home in codex-app-sdk');
    expect(wrapper.text()).toContain('Creating isolated worktree');
    expect(wrapper.text()).toContain('Initializing worktree');
    expect(wrapper.text()).toContain('Handing over initial instructions');

    await wrapper.setProps({
      operation: {
        mode: 'single',
        progress: {
          ...initialProgress,
          phase: 'initializingWorktree' as const,
          initializationDetail: 'npm ci · uv sync',
        },
      },
    });
    expect(wrapper.text()).toContain('npm ci · uv sync');

    await wrapper.setProps({
      operation: {
        mode: 'single',
        progress: {
          ...initialProgress,
          state: 'success' as const,
          phase: 'initializingWorktree',
          agentId: 'agent-worker',
          agentName: 'feature/contracts',
        },
      },
    });
    vi.advanceTimersByTime(4_400);
    await nextTick();

    expect(wrapper.text()).toContain('feature/contracts is ready');
    expect(wrapper.emitted('close')).toStrictEqual([['agent-creation-1']]);
  });

  it('holds multiple-worktree progress until every repository reaches the next phase', async () => {
    vi.useFakeTimers();
    const operation = {
      mode: 'multiple' as const,
      id: 'mission-1',
      state: 'running' as const,
      repositories: ['/src/api', '/src/web'],
      ticketCount: 3,
      phase: 'creatingWorktrees' as const,
    };
    const wrapper = mount(WorkspaceProvisioningProgressDialog, { props: { operation } });

    expect(wrapper.text()).toContain('2 repositories');
    expect(wrapper.text()).toContain('api, web');
    expect(wrapper.text()).toContain('3 tickets');
    expect(wrapper.findAll('.staged-operation-progress li')[0]?.classes()).toContain('is-active');

    vi.advanceTimersByTime(10_000);
    await nextTick();
    expect(wrapper.findAll('.staged-operation-progress li')[0]?.classes()).toContain('is-active');

    await wrapper.setProps({ operation: { ...operation, phase: 'initializingWorkspaces' } });
    expect(wrapper.findAll('.staged-operation-progress li')[0]?.classes()).toContain('is-complete');
    expect(wrapper.findAll('.staged-operation-progress li')[1]?.classes()).toContain('is-active');

    await wrapper.setProps({ operation: { ...operation, phase: 'startingAgents' } });
    expect(wrapper.findAll('.staged-operation-progress li')[2]?.classes()).toContain('is-active');
  });

  it('shows a multiple-worktree error and closes the matching operation', async () => {
    const wrapper = mount(WorkspaceProvisioningProgressDialog, {
      props: {
        operation: {
          mode: 'multiple',
          id: 'mission-1',
          state: 'error',
          repositories: ['/src/api', '/src/web'],
          ticketCount: 2,
          phase: 'creatingWorktrees',
          error: 'Web worktree could not be created.',
        },
      },
    });

    expect(wrapper.get('[role="status"]').text()).toContain('Web worktree could not be created.');
    await wrapper.get('.app-dialog__footer button').trigger('click');
    expect(wrapper.emitted('close')).toStrictEqual([['mission-1']]);
  });
});
