import type { AgentGitFile } from './contracts';

/** Selection is by whole path, including both its staged and unstaged changes. */
export type BranchWorkPreview = { folder: string; head: string; snapshotId: string; files: Array<AgentGitFile & { sensitive: boolean }>; recoveries?: Array<{ input: BranchWorkInput; result: BranchWorkResult }> };
export type BranchWorkInput = {
  confirmed: true;
  requestId: string;
  snapshotId: string;
  branchName: string;
  paths: string[];
  message: string;
  prompt: string;
};
export type BranchWorkResult = {
  state: 'completed' | 'recovery';
  branchName: string;
  folder: string;
  commit?: string;
  sourceBackupFolder?: string;
  taskId?: string;
  agentId?: string;
  retainedPaths: string[];
  detail?: string;
};
