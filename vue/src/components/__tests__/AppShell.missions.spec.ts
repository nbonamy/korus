import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMission } from '@workspace/core/missions';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot-construction';
import type { AgentGitWorkflow } from '@workspace/core/contracts';
import { codexConversationSnapshot, codexTextMessage } from '../../test/codex-conversation-fixtures';
import { conversationControllerActions, conversationControllerState, mountShell, workItem } from './app-shell-test-harness';

const missionStorageKey = 'app.activeMissionId';

function prepareMissionLead(mission: ReturnType<typeof createMission>, workerId: string): void {
  mission.execution!.runs.push({
    id: 'mission-run-requirements', stage: 'requirements', memberId: workerId,
    workerId, status: 'running', skills: [], feedback: '', startedAt: '2026-09-19T00:00:00.000Z',
  });
}

function representGitHubRepository(agent: ReturnType<typeof createInitialSnapshot>['agents'][number], fullName: string): void {
  agent.workspace = {
    kind: 'git', folder: agent.folder!, repositoryName: fullName.split('/')[1]!, repositoryRoot: agent.folder!,
    branch: 'main', isLinkedWorktree: false, primaryWorktreeRoot: agent.folder!,
    originUrl: `git@github.com:${fullName}.git`, updatedAt: '2026-09-19T00:00:00.000Z',
  };
}

describe('AppShell missions', () => {
  it.each(['README.md', '/workspace/mission/README.md', '/tmp/telemetry-merge3-evidence.json'])('opens a rendered Mission document link in a dialog without hiding the Mission (%s)', async target => {
    const evidence = target.endsWith('.json');
    const path = evidence ? target : 'README.md';
    const content = evidence ? '{\"commit\":\"8116155c\"}' : '# Mission document';
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.folder = '/workspace/mission';
    const mission = createMission(snapshot, { outcome: 'Follow conversation links', workflowType: 'shapeAndShipFeature', teamId: agent.teamId, orchestratorMemberId: agent.id });
    prepareMissionLead(mission, agent.id);
    const previewAgentFile = vi.fn().mockResolvedValue({ kind: 'text', path, content, size: content.length });
    const wrapper = mountShell({ snapshot, realConversationPane: true, previewAgentFile,
      codexConversationSnapshot: codexConversationSnapshot([codexTextMessage('links', 'assistant', `[Readme](<${target}>)`)]),
    });
    try {
      wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
      await flushPromises();
      await wrapper.get('.mission-conversation-rail a').trigger('click');
      await flushPromises();
      expect(previewAgentFile).toHaveBeenCalledExactlyOnceWith(agent.id, path);
      expect(wrapper.get('.mission-document-dialog h2').text()).toBe(path.split('/').at(-1));
      expect(wrapper.get('.mission-document-dialog').find('[role="tablist"]').exists()).toBe(false);
      expect(wrapper.get('.mission-document-dialog').findAll('.markdown-panel, .source-preview-panel')).toHaveLength(1);
      expect(wrapper.get('.mission-document-dialog').find('[data-code-annotation-trigger]').exists()).toBe(false);
      expect(wrapper.get('.mission-document-dialog').text()).toContain(evidence ? '8116155c' : 'Mission document');
      expect(wrapper.get('.mission-conversation-rail a').isVisible()).toBe(true);
      expect(wrapper.get('.mission-stage-rail').isVisible()).toBe(true);
      expect(wrapper.get('.mission-workspace__workbench').isVisible()).toBe(true);
      const dialog = wrapper.getComponent({name:'WorkspacePreviewHost'});
      await wrapper.get('[aria-label="Close document"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('.mission-document-dialog').exists()).toBe(false);
      dialog.vm.$emit('close');
      await flushPromises();
      expect(wrapper.find('.mission-document-dialog').exists()).toBe(false);
      expect(wrapper.get('.mission-workspace__workbench').isVisible()).toBe(true);
    } finally { wrapper.unmount(); }
  });

  it('keeps one document request per Mission across agents and opens only after confirmation', async () => {
    const snapshot = createInitialSnapshot();
    const [lead, worker] = snapshot.agents;
    const mission = createMission(snapshot, { outcome: 'Review documents', workflowType: 'shapeAndShipFeature', teamId: lead!.teamId, orchestratorMemberId: lead!.id });
    prepareMissionLead(mission, lead!.id);
    mission.execution!.runs.push({ ...mission.execution!.runs[0]!, id:'worker-run', stage:'implementation', workerId:worker!.id });
    const other = { ...lead!, id:'other-document-agent', name:'Other agent' };
    snapshot.agents.push(other);
    snapshot.teams.find(team => team.id === other.teamId)!.agentIds.push(other.id);
    const otherMission = createMission(snapshot, { outcome:'Other documents', workflowType:'shapeAndShipFeature', teamId:other.teamId, orchestratorMemberId:other.id });
    prepareMissionLead(otherMission, other.id);
    const wrapper = mountShell({ snapshot, realConversationPane:true });
    try {
      wrapper.getComponent({ name:'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
      await flushPromises();
      const selections = wrapper.emitted('select-agent')?.length ?? 0;
      await wrapper.setProps({ markdownDisplayRequests: [
        {kind:'markdown',agentId:lead!.id,title:'First document',content:'# First'},
        {kind:'markdown',agentId:worker!.id,title:'Latest document',content:'# Latest'},
        {kind:'markdown',agentId:other.id,title:'Other document',content:'# Other'},
      ] });
      await flushPromises();
      const drawer = wrapper.get('.mission-document-request');
      expect(drawer.text()).toContain('Agent wants to open Latest document');
      expect(drawer.text()).not.toContain('First document');
      expect(wrapper.find('.mission-document-dialog').exists()).toBe(false);
      expect(wrapper.emitted('select-agent')?.length ?? 0).toBe(selections);
      expect(wrapper.get('.mission-stage-rail').isVisible()).toBe(true);
      expect(wrapper.get('.mission-workspace__workbench').isVisible()).toBe(true);
      await drawer.get('[aria-label="Open document"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('.mission-document-dialog').text()).toContain('Latest');
      expect(wrapper.find('.mission-document-request').exists()).toBe(false);
      await wrapper.setProps({ markdownDisplayRequests: [{kind:'markdown',agentId:lead!.id,title:'Next document',content:'# Next'}] });
      await flushPromises();
      expect(wrapper.get('.mission-document-dialog').text()).toContain('Latest');
      expect(wrapper.get('.mission-document-dialog').text()).not.toContain('Next');
      await wrapper.get('[aria-label="Dismiss document request"]').trigger('click');
      expect(wrapper.find('.mission-document-request').exists()).toBe(false);
      await wrapper.get('[aria-label="Close document"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('.mission-document-dialog').exists()).toBe(false);
      expect(wrapper.get('.mission-workspace__workbench').isVisible()).toBe(true);
      wrapper.getComponent({name:'AppShellNavigation'}).vm.$emit('select-mission', otherMission.id);
      await wrapper.setProps({activeAgent:other});
      await flushPromises();
      expect(wrapper.get('.mission-document-request').text()).toContain('Agent wants to open Other document');
      await wrapper.get('[aria-label="Dismiss document request"]').trigger('click');
      expect(wrapper.find('.mission-document-request').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('preserves an accepted document against older reads and recovers from failed Mission previews', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const mission = createMission(snapshot, { outcome:'Read documents', workflowType:'shapeAndShipFeature', teamId:agent.teamId, orchestratorMemberId:agent.id });
    prepareMissionLead(mission, agent.id);
    let finish!: (value: {kind:'text'; path:string; content:string; size:number}) => void;
    const previewAgentFile = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('Document unavailable'))
      .mockResolvedValue({kind:'text',path:'notes.md',content:'# Recovered',size:11});
    const wrapper = mountShell({snapshot,realConversationPane:true,previewAgentFile,
      codexConversationSnapshot:codexConversationSnapshot([codexTextMessage('document-link','assistant','[Notes](notes.md)')]),
    });
    try {
      wrapper.getComponent({name:'AppShellNavigation'}).vm.$emit('select-mission',mission.id);
      await flushPromises();
      const link = wrapper.get('.mission-conversation-rail a');
      await link.trigger('click');
      await wrapper.get('[aria-label="Close document"]').trigger('click');
      await wrapper.setProps({markdownDisplayRequests:[{kind:'markdown',agentId:agent.id,path:'notes.md',title:'Notes',content:'# Accepted document'}]});
      await wrapper.get('[aria-label="Open document"]').trigger('click');
      finish({kind:'text',path:'notes.md',content:'# Stale',size:7});
      await flushPromises();
      expect(wrapper.get('.mission-document-dialog').text()).toContain('Accepted document');
      expect(wrapper.get('.mission-document-dialog').text()).not.toContain('Stale');
      await wrapper.get('[aria-label="Close document"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('.mission-document-dialog').exists()).toBe(false);
      await link.trigger('click'); await flushPromises();
      expect(wrapper.get('.mission-document-dialog').text()).toContain('Document unavailable');
      await wrapper.get('[aria-label="Close document"]').trigger('click');
      await link.trigger('click'); await flushPromises();
      expect(wrapper.get('.mission-document-dialog').text()).toContain('Recovered');
      expect(wrapper.get('.mission-document-dialog').text()).not.toContain('Stale');
    } finally { wrapper.unmount(); }
  });

  it('can hide an empty right workspace inherited from the agent surface', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const mission = createMission(snapshot, { outcome: 'Keep the workbench accessible', workflowType: 'shapeAndShipFeature', teamId: agent.teamId, orchestratorMemberId: agent.id });
    prepareMissionLead(mission, agent.id);
    const wrapper = mountShell({ snapshot });
    try {
      await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
      wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
      await flushPromises();
      expect(wrapper.get('.mission-workspace__workbench').isVisible()).toBe(true);
      expect(wrapper.find('.mission-document-dialog').exists()).toBe(true);
      await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('.mission-workspace__workbench').isVisible()).toBe(true);
    } finally { wrapper.unmount(); }
  });

  it('opens a rendered Mission HTTPS link through the host browser route', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const mission = createMission(snapshot, { outcome: 'Follow a web link', workflowType: 'shapeAndShipFeature', teamId: agent.teamId, orchestratorMemberId: agent.id });
    prepareMissionLead(mission, agent.id);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const wrapper = mountShell({ snapshot, realConversationPane: true,
      codexConversationSnapshot: codexConversationSnapshot([codexTextMessage('links', 'assistant', '[Example](https://example.com)')]),
    });
    try {
      wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
      await flushPromises();
      await wrapper.get('.mission-conversation-rail a').trigger('click');
      expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com', '_blank', 'noopener,noreferrer');
      expect(wrapper.get('.mission-conversation-rail a').isVisible()).toBe(true);
    } finally { wrapper.unmount(); open.mockRestore(); }
  });

  it('creates a named team agent in the selected existing Mission worktree from its context menu', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Add team billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.execution!.workspaces = [
      { repositoryPath: '/repos/api', path: '/worktrees/billing-api', branch: 'mission/billing' },
      { repositoryPath: '/repos/web', path: '/worktrees/billing-web', branch: 'mission/billing' },
      { repositoryPath: '/repos/removed', path: '/worktrees/removed', branch: 'mission/billing', deleted: true },
    ];
    const createAgent = vi.fn().mockResolvedValue({ ...snapshot.agents[0]!, id: 'manual-agent', name: mission.outcome });
    const createSourceWorktree = vi.fn();
    const wrapper = mountShell({ snapshot, realAgentSidebar: true, stubAgentWorkspace: true, createAgent, createSourceWorktree });
    const row = () => wrapper.get('[data-group-kind="missions"] .agent-sidebar__agent');
    const menuItems = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    try {
      for (const [repository, folder] of [['api', '/worktrees/billing-api'], ['web', '/worktrees/billing-web']]) {
        await row().trigger('contextmenu', { clientX: 80, clientY: 120 });
        expect(menuItems().map(button => button.textContent?.trim())).toStrictEqual(['New agent in mission worktree', 'api', 'web', 'Delete mission']);
        menuItems().find(button => button.textContent?.trim() === repository)!.click();
        await flushPromises();
        expect(createAgent).toHaveBeenLastCalledWith({ name: mission.outcome, folder, teamId: mission.teamId, selection: { ...{ backend: 'codex' } } });
        expect(wrapper.emitted('select-agent')?.at(-1)).toStrictEqual(['manual-agent']);
        expect(document.body.querySelector('[aria-label="Mission actions"]')).toBeNull();
      }
      expect(createSourceWorktree).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it.each(['linear', 'gitlab'] as const)('forwards %s issue context and rejects selection after the requirements stage', async provider => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, loadWorkRepositories: vi.fn().mockResolvedValue([]), sendPromptAction });
    wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();
    await wrapper.get('.conversation-pane [role="menuitem"]').trigger('click');
    await flushPromises();
    const picker = wrapper.findAllComponents({ name: 'RepositorySessionSourceDialog' }).find(component => component.props('purpose') === 'missionIssue')!;
    const issue = workItem(provider === 'linear' ? { provider, id: 'linear:uuid', identifier: 'ENG-42', sourceId: 'linear:team', sourceName: 'Engineering', body: 'Reproduction steps', url: 'https://linear.app/acme/issue/ENG-42' } : { provider, id: 'gitlab.com/group/sub/repo#42', identifier: '#42', sourceId: 'gitlab.com/group/sub/repo', sourceName: 'group/sub/repo', body: 'Private GitLab details', url: 'https://gitlab.com/group/sub/repo/-/issues/42' });
    picker.vm.$emit('select-work-item', issue);
    await flushPromises();
    expect(sendPromptAction).toHaveBeenCalledWith(expect.stringContaining(provider === 'linear' ? 'Linear issue ENG-42' : 'GitLab issue #42'), undefined);
    expect(sendPromptAction.mock.calls[0]![0]).toContain(issue.url);
    expect(sendPromptAction.mock.calls[0]![0]).toContain(issue.body);
    mission.stage = 'tickets';
    await wrapper.setProps({ snapshot: { ...snapshot } });
    picker.vm.$emit('select-work-item', issue);
    await flushPromises();
    expect(sendPromptAction).toHaveBeenCalledOnce();
  });
  afterEach(() => window.localStorage.removeItem(missionStorageKey));

  it('restores the Mission and viewed stage when returning from Settings through the team rail', async () => {
    const snapshot = createInitialSnapshot();
    const team = snapshot.teams[0]!;
    const mission = createMission(snapshot, { outcome: 'Restore Mission context', workflowType: 'shapeAndShipFeature', teamId: team.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    mission.stage = 'implementation';
    const wrapper = mountShell({ snapshot, realAgentSidebar: true });
    try {
      await wrapper.get('[data-group-kind="missions"] .agent-sidebar__agent').trigger('click');
      await flushPromises();
      const requirementsStage = () => wrapper.get('.mission-stage-rail__stages button');
      await requirementsStage().trigger('click');
      expect(requirementsStage().classes()).toContain('mission-stage-rail__stage--viewed');

      await wrapper.get('.settings-menu').findAll('[role="menuitem"]').find(item => item.text().startsWith('Settings'))!.trigger('click');
      await flushPromises();
      expect(wrapper.find('.settings-view').exists()).toBe(true);
      expect(wrapper.find('.mission-workspace').exists()).toBe(false);

      await wrapper.get(`.team-rail [aria-label="${team.name}"]`).trigger('click');
      await flushPromises();
      expect(wrapper.find('.settings-view').exists()).toBe(false);
      expect(wrapper.get('.mission-workspace h1').text()).toBe(mission.outcome);
      expect(requirementsStage().classes()).toContain('mission-stage-rail__stage--viewed');
      expect(wrapper.get('[data-group-kind="missions"] .agent-sidebar__agent').classes()).toContain('agent-sidebar__agent--active');
      expect(wrapper.emitted('select-team')?.at(-1)).toStrictEqual([team.id]);
    } finally { wrapper.unmount(); }
  });

  it('shows the current stage when a Mission advances while Settings is open', async () => {
    const snapshot = createInitialSnapshot();
    const team = snapshot.teams[0]!;
    const mission = createMission(snapshot, { outcome: 'Advance while away', workflowType: 'shapeAndShipFeature', teamId: team.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    mission.stage = 'tickets';
    const wrapper = mountShell({ snapshot, realAgentSidebar: true });
    try {
      await wrapper.get('[data-group-kind="missions"] .agent-sidebar__agent').trigger('click');
      await flushPromises();
      await wrapper.get('.mission-stage-rail__stages button').trigger('click');
      await wrapper.get('.settings-menu').findAll('[role="menuitem"]').find(item => item.text().startsWith('Settings'))!.trigger('click');
      await flushPromises();
      await wrapper.setProps({ snapshot: { ...snapshot, missions: [{ ...mission, stage: 'implementation' }] } });
      await wrapper.get(`.team-rail [aria-label="${team.name}"]`).trigger('click');
      await flushPromises();
      const currentStage = wrapper.get('.mission-stage-rail__stages button[aria-current="step"]');
      expect(currentStage.classes()).toContain('mission-stage-rail__stage--viewed');
    } finally { wrapper.unmount(); }
  });

  it.each(['another team', 'deleted Mission', 'explicit agent selection'] as const)('does not restore a Mission after Settings when navigating to %s', async destination => {
    const snapshot = createInitialSnapshot();
    const team = snapshot.teams[0]!;
    const otherTeam = { id: 'other-team', name: 'Other team', agentIds: [] };
    snapshot.teams.push(otherTeam);
    const mission = createMission(snapshot, { outcome: 'Scoped Mission', workflowType: 'shapeAndShipFeature', teamId: team.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    const wrapper = mountShell({ snapshot, stubAgentWorkspace: true });
    try {
      wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
      await flushPromises();
      if (destination === 'explicit agent selection') {
        wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-agent', snapshot.agents[0]!.id);
        await flushPromises();
      }
      await wrapper.get('.settings-menu').findAll('[role="menuitem"]').find(item => item.text().startsWith('Settings'))!.trigger('click');
      await flushPromises();
      if (destination === 'deleted Mission') await wrapper.setProps({ snapshot: { ...snapshot, missions: [] } });
      const targetTeam = destination === 'another team' ? otherTeam : team;
      await wrapper.get(`.team-rail [aria-label="${targetTeam.name}"]`).trigger('click');
      await wrapper.setProps({ snapshot: { ...snapshot, missions: destination === 'deleted Mission' ? [] : snapshot.missions, activeTeamId: targetTeam.id } });
      await flushPromises();
      expect(wrapper.find('.settings-view').exists()).toBe(false);
      expect(wrapper.find('.mission-workspace').exists()).toBe(false);
      expect(wrapper.find('.agent-workspace').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });

  it('opens the mission an agent asked to focus, even when the snapshot arrives first or later', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'CSV export', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    const withoutMission = { ...snapshot, missions: [] };
    const wrapper = mountShell({ snapshot: withoutMission });
    expect(wrapper.findComponent({ name: 'MissionWorkspace' }).exists()).toBe(false);
    await wrapper.setProps({ missionFocusRequest: { missionId: mission.id, sequence: 1 } });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'MissionWorkspace' }).exists()).toBe(false);
    await wrapper.setProps({ snapshot: { ...snapshot } });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'MissionWorkspace' }).exists()).toBe(true);
    wrapper.unmount();
  });

  it('ignores a focus request for a mission that never arrives or belongs to another team', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({ snapshot });
    await wrapper.setProps({ missionFocusRequest: { missionId: 'mission-missing', sequence: 1 } });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'MissionWorkspace' }).exists()).toBe(false);
    wrapper.unmount();
  });

  it('restores the Mission workspace after reopening the app on a selected Mission', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Restore work', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    const firstWindow = mountShell({ snapshot });
    firstWindow.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();
    expect(firstWindow.find('.mission-workspace').exists()).toBe(true);
    firstWindow.unmount();

    const reopenedWindow = mountShell({ snapshot: createEmptySnapshot(), connectionState: { status: 'connecting' } });
    await flushPromises();
    expect(reopenedWindow.find('.mission-workspace').exists()).toBe(false);
    await reopenedWindow.setProps({ snapshot, activeAgent: snapshot.agents[0], connectionState: { status: 'connected' } });
    await flushPromises();
    expect(reopenedWindow.find('.mission-workspace').exists()).toBe(true);
    expect(reopenedWindow.getComponent({ name: 'AppShellNavigation' }).props('activeMissionId')).toBe(mission.id);

    reopenedWindow.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-agent', snapshot.agents[0]!.id);
    await flushPromises();
    reopenedWindow.unmount();
    const reopenedOnAgent = mountShell({ snapshot });
    await flushPromises();
    expect(reopenedOnAgent.find('.mission-workspace').exists()).toBe(false);
  });

  it('discards a saved Mission that no longer exists after restart', async () => {
    window.localStorage.setItem(missionStorageKey, 'deleted-mission');
    const wrapper = mountShell({ snapshot: createInitialSnapshot() });
    await flushPromises();

    expect(wrapper.find('.mission-workspace').exists()).toBe(false);
    expect(window.localStorage.getItem(missionStorageKey)).toBeNull();
  });

  it('leaves the Mission surface when its team and Mission are removed', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Scoped work', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    snapshot.teams.push({ id: 'team-keep', name: 'Keep', color: '#7158D4', agentIds: [] });
    const wrapper = mountShell({ snapshot });
    wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();
    expect(wrapper.find('.mission-workspace').exists()).toBe(true);

    await wrapper.setProps({ snapshot: { ...snapshot, teams: [snapshot.teams[1]!], missions: [], agents: [], activeTeamId: 'team-keep', activeAgentId: null } });
    await flushPromises();

    expect(wrapper.find('.mission-workspace').exists()).toBe(false);
    expect(wrapper.getComponent({ name: 'AppShellNavigation' }).props('activeMissionId')).toBeNull();
  });
  it('keeps direct Mission input in the conversation composer', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, sendPromptAction });
    wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();

    await conversationControllerActions(wrapper).submit?.('Build a better login flow');
    await flushPromises();

    expect(sendPromptAction).toHaveBeenCalledWith('Build a better login flow', undefined);
    expect(wrapper.find('.mission-workspace__starter').exists()).toBe(false);
    expect(wrapper.findAllComponents({ name: 'RepositorySessionSourceDialog' })
      .find(candidate => candidate.props('purpose') === 'missionIssue')?.props('visible')).toBe(false);
  });

  it('shows an issue choice in the empty conversation and sends the selected issue to the Mission lead', async () => {
    const snapshot = createInitialSnapshot();
    representGitHubRepository(snapshot.agents[1]!, 'nbonamy/second');
    const mission = createMission(snapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    const repositories = [
      { provider: 'github' as const, id: 'first', owner: 'nbonamy', name: 'first', fullName: 'nbonamy/first', url: 'https://github.com/nbonamy/first', isPrivate: false },
      { provider: 'github' as const, id: 'second', owner: 'nbonamy', name: 'second', fullName: 'nbonamy/second', url: 'https://github.com/nbonamy/second', isPrivate: false },
    ];
    const issue = workItem({ sourceId: 'second', sourceName: 'nbonamy/second', number: 42, title: 'Fix login flow', body: 'Users cannot sign in after logout.' });
    const loadWorkRepositories = vi.fn().mockResolvedValue(repositories);
    const loadWorkItems = vi.fn().mockResolvedValue([issue]);
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, loadWorkRepositories, loadWorkItems, sendPromptAction });

    wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();
    expect(wrapper.get('.conversation-pane [role="menuitem"]').findComponent({ name: 'BacklogIcon' }).exists()).toBe(true);
    await wrapper.get('.conversation-pane [role="menuitem"]').trigger('click');
    await flushPromises();

    const picker = wrapper.findAllComponents({ name: 'RepositorySessionSourceDialog' })
      .find(candidate => candidate.props('purpose') === 'missionIssue')!;
    expect(picker.props('visible')).toBe(true);
    const acceptsSource = picker.props('sourceFilter')!;
    expect(repositories.filter(acceptsSource)).toEqual([repositories[1]]);
    expect(acceptsSource({ provider: 'linear', id: 'team', name: 'Team', fullName: 'Team', url: 'https://linear.app/team' })).toBe(true);
    expect(loadWorkRepositories).not.toHaveBeenCalled();
    expect(loadWorkItems).not.toHaveBeenCalled();
    picker.vm.$emit('select-work-item', issue);
    await flushPromises();
    expect(picker.props('visible')).toBe(false);
    expect(sendPromptAction).toHaveBeenCalledWith(expect.stringContaining(issue.url), undefined);
    expect(sendPromptAction.mock.calls[0]?.[0]).toContain(issue.body);
  });

  it('leaves the issue picker unselected when this team has no available GitHub repository', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    const loadWorkItems = vi.fn();
    const wrapper = mountShell({ snapshot, loadWorkRepositories: vi.fn().mockResolvedValue([]), loadWorkItems });

    wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();
    await wrapper.get('.conversation-pane [role="menuitem"]').trigger('click');
    await flushPromises();

    const picker = wrapper.findAllComponents({ name: 'RepositorySessionSourceDialog' })
      .find(candidate => candidate.props('purpose') === 'missionIssue')!;
    expect(picker.props('visible')).toBe(true);
    expect(picker.props('selectedRepositoryId')).toBeNull();
    expect(loadWorkItems).not.toHaveBeenCalled();
  });

  it('keeps the issue chooser open when starting the Mission fails', async () => {
    const snapshot = createInitialSnapshot();
    representGitHubRepository(snapshot.agents[0]!, 'nbonamy/repo');
    const mission = createMission(snapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    prepareMissionLead(mission, snapshot.agents[0]!.id);
    const issue = workItem({ sourceId: 'repo', sourceName: 'nbonamy/repo', number: 9 });
    const wrapper = mountShell({
      snapshot,
      loadWorkRepositories: vi.fn().mockResolvedValue([{ provider: 'github', id: 'repo', owner: 'nbonamy', name: 'repo', fullName: 'nbonamy/repo', url: 'https://github.com/nbonamy/repo', isPrivate: false }]),
      loadWorkItems: vi.fn().mockResolvedValue([issue]),
      sendPromptAction: vi.fn().mockRejectedValue(new Error('Mission could not start')),
    });
    wrapper.getComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();
    await wrapper.get('.conversation-pane [role="menuitem"]').trigger('click');
    await flushPromises();
    const picker = wrapper.findAllComponents({ name: 'RepositorySessionSourceDialog' })
      .find(candidate => candidate.props('purpose') === 'missionIssue')!;
    expect(picker.props('sourceFilter')!({ provider: 'github', id: 'repo', name: 'repo', fullName: 'nbonamy/repo', url: 'https://github.com/nbonamy/repo' })).toBe(true);
    picker.vm.$emit('select-work-item', issue);
    await flushPromises();

    expect(picker.props('visible')).toBe(true);
    expect(picker.props('error')).toBe('Mission could not start');
  });

  it('creates and selects a team-scoped placeholder mission without asking for a title or repository', async () => {
    const snapshot = createInitialSnapshot();
    const createdSnapshot = createInitialSnapshot();
    const mission = createMission(createdSnapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: createdSnapshot.teams[0]!.id, orchestratorMemberId: createdSnapshot.agents[0]!.id });
    const createMissionAction = vi.fn().mockResolvedValue(mission);
    const wrapper = mountShell({ snapshot, createMission: createMissionAction });

    await wrapper.findComponent({ name: 'AppShellNavigation' }).vm.$emit('create-mission');
    await flushPromises();

    expect(createMissionAction).toHaveBeenCalledWith({
      outcome: 'New mission',
      workflowType: 'shapeAndShipFeature',
      teamId: snapshot.teams[0]!.id,
      orchestratorMemberId: snapshot.agents[0]!.id,
    });
    expect(wrapper.find('.agent-dialog-test-shell').exists()).toBe(false);
    await wrapper.setProps({ snapshot: { ...snapshot, missions: [mission] } });
    expect(wrapper.find('.mission-workspace').exists()).toBe(true);
  });

  it('surfaces a mission creation failure in sidebar state', async () => {
    const wrapper = mountShell({
      createMission: vi.fn().mockRejectedValue(new Error('Could not create mission')),
    });
    const navigation = wrapper.findComponent({ name: 'AppShellNavigation' });

    await navigation.vm.$emit('create-mission');
    await flushPromises();

    expect(navigation.props('missionCreationPending')).toBe(false);
    expect(navigation.props('missionCreationError')).toBe('Could not create mission');
  });

  it('creates a mission even when the team has no repository folder', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents.forEach(agent => { agent.folder = null; });
    const created = createMission(snapshot, {
      outcome: 'New mission', workflowType: 'shapeAndShipFeature',
      teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id,
    });
    const createMissionAction = vi.fn().mockResolvedValue(created);
    const wrapper = mountShell({ snapshot, createMission: createMissionAction });
    const navigation = wrapper.findComponent({ name: 'AppShellNavigation' });

    await navigation.vm.$emit('create-mission');
    await flushPromises();

    expect(createMissionAction).toHaveBeenCalledWith(expect.objectContaining({
      teamId: snapshot.teams[0]!.id,
      orchestratorMemberId: snapshot.agents[0]!.id,
    }));
    expect(navigation.props('missionCreationError')).toBe('');
  });

  it('shows a mission and returns to normal agent navigation', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Add billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    const selectMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, selectMission });
    await wrapper.findComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();
    expect(wrapper.find('.mission-workspace').exists()).toBe(true);
    expect(wrapper.find('.agent-header').exists()).toBe(false);
    expect(selectMission).toHaveBeenLastCalledWith(mission.id);
    await wrapper.findComponent({ name: 'AppShellNavigation' }).vm.$emit('select-agent', snapshot.agents[0]!.id);
    await flushPromises();
    expect(wrapper.find('.mission-workspace').exists()).toBe(false);
    expect(wrapper.find('.agent-header').exists()).toBe(true);
    expect(selectMission).toHaveBeenLastCalledWith(null);
  });

  it('asks for the outcome in the empty mission conversation', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.execution!.runs.push({
      id: 'mission-run-requirements', stage: 'requirements', memberId: snapshot.agents[0]!.id,
      workerId: snapshot.agents[0]!.id, status: 'running', skills: [], feedback: '', startedAt: '2026-09-19T00:00:00.000Z',
    });
    const wrapper = mountShell({ snapshot });

    await wrapper.findComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);

    const conversation = wrapper.getComponent({ name: 'ConversationPane' });
    expect(conversation.props('emptyHeadline')).toBe('What do you want to build?');
    expect(conversation.props('emptySubhead')).toBe('');
    expect(conversationControllerState(wrapper).composer?.placeholder).toBe('Describe what you want to build…');
  });

  it.each([
    { action: 'Keep worktrees', deleteWorktrees: false },
    { action: 'Delete mission and worktrees', deleteWorktrees: true },
  ])('lists Mission worktrees and maps $action to the explicit cleanup choice', async ({ action, deleteWorktrees }) => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Add billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.execution!.workspaces = [{
      repositoryPath: '/src/payments',
      path: '/src/payments-add-billing',
      branch: 'mission/add-billing',
    }];
    const deleteMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, deleteMission });
    const navigation = wrapper.findComponent({ name: 'AppShellNavigation' });

    await navigation.vm.$emit('select-mission', mission.id);
    await navigation.vm.$emit('delete-mission', mission.id);
    await flushPromises();

    const dialog = wrapper.getComponent({ name: 'MissionDeleteDialog' });
    expect(dialog.text()).toContain('payments');
    expect(dialog.text()).toContain('mission/add-billing');
    expect(dialog.text()).toContain('/src/payments-add-billing');
    const button = dialog.findAll('button').find(candidate => candidate.text().trim() === action);
    expect(button).toBeDefined();
    await button!.trigger('click');
    await flushPromises();

    expect(deleteMission).toHaveBeenCalledWith({
      id: mission.id,
      revision: mission.revision,
      deleteWorktrees,
      confirmed: true,
    });
    expect(wrapper.find('.mission-workspace').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'AgentWorkspace' }).exists()).toBe(true);
  });

  it.each(['empty', 'debug'] as const)('deletes a Mission with %s workspaces without presenting a worktree choice', async kind => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Add billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    if (kind === 'debug') {
      mission.execution!.debugFixture = true;
      mission.execution!.workspaces = [{ repositoryPath: '/src/payments', path: '/src/payments', branch: 'mission/debug-billing' }];
      mission.execution!.workspace = { path: '/src/web', branch: 'mission/debug-billing' };
    }
    const deleteMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, deleteMission });

    await wrapper.findComponent({ name: 'AppShellNavigation' }).vm.$emit('delete-mission', mission.id);
    await flushPromises();

    const dialog = wrapper.getComponent({ name: 'MissionDeleteDialog' });
    expect(dialog.text()).not.toContain('Keep worktrees');
    expect(dialog.find('.mission-delete-dialog__worktrees').exists()).toBe(false);
    expect(dialog.get('button.mission-delete-dialog__delete').text()).toBe('Delete mission');
    await dialog.get('button.mission-delete-dialog__delete').trigger('click');
    await flushPromises();
    expect(deleteMission).toHaveBeenCalledWith(expect.objectContaining({ deleteWorktrees: false, confirmed: true }));
  });

  it('mounts the mission worker conversation when the orchestrator becomes available', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Add billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.execution = {
      teamId: snapshot.teams[0]!.id,
      repoPath: snapshot.agents[0]!.folder!,
      memberIds: snapshot.agents.map(agent => agent.id),
      runs: [{
        id: 'run-requirements', stage: 'requirements', memberId: snapshot.agents[0]!.id,
        workerId: snapshot.agents[1]!.id, status: 'running', skills: [], feedback: '', startedAt: '2026-09-19T00:00:00.000Z',
      }],
    };
    const wrapper = mountShell({ snapshot });

    await wrapper.findComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();

    expect(wrapper.emitted('select-agent')).toStrictEqual([[snapshot.agents[1]!.id]]);
    await wrapper.setProps({ activeAgent: snapshot.agents[1]! });
    expect(wrapper.findComponent({ name: 'ConversationPane' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'ConversationPane' }).props('agent').id).toBe(snapshot.agents[1]!.id);
  });

  it('renders the Debug Mission Review fixture through the composed Vue review surface', async () => {
    const snapshot = createInitialSnapshot();
    const [apiAgent, webAgent] = snapshot.agents;
    if (!apiAgent || !webAgent) throw new Error('Expected seeded agents.');
    const mission = createMission(snapshot, {
      outcome: 'Debug Mission Review', workflowType: 'shapeAndShipFeature',
      teamId: snapshot.teams[0]!.id, orchestratorMemberId: apiAgent.id,
    });
    mission.stage = 'review';
    mission.artifacts.review.findings = [{
      id: 'debug-finding', priority: 'p1', title: 'Persist review state', body: 'Selection should survive reload.',
      repositoryPath: '/repo/api', selected: true, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now',
    }];
    mission.execution = {
      teamId: mission.teamId,
      debugFixture: true,
      memberIds: [apiAgent.id, webAgent.id],
      workspaces: [
        { repositoryPath: '/repo/api', path: '/mission/api', branch: 'mission/debug' },
        { repositoryPath: '/repo/web', path: '/mission/web', branch: 'mission/debug' },
      ],
      runs: [
        { id: 'run-api', stage: 'implementation', memberId: apiAgent.id, workerId: apiAgent.id, repositoryPath: '/repo/api', status: 'accepted', skills: [], feedback: '', startedAt: 'now' },
        { id: 'run-web', stage: 'implementation', memberId: webAgent.id, workerId: webAgent.id, repositoryPath: '/repo/web', status: 'accepted', skills: [], feedback: '', startedAt: 'now' },
        {
          id: 'run-review', stage: 'review', memberId: apiAgent.id, workerId: apiAgent.id, status: 'awaitingReview', skills: [], feedback: '', startedAt: 'now',
          proposal: { ...structuredClone(mission.artifacts), review: { summary: 'Debug review prose.', pullRequestUrl: '', findings: [] } },
        },
      ],
    };
    const getAgentGitDiff = vi.fn().mockResolvedValue({
      diff: '', summary: { addedLines: 0, removedLines: 0, changedFiles: 0 }, sections: [], target: { type: 'branch' },
    });
    const wrapper = mountShell({ snapshot, getAgentGitDiff });

    await wrapper.findComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();

    const review = wrapper.getComponent({ name: 'MissionCodeReview' });
    expect(review.props('readOnly')).toBe(false);
    expect(review.text()).toContain('Persist review state');
    expect(review.text()).toContain('Debug review prose.');
    expect(review.findAll('[role="tab"]').map(tab => tab.text())).toStrictEqual(['Review', 'Changes']);
    expect(review.findComponent({ name: 'ElSwitch' }).exists()).toBe(true);
    expect(review.findAll('button').some(button => button.text().includes('Fix 1 selected'))).toBe(true);

    await review.get('[aria-label="Chat about finding"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:composerState')).toStrictEqual([[expect.objectContaining({
      agentId: apiAgent.id,
      state: expect.objectContaining({ text: expect.stringContaining('Persist review state') }),
    })]]);
    expect(getAgentGitDiff).not.toHaveBeenCalled();
  });

  it('wires repository delivery controls into the Ship stage', async () => {
    const snapshot = createInitialSnapshot();
    const repositoryPath = snapshot.agents[0]!.folder!;
    const worktreePath = '/tmp/billing-mission';
    const mission = createMission(snapshot, { outcome: 'Add billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.stage = 'ship';
    mission.execution!.workspaces = [{ repositoryPath, path: worktreePath, branch: 'mission/add-billing' }];
    mission.execution!.deliveries = [{ repositoryPath, agentId: snapshot.agents[0]!.id, status: 'pending' }];
    snapshot.agents[0]!.folder = worktreePath;
    const mergeAgentGitBranch = vi.fn();
    const createAgentGitPullRequest = vi.fn();
    const openAgentPath = vi.fn().mockResolvedValue(undefined);
    const workflow: AgentGitWorkflow = {
      repository: 'owner/billing', folder: worktreePath, isLinkedWorktree: true, baseBranch: 'main', branch: 'mission/add-billing',
      detached: false, ahead: 1, behind: 0, files: [], stagedFiles: [], unstagedFiles: [], githubConnected: true,
    };
    const updateAgentGitBranchFromBase = vi.fn().mockResolvedValue({ workflow, baseBranch: 'main', branch: workflow.branch, conflicts: [] });
    const wrapper = mountShell({
      snapshot,
      mergeAgentGitBranch,
      createAgentGitPullRequest,
      openAgentPath,
      openInApplications: {
        defaultApplication: 'vscode',
        applications: [{ id: 'vscode', label: 'VS Code' }],
      },
    });

    await wrapper.setProps({ getAgentGitWorkflow: vi.fn().mockResolvedValue(workflow), updateAgentGitBranchFromBase });
    await wrapper.findComponent({ name: 'AppShellNavigation' }).vm.$emit('select-mission', mission.id);
    await flushPromises();

    const board = wrapper.getComponent({ name: 'MissionShipBoard' });
    expect(board.props('mission')).toMatchObject({ id: mission.id, stage: 'ship' });
    expect(board.props('mergeBranch')).toBe(mergeAgentGitBranch);
    expect(board.props('createPullRequest')).toBe(createAgentGitPullRequest);
    await board.get('[aria-label="Open in VS Code"]').trigger('click');
    expect(openAgentPath).toHaveBeenCalledExactlyOnceWith(
      snapshot.agents[0]!.id,
      'vscode',
      worktreePath,
    );
    await board.findAll('button').find(button => button.text() === 'Update from main')!.trigger('click');
    await flushPromises();
    expect(updateAgentGitBranchFromBase).toHaveBeenCalledExactlyOnceWith(snapshot.agents[0]!.id, { confirmed: true });
  });
});
