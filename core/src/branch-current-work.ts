export type BranchWorkPreview = { folder: string; head: string; snapshotId: string; recoveries?: Array<{ input: BranchWorkInput; result: BranchWorkResult }> };
export type BranchWorkInput = {
  confirmed: true;
  requestId: string;
  snapshotId: string;
  branchName: string;
};
export type BranchWorkResult = {
  state: 'completed' | 'recovery';
  branchName: string;
  folder: string;
  sourceBackupFolder?: string;
  agentId?: string;
  retainedPaths: string[];
  detail?: string;
};

export type BranchWorkProgress = {
  id: string;
  agentId: string;
  branchName: string;
  state: 'running' | 'success' | 'error';
  phase: 'creatingWorktree' | 'movingChanges' | 'creatingAgent' | 'resettingSource';
  error?: string;
};
