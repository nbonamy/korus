import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AgentHeader from '../AgentHeader.vue';
import type { Agent, AgentGitStatus, BackendRuntimeStatus } from '@workspace/core/contracts';
import '../../styles/base.css';
// Menus open in a popper attached to the body.
const bodyAll = (selector: string) => Array.from(document.body.querySelectorAll(selector)).map((element) => new DOMWrapper(element));

const agent: Agent = {
  id: 'agent-dina',
  name: 'Dina',
  avatar: 'DI',
  folder: '~/src/id8',
  backend: 'codex',
  backendDefaults: { kind: 'codex' },
  status: { type: 'idle' },
  createdAt: '2026-06-05T00:00:00.000Z',
  updatedAt: '2026-06-05T00:00:00.000Z',
};

function mountHeader(backendRuntime: BackendRuntimeStatus, isLoading = false, gitStatus: AgentGitStatus | null = null, workspaceOpen = false) {
  return mount(AgentHeader, {
    props: {
      agent,
      gitStatus,
      backendRuntime,
      workspaceOpen,
      isLoading,
      sidebarCollapsed: false,
    },
  });
}

describe('AgentHeader', () => {

  it('opens Git log for a restored Git workspace before volatile status has loaded', async () => {
    const wrapper = mount(AgentHeader, { props: {
      agent: { ...agent, folder: '/repo/worktree', workspace: { kind: 'git', folder: '/repo/worktree', repositoryName: 'repo', repositoryRoot: '/repo/worktree', primaryWorktreeRoot: '/repo', branch: 'feature', isLinkedWorktree: true, updatedAt: '' } },
      backendRuntime: { backend: 'codex', status: 'running' }, gitStatus: null, isLoading: false, sidebarCollapsed: false,
    } });
    await flushPromises();
    await wrapper.get('.git-workflow-control__trigger').trigger('click');
    await bodyAll('[role="menuitem"]').find(item => item.text() === 'Git log')!.trigger('click');
    expect(wrapper.emitted('open-git-log')).toStrictEqual([[]]);
    wrapper.unmount();
  });
  it('renders the active agent identity without a duplicate right-side status', () => {
    const wrapper = mountHeader({ backend: 'codex', status: 'notConfigured' });

    expect(wrapper.text()).toContain('Dina');
    expect(wrapper.text()).toContain('~/src/id8');
    expect(wrapper.text()).toContain('Ready to get going');
    expect(wrapper.find('.agent-header__activity-line').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Show agent sidebar"]').exists()).toBe(false);
    expect(getComputedStyle(wrapper.element).boxShadow).toBe('var(--shadow-content-edge)');
    expect(wrapper.find('.agent-header__avatar').exists()).toBe(false);
  });

  it('uses the repository icon as the agent identity when one is configured', () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent,
        repositoryIcon: '🦞',
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
      },
    });

    expect(wrapper.get('.agent-header__avatar').text()).toBe('🦞');
    expect(wrapper.get('.agent-header__avatar').text()).not.toBe('DI');
  });

  it('renders repo diff stats and a separate bordered Git actions control', () => {
    const wrapper = mountHeader({ backend: 'codex', status: 'running' }, false, {
      folder: '/Users/nbonamy/src/id8',
      branch: 'main',
      ahead: 2,
      behind: 1,
      changedFiles: 3,
      addedLines: 134,
      removedLines: 1,
      hasUntracked: true,
      state: 'dirty',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });

    expect(wrapper.text()).toContain('+134');
    expect(wrapper.text()).toContain('-1');
    expect(wrapper.get('.agent-header__folder').text()).toBe('main @ id8');
    expect(wrapper.get('.agent-header__folder').attributes('title')).toBe('~/src/id8');
    expect(wrapper.text()).not.toContain('3 files');
    expect(wrapper.text()).not.toContain('ahead');
    expect(wrapper.findComponent({ name: 'ChatAnimatedDiffStat' }).exists()).toBe(true);
    expect(wrapper.get('.git-workflow-control').classes()).toContain('agent-header__git-actions');
    expect(wrapper.get('[aria-label="Run Git action"]').element.tagName).toBe('BUTTON');
  });

  it('shows the canonical repository name for a linked worktree', () => {
    const wrapper = mountHeader({ backend: 'codex', status: 'running' }, false, {
      folder: '/Users/nbonamy/src/agent-workspace-git-fixture-test',
      repository: 'agent-workspace-git-fixture',
      branch: 'test',
      ahead: 0,
      behind: 0,
      changedFiles: 0,
      addedLines: 0,
      removedLines: 0,
      hasUntracked: false,
      state: 'clean',
      updatedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(wrapper.get('.agent-header__folder').text()).toBe('test @ agent-workspace-git-fixture');
  });

  it('does not repeat a branch-derived name in the repository location', () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent: {
          ...agent,
          name: null,
          folder: '/Users/nbonamy/src/agent-workspace-hardening',
          workspace: {
            kind: 'git',
            folder: '/Users/nbonamy/src/agent-workspace-hardening',
            repositoryName: 'agent-workspace',
            repositoryRoot: '/Users/nbonamy/src/agent-workspace-hardening',
            branch: 'chore/codebase-hardening-review',
            isLinkedWorktree: true,
            primaryWorktreeRoot: '/Users/nbonamy/src/agent-workspace',
            updatedAt: '2026-09-07T00:00:00.000Z',
          },
        },
        gitStatus: {
          folder: '/Users/nbonamy/src/agent-workspace-hardening',
          repository: 'agent-workspace',
          branch: 'chore/codebase-hardening-review',
          ahead: 0,
          behind: 0,
          changedFiles: 0,
          addedLines: 0,
          removedLines: 0,
          hasUntracked: false,
          state: 'clean',
          updatedAt: '2026-09-07T00:00:00.000Z',
        },
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
      },
    });

    expect(wrapper.get('.agent-header__agent-line strong').text()).toBe('chore/codebase-hardening-review');
    expect(wrapper.get('.agent-header__folder').text()).toBe('@ agent-workspace');
  });

  it('uses persisted workspace identity before the first Git status refresh', () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent: {
          ...agent,
          name: null,
          folder: '/Users/nbonamy/src/codex',
          workspace: {
            kind: 'git',
            folder: '/Users/nbonamy/src/codex',
            repositoryName: 'codex',
            repositoryRoot: '/Users/nbonamy/src/codex',
            branch: 'main',
            isLinkedWorktree: false,
            primaryWorktreeRoot: '/Users/nbonamy/src/codex',
            updatedAt: '2026-09-07T00:00:00.000Z',
          },
        },
        gitStatus: null,
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
      },
    });

    expect(wrapper.get('.agent-header__agent-line strong').text()).toBe('main');
    expect(wrapper.get('.agent-header__folder').text()).toBe('@ codex');
  });

  it('emits a git diff preview request when repo diff stats are clicked', async () => {
    const wrapper = mountHeader({ backend: 'codex', status: 'running' }, false, {
      folder: '/Users/nbonamy/src/id8',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changedFiles: 1,
      addedLines: 12,
      removedLines: 4,
      hasUntracked: false,
      state: 'dirty',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });

    await wrapper.get('[aria-label="Open repository diff"]').trigger('click');

    expect(wrapper.emitted('open-git-diff')).toStrictEqual([[{ type: 'uncommitted' }]]);
  });

  it('switches among diff targets and remembers the selection per agent', async () => {
    const wrapper = mountHeader({ backend: 'codex', status: 'running' }, false, {
      folder: '/Users/nbonamy/src/id8',
      branch: 'feature',
      ahead: 1,
      behind: 0,
      changedFiles: 1,
      addedLines: 4,
      removedLines: 2,
      hasUntracked: false,
      state: 'dirty',
      diffCatalog: {
        defaultTarget: { type: 'branch', baseRef: 'origin/main' },
        branch: { baseRef: 'origin/main', addedLines: 8, removedLines: 3, changedFiles: 2 },
        uncommitted: { addedLines: 4, removedLines: 2, changedFiles: 1 },
        unstaged: { addedLines: 1, removedLines: 0, changedFiles: 1 },
        staged: { addedLines: 3, removedLines: 2, changedFiles: 1 },
        commits: [{ sha: 'abcdef123456', shortSha: 'abcdef1', subject: 'ship it', addedLines: 5, removedLines: 1, changedFiles: 1 }],
      },
      updatedAt: '2026-06-05T00:00:00.000Z',
    });
    await wrapper.setProps({
      lastTurnGitDiff: { agentId: agent.id, turnId: 'turn-1', addedLines: 2, removedLines: 1, diff: 'turn diff', updatedAt: '2026-06-05T00:00:01.000Z' },
    });

    expect(wrapper.get('.git-diff-control__open').attributes('title')).toBe('Uncommitted');
    expect(wrapper.find('.git-diff-control__icon').exists()).toBe(false);
    await wrapper.get('[aria-label="Choose repository diff"]').trigger('click');
    const menu = wrapper.getComponent({ name: 'AppMenu' });
    expect(menu.props('items')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'branch', label: 'Branch', checked: false }),
      expect.objectContaining({ id: 'uncommitted', label: 'Uncommitted', checked: true }),
      expect.objectContaining({ id: 'turn', label: 'Last turn' }),
      expect.objectContaining({ id: 'commits', type: 'submenu' }),
    ]));
    expect(menu.find('[role="menuitemradio"][aria-checked="true"]').text()).toContain('Uncommitted');
    menu.vm.$emit('select', 'staged');
    await wrapper.vm.$nextTick();

    expect(wrapper.get('.git-diff-control__open').attributes('title')).toBe('Staged');
    expect(wrapper.emitted('open-git-diff')).toBeUndefined();
    expect(wrapper.emitted('select-git-diff-target')).toStrictEqual([[{ type: 'staged' }]]);

    await wrapper.setProps({ agent: { ...agent, id: 'agent-jesse' } });
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.git-diff-control__open').attributes('title')).toBe('Uncommitted');

    await wrapper.get('[aria-label="Choose repository diff"]').trigger('click');
    wrapper.getComponent({ name: 'AppMenu' }).vm.$emit('select', 'unstaged');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.git-diff-control__open').attributes('title')).toBe('Unstaged');
    expect(wrapper.emitted('select-git-diff-target')).toStrictEqual([
      [{ type: 'staged' }],
      [{ type: 'unstaged' }],
    ]);

    await wrapper.setProps({ agent: { ...agent, gitDiffTarget: { type: 'staged' } } });
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.git-diff-control__open').attributes('title')).toBe('Staged');

    await wrapper.setProps({ agent: { ...agent, id: 'agent-jesse', gitDiffTarget: { type: 'unstaged' } } });
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.git-diff-control__open').attributes('title')).toBe('Unstaged');

    await wrapper.setProps({ agent: { ...agent, gitDiffTarget: { type: 'staged' } } });
    await wrapper.vm.$nextTick();

    await wrapper.get('.git-diff-control__open').trigger('click');

    expect(wrapper.emitted('open-git-diff')).toContainEqual([{ type: 'staged' }]);
  });

  it('keeps Git actions available for a clean repository', () => {
    const wrapper = mountHeader({ backend: 'codex', status: 'running' }, false, {
      folder: '/Users/nbonamy/src/id8',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changedFiles: 0,
      addedLines: 0,
      removedLines: 0,
      hasUntracked: false,
      state: 'clean',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });

    expect(wrapper.find('.git-workflow-control').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'ChatAnimatedDiffStat' }).exists()).toBe(false);
    expect(wrapper.find('.git-diff-control__open').exists()).toBe(false);
    expect(wrapper.get('.git-diff-control__empty').text()).toBe('No changes');
    expect(getComputedStyle(wrapper.get('.agent-header').element).userSelect).toBe('none');
    expect(wrapper.find('.git-diff-control__menu-trigger').exists()).toBe(true);
  });

  it('does not duplicate repository backlog navigation in the agent header', () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent,
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
      },
    });

    expect(wrapper.find('[aria-label="Open repository backlog"]').exists()).toBe(false);
  });

  it('renders an icon-only right-workspace action in the header', async () => {
    const wrapper = mountHeader({ backend: 'codex', status: 'running' }, false, null, true);
    const workspaceAction = wrapper.get('[aria-label="Toggle right workspace"]');

    expect(workspaceAction.text()).toBe('');
    expect(workspaceAction.attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('.agent-header__activity').element.lastElementChild).toBe(workspaceAction.element);
    await workspaceAction.trigger('click');

    expect(wrapper.emitted('toggle-workspace')).toStrictEqual([[]]);
  });

  it('does not render a code review action in the header', () => {
    const wrapper = mountHeader({ backend: 'codex', status: 'running' }, false, {
      folder: '/Users/nbonamy/src/id8',
      branch: 'feature',
      ahead: 1,
      behind: 0,
      changedFiles: 1,
      addedLines: 4,
      removedLines: 2,
      hasUntracked: false,
      state: 'dirty',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });

    expect(wrapper.find('[aria-label="Open code review"]').exists()).toBe(false);
  });

  it('opens the agent folder in its remembered application from the header', async () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent: { ...agent, openInApplication: 'xcode' },
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
        openInAvailable: true,
        openInCatalog: {
          defaultApplication: 'vscode',
          applications: [
            { id: 'vscode', label: 'VS Code' },
            { id: 'xcode', label: 'Xcode' },
          ],
        },
      },
    });

    await wrapper.get('[aria-label="Open in Xcode"]').trigger('click');

    expect(wrapper.emitted('open-in')).toStrictEqual([['xcode']]);
  });

  it('omits workspace identity and Open In for a workspace-free quick chat', () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent: { ...agent, name: null, folder: null, sessionKind: 'quickChat' },
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
        openInAvailable: true,
        openInCatalog: {
          defaultApplication: 'vscode',
          applications: [{ id: 'vscode', label: 'VS Code' }],
        },
      },
    });

    expect(wrapper.text()).toContain('Untitled conversation');
    expect(wrapper.find('.agent-header__folder').exists()).toBe(false);
    expect(wrapper.find('.open-in-control').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Open code review"]').exists()).toBe(false);
  });

  it('shows the execution-plan toggle only when a plan is available', async () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent,
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
        executionPlanAvailable: true,
        executionPlanOpen: true,
      },
    });

    const planAction = wrapper.get('[aria-label="Toggle execution plan"]');
    expect(planAction.attributes('aria-pressed')).toBe('true');
    await planAction.trigger('click');
    expect(wrapper.emitted('toggle-execution-plan')).toStrictEqual([[]]);

    const hiddenWrapper = mount(AgentHeader, {
      props: {
        agent,
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
        executionPlanAvailable: false,
      },
    });
    expect(hiddenWrapper.find('[aria-label="Toggle execution plan"]').exists()).toBe(false);
  });

  it('places a downloaded update badge in the header and forwards install', async () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent,
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
        updateStatus: { state: 'downloaded', version: '0.4.0' },
      },
    });

    const badge = wrapper.get('.update-available-badge');
    expect(badge.text()).toBe('Update available');
    await badge.trigger('click');

    expect(wrapper.emitted('install-update')).toStrictEqual([[]]);
  });

  it('shows the agent collaboration status when one is set', () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent: {
          ...agent,
          statusText: 'Running tests',
        },
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
      },
    });

    expect(wrapper.text()).toContain('Running tests');
    expect(wrapper.find('.agent-header__activity-line').exists()).toBe(false);
    expect(wrapper.get('.agent-header__inline-status').text()).toBe('Running tests');
  });

  it.each([
    [{ type: 'working' as const, detail: 'Getting stats...' }, 'Getting stats...'],
    [{ type: 'working' as const }, 'Working'],
    [{ type: 'awaitingInput' as const, detail: 'Approval needed' }, 'Approval needed'],
    [{ type: 'awaitingInput' as const }, 'Awaiting input'],
    [{ type: 'error' as const, message: 'Tool failed' }, 'Tool failed'],
  ])('renders the inline status detail for %s', (status, detail) => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent: {
          ...agent,
          status,
        },
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
      },
    });

    expect(wrapper.find('.agent-header__activity-line').exists()).toBe(false);
    expect(wrapper.text()).toContain(detail);
  });

  it('renders an empty identity when no agent is selected', () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent: null,
        backendRuntime: { backend: 'codex', status: 'notConfigured' },
        isLoading: false,
        sidebarCollapsed: true,
      },
    });

    expect(wrapper.text()).toContain('No agent');
    expect(wrapper.get('[aria-label="Show agent sidebar"]').attributes('aria-label')).toBe('Show agent sidebar');
  });

  it('keeps the full header presentation and emits expand requests when the sidebar is collapsed', async () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent,
        repositoryIcon: '🦞',
        gitStatus: {
          folder: '/Users/nbonamy/src/id8',
          branch: 'main',
          ahead: 0,
          behind: 0,
          changedFiles: 1,
          addedLines: 12,
          removedLines: 4,
          hasUntracked: false,
          state: 'dirty',
          updatedAt: '2026-06-05T00:00:00.000Z',
        },
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: true,
      },
    });

    expect(wrapper.text()).toContain('Dina');
    expect(wrapper.text()).toContain('Ready to get going');
    expect(wrapper.text()).toContain('main @ id8');
    expect(wrapper.text()).not.toContain('~/src/id8');
    expect(wrapper.text()).toContain('+12');
    expect(wrapper.text()).toContain('-4');
    expect(wrapper.get('.agent-header__avatar').classes()).toContain('agent-avatar--sm');
    expect(wrapper.get('.agent-header__avatar').text()).toBe('🦞');
    expect(wrapper.classes()).not.toContain('agent-header--sidebar-collapsed');
    expect(getComputedStyle(wrapper.element).boxShadow).toBe('none');

    await wrapper.get('[aria-label="Show agent sidebar"]').trigger('click');

    expect(wrapper.emitted('expand-sidebar')).toStrictEqual([[]]);
  });

  it('falls back to the agent folder when Git status is unavailable', () => {
    const wrapper = mountHeader({ backend: 'codex', status: 'running' }, false, {
      folder: '/Users/nbonamy/src/id8',
      ahead: 0,
      behind: 0,
      changedFiles: 0,
      addedLines: 0,
      removedLines: 0,
      hasUntracked: false,
      state: 'unknown',
      updatedAt: '2026-06-05T00:00:00.000Z',
      error: 'Not a Git repository',
    });

    expect(wrapper.get('.agent-header__folder').text()).toBe('~/src/id8');
  });

  it('shows the icon-only subagent control and forwards a selected child', async () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent,
        backendRuntime: { backend: 'codex', status: 'running' },
        gitStatus: {
          folder: '/Users/nbonamy/src/id8',
          branch: 'main',
          ahead: 0,
          behind: 0,
          changedFiles: 1,
          addedLines: 12,
          removedLines: 4,
          hasUntracked: false,
          state: 'dirty',
          updatedAt: '2026-06-05T00:00:00.000Z',
        },
        isLoading: false,
        sidebarCollapsed: false,
        subagentTree: {
          rootConversationId: 'thread-root',
          nodes: {
            'thread-child': {
              conversationId: 'thread-child',
              parentConversationId: 'thread-root',
              createdAt: '2026-06-05T00:00:00.000Z',
              status: 'running',
              agentPath: '/root/scout',
              updatedAt: '2026-06-05T00:00:00.000Z',
            },
          },
          operations: {},
          activities: {},
        },
      },
    });

    const gitStats = wrapper.get('.agent-header__git-status');
    const gitReview = wrapper.get('.agent-header__git-actions');
    expect(gitStats.element.nextElementSibling).toBe(gitReview.element);
    expect(gitReview.element.nextElementSibling).toBe(wrapper.get('.subagent-control').element);
    await wrapper.get('[aria-label="Subagents (1 active)"]').trigger('click');
    await wrapper.get('[role="menuitem"]').trigger('click');

    expect(wrapper.emitted('select-subagent')).toStrictEqual([['thread-child']]);
  });

  it('orders repository actions, Open In, subagents, plan, workspace, and update controls', () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent: { ...agent, openInApplication: 'vscode' },
        gitStatus: {
          folder: '/Users/nbonamy/src/id8',
          branch: 'main',
          ahead: 0,
          behind: 0,
          changedFiles: 1,
          addedLines: 12,
          removedLines: 4,
          hasUntracked: false,
          state: 'dirty',
          updatedAt: '2026-06-05T00:00:00.000Z',
        },
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
        openInAvailable: true,
        openInCatalog: {
          defaultApplication: 'vscode',
          applications: [{ id: 'vscode', label: 'VS Code' }],
        },
        subagentTree: {
          rootConversationId: 'thread-root',
          nodes: {
            'thread-child': {
              conversationId: 'thread-child',
              parentConversationId: 'thread-root',
              createdAt: '2026-06-05T00:00:00.000Z',
              status: 'running',
              agentPath: '/root/scout',
              updatedAt: '2026-06-05T00:00:00.000Z',
            },
          },
          operations: {},
          activities: {},
        },
        executionPlanAvailable: true,
        executionPlanOpen: false,
        workspaceOpen: false,
        updateStatus: { state: 'downloaded', version: '0.4.0' },
      },
    });

    const activity = wrapper.get('.agent-header__activity');
    expect([...activity.element.children].map((child) => child.className)).toStrictEqual([
      'run-profiles-control',
      'git-diff-control agent-header__git-status',
      'git-workflow-control agent-header__git-actions',
      'open-in-control agent-header__open-in',
      'subagent-control',
      'agent-header__execution-plan',
      'agent-header__workspace',
      'update-available-badge',
    ]);
  });

  it('does not show the subagent control for a stale parent-conversation node', () => {
    const wrapper = mount(AgentHeader, {
      props: {
        agent,
        backendRuntime: { backend: 'codex', status: 'running' },
        isLoading: false,
        sidebarCollapsed: false,
        subagentTree: {
          rootConversationId: 'thread-root',
          nodes: {
            'thread-root': {
              conversationId: 'thread-root',
              parentConversationId: 'thread-child',
              createdAt: '2026-06-05T00:00:00.000Z',
              status: 'running',
              agentPath: '/root',
              updatedAt: '2026-06-05T00:00:00.000Z',
            },
          },
          operations: {},
          activities: {},
        },
      },
    });

    expect(wrapper.find('.subagent-control').exists()).toBe(false);
  });
});
