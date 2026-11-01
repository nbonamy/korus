import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission } from '@workspace/core/missions';
import MissionReviewFindings from '../MissionReviewFindings.vue';

describe('MissionReviewFindings', () => {
  it('reuses the Review finding list while keeping Mission selection and remediation actions', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.artifacts.review.findings = [
      {
        id: 'finding-open', priority: 'p1', title: 'Persist selection', body: 'Selection is lost on reload.', repositoryPath: '/repo',
        location: { file: 'src/review.ts', line: 42 }, selected: true, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now',
      },
      {
        id: 'finding-skipped', priority: 'p2', title: 'Show evidence', body: 'Evidence was hidden.', repositoryPath: '/repo',
        selected: false, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now',
      },
    ];
    mission.stage = 'review';
    mission.execution!.runs = [{
      id: 'review-run', stage: 'review', memberId: snapshot.agents[0]!.id, workerId: snapshot.agents[0]!.id,
      status: 'awaitingReview', skills: [], feedback: '', startedAt: 'now', proposal: structuredClone(mission.artifacts),
    }];
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(MissionReviewFindings, { props: { mission, executeMission } });

    expect(wrapper.findAll('.review-finding')).toHaveLength(2);
    expect(wrapper.findAll('.review-finding__quick-action')).toHaveLength(2);
    await wrapper.findAll('.review-finding__quick-action')[0]!.trigger('click');
    expect(wrapper.emitted('chat-about-finding')).toStrictEqual([[mission.artifacts.review.findings[0]]]);
    await wrapper.findAll('.review-finding__toggle')[0]!.trigger('click');
    const location = wrapper.get('.review-finding__location');
    expect(location.element.tagName).toBe('SPAN');
    expect(getComputedStyle(location.element).color).toBe('var(--color-primary)');
    expect(getComputedStyle(location.element).cursor).toBe('default');
    await wrapper.findComponent({ name: 'ElSwitch' }).vm.$emit('change', false);
    await flushPromises();
    expect(executeMission).toHaveBeenCalledWith({ id: mission.id, revision: mission.revision, action: 'selectReviewFinding', findingId: 'finding-open', selected: false });
    await wrapper.findAll('button').find(button => button.text().includes('Fix 1 selected'))!.trigger('click');
    await flushPromises();
    expect(executeMission).toHaveBeenLastCalledWith({ id: mission.id, revision: mission.revision, action: 'fixSelectedReviewFindings' });

    const readOnlyMission = structuredClone(mission);
    readOnlyMission.artifacts.review.findings![0]!.selected = true;
    readOnlyMission.artifacts.review.findings![0]!.remediation = { state: 'fixed', completedAt: 'later', evidence: 'Mission tests pass.' };
    await wrapper.setProps({ mission: readOnlyMission });
    // Partial remediation keeps the unresolved row selectable and retryable.
    expect(wrapper.text()).toContain('Mission tests pass.');
    expect(wrapper.findAll('.review-finding__quick-action')).toHaveLength(2);
    await wrapper.findAll('.review-finding__toggle')[1]!.trigger('click');
    await wrapper.findComponent({ name: 'ElSwitch' }).vm.$emit('change', true);
    await flushPromises();
    expect(executeMission).toHaveBeenLastCalledWith({ id: mission.id, revision: mission.revision, action: 'selectReviewFinding', findingId: 'finding-skipped', selected: true });
    readOnlyMission.artifacts.review.findings![1]!.selected = true;
    await wrapper.setProps({ mission: structuredClone(readOnlyMission) });
    await wrapper.findAll('button').find(button => button.text().includes('Fix 1 selected'))!.trigger('click');
    await flushPromises();
    expect(executeMission).toHaveBeenLastCalledWith({ id: mission.id, revision: mission.revision, action: 'fixSelectedReviewFindings' });
    readOnlyMission.artifacts.review.findings![1]!.remediation = { state: 'fixing', startedAt: 'later' };
    await wrapper.setProps({ mission: structuredClone(readOnlyMission) });
    expect(wrapper.text()).not.toContain('Fix 1 selected');
    expect(wrapper.findComponent({ name: 'ElSwitch' }).exists()).toBe(false);
    readOnlyMission.artifacts.review.findings![1]!.remediation = { state: 'skipped', startedAt: 'later' };
    await wrapper.setProps({ mission: structuredClone(readOnlyMission) });
    expect(wrapper.findComponent({ name: 'ElSwitch' }).exists()).toBe(false);
    expect(wrapper.findAll('.review-finding__quick-action')).toHaveLength(0);
    expect(wrapper.findAll('button').some(button => button.text().includes('Fix 1 selected'))).toBe(false);
    await wrapper.findAll('button').find(button => button.text().includes('Re-run review'))!.trigger('click');
    await flushPromises();
    expect(executeMission).toHaveBeenLastCalledWith({ id: mission.id, revision: mission.revision, action: 'rerunReview' });
    expect(wrapper.text()).toContain('Fixed');
    expect(wrapper.text()).toContain('Skipped');
    await wrapper.findAll('.review-finding__toggle')[0]!.trigger('click');
    expect(wrapper.text()).toContain('Mission tests pass.');
  });

  it('offers finding actions only while a Review proposal awaits arbitration', async () => {
    const snapshot = createInitialSnapshot();
    const mission = createMission(snapshot, { outcome: 'Billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    mission.stage = 'review';
    mission.artifacts.review.findings = [{
      id: 'finding-open', priority: 'p1', title: 'Persist selection', body: 'Selection is lost.', repositoryPath: '/repo',
      selected: true, remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now',
    }];
    mission.execution!.runs = [{
      id: 'review-run', stage: 'review', memberId: snapshot.agents[0]!.id, workerId: snapshot.agents[0]!.id,
      status: 'running', skills: [], feedback: '', startedAt: 'now',
    }];
    const wrapper = mount(MissionReviewFindings, { props: { mission, executeMission: vi.fn() } });

    expect(wrapper.findComponent({ name: 'ElSwitch' }).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Fix 1 selected');

    const historical = structuredClone(mission);
    historical.stage = 'ship';
    historical.execution!.runs[0] = {
      ...historical.execution!.runs[0]!, status: 'awaitingReview', proposal: structuredClone(historical.artifacts),
    };
    await wrapper.setProps({ mission: historical });
    expect(wrapper.findComponent({ name: 'ElSwitch' }).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Fix 1 selected');
  });
});
