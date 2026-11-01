import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission } from '@workspace/core/missions';
import MissionReviewChanges from '../MissionReviewChanges.vue';

describe('MissionReviewChanges', () => {
  it('does not show a stale diff after switching to a repository without an agent', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const mission = createMission(snapshot, {
      outcome: 'Review two repositories',
      workflowType: 'shapeAndShipFeature',
      teamId: snapshot.teams[0]!.id,
      orchestratorMemberId: agent.id,
    });
    mission.stage = 'review';
    mission.execution = {
      teamId: mission.teamId,
      memberIds: [agent.id],
      workspaces: [
        { repositoryPath: '/repo/api', path: '/mission/api', branch: 'mission/review' },
        { repositoryPath: '/repo/web', path: '/mission/web', branch: 'mission/review' },
      ],
      runs: [
        { id: 'run-api', stage: 'implementation', memberId: agent.id, workerId: agent.id, repositoryPath: '/repo/api', status: 'accepted', skills: [], feedback: '', startedAt: 'now' },
        { id: 'run-web', stage: 'implementation', memberId: agent.id, workerId: 'missing-worker', repositoryPath: '/repo/web', status: 'accepted', skills: [], feedback: '', startedAt: 'now' },
      ],
    };
    let resolveApiDiff!: (result: {
      diff: string;
      summary: { addedLines: number; removedLines: number; changedFiles: number };
      sections: never[];
      target: { type: 'branch' };
    }) => void;
    const getDiff = vi.fn().mockReturnValue(new Promise(resolve => { resolveApiDiff = resolve; }));
    const wrapper = mount(MissionReviewChanges, {
      props: { agent, agents: [agent], getDiff, mission },
    });
    await vi.waitFor(() => expect(getDiff).toHaveBeenCalledOnce());

    const repositorySelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]!;
    repositorySelect.vm.$emit('update:modelValue', '/repo/web');
    await flushPromises();
    expect(wrapper.text()).toContain('The implementation agent for this repository is unavailable.');

    resolveApiDiff({
      diff: 'diff --git a/api.ts b/api.ts\n--- a/api.ts\n+++ b/api.ts\n@@ -1 +1 @@\n-old\n+stale',
      summary: { addedLines: 1, removedLines: 1, changedFiles: 1 },
      sections: [],
      target: { type: 'branch' },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('The implementation agent for this repository is unavailable.');
    expect(wrapper.text()).not.toContain('api.ts');
  });

  it('groups the mission diff by file type, lets the reviewer turn that off and folds groups', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const mission = createMission(snapshot, { outcome: 'Review', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: agent.id });
    mission.stage = 'review';
    mission.execution = { teamId: mission.teamId, memberIds: [agent.id], workspaces: [{ repositoryPath: '/repo/api', path: '/mission/api', branch: 'mission/review' }],
      runs: [{ id: 'run-api', stage: 'implementation', memberId: agent.id, workerId: agent.id, repositoryPath: '/repo/api', status: 'accepted', skills: [], feedback: '', startedAt: 'now' }] };
    const file = (path: string) => [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -0,0 +1 @@', '+line'].join('\n');
    const getDiff = vi.fn().mockResolvedValue({ diff: [file('README.md'), file('src/app.test.ts'), file('src/app.ts')].join('\n'), summary: { addedLines: 3, removedLines: 0, changedFiles: 3 }, sections: [], target: { type: 'branch' } });
    const wrapper = mount(MissionReviewChanges, { props: { agent, agents: [agent], getDiff, mission } });
    await flushPromises();
    const headers = () => wrapper.findAll('.git-diff-preview-panel__group-header').map(header => header.text().split(/\d/u)[0]!.trim());
    expect(headers()).toStrictEqual(['Code', 'Tests', 'Documentation']);
    await wrapper.findAll('.git-diff-preview-panel__group-header')[0]!.trigger('click');
    expect(wrapper.findAll('.git-diff-preview-panel__file-title strong').map(name => name.text())).toStrictEqual(['app.test.ts', 'README.md']);
    const toggle = wrapper.get('[aria-label="Group by file type"]');
    expect(toggle.attributes('aria-pressed')).toBe('true');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-pressed')).toBe('false');
    expect(headers()).toStrictEqual([]);
    expect(wrapper.findAll('.git-diff-preview-panel__file-title strong').map(name => name.text())).toStrictEqual(['README.md', 'app.test.ts', 'app.ts']);
  });
});
