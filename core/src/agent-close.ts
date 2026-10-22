export type AgentClosePreview = {
  isLinkedWorktree: boolean;
  branch: string | null;
  upstream: string | null;
  hasChanges: boolean;
};
