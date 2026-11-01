import { describe, expect, it } from 'vitest';
import type { Mission } from '@workspace/core/missions';
import type { UsageSummary } from '@workspace/core/usage';
import { missionCostGroups } from '../mission-cost';

const run = (stage: string, workerId: string | undefined, extra: Record<string, unknown> = {}) => ({ id: `run-${stage}-${workerId}`, stage, memberId: 'member', workerId, status: 'running', skills: [], feedback: '', startedAt: '', ...extra });
const mission = (runs: unknown[], extra: Record<string, unknown> = {}) => ({
  stageAgentIds: {}, artifacts: { tickets: [{ title: 'a', done: false, repositoryPath: '/src/api' }, { title: 'b', done: false, repositoryPath: '/src/web' }] },
  execution: { runs }, ...extra,
}) as unknown as Mission;
const row = (label: string, usd: number): UsageSummary['rows'][number] => ({
  label, started: 1, completed: 1, failed: 0, interrupted: 0, inProgress: 0, measuredTurns: 1,
  tokens: { input: 10, output: 1, cacheRead: 0, cacheWrite: null },
  cost: { usd, coverage: 'complete', requests: 1, pricedRequests: 1, unpricedRequests: 0, unknownRequestExecutions: 0, reasons: [] },
});
const summary = (rows: UsageSummary['rows']): UsageSummary => ({ rows, recordedSince: 0, retainedSince: 0 });

describe('missionCostGroups', () => {
  it('splits a Mission into its lead and one line per repository, with a total over every agent', () => {
    const usage = summary([row('lead', 1), row('api-1', 2), row('api-2', 0.5), row('web-1', 4), row('other', 99)]);
    const groups = missionCostGroups(mission([
      run('requirements', 'lead'), run('tickets', 'lead'),
      run('implementation', 'api-1', { ticketIndex: 0 }), run('implementation', 'api-2', { ticketIndex: 0 }),
      run('implementation', 'web-1', { ticketIndex: 1 }),
    ]), usage);
    expect(groups.rows.map(group => [group.id, group.label, group.cost?.usd])).toStrictEqual([['lead', null, 1], ['/src/api', 'api', 2.5], ['/src/web', 'web', 4]]);
    expect(groups.total?.usd).toBe(7.5);
  });

  it('counts an agent once, uses a run’s own repository over its ticket’s, and files the rest under Other', () => {
    const usage = summary([row('lead', 1), row('rev', 3), row('impl', 2)]);
    const groups = missionCostGroups(mission([
      run('requirements', 'lead'), run('implementation', 'lead', { ticketIndex: 0 }),
      run('implementation', 'impl', { ticketIndex: 0, repositoryPath: '/src/web' }),
      run('review', 'rev'),
    ]), usage);
    expect(groups.rows.map(group => [group.id, group.cost?.usd])).toStrictEqual([['lead', 1], ['/src/web', 2], ['other', 3]]);
    expect(groups.total?.usd).toBe(6);
  });

  it('skips groups without recorded usage, and returns nothing before any agent has run', () => {
    expect(missionCostGroups(mission([run('requirements', 'lead'), run('implementation', 'api-1', { ticketIndex: 0 })]), summary([row('lead', 1)])).rows.map(group => group.id)).toStrictEqual(['lead']);
    expect(missionCostGroups(mission([]), summary([row('lead', 1)]))).toStrictEqual({ rows: [], total: null });
    expect(missionCostGroups(mission([run('requirements', 'lead')]), null)).toStrictEqual({ rows: [], total: null });
  });

  it('also finds stage agents that have no run record', () => {
    const groups = missionCostGroups(mission([], { stageAgentIds: { requirements: 'lead', review: 'rev' } }), summary([row('lead', 1), row('rev', 2)]));
    expect(groups.rows.map(group => [group.id, group.cost?.usd])).toStrictEqual([['lead', 1], ['other', 2]]);
  });
});
