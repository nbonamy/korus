import type { Agent, AppSnapshot } from './contracts';

/** Conversations in another worktree still belong to the same owning-host repository. */
export function repositoryPeersForAgent(agent: Agent, snapshot: Pick<AppSnapshot, 'agents' | 'teams'>): Agent[] {
  const workspace = agent.workspace;
  if (agent.sessionKind === 'quickChat' || workspace?.kind !== 'git') return [];
  const host = (candidate: Agent) => snapshot.teams.find(team => team.id === candidate.teamId)?.remoteConnectionId;
  const sourceTeam = snapshot.teams.find(team => team.id === agent.teamId);
  const orderedIds = [
    ...(sourceTeam?.agentIds ?? []),
    ...snapshot.teams.filter(team => team !== sourceTeam).flatMap(team => team.agentIds),
  ];
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  return snapshot.agents.filter(candidate => candidate.id !== agent.id && candidate.sessionKind !== 'quickChat'
    && candidate.workspace?.kind === 'git' && candidate.workspace.primaryWorktreeRoot === workspace.primaryWorktreeRoot
    && host(candidate) === host(agent))
    .sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

export function agentFolder(agent: Pick<Agent, 'folder'>): string | undefined {
  return agent.folder?.trim() || undefined;
}

export function requireAgentFolder(agent: Pick<Agent, 'folder'>): string {
  const folder = agentFolder(agent);
  if (!folder) throw new Error('This session does not have a project workspace.');
  return folder;
}
