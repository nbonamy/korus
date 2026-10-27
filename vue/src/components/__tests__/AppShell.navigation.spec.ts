import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessageBox } from 'element-plus';
import type {
  CodexNativeRendererApi,
} from '@codex-app-sdk/vue';
import { nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShell from '../AppShell.vue';
import type { AgentConversationView } from '../../app-state';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppApi, AppCommand, Agent, UpdateSettingsInput, WorkSource } from '@workspace/core/contracts';
import { useConfetti } from '../../shared/confetti/use-confetti';
import { codexConversationSnapshot, codexTextMessage } from '../../test/codex-conversation-fixtures';

import {
  mountShell as mountRealShell,
  pointerEvent,
  workItem,
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

describe('AppShell navigation and teams', () => {
  it('opens the shortcut reference through the keyboard and native Help command, leaving typing alone', async () => {
    let command: (value: AppCommand) => void = () => {};
    window.app = { onAppCommand: vi.fn(listener => { command = listener; return () => {}; }) } as unknown as AppApi;
    const wrapper = mountShell();
    const editor = document.createElement('textarea');
    document.body.append(editor);
    const typing = new KeyboardEvent('keydown', { key: '?', code: 'Slash', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(typing);
    await nextTick();
    expect(wrapper.findComponent({ name: 'KeyboardShortcutsDialog' }).exists()).toBe(false);
    expect(typing.defaultPrevented).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', metaKey: true, shiftKey: true, cancelable: true }));
    await nextTick();
    expect(wrapper.findComponent({ name: 'KeyboardShortcutsDialog' }).exists()).toBe(true);
    await wrapper.get('input[type="search"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.findComponent({ name: 'KeyboardShortcutsDialog' }).exists()).toBe(false);
    command({ type: 'open-keyboard-shortcuts' });
    await nextTick();
    expect(wrapper.findComponent({ name: 'KeyboardShortcutsDialog' }).exists()).toBe(true);
    wrapper.unmount();
    editor.remove();
  });

  it('forwards interrupts from the composer stop button', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].status = { type: 'working' };
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: true,
      },
      global: {
        },
    });

    await wrapper.get('.chat-composer__send').trigger('click');

    expect(wrapper.emitted('interrupt-agent')).toStrictEqual([[]]);
  });

  it('forwards agent selection from the sidebar', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
      },
      global: {
        },
    });

    await wrapper.findAll('.agent-sidebar__agent')[1]?.trigger('click');

    expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-jesse']]);
  });

  it('collapses the agent sidebar while keeping the team rail', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
      },
      global: {
        },
    });

    expect(wrapper.get('.team-rail').classes()).toContain('team-rail--agent-sidebar-expanded');
    await wrapper.get('[aria-label="Hide agent sidebar"]').trigger('click');

    expect(wrapper.find('.agent-sidebar').exists()).toBe(false);
    expect(wrapper.find('.team-rail').exists()).toBe(true);
    expect(wrapper.get('.team-rail').classes()).not.toContain('team-rail--agent-sidebar-expanded');
    expect(wrapper.get('[aria-label="Show agent sidebar"]').attributes('aria-label')).toBe('Show agent sidebar');
  });

  it('keeps agent sidebar resize state in the shell', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
      },
      global: {
        },
    });

    const sidebar = () => wrapper.get('.agent-sidebar');
    expect(sidebar().attributes('style')).toContain('--agent-sidebar-width: 260px');

    const resizeHandle = wrapper.get('[aria-label="Resize agent sidebar"]');
    resizeHandle.element.dispatchEvent(pointerEvent('pointerdown', 260));
    resizeHandle.element.dispatchEvent(pointerEvent('pointermove', 320));
    await nextTick();

    expect(sidebar().attributes('style')).toContain('--agent-sidebar-width: 320px');
    resizeHandle.element.dispatchEvent(pointerEvent('pointermove', 40));
    resizeHandle.element.dispatchEvent(pointerEvent('pointerup', 40));
    await nextTick();
    expect(sidebar().attributes('style')).toContain('--agent-sidebar-width: 200px');
    expect(resizeHandle.attributes('aria-valuenow')).toBe('200');
  });

  it('resolves the active team from legacy agent membership when teamId is missing', () => {
    const snapshot = createInitialSnapshot();
    snapshot.activeTeamId = null;
    const activeAgent: Agent = {
      ...snapshot.agents[0],
      teamId: undefined,
    };
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        isLoading: false,
        isSending: false,
      },
      global: {
        },
    });

    expect(wrapper.getComponent({ name: 'AgentSidebar' }).props('teamName')).toBe(product.defaultTeamName);
    expect(wrapper.get(`[aria-label="${product.defaultTeamName}"]`).attributes('aria-pressed')).toBe('true');
  });

  it('resolves the active team from the active agent team id when no team is selected', () => {
    const snapshot = createInitialSnapshot();
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      avatar: 'SK',
      color: '#46A857',
      agentIds: ['agent-dina'],
      activeAgentId: 'agent-dina',
    });
    snapshot.activeTeamId = null;
    const activeAgent: Agent = {
      ...snapshot.agents[0],
      teamId: 'team-skwad',
    };
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        isLoading: false,
        isSending: false,
      },
      global: {
        },
    });

    expect(wrapper.get('[aria-label="Skwad"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.getComponent({ name: 'AgentSidebar' }).props('teamName')).toBe('Skwad');
  });

  it('falls back to the first team when active agent team references are stale', () => {
    const snapshot = createInitialSnapshot();
    snapshot.activeTeamId = null;
    const activeAgent: Agent = {
      ...snapshot.agents[0],
      id: 'agent-stale',
      teamId: 'team-missing',
    };
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        isLoading: false,
        isSending: false,
      },
      global: {
        },
    });

    expect(wrapper.get(`[aria-label="${product.defaultTeamName}"]`).attributes('aria-pressed')).toBe('true');
  });

  it('falls back to the first team when no active agent is selected', () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: null,
        isLoading: false,
        isSending: false,
      },
      global: {
        },
    });

    expect(wrapper.getComponent({ name: 'AgentSidebar' }).props('teamName')).toBe(product.defaultTeamName);
    expect(wrapper.text()).toContain('Dina');
    expect(wrapper.get(`[aria-label="${product.defaultTeamName}"]`).attributes('aria-pressed')).toBe('true');
  });

  it('uses product fallback title when no teams exist', () => {
    const snapshot = createEmptySnapshot();
    snapshot.teams = [];
    snapshot.activeTeamId = null;
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: null,
        isLoading: false,
        isSending: false,
      },
      global: {
        },
    });

    expect(wrapper.text()).toContain(`Welcome to ${product.name}`);
    expect(wrapper.find('.agent-sidebar').exists()).toBe(false);
  });

  it('falls back when backend runtime status is missing', () => {
    const snapshot = createInitialSnapshot();
    snapshot.backendRuntimes = [];
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
      },
      global: {
        },
    });

    expect(wrapper.text()).toContain('Dina');
    expect(wrapper.find('.agent-header').exists()).toBe(true);
  });

  it('forwards team selection and filters the sidebar to the active team', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.teams.push({
      id: 'team-empty',
      name: 'Empty Team',
      avatar: 'ET',
      color: '#46A857',
      agentIds: [],
    });
    snapshot.activeTeamId = 'team-empty';
    snapshot.activeAgentId = null;
    const wrapper = mountRealShell({ snapshot });

    expect(wrapper.get('[aria-label="Empty Team"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.agent-sidebar').exists()).toBe(true);
    expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(0);
    expect(wrapper.text()).toContain(`Welcome to ${product.name}`);

    await wrapper.get(`[aria-label="${product.defaultTeamName}"]`).trigger('click');

    expect(wrapper.emitted('select-team')).toStrictEqual([['team-app']]);
  });

  it('derives unread teams from their unread agents', () => {
    const snapshot = createInitialSnapshot();
    const otherAgent = {
      ...snapshot.agents[0]!,
      id: 'agent-other',
      teamId: 'team-other',
      name: 'Other Agent',
    };
    snapshot.agents.push(otherAgent);
    snapshot.teams.push({
      id: 'team-other',
      name: 'Other Team',
      avatar: 'OT',
      color: '#46A857',
      agentIds: [otherAgent.id],
    });
    const wrapper = mountShell({
      snapshot,
      unreadAgentIds: ['agent-jesse', otherAgent.id],
    });

    expect(wrapper.getComponent({ name: 'TeamRail' }).props('unreadTeamIds'))
      .toStrictEqual(['team-other']);
  });

  it('shows unread activity for the previously selected team while cockpit is open', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({
      snapshot,
      unreadAgentIds: ['agent-jesse'],
    });

    expect(wrapper.getComponent({ name: 'TeamRail' }).props('unreadTeamIds')).toStrictEqual([]);

    await wrapper.get('[aria-label="Cockpit"]').trigger('click');
    await flushPromises();

    expect(wrapper.getComponent({ name: 'TeamRail' }).props('unreadTeamIds'))
      .toStrictEqual(['team-app']);
    expect(wrapper.get(`[aria-label="${product.defaultTeamName}, unread activity"]`).classes())
      .toContain('team-rail__team--unread');
  });

  it('derives working teams from their active agents', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.status = { type: 'working' };
    snapshot.agents[1]!.status = { type: 'idle' };

    const wrapper = mountShell({ snapshot });

    expect(wrapper.getComponent({ name: 'TeamRail' }).props('workingTeamIds'))
      .toStrictEqual(['team-app']);
  });

  it('opens cockpit from the rail and navigates back to an agent', async () => {
    const snapshot = createInitialSnapshot();
    const loadWorkRepositories = vi.fn().mockResolvedValue([]);
    const loadGlobalWorkItems = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, totalItems: 0 });
    const wrapper = mountShell({ snapshot, loadGlobalWorkItems, loadWorkRepositories });

    await wrapper.get('[aria-label="Cockpit"]').trigger('click');

    expect(wrapper.find('.agent-cockpit').exists()).toBe(true);
    expect(wrapper.find('.agent-sidebar').exists()).toBe(false);
    expect(wrapper.find('.conversation-pane').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Cockpit"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get(`[aria-label="${product.defaultTeamName}"]`).attributes('aria-pressed')).toBe('false');
    expect(loadWorkRepositories).not.toHaveBeenCalled();
    expect(loadGlobalWorkItems).not.toHaveBeenCalled();

    await wrapper.get(`[aria-label="${product.defaultTeamName}"]`).trigger('click');

    expect(wrapper.find('.agent-cockpit').exists()).toBe(false);
    expect(wrapper.emitted('select-team')).toStrictEqual([['team-app']]);
    expect(wrapper.emitted('select-agent')).toBeUndefined();
  });

  it('persists the selected Cockpit agent ordering', async () => {
    const snapshot = createInitialSnapshot();
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, updateSettings });

    await wrapper.get('[aria-label="Cockpit"]').trigger('click');
    wrapper.getComponent({ name: 'CockpitView' }).vm.$emit('update-view-mode', 'recent');
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith({
      general: { cockpitAgentViewMode: 'recent' },
    });
  });

  it('projects each agent response into its recent cockpit card without selecting it', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.general.cockpitAgentViewMode = 'recent';
    const wrapper = mountShell({ snapshot });
    await wrapper.get('[aria-label="Cockpit"]').trigger('click');
    await wrapper.setProps({ agentConversationFor: vi.fn(agentId => ({
      codexSnapshot: codexConversationSnapshot([codexTextMessage('reply', 'assistant', `${agentId} completed.\nMore details.`)]),
      claudeSnapshot: null,
    } as AgentConversationView)) });

    for (const agent of snapshot.agents) {
      expect(wrapper.text()).toContain(`${agent.id} completed.`);
    }
    expect(wrapper.text()).not.toContain('More details.');
    expect(wrapper.emitted('select-agent')).toBeUndefined();
    wrapper.unmount();
  });

  it('opens automations from the rail without keeping a team active', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({ snapshot });

    await wrapper.get('[aria-label="Automations"]').trigger('click');

    expect(wrapper.find('.automations-view').exists()).toBe(true);
    expect(wrapper.find('.agent-sidebar').exists()).toBe(false);
    expect(wrapper.find('.conversation-pane').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Automations"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get(`[aria-label="${product.defaultTeamName}"]`).attributes('aria-pressed')).toBe('false');
    expect(wrapper.find('.automation-welcome__button').exists()).toBe(true);
  });

  it('opens a automation execution conversation from the logs view', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.automations = [{
      id: 'automation-bugs',
      name: 'GitHub bugs',
      enabled: true,
      prompt: 'Check tasks', target: { kind: 'newQuickChat' as const, teamId: 'team-app', backend: 'codex' as const },

      schedule: { intervalMinutes: 60 },
      executionLog: [{
        id: 'automation-exec-1',
        automationId: 'automation-bugs',
        startedAt: '2026-06-09T10:00:00.000Z',
        completedAt: '2026-06-09T10:01:00.000Z',
        status: 'completed',

        agentId: 'agent-jesse', agentName: 'Jesse', conversationRef: { backend: 'codex', threadId: 'thread-jesse' },
      }],
      createdAt: '2026-06-09T09:59:00.000Z',
      updatedAt: '2026-06-09T10:01:00.000Z',
    }];
    const conversationMessages = [{
      id: 'message-jesse-user',
      agentId: 'agent-jesse',
      role: 'user',
      status: 'complete',
      createdAt: '2026-06-09T10:00:02.000Z',
      parts: [{ type: 'text', text: 'Please fix cockpit from the automation.' }],
    }, {
      id: 'message-jesse-assistant',
      agentId: 'agent-jesse',
      role: 'assistant',
      status: 'complete',
      createdAt: '2026-06-09T10:00:45.000Z',
      parts: [{ type: 'text', text: 'Automation work is ready.' }],
    }];
    const readConversationMessages = vi.fn().mockResolvedValue(conversationMessages);
    const wrapper = mountShell({ snapshot, readConversationMessages });

    await wrapper.get('[aria-label="Automations"]').trigger('click');
    await wrapper.get('[aria-label="View logs for GitHub bugs"]').trigger('click');
    await wrapper.get('[aria-label="View conversation for automation-exec-1"]').trigger('click');
    await flushPromises();

    expect(readConversationMessages).toHaveBeenCalledWith({ backend: 'codex', threadId: 'thread-jesse' }, 'agent-jesse');
    expect(wrapper.emitted('select-agent')).toBeUndefined();
    expect(wrapper.find('.automations-view').exists()).toBe(true);
    expect(wrapper.find('.automation-execution-conversation-overlay').exists()).toBe(true);
    expect(wrapper.text()).toContain('Please fix cockpit from the automation.');
    expect(wrapper.text()).toContain('Automation work is ready.');
  });

  it('forwards cockpit work item assignments', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    snapshot.workBacklog.providerConfigurations.github = {
      sourceId: 'nbonamy/agent-workspace',
    };
    const item = workItem();
    const wrapper = mountShell({
      snapshot,
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
        'github:nbonamy/agent-workspace': [item],
      },
    });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    wrapper.findComponent({ name: 'BacklogView' }).vm.$emit('assign-work-item', {
      agentId: 'agent-dina',
      item,
    });
    await flushPromises();

    expect(wrapper.emitted('assign-work-item')).toStrictEqual([[{
      agentId: 'agent-dina',
      item,
    }]]);
  });

  it('loads one assigned-to-me page by default without fanning out by repository', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    }];
    const repositories: WorkSource[] = ['agent-workspace', 'multi-llm-ts'].map((name) => ({
      provider: 'github',
      id: `nbonamy/${name}`,
      owner: 'nbonamy',
      name,
      fullName: `nbonamy/${name}`,
      url: `https://github.com/nbonamy/${name}`,
      isPrivate: true,
    }));
    const loadWorkRepositories = vi.fn().mockResolvedValue(repositories);
    const loadWorkItems = vi.fn().mockResolvedValue([]);
    const loadGlobalWorkItems = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, totalItems: 0 });
    const wrapper = mountShell({ snapshot, loadWorkRepositories, loadWorkItems, loadGlobalWorkItems });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    await flushPromises();

    expect(loadWorkRepositories).toHaveBeenCalledWith('github');
    expect(loadWorkItems).not.toHaveBeenCalled();
    expect(loadGlobalWorkItems).toHaveBeenCalledWith('github', undefined, {
      assignment: 'viewer', state: 'open', pageSize: 25,
    });
    expect(wrapper.findComponent({ name: 'CockpitWorkInbox' }).props('selectedAssigneeLogin')).toBeNull();
    for (const [title, query] of [
      ['Issues: Assigned to me', { assignment: 'viewer', kind: 'issue' }],
      ['Pull requests: Created by me', { assignment: 'all', kind: 'pullRequest', involvement: 'author' }],
      ['Work: In my repositories', { assignment: 'all', kind: 'all', repositoryScope: 'owned' }],
      ['Work: Outside my repositories', { assignment: 'all', kind: 'all', repositoryScope: 'notOwned' }],
      ['Pull requests: Awaiting my review', { assignment: 'all', kind: 'pullRequest', involvement: 'reviewer' }],
    ] as const) {
      await wrapper.get('[aria-label="Backlog shortcuts"]').findAll('button').find(button => button.attributes('aria-label') === title)!.trigger('click');
      await flushPromises();
      expect(loadGlobalWorkItems).toHaveBeenLastCalledWith('github', undefined, { ...query, state: 'open', pageSize: 25 });
      expect(wrapper.get('[aria-label="Backlog shortcuts"] [aria-pressed="true"]').attributes('aria-label')).toBe(title);
    }
    await wrapper.get('[aria-label="Search work"]').trigger('click');
    const search = wrapper.get('input.cockpit-inbox__search-input');
    await search.setValue('browser');
    expect(wrapper.find('[aria-label="Backlog shortcuts"] [aria-pressed="true"]').exists()).toBe(false);
    await search.setValue('');

  });

  it('automatically loads one global page after the user remembers that scope', async () => {
    window.localStorage.setItem('cockpitGlobalScope:github', 'all');
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected', accountLabel: 'nbonamy' }];
    const repositories: WorkSource[] = ['agent-workspace', 'multi-llm-ts'].map((name) => ({
      provider: 'github', id: `nbonamy/${name}`, owner: 'nbonamy', name,
      fullName: `nbonamy/${name}`, url: `https://github.com/nbonamy/${name}`, isPrivate: true,
    }));
    const loadWorkRepositories = vi.fn().mockResolvedValue(repositories);
    const loadGlobalWorkItems = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, totalItems: 12 });
    const confirm = vi.spyOn(ElMessageBox, 'confirm');
    const wrapper = mountShell({ snapshot, loadWorkRepositories, loadGlobalWorkItems });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    await flushPromises();

    expect(confirm).not.toHaveBeenCalled();
    expect(loadGlobalWorkItems).toHaveBeenCalledTimes(1);
    expect(loadGlobalWorkItems).toHaveBeenCalledWith('github', undefined, {
      assignment: 'all', state: 'open', pageSize: 25,
    });
    expect(wrapper.findComponent({ name: 'CockpitWorkInbox' }).props('globalScope')).toBe('all');
    expect(wrapper.findComponent({ name: 'CockpitWorkInbox' }).props()).toMatchObject({ page: 1, pageSize: 25, totalItems: 12 });
  });

  it.each(['github', 'linear'] as const)('persists %s backlog favorites without loading work until the favorite is selected', async (provider) => {
    const snapshot = reactive(createInitialSnapshot());
    snapshot.workBacklog.connections = [{ provider, status: 'connected' }];
    const otherProvider = provider === 'github' ? 'linear' : 'github';
    snapshot.general.backlogRepositoryFavorites = { [otherProvider]: ['other-provider-id'] };
    const repository: WorkSource = { provider, id: 'org/repo', owner: 'org', name: 'repo', fullName: 'org/repo', url: 'https://github.com/org/repo', isPrivate: false };
    // Electron IPC rejects Vue proxies; exercise the native serialization boundary.
    const updateSettings = vi.fn(async (input: UpdateSettingsInput) => { structuredClone(input); });
    const configureWorkBacklog = vi.fn().mockResolvedValue(undefined);
    const loadWorkItems = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, updateSettings, configureWorkBacklog, loadWorkItems, workRepositoriesByProvider: { [provider]: [repository] } });
    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    await flushPromises();
    loadWorkItems.mockClear();
    configureWorkBacklog.mockClear();
    await wrapper.get('[aria-label="Add repo to favorites"]').trigger('click');
    await flushPromises();
    expect(updateSettings).toHaveBeenCalledWith({ general: { backlogRepositoryFavorites: { [provider]: ['org/repo'] } } });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(loadWorkItems).not.toHaveBeenCalled();
    expect(configureWorkBacklog).not.toHaveBeenCalled();
    await wrapper.get('.cockpit-view__repositories button[title="repo"]').trigger('click');
    await flushPromises();
    expect(configureWorkBacklog).toHaveBeenCalledWith({ provider, configuration: { sourceId: 'org/repo', assigneeLogin: null, tagName: null } });
    expect(loadWorkItems).toHaveBeenCalled();
  });

  it('remembers the explicit load-everything confirmation', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected', accountLabel: 'nbonamy' }];
    const repository: WorkSource = {
      provider: 'github', id: 'nbonamy/agent-workspace', owner: 'nbonamy', name: 'agent-workspace',
      fullName: 'nbonamy/agent-workspace', url: 'https://github.com/nbonamy/agent-workspace', isPrivate: true,
    };
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const loadGlobalWorkItems = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, totalItems: 0 });
    const wrapper = mountShell({
      snapshot,
      loadGlobalWorkItems,
      workRepositoriesByProvider: { github: [repository] },
    });
    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    await flushPromises();

    wrapper.findComponent({ name: 'BacklogView' }).vm.$emit('select-global-scope', 'all');
    await flushPromises();

    expect(window.localStorage.getItem('cockpitGlobalScope:github')).toBe('all');
    expect(loadGlobalWorkItems).toHaveBeenLastCalledWith('github', undefined, {
      assignment: 'all', state: 'open', pageSize: 25,
    });
  });

  it('navigates global pages and reuses cached pages when going back', async () => {
    window.localStorage.setItem('cockpitGlobalScope:github', 'all');
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected', accountLabel: 'nbonamy' }];
    const first = workItem({ id: 'nbonamy/one#1', sourceId: 'nbonamy/one', sourceName: 'nbonamy/one', number: 1 });
    const second = workItem({ id: 'nbonamy/two#2', sourceId: 'nbonamy/two', sourceName: 'nbonamy/two', number: 2 });
    const loadGlobalWorkItems = vi.fn()
      .mockResolvedValueOnce({ items: [first], nextCursor: 'opaque-next' })
      .mockResolvedValueOnce({ items: [second] });
    const wrapper = mountShell({
      snapshot,
      loadGlobalWorkItems,
    });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');
    await flushPromises();
    wrapper.findComponent({ name: 'BacklogView' }).vm.$emit('change-work-items-page', 2);
    await flushPromises();

    expect(loadGlobalWorkItems).toHaveBeenNthCalledWith(2, 'github', undefined, {
      assignment: 'all', state: 'open', cursor: 'opaque-next', pageSize: 25,
    });
    expect(wrapper.findComponent({ name: 'CockpitWorkInbox' }).props()).toMatchObject({ items: [second], page: 2, hasNextPage: false });

    wrapper.findComponent({ name: 'BacklogView' }).vm.$emit('change-work-items-page', 1);
    await flushPromises();
    expect(loadGlobalWorkItems).toHaveBeenCalledTimes(2);
    expect(wrapper.findComponent({ name: 'CockpitWorkInbox' }).props()).toMatchObject({ items: [first], page: 1, hasNextPage: true });
  });
});
