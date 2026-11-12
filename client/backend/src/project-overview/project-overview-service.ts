import { basename } from 'node:path';
import type { BackendTextGenerationInput } from '@workspace/core/backend-driver';
import type { Agent } from '@workspace/core/contracts';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import {
  buildProjectFlow,
  projectNarrativeFromDraft,
  projectOverviewMergedBranch,
  type ProjectFlowUnit,
  type ProjectNarrativeState,
  type ProjectOverview,
  type ProjectOverviewSourceStatus,
} from '@workspace/core/project-overview';
import type { WorkProviderKind } from '@workspace/core/work-providers';
import { repositoryIdentityOf } from '../usage/repository-identity';
import type { WorkProviderBacklogActivity, WorkProviderOpenPullRequest, WorkProviderPipelineRun } from '../work-integrations/types';
import { buildProjectEvidence, projectNarrativeInstructions, projectNarrativePrompt, projectNarrativeSchema, type ProjectEvidence } from './evidence';
import type { ProjectOverviewGitFacts, ProjectOverviewGitReader } from './git-reader';
import type { ProjectNarrativeStore } from './narrative-store';

const day = 86_400_000;
const evidenceWindow = 30 * day;
const cacheLifetime = 30_000;
const maxCacheEntries = 32;
const rewriteInterval = 15 * 60_000;
const maxEngines = 2;

export type ProjectOverviewSession = { provider: string; sessionId: string; startedAt: number; turns: number; failedTurns: number };

/** What happens around the code. Each read answers null when no connected provider serves the repository. */
export type ProjectOverviewOuterLoop = {
  backlog(repositoryId: string, since: number): Promise<(WorkProviderBacklogActivity & { provider: WorkProviderKind }) | null>;
  pullRequests(repositoryId: string): Promise<WorkProviderOpenPullRequest[] | null>;
  pipelines(repositoryId: string, since: number): Promise<{ provider: WorkProviderKind; runs: WorkProviderPipelineRun[] } | null>;
};

/** Runs one utility generation through an agent's engine and answers its reply. */
export type ProjectOverviewGenerate = (agent: Agent, request: Pick<BackendTextGenerationInput, 'cwd' | 'prompt' | 'developerInstructions' | 'outputSchema' | 'complexity'>) => Promise<unknown>;

export type ProjectOverviewServiceOptions = {
  git: Pick<ProjectOverviewGitReader, 'read'>;
  /** Recorded sessions for a repository; null when statistics are unavailable. */
  sessions: (repository: string, since: number) => ProjectOverviewSession[] | null;
  agents: () => readonly Agent[];
  outerLoop?: ProjectOverviewOuterLoop;
  narratives: ProjectNarrativeStore;
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

/** Everything read for one repository at one moment, before the narrative is attached. */
type Reading = {
  now: number;
  repository: string;
  teammates: readonly Agent[];
  overview: Omit<ProjectOverview, 'narrative' | 'flow'>;
  flow: Omit<Parameters<typeof buildProjectFlow>[0], 'workstreams'>;
  evidence: ProjectEvidence | null;
};

function replyOf(generated: unknown): unknown {
  const text = typeof generated === 'string' ? generated : generated && typeof generated === 'object' && typeof (generated as { text?: unknown }).text === 'string' ? (generated as { text: string }).text : '';
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gu, ''));
  } catch {
    return null;
  }
}

/** Composes one repository's overview from sources that fail independently. It reads, asks an engine to write, and never changes the repository. */
export class ProjectOverviewService {
  private readonly readings = new Map<string, { at: number; result: Promise<Reading> }>();
  private readonly writing = new Map<string, Promise<void>>();
  private readonly attempts = new Map<string, { at: number; evidenceKey: string; failure: 'noEngine' | 'failed' | null }>();
  private readonly now: () => number;

  constructor(private readonly options: ProjectOverviewServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async get(agent: Agent): Promise<ProjectOverview> {
    return this.present(await this.read(agent));
  }

  /** Rewrites the narrative when the project has moved since it was written, at most once per interval per repository. */
  async refreshNarrative(agent: Agent, generate: ProjectOverviewGenerate): Promise<ProjectOverview> {
    const reading = await this.read(agent);
    const evidence = reading.evidence;
    if (evidence && !evidence.quiet) {
      const stored = await this.options.narratives.get(reading.repository);
      const attempt = this.attempts.get(reading.repository);
      const due = stored?.evidenceKey !== evidence.key && (!attempt || reading.now - attempt.at >= rewriteInterval);
      const running = this.writing.get(reading.repository) ?? (due ? this.write(agent, reading, evidence, generate) : undefined);
      if (running) {
        this.writing.set(reading.repository, running);
        try { await running; } finally { if (this.writing.get(reading.repository) === running) this.writing.delete(reading.repository); }
      }
    }
    return this.present(reading);
  }

  private async write(agent: Agent, reading: Reading, evidence: ProjectEvidence, generate: ProjectOverviewGenerate): Promise<void> {
    const record = (failure: 'noEngine' | 'failed' | null) => { this.attempts.set(reading.repository, { at: reading.now, evidenceKey: evidence.key, failure }); };
    // The requesting agent's engine first, then one teammate on another engine, for engines that cannot generate.
    const engines = [agent, ...reading.teammates.filter(mate => mate.id !== agent.id && mate.folder)]
      .filter((candidate, index, all) => all.findIndex(other => other.backend === candidate.backend) === index)
      .slice(0, maxEngines);
    for (const candidate of engines) {
      let problems: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        let generated: unknown;
        try {
          generated = await generate(candidate, {
            cwd: candidate.folder!,
            prompt: projectNarrativePrompt(reading.overview.repository.name, evidence, problems),
            developerInstructions: projectNarrativeInstructions,
            outputSchema: projectNarrativeSchema,
            complexity: 'normal',
          });
        } catch {
          problems = [];
          break;
        }
        const draft = projectNarrativeFromDraft(replyOf(generated), evidence);
        if (draft.ok) {
          await this.options.narratives.set(reading.repository, {
            evidenceKey: evidence.key,
            narrative: {
              lead: draft.lead,
              workstreams: draft.workstreams.map(({ id, name, state, analysis, basis }) => ({ id, name, state, analysis, basis })),
              writtenBy: candidate.backend,
              writtenAt: new Date(reading.now).toISOString(),
            },
            workstreams: draft.workstreams.map(workstream => ({ id: workstream.id, branches: workstream.branches })),
          });
          return record(null);
        }
        problems = draft.problems;
      }
      // An engine that answered twice without grounding its reply will not do better on another engine's budget.
      if (problems.length) return record('failed');
    }
    record('noEngine');
  }

  private async present(reading: Reading): Promise<ProjectOverview> {
    const stored = await this.options.narratives.get(reading.repository);
    const attempt = this.attempts.get(reading.repository);
    const evidence = reading.evidence;
    const narrative: ProjectNarrativeState = stored
      ? { status: evidence && stored.evidenceKey === evidence.key ? 'fresh' : 'stale', narrative: stored.narrative }
      : !evidence || evidence.quiet ? { status: 'unavailable', reason: 'quiet' }
        : attempt?.failure && attempt.evidenceKey === evidence.key ? { status: 'unavailable', reason: attempt.failure }
          : { status: 'missing' };
    return { ...reading.overview, narrative, flow: buildProjectFlow({ ...reading.flow, workstreams: stored?.workstreams ?? [] }) };
  }

  private read(agent: Agent): Promise<Reading> {
    if (!agent.folder) return Promise.reject(new Error('This agent has no folder.'));
    const now = this.now();
    const cached = this.readings.get(agent.folder);
    if (cached && now - cached.at < cacheLifetime) return cached.result;
    const result = this.collect(agent, agent.folder, now);
    this.readings.delete(agent.folder);
    this.readings.set(agent.folder, { at: now, result });
    while (this.readings.size > maxCacheEntries) this.readings.delete(this.readings.keys().next().value!);
    return result;
  }

  private async collect(agent: Agent, folder: string, now: number): Promise<Reading> {
    const since = now - evidenceWindow;
    const repository = repositoryIdentityOf(agent) ?? folder;
    const teammates = this.options.agents().filter(candidate => repositoryIdentityOf(candidate) === repository);
    const workspace = agent.workspace?.kind === 'git' ? agent.workspace : undefined;
    const repositoryId = workspace?.originUrl ? canonicalGitRemoteIdentity(workspace.originUrl) : undefined;
    const outerLoop = repositoryId ? this.options.outerLoop : undefined;
    const branchOf = (mate: Agent) => mate.workspace?.kind === 'git' ? mate.workspace.branch : null;
    const keepBranches = [...new Set(teammates.flatMap(mate => branchOf(mate) ?? []))];

    const [git, backlog, requests, pipelines] = await Promise.all([
      settle(() => this.options.git.read(folder, { since, now, defaultBranch: workspace?.defaultBranch ?? null, keepBranches }), 'unavailable'),
      settle(() => outerLoop ? outerLoop.backlog(repositoryId!, since) : null, 'notConnected'),
      settle(() => outerLoop ? outerLoop.pullRequests(repositoryId!) : null, 'notConnected'),
      settle(() => outerLoop ? outerLoop.pipelines(repositoryId!, since) : null, 'notConnected'),
    ]);
    const facts: ProjectOverviewGitFacts | null = git.value;
    const runs = [...(pipelines.value?.runs ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    const units = (facts?.branches ?? []).filter(branch => branch.name !== facts!.baseBranch && branch.ahead > 0).map(branch => {
      const request = requests.value?.find(candidate => candidate.branch === branch.name);
      const latest = runs.filter(run => run.branch === branch.name).at(-1);
      return {
        branch: branch.name,
        pullRequest: request ? { draft: request.draft, approved: request.approved, openedAt: Date.parse(request.openedAt) } : null,
        latestPipeline: latest ? { status: latest.status, at: Date.parse(latest.at) } : null,
        firstCommitAt: branch.firstCommitAt,
        lastCommitAt: branch.lastCommitAt,
        agentWorking: teammates.some(mate => branchOf(mate) === branch.name && mate.status.type === 'working'),
        behind: branch.behind, ahead: branch.ahead, files: branch.files, insertions: branch.insertions, deletions: branch.deletions,
      } satisfies ProjectFlowUnit & Record<string, unknown>;
    });
    const merges = (facts?.commits ?? []).filter(commit => commit.merge && now - commit.at <= 7 * day);
    const flow: Reading['flow'] = {
      now,
      sources: { git: git.status, backlog: backlog.status, pullRequests: requests.status, pipelines: pipelines.status },
      backlog: backlog.value ? { open: backlog.value.open, arrived: backlog.value.items.filter(item => now - Date.parse(item.createdAt) <= 7 * day).length } : null,
      shipped: facts ? {
        count: merges.length,
        recentBranches: merges.filter(commit => now - commit.at <= day).flatMap(commit => (facts.baseBranch ? projectOverviewMergedBranch(commit.subject, facts.baseBranch) : null) ?? []),
      } : null,
      agentsWorking: teammates.filter(mate => mate.status.type === 'working').length,
      units,
    };
    return {
      now,
      repository,
      teammates,
      overview: {
        generatedAt: new Date(now).toISOString(),
        repository: {
          name: facts?.name ?? workspace?.repositoryName ?? (agent.workspace?.kind === 'folder' ? agent.workspace.label : basename(folder)),
          branch: facts ? facts.branch : workspace?.branch ?? null,
          baseBranch: facts?.baseBranch ?? null,
        },
        sources: flow.sources,
      },
      flow,
      evidence: facts ? buildProjectEvidence({ now, git: facts, units, backlog: backlog.value, sessions: this.options.sessions(repository, since), flow: buildProjectFlow({ ...flow, workstreams: [] }) }) : null,
    };
  }
}
