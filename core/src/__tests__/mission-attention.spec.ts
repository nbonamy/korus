import { describe, expect, it } from 'vitest';
import type { Agent } from '../contracts';
import type { Mission } from '../missions';
import { agentAttention, missionAgentIds, missionAttention } from '../mission-attention';

const run = (stage: string, workerId?: string) => ({ id: `run-${stage}-${workerId}`, stage, memberId: 'member', workerId, status: 'running', skills: [], feedback: '', startedAt: '' });
const mission = (overrides: Record<string, unknown> = {}) => ({
  stage: 'implementation', status: 'active', stageAgentIds: { requirements: 'lead' },
  execution: { runs: [run('requirements', 'lead'), run('implementation', 'api'), run('implementation', 'web'), run('implementation', undefined)] },
  ...overrides,
}) as unknown as Mission;
const agent = (id: string, status: Agent['status']['type'] = 'idle') => ({ id, status: { type: status } }) as Agent;
const agents = (statuses: Record<string, Agent['status']['type']> = {}) => ['lead', 'api', 'web', 'stranger'].map(id => agent(id, statuses[id]));

describe('missionAgentIds', () => {
  it('lists the lead and every worker once, including stage agents that have no run', () => {
    expect(missionAgentIds(mission())).toStrictEqual(['lead', 'api', 'web']);
    expect(missionAgentIds(mission({ stageAgentIds: { requirements: 'lead', review: 'reviewer' } }))).toStrictEqual(['lead', 'api', 'web', 'reviewer']);
    expect(missionAgentIds(mission({ execution: undefined, stageAgentIds: {} }))).toStrictEqual([]);
  });
});

describe('missionAttention', () => {
  it('is idle until the lead or a repository agent starts working', () => {
    expect(missionAttention(mission(), agents(), new Set())).toBe('idle');
    expect(missionAttention(mission(), agents({ lead: 'working' }), new Set())).toBe('working');
    expect(missionAttention(mission(), agents({ api: 'working' }), new Set())).toBe('working');
  });

  it('needs input as soon as one of its agents does, ahead of unread', () => {
    expect(missionAttention(mission(), agents({ web: 'awaitingInput', api: 'working' }), new Set(['lead']))).toBe('needsInput');
    expect(missionAttention(mission(), agents({ lead: 'awaitingInput', api: 'working' }), new Set(['web']))).toBe('needsInput');
  });

  it('takes unread only from the lead, ahead of working repository agents', () => {
    expect(missionAttention(mission(), agents({ api: 'working' }), new Set(['lead', 'web']))).toBe('unread');
    expect(missionAttention(mission(), agents({ api: 'working' }), new Set(['web']))).toBe('working');
    expect(missionAttention(mission(), agents(), new Set(['api', 'web']))).toBe('idle');
  });

  it('ignores other agents and derives activity independently of mission completion', () => {
    expect(missionAttention(mission(), agents({ stranger: 'awaitingInput' }), new Set(['stranger']))).toBe('idle');
    expect(missionAttention(mission(), agents({ stranger: 'working' }), new Set())).toBe('idle');
    expect(missionAttention(mission({ status: 'completed' }), agents(), new Set())).toBe('idle');
    expect(missionAttention(mission({ status: 'completed' }), agents({ lead: 'working' }), new Set())).toBe('working');
    expect(missionAttention(mission({ status: 'completed' }), agents(), new Set(['lead']))).toBe('unread');
  });
});

describe('agentAttention', () => {
  it('marks an agent that needs input, or else one that is unread, and nothing otherwise', () => {
    expect(agentAttention(agent('a', 'awaitingInput'), new Set(['a']))).toBe('needsInput');
    expect(agentAttention(agent('a'), new Set(['a']))).toBe('unread');
    expect(agentAttention(agent('a', 'working'), new Set())).toBeNull();
    expect(agentAttention(undefined, new Set(['a']))).toBeNull();
  });
});
