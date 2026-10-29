import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { ElPopover } from 'element-plus';
import { computed, ref } from 'vue';
import { backendChoicesKey } from '../backend-selection';
import { describe, expect, it, vi } from 'vitest';
import AgentSidebar from '../AgentSidebar.vue';
import type { Agent, AgentBackend } from '@workspace/core/contracts';

import { agents } from './agent-sidebar-test-harness';

describe('AgentSidebar sessions', () => {
  it('does not stack an extra header background over the sidebar tint', () => {
    const wrapper = mount(AgentSidebar, {
      attachTo: document.body,
      props: { agents: [], activeAgentId: null, teamName: 'Team' },
    });
    expect(getComputedStyle(wrapper.get('header').element).background).toBe('rgba(0, 0, 0, 0)');
    wrapper.unmount();
  });

  it('hides idle dots at rest without hiding unread or working indicators', async () => {
    const idle: Agent = { ...agents[0]!, status: { type: 'idle' } };
    const wrapper = mount(AgentSidebar, {
      attachTo: document.body,
      props: { agents: [idle], activeAgentId: idle.id, teamName: 'Team' },
    });
    const dot = () => wrapper.get('.agent-sidebar__status').element;
    expect(getComputedStyle(dot()).visibility).toBe('hidden');

    await wrapper.setProps({ activeAgentId: null, unreadAgentIds: [idle.id] });
    expect(getComputedStyle(dot()).visibility).toBe('visible');
    await wrapper.setProps({ unreadAgentIds: [], agents: [{ ...idle, status: { type: 'working' } }] });
    expect(getComputedStyle(dot()).visibility).toBe('visible');
    wrapper.unmount();
  });

  it('clips long repository text inside its label without clipping the icon or actions', () => {
    const source = agents[0]!;
    const name = 'a-very-long-project-name-that-does-not-fit-in-the-sidebar';
    const wrapper = mount(AgentSidebar, {
      attachTo: document.body,
      props: { agents: [{ ...source, workspace: { ...source.workspace!, repositoryName: name } }], activeAgentId: source.id, teamName: 'Team' },
    });
    const label = wrapper.get('.agent-sidebar__workspace-label');
    const text = label.get('strong');
    expect(text.text()).toBe(name);
    expect(getComputedStyle(label.element).overflow).toBe('hidden');
    expect(getComputedStyle(text.element).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(text.element).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(text.element).maxWidth).toBe('100%');
    const header = label.element.parentElement!;
    expect(header.querySelector('.repository-icon-picker')).not.toBeNull();
    expect(header.querySelector('.agent-sidebar__workspace-actions')).not.toBeNull();
    expect(label.find('.repository-icon-picker').exists()).toBe(false);
  });

  it('does not reveal engine icons solely because a selected Mission row retains focus', async () => {
    const { createMission } = await import('@workspace/core/missions');
    const { createInitialSnapshot } = await import('@workspace/core/snapshot-construction');
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, {
      outcome: 'Add team billing', workflowType: 'shapeAndShipFeature',
      teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id,
    });
    const wrapper = mount(AgentSidebar, {
      attachTo: document.body,
      props: { agents, missions: [mission], activeMissionId: mission.id, activeAgentId: null, teamName: 'Team' },
      global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } },
    });
    const missionRow = wrapper.get<HTMLButtonElement>('[data-group-kind="missions"] .agent-sidebar__agent');
    missionRow.element.focus();

    expect(missionRow.attributes('aria-pressed')).toBe('true');
    expect(wrapper.element.matches(':hover')).toBe(false);
    expect(document.activeElement).toBe(missionRow.element);
    const engine = wrapper.get('.agent-sidebar__engine');
    expect(getComputedStyle(engine.element).display).toBe('none');
    const agentRow = engine.element.closest('.agent-sidebar__agent')!;
    expect(getComputedStyle(agentRow).getPropertyValue('--agent-sidebar-engine-track')).toBe('');
    wrapper.unmount();
  });

  it('identifies each engine before status without taking space while hidden, including quick chats and input requests', async () => {
    const claude: Agent = { ...agents[1]!, backend: 'claude', backendDefaults: { kind: 'claude' }, sessionKind: 'quickChat', status: { type: 'awaitingInput' } };
    const enabled = ref<AgentBackend[]>(['codex', 'claude']);
    const wrapper = mount(AgentSidebar, {
      props: { agents: [agents[0]!, claude], activeAgentId: null, teamName: 'Team' },
      global: { provide: { [backendChoicesKey as symbol]: computed(() => enabled.value) } },
    });
    const rows = [agents[0]!, claude].map(agent => wrapper.get(`[data-reorder-id="${agent.id}"]`));
    const icons = rows.map(row => row.get('[role="img"]'));
    expect(icons.map(icon => icon.attributes('aria-label'))).toEqual(['Codex', 'Claude Code']);
    for (const [index, icon] of icons.entries()) {
      expect(icon.element.nextElementSibling?.getAttribute('aria-label')).toBe(index === 0 ? 'Idle' : 'Awaiting input');
      expect(getComputedStyle(icon.element).display).toBe('none');
    }
    await wrapper.setProps({ agents: [agents[0]!, { ...claude, backend: 'codex', backendDefaults: { kind: 'codex' } }] });
    expect(rows[1]!.get('[role="img"]').attributes('aria-label')).toBe('Codex');
    await rows[1]!.trigger('click');
    expect(wrapper.emitted('select-agent')).toEqual([[claude.id]]);
    enabled.value = ['codex'];
    await flushPromises();
    expect(wrapper.findAll('.agent-sidebar__engine')).toHaveLength(0);
  });

  it('keeps the input label visible over unread and shortcut indicators until the agent resumes', async () => {
    const waiting: Agent = { ...agents[0]!, status: { type: 'awaitingInput' } };
    const wrapper = mount(AgentSidebar, {
      props: { agents: [waiting], activeAgentId: null, teamName: 'Team', unreadAgentIds: [waiting.id], quickSwitchShortcutsVisible: true },
    });
    const row = wrapper.get('.agent-sidebar__agent');
    expect(row.get('[aria-label="Awaiting input"]').text()).toBe('Input');
    expect(row.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(false);
    await row.trigger('click');
    expect(wrapper.emitted('select-agent')).toEqual([[waiting.id]]);
    await wrapper.setProps({ unreadAgentIds: [] });
    expect(row.get('[aria-label="Awaiting input"]').text()).toBe('Input');
    await wrapper.setProps({ agents: [{ ...waiting, status: { type: 'working' } }], quickSwitchShortcutsVisible: false });
    expect(row.text()).not.toContain('Input');
    expect(row.find('[aria-label="Working"]').exists()).toBe(true);
  });

  it('renders the selected team name, repository headers, branch sessions, statuses, and active selection', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
      },
      global: {
        components: { ElPopover },
      },
    });

    expect(wrapper.get('.agent-sidebar__header strong').text()).toBe(product.name);
    const view = wrapper.get('button[aria-label="Agent view"]');
    expect(view.find('svg').exists()).toBe(true);
    expect(view.text()).toBe('');
    await view.trigger('click');
    await flushPromises();
    expect(view.attributes('aria-expanded')).toBe('true');
    expect(document.body.textContent).toContain('Organize agents by');
    const menu = document.body.querySelector('[role="menu"][aria-label="Organize agents by"]')!;
    const options = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(options.map(option => option.textContent?.trim())).toStrictEqual(['Repository', 'Activity']);
    expect(options.every(option => option.querySelector('svg'))).toBe(true);
    expect(options[0]!.querySelectorAll('svg')).toHaveLength(1);
    expect(options[0]!.firstElementChild?.classList.contains('tabler-icon-check')).toBe(true);
    expect(options[1]!.firstElementChild?.classList.contains('tabler-icon-bell')).toBe(true);
    options[1]!.click();
    await flushPromises();
    expect(view.attributes('aria-expanded')).toBe('false');
    await view.trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(view.attributes('aria-expanded')).toBe('true'));
    const selectedActivity = document.body.querySelector('[role="menuitemradio"][aria-checked="true"]')!;
    expect(selectedActivity.textContent?.trim()).toBe('Activity');
    expect(selectedActivity.querySelectorAll('svg')).toHaveLength(1);
    expect(selectedActivity.firstElementChild?.classList.contains('tabler-icon-check')).toBe(true);
    await view.trigger('keydown', { key: 'Escape' });
    expect(view.attributes('aria-expanded')).toBe('false');
    await view.trigger('click');
    await vi.waitFor(() => expect(view.attributes('aria-expanded')).toBe('true'));
    [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(option => option.textContent?.trim() === 'Repository')!.click();
    await flushPromises();
    await wrapper.setProps({ teamName: 'Research' });
    expect(wrapper.get('.agent-sidebar__header strong').text()).toBe('Research');
    expect(wrapper.get('.agent-sidebar__header strong').attributes('title')).toBe('Research');
    expect(wrapper.text()).toContain('id8');
    expect(wrapper.text()).toContain('Dina');
    expect(wrapper.text()).toContain('multi-llm-ts');
    expect(wrapper.text()).toContain('Jesse');
    expect(wrapper.find('.agent-sidebar__agent--active').text()).toContain('Dina');
    expect(wrapper.find('.agent-sidebar__agent--active').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('.agent-sidebar__session-title--active').text()).toBe('Dina');
    expect(wrapper.findAll('.agent-sidebar__session-title--active')).toHaveLength(1);
    expect(wrapper.find('[aria-label="Working"]').exists()).toBe(true);
  });

  it('organizes live activity in priority order, ages recent work, and restores each team’s client-local choice', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const base = agents[0]!;
    const items: Agent[] = [
      { ...base, id: 'waiting', name: 'Waiting', status: { type: 'awaitingInput' } },
      { ...base, id: 'recent', name: 'Recent', status: { type: 'idle' }, hasSubmittedPrompt: true, lastActivityAt: '2026-10-15T11:59:00Z' },
      { ...base, id: 'created', name: 'Created', status: { type: 'idle' }, hasSubmittedPrompt: false, createdAt: '2026-10-15T12:00:00Z' },
      { ...base, id: 'working', name: '', conversationTitle: 'A conversation title', status: { type: 'working' } },
      { ...base, id: 'idle', name: 'Idle', status: { type: 'idle' }, hasSubmittedPrompt: true, lastActivityAt: '2026-10-15T11:00:00Z' },
      { ...base, id: 'unread', name: 'Unread', status: { type: 'idle' } },
      { ...base, id: 'review', name: 'Review', status: { type: 'idle' }, threadFlags: { ready_for_review: true } },
      { ...base, id: 'error', name: 'Error', status: { type: 'error', message: 'Turn failed' } },
      { ...base, id: 'plan', name: 'Plan', status: { type: 'idle' }, planReview: { id: 'plan', conversationId: null, turnId: 'turn', markdown: '# Plan', status: 'pending' } },
      { ...base, id: 'new', name: 'New', status: { type: 'idle' }, hasSubmittedPrompt: false, lastActivityAt: '2026-10-15T12:00:00Z' },
    ];
    const props = { agents: items, activeAgentId: 'working', unreadAgentIds: ['unread', 'recent', 'waiting'], teamId: 'one', teamName: 'One', repositoryIcons: { 'remote:github.com/nbonamy/id8': '🦞' } };
    const wrapper = mount(AgentSidebar, {
      props,
      global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } },
    });
    const choose = async (label: string) => {
      await wrapper.get('button[aria-label="Agent view"]').trigger('click');
      const option = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent?.trim() === label)!;
      option.click();
      await flushPromises();
    };
    try {
      await choose('Activity');
      const sections = () => wrapper.findAll('[data-activity-group]');
      const ids = (group: string) => wrapper.get(`[data-activity-group="${group}"]`).findAll('[data-reorder-id]').map(row => row.attributes('data-reorder-id'));
      expect(sections().map(section => section.get('header').text())).toStrictEqual(['Needs input', 'Done', 'Working', 'Idle']);
      expect(ids('attention')).toStrictEqual(['waiting']);
      expect(wrapper.get('[data-reorder-id="waiting"] .agent-avatar').text()).toBe('🦞');
      expect(wrapper.find('[data-reorder-id="waiting"] .agent-sidebar__session-icon').exists()).toBe(false);
      expect(ids('recent')).toStrictEqual(['unread', 'recent', 'created']);
      expect(ids('working')).toStrictEqual(['working']);
      const row = (id: string) => wrapper.get(`[data-reorder-id="${id}"]`);
      const hasUnread = (id: string) => row(id).find('.agent-sidebar__activity-unread').exists();
      const age = (id: string) => row(id).find('.agent-sidebar__activity-time');
      // Needs input: an age, never a dot (it is implicitly unread).
      expect(hasUnread('waiting')).toBe(false);
      expect(age('waiting').exists()).toBe(true);
      // Done and Idle: the unread dot, or else an age.
      for (const id of ['recent', 'unread']) expect([hasUnread(id), age(id).exists()]).toStrictEqual([true, false]);
      expect([hasUnread('created'), age('created').text()]).toStrictEqual([false, 'now']);
      expect(age('idle').text()).toBe('1h');
      // Working: how long it has been working.
      expect(age('working').exists()).toBe(true);
      // Every row keeps its backend icon (revealed on hover), unread or not.
      for (const id of ['waiting', 'recent', 'unread', 'created', 'working', 'idle']) expect(row(id).findAll('.agent-sidebar__engine')).toHaveLength(1);
      for (const [id, title, subtitle] of [['waiting', 'Waiting', 'id8 · main'], ['working', 'id8', 'main']]) {
        const row = wrapper.get(`[data-reorder-id="${id}"]`);
        expect(row.get('.agent-sidebar__session-title').text()).toBe(title);
        expect(row.get('.agent-sidebar__session-context').text()).toBe(subtitle);
      }
      expect(ids('idle')).toStrictEqual(['new', 'idle', 'review', 'error', 'plan']);
      expect(wrapper.get('[data-reorder-id="working"]').attributes('draggable')).toBe('false');
      await vi.advanceTimersByTimeAsync(250);
      await wrapper.setProps({ agents: items.map(agent => agent.id === 'working' ? { ...agent, status: { type: 'idle' }, hasSubmittedPrompt: true, lastActivityAt: new Date().toISOString() } : agent) });
      expect(ids('recent')).toContain('working');
      expect(wrapper.get('.agent-sidebar__agent--active').attributes('data-reorder-id')).toBe('working');
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
      expect(ids('recent')).toStrictEqual(['unread', 'recent']);
      expect(ids('idle').slice(0, 3)).toStrictEqual(['working', 'new', 'idle']);
      await wrapper.setProps({ unreadAgentIds: [] });
      expect(wrapper.find('[data-activity-group="recent"]').exists()).toBe(false);
      expect(ids('idle').slice(0, 4)).toStrictEqual(['working', 'new', 'recent', 'idle']);
      await wrapper.setProps({ teamId: 'two', teamName: 'Two' });
      expect(sections()).toHaveLength(0);
      await wrapper.setProps({ teamId: 'one', teamName: 'One' });
      expect(sections().length).toBeGreaterThan(0);
      wrapper.unmount();
      const restored = mount(AgentSidebar, { props });
      expect(restored.find('[data-activity-group="attention"]').exists()).toBe(true);
      restored.unmount();
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });

  it('sorts only Idle by normal repository order or recent activity and remembers each team’s choice', async () => {
    const items: Agent[] = [
      { ...agents[0]!, id: 'old', name: 'Older', status: { type: 'idle' }, lastActivityAt: '2026-01-01T10:00:00Z' },
      { ...agents[1]!, id: 'latest', name: 'Latest', status: { type: 'idle' }, lastActivityAt: '2026-01-03T10:00:00Z' },
      { ...agents[0]!, id: 'middle', name: 'Middle', status: { type: 'idle' }, lastActivityAt: '2026-01-02T10:00:00Z' },
      { ...agents[0]!, id: 'working', status: { type: 'working' } },
    ];
    const props = { agents: items, activeAgentId: null, teamId: 'idle-one', teamName: 'One' };
    const wrapper = mount(AgentSidebar, { props, attachTo: document.body, global: { components: { ElPopover } } });
    const choose = async (menu: string, label: string) => {
      await wrapper.get(`button[aria-label="${menu}"]`).trigger('click');
      const menuLabel = menu === 'Agent view' ? 'Organize agents by' : menu;
      await flushPromises();
      await vi.waitFor(() => expect(wrapper.get(`button[aria-label="${menu}"]`).attributes('aria-expanded')).toBe('true'));
      const options = document.body.querySelector(`[role="menu"][aria-label="${menuLabel}"]`)!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
      if (menu === 'Sort idle agents') {
        const selected = [...options].find(button => button.getAttribute('aria-checked') === 'true')!;
        expect(selected.querySelectorAll('svg')).toHaveLength(1);
        expect(selected.firstElementChild?.classList.contains('tabler-icon-check')).toBe(true);
      }
      [...options].find(button => button.textContent?.trim() === label)!.click();
      await flushPromises();
    };
    const idleIds = () => wrapper.get('[data-activity-group="idle"]').findAll('[data-reorder-id]').map(row => row.attributes('data-reorder-id'));
    try {
      expect(wrapper.find('button[aria-label="Sort idle agents"]').exists()).toBe(false);
      await choose('Agent view', 'Activity');
      expect(idleIds()).toStrictEqual(['latest', 'middle', 'old']);
      await choose('Sort idle agents', 'Repository');
      expect(idleIds()).toStrictEqual(['old', 'middle', 'latest']);
      expect(wrapper.get('[data-activity-group="working"] [data-reorder-id]').attributes('data-reorder-id')).toBe('working');
      await choose('Sort idle agents', 'Recent activity');
      expect(idleIds()).toStrictEqual(['latest', 'middle', 'old']);
      await choose('Sort idle agents', 'Repository');
      await wrapper.setProps({ teamId: 'idle-two' });
      await choose('Agent view', 'Activity');
      expect(idleIds()).toStrictEqual(['latest', 'middle', 'old']);
      await wrapper.setProps({ teamId: 'idle-one' });
      expect(idleIds()).toStrictEqual(['old', 'middle', 'latest']);
      wrapper.unmount();
      const restored = mount(AgentSidebar, { props });
      try {
        expect(restored.get('[data-activity-group="idle"]').findAll('[data-reorder-id]').map(row => row.attributes('data-reorder-id'))).toStrictEqual(['old', 'middle', 'latest']);
      } finally { restored.unmount(); }
    } finally { wrapper.unmount(); }
  });

  it('collapses and expands a repository by clicking its title', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    let repositoryTitle = wrapper.findAll('.agent-sidebar__workspace-label')[0]!;
    let firstSession = wrapper.findAll('.agent-sidebar__agent')[0]!;
    expect(firstSession.attributes('style') ?? '').not.toContain('display: none');

    await repositoryTitle.trigger('click');
    expect(wrapper.emitted('update-collapsed-repositories')?.[0]).toStrictEqual([
      ['remote:github.com/nbonamy/id8'],
    ]);
    await wrapper.setProps({ collapsedRepositoryKeys: ['remote:github.com/nbonamy/id8'] });
    repositoryTitle = wrapper.findAll('.agent-sidebar__workspace-label')[0]!;
    firstSession = wrapper.findAll('.agent-sidebar__agent')[0]!;
    expect(firstSession.attributes('style') ?? '').toContain('display: none');
    expect(repositoryTitle.attributes('aria-expanded')).toBe('false');

    await repositoryTitle.trigger('click');
    expect(wrapper.emitted('update-collapsed-repositories')?.[1]).toStrictEqual([[]]);
    await wrapper.setProps({ collapsedRepositoryKeys: [] });
    repositoryTitle = wrapper.findAll('.agent-sidebar__workspace-label')[0]!;
    firstSession = wrapper.findAll('.agent-sidebar__agent')[0]!;
    expect(repositoryTitle.attributes('aria-expanded')).toBe('true');
    expect(firstSession.attributes('style') ?? '').not.toContain('display: none');
  });

  it('creates directly on main even with multiple backends enabled', async () => {
    const listRepositoryBranches = vi.fn().mockResolvedValue([{ name: 'main', isDefault: true, worktreePath: '~/src/id8' }]);
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        listRepositoryBranches,
        teamName: `${product.name}`,
      },
      global: {
        components: { ElPopover },
        provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) },
      },
    });

    const sessionMenu = wrapper.findAllComponents({ name: 'AppMenuButton' }).find((button) => (
      button.props('ariaLabel').startsWith('New session in')
    ));
    await sessionMenu?.vm.$emit('update:open', true);
    await flushPromises();
    const main = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'main')!;
    expect(main.getAttribute('aria-haspopup')).toBeNull();
    main.click();
    await flushPromises();
    await wrapper.get('[aria-label="Create agent from branch, pull request, or issue"]').trigger('click');

    expect(listRepositoryBranches).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      repositoryRoot: '~/src/id8',
    });
    expect(wrapper.emitted('create-agent-on-branch')).toStrictEqual([[{
      agentId: 'agent-dina',
      repositoryName: 'id8',
      repositoryRoot: '~/src/id8',
      originUrl: 'git@github.com:nbonamy/id8.git',
      branch: { name: 'main', isDefault: true, worktreePath: '~/src/id8' },
    }]]);
    expect(wrapper.emitted('create-agent-from-repository')).toStrictEqual([[{
      agentId: 'agent-dina',
      repositoryName: 'id8',
      repositoryRoot: '~/src/id8',
      originUrl: 'git@github.com:nbonamy/id8.git',
    }]]);
  });

  describe('remote actions on the repository menu', () => {
    const connection = (status: 'ready' | 'error') => ({ id: 'devbox', kind: 'ssh' as const, name: 'Devbox', host: 'devbox', status, createdAt: '', updatedAt: '' });
    async function openMenu(props: Record<string, unknown>) {
      const git = agents[0]!;
      if (git.workspace?.kind !== 'git') throw new Error('Expected Git fixture');
      const wrapper = mount(AgentSidebar, {
        props: {
          agents: [{ ...git, workspace: { ...git.workspace, originUrl: 'git@github.com:org/id8.git' } }],
          activeAgentId: 'agent-dina',
          listRepositoryBranches: vi.fn().mockResolvedValue([{ name: 'main', isDefault: true, worktreePath: '~/src/id8' }]),
          teamName: 'Team',
          ...props,
        },
        global: { components: { ElPopover } },
      });
      const sessionMenu = wrapper.findAllComponents({ name: 'AppMenuButton' }).find((button) => button.props('ariaLabel').startsWith('New session in'));
      await sessionMenu?.vm.$emit('update:open', true);
      await flushPromises();
      return wrapper;
    }
    const remoteButtons = () => [...document.body.querySelectorAll<HTMLButtonElement>('button[aria-label="On a remote machine"]')];

    it('offers a remote icon on each row only while a machine is ready', async () => {
      await openMenu({ remoteConnections: [connection('error')] });
      expect(remoteButtons()).toHaveLength(0);
      document.body.innerHTML = '';
      await openMenu({ remoteConnections: [connection('ready')] });
      expect(remoteButtons()).toHaveLength(2);
    });

    it('keeps the row label local and sends the remote icon to the where dialog with the origin', async () => {
      const wrapper = await openMenu({ remoteConnections: [connection('ready')] });
      remoteButtons()[1]!.click();
      await flushPromises();
      expect(wrapper.emitted('open-on-remote')).toStrictEqual([[{ action: 'new-worktree', repositoryName: 'id8', repositoryKey: 'remote:github.com/org/id8', originUrl: 'git@github.com:org/id8.git' }]]);
      expect(wrapper.emitted('create-agent-worktree-in-repository')).toBeUndefined();
    });
  });

  it('marks remote rows only in a section that spans hosts and carries the host on section actions', async () => {
    const git = agents[0]!;
    if (git.workspace?.kind !== 'git') throw new Error('Expected Git fixture');
    const origin = 'git@github.com:org/id8.git';
    const local = { ...git, id: 'local', workspace: { ...git.workspace, originUrl: origin } };
    const remote = { ...git, id: 'remote', remoteConnectionId: 'devbox', workspace: { ...git.workspace, originUrl: origin, primaryWorktreeRoot: '/srv/id8' } };
    const remoteConnections = [{ id: 'devbox', kind: 'ssh' as const, name: 'Devbox', host: 'devbox', status: 'ready' as const, createdAt: '', updatedAt: '' }];
    const wrapper = mount(AgentSidebar, {
      props: { agents: [local, remote], activeAgentId: 'local', teamName: 'Team', remoteConnections },
      global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } },
    });
    expect(wrapper.findAll('.agent-sidebar__remote-marker')).toHaveLength(1);
    expect(wrapper.get('.agent-sidebar__remote-marker').attributes('title')).toBe('Devbox');
    await wrapper.get('[aria-label="Create agent from branch, pull request, or issue"]').trigger('click');
    expect(wrapper.emitted('create-agent-from-repository')).toStrictEqual([[{ agentId: 'local', repositoryName: 'id8', repositoryRoot: '~/src/id8', originUrl: origin }]]);

    await wrapper.setProps({ agents: [remote] });
    expect(wrapper.find('.agent-sidebar__remote-marker').exists()).toBe(false);
    await wrapper.get('[aria-label="Create agent from branch, pull request, or issue"]').trigger('click');
    expect(wrapper.emitted('create-agent-from-repository')![1]).toStrictEqual([{ agentId: 'remote', repositoryName: 'id8', repositoryRoot: '/srv/id8', remoteConnectionId: 'devbox', originUrl: origin }]);
  });

  it('shows the host icon on remote-only sections and flags a host that is not connected', async () => {
    const git = agents[0]!;
    if (git.workspace?.kind !== 'git') throw new Error('Expected Git fixture');
    const remote = { ...git, id: 'remote', remoteConnectionId: 'devbox', workspace: { ...git.workspace, primaryWorktreeRoot: '/srv/id8' } };
    const connection = (status: 'ready' | 'error') => [{ id: 'devbox', kind: 'ssh' as const, name: 'Devbox', host: 'devbox', status, createdAt: '', updatedAt: '' }];
    const wrapper = mount(AgentSidebar, { props: { agents: [remote], activeAgentId: 'remote', teamName: 'Team', remoteConnections: connection('ready') } });
    const host = wrapper.get('.agent-sidebar__host');
    expect(host.attributes('title')).toBe('Devbox');
    expect(host.classes()).not.toContain('agent-sidebar__host--offline');

    await wrapper.setProps({ remoteConnections: connection('error') });
    expect(wrapper.get('.agent-sidebar__host').classes()).toContain('agent-sidebar__host--offline');
    expect(wrapper.get('.agent-sidebar__host').attributes('title')).toBe('Devbox is not connected');

    await wrapper.setProps({ agents: [{ ...remote, remoteConnectionId: undefined }] });
    expect(wrapper.find('.agent-sidebar__host').exists()).toBe(false);
  });

  it('shows repository branch loading failures in the session menu', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: [agents[0]!],
        activeAgentId: 'agent-dina',
        listRepositoryBranches: vi.fn().mockRejectedValue(new Error('offline')),
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    const sessionMenu = wrapper.findAllComponents({ name: 'AppMenuButton' }).find((button) => (
      button.props('ariaLabel').startsWith('New session in')
    ));
    await sessionMenu?.vm.$emit('update:open', true);
    await flushPromises();

    expect(document.body.textContent).toContain('Could not load branches: offline');
  });

  it('preserves default, branch, and worktree icon colors using detected workspace metadata', async () => {
    const source = agents[0]!;
    if (source.workspace?.kind !== 'git') throw new Error('Expected Git fixture');
    const workspace = { ...source.workspace, branch: 'trunk', defaultBranch: 'trunk' };
    const wrapper = mount(AgentSidebar, {
      attachTo: document.body,
      props: { agents: [{ ...source, workspace }], activeAgentId: source.id, teamName: 'Team' },
    });
    const icon = () => wrapper.get('.agent-sidebar__session-icon');
    expect(wrapper.get('.agent-sidebar__agent').attributes('data-session-kind')).toBe('main');
    expect(icon().classes()).toContain('tabler-icon-git-branch');
    expect(getComputedStyle(icon().element).color).toBe('var(--color-primary)');

    await wrapper.setProps({ agents: [{ ...source, workspace: { ...workspace, branch: 'main' } }] });
    expect(wrapper.get('.agent-sidebar__agent').attributes('data-session-kind')).toBe('branch');
    expect(icon().classes()).toContain('tabler-icon-git-branch');
    expect(getComputedStyle(icon().element).color).toBe('var(--color-success)');

    await wrapper.setProps({ agents: [{ ...source, workspace: { ...workspace, isLinkedWorktree: true } }] });
    expect(wrapper.get('.agent-sidebar__agent').attributes('data-session-kind')).toBe('worktree');
    expect(icon().classes()).toContain('tabler-icon-git-fork');
    expect(getComputedStyle(icon().element).color).toBe('var(--color-warning)');
    wrapper.unmount();
  });

  it('renders compact workspace rows with repository headers, branches, and status icons', () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        compact: true,
        teamName: `${product.name}`,
      },
      global: {
        components: { ElPopover },
      },
    });

    expect(wrapper.classes()).toContain('agent-sidebar--compact');
    expect(wrapper.findAll('.agent-sidebar__workspace-header').map((header) => header.text())).toStrictEqual(['id8', 'multi-llm-ts']);
    expect(wrapper.findAll('.agent-sidebar__meta strong').map((name) => name.text())).toStrictEqual(['Dina', 'Jesse']);
    expect(wrapper.findAll('.agent-sidebar__status')).toHaveLength(2);
    expect(wrapper.find('.agent-sidebar__branch').exists()).toBe(false);
  });

  it('renders and updates repository-specific icons', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        repositoryIcons: { '~/src/id8': '🦞' },
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    const picker = wrapper.findAllComponents({ name: 'RepositoryIconPicker' })
      .find((component) => component.props('label') === 'id8')!;
    expect(picker.props('modelValue')).toBe('🦞');
    expect(wrapper.find('.agent-sidebar__workspace-toggle').exists()).toBe(false);
    picker.vm.$emit('update:modelValue', '🚀');
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update-repository-icon')).toStrictEqual([
      [{ repositoryKey: 'remote:github.com/nbonamy/id8', repositoryRoot: '~/src/id8', icon: '🚀' }],
    ]);
  });

  it('replaces an unread agent runtime status with the unread indicator', () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        unreadAgentIds: ['agent-jesse'],
        quickSwitchShortcutsVisible: true,
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    const rows = wrapper.findAll('.agent-sidebar__agent');
    expect(rows[0]?.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(true);
    expect(rows[1]?.get('.agent-sidebar__status').classes()).toContain('agent-sidebar__status--unread');
    expect(rows[1]?.get('.agent-sidebar__status').attributes('aria-label')).toBe('Unread activity');
    expect(rows[1]?.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(false);
  });

  it('replaces the first nine status dots with Command-number shortcuts', () => {
    const manyAgents = Array.from({ length: 10 }, (_, index): Agent => ({
      ...agents[0]!,
      id: `agent-${index + 1}`,
      name: `Agent ${index + 1}`,
    }));
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: manyAgents,
        activeAgentId: manyAgents[0]!.id,
        quickSwitchShortcutsVisible: true,
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    expect(wrapper.findAll('.agent-sidebar__quick-switch-shortcut').map((shortcut) => shortcut.text()))
      .toStrictEqual(['⌘1', '⌘2', '⌘3', '⌘4', '⌘5', '⌘6', '⌘7', '⌘8', '⌘9']);
    expect(wrapper.findAll('.agent-sidebar__status')).toHaveLength(1);

    const hiddenWrapper = mount(AgentSidebar, {
      props: {
        agents: manyAgents,
        activeAgentId: manyAgents[0]!.id,
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });
    expect(hiddenWrapper.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(false);
    expect(hiddenWrapper.findAll('.agent-sidebar__status')).toHaveLength(10);
  });

  it('uses the branch fallback in an unnamed agent quick-switch label', () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: [{ ...agents[0]!, name: null }],
        activeAgentId: 'agent-dina',
        quickSwitchShortcutsVisible: true,
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    expect(wrapper.get('.agent-sidebar__quick-switch-shortcut').attributes('aria-label'))
      .toBe('Switch to main with Command 1');
  });

  it('renders only the branch as the sidebar title when the agent name is null', () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: [{ ...agents[0]!, name: null, conversationTitle: 'Previous conversation' }],
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    expect(wrapper.get('.agent-sidebar__meta strong').text()).toBe('main');
  });

  it.each([null, 'Sharing'])('keeps matching %s titles literal across repositories', (name) => {
    const computerUseAgent: Agent = {
      ...agents[0]!,
      id: 'agent-computer-use',
      name,
      folder: '~/src/computer-use',
      workspace: {
        kind: 'git',
        folder: '~/src/computer-use',
        repositoryName: 'computer-use',
        repositoryRoot: '~/src/computer-use',
        branch: 'main',
        isLinkedWorktree: false,
        primaryWorktreeRoot: '~/src/computer-use',
        updatedAt: '2026-06-05T00:00:00.000Z',
      },
    };
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: [{ ...agents[0]!, name }, computerUseAgent],
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    expect(wrapper.findAll('.agent-sidebar__meta strong').map((title) => title.text()))
      .toStrictEqual([name ?? 'main', name ?? 'main']);
  });

  it('renders persisted repository collapse state and emits controlled updates', async () => {
    const repositoryKey = 'remote:github.com/nbonamy/id8';
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: [agents[0]!],
        activeAgentId: 'agent-dina',
        collapsedRepositoryKeys: [repositoryKey],
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    const toggle = wrapper.get('[aria-label="Expand id8 sessions"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('.agent-sidebar__agent').isVisible()).toBe(false);
    await toggle.trigger('click');

    expect(wrapper.emitted('update-collapsed-repositories')).toStrictEqual([[[]]]);
  });
});

describe('mission navigation', () => {
  it('uses the native workspace-group and session-row layout for missions', async () => {
    const { createMission } = await import('@workspace/core/missions');
    const { createInitialSnapshot } = await import('@workspace/core/snapshot-construction');
    const missionSnapshot = createInitialSnapshot();
    const mission = createMission(missionSnapshot, { outcome: 'Add team billing', workflowType: 'shapeAndShipFeature', teamId: missionSnapshot.teams[0]!.id, orchestratorMemberId: missionSnapshot.agents[0]!.id });
    const wrapper = mount(AgentSidebar, {
      props: { agents: [], activeAgentId: null, teamName: 'Team' },
      global: { components: { ElPopover } },
    });
    expect(wrapper.get('.agent-sidebar__start-work').findAll('button')
      .map(button => button.text())
      .filter(label => ['Add project', 'Quick chat', 'New mission'].includes(label)))
      .toStrictEqual(['Add project', 'Quick chat', 'New mission']);
    expect(wrapper.find('.agent-sidebar__mission-action [data-icon="target-arrow"]').exists()).toBe(true);
    await wrapper.get('.agent-sidebar__mission-action').trigger('click');
    expect(wrapper.emitted('create-mission')).toStrictEqual([[]]);

    await wrapper.setProps({ activeMissionId: mission.id, missions: [mission] });
    const group = wrapper.get('[data-group-kind="missions"]');
    expect(group.get('.agent-sidebar__workspace-icon').attributes('data-icon')).toBe('target-arrow');
    expect(group.get('.agent-sidebar__workspace-label').text()).toBe('Missions');
    const row = group.get('.agent-sidebar__agent');
    expect(row.get('.agent-sidebar__session-title').text()).toBe('Add team billing');
    expect(row.get('.agent-sidebar__status').attributes('aria-label')).toBe('1/5 · Requirements');
    expect(row.attributes('aria-pressed')).toBe('true');
    await row.trigger('click');
    expect(wrapper.emitted('select-mission')).toStrictEqual([[mission.id]]);
    await row.trigger('contextmenu', { clientX: 80, clientY: 120 });
    const deleteAction = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find(button => button.textContent?.trim() === 'Delete mission');
    expect(deleteAction).toBeDefined();
    deleteAction!.click();
    await flushPromises();
    expect(wrapper.emitted('delete-mission')).toStrictEqual([[mission.id]]);
    await group.get('.agent-sidebar__workspace-label').trigger('click');
    expect(group.find('.agent-sidebar__agent').exists()).toBe(false);
  });

  it('shows a mission as needing input or unread from its agents, like an agent', async () => {
    const { createMission } = await import('@workspace/core/missions');
    const { createInitialSnapshot } = await import('@workspace/core/snapshot-construction');
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Add team billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.stageAgentIds = { requirements: 'lead' };
    mission.execution = { runs: [{ id: 'run-1', stage: 'implementation', memberId: 'm', workerId: 'api', status: 'running', skills: [], feedback: '', startedAt: '' }] } as never;
    const member = (id: string, type: 'idle' | 'working' | 'awaitingInput') => ({ ...agents[0]!, id, status: { type } }) as Agent;
    const wrapper = mount(AgentSidebar, {
      props: { agents: [member('lead', 'idle'), member('api', 'idle')], missions: [mission], activeAgentId: null, teamName: 'Team' },
      global: { components: { ElPopover } },
    });
    const dot = () => wrapper.get('[data-group-kind="missions"] .agent-sidebar__status');
    expect(dot().classes()).not.toContain('agent-sidebar__status--unread');
    expect(dot().attributes('data-status')).toBe('idle');
    await wrapper.setProps({ agents: [member('lead', 'working'), member('api', 'idle')] });
    expect(dot().attributes('data-status')).toBe('working');
    await wrapper.setProps({ unreadAgentIds: ['api'] });
    expect(dot().classes()).not.toContain('agent-sidebar__status--unread');
    expect(dot().attributes('data-status')).toBe('working');
    await wrapper.setProps({ unreadAgentIds: ['lead', 'api'] });
    expect(dot().classes()).toContain('agent-sidebar__status--unread');
    expect(dot().attributes('aria-label')).toBe('Unread activity');
    await wrapper.setProps({ agents: [member('lead', 'idle'), member('api', 'awaitingInput')] });
    const missionRow = wrapper.get('[data-group-kind="missions"]');
    const badge = missionRow.get('.agent-sidebar__input-needed');
    expect(badge.text()).toBe(wrapper.vm.$t('sidebar.input'));
    expect(badge.attributes('aria-label')).toBe(wrapper.vm.$t('status.awaitingInput'));
    expect(missionRow.find('.agent-sidebar__status').exists()).toBe(false);
    await wrapper.setProps({ agents: [member('lead', 'idle'), member('api', 'idle')] });
    expect(missionRow.find('.agent-sidebar__input-needed').exists()).toBe(false);
    expect(dot().classes()).toContain('agent-sidebar__status--unread');
    await wrapper.setProps({ unreadAgentIds: ['api'] });
    expect(dot().attributes('data-status')).toBe('idle');
  });

  it('disables mission creation while pending and surfaces creation failures', () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: [],
        activeAgentId: null,
        missionCreationError: 'Backend unavailable',
        missionCreationPending: true,
        teamName: 'Team',
      },
      global: { components: { ElPopover } },
    });

    expect(wrapper.get('.agent-sidebar__mission-action').attributes()).toMatchObject({
      'aria-busy': 'true',
      disabled: '',
    });
    expect(wrapper.get('[role="alert"]').text()).toBe('Backend unavailable');
  });
});

it('offers repository deletion from the repository header context menu', async () => {
  const wrapper = mount(AgentSidebar, { attachTo: document.body, props: { agents: [agents[0]!], activeAgentId: agents[0]!.id, teamName: 'Team' } });
  try {
    await wrapper.get('.agent-sidebar__workspace-header').trigger('contextmenu', { clientX: 80, clientY: 120 });
    const action = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.trim() === 'Delete repository');
    expect(action).toBeDefined(); action!.click(); await flushPromises();
    expect(wrapper.emitted('delete-repository')).toStrictEqual([[agents[0]!.id]]);
  } finally { wrapper.unmount(); }
});
