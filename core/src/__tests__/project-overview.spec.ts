import { describe, expect, it } from 'vitest';
import {
  buildProjectFlow,
  chooseProjectLookback,
  projectFlowReading,
  projectOverviewSourceFailed,
  projectOverviewSourcesReading,
  type ProjectOverview,
  projectFlowStation,
  projectMedianDuration,
  projectNarrativeFromDraft,
  projectNarrativeLeadParts,
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
  return { branch, pullRequest: null, latestPipeline: null, firstCommitAt: now - 2 * day, lastCommitAt: now - hour, agentWorking: false, agentId: null, agentNeedsInput: false, ...overrides };
}
const pullRequest = (approved: boolean | null, openedAgo: number, draft = false, conflicts: boolean | null = false) => ({ draft, approved, conflicts, openedAt: now - openedAgo, url: `https://example.com/pr/${openedAgo}` });

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
    // Recently merged pull requests stayed open two days, half of them longer.
    medianMergeMs: 2 * day,
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

  it('places work at its station with marks, moving tokens, stuck work and the constraint', () => {
    expect(buildProjectFlow(input())).toStrictEqual({
      stations: [
        { kind: 'backlog', status: 'available', count: 47, note: 9, marks: [], stuck: [] },
        { kind: 'building', status: 'available', count: 2, note: 4, marks: [{ workstreamId: 'w1', units: 1 }, { workstreamId: null, units: 1 }], stuck: [] },
        {
          kind: 'review', status: 'available', count: 3, note: 3 * day, marks: [{ workstreamId: 'w1', units: 1 }, { workstreamId: 'w2', units: 1 }, { workstreamId: null, units: 1 }],
          // Open three days against a two day median; the one open exactly two days is not over it.
          stuck: [{ branch: 'fix/cursor-resume', reason: 'overdue', target: { kind: 'url', url: `https://example.com/pr/${3 * day}` } }],
        },
        { kind: 'ci', status: 'available', count: 1, note: 1, marks: [{ workstreamId: null, units: 1 }], stuck: [{ branch: 'feat/ready', reason: 'failing', target: { kind: 'url', url: `https://example.com/pr/${4 * day}` } }] },
        { kind: 'shipped', status: 'available', count: 31, note: null, marks: [], stuck: [] },
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

  it('flags conflicts and a teammate waiting for input, linking to the request or the agent thread', () => {
    const flow = buildProjectFlow(input({
      units: [
        unit('feat/asks', { agentId: 'agent-7', agentNeedsInput: true }),
        unit('feat/clash', { pullRequest: pullRequest(false, hour, false, true), agentId: 'agent-8' }),
        unit('feat/quiet', { agentId: 'agent-9' }),
      ],
    }));
    expect(flow.stations[1]!.stuck).toStrictEqual([{ branch: 'feat/asks', reason: 'needsInput', target: { kind: 'agent', agentId: 'agent-7' } }]);
    expect(flow.stations[2]!.stuck).toStrictEqual([{ branch: 'feat/clash', reason: 'conflicts', target: { kind: 'url', url: `https://example.com/pr/${hour}` } }]);
  });

  it('measures "open too long" against three days when there is no merge history, and links to the agent when a request has no address', () => {
    const flow = buildProjectFlow(input({
      medianMergeMs: null,
      units: [
        unit('a', { pullRequest: { ...pullRequest(false, 4 * day), url: null }, agentId: 'agent-1' }),
        unit('b', { pullRequest: pullRequest(false, 2 * day) }),
        unit('c', { pullRequest: { ...pullRequest(false, 5 * day), url: null } }),
      ],
    }));
    expect(flow.stations[2]!.stuck).toStrictEqual([
      { branch: 'a', reason: 'overdue', target: { kind: 'agent', agentId: 'agent-1' } },
      { branch: 'c', reason: 'overdue', target: null },
    ]);
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

  it('marks each station loading only while the sources it is placed by are still being read', () => {
    const status = (flow: ReturnType<typeof buildProjectFlow>) => flow.stations.map(station => [station.kind, station.status, station.count]);
    // Git alone places nothing past Building until the code host answers, so Building waits for reviews too.
    expect(status(buildProjectFlow(input({ sources: { git: 'available', backlog: 'loading', pullRequests: 'loading', pipelines: 'loading' }, backlog: null })))).toStrictEqual([
      ['backlog', 'loading', null], ['building', 'loading', null], ['review', 'loading', null], ['ci', 'loading', null], ['shipped', 'available', 31],
    ]);
    // Reviews answered: Building is known; Review and CI still wait on pipelines to place unapproved requests.
    const pipelinesLeft = buildProjectFlow(input({ sources: { ...connected, pipelines: 'loading' } }));
    expect(status(pipelinesLeft)).toStrictEqual([
      ['backlog', 'available', 47], ['building', 'available', 2], ['review', 'loading', null], ['ci', 'loading', null], ['shipped', 'available', 31],
    ]);
    expect(pipelinesLeft.links.map(link => link.tokens.length)).toStrictEqual([1, 0, 0, 2]);
    // Without a code host, pipelines do not matter and Building holds every unit.
    expect(status(buildProjectFlow(input({ sources: { git: 'available', backlog: 'loading', pullRequests: 'notConnected', pipelines: 'loading' }, backlog: null })))).toStrictEqual([
      ['backlog', 'loading', null], ['building', 'available', 6], ['review', 'notConnected', null], ['ci', 'notConnected', null], ['shipped', 'available', 31],
    ]);
  });

  it('draws a flow that is still being read, and ends one source that never answered on its own stations only', () => {
    const reading = projectFlowReading();
    expect(reading.stations.map(station => [station.kind, station.status, station.count])).toStrictEqual(
      ['backlog', 'building', 'review', 'ci', 'shipped'].map(kind => [kind, 'loading', null]),
    );
    expect(reading.links.every(link => link.tokens.length === 0)).toBe(true);
    expect(reading.constraint).toBeNull();

    const sources = { git: 'available', backlog: 'loading', pullRequests: 'loading', pipelines: 'loading' } as const;
    expect(projectOverviewSourcesReading(sources)).toBe(3);
    expect(projectOverviewSourcesReading(connected)).toBe(0);
    const partial = { sources, flow: buildProjectFlow(input({ sources, backlog: null })) } as Pick<ProjectOverview, 'sources' | 'flow'> as ProjectOverview;
    const backlogLost = projectOverviewSourceFailed(partial, 'backlog');
    expect(backlogLost.sources).toStrictEqual({ ...sources, backlog: 'failed' });
    expect(backlogLost.flow.stations.map(station => station.status)).toStrictEqual(['failed', 'loading', 'loading', 'loading', 'available']);
    const requestsLost = projectOverviewSourceFailed(backlogLost, 'pullRequests');
    expect(requestsLost.flow.stations.map(station => station.status)).toStrictEqual(['failed', 'failed', 'failed', 'failed', 'available']);
    // A source that already answered is not undone by a late failure.
    expect(projectOverviewSourceFailed({ ...partial, sources: { ...sources, backlog: 'available' } }, 'backlog').sources.backlog).toBe('available');
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
    ['an analysis that is too long', { lead: 'Fine.', workstreams: [{ ...sdk, analysis: 'x'.repeat(181) }] }, 'Workstream 1 needs one sentence of at most 180 characters.'],
    ['an analysis of two sentences', { lead: 'Fine.', workstreams: [{ ...sdk, analysis: 'One branch is waiting. It touches 273 files.' }] }, 'Workstream 1 needs one sentence of at most 180 characters.'],
    ['a lead that is too long', { lead: 'x'.repeat(161), workstreams: [cursor] }, 'The lead must be one sentence of at most 160 characters.'],
    ['a lead of two sentences', { lead: 'Korus coordinates agents. Cursor is settling.', workstreams: [cursor] }, 'The lead must be one sentence of at most 160 characters.'],
    ['more than four workstreams', { lead: 'Fine.', workstreams: [cursor, cursor, cursor, cursor, cursor] }, 'There must be 1 to 4 workstreams.'],
    ['something that is not a narrative', 'just prose', 'The reply is not a narrative object.'],
  ] as const)('rejects %s', (_name, draft, problem) => {
    expect(projectNarrativeFromDraft(draft, evidence)).toStrictEqual({ ok: false, problems: [problem] });
  });

  it('opens the lead with the project name and keeps it to what the project is', () => {
    const named = { ...evidence, project: 'metadata-search' };
    expect(projectNarrativeFromDraft({ lead: 'Metadata-search pulls Discogs label catalogs into Excel contract schedules.', workstreams: [cursor] }, named)).toMatchObject({ ok: true });
    expect(projectNarrativeFromDraft({ lead: 'A music search app that pulls Discogs label catalogs into Excel.', workstreams: [cursor] }, named))
      .toStrictEqual({ ok: false, problems: ['The lead must start with the project name, metadata-search.'] });
  });

  it('splits a lead into the project name it opens with and the rest, keeping how the lead spells it', () => {
    expect(projectNarrativeLeadParts('Korus is a desktop app for coordinating teams of coding agents.', 'korus'))
      .toStrictEqual({ name: 'Korus', rest: ' is a desktop app for coordinating teams of coding agents.' });
    // A name inside a longer word is not the name, and a lead written before the rule has none.
    expect(projectNarrativeLeadParts('Korusville is a town.', 'korus')).toBeNull();
    expect(projectNarrativeLeadParts('Cursor follow-up dominates.', 'korus')).toBeNull();
  });

  it('reads a version or a decimal inside a sentence as part of it, not as a second sentence', () => {
    expect(projectNarrativeFromDraft({ lead: 'Release 0.56 shipped Cursor support.', workstreams: [cursor] }, evidence)).toMatchObject({ ok: true });
  });

  it('allows numbers written as words and reads grouped digits as one number', () => {
    const draft = { lead: 'Two workstreams matter.', workstreams: [{ ...sdk, analysis: 'One branch removes about 26,000 lines in a single commit.' }] };
    expect(projectNarrativeFromDraft(draft, evidence)).toMatchObject({ ok: true });
  });
});

describe('project lookback', () => {
  const at = (...daysAgo: number[]) => daysAgo.map(days => now - days * day);
  const spread = (count: number, fromDays: number, toDays: number) => Array.from({ length: count }, (_, index) => now - (fromDays + (toDays - fromDays) * index / Math.max(1, count - 1)) * day);

  it('uses the last 30 days when they hold enough activity', () => {
    expect(chooseProjectLookback({ now, commits: spread(40, 1, 29), merges: [], branches: [] })).toStrictEqual({ days: 30, since: now - 30 * day });
  });

  it('counts merged pull requests and new branches for more than plain commits', () => {
    // 10 commits alone are not enough; with 5 merges and 4 branches (10 + 20 + 12) they are.
    expect(chooseProjectLookback({ now, commits: spread(10, 1, 20), merges: at(2, 5, 9, 14, 20), branches: at(3, 8, 12, 16) }).days).toBe(30);
    expect(chooseProjectLookback({ now, commits: spread(10, 1, 20), merges: at(2, 5, 9, 14, 20), branches: at(3, 8, 12) }).days).not.toBe(30);
    expect(chooseProjectLookback({ now, commits: spread(10, 1, 20), merges: [], branches: [] }).days).not.toBe(30);
  });

  it('looks further back until it finds enough activity to write about', () => {
    const quietRecently = { now, commits: [...spread(3, 1, 20), ...spread(45, 100, 170)], merges: [], branches: [] };
    expect(chooseProjectLookback(quietRecently)).toStrictEqual({ days: 180, since: now - 180 * day });
    const mergesLongAgo = { now, commits: spread(5, 1, 20), merges: spread(9, 200, 360), branches: [] };
    expect(chooseProjectLookback(mergesLongAgo).days).toBe(365);
  });

  it('falls back to the whole history from its first commit, and to now for an empty repository', () => {
    const first = now - 1000 * day;
    expect(chooseProjectLookback({ now, commits: [now - day, first, now - 400 * day], merges: [], branches: [now - 900 * day] })).toStrictEqual({ days: null, since: first });
    expect(chooseProjectLookback({ now, commits: [], merges: [], branches: [] })).toStrictEqual({ days: null, since: now });
  });
});

describe('project median duration', () => {
  it('needs three merges to say what is usual, and takes the middle of them', () => {
    expect(projectMedianDuration([day, 2 * day])).toBeNull();
    expect(projectMedianDuration([5 * day, day, 2 * day])).toBe(2 * day);
    expect(projectMedianDuration([day, 2 * day, 3 * day, 4 * day])).toBe(2.5 * day);
  });
});
