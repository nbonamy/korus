import { dayOf, validTimeZone } from './usage-time';
import type { WorkProviderKind } from './work-providers';

/**
 * A read-only picture of one repository: what the harness did there (history and agent sessions)
 * beside what happens around it (backlog and pipelines). Zones are null when their source has
 * nothing to say, so a reader never infers a state from an empty list.
 */
export const projectOverviewWindows = ['7d', '30d', '12w', '1y'] as const;
export type ProjectOverviewWindow = typeof projectOverviewWindows[number];
export type ProjectOverviewInput = { window?: ProjectOverviewWindow; timeZone?: string };
export type ProjectOverviewBucketKind = 'day' | 'week';

export type ProjectOverviewSource = 'git' | 'sessions' | 'backlog' | 'pipelines';
/** notConnected: no provider serves this repository. unavailable: nothing to read. failed: the read itself failed. */
export type ProjectOverviewSourceStatus = 'available' | 'notConnected' | 'unavailable' | 'failed';

export const projectOverviewCommitKinds = ['feat', 'fix', 'test', 'chore', 'other'] as const;
export type ProjectOverviewCommitKind = typeof projectOverviewCommitKinds[number];

export type ProjectOverviewEngineSessions = { provider: string; sessions: number; turns: number; failedTurns: number };

export type ProjectOverviewBucket = {
  /** The calendar day (YYYY-MM-DD) the bucket starts on in the reader's time zone. */
  start: string;
  commits: Record<ProjectOverviewCommitKind, number>;
  merges: number;
  mergedBranches: string[];
  releases: string[];
  sessions: ProjectOverviewEngineSessions[];
};

export type ProjectOverviewChapter = { start: string; buckets: number; title: string; branches: string[] };

export type ProjectOverviewPipelineStatus = 'passed' | 'failed' | 'running' | 'cancelled';
export type ProjectOverviewPipelineRun = { id: string; branch: string; status: ProjectOverviewPipelineStatus; at: string };
export type ProjectOverviewPipelines = { provider: WorkProviderKind; baseRuns: ProjectOverviewPipelineRun[]; passRate: number | null };

export type ProjectOverviewRiskLevel = 'low' | 'medium' | 'high';
export type ProjectOverviewRiskReason =
  | { kind: 'behind'; commits: number }
  | { kind: 'size'; files: number }
  | { kind: 'overlap'; files: number; branches: number }
  | { kind: 'velocity'; commitsPerDay: number }
  | { kind: 'failingPipeline' };
/** gitOnly: no pipeline result was known, so the level rests on repository facts alone. */
export type ProjectOverviewRisk = { level: ProjectOverviewRiskLevel; gitOnly: boolean; reasons: ProjectOverviewRiskReason[] };

export type ProjectOverviewBranchAgent = { id: string; name: string; backend: string; status: string };
export type ProjectOverviewBranch = {
  name: string;
  base: boolean;
  current: boolean;
  lastCommitAt: string | null;
  behind: number;
  ahead: number;
  changedFiles: number;
  agents: ProjectOverviewBranchAgent[];
  /** Oldest first. Null when no code host reports pipelines for this repository. */
  pipelineRuns: ProjectOverviewPipelineRun[] | null;
  /** Null on the base branch, which everything else is measured against. */
  risk: ProjectOverviewRisk | null;
};

export type ProjectOverviewBacklogChange = { id: string; title: string; change: 'opened' | 'closed' | 'updated'; at: string };
export type ProjectOverviewBacklog = {
  provider: WorkProviderKind;
  /** Null when the provider cannot report a total cheaply. */
  open: number | null;
  opened: number;
  closed: number;
  buckets: { start: string; opened: number; closed: number }[];
  latest: ProjectOverviewBacklogChange[];
};

export type ProjectOverview = {
  generatedAt: string;
  repository: { name: string; branch: string | null; baseBranch: string | null };
  window: { kind: ProjectOverviewWindow; bucket: ProjectOverviewBucketKind; timeZone: string };
  sources: Record<ProjectOverviewSource, ProjectOverviewSourceStatus>;
  totals: {
    commits: number;
    merges: number;
    releases: number;
    sessions: number;
    turns: number;
    workingAgents: number;
    baseCommitsPerDay: number | null;
  };
  buckets: ProjectOverviewBucket[];
  chapters: ProjectOverviewChapter[];
  branches: ProjectOverviewBranch[];
  backlog: ProjectOverviewBacklog | null;
  pipelines: ProjectOverviewPipelines | null;
};

export const defaultProjectOverviewWindow: ProjectOverviewWindow = '30d';

export function validProjectOverviewInput(value: unknown): value is ProjectOverviewInput | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (!Object.keys(input).every(key => key === 'window' || key === 'timeZone')) return false;
  if (input.window !== undefined && !projectOverviewWindows.includes(input.window as ProjectOverviewWindow)) return false;
  return input.timeZone === undefined || validTimeZone(input.timeZone);
}

const conventionalKinds: Record<string, ProjectOverviewCommitKind> = {
  feat: 'feat', fix: 'fix', test: 'test',
  chore: 'chore', docs: 'chore', doc: 'chore', refactor: 'chore', perf: 'chore', build: 'chore', ci: 'chore', style: 'chore',
};

/** The kind a conventional commit subject declares; anything else is other. */
export function projectOverviewCommitKind(subject: string): ProjectOverviewCommitKind {
  const prefix = /^([a-z]+)(?:\([^)]*\))?!?:/iu.exec(subject.trim())?.[1]?.toLowerCase();
  return (prefix && conventionalKinds[prefix]) || 'other';
}

function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function mondayOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return shiftDay(day, -((new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7));
}

const windowShapes: Record<ProjectOverviewWindow, { bucket: ProjectOverviewBucketKind; count: number }> = {
  '7d': { bucket: 'day', count: 7 },
  '30d': { bucket: 'day', count: 30 },
  '12w': { bucket: 'week', count: 12 },
  '1y': { bucket: 'week', count: 52 },
};

/** Every bucket of a window, oldest first, ending with the one that holds `now` in `timeZone`. */
export function projectOverviewWindowBuckets(window: ProjectOverviewWindow, now: number, timeZone = 'UTC'): { bucket: ProjectOverviewBucketKind; starts: string[] } {
  const { bucket, count } = windowShapes[window];
  const step = bucket === 'day' ? 1 : 7;
  const last = projectOverviewBucketOf(now, bucket, timeZone);
  return { bucket, starts: Array.from({ length: count }, (_, index) => shiftDay(last, -step * (count - 1 - index))) };
}

/** The start of the bucket an instant falls in. Weeks start on Monday. */
export function projectOverviewBucketOf(at: number, bucket: ProjectOverviewBucketKind, timeZone = 'UTC'): string {
  const day = dayOf(at, timeZone);
  return bucket === 'day' ? day : mondayOf(day);
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

const maintenanceBranch = /^(?:fix|hotfix|bugfix)\//u;
const maxChapters = 6;

function branchTopic(branch: string): string {
  const words = branch.slice(branch.indexOf('/') + 1).replace(/-[0-9a-f]{6,}$/u, '').split(/[-_/]+/u).filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Names stretches of the window after the feature branches merged in them. Spans are equal and
 * fixed so the same history always reads the same; a span that merged nothing has no chapter.
 */
export function projectOverviewChapters(buckets: readonly Pick<ProjectOverviewBucket, 'start' | 'mergedBranches'>[]): ProjectOverviewChapter[] {
  const span = Math.max(1, Math.ceil(buckets.length / maxChapters));
  const chapters: ProjectOverviewChapter[] = [];
  for (let index = 0; index < buckets.length; index += span) {
    const members = buckets.slice(index, index + span);
    const branches = [...new Set(members.flatMap(bucket => bucket.mergedBranches))].filter(branch => !maintenanceBranch.test(branch));
    if (!branches.length) continue;
    const named = branches.slice(0, 2).map(branchTopic).join(', ');
    chapters.push({ start: members[0]!.start, buckets: members.length, title: branches.length > 2 ? `${named} +${branches.length - 2}` : named, branches });
  }
  return chapters;
}

export type ProjectOverviewRiskInput = {
  behind: number;
  changedFiles: number;
  overlapFiles: number;
  overlapBranches: number;
  baseCommitsPerDay: number | null;
  latestPipeline: ProjectOverviewPipelineStatus | null;
};

/** A deterministic, explainable level: every point scored is also a reason the reader is shown. */
export function projectOverviewIntegrationRisk(input: ProjectOverviewRiskInput): ProjectOverviewRisk {
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
  return { level: points >= 6 ? 'high' : points >= 3 ? 'medium' : 'low', gitOnly: input.latestPipeline === null, reasons };
}
