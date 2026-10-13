import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Agent, AgentWorkspaceIdentity, AppSnapshot, Team } from './contracts';
import type { CompanionWorkspace } from './companion-protocol';
import { repositoryIconForAgent } from './workspace-sidebar';

const encoder = new TextEncoder();
/** Stable per path, reveals no directory names, and ends with the folder name so label fallbacks keep working. */
function opaquePath(value: string): string {
  const name = value.replace(/\\/gu, '/').split('/').filter(Boolean).at(-1) ?? '';
  return `/${bytesToHex(sha256(encoder.encode(value))).slice(0, 16)}/${name}`;
}

function projectWorkspace(workspace: AgentWorkspaceIdentity): AgentWorkspaceIdentity {
  if (workspace.kind === 'folder') return { kind: 'folder', folder: opaquePath(workspace.folder), label: workspace.label, updatedAt: workspace.updatedAt };
  const { repositoryName, branch, defaultBranch, isLinkedWorktree, updatedAt } = workspace;
  return { kind: 'git', folder: opaquePath(workspace.folder), repositoryName, repositoryRoot: opaquePath(workspace.repositoryRoot),
    primaryWorktreeRoot: opaquePath(workspace.primaryWorktreeRoot), branch, ...(defaultBranch === undefined ? {} : { defaultBranch }), isLinkedWorktree, updatedAt };
}

/**
 * What a paired phone sees of the laptop: enough to rebuild the desktop sidebar (repositories,
 * branch and conversation titles, repository icons) without paths, remotes or provider internals.
 */
export function projectCompanionWorkspace(source: CompanionWorkspace & { repositoryIcons?: Readonly<Record<string, string>> }): Required<CompanionWorkspace> {
  const teams = source.teams.map(({ id, name, avatar, agentIds, remoteConnectionId }): Team => ({ id, name, avatar, agentIds, remoteConnectionId }));
  const repositoryIcons: Record<string, string> = {};
  const agents = source.agents.filter((agent) => teams.some((team) => team.id === agent.teamId)).map((agent): Agent => {
    const workspace = agent.workspace ? projectWorkspace(agent.workspace) : undefined;
    const icon = agent.sessionKind === 'quickChat' ? undefined : repositoryIconForAgent(agent, source.repositoryIcons ?? {});
    if (icon && workspace?.kind === 'git') repositoryIcons[workspace.primaryWorktreeRoot] = icon;
    const { id, teamId, name, avatar, backend, backendSession, status, statusText, createdAt, updatedAt, sessionKind, conversationTitle } = agent;
    return { id, teamId, name, avatar, backend,
      backendSession: backendSession?.kind === 'claude' ? { kind: backendSession.kind, sessionId: backendSession.sessionId, transport: backendSession.transport } : backendSession,
      status, statusText, createdAt, updatedAt, sessionKind, conversationTitle, workspace, folder: agent.folder ? opaquePath(agent.folder) : null };
  });
  return { teams, agents, repositoryIcons };
}

/** The laptop's workspace as the desktop sidebar lists it: mission-owned workers stay out of the agent list. */
export function companionWorkspaceOf(snapshot: Pick<AppSnapshot, 'teams' | 'agents' | 'general'> & { missions?: AppSnapshot['missions'] }): CompanionWorkspace {
  const workerIds = new Set((snapshot.missions ?? []).flatMap((mission) => mission.execution?.runs.flatMap((run) => run.workerId ? [run.workerId] : []) ?? []));
  return { teams: snapshot.teams, agents: snapshot.agents.filter((agent) => !workerIds.has(agent.id)), repositoryIcons: snapshot.general.repositoryIcons };
}
