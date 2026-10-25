import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission } from '@workspace/core/missions';
import type { AgentGitWorkflow, OpenInApplicationCatalog } from '@workspace/core/contracts';
import MissionShipBoard from '../MissionShipBoard.vue';

describe('MissionShipBoard', () => {
  it.each(['github', 'gitlab'] as const)('shows persisted %s request delivery with a native reference', async provider => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Team billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    const repositories = snapshot.agents.slice(0, 2).map(agent => agent.folder!);
    mission.stage = 'ship';
    mission.execution!.workspaces = repositories.map(repositoryPath => ({ repositoryPath, path: `${repositoryPath}-mission`, branch: 'mission/team-billing' }));
    mission.execution!.deliveries = [
      { repositoryPath: repositories[0]!, agentId: snapshot.agents[0]!.id, status: 'pending' },
      { repositoryPath: repositories[1]!, agentId: snapshot.agents[1]!.id, status: 'pullRequestCreated', pullRequest: { number: 42, url: provider === 'gitlab' ? 'https://gitlab.com/group/sub/repo/-/merge_requests/42' : 'https://github.com/acme/repo/pull/42' } },
    ];
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(MissionShipBoard, {
      props: { mission, agents: snapshot.agents, gitStatuses: {}, executeMission },
      global: {
        stubs: {
          GitWorkflowControl: {
            name: 'GitWorkflowControl',
            emits: ['delivery-complete'],
            template: '<div class="git-workflow-control"><button class="complete-delivery" @click="$emit(\'delivery-complete\', { kind: \'merge\' })">Deliver</button></div>',
          },
        },
      },
    });

    const cards = wrapper.findAll('.mission-ship__card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.text()).toContain('Ready to ship');
    expect(cards[1]!.text()).toContain(provider === 'gitlab' ? 'Merge request created' : 'Pull request created');
    expect(cards[1]!.get('a').attributes('href')).toBe(mission.execution!.deliveries![1]!.pullRequest!.url);
    expect(cards[1]!.get('a').text()).toContain(provider === 'gitlab' ? 'MR !42' : 'PR #42');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('1');
    expect(getComputedStyle(wrapper.get('.mission-ship').element).display).toBe('flex');
    expect(getComputedStyle(wrapper.get('.mission-ship__grid').element).gridTemplateColumns).toBe('minmax(0, 1fr)');
    const actionsStyle = getComputedStyle(cards[0]!.get('.mission-ship__actions').element);
    expect({ display: actionsStyle.display, justifyContent: actionsStyle.justifyContent }).toStrictEqual({
      display: 'flex',
      justifyContent: 'flex-start',
    });
    expect(wrapper.find('h3').exists()).toBe(false);

    await cards[0]!.get('.mission-ship__repository').trigger('click');
    expect(wrapper.emitted('open-conversation')).toStrictEqual([[snapshot.agents[0]!.id]]);
    await cards[0]!.get('.complete-delivery').trigger('click');
    await flushPromises();
    expect(executeMission).toHaveBeenCalledExactlyOnceWith({
      id: mission.id,
      revision: mission.revision,
      action: 'recordDelivery',
      repositoryPath: repositories[0],
      result: { kind: 'merge' },
    });
  });

  it('renders simulated pending delivery without exposing destructive Git actions', () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Debug delivery', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.stage = 'ship';
    mission.execution!.debugFixture = true;
    mission.execution!.deliveries = [{ repositoryPath: '/repo/api', agentId: snapshot.agents[0]!.id, status: 'pending' }];
    const wrapper = mount(MissionShipBoard, {
      props: { mission, agents: snapshot.agents, gitStatuses: {} },
      global: { stubs: { GitWorkflowControl: true } },
    });

    expect(wrapper.text()).toContain('Debug fixture — delivery actions are disabled.');
    expect(wrapper.findComponent({ name: 'GitWorkflowControl' }).exists()).toBe(false);
  });

  it('offers a base update for pending delivery and keeps conflicts unshipped for agent resolution', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const mission = createMission(snapshot, { outcome: 'Ship billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: agent.id });
    mission.stage = 'ship';
    mission.execution!.workspaces = [{ repositoryPath: agent.folder!, path: `${agent.folder}-mission`, branch: 'mission/ship-billing' }];
    mission.execution!.deliveries = [{ repositoryPath: agent.folder!, agentId: agent.id, status: 'pending' }];
    const workflow: AgentGitWorkflow = {
      repository: 'owner/repo', folder: agent.folder!, isLinkedWorktree: true, baseBranch: 'main', branch: 'mission/ship-billing', detached: false,
      remote: 'origin', remoteUrl: 'git@github.com:owner/repo.git', upstream: 'origin/mission/ship-billing', ahead: 1, behind: 0,
      stagedAddedLines: 0, stagedRemovedLines: 0, unstagedAddedLines: 0, unstagedRemovedLines: 0, untrackedAddedLines: 0, untrackedRemovedLines: 0,
      files: [], stagedFiles: [], unstagedFiles: [], githubConnected: true,
    };
    const updateFromBase = vi.fn().mockResolvedValue({ workflow, baseBranch: 'main', branch: workflow.branch, conflicts: ['billing.ts'] });
    const mergeBranch = vi.fn().mockResolvedValue(workflow);
    const executeMission = vi.fn();
    const wrapper = mount(MissionShipBoard, {
      props: {
        mission, agents: snapshot.agents, gitStatuses: {},
        getWorkflow: vi.fn().mockResolvedValue(workflow),
        mergeBranch, updateFromBase, executeMission,
        createPullRequest: vi.fn().mockResolvedValue(workflow),
      },
    });

    await vi.waitFor(() => expect(wrapper.findAll('.git-workflow-control__delivery-action')[0]?.attributes('disabled')).toBeUndefined());
    expect(wrapper.findAll('.git-workflow-control__delivery-action').map(button => button.text())).toStrictEqual(['Update from main', 'Merge', 'Create PR']);
    expect(wrapper.find('.git-workflow-control__trigger').exists()).toBe(false);
    await wrapper.findAll('button').find(button => button.text() === 'Update from main')!.trigger('click');
    await flushPromises();
    expect(updateFromBase).toHaveBeenCalledExactlyOnceWith(agent.id, { confirmed: true });
    expect(wrapper.text()).toContain('Agent resolving conflicts');
    expect(wrapper.text()).toContain('Review the resolved changes before merging.');
    expect(mergeBranch).not.toHaveBeenCalled();
    expect(executeMission).not.toHaveBeenCalled();
  });

  it('opens the Mission worktree before the repository delivery actions', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const repositoryPath = agent.folder!;
    const worktreePath = `${repositoryPath}-mission`;
    agent.folder = worktreePath;
    agent.openInApplication = 'vscode';
    const mission = createMission(snapshot, { outcome: 'Ship billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: agent.id });
    mission.stage = 'ship';
    mission.execution!.workspaces = [{ repositoryPath, path: worktreePath, branch: 'mission/ship-billing' }];
    mission.execution!.deliveries = [{ repositoryPath, agentId: agent.id, status: 'pending' }];
    const openInApplications: OpenInApplicationCatalog = {
      defaultApplication: 'finder',
      applications: [
        { id: 'vscode', label: 'VS Code' },
        { id: 'finder', label: 'Finder' },
      ],
    };
    const wrapper = mount(MissionShipBoard, {
      props: {
        mission,
        agents: snapshot.agents,
        gitStatuses: {},
        openInAvailable: true,
        openInApplications,
      },
      global: {
        stubs: { GitWorkflowControl: { template: '<div class="git-workflow-control" />' } },
      },
    });

    const actions = wrapper.get('.mission-ship__actions');
    expect(actions.element.firstElementChild?.classList).toContain('open-in-control');
    await actions.get('[aria-label="Open in VS Code"]').trigger('click');

    expect(wrapper.emitted('open-worktree')).toStrictEqual([[
      { agentId: agent.id, application: 'vscode', path: worktreePath },
    ]]);
  });
});
