export type AgentWorkspaceIdentity =
  | {
      kind: 'git';
      folder: string;
      repositoryName: string;
      repositoryRoot: string;
      branch: string | null;
      defaultBranch?: string | null;
      isLinkedWorktree: boolean;
      primaryWorktreeRoot: string;
      originUrl?: string;
      updatedAt: string;
    }
  | {
      kind: 'folder';
      folder: string;
      label: string;
      updatedAt: string;
    };

export type AgentFileSearchItem = {
  name: string;
  path: string;
};

export type AgentDirectoryInput = { path?: string; cursor?: number; query?: string };
export type AgentDirectoryEntry = AgentFileSearchItem & { kind: 'folder' | 'file' };
export type AgentDirectoryPage = { entries: AgentDirectoryEntry[]; nextCursor: number | null };

export type AgentFilePreviewResult = {
  path: string;
  size: number;
  kind: 'text' | 'image' | 'binary' | 'tooLarge';
  content?: string;
  dataUrl?: string;
  mimeType?: string;
};

export type AgentFileChunk = {
  path: string;
  size: number;
  data: string;
  nextOffset: number;
};

export type SourceWorktree = {
  name: string;
  path: string;
};

export type SourceBranch = {
  name: string;
  isDefault: boolean;
  worktreePath?: string;
};

export type SourceRepository = {
  name: string;
  path: string;
  remoteIdentity?: string;
  worktrees: SourceWorktree[];
};

export type RepositoryDeletionPreview = {
  repositoryPath: string;
  confirmationName: string;
  paths: string[];
  agents: Array<{ id: string; name: string }>;
  fingerprint: string;
};
export type DeleteRepositoryInput = { confirmation: string; fingerprint: string };

export type CloneSourceRepositoryInput = {
  url: string;
  remoteConnectionId?: string;
  /** Acquire a configured checkout of the same remote instead of cloning another copy. */
  reuseExisting?: boolean;
};

export type CreateSourceRepositoryInput = {
  name: string;
  remoteConnectionId?: string;
};

export type CreateProjectInput = {
  name: string;
  backend?: import('./shared').AgentBackend;
  teamId?: string;
};

export type SourceFolderEntry = {
  name: string;
  path: string;
};

export type SourceFolderListing = {
  path: string;
  parentPath: string | null;
  entries: SourceFolderEntry[];
};

export type SourceFolderListInput = {
  path?: string;
  remoteConnectionId?: string;
};

export type SourceFolderState = {
  path: string;
  initialized: boolean;
  recentRepoNames: string[];
};

export type CreateSourceWorktreeInput = {
  repoPath: string;
  branchName: string;
  baseBranch?: string;
  destinationPath?: string;
  reuseExisting?: boolean;
  /** Refuse to reuse an existing branch when creating a new worktree. */
  requireNewBranch?: boolean;
  /** Refresh the remote branch, or the base when creating a new branch. */
  fetchRemoteBranch?: boolean;
  remoteConnectionId?: string;
};
