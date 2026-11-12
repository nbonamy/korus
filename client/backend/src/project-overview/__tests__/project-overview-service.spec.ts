import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import type { ProjectOverviewGitFacts } from '../git-reader';
import { ProjectNarrativeStore } from '../narrative-store';
import { ProjectOverviewService, type ProjectOverviewGenerate, type ProjectOverviewOuterLoop } from '../project-overview-service';

const hour = 3_600_000;
const day = 24 * hour;
const start = Date.parse('2026-11-11T12:00:00Z');
const ago = (ms: number) => new Date(start - ms).toISOString();
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

function agent(id: string, branch: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id, name: null, backend: 'claude', folder: `/work/korus-${id}`, status: { type: 'idle' },
    workspace: {
      kind: 'git', folder: `/work/korus-${id}`, repositoryName: 'korus', repositoryRoot: `/work/korus-${id}`, originUrl: 'git@github.com:acme/korus.git',
      primaryWorktreeRoot: '/work/korus', branch, isLinkedWorktree: true, updatedAt: '2026-11-11T00:00:00Z',
    },
    ...overrides,
  } as Agent;
}

const facts = (): ProjectOverviewGitFacts => ({
  name: 'korus',
  branch: 'feat/cursor-steering',
  baseBranch: 'main',
  commits: [
    { at: start - 2 * hour, subject: "Merge branch 'feat/cursor-usage'", merge: true },
    { at: start - 3 * hour, subject: 'fix: attach cursor sessions before streaming', merge: false },
    { at: start - 5 * hour, subject: 'fix: remember cursor defaults', merge: false },
    { at: start - day, subject: 'fix: hide cursor thoughts', merge: false },
    { at: start - 2 * day, subject: 'fix: separate cursor usage from billing', merge: false },
    { at: start - 3 * day, subject: "Merge branch 'feat/multi-window'", merge: true },
    { at: start - 4 * day, subject: 'feat: add interface zoom', merge: false },
    { at: start - 20 * day, subject: "Merge branch 'feat/old'", merge: true },
  ],
  tags: [{ name: 'v0.56.0', at: start - 2 * day }],
  branches: [
    { name: 'main', firstCommitAt: start - 2 * hour, lastCommitAt: start - 2 * hour, behind: 0, ahead: 0, files: [], insertions: 0, deletions: 0 },
    { name: 'feat/cursor-steering', firstCommitAt: start - 3 * hour, lastCommitAt: start - hour, behind: 3, ahead: 2, files: ['a.ts', 'b.ts'], insertions: 40, deletions: 10 },
    { name: 'refactor/sdk-extraction', firstCommitAt: start - 2 * day, lastCommitAt: start - 2 * day, behind: 0, ahead: 1, files: Array.from({ length: 273 }, (_, index) => `f${index}.ts`), insertions: 921, deletions: 26_411 },
  ],
  baseCommitsPerDay: 45,
});

const connected = (): ProjectOverviewOuterLoop => ({
  backlog: vi.fn(async () => ({ provider: 'github' as const, open: 47, items: [
    { id: '#84', title: 'Cursor resume fails', state: 'open' as const, createdAt: ago(day), updatedAt: ago(day) },
    { id: '#83', title: 'Annotations hidden', state: 'closed' as const, createdAt: ago(20 * day), closedAt: ago(2 * day), updatedAt: ago(2 * day) },
  ] })),
  pullRequests: vi.fn(async () => [{ branch: 'refactor/sdk-extraction', draft: false, approved: false, openedAt: ago(2 * day) }]),
  pipelines: vi.fn(async () => ({ provider: 'github' as const, runs: [{ id: '1', branch: 'refactor/sdk-extraction', status: 'failed' as const, at: ago(day) }] })),
});

function setup(options: { git?: ProjectOverviewGitFacts | null | Error; outerLoop?: ProjectOverviewOuterLoop; agents?: Agent[]; store?: ProjectNarrativeStore } = {}) {
  const requester = agent('a1', 'feat/cursor-steering', { name: 'Steering', status: { type: 'working' } });
  const agents = options.agents ?? [requester, agent('a2', 'refactor/sdk-extraction', { backend: 'codex' }), agent('a3', 'main', { folder: '/work/else', workspace: undefined })];
  const clock = { now: start };
  const git = options.git === undefined ? facts() : options.git;
  const read = vi.fn(async () => { if (git instanceof Error) throw git; return git; });
  const sessions = vi.fn(() => [{ provider: 'claude', sessionId: 's1', startedAt: start - day, turns: 4, failedTurns: 1 }, { provider: 'codex', sessionId: 's2', startedAt: start - 2 * day, turns: 2, failedTurns: 0 }]);
  const store = options.store ?? new ProjectNarrativeStore(null);
  const service = new ProjectOverviewService({ git: { read }, sessions, agents: () => agents, outerLoop: options.outerLoop, narratives: store, now: () => clock.now });
  return { service, requester, read, sessions, clock, store };
}

/** A scripted engine: it answers from the fact ids it finds in the prompt, as a real reply would cite them. */
function engine(reply?: (factId: (needle: string) => string) => unknown) {
  const prompts: string[] = [];
  const generate = vi.fn<ProjectOverviewGenerate>(async (_agent, request) => {
    prompts.push(request.prompt);
    const factId = (needle: string) => /^(F\d+): /mu.exec(request.prompt.split('\n').find(line => /^F\d+: /u.test(line) && line.includes(needle)) ?? '')?.[1] ?? 'F0';
    return { text: JSON.stringify((reply ?? grounded)(factId)) };
  });
  return { generate, prompts };
}
const grounded = (factId: (needle: string) => string) => ({
  lead: 'Cursor follow-up dominates while one large refactor waits.',
  workstreams: [
    { name: 'Cursor engine', state: 'settling', analysis: 'Shipped, but 4 fixes have followed.', facts: [factId('"cursor"')], branches: ['feat/cursor-steering', 'feat/cursor-usage'], issues: ['#84'] },
    { name: 'SDK extraction', state: 'waiting', analysis: 'One branch changes 273 files and is waiting for review.', facts: [factId('refactor/sdk-extraction is')], branches: ['refactor/sdk-extraction'] },
  ],
});

describe('project overview flow', () => {
  it('places work in flight at its station from the repository, agents, pull requests and pipelines', async () => {
    const outerLoop = connected();
    const { service, requester, read, clock } = setup({ outerLoop });

    const overview = await service.get(requester);

    expect(read).toHaveBeenCalledExactlyOnceWith('/work/korus-a1', { since: start - 30 * day, now: start, defaultBranch: null, keepBranches: ['feat/cursor-steering', 'refactor/sdk-extraction'] });
    expect(outerLoop.backlog).toHaveBeenCalledExactlyOnceWith('github.com/acme/korus', start - 30 * day);
    expect(outerLoop.pullRequests).toHaveBeenCalledExactlyOnceWith('github.com/acme/korus');
    expect(outerLoop.pipelines).toHaveBeenCalledExactlyOnceWith('github.com/acme/korus', start - 30 * day);
    expect(overview).toStrictEqual({
      generatedAt: '2026-11-11T12:00:00.000Z',
      repository: { name: 'korus', branch: 'feat/cursor-steering', baseBranch: 'main' },
      sources: { git: 'available', backlog: 'available', pullRequests: 'available', pipelines: 'available' },
      narrative: { status: 'missing' },
      flow: {
        stations: [
          { kind: 'backlog', status: 'available', count: 47, note: 1, marks: [] },
          { kind: 'building', status: 'available', count: 1, note: 1, marks: [{ workstreamId: null, units: 1 }] },
          { kind: 'review', status: 'available', count: 1, note: 2 * day, marks: [{ workstreamId: null, units: 1 }] },
          { kind: 'ci', status: 'available', count: 0, note: 0, marks: [] },
          { kind: 'shipped', status: 'available', count: 2, note: null, marks: [] },
        ],
        links: [{ to: 'building', tokens: [null] }, { to: 'review', tokens: [] }, { to: 'ci', tokens: [] }, { to: 'shipped', tokens: [null] }],
        constraint: null,
      },
    });

    clock.now += 29_000;
    await service.get(requester);
    expect(read).toHaveBeenCalledTimes(1);
    clock.now += 2_000;
    await service.get(requester);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps every unit in building from the repository alone, and isolates a failing provider read', async () => {
    const alone = await setup().service.get(agent('a1', 'feat/cursor-steering'));
    expect(alone.sources).toStrictEqual({ git: 'available', backlog: 'notConnected', pullRequests: 'notConnected', pipelines: 'notConnected' });
    expect(alone.flow.stations.map(station => [station.kind, station.status, station.count])).toStrictEqual([
      ['backlog', 'notConnected', null], ['building', 'available', 2], ['review', 'notConnected', null], ['ci', 'notConnected', null], ['shipped', 'available', 2],
    ]);

    const outerLoop = { ...connected(), pullRequests: vi.fn(async () => { throw new Error('GitHub request failed with 500: secret detail'); }) };
    const failing = await setup({ outerLoop }).service.get(agent('a1', 'feat/cursor-steering'));
    expect(failing.sources).toStrictEqual({ git: 'available', backlog: 'available', pullRequests: 'failed', pipelines: 'available' });
    expect(failing.flow.stations.map(station => [station.kind, station.status, station.count])).toStrictEqual([
      ['backlog', 'available', 47], ['building', 'available', 2], ['review', 'failed', null], ['ci', 'failed', null], ['shipped', 'available', 2],
    ]);
    expect(JSON.stringify(failing)).not.toContain('secret detail');
  });

  it('reports a folder without a repository, a failed repository read and a malformed agent', async () => {
    const plain = await setup({ git: null }).service.get(agent('a1', 'main'));
    expect(plain.sources.git).toBe('unavailable');
    expect(plain.narrative).toStrictEqual({ status: 'unavailable', reason: 'quiet' });
    expect(plain.flow.stations.every(station => station.count === null)).toBe(true);

    const failed = await setup({ git: new Error('git exploded') }).service.get(agent('a1', 'main'));
    expect(failed.sources.git).toBe('failed');
    expect(failed.repository).toStrictEqual({ name: 'korus', branch: 'main', baseBranch: null });

    await expect(setup().service.get({ ...agent('a1', 'main'), folder: null })).rejects.toThrow('This agent has no folder.');
  });
});

describe('project overview narrative', () => {
  it('writes a grounded narrative from computed evidence, marks its work in the flow and keeps it across a restart', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'korus-narrative-'));
    folders.push(folder);
    const file = join(folder, 'project-overviews.json');
    const { service, requester, clock } = setup({ outerLoop: connected(), store: new ProjectNarrativeStore(file) });
    const { generate, prompts } = engine();

    const overview = await service.refreshNarrative(requester, generate);

    expect(generate).toHaveBeenCalledExactlyOnceWith(requester, expect.objectContaining({ cwd: '/work/korus-a1', complexity: 'normal' }));
    const prompt = prompts[0]!;
    for (const line of [
      'Release 0.56.0 (0.56) was tagged on Nov 9.',
      '4 of 4 fix commits in the last 30 days mention "cursor".',
      'Branch feat/cursor-usage was merged into main on Nov 11.',
      'Branch refactor/sdk-extraction is 0 commits behind and 1 ahead of main, changes 273 files, adds 921 and removes about 26,000 lines, has an open pull request waiting for review and a failing pipeline; landing risk is high.',
      'main took about 45 commits a day over the last 7 days.',
      '2 issues were opened and 1 closed in the last 30 days; 47 are open.',
      '2 agent sessions ran here in the last 30 days (claude 1, codex 1); 1 turns failed.',
      '- #84 Cursor resume fails',
      '- fix: hide cursor thoughts',
    ]) expect(prompt).toContain(line);
    expect(prompt.indexOf('<<<EVIDENCE')).toBeLessThan(prompt.indexOf('- #84 Cursor resume fails'));
    expect(prompt.indexOf('EVIDENCE>>>')).toBeGreaterThan(prompt.indexOf('- #84 Cursor resume fails'));

    expect(overview.narrative).toStrictEqual({
      status: 'fresh',
      narrative: {
        lead: 'Cursor follow-up dominates while one large refactor waits.',
        workstreams: [
          { id: 'w1', name: 'Cursor engine', state: 'settling', analysis: 'Shipped, but 4 fixes have followed.', basis: ['4 cursor fixes in 30 days'] },
          { id: 'w2', name: 'SDK extraction', state: 'waiting', analysis: 'One branch changes 273 files and is waiting for review.', basis: ['refactor/sdk-extraction'] },
        ],
        writtenBy: 'claude',
        writtenAt: '2026-11-11T12:00:00.000Z',
      },
    });
    expect(overview.flow.stations[1]!.marks).toStrictEqual([{ workstreamId: 'w1', units: 1 }]);
    expect(overview.flow.stations[2]!.marks).toStrictEqual([{ workstreamId: 'w2', units: 1 }]);
    expect(overview.flow.links.at(-1)).toStrictEqual({ to: 'shipped', tokens: ['w1'] });

    // Unchanged evidence spends nothing, here or after a restart with the same store file.
    clock.now += hour;
    expect((await service.refreshNarrative(requester, generate)).narrative.status).toBe('fresh');
    const restarted = setup({ outerLoop: connected(), store: new ProjectNarrativeStore(file) });
    expect((await restarted.service.get(restarted.requester)).narrative).toMatchObject({ status: 'fresh', narrative: { writtenBy: 'claude' } });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries an ungrounded reply once with the reasons, then reports failure and waits fifteen minutes before trying again', async () => {
    const { service, requester, clock } = setup({ outerLoop: connected() });
    const { generate, prompts } = engine(factId => ({ lead: 'Fine.', workstreams: [{ name: 'Cursor engine', state: 'settling', analysis: 'There were 99 fixes.', facts: [factId('"cursor"')] }] }));

    expect((await service.refreshNarrative(requester, generate)).narrative).toStrictEqual({ status: 'unavailable', reason: 'failed' });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain('Workstream 1 states 99, which none of its cited facts contain.');

    clock.now += 14 * 60_000;
    expect((await service.refreshNarrative(requester, generate)).narrative).toStrictEqual({ status: 'unavailable', reason: 'failed' });
    expect(generate).toHaveBeenCalledTimes(2);
    clock.now += 2 * 60_000;
    const { generate: working } = engine();
    expect((await service.refreshNarrative(requester, working)).narrative.status).toBe('fresh');
  });

  it('marks the narrative stale when the project moves, keeps showing it, and rewrites it on request', async () => {
    const git = facts();
    const { service, requester, clock } = setup({ git, outerLoop: connected() });
    const { generate } = engine();
    await service.refreshNarrative(requester, generate);

    git.commits.unshift({ at: start + hour, subject: 'feat: add zoom shortcuts', merge: false });
    clock.now += 16 * 60_000;
    expect((await service.get(requester)).narrative).toMatchObject({ status: 'stale', narrative: { lead: 'Cursor follow-up dominates while one large refactor waits.' } });
    expect((await service.refreshNarrative(requester, generate)).narrative.status).toBe('fresh');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('falls back to a teammate on another engine when the first cannot generate, and shares one generation between callers', async () => {
    const { service, requester } = setup({ outerLoop: connected() });
    const { generate } = engine();
    const picky = vi.fn<ProjectOverviewGenerate>(async (candidate, request) => {
      if (candidate.backend === 'claude') throw new Error('No lightweight text model is available for claude.');
      return generate(candidate, request);
    });

    const [first, second] = await Promise.all([service.refreshNarrative(requester, picky), service.refreshNarrative(requester, picky)]);

    expect(first.narrative).toMatchObject({ status: 'fresh', narrative: { writtenBy: 'codex' } });
    expect(second.narrative.status).toBe('fresh');
    expect(picky.mock.calls.map(call => call[0].backend)).toStrictEqual(['claude', 'codex']);

    const none = setup({ outerLoop: connected() });
    const broken = vi.fn<ProjectOverviewGenerate>(async () => { throw new Error('nope'); });
    expect((await none.service.refreshNarrative(none.requester, broken)).narrative).toStrictEqual({ status: 'unavailable', reason: 'noEngine' });
  });

  it('writes nothing for a repository where nothing has happened', async () => {
    const quiet: ProjectOverviewGitFacts = { ...facts(), commits: [], tags: [], branches: [facts().branches[0]!] };
    const { service, requester } = setup({ git: quiet });
    const { generate } = engine();
    expect((await service.refreshNarrative(requester, generate)).narrative).toStrictEqual({ status: 'unavailable', reason: 'quiet' });
    expect(generate).not.toHaveBeenCalled();
  });
});
