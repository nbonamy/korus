import type { Agent, AppSnapshot } from './contracts';

export type FeatureGroupRequest = { teamId: string; branch: string } & (
  | { type: 'rename'; label: string }
  | { type: 'reorder'; beforeBranch: string | null }
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
/** The agents of a feature: the team's agents working on that Git branch, as the worktree sidebar groups them. */
export function featureAgentIds(agents: readonly Agent[], teamId: string | null | undefined, branch: string): string[] {
  return agents
    .filter(agent => agent.teamId === teamId && agent.sessionKind !== 'quickChat' && agent.workspace?.kind === 'git' && agent.workspace.branch === branch)
    .map(agent => agent.id);
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
  if (trimmed.length > 120) throw new Error('Feature labels must be at most 120 characters.');
  if (trimmed) team.featureLabels = { ...team.featureLabels, [branch]: trimmed };
  else {
    const { [branch]: _label, ...labels } = team.featureLabels ?? {};
    team.featureLabels = labels;
  }
}
/** Branches in the team's saved order; the ones it does not list follow as they come. */
export function orderFeatureBranches(branches: readonly string[], order: readonly string[] | undefined): string[] {
  const listed = (order ?? []).filter(branch => branches.includes(branch));
  return [...new Set([...listed, ...branches])];
}
/** Moves a feature before another one, or to the end; the default branch is never part of the order. */
export function reorderFeature(snapshot: AppSnapshot, teamId: string, branch: string, beforeBranch: string | null): void {
  const team = snapshot.teams.find(team => team.id === teamId);
  if (!team) throw new Error('Team not found.');
  const agents = team.agentIds.flatMap(id => snapshot.agents.find(agent => agent.id === id) ?? []);
  const branches = agents.flatMap(agent => agent.sessionKind !== 'quickChat' && agent.workspace?.kind === 'git' && agent.workspace.branch && !isDefaultFeatureBranch(agent.workspace.branch, agents) ? [agent.workspace.branch] : []);
  const features = orderFeatureBranches([...new Set(branches)], team.featureOrder);
  if (!features.includes(branch) || (beforeBranch !== null && !features.includes(beforeBranch))) throw new Error('Feature not found.');
  if (beforeBranch === branch) return;
  const rest = features.filter(feature => feature !== branch);
  rest.splice(beforeBranch === null ? rest.length : rest.indexOf(beforeBranch), 0, branch);
  team.featureOrder = rest;
}
