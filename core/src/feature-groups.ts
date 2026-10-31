import type { Agent, AppSnapshot } from './contracts';

export type FeatureGroupRequest = { teamId: string; branch: string } & (
  | { type: 'rename'; label: string }
  | { type: 'preview-delete' }
  | { type: 'delete'; fingerprint: string; confirmed: true }
);
export type FeatureWorktree = { path: string; repositoryName: string; branch: string; changedFiles: number; remoteConnectionId?: string };
export type FeatureGroupPreview = { teamId: string; branch: string; label: string; fingerprint: string; agentIds: string[]; worktrees: FeatureWorktree[] };
export type FeatureGroupResult = { kind: 'updated'; snapshot: AppSnapshot } | { kind: 'preview'; preview: FeatureGroupPreview };
/** Agent-scoped operations are routed to the filesystem owner; unsupported old hosts fail before cleanup. */
export type FeatureAgentRequest = { agentId: string; branch: string } & (
  | { type: 'inspect-agent' }
  | { type: 'cleanup-agent'; deleteWorktree: boolean; confirmed: true }
);
export function isDefaultFeatureBranch(branch: string, agents: readonly Agent[]): boolean {
  return branch === 'main' || branch === 'master' || agents.some(agent => agent.workspace?.kind === 'git' && agent.workspace.defaultBranch === branch);
}
export function featureLabel(labels: Readonly<Record<string, string>> | undefined, branch: string): string {
  const value = labels?.[branch];
  return typeof value === 'string' && value.trim() ? value : branch;
}
export function setFeatureLabel(snapshot: AppSnapshot, teamId: string, branch: string, label: string): void {
  const team = snapshot.teams.find(team => team.id === teamId);
  if (!team) throw new Error('Team not found.');
  if (!branch.trim() || branch !== branch.trim() || isDefaultFeatureBranch(branch, snapshot.agents.filter(agent => agent.teamId === teamId))) throw new Error('Default branch groups cannot be renamed or deleted.');
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 120) throw new Error('Feature labels must contain 1–120 characters.');
  team.featureLabels = { ...team.featureLabels, [branch]: trimmed };
}
