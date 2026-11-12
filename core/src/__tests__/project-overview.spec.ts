import { describe, expect, it } from 'vitest';
import {
  buildProjectFlow,
  projectFlowStation,
  projectNarrativeFromDraft,
  projectOverviewCommitKind,
  projectOverviewIntegrationRisk,
  projectOverviewMergedBranch,
  type ProjectFlowInput,
  type ProjectFlowUnit,
  type ProjectNarrativeEvidence,
} from '../project-overview';

const hour = 3_600_000;
const day = 24 * hour;
const now = Date.parse('2026-11-11T12:00:00Z');

function unit(branch: string, overrides: Partial<ProjectFlowUnit> = {}): ProjectFlowUnit {
  return { branch, pullRequest: null, latestPipeline: null, firstCommitAt: now - 2 * day, lastCommitAt: now - hour, agentWorking: false, ...overrides };
}
const pullRequest = (approved: boolean | null, openedAgo: number, draft = false) => ({ draft, approved, openedAt: now - openedAgo });

describe('project overview commit and merge reading', () => {
  it.each([
    ['feat: add project overview', 'feat'],
    ['Fix(git)!: count merges once', 'fix'],
    ['test: cover drift', 'test'],
    ['docs: describe the overview', 'chore'],
    ['update readme', 'other'],
  ] as const)('classifies %j as %s', (subject, kind) => {
    expect(projectOverviewCommitKind(subject)).toBe(kind);
  });

  it.each([
    ["Merge branch 'feat/missions'", 'feat/missions'],
    ["Merge branch 'feat/git-log' into main", 'feat/git-log'],
    ['Merge pull request #12 from acme/feat/design-mode', 'feat/design-mode'],
    ["Merge branch 'main' into feat/missions", null],
    ["Merge remote-tracking branch 'origin/main' into feat/work-routing", null],
    ["Merge branch 'feat/git-log' into release", null],
    ['chore: merge main into missions', null],
  ] as const)('reads %j as %j', (subject, branch) => {
    expect(projectOverviewMergedBranch(subject, 'main')).toBe(branch);
  });
});

describe('project overview integration risk', () => {
  it('scores drift, overlap and a fast base into a level with its reasons', () => {
    expect(projectOverviewIntegrationRisk({ behind: 14, changedFiles: 9, overlapFiles: 3, overlapBranches: 2, baseCommitsPerDay: 22.4, latestPipeline: 'passed' })).toStrictEqual({
      level: 'medium',
      reasons: [{ kind: 'behind', commits: 14 }, { kind: 'overlap', files: 3, branches: 2 }, { kind: 'velocity', commitsPerDay: 22 }],
    });
    expect(projectOverviewIntegrationRisk({ behind: 0, changedFiles: 4, overlapFiles: 0, overlapBranches: 0, baseCommitsPerDay: 2, latestPipeline: null })).toStrictEqual({ level: 'low', reasons: [] });
  });

  it('is high for a very large change and for a far-behind branch with a failing pipeline', () => {
    expect(projectOverviewIntegrationRisk({ behind: 0, changedFiles: 273, overlapFiles: 40, overlapBranches: 3, baseCommitsPerDay: 22, latestPipeline: null }).level).toBe('high');
    expect(projectOverviewIntegrationRisk({ behind: 31, changedFiles: 12, overlapFiles: 0, overlapBranches: 0, baseCommitsPerDay: 22, latestPipeline: 'failed' }))
      .toStrictEqual({ level: 'high', reasons: [{ kind: 'behind', commits: 31 }, { kind: 'velocity', commitsPerDay: 22 }, { kind: 'failingPipeline' }] });
  });
});

describe('project flow stations', () => {
  it.each([
    ['no pull request', unit('a'), 'building'],
    ['a draft pull request', unit('a', { pullRequest: pullRequest(null, day, true) }), 'building'],
    ['an open pull request that is not approved', unit('a', { pullRequest: pullRequest(false, day) }), 'review'],
    ['an approved pull request', unit('a', { pullRequest: pullRequest(true, day) }), 'ci'],
    ['unknown approval with a running pipeline', unit('a', { pullRequest: pullRequest(null, day), latestPipeline: { status: 'running', at: now - hour } }), 'ci'],
    ['unknown approval with a failed pipeline', unit('a', { pullRequest: pullRequest(null, day), latestPipeline: { status: 'failed', at: now - hour } }), 'ci'],
    ['unknown approval with a passed pipeline', unit('a', { pullRequest: pullRequest(null, day), latestPipeline: { status: 'passed', at: now - hour } }), 'review'],
    ['unknown approval and no pipeline', unit('a', { pullRequest: pullRequest(null, day) }), 'review'],
  ] as const)('places a unit with %s', (_name, value, station) => {
    expect(projectFlowStation(value)).toBe(station);
  });
});

describe('project flow', () => {
  const connected = { git: 'available', backlog: 'available', pullRequests: 'available', pipelines: 'available' } as const;
  const input = (overrides: Partial<ProjectFlowInput> = {}): ProjectFlowInput => ({
    now,
    sources: connected,
    backlog: { open: 47, arrived: 9 },
    shipped: { count: 31, recentBranches: ['feat/cursor-usage', 'fix/gh-90'] },
    agentsWorking: 4,
    workstreams: [{ id: 'w1', branches: ['feat/cursor-usage', 'feat/cursor-steering', 'fix/cursor-resume'] }, { id: 'w2', branches: ['refactor/sdk-extraction'] }],
    units: [
      unit('feat/cursor-steering', { firstCommitAt: now - 3 * hour, agentWorking: true }),
      unit('feat/other', { firstCommitAt: now - 5 * day, lastCommitAt: now - 2 * day }),
      unit('fix/cursor-resume', { pullRequest: pullRequest(false, 3 * day) }),
      unit('refactor/sdk-extraction', { pullRequest: pullRequest(false, 2 * day) }),
      unit('fix/gh-91', { pullRequest: pullRequest(false, 2 * hour) }),
      unit('feat/ready', { pullRequest: pullRequest(true, 4 * day), latestPipeline: { status: 'failed', at: now - 3 * hour } }),
    ],
    ...overrides,
  });

  it('places work at its station with marks, moving tokens and the constraint', () => {
    expect(buildProjectFlow(input())).toStrictEqual({
      stations: [
        { kind: 'backlog', status: 'available', count: 47, note: 9, marks: [] },
        { kind: 'building', status: 'available', count: 2, note: 4, marks: [{ workstreamId: 'w1', units: 1 }, { workstreamId: null, units: 1 }] },
        { kind: 'review', status: 'available', count: 3, note: 3 * day, marks: [{ workstreamId: 'w1', units: 1 }, { workstreamId: 'w2', units: 1 }, { workstreamId: null, units: 1 }] },
        { kind: 'ci', status: 'available', count: 1, note: 1, marks: [{ workstreamId: null, units: 1 }] },
        { kind: 'shipped', status: 'available', count: 31, note: null, marks: [] },
      ],
      links: [
        { to: 'building', tokens: ['w1'] },
        { to: 'review', tokens: [null] },
        { to: 'ci', tokens: [null] },
        { to: 'shipped', tokens: ['w1', null] },
      ],
      constraint: { station: 'review', units: 3, oldestWaitMs: 3 * day, workstreamIds: ['w1', 'w2'] },
    });
  });

  it('names no constraint when little is waiting, and prefers the later station on a tie', () => {
    expect(buildProjectFlow(input({ units: [unit('a', { pullRequest: pullRequest(false, 5 * day) })] })).constraint).toBeNull();
    expect(buildProjectFlow(input({ units: [unit('a', { pullRequest: pullRequest(false, 20 * hour) }), unit('b', { pullRequest: pullRequest(false, 23 * hour) })] })).constraint).toBeNull();
    const tie = buildProjectFlow(input({
      workstreams: [],
      units: [
        unit('a', { pullRequest: pullRequest(false, 2 * day) }), unit('b', { pullRequest: pullRequest(false, 2 * day) }),
        unit('c', { pullRequest: pullRequest(true, 9 * day), latestPipeline: { status: 'passed', at: now - 2 * day } }),
        unit('d', { pullRequest: pullRequest(true, 9 * day), latestPipeline: { status: 'passed', at: now - 2 * day } }),
      ],
    }));
    expect(tie.constraint).toStrictEqual({ station: 'ci', units: 2, oldestWaitMs: 2 * day, workstreamIds: [] });
  });

  it('does not count a branch an agent is working on as waiting, and caps tokens at three', () => {
    const busy = buildProjectFlow(input({
      units: [
        unit('a', { firstCommitAt: now - hour, lastCommitAt: now - 9 * day, agentWorking: true }),
        unit('b', { firstCommitAt: now - hour, lastCommitAt: now - 9 * day, agentWorking: true }),
        unit('c', { firstCommitAt: now - hour }), unit('d', { firstCommitAt: now - hour }),
      ],
    }));
    expect(busy.constraint).toBeNull();
    expect(busy.links[0]).toStrictEqual({ to: 'building', tokens: [null, null, null] });
  });

  it('keeps every unit in building and marks review and CI as not connected without a code host', () => {
    const flow = buildProjectFlow(input({ sources: { git: 'available', backlog: 'notConnected', pullRequests: 'notConnected', pipelines: 'notConnected' }, backlog: null }));
    expect(flow.stations.map(station => [station.kind, station.status, station.count])).toStrictEqual([
      ['backlog', 'notConnected', null], ['building', 'available', 6], ['review', 'notConnected', null], ['ci', 'notConnected', null], ['shipped', 'available', 31],
    ]);
    expect(flow.links.map(link => link.tokens.length)).toStrictEqual([1, 0, 0, 2]);
  });

  it('shows nothing from a repository that could not be read', () => {
    const flow = buildProjectFlow(input({ sources: { ...connected, git: 'failed' }, units: [], shipped: null }));
    expect(flow.stations.map(station => [station.kind, station.status, station.count])).toStrictEqual([
      ['backlog', 'available', 47], ['building', 'failed', null], ['review', 'failed', null], ['ci', 'failed', null], ['shipped', 'failed', null],
    ]);
    expect(flow.constraint).toBeNull();
  });
});

describe('project narrative drafts', () => {
  const evidence: ProjectNarrativeEvidence = {
    facts: [
      { id: 'F1', text: 'Release 0.56 shipped on Nov 9.', label: 'the 0.56 release' },
      { id: 'F2', text: '32 fix commits since Oct 20 mention "cursor".', label: '32 Cursor fixes since Oct 20' },
      { id: 'F3', text: 'Branch refactor/sdk-extraction changes 273 files and removes about 26,000 lines.', label: 'refactor/sdk-extraction' },
    ],
    branches: ['refactor/sdk-extraction', 'feat/cursor-steering'],
    issues: ['#84', '#83'],
  };
  const cursor = { name: 'Cursor engine', state: 'settling', analysis: 'Shipped in 0.56 and still settling: 32 fixes have followed since Oct 20.', facts: ['F1', 'F2'], branches: ['feat/cursor-steering'], issues: ['#84'] };
  const sdk = { name: 'Shared SDK extraction', state: 'waiting', analysis: 'One branch removes about 26,000 lines across 273 files and gets harder to land every day.', facts: ['F3'], branches: ['refactor/sdk-extraction'] };

  it('accepts a grounded draft and composes ids and the basis from cited facts', () => {
    expect(projectNarrativeFromDraft({ lead: 'Cursor shipped in 0.56 and one large refactor is waiting.', workstreams: [cursor, sdk] }, evidence)).toStrictEqual({
      ok: true,
      lead: 'Cursor shipped in 0.56 and one large refactor is waiting.',
      workstreams: [
        { id: 'w1', name: 'Cursor engine', state: 'settling', analysis: cursor.analysis, basis: ['the 0.56 release', '32 Cursor fixes since Oct 20'], branches: ['feat/cursor-steering'], issues: ['#84'] },
        { id: 'w2', name: 'Shared SDK extraction', state: 'waiting', analysis: sdk.analysis, basis: ['refactor/sdk-extraction'], branches: ['refactor/sdk-extraction'], issues: [] },
      ],
    });
  });

  it.each([
    ['a number no cited fact contains', { lead: 'Fine.', workstreams: [{ ...cursor, analysis: 'There were 45 fixes.' }] }, 'Workstream 1 states 45, which none of its cited facts contain.'],
    ['a number in the lead that no cited fact contains', { lead: 'There were 99 fixes.', workstreams: [cursor] }, 'The lead states 99, which no cited fact contains.'],
    ['a fact that was never supplied', { lead: 'Fine.', workstreams: [{ ...cursor, facts: ['F9'] }] }, 'Workstream 1 cites unknown fact F9.'],
    ['no fact at all', { lead: 'Fine.', workstreams: [{ ...cursor, facts: [] }] }, 'Workstream 1 cites no facts.'],
    ['a branch that is not in the evidence', { lead: 'Fine.', workstreams: [{ ...sdk, branches: ['main'] }] }, 'Workstream 1 claims unknown branch main.'],
    ['an issue that is not in the evidence', { lead: 'Fine.', workstreams: [{ ...cursor, issues: ['#1'] }] }, 'Workstream 1 claims unknown issue #1.'],
    ['a state outside the closed set', { lead: 'Fine.', workstreams: [{ ...cursor, state: 'on fire' }] }, 'Workstream 1 has an unknown state.'],
    ['an analysis that is too long', { lead: 'Fine.', workstreams: [{ ...sdk, analysis: 'x'.repeat(361) }] }, 'Workstream 1 needs an analysis of at most 360 characters.'],
    ['a lead that is too long', { lead: 'x'.repeat(281), workstreams: [cursor] }, 'The lead must be 1 to 280 characters.'],
    ['more than four workstreams', { lead: 'Fine.', workstreams: [cursor, cursor, cursor, cursor, cursor] }, 'There must be 1 to 4 workstreams.'],
    ['something that is not a narrative', 'just prose', 'The reply is not a narrative object.'],
  ] as const)('rejects %s', (_name, draft, problem) => {
    expect(projectNarrativeFromDraft(draft, evidence)).toStrictEqual({ ok: false, problems: [problem] });
  });

  it('allows numbers written as words and reads grouped digits as one number', () => {
    const draft = { lead: 'Two workstreams matter.', workstreams: [{ ...sdk, analysis: 'One branch removes about 26,000 lines in a single commit.' }] };
    expect(projectNarrativeFromDraft(draft, evidence)).toMatchObject({ ok: true });
  });
});
