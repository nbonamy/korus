import type { AgentGitPullRequest } from './git';

export type GitPruneTarget = {
  id: string;
  revision: string;
  kind: 'local' | 'remote';
  name: string;
  branch: string;
  sha: string;
  merged: boolean;
  commitsAhead?: number;
  worktree?: string;
  worktreeLabel?: string;
  worktreeMissing?: boolean;
  /** Discard warnings; unavailable means the backend cannot validate deletion. */
  blocked?: 'inUse' | 'changes' | 'locked' | 'unavailable' | 'notMerged';
  usedBy: string[];
  /** Uncommitted entries, excluding ignored files and node_modules. */
  changedFiles: number;
  /** Explicit uncommitted count; absent in inventories with combined file counts. */
  uncommittedFiles?: number;
  pullRequest?: AgentGitPullRequest;
};

export type GitPruneInventory = {
  repository: string;
  baseBranch: string;
  groups: { branch: string; local?: GitPruneTarget; remotes: GitPruneTarget[] }[];
  unavailableRemotes: string[];
};

export type GitPruneInput = {
  confirmed: boolean;
  /** Explicit confirmation to discard unmerged work, local files, locks or agent-used worktrees. */
  force?: boolean;
  targets: { id: string; revision: string }[];
};

export type GitPruneResult = {
  deleted: string[];
  failed: { id: string; message: string }[];
};
