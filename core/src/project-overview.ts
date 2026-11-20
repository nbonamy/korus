/**
 * A read-only picture of one repository in two parts: a short written narrative of its workstreams,
 * and a flow of where work sits between backlog and shipped. The narrative is written by an engine
 * from evidence computed by code; the flow is computed by the policy here, with no model involved.
 */
export type ProjectOverviewSource = 'git' | 'backlog' | 'pullRequests' | 'pipelines';
/** The sources read from connected tools, after the repository. */
export type ProjectOverviewOuterSource = Exclude<ProjectOverviewSource, 'git'>;
/** loading: still being read. notConnected: no provider serves this repository. unavailable: nothing to read. failed: the read itself failed. */
export type ProjectOverviewSourceStatus = 'available' | 'loading' | 'notConnected' | 'unavailable' | 'failed';
export type ProjectOverviewSources = Record<ProjectOverviewSource, ProjectOverviewSourceStatus>;

export const projectWorkstreamStates = ['starting', 'moving', 'settling', 'recurring', 'waiting', 'stalled'] as const;
export type ProjectWorkstreamState = typeof projectWorkstreamStates[number];
export type ProjectWorkstream = {
  id: string;
  name: string;
  state: ProjectWorkstreamState;
  analysis: string;
  /** Labels of the facts the analysis rests on, composed by the producer and never by the model. */
  basis: string[];
};
export type ProjectNarrative = { lead: string; workstreams: ProjectWorkstream[]; writtenBy: string; writtenAt: string };
/** noEngine: no engine here can write it. failed: it could not be written or was not grounded. quiet: nothing to write about. */
export type ProjectNarrativeState =
  | { status: 'fresh' | 'stale'; narrative: ProjectNarrative }
  | { status: 'missing' }
  | { status: 'unavailable'; reason: 'noEngine' | 'failed' | 'quiet' };

export const projectFlowStationKinds = ['backlog', 'building', 'review', 'ci', 'shipped'] as const;
export type ProjectFlowStationKind = typeof projectFlowStationKinds[number];
export type ProjectFlowWorkStation = 'building' | 'review' | 'ci';
export type ProjectFlowMark = { workstreamId: string | null; units: number };
/** Why a piece of work needs someone, and where to go to help it: the request, or the agent's thread. */
export type ProjectFlowStuckReason = 'conflicts' | 'failing' | 'needsInput' | 'overdue';
export type ProjectFlowStuck = {
  branch: string;
  reason: ProjectFlowStuckReason;
  target: { kind: 'url'; url: string } | { kind: 'agent'; agentId: string } | null;
};
export type ProjectFlowStation = {
  kind: ProjectFlowStationKind;
  status: ProjectOverviewSourceStatus;
  count: number | null;
  /** Backlog: arrivals in seven days. Building: agents working. Review: longest wait in ms. CI: failing units. */
  note: number | null;
  marks: ProjectFlowMark[];
  stuck: ProjectFlowStuck[];
};
/** Work that reached `to` in the last day, as the workstream of each unit. */
export type ProjectFlowLink = { to: Exclude<ProjectFlowStationKind, 'backlog'>; tokens: (string | null)[] };
export type ProjectFlowConstraint = { station: ProjectFlowWorkStation; units: number; oldestWaitMs: number; workstreamIds: string[] };
export type ProjectFlow = { stations: ProjectFlowStation[]; links: ProjectFlowLink[]; constraint: ProjectFlowConstraint | null };

/** How far back the narrative looks. `days` is null when it covers the whole history, from `since`. */
export type ProjectOverviewLookback = { days: number | null; since: string };

export const projectToolKinds = ['github', 'gitlab', 'jira', 'linear', 'link'] as const;
export type ProjectToolKind = typeof projectToolKinds[number];
/** Where a flow station's work lives in another tool. Always an http(s) URL. */
export type ProjectToolLink = { label: string; url: string; tool: ProjectToolKind };
export type ProjectToolLinks = Partial<Record<ProjectFlowStationKind, ProjectToolLink>>;

export type ProjectOverview = {
  generatedAt: string;
  lookback: ProjectOverviewLookback;
  /** From the project's own config file, which is first written from what the git remote shows. */
  toolLinks: ProjectToolLinks;
  repository: { name: string; branch: string | null; baseBranch: string | null };
  sources: ProjectOverviewSources;
  narrative: ProjectNarrativeState;
  flow: ProjectFlow;
};

export const projectLookbackDays = [30, 90, 180, 365, 730] as const;
export type ProjectLookback = { days: number | null; since: number };
const lookbackDay = 86_400_000;
/** Activity worth a narrative. Merged pull requests and branches say more about a project's direction than single commits. */
const enoughActivity = 40;
const mergeWeight = 4;
const branchWeight = 3;

/**
 * The shortest window that holds enough activity to write about: the last 30 days for an active
 * project, further back for a quieter one, and the whole history when no window is enough.
 */
export function chooseProjectLookback(input: { now: number; commits: readonly number[]; merges: readonly number[]; branches: readonly number[] }): ProjectLookback {
  const within = (times: readonly number[], since: number) => times.reduce((count, at) => count + (at >= since ? 1 : 0), 0);
  for (const days of projectLookbackDays) {
    const since = input.now - days * lookbackDay;
    if (within(input.commits, since) + mergeWeight * within(input.merges, since) + branchWeight * within(input.branches, since) >= enoughActivity) return { days, since };
  }
  const earliest = [...input.commits, ...input.merges].reduce((first, at) => Math.min(first, at), input.now);
  return { days: null, since: earliest };
}

export const projectOverviewCommitKinds = ['feat', 'fix', 'test', 'chore', 'other'] as const;
export type ProjectOverviewCommitKind = typeof projectOverviewCommitKinds[number];
const conventionalKinds: Record<string, ProjectOverviewCommitKind> = {
  feat: 'feat', fix: 'fix', test: 'test',
  chore: 'chore', docs: 'chore', doc: 'chore', refactor: 'chore', perf: 'chore', build: 'chore', ci: 'chore', style: 'chore',
};

/** The kind a conventional commit subject declares; anything else is other. */
export function projectOverviewCommitKind(subject: string): ProjectOverviewCommitKind {
  const prefix = /^([a-z]+)(?:\([^)]*\))?!?:/iu.exec(subject.trim())?.[1]?.toLowerCase();
  return (prefix && conventionalKinds[prefix]) || 'other';
}

/** The branch a merge commit brought into `baseBranch`, or null for anything else, including merges of the base into a branch. */
export function projectOverviewMergedBranch(subject: string, baseBranch: string): string | null {
  const pullRequest = /^Merge pull request #\d+ from [^/\s]+\/(\S+)$/u.exec(subject);
  if (pullRequest) return pullRequest[1]!;
  const merge = /^Merge (?:remote-tracking )?branch '([^']+)'(?: of \S+)?(?: into (\S+))?$/u.exec(subject);
  if (!merge) return null;
  const branch = merge[1]!.replace(/^origin\//u, '');
  if (branch === baseBranch || (merge[2] !== undefined && merge[2] !== baseBranch)) return null;
  return branch;
}

export type ProjectOverviewPipelineStatus = 'passed' | 'failed' | 'running' | 'cancelled';
export type ProjectOverviewRiskReason =
  | { kind: 'behind'; commits: number }
  | { kind: 'size'; files: number }
  | { kind: 'overlap'; files: number; branches: number }
  | { kind: 'velocity'; commitsPerDay: number }
  | { kind: 'failingPipeline' };
export type ProjectOverviewRisk = { level: 'low' | 'medium' | 'high'; reasons: ProjectOverviewRiskReason[] };

/** How hard a branch will be to land. Deterministic: every point scored is also a reason. */
export function projectOverviewIntegrationRisk(input: {
  behind: number;
  changedFiles: number;
  overlapFiles: number;
  overlapBranches: number;
  baseCommitsPerDay: number | null;
  latestPipeline: ProjectOverviewPipelineStatus | null;
}): ProjectOverviewRisk {
  const reasons: ProjectOverviewRiskReason[] = [];
  let points = 0;
  if (input.behind >= 1) {
    points += input.behind >= 30 ? 3 : input.behind >= 10 ? 2 : 1;
    reasons.push({ kind: 'behind', commits: input.behind });
  }
  if (input.changedFiles >= 30) {
    points += input.changedFiles >= 200 ? 3 : input.changedFiles >= 100 ? 2 : 1;
    reasons.push({ kind: 'size', files: input.changedFiles });
  }
  if (input.overlapFiles >= 1) {
    points += input.overlapFiles >= 3 ? 2 : 1;
    reasons.push({ kind: 'overlap', files: input.overlapFiles, branches: input.overlapBranches });
  }
  if (input.baseCommitsPerDay !== null && input.baseCommitsPerDay >= 10) {
    points += 1;
    reasons.push({ kind: 'velocity', commitsPerDay: Math.round(input.baseCommitsPerDay) });
  }
  if (input.latestPipeline === 'failed') {
    points += 2;
    reasons.push({ kind: 'failingPipeline' });
  }
  return { level: points >= 6 ? 'high' : points >= 3 ? 'medium' : 'low', reasons };
}

/** One piece of work in flight: a branch ahead of the base, with its pull request when it has one. */
export type ProjectFlowUnit = {
  branch: string;
  /** `approved` and `conflicts` are null when the provider cannot say; `url` is null when it gave no address. */
  pullRequest: { draft: boolean; approved: boolean | null; conflicts: boolean | null; openedAt: number; url: string | null } | null;
  latestPipeline: { status: ProjectOverviewPipelineStatus; at: number } | null;
  firstCommitAt: number;
  lastCommitAt: number;
  agentWorking: boolean;
  /** The agent thread on this branch, preferring one that is working or waiting. */
  agentId: string | null;
  agentNeedsInput: boolean;
};

export type ProjectFlowInput = {
  now: number;
  sources: ProjectOverviewSources;
  /** Null when no backlog source reports for this repository. */
  backlog: { open: number | null; arrived: number } | null;
  /** Merges into the base in seven days, and the branches merged in the last day. Null when the repository could not be read. */
  shipped: { count: number; recentBranches: string[] } | null;
  agentsWorking: number;
  /** How long recently merged requests stayed open, at the median; null without enough history. */
  medianMergeMs: number | null;
  /** In narrative order. A branch no workstream claims is other work. */
  workstreams: readonly { id: string; branches: readonly string[] }[];
  units: readonly ProjectFlowUnit[];
};

const day = 86_400_000;
const maxTokens = 3;
/** "Open too long" when no merge history says otherwise. */
const defaultOverdueMs = 3 * day;

/** The station a unit sits at, by what it is waiting on. */
export function projectFlowStation(unit: ProjectFlowUnit): ProjectFlowWorkStation {
  const request = unit.pullRequest;
  if (!request || request.draft) return 'building';
  if (request.approved !== null) return request.approved ? 'ci' : 'review';
  return unit.latestPipeline?.status === 'running' || unit.latestPipeline?.status === 'failed' ? 'ci' : 'review';
}

/** Stations, marks, moving tokens and the constraint. Sources that cannot report leave their stations without a count. */
export function buildProjectFlow(input: ProjectFlowInput): ProjectFlow {
  const gitReady = input.sources.git === 'available';
  const requestsReady = gitReady && input.sources.pullRequests === 'available';
  const order = input.workstreams.map(workstream => workstream.id);
  const workstreamOf = (branch: string) => input.workstreams.find(workstream => workstream.branches.includes(branch))?.id ?? null;
  const rank = (id: string | null) => id === null ? order.length : order.indexOf(id);

  const placed = (gitReady && input.sources.pullRequests !== 'loading' ? input.units : []).map(unit => {
    const station = requestsReady ? projectFlowStation(unit) : 'building';
    const arrivedAt = station === 'building' ? unit.firstCommitAt : station === 'review' ? unit.pullRequest!.openedAt : unit.latestPipeline?.at ?? unit.pullRequest!.openedAt;
    const waitMs = station === 'building' ? (unit.agentWorking ? 0 : Math.max(0, input.now - unit.lastCommitAt)) : Math.max(0, input.now - arrivedAt);
    return { unit, station, arrivedAt, waitMs, workstreamId: workstreamOf(unit.branch) };
  });
  const at = (station: ProjectFlowWorkStation) => placed.filter(entry => entry.station === station);
  const marks = (station: ProjectFlowWorkStation): ProjectFlowMark[] => {
    const counts = new Map<string | null, number>();
    for (const entry of at(station)) counts.set(entry.workstreamId, (counts.get(entry.workstreamId) ?? 0) + 1);
    return [...counts].sort((a, b) => rank(a[0]) - rank(b[0])).map(([workstreamId, units]) => ({ workstreamId, units }));
  };
  const overdueMs = input.medianMergeMs ?? defaultOverdueMs;
  const stuck = (station: ProjectFlowWorkStation): ProjectFlowStuck[] => at(station).flatMap(({ unit, waitMs }) => {
    const request = station === 'building' ? null : unit.pullRequest;
    const reason: ProjectFlowStuckReason | null = request?.conflicts ? 'conflicts'
      : station !== 'building' && unit.latestPipeline?.status === 'failed' ? 'failing'
        : unit.agentNeedsInput ? 'needsInput'
          : request && waitMs > overdueMs ? 'overdue' : null;
    if (!reason) return [];
    const target: ProjectFlowStuck['target'] = reason !== 'needsInput' && request?.url ? { kind: 'url', url: request.url }
      : unit.agentId ? { kind: 'agent', agentId: unit.agentId } : request?.url ? { kind: 'url', url: request.url } : null;
    return [{ branch: unit.branch, reason, target }];
  });
  // A unit is placed by its request, and an unapproved request by its pipeline, so a station waits for both.
  const statusOf = (station: ProjectFlowWorkStation): ProjectOverviewSourceStatus => {
    if (!gitReady) return input.sources.git;
    const requests = input.sources.pullRequests;
    if (requests === 'loading') return 'loading';
    if (station === 'building') return 'available';
    return requests === 'available' && input.sources.pipelines === 'loading' ? 'loading' : requests;
  };
  const work = (station: ProjectFlowWorkStation, note: () => number | null): ProjectFlowStation => {
    const status = statusOf(station);
    return status === 'available'
      ? { kind: station, status, count: at(station).length, note: note(), marks: marks(station), stuck: stuck(station) }
      : { kind: station, status, count: null, note: null, marks: [], stuck: [] };
  };
  const arrivals = (station: ProjectFlowWorkStation) => statusOf(station) === 'available'
    ? at(station).filter(entry => input.now - entry.arrivedAt <= day).slice(0, maxTokens).map(entry => entry.workstreamId)
    : [];

  let constraint: ProjectFlowConstraint | null = null;
  let longest = -1;
  for (const station of ['building', 'review', 'ci'] as const) {
    const entries = statusOf(station) === 'available' ? at(station) : [];
    const oldestWaitMs = Math.max(0, ...entries.map(entry => entry.waitMs));
    const total = entries.reduce((sum, entry) => sum + entry.waitMs, 0);
    if (entries.length < 2 || oldestWaitMs <= day || total < longest) continue;
    longest = total;
    constraint = {
      station, units: entries.length, oldestWaitMs,
      workstreamIds: order.filter(id => entries.some(entry => entry.workstreamId === id)),
    };
  }

  return {
    stations: [
      input.backlog && input.sources.backlog === 'available'
        ? { kind: 'backlog', status: 'available', count: input.backlog.open, note: input.backlog.arrived, marks: [], stuck: [] }
        : { kind: 'backlog', status: input.sources.backlog === 'available' ? 'unavailable' : input.sources.backlog, count: null, note: null, marks: [], stuck: [] },
      work('building', () => input.agentsWorking),
      work('review', () => at('review').length ? Math.max(...at('review').map(entry => entry.waitMs)) : null),
      work('ci', () => at('ci').filter(entry => entry.unit.latestPipeline?.status === 'failed').length),
      gitReady && input.shipped
        ? { kind: 'shipped', status: 'available', count: input.shipped.count, note: null, marks: [], stuck: [] }
        : { kind: 'shipped', status: gitReady ? 'unavailable' : input.sources.git, count: null, note: null, marks: [], stuck: [] },
    ],
    links: [
      { to: 'building', tokens: arrivals('building') },
      { to: 'review', tokens: arrivals('review') },
      { to: 'ci', tokens: arrivals('ci') },
      { to: 'shipped', tokens: gitReady && input.shipped ? input.shipped.recentBranches.slice(0, maxTokens).map(workstreamOf) : [] },
    ],
    constraint,
  };
}

const flowSources: Record<ProjectFlowStationKind, readonly ProjectOverviewSource[]> = {
  backlog: ['backlog'], building: ['git', 'pullRequests'], review: ['git', 'pullRequests', 'pipelines'],
  ci: ['git', 'pullRequests', 'pipelines'], shipped: ['git'],
};

/** A flow whose every station is still being read, drawn before anything has answered. */
export function projectFlowReading(): ProjectFlow {
  return {
    stations: projectFlowStationKinds.map(kind => ({ kind, status: 'loading', count: null, note: null, marks: [], stuck: [] })),
    links: (['building', 'review', 'ci', 'shipped'] as const).map(to => ({ to, tokens: [] })),
    constraint: null,
  };
}

/** How many sources are still being read. */
export function projectOverviewSourcesReading(sources: ProjectOverviewSources): number {
  return Object.values(sources).filter(status => status === 'loading').length;
}

/** Ends a source that never answered: its stations that were still waiting on it show it failed, the others keep what they have. */
export function projectOverviewSourceFailed(overview: ProjectOverview, source: ProjectOverviewSource): ProjectOverview {
  if (overview.sources[source] !== 'loading') return overview;
  return {
    ...overview,
    sources: { ...overview.sources, [source]: 'failed' },
    flow: {
      ...overview.flow,
      stations: overview.flow.stations.map(station => station.status === 'loading' && flowSources[station.kind].includes(source)
        ? { ...station, status: 'failed', count: null, note: null, marks: [], stuck: [] }
        : station),
    },
  };
}

/** One thing code worked out about the repository. `text` is given to the engine; `label` names it to the reader. */
export type ProjectNarrativeFact = { id: string; text: string; label: string };
export type ProjectNarrativeEvidence = {
  facts: readonly ProjectNarrativeFact[];
  branches: readonly string[];
  issues: readonly string[];
  /** The repository's name, which the lead opens with. */
  project?: string;
};
export type ProjectNarrativeDraft = {
  lead: string;
  workstreams: (ProjectWorkstream & { branches: string[]; issues: string[] })[];
};

const leadLimit = 160;
const analysisLimit = 180;
const nameLimit = 40;
const maxWorkstreams = 4;
const maxBasis = 2;

/** Every figure written in digits, with grouping commas removed. Numbers written as words are not figures. */
function figures(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/gu) ?? []).map(figure => figure.replace(/,/gu, ''));
}

const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.trim().length >= 1 && value.length <= limit;
/** One sentence: no sentence ending before the last character. A full stop inside "0.56" is not an ending. */
const sentence = (value: unknown, limit: number): value is string => text(value, limit) && !/[.!?]\s+\S/u.test(value.trim());
const names = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === 'string');

/**
 * Accepts an engine's reply only when it is grounded: every workstream cites supplied facts, claims
 * only branches and issues that exist, and states no figure its cited facts do not contain.
 */
export function projectNarrativeFromDraft(reply: unknown, evidence: ProjectNarrativeEvidence): ({ ok: true } & ProjectNarrativeDraft) | { ok: false; problems: string[] } {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return { ok: false, problems: ['The reply is not a narrative object.'] };
  const draft = reply as Record<string, unknown>;
  const problems: string[] = [];
  if (!sentence(draft.lead, leadLimit)) problems.push(`The lead must be one sentence of at most ${leadLimit} characters.`);
  else if (evidence.project && !projectNarrativeLeadParts(draft.lead.trim(), evidence.project)) problems.push(`The lead must start with the project name, ${evidence.project}.`);
  if (!Array.isArray(draft.workstreams) || draft.workstreams.length < 1 || draft.workstreams.length > maxWorkstreams) {
    return { ok: false, problems: [...problems, `There must be 1 to ${maxWorkstreams} workstreams.`] };
  }
  const facts = new Map(evidence.facts.map(fact => [fact.id, fact]));
  const citedFigures = new Set<string>();
  const workstreams = draft.workstreams.map((entry: unknown, index): ProjectNarrativeDraft['workstreams'][number] | null => {
    const label = `Workstream ${index + 1}`;
    const before = problems.length;
    const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    if (!text(value.name, nameLimit)) problems.push(`${label} needs a name of at most ${nameLimit} characters.`);
    if (!projectWorkstreamStates.includes(value.state as ProjectWorkstreamState)) problems.push(`${label} has an unknown state.`);
    if (!sentence(value.analysis, analysisLimit)) problems.push(`${label} needs one sentence of at most ${analysisLimit} characters.`);
    const cited = names(value.facts) ? value.facts : [];
    const branches = value.branches === undefined ? [] : names(value.branches) ? value.branches : null;
    const issues = value.issues === undefined ? [] : names(value.issues) ? value.issues : null;
    if (!cited.length) problems.push(`${label} cites no facts.`);
    for (const id of cited) if (!facts.has(id)) problems.push(`${label} cites unknown fact ${id}.`);
    for (const branch of branches ?? []) if (!evidence.branches.includes(branch)) problems.push(`${label} claims unknown branch ${branch}.`);
    for (const issue of issues ?? []) if (!evidence.issues.includes(issue)) problems.push(`${label} claims unknown issue ${issue}.`);
    if (!branches || !issues) problems.push(`${label} has malformed references.`);
    if (problems.length > before) return null;
    const supplied = new Set(cited.flatMap(id => figures(facts.get(id)!.text)));
    for (const figure of supplied) citedFigures.add(figure);
    const unsupported = figures(value.analysis as string).find(figure => !supplied.has(figure));
    if (unsupported) {
      problems.push(`${label} states ${unsupported}, which none of its cited facts contain.`);
      return null;
    }
    return {
      id: `w${index + 1}`,
      name: (value.name as string).trim(),
      state: value.state as ProjectWorkstreamState,
      analysis: (value.analysis as string).trim(),
      basis: cited.slice(0, maxBasis).map(id => facts.get(id)!.label),
      branches: branches!,
      issues: issues!,
    };
  });
  if (!problems.length) {
    const unsupported = figures(draft.lead as string).find(figure => !citedFigures.has(figure));
    if (unsupported) problems.push(`The lead states ${unsupported}, which no cited fact contains.`);
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, lead: (draft.lead as string).trim(), workstreams: workstreams as ProjectNarrativeDraft['workstreams'] };
}

/** The project name a lead opens with, as the lead spells it, and the rest of the lead; null when it does not open with the name. */
export function projectNarrativeLeadParts(lead: string, project: string): { name: string; rest: string } | null {
  const name = lead.slice(0, project.length);
  if (!project || name.toLowerCase() !== project.toLowerCase() || /[\p{L}\p{N}_-]/u.test(lead.charAt(project.length))) return null;
  return { name, rest: lead.slice(project.length) };
}

/** The middle of a set of durations, or null when there are too few to say what is usual. */
export function projectMedianDuration(durations: readonly number[], minimum = 3): number | null {
  if (durations.length < minimum) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
