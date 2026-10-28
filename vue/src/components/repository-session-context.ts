import type { AppSnapshot, AutomationLocation } from '@workspace/core/contracts';

export type RepositorySessionSource = {
  agentId?: string;
  teamId?: string;
  /** Machine the repository path lives on; the source agent's when omitted. */
  remoteConnectionId?: string;
  workSource?: import('@workspace/core/contracts').WorkSource;
  repositoryName: string;
  repositoryRoot: string;
};

export type RepositorySessionContext = {
  teamId: string | undefined;
  remoteConnectionId: string | undefined;
  location: AutomationLocation | undefined;
};

export function resolveRepositorySessionContext(
  snapshot: Pick<AppSnapshot, 'activeTeamId' | 'agents' | 'teams'>,
  source: Pick<RepositorySessionSource, 'agentId' | 'teamId' | 'remoteConnectionId'> | null | undefined,
  activeTeamId?: string | null,
): RepositorySessionContext {
  const sourceAgent = source?.agentId
    ? snapshot.agents.find((agent) => agent.id === source.agentId)
    : undefined;
  const teamId = source?.teamId ?? sourceAgent?.teamId ?? activeTeamId ?? snapshot.activeTeamId ?? undefined;
  const remoteConnectionId = (source?.remoteConnectionId ?? sourceAgent?.remoteConnectionId)?.trim() || undefined;
  return {
    teamId,
    remoteConnectionId,
    location: remoteConnectionId ? { kind: 'remote', remoteConnectionId } : undefined,
  };
}
