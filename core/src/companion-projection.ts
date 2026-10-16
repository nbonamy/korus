import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Agent, AgentWorkspaceIdentity, AppSnapshot, BackendDefaults, Team } from './contracts';
import type { CompanionWorkspace } from './companion-protocol';
import { enabledAgentBackends, providerConnectionsForTeam } from './agent-backends';
import { repositoryIconForAgent } from './workspace-sidebar';

const encoder = new TextEncoder();
/** Stable per path, reveals no directory names, and ends with the folder name so label fallbacks keep working. */
export function opaquePath(value: string): string {
  const name = value.replace(/\\/gu, '/').split('/').filter(Boolean).at(-1) ?? '';
  return `/${bytesToHex(sha256(encoder.encode(value))).slice(0, 16)}/${name}`;
}

/** The composer's last model and permission choice; never sandbox paths or approval policies. */
function projectDefaults(defaults: BackendDefaults): BackendDefaults {
  const { kind, model, reasoningEffort } = defaults;
  const serviceTier = defaults.kind !== 'antigravity' ? defaults.serviceTier : undefined;
  const approvalPreset = defaults.kind === 'codex' ? defaults.approvalPreset : undefined;
  const permissionMode = defaults.kind === 'codex' ? undefined : defaults.permissionMode;
  return { kind, ...(model === undefined ? {} : { model }), ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(serviceTier === undefined ? {} : { serviceTier }), ...(approvalPreset === undefined ? {} : { approvalPreset }),
    ...(permissionMode === undefined ? {} : { permissionMode }) } as BackendDefaults;
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
    const { id, teamId, name, avatar, backend, backendSession, status, statusText, createdAt, updatedAt, lastActivityAt, sessionKind, conversationTitle, backendDefaults, hasSubmittedPrompt } = agent;
    return { id, teamId, name, avatar, backend,
      backendSession: backendSession?.kind === 'claude' ? { kind: backendSession.kind, sessionId: backendSession.sessionId, transport: backendSession.transport } : backendSession,
      ...(agent.goal ? { goal: agent.goal } : {}),
      ...(agent.readState ? { readState: agent.readState } : {}),
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
      status, statusText, createdAt, updatedAt, sessionKind, conversationTitle, ...(hasSubmittedPrompt === undefined ? {} : { hasSubmittedPrompt }), workspace, folder: agent.folder ? opaquePath(agent.folder) : null,
      ...(backendDefaults ? { backendDefaults: projectDefaults(backendDefaults) } : {}) };
  });
  return { teams, agents, repositoryIcons, modelFavorites: source.modelFavorites ?? [], backends: source.backends ?? {}, agentRequests: Object.fromEntries(agents.map((agent) => [agent.id, source.agentRequests?.[agent.id] ?? []])),
    queuedPrompts: (source.queuedPrompts ?? []).filter(prompt => agents.some(agent => agent.id === prompt.agentId)).map(({ id, agentId, text }) => ({ id, agentId, text })) };
}

/** The laptop's workspace as the desktop sidebar lists it: mission-owned workers stay out of the agent list. */
export function companionWorkspaceOf(snapshot: Pick<AppSnapshot, 'teams' | 'agents' | 'general'> & Partial<Pick<AppSnapshot, 'missions' | 'providerConnections' | 'remoteConnections' | 'activeTeamId' | 'agentRequests' | 'queuedPrompts'>>): CompanionWorkspace {
  const workerIds = new Set((snapshot.missions ?? []).flatMap((mission) => mission.execution?.runs.flatMap((run) => run.workerId ? [run.workerId] : []) ?? []));
  return { queuedPrompts: snapshot.queuedPrompts?.map(({ id, agentId, text }) => ({ id, agentId, text })), agentRequests: snapshot.agentRequests ?? {}, teams: snapshot.teams, agents: snapshot.agents.filter((agent) => !workerIds.has(agent.id)), repositoryIcons: snapshot.general.repositoryIcons, modelFavorites: snapshot.general.modelFavorites,
    backends: Object.fromEntries(snapshot.teams.map((team) => [team.id, enabledAgentBackends({ providerConnections: providerConnectionsForTeam({ ...snapshot, remoteConnections: snapshot.remoteConnections ?? { connections: [] } } as AppSnapshot, team.id) })])) };
}
