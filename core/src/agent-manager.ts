import type {
  Agent,
  AgentBackend,
  AgentStatus,
  AppSnapshot,
  BackendDefaults,
  BackendSession,
  CreateAgentInput,
  CreateQuickChatInput,
  DuplicateAgentOptions,
  UpdateAgentInput,
  WorkBacklogAssignment,
  WorkBacklogAssignmentStatus,
} from './contracts';
import { releaseRemovedAutomationTargetsInSnapshot } from './automation-manager';
import { createEntityId, createUniqueEntityId, type IdGenerator } from './ids';
import { workBacklogAssignmentFromWorkItem, workItemAssignmentKey, type WorkItemAssignmentSource } from './work-assignments';
import { agentDisplayName } from './agent-display';
import { canSelectAgentBackend, resolveAgentBackend } from './agent-backends';
import { seedTeamId } from './seed-ids';
import { approvalBackendDefaultsWithPreset } from './approval-presets';
import { workspaceSidebarGroupIdForAgent, workspaceSidebarRepositoryRootForAgent } from './workspace-sidebar';

export function createAgentFromInput(input: CreateAgentInput, createdAt = new Date().toISOString(), teamId = seedTeamId, id = createEntityId('agent')): Agent {
  const name = normalizedOptionalString(input.name) ?? null;
  const backend = normalizedBackend(input.backend);
  const delegatedByAgentId = normalizedOptionalString(input.delegatedByAgentId);

  return {
    id,
    teamId,
    ...(delegatedByAgentId ? { delegatedByAgentId } : {}),
    name,
    avatar: normalizedOptionalString(input.avatar),
    folder: normalizedFolder(input.folder),
    backend,
    backendDefaults: normalizedBackendDefaults(input.backendDefaults, backend) ?? defaultBackendDefaults(backend),
    status: { type: 'idle' },
    createdAt,
    updatedAt: createdAt,
  };
}

export function createAgentInSnapshot(
  snapshot: AppSnapshot,
  input: CreateAgentInput,
  createdAt = new Date().toISOString(),
  id = createEntityId('agent'),
  options: { select?: boolean; afterAgentId?: string } = {},
): AppSnapshot {
  const agent = createAgentFromInput(input, createdAt, targetTeamId(snapshot, input.teamId), id);
  if (!input.backendDefaults) applyProviderDefaults(snapshot, agent);
  if (input.modelSelection) agent.backendDefaults = backendDefaultsWithModel(agent, input.modelSelection);
  const source = options.afterAgentId
    ? snapshot.agents.find((candidate) => candidate.id === options.afterAgentId)
    : undefined;
  if (source) {
    insertAgentAfterSource(snapshot, source, agent);
    if (options.select !== false) {
      snapshot.activeTeamId = agent.teamId ?? snapshot.activeTeamId;
      snapshot.activeAgentId = agent.id;
    }
    return snapshot;
  }
  return insertAgentInSnapshot(snapshot, agent, options.select);
}

export function createQuickChatInSnapshot(snapshot: AppSnapshot, input: CreateQuickChatInput, createdAt = new Date().toISOString(), id = createEntityId('agent'), options: { select?: boolean } = {}): AppSnapshot {
  const agent = createAgentFromInput({
    name: null,
    folder: '',
    backend: resolveAgentBackend(snapshot, input.backend),
    ...(input.teamId ? { teamId: input.teamId } : {}),
  }, createdAt, targetTeamId(snapshot, input.teamId), id);
  applyProviderDefaults(snapshot, agent);
  agent.folder = null;
  agent.sessionKind = 'quickChat';
  return insertAgentInSnapshot(snapshot, agent, options.select);
}

export function updateAgentFromInput(snapshot: AppSnapshot, input: UpdateAgentInput, updatedAt = new Date().toISOString()): Agent | null {
  const agent = findAgent(snapshot, input.id);
  if (!agent) {
    return null;
  }
  if (input.backend !== undefined && input.backend !== agent.backend) {
    const backend = resolveAgentBackend(snapshot, input.backend);
    if (!canSelectAgentBackend(agent)) throw new Error('Backend can only be changed before the first prompt.');
    agent.backend = backend;
    agent.backendDefaults = defaultBackendDefaults(backend);
    applyProviderDefaults(snapshot, agent);
    agent.updatedAt = updatedAt;
  }
  if (input.modelSelection) {
    agent.backendDefaults = backendDefaultsWithModel(agent, input.modelSelection);
    snapshot.general.providerModelDefaults = {
      ...snapshot.general.providerModelDefaults,
      [agent.backend]: { ...input.modelSelection, ...(agent.backend === 'antigravity' ? { reasoningEffort: null, serviceTier: null } : {}) },
    };
  }
  if (input.name !== undefined) {
    agent.name = normalizedOptionalString(input.name) ?? null;
    agent.updatedAt = updatedAt;
  }
  if (input.gitDiffTarget !== undefined) {
    if (input.gitDiffTarget) {
      agent.gitDiffTarget = { ...input.gitDiffTarget };
    } else {
      delete agent.gitDiffTarget;
    }
  }
  return agent;
}

export function updateAgentOpenInApplication(
  snapshot: AppSnapshot,
  agentId: string,
  application: Agent['openInApplication'],
  updatedAt = new Date().toISOString(),
): Agent | null {
  const agent = findAgent(snapshot, agentId);
  if (!agent) {
    return null;
  }

  agent.openInApplication = application;
  agent.updatedAt = updatedAt;
  return agent;
}

export function updateAgentFolder(snapshot: AppSnapshot, agentId: string, folder: string, updatedAt = new Date().toISOString()): Agent | null {
  const agent = findAgent(snapshot, agentId);
  if (!agent) {
    return null;
  }

  const nextFolder = normalizedFolder(folder);
  if (nextFolder !== agent.folder) {
    delete agent.workspace;
    delete agent.pullRequest;
  }
  agent.folder = nextFolder;
  clearAgentRuntimeState(agent);
  agent.updatedAt = updatedAt;

  return agent;
}

export function updateAgentWorkspace(
  snapshot: AppSnapshot,
  agentId: string,
  workspace: Agent['workspace'],
  updatedAt = new Date().toISOString(),
): Agent | null {
  const agent = findAgent(snapshot, agentId);
  if (!agent) return null;

  if (workspace) {
    agent.workspace = { ...workspace };
  } else {
    delete agent.workspace;
  }
  agent.updatedAt = updatedAt;
  return agent;
}

export function selectAgent(snapshot: AppSnapshot, agentId: string): AppSnapshot {
  const agent = findAgent(snapshot, agentId);
  if (agent) {
    snapshot.activeAgentId = agentId;
    const team = snapshot.teams.find((candidate) => candidate.id === agent.teamId);
    if (team) {
      snapshot.activeTeamId = team.id;
      team.activeAgentId = agentId;
    }
  }

  return snapshot;
}

function insertAgentInSnapshot(snapshot: AppSnapshot, agent: Agent, select = true): AppSnapshot {
  snapshot.agents.push(agent);
  attachAgentToTeam(snapshot, agent);
  if (select) {
    snapshot.activeTeamId = agent.teamId ?? snapshot.activeTeamId;
    snapshot.activeAgentId = agent.id;
  }
  return snapshot;
}

function targetTeamId(snapshot: AppSnapshot, teamId: string | undefined): string {
  if (teamId && !snapshot.teams.some((team) => team.id === teamId)) throw new Error(`Team not found: ${teamId}`);
  // Legacy callers without a client context get only the stable default team.
  // Backend dispatch resolves the initiating client's explicit target first.
  return teamId ?? snapshot.teams[0]?.id ?? seedTeamId;
}

function clearAgentRuntimeState(agent: Agent): void {
  delete agent.hasSubmittedPrompt;
  delete agent.backendSession;
  delete agent.contextUsage;
  delete agent.plan;
  delete agent.planReview;
  delete agent.threadFlags;
  delete agent.suggestedPrompt;
  delete agent.goal;
  delete agent.visualize;
  delete agent.isRegistered;
  delete agent.mcpSessionId;
  delete agent.statusText;
}

function normalizedBackend(value: AgentBackend | undefined): AgentBackend {
  return value ?? 'codex';
}

function applyProviderDefaults(snapshot: AppSnapshot, agent: Agent): void {
  const selection = snapshot.general.providerModelDefaults?.[agent.backend];
  if (selection) agent.backendDefaults = {
    ...(agent.backendDefaults?.kind === agent.backend ? agent.backendDefaults : defaultBackendDefaults(agent.backend)),
    model: selection.model,
    userSelectedModel: true,
    ...(agent.backend !== 'antigravity' && selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    ...(agent.backend === 'codex' ? { serviceTier: selection.serviceTier } : {}),
  } as BackendDefaults;
  const approvals = snapshot.general.providerApprovalDefaults;
  if (agent.backend === 'codex' && approvals?.codex) {
    agent.backendDefaults = approvalBackendDefaultsWithPreset(agent.backendDefaults, approvals.codex);
  } else if (agent.backend === 'claude' && approvals?.claude) {
    agent.backendDefaults = { ...agent.backendDefaults, kind: 'claude', permissionMode: approvals.claude };
  } else if (agent.backend === 'antigravity' && approvals?.antigravity) {
    agent.backendDefaults = { ...agent.backendDefaults, kind: 'antigravity', permissionMode: approvals.antigravity };
  }
}

function backendDefaultsWithModel(agent: Agent, selection: NonNullable<CreateAgentInput['modelSelection']>): BackendDefaults {
  const defaults = agent.backendDefaults?.kind === agent.backend
    ? agent.backendDefaults
    : defaultBackendDefaults(agent.backend);
  const { reasoningEffort: _previousEffort, ...rest } = { reasoningEffort: undefined, ...defaults };
  return {
    ...rest,
    model: selection.model,
    userSelectedModel: true,
    ...(agent.backend !== 'antigravity' && selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    ...(agent.backend === 'codex' && selection.serviceTier !== undefined ? { serviceTier: selection.serviceTier } : {}),
  } as BackendDefaults;
}

function defaultBackendDefaults(backend: AgentBackend): Agent['backendDefaults'] {
  return { kind: backend };
}

function normalizedBackendDefaults(defaults: BackendDefaults | undefined, backend: AgentBackend): Agent['backendDefaults'] {
  if (!defaults || defaults.kind !== backend) {
    return undefined;
  }

  return defaults.kind === 'claude' && defaults.thinking
    ? { ...defaults, thinking: { ...defaults.thinking } }
    : { ...defaults };
}

function normalizedFolder(folder: string): string {
  return folder.trim();
}

function normalizedOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function setAgentStatus(
  snapshot: AppSnapshot,
  agentId: string,
  status: AgentStatus,
  occurredAt = new Date().toISOString(),
): void {
  const agent = findAgent(snapshot, agentId);
  if (agent) {
    const wasActive = agent.status.type !== 'idle';
    agent.status = status;
    if (wasActive || status.type !== 'idle') {
      agent.lastActivityAt = occurredAt;
    }
    agent.updatedAt = new Date().toISOString();
  }
}

function findAgent(snapshot: AppSnapshot, agentId: string): Agent | undefined {
  return snapshot.agents.find((agent) => agent.id === agentId);
}

export {
  findAgent as findAgentInSnapshot,
  setAgentStatus as setAgentStatusInSnapshot,
};

export function duplicateAgentInSnapshot(
  snapshot: AppSnapshot,
  agentId: string,
  createdAt = new Date().toISOString(),
  createId: IdGenerator = () => createEntityId('agent'),
  options: DuplicateAgentOptions = {},
): Agent | null {
  const source = snapshot.agents.find((agent) => agent.id === agentId);
  if (!source) {
    return null;
  }

  const duplicate = copiedAgent(snapshot, source, 'copy', createdAt, createId, options.name);
  insertAgentAfterSource(snapshot, source, duplicate);
  if (options.select !== false) {
    snapshot.activeTeamId = duplicate.teamId ?? snapshot.activeTeamId;
    snapshot.activeAgentId = duplicate.id;
  }
  return duplicate;
}

export function forkAgentInSnapshot(
  snapshot: AppSnapshot,
  agentId: string,
  backendSession: BackendSession,
  createdAt = new Date().toISOString(),
  createId: IdGenerator = () => createEntityId('agent'),
): Agent | null {
  const forked = createForkedAgentDraft(snapshot, agentId, createdAt, createId);
  return forked
    ? attachForkedAgentInSnapshot(snapshot, agentId, forked, backendSession)
    : null;
}

export function createForkedAgentDraft(
  snapshot: AppSnapshot,
  agentId: string,
  createdAt = new Date().toISOString(),
  createId: IdGenerator = () => createEntityId('agent'),
): Agent | null {
  const source = snapshot.agents.find((agent) => agent.id === agentId);
  return source ? copiedAgent(snapshot, source, 'fork', createdAt, createId) : null;
}

export function attachForkedAgentInSnapshot(
  snapshot: AppSnapshot,
  sourceAgentId: string,
  forked: Agent,
  backendSession: BackendSession,
  options: { select?: boolean } = {},
): Agent | null {
  const source = snapshot.agents.find((agent) => agent.id === sourceAgentId);
  if (!source) {
    return null;
  }
  if (backendSession.kind !== source.backend || forked.backend !== source.backend) {
    throw new Error('Forked conversation backend does not match the source agent backend.');
  }
  if (snapshot.agents.some((agent) => agent.id === forked.id)) {
    throw new Error(`Forked agent already exists: ${forked.id}`);
  }

  forked.backendSession = { ...backendSession };
  insertAgentAfterSource(snapshot, source, forked);
  if (options.select !== false) {
    snapshot.activeTeamId = forked.teamId ?? snapshot.activeTeamId;
    snapshot.activeAgentId = forked.id;
  }
  return forked;
}

export type AssignWorkItemOptions = {
  automationExecutionId?: string;
  automationId?: string;
  policy?: WorkBacklogAssignment['policy'];
};

export function assignWorkItemToAgentInSnapshot(
  snapshot: AppSnapshot,
  agentId: string,
  item: WorkItemAssignmentSource,
  assignedAt = new Date().toISOString(),
  options: AssignWorkItemOptions = {},
): Agent | null {
  const targetAgent = snapshot.agents.find((candidate) => candidate.id === agentId);
  if (!targetAgent) {
    return null;
  }

  snapshot.workBacklog.assignments = {
    ...snapshot.workBacklog.assignments,
    [workItemAssignmentKey(item)]: workBacklogAssignmentFromWorkItem(item, agentId, assignedAt, options),
  };
  targetAgent.updatedAt = assignedAt;
  return targetAgent;
}

export function removeWorkItemAssignmentFromSnapshot(snapshot: AppSnapshot, item: WorkItemAssignmentSource): boolean {
  const assignmentKey = workItemAssignmentKey(item);
  if (!snapshot.workBacklog.assignments[assignmentKey]) {
    return false;
  }

  const nextAssignments = { ...snapshot.workBacklog.assignments };
  delete nextAssignments[assignmentKey];
  snapshot.workBacklog.assignments = nextAssignments;
  return true;
}

export function completeWorkItemAssignmentInSnapshot(snapshot: AppSnapshot, agentId: string, workItemId: string, completedAt = new Date().toISOString()): WorkBacklogAssignment | null {
  return updateWorkItemAssignmentInSnapshot(snapshot, agentId, workItemId, 'completed', completedAt);
}

export function updateWorkItemAssignmentInSnapshot(
  snapshot: AppSnapshot,
  agentId: string,
  workItemId: string,
  status: WorkBacklogAssignmentStatus,
  updatedAt = new Date().toISOString(),
  note?: string,
): WorkBacklogAssignment | null {
  const assignment = snapshot.workBacklog.assignments[workItemId];
  if (!assignment || assignment.agentId !== agentId) {
    return null;
  }

  const updatedAssignment: WorkBacklogAssignment = {
    ...assignment,
    status,
    updatedAt,
    ...(status === 'completed' ? { completedAt: updatedAt } : {}),
    ...(note?.trim() ? { note: note.trim() } : {}),
  };
  if (status !== 'completed') delete updatedAssignment.completedAt;
  if (!note?.trim()) delete updatedAssignment.note;
  snapshot.workBacklog.assignments = {
    ...snapshot.workBacklog.assignments,
    [workItemId]: updatedAssignment,
  };

  const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
  if (agent) {
    agent.updatedAt = updatedAt;
  }
  return updatedAssignment;
}

export function moveAgentToTeamInSnapshot(snapshot: AppSnapshot, agentId: string, teamId: string, updatedAt = new Date().toISOString()): Agent | null {
  const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
  const targetTeam = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!agent || !targetTeam) {
    return null;
  }

  for (const team of snapshot.teams) {
    team.agentIds = team.agentIds.filter((candidate) => candidate !== agentId);
    if (team.activeAgentId === agentId) {
      team.activeAgentId = team.agentIds[0];
    }
  }

  agent.teamId = targetTeam.id;
  agent.updatedAt = updatedAt;
  if (!targetTeam.agentIds.includes(agent.id)) {
    targetTeam.agentIds.push(agent.id);
  }
  targetTeam.activeAgentId = agent.id;
  snapshot.activeTeamId = targetTeam.id;
  snapshot.activeAgentId = agent.id;

  return agent;
}

export function reorderAgentInTeam(snapshot: AppSnapshot, teamId: string, agentId: string, beforeAgentId: string | null): Agent | null {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
  if (!team || !agent || !team.agentIds.includes(agentId)) {
    return null;
  }

  if (beforeAgentId === agentId) {
    return agent;
  }

  const sourceGroupId = workspaceSidebarGroupIdForAgent(agent);
  const beforeAgent = beforeAgentId === null
    ? null
    : snapshot.agents.find((candidate) => candidate.id === beforeAgentId) ?? null;
  if (
    beforeAgentId !== null &&
    (!team.agentIds.includes(beforeAgentId) || !beforeAgent || workspaceSidebarGroupIdForAgent(beforeAgent) !== sourceGroupId)
  ) {
    return null;
  }

  const groupAgentIds = team.agentIds.filter((candidateId) => {
    const candidate = snapshot.agents.find((value) => value.id === candidateId);
    return candidate && workspaceSidebarGroupIdForAgent(candidate) === sourceGroupId;
  });
  const reorderedGroupAgentIds = reorderIdsByBeforeId(groupAgentIds, agentId, beforeAgentId);
  let groupIndex = 0;
  team.agentIds = team.agentIds.map((candidateId) => (
    groupAgentIds.includes(candidateId)
      ? reorderedGroupAgentIds[groupIndex++]!
      : candidateId
  ));
  return agent;
}

export function reorderRepositoryInTeam(
  snapshot: AppSnapshot,
  teamId: string,
  repositoryRoot: string,
  beforeRepositoryRoot: string | null,
): Agent[] | null {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) return null;

  const agentsById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const groups = new Map<string, { agentIds: string[]; repositoryRoot: string | null }>();
  for (const agentId of team.agentIds) {
    const agent = agentsById.get(agentId);
    const groupId = agent ? workspaceSidebarGroupIdForAgent(agent) : `missing:${agentId}`;
    const group = groups.get(groupId) ?? {
      agentIds: [],
      repositoryRoot: agent ? workspaceSidebarRepositoryRootForAgent(agent) : null,
    };
    group.agentIds.push(agentId);
    groups.set(groupId, group);
  }

  const orderedGroups = [...groups.values()];
  const repositoryGroups = orderedGroups.filter((group) => group.repositoryRoot !== null);
  const sourceGroup = repositoryGroups.find((group) => group.repositoryRoot === repositoryRoot);
  const sourceAgents = sourceGroup?.agentIds
    .map((agentId) => agentsById.get(agentId))
    .filter((agent): agent is Agent => Boolean(agent)) ?? [];
  if (sourceAgents.length === 0) return null;
  if (beforeRepositoryRoot === repositoryRoot) return sourceAgents;
  if (beforeRepositoryRoot !== null && !repositoryGroups.some((group) => group.repositoryRoot === beforeRepositoryRoot)) {
    return null;
  }

  const reorderedRoots = reorderIdsByBeforeId(
    repositoryGroups.map((group) => group.repositoryRoot!),
    repositoryRoot,
    beforeRepositoryRoot,
  );
  const repositoryGroupsByRoot = new Map(repositoryGroups.map((group) => [group.repositoryRoot!, group]));
  let repositoryIndex = 0;
  team.agentIds = orderedGroups.flatMap((group) => {
    if (group.repositoryRoot === null) return group.agentIds;
    return repositoryGroupsByRoot.get(reorderedRoots[repositoryIndex++]!)!.agentIds;
  });
  return sourceAgents;
}

export function restartAgentConversation(snapshot: AppSnapshot, agentId: string, updatedAt = new Date().toISOString()): Agent | null {
  const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return null;
  }

  ensureAgentCanChange(agent, 'Agent must be idle before restarting.');
  delete snapshot.agentRequests?.[agentId];
  delete snapshot.backendApprovals[agentId];
  clearRuntimeState(agent);
  agent.status = { type: 'idle' };
  agent.updatedAt = updatedAt;
  return agent;
}

export function resumeAgentConversationInSnapshot(
  snapshot: AppSnapshot,
  agentId: string,
  backendSession: BackendSession,
  updatedAt = new Date().toISOString(),
): Agent | null {
  const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return null;
  }

  ensureAgentCanChange(agent, 'Agent must be idle before resuming a conversation.');
  if (backendSession.kind !== agent.backend) {
    throw new Error('Conversation backend does not match the agent backend.');
  }

  clearRuntimeState(agent);
  agent.backendSession = { ...backendSession };
  delete snapshot.agentRequests?.[agentId];
  delete snapshot.backendApprovals[agentId];
  agent.status = { type: 'idle' };
  agent.updatedAt = updatedAt;
  return agent;
}

export function closeAgentInSnapshot(snapshot: AppSnapshot, agentId: string): Agent | null {
  const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return null;
  }

  snapshot.agents = snapshot.agents.filter((candidate) => candidate.id !== agentId);
  releaseRemovedAutomationTargetsInSnapshot(snapshot);
  delete snapshot.agentRequests?.[agentId];
  delete snapshot.backendApprovals[agentId];
  snapshot.workBacklog.assignments = Object.fromEntries(
    Object.entries(snapshot.workBacklog.assignments)
      .filter(([, assignment]) => assignment.agentId !== agentId),
  );

  for (const team of snapshot.teams) {
    team.agentIds = team.agentIds.filter((candidate) => candidate !== agentId);
    if (team.activeAgentId === agentId) {
      team.activeAgentId = team.agentIds[0];
    }
  }

  if (snapshot.activeAgentId === agentId) {
    const sameTeamNextAgent = snapshot.agents.find((candidate) => candidate.teamId === agent.teamId);
    snapshot.activeAgentId = sameTeamNextAgent?.id ?? null;
  }

  if (snapshot.activeTeamId === agent.teamId && snapshot.activeAgentId) {
    const activeAgent = snapshot.agents.find((candidate) => candidate.id === snapshot.activeAgentId);
    snapshot.activeTeamId = activeAgent?.teamId ?? snapshot.activeTeamId;
  }

  return agent;
}

function ensureAgentCanChange(agent: Agent, message: string): void {
  if (agent.status.type !== 'idle') {
    throw new Error(message);
  }
}

function clearRuntimeState(agent: Agent): void {
  delete agent.hasSubmittedPrompt;
  delete agent.backendSession;
  delete agent.conversationTitle;
  delete agent.contextUsage;
  delete agent.plan;
  delete agent.planReview;
  delete agent.threadFlags;
  delete agent.suggestedPrompt;
  delete agent.goal;
  delete agent.visualize;
  delete agent.isRegistered;
  delete agent.mcpSessionId;
  delete agent.statusText;
}

function attachAgentToTeam(snapshot: AppSnapshot, agent: Agent, afterAgentId?: string): void {
  const team = snapshot.teams.find((candidate) => candidate.id === agent.teamId) ?? snapshot.teams[0];
  if (!team) {
    return;
  }

  agent.teamId = team.id;
  if (!team.agentIds.includes(agent.id)) {
    const sourceIndex = afterAgentId ? team.agentIds.indexOf(afterAgentId) : -1;
    team.agentIds.splice(sourceIndex >= 0 ? sourceIndex + 1 : team.agentIds.length, 0, agent.id);
  }
  team.activeAgentId = agent.id;
}

function copiedAgent(
  snapshot: AppSnapshot,
  source: Agent,
  suffix: 'copy' | 'fork',
  createdAt: string,
  createId: IdGenerator,
  name?: string,
): Agent {
  return {
    id: uniqueAgentId(snapshot, createId),
    teamId: source.teamId ?? activeTeamIdForCopy(snapshot),
    name: name?.trim() || `${agentDisplayName(source)} (${suffix})`,
    avatar: source.avatar,
    folder: source.folder,
    ...(source.workspace ? { workspace: { ...source.workspace } } : {}),
    backend: source.backend,
    backendDefaults: source.backendDefaults ? { ...source.backendDefaults } : undefined,
    ...(source.openInApplication ? { openInApplication: source.openInApplication } : {}),
    status: { type: 'idle' },
    createdAt,
    updatedAt: createdAt,
  };
}

function insertAgentAfterSource(snapshot: AppSnapshot, source: Agent, agent: Agent): void {
  const sourceIndex = snapshot.agents.indexOf(source);
  snapshot.agents.splice(sourceIndex + 1, 0, agent);
  attachAgentToTeam(snapshot, agent, source.id);
}

function activeTeamIdForCopy(snapshot: AppSnapshot): string | undefined {
  if (snapshot.activeTeamId) {
    return snapshot.activeTeamId;
  }

  const activeAgent = snapshot.agents.find((agent) => agent.id === snapshot.activeAgentId);
  return activeAgent?.teamId ?? snapshot.teams[0]?.id;
}

function uniqueAgentId(snapshot: AppSnapshot, createId: IdGenerator): string {
  return createUniqueEntityId('agent', snapshot.agents.map((agent) => agent.id), createId);
}

function reorderIdsByBeforeId(ids: string[], id: string, beforeId: string | null): string[] {
  const nextIds = ids.filter((candidate) => candidate !== id);
  const insertIndex = beforeId === null ? nextIds.length : nextIds.indexOf(beforeId);
  nextIds.splice(insertIndex, 0, id);
  return nextIds;
}
