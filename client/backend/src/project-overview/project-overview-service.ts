import { basename } from 'node:path';
import { backendDisplayName, type BackendTextGenerationInput } from '@workspace/core/backend-driver';
import type { Agent, AgentBackend } from '@workspace/core/contracts';
import type { ProviderConnection } from '@workspace/core/contracts/provider-setup';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import {
  buildProjectFlow,
  chooseProjectLookback,
  projectMedianDuration,
  projectNarrativeFromDraft,
  projectOverviewMergedBranch,
  type ProjectFlowUnit,
  type ProjectLookback,
  type ProjectNarrativeState,
  type ProjectOverview,
  type ProjectOverviewOuterSource,
  type ProjectOverviewSourceStatus,
} from '@workspace/core/project-overview';
import type { WorkProviderKind } from '@workspace/core/work-providers';
import { repositoryIdentityOf } from '../usage/repository-identity';
import type { WorkProviderBacklogActivity, WorkProviderPipelineRun, WorkProviderPullRequestActivity } from '../work-integrations/types';
import { buildProjectEvidence, projectNarrativeInstructions, projectNarrativePrompt, projectNarrativeSchema, type ProjectEvidence } from './evidence';
import type { ProjectOverviewGitFacts, ProjectOverviewGitReader } from './git-reader';
import type { ProjectNarrativeStore } from './narrative-store';
import { inferProjectToolLinks, proposeProjectTools, type ProjectToolConfigFile } from './tool-links';

const day = 86_400_000;
const cacheLifetime = 30_000;
const maxCacheEntries = 32;
const rewriteInterval = 15 * 60_000;

type ProjectOverviewSession = { provider: string; sessionId: string; startedAt: number; turns: number; failedTurns: number };

/** What happens around the code. Each read answers null when no connected provider serves the repository. */
export type ProjectOverviewOuterLoop = {
  backlog(repositoryId: string, since: number): Promise<(WorkProviderBacklogActivity & { provider: WorkProviderKind }) | null>;
  pullRequests(repositoryId: string): Promise<WorkProviderPullRequestActivity | null>;
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
  /** The project's tool links, read from and first written to its own config file. */
  tools?: Pick<ProjectToolConfigFile, 'load'>;
  /** Engines installed, enabled and signed in on this host, tried after the repository's own agents. */
  hostEngines?: () => readonly AgentBackend[];
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

/** A source being read, and what it answered once it has. */
type Part<T> = { promise: Promise<Settled<T>>; settled: Settled<T> | null };
function track<T>(read: Promise<Settled<T>>): Part<T> {
  const part: Part<T> = { promise: read, settled: null };
  part.promise = read.then(settled => { part.settled = settled; return settled; });
  return part;
}

type BacklogRead = WorkProviderBacklogActivity & { provider: WorkProviderKind };
type PipelineRead = { provider: WorkProviderKind; runs: WorkProviderPipelineRun[] };

/** One read of a repository: the repository itself at once, and each outer source as it answers. */
type Reading = {
  now: number;
  repository: string;
  teammates: readonly Agent[];
  git: Settled<ProjectOverviewGitFacts>;
  lookback: ProjectLookback;
  base: Omit<ProjectOverview, 'narrative' | 'flow' | 'sources'>;
  parts: { backlog: Part<BacklogRead>; pullRequests: Part<WorkProviderPullRequestActivity>; pipelines: Part<PipelineRead> };
  /** Composed once, after every source has answered. */
  complete: Composition | null;
};

/** What was known when a reading was composed, before the narrative is attached. */
type Composition = {
  reading: Reading;
  overview: Omit<ProjectOverview, 'narrative' | 'flow'>;
  flow: Omit<Parameters<typeof buildProjectFlow>[0], 'workstreams'>;
  /** Only once every source has answered: evidence from part of the project would misjudge the narrative. */
  evidence: ProjectEvidence | null;
  complete: boolean;
};

export type ProjectOverviewGetOptions = {
  /** The sources to wait for before answering; every source when omitted. The rest answer as loading until they land. */
  wait?: readonly ProjectOverviewOuterSource[];
};

const outerSources = ['backlog', 'pullRequests', 'pipelines'] as const;

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

  async get(agent: Agent, options: ProjectOverviewGetOptions = {}): Promise<ProjectOverview> {
    const reading = await this.read(agent);
    await Promise.all((options.wait ?? outerSources).map(source => reading.parts[source].promise));
    return this.present(this.compose(reading));
  }

  /** Rewrites the narrative when the project has moved since it was written, at most once per interval per repository. */
  async refreshNarrative(agent: Agent, generate: ProjectOverviewGenerate): Promise<ProjectOverview> {
    const read = await this.read(agent);
    await Promise.all(outerSources.map(source => read.parts[source].promise));
    const reading = this.compose(read);
    const evidence = reading.evidence;
    if (evidence && !evidence.quiet) {
      const { repository, now } = read;
      const stored = await this.options.narratives.get(repository);
      const attempt = this.attempts.get(repository);
      const due = stored?.evidenceKey !== evidence.key && (!attempt || now - attempt.at >= rewriteInterval);
      const running = this.writing.get(repository) ?? (due ? this.write(agent, reading, evidence, generate) : undefined);
      if (running) {
        this.writing.set(repository, running);
        try { await running; } finally { if (this.writing.get(repository) === running) this.writing.delete(repository); }
      }
    }
    return this.present(reading);
  }

  private async write(agent: Agent, { reading, overview }: Composition, evidence: ProjectEvidence, generate: ProjectOverviewGenerate): Promise<void> {
    const record = (failure: 'noEngine' | 'failed' | null) => { this.attempts.set(reading.repository, { at: reading.now, evidenceKey: evidence.key, failure }); };
    // The requesting agent's engine first, then teammates on other engines, then any other engine signed in on
    // this host: the evidence is already read, so any engine can write it. Each engine is asked once.
    const teammates = [agent, ...reading.teammates.filter(mate => mate.id !== agent.id && mate.folder)]
      .filter((candidate, index, all) => all.findIndex(other => other.backend === candidate.backend) === index);
    const root = (agent.workspace?.kind === 'git' ? agent.workspace.primaryWorktreeRoot || agent.workspace.repositoryRoot : null) || agent.folder!;
    const host = (this.options.hostEngines?.() ?? [])
      .filter((backend, index, all) => all.indexOf(backend) === index && !teammates.some(mate => mate.backend === backend))
      .map(backend => hostEngine(agent, backend, root));
    for (const candidate of [...teammates, ...host]) {
      let problems: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        let generated: unknown;
        try {
          generated = await generate(candidate, {
            cwd: candidate.folder!,
            prompt: projectNarrativePrompt(overview.repository.name, evidence, problems),
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
              writtenBy: backendDisplayName(candidate.backend),
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

  private async present(composition: Composition): Promise<ProjectOverview> {
    const { reading, evidence } = composition;
    const stored = await this.options.narratives.get(reading.repository);
    const attempt = this.attempts.get(reading.repository);
    const narrative: ProjectNarrativeState = !composition.complete
      ? stored ? { status: 'stale', narrative: stored.narrative } : { status: 'missing' }
      : stored
        ? { status: evidence && stored.evidenceKey === evidence.key ? 'fresh' : 'stale', narrative: stored.narrative }
        : !evidence || evidence.quiet ? { status: 'unavailable', reason: 'quiet' }
          : attempt?.failure && attempt.evidenceKey === evidence.key ? { status: 'unavailable', reason: attempt.failure }
            : { status: 'missing' };
    return { ...composition.overview, narrative, flow: buildProjectFlow({ ...composition.flow, workstreams: stored?.workstreams ?? [] }) };
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

  /** Reads the repository, which decides how far back to look, then starts every outer source without waiting for it. */
  private async collect(agent: Agent, folder: string, now: number): Promise<Reading> {
    const repository = repositoryIdentityOf(agent) ?? folder;
    const teammates = this.options.agents().filter(candidate => repositoryIdentityOf(candidate) === repository);
    const workspace = agent.workspace?.kind === 'git' ? agent.workspace : undefined;
    const repositoryId = workspace?.originUrl ? canonicalGitRemoteIdentity(workspace.originUrl) : undefined;
    const outerLoop = repositoryId ? this.options.outerLoop : undefined;
    const keepBranches = [...new Set(teammates.flatMap(mate => branchOf(mate) ?? []))];

    const git = await settle(() => this.options.git.read(folder, { now, defaultBranch: workspace?.defaultBranch ?? null, keepBranches }), 'unavailable');
    const facts = git.value;
    const lookback = chooseProjectLookback({
      now,
      commits: (facts?.commits ?? []).filter(commit => !commit.merge).map(commit => commit.at),
      merges: (facts?.commits ?? []).filter(commit => commit.merge).map(commit => commit.at),
      branches: facts?.branchActivity ?? [],
    });
    const since = lookback.since;
    const parts: Reading['parts'] = {
      backlog: track(settle(() => outerLoop ? outerLoop.backlog(repositoryId!, since) : null, 'notConnected')),
      pullRequests: track(settle(() => outerLoop ? outerLoop.pullRequests(repositoryId!) : null, 'notConnected')),
      pipelines: track(settle(() => outerLoop ? outerLoop.pipelines(repositoryId!, since) : null, 'notConnected')),
    };
    const toolRoot = facts ? workspace?.primaryWorktreeRoot || workspace?.repositoryRoot || folder : null;
    const toolLinks = toolRoot && this.options.tools
      ? await this.options.tools.load(toolRoot, () => ({ links: inferProjectToolLinks(repositoryId), proposals: proposeProjectTools(facts!.messages) })).catch(() => ({}))
      : {};
    return {
      now,
      repository,
      teammates,
      git,
      lookback,
      base: {
        generatedAt: new Date(now).toISOString(),
        lookback: { days: lookback.days, since: new Date(lookback.since).toISOString() },
        toolLinks,
        repository: {
          name: facts?.name ?? workspace?.repositoryName ?? (agent.workspace?.kind === 'folder' ? agent.workspace.label : basename(folder)),
          branch: facts ? facts.branch : workspace?.branch ?? null,
          baseBranch: facts?.baseBranch ?? null,
        },
      },
      parts,
      complete: null,
    };
  }

  /** Composes what a reading knows now; a source that has not answered is loading. */
  private compose(reading: Reading): Composition {
    if (reading.complete) return reading.complete;
    const { now, teammates, git, lookback, parts } = reading;
    const facts = git.value;
    const answer = <T>(part: Part<T>): Settled<T> => part.settled ?? { status: 'loading', value: null };
    const backlog = answer(parts.backlog);
    const requests = answer(parts.pullRequests);
    const pipelines = answer(parts.pipelines);
    const complete = outerSources.every(source => parts[source].settled);
    const runs = [...(pipelines.value?.runs ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    const units = (facts?.branches ?? []).filter(branch => branch.name !== facts!.baseBranch && branch.ahead > 0).map(branch => {
      const request = requests.value?.open.find(candidate => candidate.branch === branch.name);
      const onBranch = teammates.filter(mate => branchOf(mate) === branch.name);
      const thread = onBranch.find(mate => mate.status.type === 'awaitingInput') ?? onBranch.find(mate => mate.status.type === 'working') ?? onBranch[0];
      const latest = runs.filter(run => run.branch === branch.name).at(-1);
      return {
        branch: branch.name,
        pullRequest: request ? { draft: request.draft, approved: request.approved, conflicts: request.conflicts, openedAt: Date.parse(request.openedAt), url: request.url } : null,
        latestPipeline: latest ? { status: latest.status, at: Date.parse(latest.at) } : null,
        firstCommitAt: branch.firstCommitAt,
        lastCommitAt: branch.lastCommitAt,
        agentWorking: onBranch.some(mate => mate.status.type === 'working'),
        agentId: thread?.id ?? null,
        agentNeedsInput: onBranch.some(mate => mate.status.type === 'awaitingInput'),
        behind: branch.behind, ahead: branch.ahead, files: branch.files, insertions: branch.insertions, deletions: branch.deletions,
      } satisfies ProjectFlowUnit & Record<string, unknown>;
    });
    const merges = (facts?.commits ?? []).filter(commit => commit.merge && now - commit.at <= 7 * day);
    const flow: Composition['flow'] = {
      now,
      sources: { git: git.status, backlog: backlog.status, pullRequests: requests.status, pipelines: pipelines.status },
      backlog: backlog.value ? { open: backlog.value.open, arrived: backlog.value.items.filter(item => now - Date.parse(item.createdAt) <= 7 * day).length } : null,
      shipped: facts ? {
        count: merges.length,
        recentBranches: merges.filter(commit => now - commit.at <= day).flatMap(commit => (facts.baseBranch ? projectOverviewMergedBranch(commit.subject, facts.baseBranch) : null) ?? []),
      } : null,
      agentsWorking: teammates.filter(mate => mate.status.type === 'working').length,
      medianMergeMs: projectMedianDuration(requests.value?.mergeTimesMs ?? []),
      units,
    };
    const since = lookback.since;
    const composition: Composition = {
      reading,
      overview: { ...reading.base, sources: flow.sources },
      flow,
      evidence: complete && facts ? buildProjectEvidence({
        now,
        lookback,
        git: { ...facts, commits: facts.commits.filter(commit => commit.at >= since), tags: facts.tags.filter(tag => tag.at >= since) },
        units, backlog: backlog.value, sessions: this.options.sessions(reading.repository, since), flow: buildProjectFlow({ ...flow, workstreams: [] }) }) : null,
      complete,
    };
    if (complete) reading.complete = composition;
    return composition;
  }
}

const hostEngineOrder: readonly AgentBackend[] = ['claude', 'codex', 'antigravity', 'cursor'];
/** Engines a narrative can fall back to on this host: installed, enabled and signed in. */
export function projectNarrativeHostEngines(connections: readonly ProviderConnection[] | undefined): AgentBackend[] {
  return hostEngineOrder.filter(backend => connections?.some(connection => connection.backend === backend && connection.installed && connection.connected && connection.enabled !== false));
}

/** An engine on this host with no agent in the repository: it only writes the narrative, from the repository's primary checkout. */
function hostEngine(requester: Agent, backend: AgentBackend, folder: string): Agent {
  return { id: `project-narrative-${backend}`, name: null, backend, folder, status: { type: 'idle' }, ...(requester.workspace ? { workspace: requester.workspace } : {}) } as Agent;
}

function branchOf(agent: Agent): string | null {
  return agent.workspace?.kind === 'git' ? agent.workspace.branch : null;
}
