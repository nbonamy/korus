import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Agent, AgentWorkspaceIdentity, AppSnapshot, BackendDefaults, Team } from './contracts';
import type { CompanionGitStatus, CompanionWorkspace } from './companion-protocol';
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
export function projectCompanionWorkspace(source: CompanionWorkspace & { repositoryIcons?: Readonly<Record<string, string>> }): Required<Omit<CompanionWorkspace, 'gitStatuses' | 'conversationSync'>> & Pick<CompanionWorkspace, 'gitStatuses' | 'conversationSync'> {
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
  return { ...(source.gitStatuses ? { gitStatuses: Object.fromEntries(agents.flatMap(agent => source.gitStatuses?.[agent.id] ? [[agent.id, projectGitStatus(source.gitStatuses[agent.id]!)]] : [])) } : {}), teams, agents, repositoryIcons, modelFavorites: source.modelFavorites ?? [], backends: source.backends ?? {}, agentRequests: Object.fromEntries(agents.map((agent) => [agent.id, source.agentRequests?.[agent.id] ?? []])),
    queuedPrompts: (source.queuedPrompts ?? []).filter(prompt => agents.some(agent => agent.id === prompt.agentId)).map(({ id, agentId, text }) => ({ id, agentId, text })) };
}

/** The laptop's workspace as the desktop sidebar lists it: mission-owned workers stay out of the agent list. */
export function companionWorkspaceOf(snapshot: Pick<AppSnapshot, 'teams' | 'agents' | 'general'> & Partial<Pick<AppSnapshot, 'missions' | 'providerConnections' | 'remoteConnections' | 'activeTeamId' | 'agentRequests' | 'queuedPrompts' | 'agentGitStatuses' | 'turnGitDiffs'>>): CompanionWorkspace {
  const workerIds = new Set((snapshot.missions ?? []).flatMap((mission) => mission.execution?.runs.flatMap((run) => run.workerId ? [run.workerId] : []) ?? []));
  const gitStatuses = snapshot.agentGitStatuses && Object.fromEntries(Object.entries(snapshot.agentGitStatuses).map(([id, status]) => {
    const turn = Object.values(snapshot.turnGitDiffs ?? {}).filter(turn => turn.agentId === id && Boolean(turn.diff))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    return [id, projectGitStatus({ ...status, ...(turn ? { lastTurn: turn } : {}) })];
  }));
  return { ...(gitStatuses ? { gitStatuses } : {}), queuedPrompts: snapshot.queuedPrompts?.map(({ id, agentId, text }) => ({ id, agentId, text })), agentRequests: snapshot.agentRequests ?? {}, teams: snapshot.teams, agents: snapshot.agents.filter((agent) => !workerIds.has(agent.id)), repositoryIcons: snapshot.general.repositoryIcons, modelFavorites: snapshot.general.modelFavorites,
    backends: Object.fromEntries(snapshot.teams.map((team) => [team.id, enabledAgentBackends({ providerConnections: providerConnectionsForTeam({ ...snapshot, remoteConnections: snapshot.remoteConnections ?? { connections: [] } } as AppSnapshot, team.id) })])) };
}

/** Git presentation metadata only; patches are fetched through a separate scoped read. */
function projectGitStatus(status: CompanionGitStatus): CompanionGitStatus {
  const summary = (value: { changedFiles: number; addedLines: number; removedLines: number }) => ({ changedFiles: value.changedFiles, addedLines: value.addedLines, removedLines: value.removedLines });
  const catalog = status.diffCatalog;
  return { ...(status.branch === undefined ? {} : { branch: status.branch }), state: status.state, ...summary(status),
    ...(catalog ? { diffCatalog: { defaultTarget: catalog.defaultTarget,
      uncommitted: summary(catalog.uncommitted), staged: summary(catalog.staged), unstaged: summary(catalog.unstaged),
      ...(catalog.branch ? { branch: { ...summary(catalog.branch), baseRef: catalog.branch.baseRef } } : {}),
      commits: catalog.commits.map(commit => ({ ...summary(commit), sha: commit.sha, shortSha: commit.shortSha, subject: commit.subject })),
    } } : {}),
    ...(status.lastTurn ? { lastTurn: { turnId: status.lastTurn.turnId, addedLines: status.lastTurn.addedLines, removedLines: status.lastTurn.removedLines } } : {}),
  };
}
