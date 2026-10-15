import type { BackendSession } from './contracts/backend';

export type CodeReviewPriority = 'p0' | 'p1' | 'p2' | 'p3';

export type CodeReviewScope =
  | { type: 'uncommitted' }
  | { type: 'branch'; baseRef: string };

export type CodeReviewThreadMode = 'current' | 'independent';

export type CodeReviewStartInput = {
  instructions?: string;
  backend?: 'codex' | 'claude' | 'antigravity';
  model?: string;
  reasoningEffort?: string;
  automation?: CodeReviewAutomationSettings;
  scope: CodeReviewScope;
  threadMode: CodeReviewThreadMode;
};

export type CodeReviewAutomationSettings = {
  enabled: boolean;
  maxPriority: CodeReviewPriority;
  maxRounds: number;
  /** Local commits require explicit opt-in; omitted settings leave changes uncommitted. */
  autoCommit?: boolean;
};

export type CodeReviewPreferences = {
  backend: 'codex' | 'claude' | 'antigravity';
  automation: CodeReviewAutomationSettings;
  providers: Partial<Record<'codex' | 'claude' | 'antigravity', { model?: string; reasoningEffort?: string }>>;
};

export type CodeReviewAutomation = CodeReviewAutomationSettings & {
  state: 'running' | 'paused' | 'completed' | 'manual';
  baseRef?: string;
  head?: string;
  branch?: string;
  fingerprint?: string;
  commits: string[];
  reason?: string;
};

export type CodeReviewLocation = {
  file: string;
  line?: number;
  endLine?: number;
};

export type CodeReviewDiscussionMessage = {
  id: string;
  author: 'user' | 'reviewer';
  body: string;
  createdAt: string;
};

/** A user's arbitration choice. This is intentionally not presented as workflow status. */
export type CodeReviewDecision =
  | { state: 'undecided' }
  | { state: 'selected'; decidedAt: string }
  | { state: 'rejected'; decidedAt: string; reason?: string };

/** Remediation begins only after the user submits a fully arbitrated round. */
export type CodeReviewRemediation =
  | { state: 'notStarted' }
  | { state: 'skipped'; startedAt: string }
  | { state: 'pending'; queuedAt: string }
  | { state: 'fixing'; startedAt: string }
  | { state: 'fixed'; completedAt: string; evidence?: string };

export type CodeReviewFinding = {
  /** Stable across rounds when a finding is raised again. */
  id: string;
  roundId: string;
  priority: CodeReviewPriority;
  title: string;
  body: string;
  location?: CodeReviewLocation;
  decision: CodeReviewDecision;
  discussion: CodeReviewDiscussionMessage[];
  remediation: CodeReviewRemediation;
  createdAt: string;
  updatedAt: string;
};

export type CodeReviewRound = {
  id: string;
  number: number;
  status: 'reviewing' | 'ready' | 'submitted' | 'completed' | 'failed';
  /** Provider conversation used for review, clarification, and fixes in this round. */
  reviewerSession?: BackendSession;
  /** Provider's final inspection summary; full conversation remains provider-owned. */
  summary?: string;
  /** Explicit model acknowledgment of the current round's registered findings. */
  inspectionCompletion?: { findingCount: number; confirmedAt: string };
  findings: CodeReviewFinding[];
  startedAt: string;
  completedAt?: string;
  error?: string;
};

export type CodeReviewSession = {
  id: string;
  instructions?: string;
  /** Agent whose workspace and changes are being reviewed. */
  targetAgentId: string;
  /** Visible agent whose provider conversation performs the review. */
  reviewerAgentId: string;
  scope: CodeReviewScope;
  threadMode: CodeReviewThreadMode;
  status: 'reviewing' | 'ready' | 'fixing' | 'readyToFinish' | 'finished' | 'failed';
  activeRoundId: string;
  rounds: CodeReviewRound[];
  automation?: CodeReviewAutomation;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type CodeReviewFindingInput = Pick<
  CodeReviewFinding,
  'priority' | 'title' | 'body'
> & {
  location?: CodeReviewLocation;
  priorFindingId?: string;
};

export type CodeReviewFindingUpdateInput = {
  findingId: string;
  priority?: CodeReviewPriority;
  title?: string;
  body?: string;
  location?: CodeReviewLocation;
  status?: 'fixed';
  evidence?: string;
};

export type CodeReviewLedger = {
  exclusions: Array<{
    findingId: string;
    title: string;
    body: string;
    reason: string;
  }>;
  regressionChecks: Array<{
    findingId: string;
    title: string;
    body: string;
  }>;
  behaviorDecisions: Array<{
    findingId: string;
    title: string;
    discussion: CodeReviewDiscussionMessage[];
  }>;
};

export type CodeReviewProgress = {
  total: number;
  undecided: number;
  selected: number;
  rejected: number;
  skipped: number;
  pending: number;
  fixing: number;
  fixed: number;
};

export type CodeReviewFindingRef = {
  sessionId: string;
  roundId: string;
  findingId: string;
};

export type CodeReviewDecisionInput = CodeReviewFindingRef & (
  | { decision: 'select' }
  | { decision: 'reject'; reason?: string }
);

export type CodeReviewDiscussionInput = CodeReviewFindingRef & {
  question: string;
};

export function activeCodeReviewRound(session: CodeReviewSession): CodeReviewRound {
  const round = session.rounds.find((candidate) => candidate.id === session.activeRoundId);
  if (!round) throw new Error('Active review round is missing.');
  return round;
}

export function codeReviewLedger(session: CodeReviewSession): CodeReviewLedger {
  const findings = [...latestFindings(session).values()];
  return {
    exclusions: findings.flatMap((finding) => finding.decision.state === 'rejected'
      ? [{
          findingId: finding.id,
          title: finding.title,
          body: finding.body,
          reason: finding.decision.reason ?? 'Not selected for remediation.',
        }]
      : []),
    regressionChecks: findings.flatMap((finding) => finding.remediation.state === 'fixed'
      ? [{
          findingId: finding.id,
          title: finding.title,
          body: finding.body,
        }]
      : []),
    behaviorDecisions: findings
      .filter((finding) => finding.discussion.length > 0)
      .map((finding) => ({
        findingId: finding.id,
        title: finding.title,
        discussion: finding.discussion.map((message) => ({ ...message })),
      })),
  };
}

export function codeReviewProgress(session: CodeReviewSession): CodeReviewProgress {
  const findings = [...latestFindings(session).values()];
  return findings.reduce<CodeReviewProgress>((progress, finding) => {
    progress.total += 1;
    if (finding.decision.state === 'undecided') progress.undecided += 1;
    if (finding.decision.state === 'selected') progress.selected += 1;
    if (finding.decision.state === 'rejected') progress.rejected += 1;
    if (finding.remediation.state === 'skipped') progress.skipped += 1;
    if (finding.remediation.state === 'pending') progress.pending += 1;
    if (finding.remediation.state === 'fixing') progress.fixing += 1;
    if (finding.remediation.state === 'fixed') progress.fixed += 1;
    return progress;
  }, { total: 0, undecided: 0, selected: 0, rejected: 0, skipped: 0, pending: 0, fixing: 0, fixed: 0 });
}

export function cloneCodeReviewSession(session: CodeReviewSession): CodeReviewSession {
  return structuredClone(session) as CodeReviewSession;
}

export function isCodeReviewStartInput(value: unknown): value is CodeReviewStartInput {
  return isRecord(value) && isCodeReviewScope(value.scope) && isCodeReviewThreadMode(value.threadMode)
    && (value.instructions === undefined || typeof value.instructions === 'string')
    && (value.backend === undefined || value.backend === 'codex' || value.backend === 'claude' || value.backend === 'antigravity')
    && optionalSelection(value.model) && optionalSelection(value.reasoningEffort)
    && (value.threadMode === 'independent' || (value.model === undefined && value.reasoningEffort === undefined))
    && (value.automation === undefined || (isCodeReviewAutomationSettings(value.automation)
      && (!value.automation.enabled || value.threadMode === 'independent')));
}

export function isCodeReviewAutomationSettings(value: unknown): value is CodeReviewAutomationSettings {
  return isRecord(value) && typeof value.enabled === 'boolean' && isPriority(value.maxPriority)
    && (value.autoCommit === undefined || typeof value.autoCommit === 'boolean')
    && Number.isInteger(value.maxRounds) && Number(value.maxRounds) >= 1 && Number(value.maxRounds) <= 10;
}

export function isCodeReviewPreferences(value: unknown): value is CodeReviewPreferences {
  return isRecord(value) && (value.backend === 'codex' || value.backend === 'claude' || value.backend === 'antigravity')
    && isCodeReviewAutomationSettings(value.automation) && isRecord(value.providers)
    && Object.entries(value.providers).every(([backend, selection]) => (backend === 'codex' || backend === 'claude' || backend === 'antigravity')
      && isRecord(selection) && optionalSelection(selection.model) && optionalSelection(selection.reasoningEffort));
}

function optionalSelection(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.trim().length > 0 && value.length <= 200);
}

export function isCodeReviewDecisionInput(value: unknown): value is CodeReviewDecisionInput {
  if (!isCodeReviewFindingRef(value)) return false;
  if (value.decision === 'select') return true;
  return value.decision === 'reject'
    && (value.reason === undefined || typeof value.reason === 'string');
}

export function isCodeReviewDiscussionInput(value: unknown): value is CodeReviewDiscussionInput {
  return isCodeReviewFindingRef(value)
    && typeof value.question === 'string'
    && value.question.trim().length > 0;
}

export function isCodeReviewSession(value: unknown): value is CodeReviewSession {
  if (!isRecord(value) || typeof value.id !== 'string') return false;
  if (value.instructions !== undefined && typeof value.instructions !== 'string') return false;
  if (typeof value.targetAgentId !== 'string' || typeof value.reviewerAgentId !== 'string') return false;
  if (!isCodeReviewScope(value.scope) || !isCodeReviewThreadMode(value.threadMode)) return false;
  if (!isReviewSessionStatus(value.status) || typeof value.activeRoundId !== 'string') return false;
  if (!Array.isArray(value.rounds) || value.rounds.length === 0 || value.rounds.some((round) => !isCodeReviewRound(round))) return false;
  if (value.automation !== undefined) {
    const auto = value.automation;
    if (!isRecord(auto)
      || !['running', 'paused', 'completed', 'manual'].includes(String(auto.state))
      || !Array.isArray(auto.commits) || !auto.commits.every(commit => typeof commit === 'string')
      || !optionalSelection(auto.baseRef) || !optionalSelection(auto.head) || !optionalSelection(auto.fingerprint)
      || !optionalSelection(auto.branch)
      || (auto.reason !== undefined && typeof auto.reason !== 'string') || !isCodeReviewAutomationSettings(auto)) return false;
  }
  return typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}

function isCodeReviewScope(value: unknown): value is CodeReviewScope {
  if (!isRecord(value)) return false;
  if (value.type === 'uncommitted') return true;
  return value.type === 'branch' && typeof value.baseRef === 'string' && value.baseRef.trim().length > 0;
}

function isCodeReviewFindingRef(value: unknown): value is CodeReviewFindingRef & Record<string, unknown> {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && value.sessionId.trim().length > 0
    && typeof value.roundId === 'string'
    && value.roundId.trim().length > 0
    && typeof value.findingId === 'string'
    && value.findingId.trim().length > 0;
}

function isCodeReviewThreadMode(value: unknown): value is CodeReviewThreadMode {
  return value === 'current' || value === 'independent';
}

function latestFindings(session: CodeReviewSession): Map<string, CodeReviewFinding> {
  const latestByFindingId = new Map<string, CodeReviewFinding>();
  for (const round of session.rounds) {
    for (const finding of round.findings) latestByFindingId.set(finding.id, finding);
  }
  return latestByFindingId;
}

function isCodeReviewRound(value: unknown): value is CodeReviewRound {
  return isRecord(value)
    && typeof value.id === 'string'
    && Number.isInteger(value.number)
    && (value.reviewerSession === undefined || isBackendSession(value.reviewerSession))
    && (value.summary === undefined || typeof value.summary === 'string')
    && (value.inspectionCompletion === undefined || (isRecord(value.inspectionCompletion)
      && Number.isSafeInteger(value.inspectionCompletion.findingCount)
      && Number(value.inspectionCompletion.findingCount) >= 0
      && typeof value.inspectionCompletion.confirmedAt === 'string'))
    && isReviewRoundStatus(value.status)
    && Array.isArray(value.findings)
    && value.findings.every(isCodeReviewFinding)
    && typeof value.startedAt === 'string';
}

function isBackendSession(value: unknown): value is BackendSession {
  if (!isRecord(value)) return false;
  if (value.kind === 'antigravity') return typeof value.sessionId === 'string';
  if (value.kind === 'codex') return typeof value.threadId === 'string';
  return value.kind === 'claude'
    && typeof value.sessionId === 'string'
    && (value.transport === 'stdio' || value.transport === 'websocket');
}

function isCodeReviewFinding(value: unknown): value is CodeReviewFinding {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.roundId === 'string'
    && isPriority(value.priority)
    && typeof value.title === 'string'
    && typeof value.body === 'string'
    && isDecision(value.decision)
    && Array.isArray(value.discussion)
    && value.discussion.every(isDiscussionMessage)
    && isRemediation(value.remediation)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function isDecision(value: unknown): value is CodeReviewDecision {
  if (!isRecord(value)) return false;
  if (value.state === 'undecided') return true;
  if (value.state === 'selected') return typeof value.decidedAt === 'string';
  return value.state === 'rejected'
    && typeof value.decidedAt === 'string'
    && (value.reason === undefined || typeof value.reason === 'string');
}

function isRemediation(value: unknown): value is CodeReviewRemediation {
  if (!isRecord(value) || typeof value.state !== 'string') return false;
  if (value.state === 'notStarted') return true;
  if (value.state === 'skipped') return typeof value.startedAt === 'string';
  if (value.state === 'pending') return typeof value.queuedAt === 'string';
  if (value.state === 'fixing') return typeof value.startedAt === 'string';
  return value.state === 'fixed'
    && typeof value.completedAt === 'string'
    && (value.evidence === undefined || typeof value.evidence === 'string');
}

function isDiscussionMessage(value: unknown): value is CodeReviewDiscussionMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.author === 'user' || value.author === 'reviewer')
    && typeof value.body === 'string'
    && typeof value.createdAt === 'string';
}

function isPriority(value: unknown): value is CodeReviewPriority {
  return value === 'p0' || value === 'p1' || value === 'p2' || value === 'p3';
}

function isReviewSessionStatus(value: unknown): value is CodeReviewSession['status'] {
  return value === 'reviewing' || value === 'ready' || value === 'fixing' || value === 'readyToFinish'
    || value === 'finished' || value === 'failed';
}

function isReviewRoundStatus(value: unknown): value is CodeReviewRound['status'] {
  return value === 'reviewing' || value === 'ready' || value === 'submitted'
    || value === 'completed' || value === 'failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
