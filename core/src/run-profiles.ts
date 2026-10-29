/** User-authored commands, stored privately on the repository's owning host. */
export type RunProfile = {
  id: string;
  name: string;
  command: string;
  directory: string;
  previewUrl?: string;
};

export type RunProfileInput = Omit<RunProfile, 'id'> & { id?: string };
/** Import candidates contain invocation names, never script bodies or environment values. */
export type RunProfileAction = Omit<RunProfileInput, 'id' | 'previewUrl'> & { source: string };
export type RunProfileDiscovery = { actions: RunProfileAction[]; warnings: string[] };
export type ProfileRun = {
  id: string;
  agentId: string;
  profileId: string;
  command: string;
  cwd: string;
  state: 'running' | 'completed' | 'failed' | 'stopped';
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  output: string;
  outputTruncated: boolean;
};

export type RunProfileCatalog = {
  repository: string;
  worktree: string;
  profiles: RunProfile[];
  targets: Record<string, { cwd?: string; error?: string }>;
  runs: ProfileRun[];
};

/** The displayed command and absolute target must still match at admission. */
export type RunProfileStartInput = { profileId: string; command: string; cwd: string };
