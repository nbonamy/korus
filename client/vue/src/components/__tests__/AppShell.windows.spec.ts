import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createMission } from '@workspace/core/missions';
import { windowState } from '../../window-state';
import { agentDisplayName } from '@workspace/core/agent-display';
import { mountShell } from './app-shell-test-harness';

afterEach(() => {
  windowState.scope.value = 'workspace';
  windowState.teamId.value = null;
  windowState.agentId.value = null;
  windowState.branch.value = null;
  windowState.missionId.value = null;
  document.body.innerHTML = '';
});

describe('AppShell in a window that shows less than the workspace', () => {
  it.each([false, true])('opens its mission, restricts navigation, and closes when deleted (compact=%s)', async compact => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: compact, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const snapshot = createInitialSnapshot();
    const team = snapshot.teams[0]!;
    const mission = createMission(snapshot, { outcome: 'Ship billing', workflowType: 'shapeAndShipFeature', teamId: team.id, orchestratorMemberId: snapshot.agents[0]!.id });
    const other = createMission(snapshot, { outcome: 'Other mission', workflowType: 'shapeAndShipFeature', teamId: team.id, orchestratorMemberId: snapshot.agents[0]!.id });
    localStorage.setItem('app.activeMissionId', other.id);
    windowState.scope.value = 'mission';
    windowState.teamId.value = team.id;
    windowState.missionId.value = mission.id;
    windowState.windowId.value = 2;
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const wrapper = mountShell({ snapshot });
    try {
      await nextTick();
      expect(wrapper.get('.mission-workspace h1').text()).toBe('Ship billing');
      expect(document.title).toBe(`Ship billing · ${team.name}`);
      expect(wrapper.find('.team-rail').exists()).toBe(false);
      expect(wrapper.find('.agent-sidebar').exists()).toBe(false);
      expect(localStorage.getItem('app.activeMissionId')).toBe(other.id);
      const next = structuredClone(snapshot);
      next.missions = next.missions!.filter(candidate => candidate.id !== other.id);
      await wrapper.setProps({ snapshot: next });
      expect(close).not.toHaveBeenCalled();
      next.missions = [];
      next.agents = [];
      next.teams[0]!.agentIds = [];
      await wrapper.setProps({ snapshot: { ...next } });
      expect(close).toHaveBeenCalledOnce();
    } finally { wrapper.unmount(); close.mockRestore(); windowState.windowId.value = null; vi.unstubAllGlobals(); }
  });
  it('shows everything in a workspace window', () => {
    const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true });
    expect(wrapper.find('.team-rail').exists()).toBe(true);
    expect(wrapper.text()).toMatch(/Quick chat/);
  });

  it('drops the rail in a team window and keeps the team’s sidebar', () => {
    windowState.scope.value = 'team';
    const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true });
    expect(wrapper.find('.team-rail').exists()).toBe(false);
    expect(wrapper.find('.agent-sidebar').exists()).toBe(true);
    expect(wrapper.classes()).toContain('app-shell--no-rail');
  });

  it.each(['team', 'feature', 'workspace'] as const)('limits quick-open choices and selection to the %s scope', async scope => {
    const snapshot = createInitialSnapshot();
    const team = snapshot.teams[0]!;
    const first = snapshot.agents[0]!;
    first.name = 'Inside feature';
    first.teamId = team.id;
    first.workspace = { kind: 'git', folder: '/src/repo', repositoryName: 'repo', repositoryRoot: '/src/repo', primaryWorktreeRoot: '/src/repo', isLinkedWorktree: false, updatedAt: '', branch: 'feature' };
    const otherBranch = { ...first, id: 'other-branch', name: 'Other branch', workspace: { ...first.workspace, branch: 'other' } };
    const otherTeam = { ...first, id: 'other-team-agent', name: 'Other team agent', teamId: 'other-team' };
    snapshot.agents = [first, otherBranch, otherTeam];
    team.agentIds = [first.id, otherBranch.id];
    snapshot.teams.push({ id: 'other-team', name: 'Other team', agentIds: [otherTeam.id] });
    snapshot.activeAgentId = first.id;
    const localMission = createMission(snapshot, { outcome: 'Local mission', workflowType: 'shapeAndShipFeature', teamId: team.id, orchestratorMemberId: first.id });
    const outsideMission = createMission(snapshot, { outcome: 'Outside mission', workflowType: 'shapeAndShipFeature', teamId: otherTeam.teamId, orchestratorMemberId: otherTeam.id });
    windowState.scope.value = scope;
    windowState.teamId.value = scope === 'workspace' ? null : team.id;
    windowState.branch.value = scope === 'feature' ? 'feature' : null;
    const wrapper = mountShell({ snapshot, stubAgentWorkspace: true });
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
      await nextTick();
      const palette = wrapper.getComponent({ name: 'AgentQuickOpen' });
      expect(palette.text()).toContain('Inside feature');
      expect(palette.text().includes('Other branch')).toBe(scope !== 'feature');
      expect(palette.text().includes('Other team agent')).toBe(scope === 'workspace');
      expect(palette.text().includes('Local mission')).toBe(scope !== 'feature');
      expect(palette.text().includes('Outside mission')).toBe(scope === 'workspace');
      // A selection that was queued before choices changed must still obey the scope.
      if (scope !== 'workspace') {
        palette.vm.$emit('select', { agentId: otherTeam.id, teamId: otherTeam.teamId });
        palette.vm.$emit('select-mission', outsideMission.id);
        if (scope === 'feature') {
          palette.vm.$emit('select', { agentId: otherBranch.id, teamId: team.id });
          palette.vm.$emit('select-mission', localMission.id);
        }
        await nextTick();
        expect(wrapper.emitted('select-team') ?? []).toEqual([]);
        expect(wrapper.emitted('select-agent') ?? []).toEqual([]);
      }
      await palette.get('input').setValue('Inside feature');
      await palette.get('input').trigger('keydown.enter');
      await nextTick();
      expect(wrapper.emitted('select-agent')?.at(-1)).toEqual([first.id]);
    } finally { wrapper.unmount(); }
  });

  describe('a feature window', () => {
    function featureSnapshot() {
      const snapshot = createInitialSnapshot();
      const teamId = snapshot.teams[0]!.id;
      snapshot.agents.forEach((agent, index) => {
        agent.teamId = teamId;
        agent.workspace = { kind: 'git', branch: index === 0 ? 'feat1' : 'feat2' } as never;
      });
      windowState.scope.value = 'feature';
      windowState.teamId.value = teamId;
      windowState.branch.value = 'feat1';
      return snapshot;
    }

    it('shows only the agents of its branch, with nothing that creates anything', () => {
      const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true, snapshot: featureSnapshot() });
      expect(wrapper.find('.team-rail').exists()).toBe(false);
      expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(1);
      expect(wrapper.find('.agent-sidebar__start-work').exists()).toBe(false);
      expect(wrapper.text()).not.toMatch(/Quick chat|New mission|Add project/);
    });

    it('lists its agents in the order the team’s own sidebar does', () => {
      const snapshot = createInitialSnapshot();
      const teamId = snapshot.teams[0]!.id;
      const make = (id: string, repository: string, branch: string) => ({
        ...structuredClone(snapshot.agents[0]!), id, name: id, teamId,
        workspace: { kind: 'git', repositoryName: repository, primaryWorktreeRoot: `/src/${repository}`, branch, isLinkedWorktree: branch !== 'main' } as never,
      });
      // The team lists the api repository first, so its feature agent comes before web's even though web is earlier in the list.
      snapshot.agents = [make('api-main', 'api', 'main'), make('web-feature', 'web', 'feat1'), make('api-feature', 'api', 'feat1')];
      snapshot.teams[0]!.agentIds = snapshot.agents.map(agent => agent.id);
      windowState.scope.value = 'feature';
      windowState.teamId.value = teamId;
      windowState.branch.value = 'feat1';
      const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true, snapshot });
      expect(wrapper.findAll('.agent-sidebar__agent').map(row => row.text())).toEqual([
        expect.stringContaining('api-feature'),
        expect.stringContaining('web-feature'),
      ]);
    });

    it('shows an agent added to the branch afterwards, and not one added to another', async () => {
      const snapshot = featureSnapshot();
      const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true, snapshot });
      expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(1);

      const added = (id: string, branch: string) => ({ ...structuredClone(snapshot.agents[0]!), id, name: id, workspace: { kind: 'git', branch } as never });
      const next = structuredClone(snapshot);
      next.agents.push(added('agent-other', 'feat2'));
      next.teams[0]!.agentIds.push('agent-other');
      await wrapper.setProps({ snapshot: next });
      expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(1);

      const withNew = structuredClone(next);
      withNew.agents.push(added('agent-new', 'feat1'));
      withNew.teams[0]!.agentIds.push('agent-new');
      await wrapper.setProps({ snapshot: withNew });
      expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(2);
    });
  });

  describe('window titles, which the Window menu lists', () => {
    const titled = (snapshot = createInitialSnapshot()) => {
      const wrapper = mountShell({ stubAgentWorkspace: true, snapshot });
      return { wrapper, title: () => document.title };
    };

    it('names a workspace window for its agent and team', () => {
      const snapshot = createInitialSnapshot();
      const agent = snapshot.agents.find(candidate => candidate.id === snapshot.activeAgentId)!;
      const { title } = titled(snapshot);
      expect(title()).toBe(`${agentDisplayName(agent)} · ${snapshot.teams.find(team => team.id === snapshot.activeTeamId)!.name}`);
    });

    it('names an agent window for its agent, and a team window for its team', () => {
      const snapshot = createInitialSnapshot();
      const agent = snapshot.agents.find(candidate => candidate.id === snapshot.activeAgentId)!;
      windowState.scope.value = 'agent';
      expect(titled(snapshot).title()).toBe(agentDisplayName(agent));
      windowState.scope.value = 'team';
      expect(titled(snapshot).title()).toBe(snapshot.teams.find(team => team.id === snapshot.activeTeamId)!.name);
    });

    it('names a feature window for its label and team', () => {
      const snapshot = createInitialSnapshot();
      const team = snapshot.teams.find(candidate => candidate.id === snapshot.activeTeamId)!;
      team.featureLabels = { feat1: 'Account settings' };
      windowState.scope.value = 'feature';
      windowState.teamId.value = team.id;
      windowState.branch.value = 'feat1';
      expect(titled(snapshot).title()).toBe(`Account settings · ${team.name}`);
    });
  });

  describe('panes a window starts with', () => {
    const startWindow = (snapshot: ReturnType<typeof createInitialSnapshot>, setup: Record<string, unknown>) => {
      Object.assign(window.app!, { getWindowContext: vi.fn().mockResolvedValue({ windowId: 2, viewState: { setup }, nativeOwners: [], composerDrafts: {} }) });
      return windowState.start({
        api: () => window.app, agentExists: id => snapshot.agents.some(agent => agent.id === id),
        showAgent: vi.fn(), teamExists: () => true, showTeam: vi.fn(), applyDraft: vi.fn(),
      });
    };

    it('opens the tabs it was given and reports them back to main, so a relaunch and a new window can start from them', async () => {
      vi.useFakeTimers();
      try {
        const snapshot = createInitialSnapshot();
        const agentId = snapshot.agents[0]!.id;
        const pane = { open: true, width: 520, activeTab: 'browser', tabs: ['review', 'browser'], browserUrl: 'https://example.com/' };
        mountShell({ stubAgentWorkspace: true, snapshot });
        await startWindow(snapshot, { [agentId]: pane, 'agent-gone': pane });
        await nextTick();
        vi.advanceTimersByTime(300);
        expect(window.app!.setWindowSetup).toHaveBeenCalledExactlyOnceWith({ [agentId]: pane });
      } finally { windowState.stop(); vi.useRealTimers(); }
    });

    it('reports nothing for a window that has nothing open', async () => {
      vi.useFakeTimers();
      try {
        mountShell({ stubAgentWorkspace: true });
        vi.advanceTimersByTime(1000);
        expect(window.app!.setWindowSetup).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });
  });

  it('has no navigation at all in a window for one agent', () => {
    windowState.scope.value = 'agent';
    const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true });
    expect(wrapper.find('.app-shell__nav').exists()).toBe(false);
    expect(wrapper.classes()).toContain('app-shell--chromeless');
  });

  it('keeps an agent window on its agent without reading or overwriting the team split', async () => {
    const snapshot = createInitialSnapshot();
    const team = snapshot.teams[0]!;
    const [first, second] = snapshot.agents;
    snapshot.agents.forEach(agent => { agent.teamId = team.id; });
    team.agentIds = snapshot.agents.map(agent => agent.id);
    team.activeAgentId = first!.id;
    snapshot.activeTeamId = team.id;
    snapshot.activeAgentId = first!.id;
    windowState.scope.value = 'agent';
    windowState.agentId.value = first!.id;
    const key = `app:splitWorkspace:v1:${team.id}`;
    const saved = JSON.stringify({ layout: '2-vertical', panes: [{ id: 1, agentId: first!.id }, { id: 2, agentId: second!.id }], focusedPaneId: 2, ratios: { columns: 0.5, rows: 0.5 } });
    localStorage.setItem(key, saved);
    const wrapper = mountShell({ snapshot, stubAgentWorkspace: true });
    try {
      await nextTick();
      expect(wrapper.emitted('select-agent') ?? []).toEqual([]);
      expect(wrapper.findComponent({ name: 'AgentWorkspace' }).attributes('split-headers')).toBe('false');
    } finally {
      wrapper.unmount();
      expect(localStorage.getItem(key)).toBe(saved);
      localStorage.removeItem(key);
    }
  });
});
