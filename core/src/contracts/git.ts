export type AgentGitStatus = {
  folder: string;
  repository?: string;
  githubRepository?: string;
  repositoryProvider?: 'github' | 'gitlab';
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changedFiles: number;
  addedLines: number;
  removedLines: number;
  hasUntracked: boolean;
  state: 'clean' | 'dirty' | 'unknown';
  diffCatalog?: AgentGitDiffCatalog;
  updatedAt: string;
  error?: string;
};

export type AgentGitDiffTarget =
  | { type: 'branch'; baseRef?: string }
  | { type: 'uncommitted' }
  | { type: 'unstaged' }
  | { type: 'staged' }
  | { type: 'commit'; sha: string }
  | { type: 'turn'; turnId: string };

export type AgentGitDiffSummary = {
  addedLines: number;
  removedLines: number;
  changedFiles: number;
  /** The same totals split by what each file is for (code, tests, docs, other). */
  byKind?: import('../file-kind').KindBreakdown;
};

export type AgentGitCommitSummary = AgentGitDiffSummary & {
  sha: string;
  shortSha: string;
  subject: string;
};

export type AgentGitDiffCatalog = {
  defaultTarget: Exclude<AgentGitDiffTarget, { type: 'commit' | 'turn' }>;
  branch?: AgentGitDiffSummary & { baseRef: string };
  uncommitted: AgentGitDiffSummary;
  unstaged: AgentGitDiffSummary;
  staged: AgentGitDiffSummary;
  commits: AgentGitCommitSummary[];
};

export type AgentGitDiffScope = 'staged' | 'unstaged' | 'untracked';

export type AgentGitDiffSection = {
  scope: AgentGitDiffScope;
  diff: string;
};

export type AgentGitDiff = {
  target: AgentGitDiffTarget;
  summary: AgentGitDiffSummary;
  diff: string;
  sections: AgentGitDiffSection[];
};

export type AgentGitFile = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
};

export type AgentGitPullRequest = {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  headSha: string;
  state: 'open' | 'merged' | 'closed';
  mergedAt?: string;
};

export type AgentPullRequestTracking = AgentGitPullRequest & {
  provider: 'github' | 'gitlab';
  repository: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentGitWorkflow = {
  headSha?: string;
  repository: string;
  folder: string;
  isLinkedWorktree: boolean;
  baseBranch?: string;
  baseUpdateRequired?: boolean;
  baseWorktreeDirty?: boolean;
  branch?: string;
  detached: boolean;
  remote?: string;
  remoteUrl?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  stagedAddedLines?: number;
  stagedRemovedLines?: number;
  unstagedAddedLines?: number;
  unstagedRemovedLines?: number;
  untrackedAddedLines?: number;
  untrackedRemovedLines?: number;
  files: AgentGitFile[];
  stagedFiles: string[];
  unstagedFiles: string[];
  existingPullRequest?: AgentGitPullRequest;
  repositoryProvider?: 'github' | 'gitlab';
  codeHostConnected?: boolean;
  codeHostError?: string;
  githubConnected: boolean;
  githubError?: string;
  warning?: {
    type: 'worktreeFolderRetained';
    folder: string;
  } | {
    type: 'branchRetained';
    branch: string;
    folder?: string;
  };
};

export type AgentGitStageInput = { paths: string[]; confirmed: boolean };

export type AgentGitCommitInput = { message: string; confirmed: boolean; includeUnstaged?: boolean; includeUntracked?: boolean };

export type AgentGitPushInput = { confirmed: boolean; target?: 'current' | 'mergeTarget'; closeAgentAfterPush?: boolean };

export type AgentGitBranchInput = { name: string; createWorktree?: boolean; pullRequestNumber?: number; requestRepository?: string; confirmed: boolean };

export type AgentCloseInput = { deleteWorktree: boolean; deleteRemoteBranch?: boolean; discardChanges?: boolean; pullRequestCleanup?: boolean; confirmed: boolean };

export type AgentGitPullRequestInput = { title: string; body: string; reportBack?: boolean; confirmed: boolean };

export type AgentGitMergeInput = { strategy: 'merge' | 'squash'; commitMessage?: string; deleteBranch: boolean; deleteWorktree: boolean; pushAfter?: boolean; reportBack?: boolean; reportBackAgentId?: string; confirmed: boolean };

export type AgentGitUpdateFromBaseInput = { confirmed: boolean; allowDirty?: boolean };

export type AgentGitPullInput = { confirmed: boolean; allowDirty?: boolean };
export type AgentGitRevertInput = { confirmed: boolean; includeUntracked: boolean };
export type AgentGitPullResult = {
  workflow: AgentGitWorkflow;
  upstream: string;
  branch: string;
  conflicts: string[];
};

export type AgentGitUpdateFromBaseResult = {
  workflow: AgentGitWorkflow;
  baseBranch: string;
  branch: string;
  conflicts: string[];
};

export type AgentGitMessageGenerationInput =
  | { kind: 'commit'; includeUnstaged: boolean; includeUntracked: boolean }
  | { kind: 'pullRequest' };

export type AgentGitMessageGenerationResult =
  | { kind: 'commit'; message: string }
  | { kind: 'pullRequest'; title: string; body: string };

export type TurnGitDiff = {
  agentId: string;
  turnId: string;
  addedLines: number;
  removedLines: number;
  diff?: string;
  updatedAt: string;
};

export type AgentGitOperationProgress = {
  operation: 'pullRequest' | 'merge';
  phase: 'handoff' | 'delivery';
};

/** A cursor is tied to one immutable HEAD and one literal message search. */
export type AgentGitLogInput = {
  search?: string;
  limit?: number;
  cursor?: { head: string; offset: number; search: string };
};
export type AgentGitLogCommit = {
  sha: string;
  subject: string;
  author: string;
  date: string;
};
export type AgentGitLogPage = {
  repository: string;
  branch: string | null;
  head: string | null;
  commits: AgentGitLogCommit[];
  nextCursor?: NonNullable<AgentGitLogInput['cursor']>;
};
export type AgentGitLogCommitInput = { head: string; sha: string };
export type AgentGitLogFile = {
  path: string;
  previousPath?: string;
  status: string;
  addedLines: number | null;
  removedLines: number | null;
  binary: boolean;
};
export type AgentGitLogDetails = AgentGitLogCommit & {
  message: string;
  files: AgentGitLogFile[];
  filesTruncated: boolean;
};
export type AgentGitLogFileInput = AgentGitLogCommitInput & { path: string };
export type AgentGitLogFileDiff = { diff: string };
