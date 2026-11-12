import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { dayStart } from '@workspace/core/usage-time';
import type { ProjectOverviewGitFacts } from '../git-reader';
import { ProjectOverviewService, type ProjectOverviewOuterLoop, type ProjectOverviewSession } from '../project-overview-service';

const now = Date.parse('2026-11-11T12:00:00Z');
const at = (iso: string) => Date.parse(iso);

function agent(id: string, branch: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id, name: null, backend: 'claude', folder: `/work/korus-${id}`, status: { type: 'idle' },
    workspace: {
      kind: 'git', folder: `/work/korus-${id}`, repositoryName: 'korus', repositoryRoot: `/work/korus-${id}`,
      primaryWorktreeRoot: '/work/korus', branch, isLinkedWorktree: true, updatedAt: '2026-11-11T00:00:00Z',
    },
    ...overrides,
  } as Agent;
}

const facts = (): ProjectOverviewGitFacts => ({
  name: 'korus',
  branch: 'feat/overview',
  baseBranch: 'main',
  commits: [
    { at: at('2026-11-10T11:00:00Z'), subject: 'fix: b', merge: false },
    { at: at('2026-11-10T10:00:00Z'), subject: 'feat: a', merge: false },
    { at: at('2026-11-09T12:00:00Z'), subject: "Merge branch 'feat/git-log'", merge: true },
    { at: at('2026-11-09T11:00:00Z'), subject: 'chore: c', merge: false },
    { at: at('2026-11-09T10:00:00Z'), subject: 'weird subject', merge: false },
  ],
  tags: [{ name: 'v1.2.0', at: at('2026-11-09T13:00:00Z') }],
  branches: [
    { name: 'main', lastCommitAt: at('2026-11-10T11:00:00Z'), behind: 0, ahead: 0, files: [] },
    { name: 'feat/overview', lastCommitAt: at('2026-11-11T09:00:00Z'), behind: 14, ahead: 6, files: ['a.ts', 'b.ts', 'c.ts'] },
    { name: 'feat/other', lastCommitAt: at('2026-11-08T09:00:00Z'), behind: 2, ahead: 1, files: ['a.ts', 'z.ts'] },
  ],
  baseCommitsPerDay: 22,
});

const sessions = (): ProjectOverviewSession[] => [
  { provider: 'claude', sessionId: 's3', startedAt: at('2026-11-09T09:00:00Z'), turns: 1, failedTurns: 0 },
  { provider: 'codex', sessionId: 's1', startedAt: at('2026-11-10T09:00:00Z'), turns: 3, failedTurns: 1 },
  { provider: 'codex', sessionId: 's2', startedAt: at('2026-11-10T15:00:00Z'), turns: 2, failedTurns: 0 },
];

function setup(options: { git?: ProjectOverviewGitFacts | null | Error; ledger?: ProjectOverviewSession[] | null; outerLoop?: ProjectOverviewOuterLoop; agents?: Agent[] } = {}) {
  const requester = agent('a1', 'feat/overview', { name: 'Overview', status: { type: 'working' } });
  const agents = options.agents ?? [
    requester,
    agent('a2', 'feat/other', { backend: 'codex' }),
    agent('a3', 'feat/overview', { workspace: { kind: 'git', folder: '/work/else', repositoryName: 'else', repositoryRoot: '/work/else', primaryWorktreeRoot: '/work/else', branch: 'feat/overview', isLinkedWorktree: false, updatedAt: '' } }),
  ];
  const clock = { now };
  const git = options.git === undefined ? facts() : options.git;
  const read = vi.fn(async () => { if (git instanceof Error) throw git; return git; });
  const ledger = vi.fn(() => options.ledger === undefined ? sessions() : options.ledger);
  const service = new ProjectOverviewService({ git: { read }, sessions: ledger, agents: () => agents, outerLoop: options.outerLoop, now: () => clock.now });
  return { service, requester, read, ledger, clock };
}

const since = dayStart('2026-11-05', 'UTC');
const emptyCommits = { feat: 0, fix: 0, test: 0, chore: 0, other: 0 };

describe('project overview service', () => {
  it('composes the story, sessions, branches and risk from the repository and the ledger alone', async () => {
    const { service, requester, read, ledger } = setup();

    const overview = await service.get(requester, { window: '7d', timeZone: 'UTC' });

    expect(read).toHaveBeenCalledExactlyOnceWith('/work/korus-a1', { since, now, defaultBranch: null, keepBranches: ['feat/overview', 'feat/other'] });
    expect(ledger).toHaveBeenCalledExactlyOnceWith('/work/korus', since);
    expect(overview).toStrictEqual({
      generatedAt: '2026-11-11T12:00:00.000Z',
      repository: { name: 'korus', branch: 'feat/overview', baseBranch: 'main' },
      window: { kind: '7d', bucket: 'day', timeZone: 'UTC' },
      sources: { git: 'available', sessions: 'available', backlog: 'notConnected', pipelines: 'notConnected' },
      totals: { commits: 4, merges: 1, releases: 1, sessions: 3, turns: 6, workingAgents: 1, baseCommitsPerDay: 22 },
      buckets: [
        { start: '2026-11-05', commits: emptyCommits, merges: 0, mergedBranches: [], releases: [], sessions: [] },
        { start: '2026-11-06', commits: emptyCommits, merges: 0, mergedBranches: [], releases: [], sessions: [] },
        { start: '2026-11-07', commits: emptyCommits, merges: 0, mergedBranches: [], releases: [], sessions: [] },
        { start: '2026-11-08', commits: emptyCommits, merges: 0, mergedBranches: [], releases: [], sessions: [] },
        { start: '2026-11-09', commits: { ...emptyCommits, chore: 1, other: 1 }, merges: 1, mergedBranches: ['feat/git-log'], releases: ['v1.2.0'], sessions: [{ provider: 'claude', sessions: 1, turns: 1, failedTurns: 0 }] },
        { start: '2026-11-10', commits: { ...emptyCommits, feat: 1, fix: 1 }, merges: 0, mergedBranches: [], releases: [], sessions: [{ provider: 'codex', sessions: 2, turns: 5, failedTurns: 1 }] },
        { start: '2026-11-11', commits: emptyCommits, merges: 0, mergedBranches: [], releases: [], sessions: [] },
      ],
      chapters: [{ start: '2026-11-09', buckets: 2, title: 'Git log', branches: ['feat/git-log'] }],
      branches: [
        { name: 'main', base: true, current: false, lastCommitAt: '2026-11-10T11:00:00.000Z', behind: 0, ahead: 0, changedFiles: 0, agents: [], pipelineRuns: null, risk: null },
        {
          name: 'feat/overview', base: false, current: true, lastCommitAt: '2026-11-11T09:00:00.000Z', behind: 14, ahead: 6, changedFiles: 3,
          agents: [{ id: 'a1', name: 'Overview', backend: 'claude', status: 'working' }],
          pipelineRuns: null,
          risk: { level: 'medium', gitOnly: true, reasons: [{ kind: 'behind', commits: 14 }, { kind: 'overlap', files: 1, branches: 1 }, { kind: 'velocity', commitsPerDay: 22 }] },
        },
        {
          name: 'feat/other', base: false, current: false, lastCommitAt: '2026-11-08T09:00:00.000Z', behind: 2, ahead: 1, changedFiles: 2,
          agents: [{ id: 'a2', name: 'feat/other', backend: 'codex', status: 'idle' }],
          pipelineRuns: null,
          risk: { level: 'medium', gitOnly: true, reasons: [{ kind: 'behind', commits: 2 }, { kind: 'overlap', files: 1, branches: 1 }, { kind: 'velocity', commitsPerDay: 22 }] },
        },
      ],
      backlog: null,
      pipelines: null,
    });
  });

  it('serves a repeated request from its cache for thirty seconds and reads again afterwards or for another window', async () => {
    const { service, requester, read, clock } = setup();
    const first = await service.get(requester, { window: '7d', timeZone: 'UTC' });
    clock.now += 29_000;
    expect(await service.get(requester, { window: '7d', timeZone: 'UTC' })).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    await service.get(requester, { window: '30d', timeZone: 'UTC' });
    expect(read).toHaveBeenCalledTimes(2);
    clock.now += 2_000;
    expect(await service.get(requester, { window: '7d', timeZone: 'UTC' })).not.toBe(first);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('adds backlog flow and pipeline runs when the repository\'s code host is connected', async () => {
    const outerLoop: ProjectOverviewOuterLoop = {
      backlog: vi.fn(async () => ({
        provider: 'github' as const,
        open: 47,
        items: [
          { id: '#83', title: 'Annotations hidden in older messages', state: 'closed' as const, createdAt: '2026-10-20T10:00:00Z', closedAt: '2026-11-09T10:00:00Z', updatedAt: '2026-11-09T10:00:00Z' },
          { id: '#84', title: 'Worktree delete leaves a folder', state: 'open' as const, createdAt: '2026-11-10T10:00:00Z', updatedAt: '2026-11-10T10:00:00Z' },
          { id: '#80', title: 'Older issue with a new comment', state: 'open' as const, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-11-11T08:00:00Z' },
        ],
      })),
      pipelines: vi.fn(async () => ({
        provider: 'github' as const,
        runs: [
          { id: '5', branch: 'feat/overview', status: 'failed' as const, at: '2026-11-11T09:30:00Z' },
          { id: '1', branch: 'main', status: 'passed' as const, at: '2026-11-09T12:10:00Z' },
          { id: '3', branch: 'main', status: 'passed' as const, at: '2026-11-10T11:10:00Z' },
          { id: '2', branch: 'main', status: 'failed' as const, at: '2026-11-10T10:10:00Z' },
          { id: '4', branch: 'feat/overview', status: 'passed' as const, at: '2026-11-11T09:10:00Z' },
          { id: '6', branch: 'main', status: 'running' as const, at: '2026-11-11T11:50:00Z' },
        ],
      })),
    };
    const { service } = setup({ outerLoop });
    const requester = agent('a1', 'feat/overview', { name: 'Overview' });
    requester.workspace = { ...requester.workspace!, kind: 'git', originUrl: 'git@github.com:acme/korus.git' } as Agent['workspace'];

    const overview = await service.get(requester, { window: '7d', timeZone: 'UTC' });

    expect(outerLoop.backlog).toHaveBeenCalledExactlyOnceWith('github.com/acme/korus', since);
    expect(outerLoop.pipelines).toHaveBeenCalledExactlyOnceWith('github.com/acme/korus', since);
    expect(overview.sources).toStrictEqual({ git: 'available', sessions: 'available', backlog: 'available', pipelines: 'available' });
    expect(overview.backlog).toStrictEqual({
      provider: 'github',
      open: 47,
      opened: 1,
      closed: 1,
      buckets: [
        { start: '2026-11-05', opened: 0, closed: 0 }, { start: '2026-11-06', opened: 0, closed: 0 },
        { start: '2026-11-07', opened: 0, closed: 0 }, { start: '2026-11-08', opened: 0, closed: 0 },
        { start: '2026-11-09', opened: 0, closed: 1 }, { start: '2026-11-10', opened: 1, closed: 0 },
        { start: '2026-11-11', opened: 0, closed: 0 },
      ],
      latest: [
        { id: '#80', title: 'Older issue with a new comment', change: 'updated', at: '2026-11-11T08:00:00Z' },
        { id: '#84', title: 'Worktree delete leaves a folder', change: 'opened', at: '2026-11-10T10:00:00Z' },
        { id: '#83', title: 'Annotations hidden in older messages', change: 'closed', at: '2026-11-09T10:00:00Z' },
      ],
    });
    expect(overview.pipelines).toStrictEqual({
      provider: 'github',
      passRate: 2 / 3,
      baseRuns: [
        { id: '1', branch: 'main', status: 'passed', at: '2026-11-09T12:10:00Z' },
        { id: '2', branch: 'main', status: 'failed', at: '2026-11-10T10:10:00Z' },
        { id: '3', branch: 'main', status: 'passed', at: '2026-11-10T11:10:00Z' },
        { id: '6', branch: 'main', status: 'running', at: '2026-11-11T11:50:00Z' },
      ],
    });
    const [base, current, other] = overview.branches;
    expect(base!.pipelineRuns).toHaveLength(4);
    expect(current!.pipelineRuns).toStrictEqual([
      { id: '4', branch: 'feat/overview', status: 'passed', at: '2026-11-11T09:10:00Z' },
      { id: '5', branch: 'feat/overview', status: 'failed', at: '2026-11-11T09:30:00Z' },
    ]);
    expect(current!.risk).toStrictEqual({
      level: 'high', gitOnly: false,
      reasons: [{ kind: 'behind', commits: 14 }, { kind: 'overlap', files: 1, branches: 1 }, { kind: 'velocity', commitsPerDay: 22 }, { kind: 'failingPipeline' }],
    });
    // The host is connected but this branch has no runs yet, so its level still rests on the repository alone.
    expect(other!.pipelineRuns).toStrictEqual([]);
    expect(other!.risk!.gitOnly).toBe(true);
  });

  it('keeps a failing provider and a failing repository read inside their own zones', async () => {
    const outerLoop: ProjectOverviewOuterLoop = {
      backlog: vi.fn(async () => { throw new Error('GitHub request failed with 500: secret detail'); }),
      pipelines: vi.fn(async () => null),
    };
    const { service } = setup({ git: new Error('git exploded'), outerLoop });
    const requester = agent('a1', 'feat/overview');
    requester.workspace = { ...requester.workspace!, kind: 'git', originUrl: 'https://github.com/acme/korus.git' } as Agent['workspace'];

    const overview = await service.get(requester, { window: '7d', timeZone: 'UTC' });

    expect(overview.sources).toStrictEqual({ git: 'failed', sessions: 'available', backlog: 'failed', pipelines: 'notConnected' });
    expect(overview.repository).toStrictEqual({ name: 'korus', branch: 'feat/overview', baseBranch: null });
    expect(overview.branches).toStrictEqual([]);
    expect(overview.chapters).toStrictEqual([]);
    expect(overview.backlog).toBeNull();
    expect(overview.pipelines).toBeNull();
    expect(overview.totals).toMatchObject({ commits: 0, merges: 0, sessions: 3, turns: 6, baseCommitsPerDay: null });
    expect(overview.buckets.find(bucket => bucket.start === '2026-11-10')!.sessions).toStrictEqual([{ provider: 'codex', sessions: 2, turns: 5, failedTurns: 1 }]);
    expect(JSON.stringify(overview)).not.toContain('secret detail');
  });

  it('shows what it can for a plain folder with no repository and no statistics', async () => {
    const { service } = setup({ git: null, ledger: null });
    const plain = { id: 'p1', name: 'Notes', backend: 'codex', folder: '/work/notes', status: { type: 'idle' }, workspace: { kind: 'folder', folder: '/work/notes', label: 'notes', updatedAt: '' } } as Agent;

    const overview = await service.get(plain);

    expect(overview.window).toStrictEqual({ kind: '30d', bucket: 'day', timeZone: 'UTC' });
    expect(overview.sources).toStrictEqual({ git: 'unavailable', sessions: 'unavailable', backlog: 'notConnected', pipelines: 'notConnected' });
    expect(overview.repository).toStrictEqual({ name: 'notes', branch: null, baseBranch: null });
    expect(overview.buckets).toHaveLength(30);
    expect(overview.totals).toStrictEqual({ commits: 0, merges: 0, releases: 0, sessions: 0, turns: 0, workingAgents: 0, baseCommitsPerDay: null });
  });

  it('rejects a malformed request and an agent without a folder before reading anything', async () => {
    const { service, requester, read } = setup();
    await expect(service.get(requester, { window: 'forever' })).rejects.toThrow('Invalid project overview request.');
    await expect(service.get({ ...requester, folder: null }, {})).rejects.toThrow('This agent has no folder.');
    expect(read).not.toHaveBeenCalled();
  });
});
