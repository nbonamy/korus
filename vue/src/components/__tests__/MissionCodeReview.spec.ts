import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission } from '@workspace/core/missions';
import MissionCodeReview from '../MissionCodeReview.vue';
import MissionReviewChanges from '../MissionReviewChanges.vue';

describe('MissionCodeReview', () => {
  it('keeps the Open In control visible but disabled when the host cannot open native applications', async () => {
    const agent = createInitialSnapshot().agents[0]!;
    const wrapper = mount(MissionCodeReview, {
      props: {
        agent,
        getDiff: vi.fn().mockResolvedValue({ diff: '', summary: { addedLines: 0, removedLines: 0, changedFiles: 0 }, sections: [], target: { type: 'branch' } }),
        workspacePath: '/src/billing-mission',
      },
    });

    await flushPromises();
    const toolbarButtons = wrapper.get('.mission-review-changes__header').findAll('button');
    expect(toolbarButtons.map(button => button.attributes('aria-label'))).toStrictEqual([
      'Open in application',
      'Choose Open In application',
      'Group by file type',
      'Refresh diff',
    ]);
    expect(toolbarButtons.slice(0, 2).every(button => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('loads actual branch and uncommitted diffs for the mission worker and exposes read errors', async () => {
    const agent = createInitialSnapshot().agents[0]!;
    agent.openInApplication = 'vscode';
    const getDiff = vi.fn().mockResolvedValue({ diff: 'diff --git a/billing.ts b/billing.ts\n--- a/billing.ts\n+++ b/billing.ts\n@@ -1 +1 @@\n-old\n+new', summary: { addedLines: 1, removedLines: 1, changedFiles: 1 }, sections: [], target: { type: 'branch' } });
    const wrapper = mount(MissionCodeReview, {
      props: {
        agent,
        getDiff,
        openInAvailable: true,
        openInApplications: {
          defaultApplication: 'finder',
          applications: [{ id: 'vscode', label: 'VS Code' }, { id: 'finder', label: 'Finder' }],
        },
        workspacePath: '/src/billing-mission',
      },
      global: { stubs: { GitWorkflowControl: true } },
    });
    await flushPromises();
    await wrapper.get('[aria-label="Open in VS Code"]').trigger('click');
    expect(wrapper.emitted('open-worktree')).toStrictEqual([[
      { agentId: agent.id, application: 'vscode', path: '/src/billing-mission' },
    ]]);
    expect(getDiff).toHaveBeenLastCalledWith(agent.id, { type: 'branch' });
    expect(wrapper.text()).toContain('billing.ts');
    const select = wrapper.getComponent(MissionReviewChanges).findAllComponents({ name: 'ElSelect' })[1]!;
    await select.vm.$emit('update:modelValue', 'uncommitted');
    await select.vm.$emit('change', 'uncommitted');
    await flushPromises();
    expect(getDiff).toHaveBeenLastCalledWith(agent.id, { type: 'uncommitted' });
    getDiff.mockRejectedValueOnce(new Error('Worktree unavailable'));
    const refresh = wrapper.get('[aria-label="Refresh diff"]');
    expect(refresh.text()).toBe('');
    await refresh.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Worktree unavailable');
  });
});

it('pins branch review to the mission baseline and ignores late results after the selected worker changes', async () => {
  const agents = createInitialSnapshot().agents;
  let resolveFirst!: (result: unknown) => void;
  const getDiff = vi.fn().mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; })).mockRejectedValueOnce(new Error('Current worker cannot read diff'));
  const wrapper = mount(MissionCodeReview, { props: { agent: agents[0]!, baseSha: 'a'.repeat(40), getDiff }, global: { stubs: { GitWorkflowControl: true } } });
  expect(getDiff).toHaveBeenLastCalledWith(agents[0]!.id, { type: 'branch', baseRef: 'a'.repeat(40) });
  await wrapper.setProps({ agent: agents[1]! });
  await flushPromises();
  resolveFirst({ diff: 'stale result' });
  await flushPromises();
  expect(wrapper.text()).toContain('Current worker cannot read diff');
  expect(wrapper.text()).not.toContain('stale result');
});

it('switches repository-scoped diffs and Open In targets from the Mission Changes tab', async () => {
  const snapshot = createInitialSnapshot();
  const agents = snapshot.agents.slice(0, 2).map(agent => structuredClone(agent));
  agents[0]!.folder = '/repo/api';
  agents[0]!.openInApplication = 'vscode';
  agents[1]!.folder = '/repo/web';
  agents[1]!.openInApplication = 'vscode';
  const mission = createMission(snapshot, {
    outcome: 'Review two repositories',
    workflowType: 'shapeAndShipFeature',
    teamId: snapshot.teams[0]!.id,
    orchestratorMemberId: agents[0]!.id,
  });
  mission.stage = 'review';
  mission.artifacts.review.findings = [{
    id: 'finding-1', priority: 'p1', title: 'Persist selections', body: 'Selections must survive reload.', repositoryPath: '/repo/api', selected: true,
    remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now',
  }];
  mission.execution = {
    teamId: mission.teamId,
    memberIds: agents.map(agent => agent.id),
    workspaces: [
      { repositoryPath: '/repo/api', path: '/mission/api', branch: 'mission/review', baseSha: 'a'.repeat(40) },
      { repositoryPath: '/repo/web', path: '/mission/web', branch: 'mission/review', baseSha: 'b'.repeat(40) },
    ],
    runs: [
      { id: 'run-api', stage: 'implementation', memberId: agents[0]!.id, workerId: agents[0]!.id, repositoryPath: '/repo/api', status: 'accepted', skills: [], feedback: '', startedAt: 'now' },
      { id: 'run-web', stage: 'implementation', memberId: agents[1]!.id, workerId: agents[0]!.id, repositoryPath: '/repo/web', status: 'accepted', skills: [], feedback: '', startedAt: 'now' },
    ],
  };
  const getDiff = vi.fn().mockResolvedValue({
    diff: 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new',
    summary: { addedLines: 1, removedLines: 1, changedFiles: 1 }, sections: [], target: { type: 'branch' },
  });
  const wrapper = mount(MissionCodeReview, {
    props: {
      agent: agents[0]!,
      agents,
      getDiff,
      mission,
      reviewSummary: 'The implementation matches the approved scope.',
      openInAvailable: true,
      openInApplications: {
        defaultApplication: 'finder',
        applications: [{ id: 'vscode', label: 'VS Code' }, { id: 'finder', label: 'Finder' }],
      },
    },
  });

  await flushPromises();
  expect(wrapper.text()).toContain('Persist selections');
  expect(wrapper.text()).toContain('The implementation matches the approved scope.');
  expect(getDiff).not.toHaveBeenCalled();

  await wrapper.findAll('[role="tab"]').find(tab => tab.text() === 'Changes')!.trigger('click');
  await flushPromises();
  expect(getDiff).toHaveBeenLastCalledWith(agents[0]!.id, { type: 'branch', baseRef: 'a'.repeat(40) });

  const repositorySelect = wrapper.getComponent(MissionReviewChanges).findAllComponents({ name: 'ElSelect' })[0]!;
  repositorySelect.vm.$emit('update:modelValue', '/repo/web');
  await flushPromises();
  expect(getDiff).toHaveBeenLastCalledWith(agents[0]!.id, { type: 'branch', baseRef: 'b'.repeat(40) });

  const toolbarButtons = wrapper.get('.mission-review-changes__header').findAll('button');
  expect(toolbarButtons.map(button => button.attributes('aria-label'))).toStrictEqual([
    'Open in VS Code',
    'Choose Open In application',
    'Group by file type',
    'Refresh diff',
  ]);
  expect(toolbarButtons.at(-1)!.text()).toBe('');

  await wrapper.get('[aria-label="Open in VS Code"]').trigger('click');
  expect(wrapper.emitted('open-worktree')).toStrictEqual([[
    { agentId: agents[0]!.id, application: 'vscode', path: '/mission/web' },
  ]]);
});
