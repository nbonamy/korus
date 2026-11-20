import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, HarnessProvider } from '@workspace/core/contracts';
import type { ProjectOverviewGitFacts } from '../git-reader';
import { ProjectNarrativeStore } from '../narrative-store';
import { ProjectOverviewService, projectNarrativeHostEngines, type ProjectOverviewGenerate, type ProjectOverviewOuterLoop } from '../project-overview-service';
import { inferProjectToolLinks } from '../tool-links';
import type { ProjectToolLinks } from '@workspace/core/project-overview';

const hour = 3_600_000;
const day = 24 * hour;
const start = Date.parse('2026-11-11T12:00:00Z');
const ago = (ms: number) => new Date(start - ms).toISOString();
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

function agent(id: string, branch: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id, name: null, provider: 'claude', folder: `/work/korus-${id}`, status: { type: 'idle' },
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
  // Eight branch tips this month, enough with the commits and merges above for a 30 day lookback.
  branchActivity: Array.from({ length: 8 }, (_, index) => start - (index + 1) * day),
  guide: '# AGENTS.md\n\n**Korus** is an Electron desktop app for coordinating teams of coding agents.',
  messages: ['fix: attach cursor sessions before streaming', 'SHOP-1 a', 'SHOP-2 b', 'SHOP-3 c'],
  baseCommitsPerDay: 45,
});

const connected = (): ProjectOverviewOuterLoop => ({
  backlog: vi.fn(async () => ({ provider: 'github' as const, open: 47, items: [
    { id: '#84', title: 'Cursor resume fails', state: 'open' as const, createdAt: ago(day), updatedAt: ago(day) },
    { id: '#83', title: 'Annotations hidden', state: 'closed' as const, createdAt: ago(20 * day), closedAt: ago(2 * day), updatedAt: ago(2 * day) },
  ] })),
  pullRequests: vi.fn(async () => ({
    open: [{ number: 12, url: 'https://github.com/acme/korus/pull/12', branch: 'refactor/sdk-extraction', draft: false, approved: false, conflicts: true, openedAt: ago(2 * day) }],
    mergeTimesMs: [day, day, 3 * day],
  })),
  pipelines: vi.fn(async () => ({ provider: 'github' as const, runs: [{ id: '1', branch: 'refactor/sdk-extraction', status: 'failed' as const, at: ago(day) }] })),
});

function setup(options: { git?: ProjectOverviewGitFacts | null | Error; outerLoop?: ProjectOverviewOuterLoop; agents?: Agent[]; store?: ProjectNarrativeStore; hostEngines?: HarnessProvider[] } = {}) {
  // The config file answers what was inferred, as it does the first time it is written.
  const tools = { load: vi.fn(async (_root: string, infer: () => { links: ProjectToolLinks; proposals: unknown[] }) => infer().links) };
  const requester = agent('a1', 'feat/cursor-steering', { name: 'Steering', status: { type: 'working' } });
  const agents = options.agents ?? [requester, agent('a2', 'refactor/sdk-extraction', { provider: 'codex' }), agent('a3', 'main', { folder: '/work/else', workspace: undefined })];
  const clock = { now: start };
  const git = options.git === undefined ? facts() : options.git;
  const read = vi.fn(async () => { if (git instanceof Error) throw git; return git; });
  const sessions = vi.fn(() => [{ provider: 'claude', sessionId: 's1', startedAt: start - day, turns: 4, failedTurns: 1 }, { provider: 'codex', sessionId: 's2', startedAt: start - 2 * day, turns: 2, failedTurns: 0 }]);
  const store = options.store ?? new ProjectNarrativeStore(null);
  const service = new ProjectOverviewService({
    git: { read }, sessions, agents: () => agents, outerLoop: options.outerLoop, narratives: store, tools, now: () => clock.now,
    ...(options.hostEngines ? { hostEngines: () => options.hostEngines! } : {}),
  });
  return { service, requester, read, sessions, clock, store, tools };
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
  lead: 'Korus is a desktop app for coordinating teams of coding agents.',
  workstreams: [
    { name: 'Cursor engine', state: 'settling', analysis: 'Shipped, but 4 fixes have followed.', facts: [factId('"cursor"')], branches: ['feat/cursor-steering', 'feat/cursor-usage'], issues: ['#84'] },
    { name: 'SDK extraction', state: 'waiting', analysis: 'One branch changes 273 files and is waiting for review.', facts: [factId('refactor/sdk-extraction is')], branches: ['refactor/sdk-extraction'] },
  ],
});

describe('project overview flow', () => {
  it('places work in flight at its station from the repository, agents, pull requests and pipelines', async () => {
    const outerLoop = connected();
    const { service, requester, read, clock, tools } = setup({ outerLoop });

    const overview = await service.get(requester);

    expect(read).toHaveBeenCalledExactlyOnceWith('/work/korus-a1', { now: start, defaultBranch: null, keepBranches: ['feat/cursor-steering', 'refactor/sdk-extraction'] });
    expect(outerLoop.backlog).toHaveBeenCalledExactlyOnceWith('github.com/acme/korus', start - 30 * day);
    expect(outerLoop.pullRequests).toHaveBeenCalledExactlyOnceWith('github.com/acme/korus');
    expect(outerLoop.pipelines).toHaveBeenCalledExactlyOnceWith('github.com/acme/korus', start - 30 * day);
    expect(overview).toStrictEqual({
      generatedAt: '2026-11-11T12:00:00.000Z',
      lookback: { days: 30, since: ago(30 * day) },
      toolLinks: expect.any(Object),
      repository: { name: 'korus', branch: 'feat/cursor-steering', baseBranch: 'main' },
      sources: { git: 'available', backlog: 'available', pullRequests: 'available', pipelines: 'available' },
      narrative: { status: 'missing' },
      flow: {
        stations: [
          { kind: 'backlog', status: 'available', count: 47, note: 1, marks: [], stuck: [] },
          { kind: 'building', status: 'available', count: 1, note: 1, marks: [{ workstreamId: null, units: 1 }], stuck: [] },
          // The open request has merge conflicts, so it links straight to the request.
          { kind: 'review', status: 'available', count: 1, note: 2 * day, marks: [{ workstreamId: null, units: 1 }], stuck: [{ branch: 'refactor/sdk-extraction', reason: 'conflicts', target: { kind: 'url', url: 'https://github.com/acme/korus/pull/12' } }] },
          { kind: 'ci', status: 'available', count: 0, note: 0, marks: [], stuck: [] },
          { kind: 'shipped', status: 'available', count: 2, note: null, marks: [], stuck: [] },
        ],
        links: [{ to: 'building', tokens: [null] }, { to: 'review', tokens: [] }, { to: 'ci', tokens: [] }, { to: 'shipped', tokens: [null] }],
        constraint: null,
      },
    });

    // Tool links come from the project's config, kept at the primary checkout, first written from the remote and commits.
    expect(tools.load).toHaveBeenCalledExactlyOnceWith('/work/korus', expect.any(Function));
    expect(tools.load.mock.calls[0]![1]()).toStrictEqual({
      links: inferProjectToolLinks('github.com/acme/korus'),
      proposals: [{ tool: 'link', label: 'Issue tracker for SHOP', station: 'backlog', url: null, keys: ['SHOP'], reason: '3 commit messages mention SHOP keys. Add the tracker URL to use it.' }],
    });
    expect(overview.toolLinks.ci).toStrictEqual({ label: 'GitHub Actions', url: 'https://github.com/acme/korus/actions', tool: 'github' });

    clock.now += 29_000;
    await service.get(requester);
    expect(read).toHaveBeenCalledTimes(1);
    clock.now += 2_000;
    await service.get(requester);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('answers from the repository first and from each source as it lands, reading every source once', async () => {
    const gate = <T>() => { let open!: (value: T) => void; const promise = new Promise<T>(resolve => { open = resolve; }); return { promise, open }; };
    const loop = connected();
    const backlog = gate<Awaited<ReturnType<ProjectOverviewOuterLoop['backlog']>>>();
    const requests = gate<Awaited<ReturnType<ProjectOverviewOuterLoop['pullRequests']>>>();
    const pipelines = gate<Awaited<ReturnType<ProjectOverviewOuterLoop['pipelines']>>>();
    const answers = { backlog: await loop.backlog('', 0), requests: await loop.pullRequests(''), pipelines: await loop.pipelines('', 0) };
    const outerLoop: ProjectOverviewOuterLoop = { backlog: vi.fn(() => backlog.promise), pullRequests: vi.fn(() => requests.promise), pipelines: vi.fn(() => pipelines.promise) };
    const { service, requester, read } = setup({ outerLoop });
    const statuses = (overview: Awaited<ReturnType<typeof service.get>>) => overview.flow.stations.map(station => station.status);

    // The repository alone: Shipped is known, the rest wait on their sources.
    const first = await service.get(requester, { wait: [] });
    expect(first.sources).toStrictEqual({ git: 'available', backlog: 'loading', pullRequests: 'loading', pipelines: 'loading' });
    expect(statuses(first)).toStrictEqual(['loading', 'loading', 'loading', 'loading', 'available']);
    expect(first.toolLinks.ci).toStrictEqual({ label: 'GitHub Actions', url: 'https://github.com/acme/korus/actions', tool: 'github' });
    // Until every source answers, a narrative cannot be judged fresh, so none is asked for yet.
    expect(first.narrative).toStrictEqual({ status: 'missing' });

    const waitingForPipelines = service.get(requester, { wait: ['pipelines'] });
    const waitingForRequests = service.get(requester, { wait: ['pullRequests'] });
    requests.open(answers.requests);
    const afterRequests = await waitingForRequests;
    expect(afterRequests.sources).toStrictEqual({ git: 'available', backlog: 'loading', pullRequests: 'available', pipelines: 'loading' });
    expect(statuses(afterRequests)).toStrictEqual(['loading', 'available', 'loading', 'loading', 'available']);

    backlog.open(answers.backlog);
    pipelines.open(answers.pipelines);
    const complete = await waitingForPipelines;
    expect(complete.sources).toStrictEqual({ git: 'available', backlog: 'available', pullRequests: 'available', pipelines: 'available' });
    expect(complete).toStrictEqual(await service.get(requester));
    expect(read).toHaveBeenCalledOnce();
    expect(outerLoop.backlog).toHaveBeenCalledOnce();
    expect(outerLoop.pullRequests).toHaveBeenCalledOnce();
    expect(outerLoop.pipelines).toHaveBeenCalledOnce();
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
    // The title names the project and says what it is; where the work stands is left to the workstreams.
    expect(prompt).toContain('Start the lead with the repository name "korus"');
    expect(prompt).toContain('Project description (from AGENTS.md):\n# AGENTS.md\n\n**Korus** is an Electron desktop app for coordinating teams of coding agents.');
    expect(prompt.indexOf('<<<EVIDENCE')).toBeLessThan(prompt.indexOf('Project description'));
    expect(prompt.indexOf('<<<EVIDENCE')).toBeLessThan(prompt.indexOf('- #84 Cursor resume fails'));
    expect(prompt.indexOf('EVIDENCE>>>')).toBeGreaterThan(prompt.indexOf('- #84 Cursor resume fails'));

    expect(overview.narrative).toStrictEqual({
      status: 'fresh',
      narrative: {
        lead: 'Korus is a desktop app for coordinating teams of coding agents.',
        workstreams: [
          { id: 'w1', name: 'Cursor engine', state: 'settling', analysis: 'Shipped, but 4 fixes have followed.', basis: ['4 cursor fixes in 30 days'] },
          { id: 'w2', name: 'SDK extraction', state: 'waiting', analysis: 'One branch changes 273 files and is waiting for review.', basis: ['refactor/sdk-extraction'] },
        ],
        writtenBy: 'Claude Code',
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
    expect((await restarted.service.get(restarted.requester)).narrative).toMatchObject({ status: 'fresh', narrative: { writtenBy: 'Claude Code' } });
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
    expect((await service.get(requester)).narrative).toMatchObject({ status: 'stale', narrative: { lead: 'Korus is a desktop app for coordinating teams of coding agents.' } });
    expect((await service.refreshNarrative(requester, generate)).narrative.status).toBe('fresh');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('falls back to a teammate on another engine when the first cannot generate, and shares one generation between callers', async () => {
    const { service, requester } = setup({ outerLoop: connected() });
    const { generate } = engine();
    const picky = vi.fn<ProjectOverviewGenerate>(async (candidate, request) => {
      if (candidate.provider === 'claude') throw new Error('No lightweight text model is available for claude.');
      return generate(candidate, request);
    });

    const [first, second] = await Promise.all([service.refreshNarrative(requester, picky), service.refreshNarrative(requester, picky)]);

    expect(first.narrative).toMatchObject({ status: 'fresh', narrative: { writtenBy: 'Codex' } });
    expect(second.narrative.status).toBe('fresh');
    expect(picky.mock.calls.map(call => call[0].provider)).toStrictEqual(['claude', 'codex']);

    const none = setup({ outerLoop: connected() });
    const broken = vi.fn<ProjectOverviewGenerate>(async () => { throw new Error('nope'); });
    expect((await none.service.refreshNarrative(none.requester, broken)).narrative).toStrictEqual({ status: 'unavailable', reason: 'noEngine' });
  });

  it('has another engine signed in on this host write for a repository whose agents cannot, in its primary checkout', async () => {
    const cursorOnly = agent('c1', 'feat/cursor-steering', { provider: 'cursor', status: { type: 'working' } });
    const { service } = setup({ outerLoop: connected(), agents: [cursorOnly], hostEngines: ['cursor', 'codex', 'claude'] });
    const { generate } = engine();
    const picky = vi.fn<ProjectOverviewGenerate>(async (candidate, request) => {
      if (candidate.provider === 'cursor') throw new Error('No lightweight text model is available for cursor.');
      return generate(candidate, request);
    });

    const overview = await service.refreshNarrative(cursorOnly, picky);

    expect(overview.narrative).toMatchObject({ status: 'fresh', narrative: { writtenBy: 'Codex' } });
    // Cursor is tried once, as the requesting agent's engine; the host then offers Codex, which writes it.
    expect(picky.mock.calls.map(call => call[0].provider)).toStrictEqual(['cursor', 'codex']);
    const [stand, request] = picky.mock.calls[1]!;
    expect(request).toMatchObject({ cwd: '/work/korus', complexity: 'normal' });
    // The host engine is not a teammate: it carries no session, no team and no remote link of its own.
    expect(stand).toStrictEqual({ id: 'project-narrative-codex', name: null, provider: 'codex', folder: '/work/korus', status: { type: 'idle' }, workspace: cursorOnly.workspace });
  });

  it('offers the host engines that are installed, enabled and signed in, in the SDK provider order', () => {
    const connection = (provider: HarnessProvider, state: { installed?: boolean; connected?: boolean; enabled?: boolean } = {}) => ({ provider, installed: true, connected: true, checking: false, ...state });
    expect(projectNarrativeHostEngines([
      connection('cursor'), connection('antigravity'), connection('codex', { connected: false }), connection('claude'),
    ])).toStrictEqual(['claude', 'cursor', 'antigravity']);
    expect(projectNarrativeHostEngines([connection('claude', { enabled: false }), connection('codex', { installed: false })])).toStrictEqual([]);
    expect(projectNarrativeHostEngines(undefined)).toStrictEqual([]);
  });

  it('tries agents in the repository before engines on the host, and says no engine can write when none is signed in', async () => {
    const { service, requester } = setup({ outerLoop: connected(), hostEngines: ['claude', 'codex', 'antigravity'] });
    const { generate } = engine();
    const onlyAntigravity = vi.fn<ProjectOverviewGenerate>(async (candidate, request) => {
      if (candidate.provider !== 'antigravity') throw new Error('unavailable');
      return generate(candidate, request);
    });
    expect((await service.refreshNarrative(requester, onlyAntigravity)).narrative).toMatchObject({ status: 'fresh', narrative: { writtenBy: 'Antigravity' } });
    // Claude and Codex were already tried through the repository's own agents, so each engine is asked once.
    expect(onlyAntigravity.mock.calls.map(call => [call[0].provider, call[0].id])).toStrictEqual([['claude', 'a1'], ['codex', 'a2'], ['antigravity', 'project-narrative-antigravity']]);

    const cursorOnly = agent('c1', 'main', { provider: 'cursor' });
    const nobody = setup({ outerLoop: connected(), agents: [cursorOnly], hostEngines: [] });
    const refused = vi.fn<ProjectOverviewGenerate>(async () => { throw new Error('No lightweight text model is available for cursor.'); });
    expect((await nobody.service.refreshNarrative(cursorOnly, refused)).narrative).toStrictEqual({ status: 'unavailable', reason: 'noEngine' });
    expect(refused).toHaveBeenCalledOnce();
  });

  it('looks further back for a repository that was quiet this month, and reads issues and sessions over the same period', async () => {
    const older = facts();
    older.commits = [
      { at: start - 2 * day, subject: 'fix: small cursor tweak', merge: false },
      ...Array.from({ length: 30 }, (_, index) => ({ at: start - (100 + index) * day, subject: 'feat: build the importer', merge: false })),
      { at: start - 120 * day, subject: "Merge branch 'feat/importer'", merge: true },
      { at: start - 400 * day, subject: 'chore: ancient setup outside the lookback', merge: false },
    ];
    older.tags = [{ name: 'v0.9.0', at: start - 110 * day }, { name: 'v0.1.0', at: start - 400 * day }];
    older.branchActivity = [start - 3 * day, start - 115 * day];
    const outerLoop = connected();
    const { service, requester, sessions } = setup({ git: older, outerLoop });
    const { generate, prompts } = engine();

    const overview = await service.refreshNarrative(requester, generate);

    // 1 + 1 branch in 30 or 90 days is not enough; by 180 days there are 31 commits, a merge and 2 branches.
    expect(overview.lookback).toStrictEqual({ days: 180, since: ago(180 * day) });
    expect(outerLoop.backlog).toHaveBeenCalledExactlyOnceWith('github.com/acme/korus', start - 180 * day);
    expect(sessions).toHaveBeenCalledExactlyOnceWith('/work/korus', start - 180 * day);
    const prompt = prompts[0]!;
    expect(prompt).toContain('The evidence covers the last 180 days.');
    expect(prompt).toContain('30 of 30 feat commits in the last 180 days mention "build".');
    expect(prompt).toContain('Release 0.9.0 (0.9) was tagged on Jul 24.');
    expect(prompt).toContain('Branch feat/importer was merged into main on Jul 14.');
    expect(prompt).not.toContain('ancient setup');
    expect(prompt).not.toContain('0.1.0');
    // The flow still describes the present: merges this week, not over the lookback.
    expect(overview.flow.stations.at(-1)).toMatchObject({ kind: 'shipped', count: 0 });
  });

  it('covers the whole history when no window holds enough activity', async () => {
    const sparse = facts();
    sparse.commits = [{ at: start - 2 * day, subject: 'fix: one', merge: false }, { at: start - 900 * day, subject: 'feat: first', merge: false }];
    sparse.branchActivity = [];
    sparse.tags = [];
    const { service, requester } = setup({ git: sparse });
    const { generate, prompts } = engine();
    const overview = await service.refreshNarrative(requester, generate);
    expect(overview.lookback).toStrictEqual({ days: null, since: ago(900 * day) });
    expect(prompts[0]).toContain('The evidence covers the whole history, since May 25, 2024.');
  });

  it('writes nothing for a repository where nothing has happened', async () => {
    const quiet: ProjectOverviewGitFacts = { ...facts(), commits: [], tags: [], branches: [facts().branches[0]!] };
    const { service, requester } = setup({ git: quiet });
    const { generate } = engine();
    expect((await service.refreshNarrative(requester, generate)).narrative).toStrictEqual({ status: 'unavailable', reason: 'quiet' });
    expect(generate).not.toHaveBeenCalled();
  });
});
