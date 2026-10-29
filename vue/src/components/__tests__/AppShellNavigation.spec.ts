import { product } from '@workspace/core/product';
import { shallowMount } from '@vue/test-utils';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createMission } from '@workspace/core/missions';
import { createTeamInSnapshot } from '@workspace/core/team-manager';
import { describe, expect, it, vi } from 'vitest';
import AppShellNavigation from '../AppShellNavigation.vue';

function mountNavigation(snapshot = createInitialSnapshot(), renderSidebar = false) {
  const activeTeam = snapshot.teams[0] ?? null;
  return shallowMount(AppShellNavigation, {
    global: { stubs: { AgentSidebar: !renderSidebar, AgentSidebarRepo: !renderSidebar, AgentSidebarActivity: !renderSidebar } },
    props: {
      activeTeam,
      activeTeamAgents: snapshot.agents,
      activeTeamName: activeTeam?.name ?? `${product.name}`,
      agentListCompact: false,
      agentSidebarWidth: 260,
      authentication: null,
      automationsVisible: false,
      backlogVisible: false,
      cockpitVisible: false,
      currentAgent: snapshot.agents[0] ?? null,
      forkableAgentIds: [],
      listRepositorySessionBranches: vi.fn().mockResolvedValue([]),
      loadRemoteTeams: vi.fn().mockResolvedValue([]),
      openInApplications: { defaultApplication: 'finder', applications: [] },
      quickAgentShortcutsVisible: false,
      settingsVisible: false,
      showAgentSidebar: true,
      snapshot,
      unreadAgentIds: [],
      unreadTeamIds: [],
      workingTeamIds: [],
    },
  });
}

describe('AppShellNavigation', () => {
  it('forwards team-rail navigation as semantic shell actions', () => {
    const wrapper = mountNavigation();
    const rail = wrapper.getComponent({ name: 'TeamRail' });

    rail.vm.$emit('new-team');
    rail.vm.$emit('select-backlog');
    rail.vm.$emit('select-cockpit');
    rail.vm.$emit('select-team', 'team-app');
    rail.vm.$emit('toggle-speech-mute');

    expect(wrapper.emitted('new-team')).toStrictEqual([[]]);
    expect(wrapper.emitted('open-backlog')).toStrictEqual([[]]);
    expect(wrapper.emitted('open-cockpit')).toStrictEqual([[]]);
    expect(wrapper.emitted('select-team')).toStrictEqual([['team-app']]);
    expect(wrapper.emitted('toggle-speech-mute')).toStrictEqual([[]]);
  });

  it('forwards sidebar actions without translating their payloads', () => {
    const wrapper = mountNavigation();
    const sidebar = wrapper.getComponent({ name: 'AgentSidebar' });

    sidebar.vm.$emit('select-agent', 'agent-dina');
    sidebar.vm.$emit('delete-mission', 'mission-1');
    sidebar.vm.$emit('cleanup-pull-request', 'agent-dina');
    sidebar.vm.$emit('open-in', {
      agentId: 'agent-dina',
      application: 'finder',
    });

    expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-dina']]);
    expect(wrapper.emitted('delete-mission')).toStrictEqual([['mission-1']]);
    expect(wrapper.emitted('cleanup-pull-request')).toStrictEqual([['agent-dina']]);
    expect(wrapper.emitted('open-in')).toStrictEqual([
      [
        {
          agentId: 'agent-dina',
          application: 'finder',
        },
      ],
    ]);
  });

  it('keeps the mission lead out of the global sidebar while showing its unread activity on the mission', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'New mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.stageAgentIds = { requirements: snapshot.agents[1]!.id };
    mission.execution = {
      teamId: snapshot.teams[0]!.id,
      repoPath: snapshot.agents[0]!.folder!,
      memberIds: snapshot.agents.map(agent => agent.id),
      runs: [{
        id: 'mission-run', stage: 'requirements', memberId: snapshot.agents[0]!.id,
        workerId: snapshot.agents[1]!.id, status: 'running', skills: [], feedback: '',
        startedAt: '2026-09-19T00:00:00.000Z',
      }],
    };

    const wrapper = mountNavigation(snapshot, true);
    const sidebar = wrapper.getComponent({ name: 'AgentSidebar' });

    expect(sidebar.props('agents').map((agent: { id: string }) => agent.id))
      .toStrictEqual([snapshot.agents[0]!.id]);
    expect(sidebar.props('missions')).toStrictEqual([mission]);
    await wrapper.setProps({ unreadAgentIds: [snapshot.agents[1]!.id] });
    const dot = () => sidebar.get('[data-group-kind="missions"] .agent-sidebar__status');
    expect(dot().attributes('aria-label')).toBe('Unread activity');
    expect(dot().classes()).toContain('agent-sidebar__status--unread');
    await wrapper.setProps({ unreadAgentIds: [] });
    expect(dot().classes()).not.toContain('agent-sidebar__status--unread');
  });

  it('shows only missions from the active team', () => {
    const snapshot = createInitialSnapshot();
    const activeMission = createMission(snapshot, { outcome: 'Active', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    const otherTeam = createTeamInSnapshot(snapshot, { name: 'Other', color: '#46A857' }, '2026-06-05T10:11:12.000Z');
    const otherAgent = structuredClone(snapshot.agents[0]!);
    otherAgent.id = 'agent-other';
    otherAgent.teamId = otherTeam.id;
    snapshot.agents.push(otherAgent);
    otherTeam.agentIds.push(otherAgent.id);
    createMission(snapshot, { outcome: 'Other', workflowType: 'shapeAndShipFeature', teamId: otherTeam.id, orchestratorMemberId: otherAgent.id });
    snapshot.activeTeamId = activeMission.teamId;

    const wrapper = mountNavigation(snapshot);
    expect(wrapper.getComponent({ name: 'AgentSidebar' }).props('missions')).toStrictEqual([activeMission]);
  });
});
