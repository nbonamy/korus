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
  it('puts a blue dot on a tab whose agent needs input and a red one on a tab with unread activity', () => {
    const wrapper = render([agent('lead'), agent('api', 'awaitingInput'), agent('web')], ['web']);
    expect(dots(wrapper)).toStrictEqual([null, 'needsInput', 'unread']);
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map(tab => tab.attributes('aria-label'))).toStrictEqual(['Mission lead', 'api, Awaiting input', 'web, Unread activity']);
  });

  it('shows no dot on tabs that are read and not waiting', () => {
    expect(dots(render([agent('lead', 'working'), agent('api'), agent('web')]))).toStrictEqual([null, null, null]);
  });
});
