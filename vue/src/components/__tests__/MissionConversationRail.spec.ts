import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import type { Mission } from '@workspace/core/missions';
import MissionConversationRail from '../MissionConversationRail.vue';

const run = (id: string, stage: string, workerId: string, extra: Record<string, unknown> = {}) => ({ id, stage, memberId: 'member', workerId, status: 'running', skills: [], feedback: '', startedAt: '', ...extra });
const mission = {
  id: 'mission', stage: 'implementation', status: 'active', outcome: 'Billing', stageAgentIds: { requirements: 'lead' },
  artifacts: { tickets: [{ title: 'api', done: false, repositoryPath: '/src/api' }, { title: 'web', done: false, repositoryPath: '/src/web' }] },
  execution: { runs: [run('r1', 'requirements', 'lead'), run('r2', 'implementation', 'api', { ticketIndex: 0 }), run('r3', 'implementation', 'web', { ticketIndex: 1 })] },
} as unknown as Mission;
const agent = (id: string, type: Agent['status']['type'] = 'idle') => ({ id, status: { type } }) as Agent;

function render(agents: Agent[], unreadAgentIds: string[] = []) {
  return mount(MissionConversationRail, { props: { mission, agents, unreadAgentIds, selectedAgentId: 'lead' }, slots: { conversation: '<div />' } });
}
const dots = (wrapper: ReturnType<typeof render>) => wrapper.findAll('[role="tab"]').map((tab) => {
  const dot = tab.find('.mission-conversation-rail__dot');
  return dot.exists() ? dot.attributes('data-attention') ?? null : null;
});

describe('mission conversation tabs', () => {
  it('distinguishes the original attempt from a retry of the same ticket', async () => {
    const retried = structuredClone(mission);
    retried.execution!.runs.push(run('r4', 'implementation', 'retry', { ticketIndex: 0, status: 'running' }) as never);
    const wrapper = mount(MissionConversationRail, { props: { mission: retried, agents: [agent('lead'), agent('api'), agent('web'), agent('retry')], selectedAgentId: 'api' }, slots: { conversation: '<div />' } });
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map(tab => tab.text())).toStrictEqual(['Mission lead', 'api · 1 · attempt 1', 'web', 'api · 1 · attempt 2']);
    await tabs[3]!.trigger('click');
    expect(wrapper.emitted('update:selectedAgentId')!.at(-1)).toStrictEqual(['retry']);
  });
  // The rail owns selection: losing a worker here makes its approvals unreachable from its ticket.
  it('keeps same-repository workers independently selectable with their own attention', async () => {
    const shared = structuredClone(mission);
    shared.artifacts.tickets[1]!.repositoryPath = '/src/api';
    const wrapper = mount(MissionConversationRail, { props: {
      mission: shared, agents: [agent('lead'), agent('api', 'awaitingInput'), agent('web', 'working')], unreadAgentIds: ['web'], selectedAgentId: 'api',
    }, slots: { conversation: '<div />' } });
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map(tab => tab.text())).toStrictEqual(['Mission lead', 'api · 1', 'api · 2']);
    expect(dots(wrapper)).toStrictEqual([null, 'needsInput', 'working']);
    await tabs[1]!.trigger('click');
    expect(tabs[1]!.attributes('aria-selected')).toBe('true');
    await tabs[2]!.trigger('click');
    expect(wrapper.emitted('update:selectedAgentId')!.at(-1)).toStrictEqual(['web']);
    await wrapper.setProps({ selectedAgentId: 'web', mission: { ...shared, revision: shared.revision + 1 } });
    expect(wrapper.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true');
    expect(wrapper.emitted('open-conversation')!.at(-1)).toStrictEqual(['web']);
    wrapper.unmount();
    const reopened = render([agent('lead'), agent('api'), agent('web')]);
    expect(reopened.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true');
    await reopened.setProps({ agents: [agent('lead'), agent('api')] });
    expect(reopened.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true');
    expect(reopened.emitted('open-conversation')!.at(-1)).toStrictEqual(['lead']);
  });

  // Tab indicators must follow live agent state; unread worker messages never become red alerts.
  it('prioritizes input, then working, and reserves unread dots for the Mission lead', async () => {
    const wrapper = render([agent('lead'), agent('api', 'awaitingInput'), agent('web', 'working')], ['lead', 'api', 'web']);
    try {
      expect(dots(wrapper)).toStrictEqual(['unread', 'needsInput', 'working']);
      const labels = () => wrapper.findAll('[role="tab"]').map(tab => tab.find('[aria-label]').attributes('aria-label'));
      expect(labels()).toStrictEqual(['Mission lead, Unread activity', 'api, Awaiting input', 'web, Working']);
      await wrapper.setProps({ agents: [agent('lead', 'awaitingInput'), agent('api', 'working'), agent('web')] });
      expect(dots(wrapper)).toStrictEqual(['needsInput', 'working', null]);
      expect(labels()).toStrictEqual(['Mission lead, Awaiting input', 'api, Working', 'web']);
      await wrapper.setProps({ agents: [agent('lead', 'working'), agent('api'), agent('web')] });
      expect(dots(wrapper)).toStrictEqual(['working', null, null]);
      await wrapper.setProps({ agents: [agent('lead'), agent('api'), agent('web')], unreadAgentIds: [] });
      expect(dots(wrapper)).toStrictEqual([null, null, null]);
    } finally { wrapper.unmount(); }
  });

});
