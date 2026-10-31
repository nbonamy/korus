import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Agent, AgentWorkspaceIdentity, AppSnapshot, BackendDefaults, Team } from './contracts';
import type { CompanionGitStatus, CompanionMission, CompanionMissionReview, CompanionMissionTicketState, CompanionReviewFinding, CompanionWorkspace } from './companion-protocol';
import type { Mission, MissionReviewFinding } from './mission-types';
import { missionStageReady } from './missions';
import { enabledAgentBackends, providerConnectionsForHost } from './agent-backends';
import { repositoryIconForAgent } from './workspace-sidebar';
import { missionLeadAgentId } from './mission-attention';
import { missionImplementationBusy } from './mission-execution';

const encoder = new TextEncoder();
/** Stable per host and path, with only the folder name retained for label fallbacks. */
export function opaquePath(value: string, remoteConnectionId?: string): string {
  const name = value.replace(/\\/gu, '/').split('/').filter(Boolean).at(-1) ?? '';
  const identity = remoteConnectionId ? JSON.stringify([remoteConnectionId, value]) : value;
  return `/${bytesToHex(sha256(encoder.encode(identity))).slice(0, 16)}/${name}`;
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

function projectWorkspace(workspace: AgentWorkspaceIdentity, remoteConnectionId?: string): AgentWorkspaceIdentity {
  if (workspace.kind === 'folder') return { kind: 'folder', folder: opaquePath(workspace.folder, remoteConnectionId), label: workspace.label, updatedAt: workspace.updatedAt };
  const { repositoryName, branch, defaultBranch, isLinkedWorktree, updatedAt } = workspace;
  return { kind: 'git', folder: opaquePath(workspace.folder, remoteConnectionId), repositoryName, repositoryRoot: opaquePath(workspace.repositoryRoot, remoteConnectionId),
    primaryWorktreeRoot: opaquePath(workspace.primaryWorktreeRoot, remoteConnectionId), branch, ...(defaultBranch === undefined ? {} : { defaultBranch }), isLinkedWorktree, updatedAt };
}

/**
 * What a paired phone sees of the laptop: enough to rebuild the desktop sidebar (repositories,
 * branch and conversation titles, repository icons) without paths, remotes or provider internals.
 */
export function projectCompanionWorkspace(source: CompanionWorkspace & { repositoryIcons?: Readonly<Record<string, string>> }): Required<Omit<CompanionWorkspace, 'gitStatuses' | 'conversationSync'>> & Pick<CompanionWorkspace, 'gitStatuses' | 'conversationSync'> {
  const teams = source.teams.map(({ id, name, avatar, agentIds }): Team => ({ id, name, avatar, agentIds }));
  const repositoryIcons: Record<string, string> = {};
  const projectAgent = (agent: Agent): Agent => {
    const workspace = agent.workspace ? projectWorkspace(agent.workspace, agent.remoteConnectionId) : undefined;
    const icon = agent.sessionKind === 'quickChat' ? undefined : repositoryIconForAgent(agent, source.repositoryIcons ?? {});
    if (icon && workspace?.kind === 'git') repositoryIcons[workspace.primaryWorktreeRoot] = icon;
    const { id, teamId, remoteConnectionId, name, avatar, backend, backendSession, status, statusText, createdAt, updatedAt, lastActivityAt, sessionKind, conversationTitle, backendDefaults, hasSubmittedPrompt } = agent;
    return { id, teamId, ...(remoteConnectionId ? { remoteConnectionId } : {}), name, avatar, backend,
      backendSession: backendSession?.kind === 'claude' ? { kind: backendSession.kind, sessionId: backendSession.sessionId, transport: backendSession.transport } : backendSession,
      ...(agent.suggestedPrompt ? { suggestedPrompt: agent.suggestedPrompt } : {}),
      ...(agent.goal ? { goal: agent.goal } : {}),
      ...(agent.readState ? { readState: agent.readState } : {}),
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
      status, statusText, createdAt, updatedAt, sessionKind, conversationTitle, ...(hasSubmittedPrompt === undefined ? {} : { hasSubmittedPrompt }), workspace, folder: agent.folder ? opaquePath(agent.folder, remoteConnectionId) : null,
      ...(backendDefaults ? { backendDefaults: projectDefaults(backendDefaults) } : {}) };
  };
  const inTeams = (agent: Agent) => teams.some((team) => team.id === agent.teamId);
  const agents = source.agents.filter(inTeams).map(projectAgent);
  const missionAgents = (source.missionAgents ?? []).filter(inTeams).map(projectAgent);
  const missionProgress = (source.missionProgress ?? []).filter((mission) => teams.some((team) => team.id === mission.teamId));
  const reviewFindings = Object.fromEntries(agents.flatMap(agent => source.reviewFindings?.[agent.id] === undefined ? [] : [[agent.id, source.reviewFindings[agent.id]]]));
  return { ...(source.gitStatuses ? { gitStatuses: Object.fromEntries(agents.flatMap(agent => source.gitStatuses?.[agent.id] ? [[agent.id, projectGitStatus(source.gitStatuses[agent.id]!)]] : [])) } : {}), teams, agents, repositoryIcons, modelFavorites: source.modelFavorites ?? [], backends: source.backends ?? {}, agentRequests: Object.fromEntries([...agents, ...missionAgents].map((agent) => [agent.id, source.agentRequests?.[agent.id] ?? []])), missionProgress, missionAgents,
    reviewFindings, queuedPrompts: (source.queuedPrompts ?? []).filter(prompt => agents.some(agent => agent.id === prompt.agentId)).map(({ id, agentId, text }) => ({ id, agentId, text })) };
}

/** The laptop's workspace as the desktop sidebar lists it: mission-owned workers stay out of the agent list. */
const maxCompanionMissions = 20;
const maxMissionText = 500;

/** Mirrors the desktop's implementation board: accepted, else the latest run's status, else whether its blockers are done. */
function ticketState(mission: Mission, index: number): { state: CompanionMissionTicketState; workerId?: string; runId?: string } {
  const tickets = mission.artifacts?.tickets ?? [];
  const ticket = tickets[index]!;
  const run = (mission.execution?.runs ?? []).filter((candidate) => candidate.stage === 'implementation' && candidate.ticketIndex === index).at(-1);
  const workerId = run?.workerId ? { workerId: run.workerId } : {};
  if (ticket.done) return { state: 'accepted', ...workerId };
  if (run) return { state: run.status, ...workerId, ...(run.status === 'awaitingReview' ? { runId: run.id } : {}) };
  return { state: (ticket.dependsOn ?? []).every((blocker) => tickets[blocker]?.done) ? 'queued' : 'blocked' };
}

/** Implementation with every ticket done moves on to review; a reviewed mission is ready to ship. */
function missionNext(mission: Mission, agents: readonly Agent[]): 'review' | 'ship' | undefined {
  if (mission.status !== 'active') return undefined;
  // The workspace must reach the phone even if one saved mission is malformed.
  const ready = (stage: Mission['stage']) => { try { return missionStageReady(stage, mission.artifacts); } catch { return false; } };
  if (mission.stage === 'implementation' && ready('implementation') && !missionImplementationBusy(mission, agents)) return 'review';
  if (mission.stage === 'ship' || (mission.stage === 'review' && ready('review'))) return 'ship';
  return undefined;
}

const maxReviewFindings = 100;
const lastSegments = (value: string, count: number) => value.replace(/\\/gu, '/').split('/').filter(Boolean).slice(-count).join('/');
/** The review as the phone needs it: what was found, where, and what has happened to it, with no host paths. */
function missionReview(mission: Mission): CompanionMissionReview | undefined {
  const review = mission.artifacts?.review;
  const run = mission.execution?.runs.slice().reverse().find(candidate => candidate.stage === 'review');
  const ready = mission.status === 'active' && mission.stage === 'review' && run?.status === 'awaitingReview' && Boolean(run.proposal && run.workerId);
  const summary = (ready ? run?.proposal?.review.summary : undefined) ?? review?.summary ?? '';
  if (!review || (!summary.trim() && !review.findings?.length)) return undefined;
  const findings = (review.findings ?? []).slice(0, maxReviewFindings).map((finding: MissionReviewFinding): CompanionReviewFinding => {
    const file = finding.location?.file ? lastSegments(finding.location.file, 2) : '';
    return { id: finding.id, priority: finding.priority, title: finding.title.slice(0, maxMissionText), body: finding.body.slice(0, 4_000),
      repository: lastSegments(finding.repositoryPath, 1), ...(file ? { file } : {}),
      ...(finding.location?.line === undefined ? {} : { line: finding.location.line }), ...(finding.location?.endLine === undefined ? {} : { endLine: finding.location.endLine }),
      selected: finding.selected, state: finding.remediation.state };
  });
  return { summary: summary.slice(0, 4_000), findings, ready, ...(ready && run ? { runId: run.id } : {}) };
}

/** When the work began: the first implementation run, else when the mission was created. */
function missionStart(mission: Mission): string {
  const runs = (mission.execution?.runs ?? []).filter((run) => run.stage === 'implementation' && run.startedAt).map((run) => run.startedAt).sort();
  return runs[0] ?? mission.createdAt;
}

/** Active missions first, then the most recent: the phone shows what is moving and what just finished. */
function companionMissionsOf(source: { missions?: Mission[]; agents: Agent[] }): { missions: CompanionMission[]; workerIds: Set<string> } {
  // Ticket workers and the leads that are mission workers themselves: neither is in the agent list, both must be openable.
  const workerIds = new Set<string>();
  const ranked = [...(source.missions ?? [])].filter((mission) => mission.artifacts?.tickets)
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, maxCompanionMissions);
  const missions = ranked.map((mission): CompanionMission => ({ id: mission.id, teamId: mission.teamId, outcome: mission.outcome.slice(0, maxMissionText), stage: mission.stage,
    status: mission.status, startedAt: missionStart(mission), updatedAt: mission.updatedAt, ...(missionLeadAgentId(mission) ? { leadAgentId: missionLeadAgentId(mission)! } : {}), revision: mission.revision, ...(missionNext(mission, source.agents) ? { next: missionNext(mission, source.agents)! } : {}), ...(missionReview(mission) ? { review: missionReview(mission)! } : {}),
    tickets: mission.artifacts.tickets.map((ticket, index) => {
      const { state, workerId, runId } = ticketState(mission, index);
      if (workerId) workerIds.add(workerId);
      const after = state === 'blocked' ? (ticket.dependsOn ?? []).filter((blocker) => !mission.artifacts.tickets[blocker]?.done).map((blocker) => blocker + 1) : [];
      const repository = ticket.repositoryPath ? lastSegments(ticket.repositoryPath, 1) : undefined;
      return { number: index + 1, title: ticket.title.slice(0, maxMissionText), state, ...(repository ? { repository } : {}), ...(workerId ? { agentId: workerId } : {}), ...(after.length ? { after } : {}), ...(runId ? { runId } : {}) };
    }) }));
  for (const mission of missions) if (mission.leadAgentId) workerIds.add(mission.leadAgentId);
  return { missions, workerIds };
}

export function companionWorkspaceOf(snapshot: Pick<AppSnapshot, 'teams' | 'agents' | 'general'> & Partial<Pick<AppSnapshot, 'missions' | 'providerConnections' | 'remoteConnections' | 'activeTeamId' | 'agentRequests' | 'queuedPrompts' | 'agentGitStatuses' | 'turnGitDiffs'>>): CompanionWorkspace {
  const workerIds = new Set((snapshot.missions ?? []).flatMap((mission) => mission.execution?.runs.flatMap((run) => run.workerId ? [run.workerId] : []) ?? []));
  const gitStatuses = snapshot.agentGitStatuses && Object.fromEntries(Object.entries(snapshot.agentGitStatuses).map(([id, status]) => {
    const turn = Object.values(snapshot.turnGitDiffs ?? {}).filter(turn => turn.agentId === id && Boolean(turn.diff))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    return [id, projectGitStatus({ ...status, ...(turn ? { lastTurn: turn } : {}) })];
  }));
  const { missions, workerIds: ticketWorkerIds } = companionMissionsOf(snapshot);
  const reviewFindings = Object.fromEntries(snapshot.agents.flatMap(agent => {
    const review = agent.codeReview;
    return review && review.status !== 'finished' ? [[agent.id, review.rounds.find(round => round.id === review.activeRoundId)?.findings.length ?? 0]] : [];
  }));
  return { ...(gitStatuses ? { gitStatuses } : {}), missionProgress: missions, missionAgents: snapshot.agents.filter((agent) => ticketWorkerIds.has(agent.id)), queuedPrompts: snapshot.queuedPrompts?.map(({ id, agentId, text }) => ({ id, agentId, text })), agentRequests: snapshot.agentRequests ?? {}, teams: snapshot.teams, agents: snapshot.agents.filter((agent) => !workerIds.has(agent.id)), repositoryIcons: snapshot.general.repositoryIcons, modelFavorites: snapshot.general.modelFavorites,
    reviewFindings, backends: Object.fromEntries([
      ...snapshot.teams.map((team) => [team.id, enabledAgentBackends({ providerConnections: snapshot.providerConnections ?? [] })] as const),
      ...(snapshot.remoteConnections?.connections ?? []).map((connection) => [connection.id, enabledAgentBackends({ providerConnections: providerConnectionsForHost({ ...snapshot, remoteConnections: snapshot.remoteConnections } as AppSnapshot, connection.id) })] as const),
    ]) };
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
