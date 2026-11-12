import { basename } from 'node:path';
import { agentDisplayName } from '@workspace/core/agent-display';
import type { Agent } from '@workspace/core/contracts';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import {
  defaultProjectOverviewWindow,
  projectOverviewBucketOf,
  projectOverviewChapters,
  projectOverviewCommitKind,
  projectOverviewIntegrationRisk,
  projectOverviewMergedBranch,
  projectOverviewWindowBuckets,
  validProjectOverviewInput,
  type ProjectOverview,
  type ProjectOverviewBacklog,
  type ProjectOverviewBucket,
  type ProjectOverviewPipelineRun,
  type ProjectOverviewPipelines,
  type ProjectOverviewSourceStatus,
} from '@workspace/core/project-overview';
import { dayStart } from '@workspace/core/usage-time';
import type { WorkProviderKind } from '@workspace/core/work-providers';
import { repositoryIdentityOf } from '../usage/repository-identity';
import type { WorkProviderBacklogActivity, WorkProviderPipelineRun } from '../work-integrations/types';
import type { ProjectOverviewGitFacts, ProjectOverviewGitReader } from './git-reader';

const cacheLifetime = 30_000;
const maxCacheEntries = 32;
const branchRuns = 8;
const baseRuns = 20;
const latestChanges = 5;
const sameMoment = 60_000;

export type ProjectOverviewSession = { provider: string; sessionId: string; startedAt: number; turns: number; failedTurns: number };

/** What happens around the code. Each read answers null when no connected provider serves the repository. */
export type ProjectOverviewOuterLoop = {
  backlog(repositoryId: string, since: number): Promise<(WorkProviderBacklogActivity & { provider: WorkProviderKind }) | null>;
  pipelines(repositoryId: string, since: number): Promise<{ provider: WorkProviderKind; runs: WorkProviderPipelineRun[] } | null>;
};

export type ProjectOverviewServiceOptions = {
  git: Pick<ProjectOverviewGitReader, 'read'>;
  /** Recorded sessions for a repository; null when statistics are unavailable. */
  sessions: (repository: string, since: number) => ProjectOverviewSession[] | null;
  agents: () => readonly Agent[];
  outerLoop?: ProjectOverviewOuterLoop;
  now?: () => number;
};

type Settled<T> = { status: ProjectOverviewSourceStatus; value: T | null };

async function settle<T>(read: () => Promise<T | null> | T | null, absent: ProjectOverviewSourceStatus): Promise<Settled<T>> {
  try {
    const value = await read();
    return value === null ? { status: absent, value } : { status: 'available', value };
  } catch {
    // A source's failure text can carry provider or repository detail; only the status crosses.
    return { status: 'failed', value: null };
  }
}

/** Composes one repository's overview from sources that fail independently. It reads and never writes. */
export class ProjectOverviewService {
  private readonly cache = new Map<string, { at: number; result: Promise<ProjectOverview> }>();
  private readonly now: () => number;

  constructor(private readonly options: ProjectOverviewServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async get(agent: Agent, input?: unknown): Promise<ProjectOverview> {
    if (!validProjectOverviewInput(input)) throw new Error('Invalid project overview request.');
    if (!agent.folder) throw new Error('This agent has no folder.');
    const window = input?.window ?? defaultProjectOverviewWindow;
    const timeZone = input?.timeZone ?? 'UTC';
    const now = this.now();
    const key = JSON.stringify([agent.folder, window, timeZone]);
    const cached = this.cache.get(key);
    if (cached && now - cached.at < cacheLifetime) return cached.result;
    const result = this.compose(agent, agent.folder, window, timeZone, now);
    this.cache.delete(key);
    this.cache.set(key, { at: now, result });
    while (this.cache.size > maxCacheEntries) this.cache.delete(this.cache.keys().next().value!);
    result.catch(() => { if (this.cache.get(key)?.result === result) this.cache.delete(key); });
    return result;
  }

  private async compose(agent: Agent, folder: string, window: ProjectOverview['window']['kind'], timeZone: string, now: number): Promise<ProjectOverview> {
    const { bucket, starts } = projectOverviewWindowBuckets(window, now, timeZone);
    const since = dayStart(starts[0]!, timeZone);
    const repository = repositoryIdentityOf(agent) ?? folder;
    const teammates = this.options.agents().filter(candidate => repositoryIdentityOf(candidate) === repository);
    const workspace = agent.workspace?.kind === 'git' ? agent.workspace : undefined;
    const repositoryId = workspace?.originUrl ? canonicalGitRemoteIdentity(workspace.originUrl) : undefined;
    const outerLoop = repositoryId ? this.options.outerLoop : undefined;
    const keepBranches = [...new Set(teammates.flatMap(mate => mate.workspace?.kind === 'git' && mate.workspace.branch ? [mate.workspace.branch] : []))];

    const [git, sessions, backlog, pipelines] = await Promise.all([
      settle(() => this.options.git.read(folder, { since, now, defaultBranch: workspace?.defaultBranch ?? null, keepBranches }), 'unavailable'),
      settle(() => this.options.sessions(repository, since), 'unavailable'),
      settle(() => outerLoop ? outerLoop.backlog(repositoryId!, since) : null, 'notConnected'),
      settle(() => outerLoop ? outerLoop.pipelines(repositoryId!, since) : null, 'notConnected'),
    ]);

    const buckets = new Map<string, ProjectOverviewBucket>(starts.map(start => [start, {
      start, commits: { feat: 0, fix: 0, test: 0, chore: 0, other: 0 }, merges: 0, mergedBranches: [], releases: [], sessions: [],
    }]));
    const bucketAt = (at: number) => buckets.get(projectOverviewBucketOf(at, bucket, timeZone));

    const facts = git.value;
    let commits = 0;
    let merges = 0;
    for (const commit of facts?.commits ?? []) {
      const target = bucketAt(commit.at);
      if (!target) continue;
      if (commit.merge) {
        merges += 1;
        target.merges += 1;
        const merged = facts!.baseBranch ? projectOverviewMergedBranch(commit.subject, facts!.baseBranch) : null;
        if (merged && !target.mergedBranches.includes(merged)) target.mergedBranches.push(merged);
      } else {
        commits += 1;
        target.commits[projectOverviewCommitKind(commit.subject)] += 1;
      }
    }
    let releases = 0;
    for (const tag of facts?.tags ?? []) {
      const target = bucketAt(tag.at);
      if (!target) continue;
      releases += 1;
      target.releases.push(tag.name);
    }

    let sessionCount = 0;
    let turns = 0;
    for (const session of sessions.value ?? []) {
      const target = bucketAt(session.startedAt);
      if (!target) continue;
      sessionCount += 1;
      turns += session.turns;
      let engine = target.sessions.find(entry => entry.provider === session.provider);
      if (!engine) target.sessions.push(engine = { provider: session.provider, sessions: 0, turns: 0, failedTurns: 0 });
      engine.sessions += 1;
      engine.turns += session.turns;
      engine.failedTurns += session.failedTurns;
    }
    for (const entry of buckets.values()) entry.sessions.sort((a, b) => a.provider.localeCompare(b.provider));

    const ordered = [...buckets.values()];
    const runs = pipelines.value ? [...pipelines.value.runs].sort((a, b) => a.at.localeCompare(b.at)) : null;
    return {
      generatedAt: new Date(now).toISOString(),
      repository: {
        name: facts?.name ?? workspace?.repositoryName ?? (agent.workspace?.kind === 'folder' ? agent.workspace.label : basename(folder)),
        branch: facts ? facts.branch : workspace?.branch ?? null,
        baseBranch: facts?.baseBranch ?? null,
      },
      window: { kind: window, bucket, timeZone },
      sources: { git: git.status, sessions: sessions.status, backlog: backlog.status, pipelines: pipelines.status },
      totals: {
        commits, merges, releases, sessions: sessionCount, turns,
        workingAgents: teammates.filter(mate => mate.status.type === 'working').length,
        baseCommitsPerDay: facts?.baseCommitsPerDay ?? null,
      },
      buckets: ordered,
      chapters: projectOverviewChapters(ordered),
      branches: facts ? this.branches(facts, teammates, runs) : [],
      backlog: backlog.value ? this.backlog(backlog.value, ordered, bucketAt, since) : null,
      pipelines: pipelines.value && runs ? this.pipelines(pipelines.value.provider, runs, facts?.baseBranch ?? null) : null,
    };
  }

  private branches(facts: ProjectOverviewGitFacts, teammates: readonly Agent[], runs: ProjectOverviewPipelineRun[] | null): ProjectOverview['branches'] {
    const open = facts.branches.filter(branch => branch.name !== facts.baseBranch);
    return facts.branches.map(branch => {
      const base = branch.name === facts.baseBranch;
      const own = new Set(branch.files);
      const sharing = base ? [] : open.filter(other => other.name !== branch.name && other.files.some(file => own.has(file)));
      const overlapFiles = new Set(sharing.flatMap(other => other.files.filter(file => own.has(file)))).size;
      const pipelineRuns = runs ? runs.filter(run => run.branch === branch.name).slice(-branchRuns) : null;
      return {
        name: branch.name,
        base,
        current: branch.name === facts.branch,
        lastCommitAt: new Date(branch.lastCommitAt).toISOString(),
        behind: branch.behind,
        ahead: branch.ahead,
        changedFiles: branch.files.length,
        agents: teammates
          .filter(mate => mate.workspace?.kind === 'git' && mate.workspace.branch === branch.name)
          .map(mate => ({ id: mate.id, name: agentDisplayName(mate), backend: mate.backend, status: mate.status.type })),
        pipelineRuns,
        risk: base ? null : projectOverviewIntegrationRisk({
          behind: branch.behind,
          changedFiles: branch.files.length,
          overlapFiles,
          overlapBranches: sharing.length,
          baseCommitsPerDay: facts.baseCommitsPerDay,
          latestPipeline: pipelineRuns?.at(-1)?.status ?? null,
        }),
      };
    });
  }

  private backlog(
    activity: WorkProviderBacklogActivity & { provider: WorkProviderKind },
    buckets: readonly ProjectOverviewBucket[],
    bucketAt: (at: number) => ProjectOverviewBucket | undefined,
    since: number,
  ): ProjectOverviewBacklog {
    const flow = new Map(buckets.map(entry => [entry.start, { start: entry.start, opened: 0, closed: 0 }]));
    let opened = 0;
    let closed = 0;
    const count = (iso: string | undefined, field: 'opened' | 'closed'): boolean => {
      const at = iso ? Date.parse(iso) : Number.NaN;
      const target = at >= since ? bucketAt(at) : undefined;
      if (target) flow.get(target.start)![field] += 1;
      return Boolean(target);
    };
    for (const item of activity.items) {
      if (count(item.createdAt, 'opened')) opened += 1;
      if (item.state === 'closed' && count(item.closedAt, 'closed')) closed += 1;
    }
    const near = (a: string | undefined, b: string) => a !== undefined && Math.abs(Date.parse(a) - Date.parse(b)) <= sameMoment;
    return {
      provider: activity.provider,
      open: activity.open,
      opened,
      closed,
      buckets: [...flow.values()],
      latest: [...activity.items]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, latestChanges)
        .map(item => ({
          id: item.id,
          title: item.title,
          change: item.state === 'closed' && near(item.closedAt, item.updatedAt) ? 'closed' as const : near(item.createdAt, item.updatedAt) ? 'opened' as const : 'updated' as const,
          at: item.updatedAt,
        })),
    };
  }

  private pipelines(provider: WorkProviderKind, runs: ProjectOverviewPipelineRun[], baseBranch: string | null): ProjectOverviewPipelines {
    const onBase = runs.filter(run => run.branch === baseBranch).slice(-baseRuns);
    const passed = onBase.filter(run => run.status === 'passed').length;
    const failed = onBase.filter(run => run.status === 'failed').length;
    return { provider, baseRuns: onBase, passRate: passed + failed ? passed / (passed + failed) : null };
  }
}
