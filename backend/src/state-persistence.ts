import { isRateLimitPause } from '@workspace/core/auto-resume';
import { isAgentReadState } from '@workspace/core/agent-read-state';
import { isDelegationContext, isTurnDelegationOverrides, isDelegationUserInstructions } from '@workspace/core/delegation-context';
import { isWorkProviderKind, workProviderKinds } from '@workspace/core/work-providers';
import { isAgentHandoff } from '@workspace/core/agent-handoff';
import { isMission } from '@workspace/core/missions';
import { isThreadFlags } from '@workspace/core/thread-flags';
import { backendCodexHomeDir } from './state';
import { restorePlanReview } from './persistence/legacy-plan-review';
import { sanitizeClientPreferences } from '@workspace/core/client-preferences';
import { isAutomationTarget } from '@workspace/core/automation-manager';
import { normalizeAutomationSchedule } from '@workspace/core/automation-schedule';
import type { AccountRateLimits, Agent, AgentBackend, AgentContextUsage, AgentSubagentTree, AgentWorkspaceIdentity, AppGeneralSettings, AppSnapshot, BackendDefaults, BackendSession, Automation, AutomationExecutionLogEntry, OpenInApplication, RemoteConnection, RemoteConnectionStatus, RemoteConnectionTransport, RemoteConnectionsState, SourceFolderState, SubagentActivity, SubagentNode, SubagentOperation, Team, ThreadGoal, ThreadPlan, ThreadPlanKind, ThreadPlanStatus, ThreadPlanStep, WorkBacklogAssignment, WorkBacklogState, WorkIntegrationConnection, WorkIntegrationStatus, WorkProviderKind, WorkProviderSettings } from '@workspace/core/contracts';
import { sanitizeGitRemoteUrl } from '@workspace/core/git-remote';
import { isCodexApprovalPreset, isCodexApprovalsReviewer } from '@workspace/core/codex-approval-presets';
import { normalizeGeneralSettings, normalizeSourceFolderState, normalizeThemeSettings } from '@workspace/core/settings';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { sanitizeWorkItemAssignmentSource, workItemAssignmentKey } from '@workspace/core/work-assignments';
import { defaultTeamColor } from '@workspace/core/team-colors';
import { appText } from '@workspace/core/app-text';
import { isSubagentActivityKind, isSubagentOperationKind, isSubagentOperationLifecycle, isSubagentOperationStatus, isSubagentStatus } from '@workspace/core/subagent-values';
import { cloneCodeReviewSession, isCodeReviewSession } from '@workspace/core/code-review';
import { isAgentGitDiffTarget } from '@workspace/core/snapshot-guard-collections';
import { cloneVisualizeSession, isVisualization, isVisualizeSession, visualizationRepositoryRoot, type RepositoryVisualizations, type Visualization, type VisualizeSession } from '@workspace/core/visualize';

export type PersistedState = {
  missions?: AppSnapshot['missions'];
  repositoryVisualizations?: RepositoryVisualizations;
  clientPreferences?: AppSnapshot['clientPreferences'];
  teams: Team[];
  agents: PersistedAgent[];
  automations?: Automation[];
  activeTeamId: string | null;
  activeAgentId: string | null;
  accountRateLimits?: AccountRateLimits;
  subagentTrees?: Record<string, AgentSubagentTree>;
  workBacklog?: WorkBacklogState;
  remoteConnections?: RemoteConnectionsState;
  general?: AppGeneralSettings;
  sourceFolder?: SourceFolderState;
  theme: AppSnapshot['theme'];
};

/** What `persistedStateFromSnapshot` always produces; the optional keys exist for older files. */
export type FullPersistedState = PersistedState & {
  automations: Automation[];
  subagentTrees: Record<string, AgentSubagentTree>;
  workBacklog: WorkBacklogState;
  remoteConnections: RemoteConnectionsState;
  general: AppGeneralSettings;
  sourceFolder: SourceFolderState;
};

export type PersistedAgent = Pick<Agent, 'id' | 'name' | 'folder' | 'createdAt' | 'updatedAt'> & {
  handoff?: Agent['handoff'];
  delegatedByAgentId?: string;
  delegationContext?: Agent['delegationContext'];
  userDelegationOverrides?: Agent['userDelegationOverrides'];
  delegationUserInstructions?: Agent['delegationUserInstructions'];
  pullRequest?: Agent['pullRequest'];
  sessionKind?: Agent['sessionKind'];
  conversationTitle?: string;
  avatar?: string;
  backend: AgentBackend;
  backendSession?: BackendSession;
  hasSubmittedPrompt?: boolean;
  readState?: Agent['readState'];
  backendDefaults?: BackendDefaults;
  openInApplication?: OpenInApplication;
  gitDiffTarget?: Agent['gitDiffTarget'];
  workspace?: AgentWorkspaceIdentity;
  contextUsage?: AgentContextUsage;
  plan?: ThreadPlan;
  planReview?: import('@workspace/core/plan-review').PlanReview;
  codeReview?: import('@workspace/core/code-review').CodeReviewSession;
  threadFlags?: import('@workspace/core/thread-flags').ThreadFlags;
  suggestedPrompt?: string;
  rateLimitPause?: Agent['rateLimitPause'];
  goal?: ThreadGoal;
  visualize?: Omit<VisualizeSession, 'visualizations'> & { visualizations?: Visualization[] };
  statusText?: string;
  lastActivityAt?: string;
  teamId?: string;
};

function migrateGeneralSettings(value: unknown): AppGeneralSettings {
  const settings = normalizeGeneralSettings(value);
  if (isRecord(value) && typeof value.shareCodexSkillsAndPlugins === 'boolean' && !settings.providerHomes?.codex) {
    settings.providerHomes = { ...settings.providerHomes, codex: {
      isolated: true, shareSkills: value.shareCodexSkillsAndPlugins, homePath: backendCodexHomeDir(),
    } };
  }
  return settings;
}

export function persistedStateFromSnapshot(snapshot: AppSnapshot): FullPersistedState {
  return {
    ...(snapshot.clientPreferences ? { clientPreferences: structuredClone(snapshot.clientPreferences) } : {}),
    ...(snapshot.missions ? { missions: structuredClone(snapshot.missions) } : {}),
    ...(snapshot.repositoryVisualizations ? { repositoryVisualizations: structuredClone(snapshot.repositoryVisualizations) } : {}),
    teams: snapshot.teams.map((team) => ({ ...team, agentIds: [...team.agentIds] })),
    agents: snapshot.agents.map(agent => persistedAgentFromSnapshot(agent, snapshot.repositoryVisualizations)),
    automations: snapshot.automations.map(cloneAutomation),
    activeTeamId: snapshot.activeTeamId,
    activeAgentId: snapshot.activeAgentId,
    ...(snapshot.accountRateLimits ? { accountRateLimits: { ...snapshot.accountRateLimits } } : {}),
    subagentTrees: cloneSubagentTrees(snapshot.subagentTrees),
    workBacklog: cloneWorkBacklogState(snapshot.workBacklog),
    remoteConnections: cloneRemoteConnectionsState(snapshot.remoteConnections),
    general: {
      ...snapshot.general,
      plugins: snapshot.general.plugins ? { ...snapshot.general.plugins } : undefined,
    },
    sourceFolder: {
      ...snapshot.sourceFolder,
      recentRepoNames: [...snapshot.sourceFolder.recentRepoNames],
    },
    theme: { ...snapshot.theme },
  };
}

function persistedAgentFromSnapshot(agent: Agent, libraries?: RepositoryVisualizations): PersistedAgent {
  const root = visualizationRepositoryRoot(agent);
  const visualize = agent.visualize ? cloneVisualizeSession(agent.visualize) : undefined;
  let persistedVisualize: PersistedAgent['visualize'] = visualize;
  if (visualize && root && libraries?.[root]) {
    const { visualizations: _repositoryVisualizations, ...session } = visualize;
    persistedVisualize = session;
  }
  return {
    id: agent.id,
    ...(agent.handoff ? { handoff: structuredClone(agent.handoff) } : {}),
    teamId: agent.teamId,
    ...(agent.delegationContext ? { delegationContext: { ...agent.delegationContext } } : {}),
    ...(agent.userDelegationOverrides ? { userDelegationOverrides: { ...agent.userDelegationOverrides } } : {}),
    ...(agent.delegationUserInstructions ? { delegationUserInstructions: { ...agent.delegationUserInstructions } } : {}),
    ...(agent.delegatedByAgentId ? { delegatedByAgentId: agent.delegatedByAgentId } : {}),
    ...(agent.pullRequest ? { pullRequest: { ...agent.pullRequest } } : {}),
    ...(agent.sessionKind ? { sessionKind: agent.sessionKind } : {}),
    name: agent.name,
    ...(agent.conversationTitle ? { conversationTitle: agent.conversationTitle } : {}),
    avatar: agent.avatar,
    folder: agent.folder,
    ...(agent.workspace ? { workspace: { ...agent.workspace } } : {}),
    backend: agent.backend,
    ...(agent.backendSession ? { backendSession: cloneBackendSession(agent.backendSession) } : {}),
    ...(agent.readState ? { readState: agent.readState } : {}),
    ...(agent.hasSubmittedPrompt ? { hasSubmittedPrompt: true } : {}),
    ...(agent.backendDefaults ? { backendDefaults: cloneBackendDefaults(agent.backendDefaults) } : {}),
    ...(agent.openInApplication ? { openInApplication: agent.openInApplication } : {}),
    ...(agent.gitDiffTarget ? { gitDiffTarget: { ...agent.gitDiffTarget } } : {}),
    ...(agent.contextUsage ? { contextUsage: { ...agent.contextUsage } } : {}),
    ...(agent.plan ? { plan: cloneThreadPlan(agent.plan) } : {}),
    ...(agent.threadFlags ? { threadFlags: structuredClone(agent.threadFlags) } : {}),
    ...(agent.rateLimitPause ? { rateLimitPause: { ...agent.rateLimitPause } } : {}),
    ...(agent.suggestedPrompt ? { suggestedPrompt: agent.suggestedPrompt } : {}),
    ...(agent.planReview ? { planReview: { ...agent.planReview } } : {}),
    ...(agent.codeReview ? { codeReview: cloneCodeReviewSession(agent.codeReview) } : {}),
    ...(agent.goal ? { goal: { ...agent.goal } } : {}),
    ...(persistedVisualize ? { visualize: persistedVisualize } : {}),
    statusText: agent.statusText,
    createdAt: agent.createdAt,
    ...(agent.lastActivityAt ? { lastActivityAt: agent.lastActivityAt } : {}),
    updatedAt: agent.updatedAt,
  };
}

export function snapshotFromPersistedState(value: unknown): AppSnapshot {
  const seed = createEmptySnapshot();
  if (!isRecord(value)) {
    return seed;
  }

  const accountRateLimits = sanitizeAccountRateLimits(value.accountRateLimits);
  const workBacklog = sanitizeWorkBacklogState(value.workBacklog, seed.workBacklog);
  const remoteConnections = sanitizeRemoteConnectionsState(value.remoteConnections, seed.remoteConnections);
  const remoteConnectionIds = new Set(remoteConnections.connections.map((connection) => connection.id));
  const durableLibraries = sanitizeRepositoryVisualizations(value.repositoryVisualizations);
  const allAgents = Array.isArray(value.agents)
    ? value.agents.map((agent) => sanitizeAgent(agent, durableLibraries)).filter((agent): agent is Agent => Boolean(agent))
    : [];
  const teams = Array.isArray(value.teams)
    ? value.teams.map((team) => sanitizeTeam(team, allAgents, remoteConnectionIds)).filter((team): team is Team => Boolean(team))
    : seed.teams;
  const remotePointerTeamIds = localRemoteTeamPointerIds(teams);
  const agents = allAgents.filter((agent) => !agent.teamId || !remotePointerTeamIds.has(agent.teamId));
  const localAgentIds = new Set(agents.map((agent) => agent.id));
  const persistedAutomations = Array.isArray(value.automations) ? value.automations : [];
  workBacklog.assignments = assignmentsForAgents({
    ...legacyWorkBacklogAssignments(value.agents, agents),
    ...workBacklog.assignments,
  }, localAgentIds);
  const snapshot: AppSnapshot = {
    ...seed,
    ...(value.clientPreferences ? { clientPreferences: sanitizeClientPreferences(value.clientPreferences) } : {}),
    ...(Array.isArray(value.missions) ? { missions: value.missions.filter(isMission).map(m => structuredClone(m)) } : {}),
    teams: teams.length > 0 ? teams : seed.teams,
    agents,
    ...(Object.keys(durableLibraries).length ? { repositoryVisualizations: durableLibraries } : {}),
    automations: persistedAutomations
      .map(sanitizeAutomation)
      .filter((automation): automation is Automation => Boolean(automation)),
    activeTeamId: typeof value.activeTeamId === 'string' ? value.activeTeamId : null,
    activeAgentId: typeof value.activeAgentId === 'string' ? value.activeAgentId : null,
    ...(accountRateLimits ? { accountRateLimits } : {}),
    subagentTrees: sanitizeSubagentTrees(value.subagentTrees),
    workBacklog,
    remoteConnections,
    general: migrateGeneralSettings(value.general),
    sourceFolder: normalizeSourceFolderState(value.sourceFolder),
    theme: normalizeThemeSettings(value.theme),
    queuedPrompts: [],
    backendRuntimes: seed.backendRuntimes.map((runtime) => ({ ...runtime })),
  };

  repairTeamMembership(snapshot);
  if (!snapshot.activeAgentId || !snapshot.agents.some((agent) => agent.id === snapshot.activeAgentId)) {
    snapshot.activeAgentId = snapshot.agents[0]?.id ?? null;
  }
  snapshot.activeTeamId = repairedActiveTeamId(snapshot);

  return snapshot;
}

function sanitizeRepositoryVisualizations(value: unknown): RepositoryVisualizations {
  const libraries: RepositoryVisualizations = {};
  if (isRecord(value)) {
    for (const [root, candidates] of Object.entries(value)) {
      if (root && Array.isArray(candidates) && candidates.every(isVisualization)) {
        libraries[root] = structuredClone(candidates);
      }
    }
  }
  return libraries;
}

function cloneSubagentTrees(trees: Record<string, AgentSubagentTree>): Record<string, AgentSubagentTree> {
  return Object.fromEntries(Object.entries(trees).map(([agentId, tree]) => [agentId, {
    rootConversationId: tree.rootConversationId,
    nodes: Object.fromEntries(Object.entries(tree.nodes).map(([id, node]) => [id, { ...node }])),
    operations: Object.fromEntries(Object.entries(tree.operations).map(([id, operation]) => [id, {
      ...operation,
      receiverConversationIds: [...operation.receiverConversationIds],
    }])),
    activities: Object.fromEntries(Object.entries(tree.activities).map(([id, activity]) => [id, { ...activity }])),
  }]));
}

function sanitizeSubagentTrees(value: unknown): Record<string, AgentSubagentTree> {
  if (!isRecord(value)) return {};
  const trees: Record<string, AgentSubagentTree> = {};
  for (const [agentId, candidate] of Object.entries(value)) {
    if (!isRecord(candidate) || typeof candidate.rootConversationId !== 'string') continue;
    const rootConversationId = candidate.rootConversationId;
    const nodes: Record<string, SubagentNode> = {};
    if (isRecord(candidate.nodes)) {
      for (const [id, node] of Object.entries(candidate.nodes)) {
        const sanitized = sanitizeSubagentNode(node);
        if (sanitized && sanitized.conversationId !== rootConversationId) nodes[id] = sanitized;
      }
    }
    const operations: Record<string, SubagentOperation> = {};
    if (isRecord(candidate.operations)) {
      for (const [id, operation] of Object.entries(candidate.operations)) {
        const sanitized = sanitizeSubagentOperation(operation);
        if (sanitized) operations[id] = sanitized;
      }
    }
    const activities: Record<string, SubagentActivity> = {};
    if (isRecord(candidate.activities)) {
      for (const [id, activity] of Object.entries(candidate.activities)) {
        const sanitized = sanitizeSubagentActivity(activity);
        if (sanitized && sanitized.conversationId !== rootConversationId) activities[id] = sanitized;
      }
    }
    trees[agentId] = { rootConversationId, nodes, operations, activities };
  }
  return trees;
}

function sanitizeSubagentNode(value: unknown): SubagentNode | null {
  if (
    !isRecord(value) ||
    typeof value.conversationId !== 'string' ||
    typeof value.parentConversationId !== 'string' ||
    !isSubagentStatus(value.status) ||
    typeof value.updatedAt !== 'string'
  ) return null;
  return {
    conversationId: value.conversationId,
    parentConversationId: value.parentConversationId,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : value.updatedAt,
    status: value.status,
    ...(typeof value.statusMessage === 'string' ? { statusMessage: value.statusMessage } : {}),
    ...(typeof value.agentPath === 'string' ? { agentPath: value.agentPath } : {}),
    ...(typeof value.agentNickname === 'string' ? { agentNickname: value.agentNickname } : {}),
    ...(typeof value.agentRole === 'string' ? { agentRole: value.agentRole } : {}),
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}),
    updatedAt: value.updatedAt,
  };
}

function sanitizeSubagentOperation(value: unknown): SubagentOperation | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isSubagentOperationLifecycle(value.lifecycle) ||
    !isSubagentOperationKind(value.kind) ||
    !isSubagentOperationStatus(value.status) ||
    typeof value.senderConversationId !== 'string' ||
    !Array.isArray(value.receiverConversationIds) ||
    value.receiverConversationIds.some((id) => typeof id !== 'string') ||
    typeof value.occurredAt !== 'string'
  ) return null;
  return {
    id: value.id,
    ...(typeof value.turnId === 'string' ? { turnId: value.turnId } : {}),
    lifecycle: value.lifecycle,
    kind: value.kind,
    status: value.status,
    senderConversationId: value.senderConversationId,
    receiverConversationIds: [...value.receiverConversationIds] as string[],
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}),
    occurredAt: value.occurredAt,
  };
}

function sanitizeSubagentActivity(value: unknown): SubagentActivity | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isSubagentOperationLifecycle(value.lifecycle) ||
    !isSubagentActivityKind(value.kind) ||
    typeof value.conversationId !== 'string' ||
    typeof value.agentPath !== 'string' ||
    typeof value.occurredAt !== 'string'
  ) return null;
  return {
    id: value.id,
    ...(typeof value.turnId === 'string' ? { turnId: value.turnId } : {}),
    lifecycle: value.lifecycle,
    kind: value.kind,
    conversationId: value.conversationId,
    agentPath: value.agentPath,
    occurredAt: value.occurredAt,
  };
}

function sanitizeAgent(value: unknown, libraries: RepositoryVisualizations): Agent | null {
  if (!isRecord(value) || typeof value.id !== 'string' || (value.name !== null && typeof value.name !== 'string')) {
    return null;
  }

  const sessionKind = value.sessionKind === 'quickChat' ? value.sessionKind : undefined;
  const folder = typeof value.folder === 'string'
    ? value.folder
    : sessionKind && value.folder === null ? null : undefined;
  if (folder === undefined) return null;

  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : createdAt;
  const lastActivityAt = typeof value.lastActivityAt === 'string' ? value.lastActivityAt : updatedAt;
  const contextUsage = sanitizeContextUsage(value.contextUsage);
  const backend = sanitizeBackend(value.backend) ?? 'codex';
  const backendSession = sanitizeBackendSession(value.backendSession, backend);
  const backendDefaults = sanitizeBackendDefaults(value.backendDefaults, backend);
  const plan = sanitizeThreadPlan(value.plan);
  const planReview = restorePlanReview(value, backendSession?.kind === 'codex' ? backendSession.threadId : backendSession?.sessionId ?? null);
  const goal = sanitizeThreadGoal(value.goal);
  const openInApplication = sanitizeOpenInApplication(value.openInApplication);
  const gitDiffTarget = isAgentGitDiffTarget(value.gitDiffTarget) ? { ...value.gitDiffTarget } : undefined;
  const workspace = sanitizeAgentWorkspace(value.workspace);
  const pullRequest = sanitizeAgentPullRequest(value.pullRequest);
  const repositoryRoot = workspace?.kind === 'git' && workspace.folder === folder ? workspace.primaryWorktreeRoot : null;
  const visualize = sanitizeVisualizeSession(value.visualize ?? value.design, repositoryRoot ? libraries[repositoryRoot] : undefined);
  return {
    id: value.id,
    ...(isAgentHandoff(value.handoff) ? { handoff: structuredClone(value.handoff) } : {}),
    teamId: typeof value.teamId === 'string' ? value.teamId : undefined,
    ...(isDelegationContext(value.delegationContext) ? { delegationContext: { ...value.delegationContext } } : {}),
    ...(isTurnDelegationOverrides(value.userDelegationOverrides) ? { userDelegationOverrides: structuredClone(value.userDelegationOverrides) } : {}),
    ...(isDelegationUserInstructions(value.delegationUserInstructions) ? { delegationUserInstructions: { ...value.delegationUserInstructions } } : {}),
    ...(typeof value.delegatedByAgentId === 'string' && value.delegatedByAgentId.trim()
      ? { delegatedByAgentId: value.delegatedByAgentId.trim() }
      : {}),
    ...(pullRequest ? { pullRequest } : {}),
    ...(sessionKind ? { sessionKind } : {}),
    name: typeof value.name === 'string' ? value.name : null,
    ...(typeof value.conversationTitle === 'string' && value.conversationTitle.trim()
      ? { conversationTitle: value.conversationTitle.trim() }
      : {}),
    avatar: typeof value.avatar === 'string' ? value.avatar : undefined,
    folder,
    ...(workspace ? { workspace } : {}),
    backend,
    ...(backendSession ? { backendSession } : {}),
    ...(isAgentReadState(value.readState) ? { readState: value.readState } : {}),
    ...(value.hasSubmittedPrompt === true ? { hasSubmittedPrompt: true } : {}),
    ...(backendDefaults ? { backendDefaults } : {}),
    ...(openInApplication ? { openInApplication } : {}),
    ...(gitDiffTarget ? { gitDiffTarget } : {}),
    ...(contextUsage ? { contextUsage } : {}),
    ...(plan ? { plan } : {}),
    ...(isThreadFlags(value.threadFlags) ? { threadFlags: structuredClone(value.threadFlags) } : {}),
    ...(isRateLimitPause(value.rateLimitPause) ? { rateLimitPause: { ...value.rateLimitPause } } : {}),
    ...(typeof value.suggestedPrompt === 'string' && value.suggestedPrompt.trim() ? { suggestedPrompt: value.suggestedPrompt.trim() } : {}),
    ...(planReview ? { planReview } : {}),
    ...(isCodeReviewSession(value.codeReview)
      ? { codeReview: cloneCodeReviewSession(value.codeReview) }
      : {}),
    ...(goal ? { goal } : {}),
    ...(visualize ? { visualize } : {}),
    ...(typeof value.statusText === 'string' ? { statusText: value.statusText } : {}),
    status: { type: 'idle' },
    createdAt,
    lastActivityAt,
    updatedAt,
  };
}

function sanitizeVisualizeSession(value: unknown, repositoryVisualizations?: Visualization[]): VisualizeSession | undefined {
  if (repositoryVisualizations && isRecord(value)) {
    const session = { ...value, visualizations: repositoryVisualizations };
    return isVisualizeSession(session) ? { ...cloneVisualizeSession(session), visualizations: repositoryVisualizations } : undefined;
  }
  if (isVisualizeSession(value)) return cloneVisualizeSession(value);
  if (!isRecord(value)) return undefined;

  const migrated = {
    ...value,
    isOpen: typeof value.isOpen === 'boolean' ? value.isOpen : true,
    visualizations: value.visualizations ?? value.diagrams,
    selectedVisualizationId: value.selectedVisualizationId ?? value.selectedDiagramId,
    suggestions: Array.isArray(value.suggestions)
      ? value.suggestions.map(suggestion => isRecord(suggestion)
        ? {
            ...suggestion,
            visualizationId: suggestion.visualizationId ?? suggestion.diagramId,
          }
        : suggestion)
      : value.suggestions,
  };
  return isVisualizeSession(migrated) ? cloneVisualizeSession(migrated) : undefined;
}

function sanitizeAgentPullRequest(value: unknown): Agent['pullRequest'] | undefined {
  if (
    !isRecord(value) ||
    (value.provider !== 'github' && value.provider !== 'gitlab') ||
    typeof value.repository !== 'string' ||
    typeof value.branch !== 'string' ||
    !Number.isInteger(value.number) ||
    typeof value.title !== 'string' ||
    typeof value.url !== 'string' ||
    typeof value.draft !== 'boolean' ||
    typeof value.headSha !== 'string' ||
    (value.state !== 'open' && value.state !== 'merged' && value.state !== 'closed') ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return undefined;
  }
  return {
    provider: value.provider,
    repository: value.repository,
    branch: value.branch,
    number: value.number as number,
    title: value.title,
    url: value.url,
    draft: value.draft,
    headSha: value.headSha,
    state: value.state,
    ...(typeof value.mergedAt === 'string' ? { mergedAt: value.mergedAt } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function sanitizeAgentWorkspace(value: unknown): AgentWorkspaceIdentity | undefined {
  if (!isRecord(value) || typeof value.folder !== 'string' || typeof value.updatedAt !== 'string') {
    return undefined;
  }
  if (value.kind === 'folder' && typeof value.label === 'string') {
    return {
      kind: 'folder',
      folder: value.folder,
      label: value.label,
      updatedAt: value.updatedAt,
    };
  }
  const originUrl = typeof value.originUrl === 'string'
    ? sanitizeGitRemoteUrl(value.originUrl)
    : undefined;
  if (
    value.kind === 'git'
    && typeof value.repositoryName === 'string'
    && typeof value.repositoryRoot === 'string'
    && (typeof value.branch === 'string' || value.branch === null)
    && typeof value.isLinkedWorktree === 'boolean'
    && typeof value.primaryWorktreeRoot === 'string'
  ) {
    return {
      kind: 'git',
      folder: value.folder,
      repositoryName: value.repositoryName,
      repositoryRoot: value.repositoryRoot,
      branch: value.branch,
      ...(typeof value.defaultBranch === 'string' || value.defaultBranch === null ? { defaultBranch: value.defaultBranch } : {}),
      isLinkedWorktree: value.isLinkedWorktree,
      primaryWorktreeRoot: value.primaryWorktreeRoot,
      ...(originUrl ? { originUrl } : {}),
      updatedAt: value.updatedAt,
    };
  }
  return undefined;
}

function sanitizeOpenInApplication(value: unknown): OpenInApplication | undefined {
  return value === 'vscode' ||
    value === 'finder' ||
    value === 'terminal' ||
    value === 'iterm2' ||
    value === 'ghostty' ||
    value === 'xcode' ||
    value === 'android-studio' ||
    value === 'jetbrains'
    ? value
    : undefined;
}

function sanitizeThreadPlan(value: unknown): ThreadPlan | undefined {
  if (
    !isRecord(value) ||
    typeof value.threadId !== 'string' ||
    typeof value.turnId !== 'string' ||
    typeof value.explanation !== 'string' ||
    typeof value.markdown !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !Array.isArray(value.steps)
  ) {
    return undefined;
  }

  const steps = value.steps.map(sanitizeThreadPlanStep).filter((step): step is ThreadPlanStep => Boolean(step));
  if (!value.markdown.trim() && !value.explanation.trim() && steps.length === 0) {
    return undefined;
  }

  const kind = isThreadPlanKind(value.kind)
    ? value.kind
    : (steps.length > 0 || value.explanation.trim() ? 'execution' : 'proposed');
  const status = isThreadPlanStatus(value.status)
    ? value.status
    : legacyThreadPlanStatus(kind, steps);

  return {
    threadId: value.threadId,
    turnId: value.turnId,
    kind,
    status,
    explanation: value.explanation,
    steps,
    markdown: value.markdown,
    updatedAt: value.updatedAt,
  };
}

function isThreadPlanKind(value: unknown): value is ThreadPlanKind {
  return value === 'execution' || value === 'proposed';
}

function isThreadPlanStatus(value: unknown): value is ThreadPlanStatus {
  return value === 'inProgress' || value === 'completed' || value === 'incomplete' || value === 'interrupted' || value === 'failed';
}

function legacyThreadPlanStatus(kind: ThreadPlanKind, steps: ThreadPlanStep[]): ThreadPlanStatus {
  if (kind === 'proposed') return 'completed';
  return steps.length > 0 && steps.every((step) => step.status === 'completed')
    ? 'completed'
    : 'incomplete';
}

function sanitizeThreadPlanStep(value: unknown): ThreadPlanStep | null {
  if (!isRecord(value) || typeof value.step !== 'string' || !isThreadPlanStepStatus(value.status)) {
    return null;
  }

  return {
    step: value.step,
    status: value.status,
  };
}

function isThreadPlanStepStatus(value: unknown): value is ThreadPlanStep['status'] {
  return value === 'pending' || value === 'inProgress' || value === 'completed';
}

function sanitizeThreadGoal(value: unknown): ThreadGoal | undefined {
  if (
    !isRecord(value) ||
    typeof value.threadId !== 'string' ||
    typeof value.objective !== 'string' ||
    !isThreadGoalStatus(value.status) ||
    (value.tokenBudget !== null && typeof value.tokenBudget !== 'number') ||
    typeof value.tokensUsed !== 'number' ||
    typeof value.timeUsedSeconds !== 'number' ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number'
  ) {
    return undefined;
  }

  return {
    threadId: value.threadId,
    objective: value.objective,
    status: value.status,
    tokenBudget: value.tokenBudget,
    tokensUsed: value.tokensUsed,
    timeUsedSeconds: value.timeUsedSeconds,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isThreadGoalStatus(value: unknown): value is ThreadGoal['status'] {
  return value === 'active' ||
    value === 'paused' ||
    value === 'blocked' ||
    value === 'usageLimited' ||
    value === 'budgetLimited' ||
    value === 'complete';
}

function sanitizeContextUsage(value: unknown): AgentContextUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.totalTokens !== 'number' ||
    typeof value.inputTokens !== 'number' ||
    typeof value.cachedInputTokens !== 'number' ||
    typeof value.outputTokens !== 'number' ||
    typeof value.reasoningOutputTokens !== 'number' ||
    typeof value.lastTotalTokens !== 'number'
  ) {
    return undefined;
  }

  const modelContextWindow = nullableNumber(value.modelContextWindow);
  const usedPercent = nullableNumber(value.usedPercent);
  if (modelContextWindow === undefined || usedPercent === undefined) {
    return undefined;
  }

  return {
    totalTokens: value.totalTokens,
    inputTokens: value.inputTokens,
    cachedInputTokens: value.cachedInputTokens,
    outputTokens: value.outputTokens,
    reasoningOutputTokens: value.reasoningOutputTokens,
    lastTotalTokens: value.lastTotalTokens,
    modelContextWindow,
    usedPercent,
  };
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === 'number' ? value : undefined;
}

function sanitizeAccountRateLimits(value: unknown): AccountRateLimits | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    limitId: nullableString(value.limitId),
    limitName: nullableString(value.limitName),
    primary: sanitizeAccountRateLimitWindow(value.primary),
    secondary: sanitizeAccountRateLimitWindow(value.secondary),
    credits: value.credits ?? null,
    individualLimit: value.individualLimit ?? null,
    planType: nullableString(value.planType),
    rateLimitReachedType: nullableString(value.rateLimitReachedType),
  };
}

function sanitizeAccountRateLimitWindow(value: unknown): AccountRateLimits['primary'] {
  if (!isRecord(value) || typeof value.usedPercent !== 'number') {
    return null;
  }

  return {
    usedPercent: value.usedPercent,
    windowDurationMins: typeof value.windowDurationMins === 'number' ? value.windowDurationMins : null,
    resetsAt: typeof value.resetsAt === 'number' ? value.resetsAt : null,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function cloneRemoteConnectionsState(state: RemoteConnectionsState): RemoteConnectionsState {
  return {
    connections: state.connections.map(({ providerConnections: _runtimeConnections, ...connection }) => ({
      ...connection,
      ...(connection.transport ? { transport: cloneRemoteConnectionTransport(connection.transport) } : {}),
    })),
  };
}

function cloneRemoteConnectionTransport(transport: RemoteConnectionTransport): RemoteConnectionTransport {
  return {
    type: transport.type,
    command: transport.command,
    args: [...transport.args],
  };
}

function sanitizeRemoteConnectionsState(value: unknown, seed: RemoteConnectionsState): RemoteConnectionsState {
  if (!isRecord(value) || !Array.isArray(value.connections)) {
    return cloneRemoteConnectionsState(seed);
  }

  const seenIds = new Set<string>();
  const connections: RemoteConnection[] = [];
  for (const item of value.connections) {
    const connection = sanitizeRemoteConnection(item);
    if (!connection || seenIds.has(connection.id)) {
      continue;
    }
    seenIds.add(connection.id);
    connections.push(connection);
  }

  return { connections };
}

function sanitizeRemoteConnection(value: unknown): RemoteConnection | null {
  if (
    !isRecord(value) ||
    value.kind !== 'ssh' ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.host !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  const name = value.name.trim();
  const host = value.host.trim();
  if (!name || !host) {
    return null;
  }

  return {
    id: value.id,
    kind: 'ssh',
    name,
    host,
    ...(typeof value.hostName === 'string' && value.hostName.trim() ? { hostName: value.hostName.trim() } : {}),
    ...(typeof value.user === 'string' && value.user.trim() ? { user: value.user.trim() } : {}),
    ...(sanitizePort(value.port) ? { port: sanitizePort(value.port)! } : {}),
    ...(typeof value.identityFile === 'string' && value.identityFile.trim() ? { identityFile: value.identityFile.trim() } : {}),
    status: isRemoteConnectionStatus(value.status) ? value.status : 'saved',
    ...(typeof value.detail === 'string' && value.detail.trim() ? { detail: value.detail.trim() } : {}),
    ...(typeof value.sourceFolderPath === 'string' && value.sourceFolderPath.trim() ? { sourceFolderPath: value.sourceFolderPath.trim() } : {}),
    ...(sanitizeRemoteConnectionTransport(value.transport) ? { transport: sanitizeRemoteConnectionTransport(value.transport)! } : {}),
    ...(typeof value.installedAt === 'string' ? { installedAt: value.installedAt } : {}),
    ...(typeof value.lastCheckedAt === 'string' ? { lastCheckedAt: value.lastCheckedAt } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function sanitizeRemoteConnectionTransport(value: unknown): RemoteConnectionTransport | null {
  if (!isRecord(value) || value.type !== 'ssh-stdio' || value.command !== 'ssh' || !Array.isArray(value.args)) {
    return null;
  }

  const args = value.args.filter((arg): arg is string => typeof arg === 'string' && arg.trim().length > 0);
  return args.length > 0
    ? {
      type: 'ssh-stdio',
      command: 'ssh',
      args,
    }
    : null;
}

function isRemoteConnectionStatus(value: unknown): value is RemoteConnectionStatus {
  return value === 'saved' || value === 'checking' || value === 'ready' || value === 'error';
}

function sanitizePort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const port = Math.floor(value);
  return port > 0 && port <= 65535 ? port : null;
}

function cloneWorkBacklogState(state: WorkBacklogState): WorkBacklogState {
  return {
    connections: state.connections.map((connection) => ({ ...connection })),
    providerConfigurations: cloneWorkBacklogProviderConfigurations(state.providerConfigurations),
    providerSettings: cloneWorkProviderSettings(state.providerSettings),
    assignments: Object.fromEntries(Object.entries(state.assignments).map(([key, assignment]) => [key, { ...assignment }])),
  };
}

function sanitizeWorkBacklogState(value: unknown, seed: WorkBacklogState): WorkBacklogState {
  if (!isRecord(value)) {
    return cloneWorkBacklogState(seed);
  }

  const connections = Array.isArray(value.connections)
    ? value.connections.map(sanitizeWorkIntegrationConnection).filter((connection): connection is WorkIntegrationConnection => Boolean(connection))
    : [];
  const providers = new Set<WorkProviderKind>();
  const sanitizedConnections: WorkIntegrationConnection[] = [];

  for (const connection of [...connections, ...seed.connections]) {
    if (providers.has(connection.provider)) {
      continue;
    }
    providers.add(connection.provider);
    sanitizedConnections.push(connection);
  }

  return {
    connections: sanitizedConnections,
    providerConfigurations: sanitizeWorkBacklogProviderConfigurations(value.providerConfigurations),
    providerSettings: sanitizeWorkProviderSettings(value.providerSettings),
    assignments: sanitizeWorkBacklogAssignments(value.assignments),
  };
}

function sanitizeWorkBacklogAssignments(value: unknown): WorkBacklogState['assignments'] {
  if (!isRecord(value)) {
    return {};
  }

  const assignments: WorkBacklogState['assignments'] = {};
  for (const assignment of Object.values(value)) {
    const sanitized = sanitizeWorkBacklogAssignment(assignment);
    if (sanitized) {
      assignments[workItemAssignmentKey({ provider: sanitized.provider, itemId: sanitized.itemId })] = sanitized;
    }
  }
  return assignments;
}

function sanitizeWorkBacklogAssignment(value: unknown): WorkBacklogAssignment | null {
  if (
    !isRecord(value) ||
    !isWorkProvider(value.provider) ||
    typeof value.itemId !== 'string' ||
    typeof value.agentId !== 'string' ||
    typeof value.assignedAt !== 'string'
  ) {
    return null;
  }

  const automationId = optionalTrimmedString(value.automationId) ?? optionalTrimmedString(value.loopId);
  const automationExecutionId = optionalTrimmedString(value.automationExecutionId) ?? optionalTrimmedString(value.loopExecutionId);
  const item = sanitizeWorkItemAssignmentSource(value.item);

  return {
    provider: value.provider,
    itemId: value.itemId,
    ...(item && item.provider === value.provider && item.id === value.itemId ? { item } : {}),
    agentId: value.agentId,
    assignedAt: value.assignedAt,
    policy: value.policy === 'complete' || value.policy === 'review'
      ? value.policy
      : automationId || automationExecutionId ? 'complete' : 'review',
    status: value.status === 'working'
      ? 'inProgress'
      : isWorkBacklogAssignmentStatus(value.status) ? value.status : 'inProgress',
    ...(typeof value.completedAt === 'string' ? { completedAt: value.completedAt } : {}),
    ...(typeof value.note === 'string' && value.note.trim() ? { note: value.note.trim() } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    ...(automationId ? { automationId } : {}),
    ...(automationExecutionId ? { automationExecutionId } : {}),
  };
}

function legacyWorkBacklogAssignments(value: unknown, agents: Agent[]): WorkBacklogState['assignments'] {
  if (!Array.isArray(value)) {
    return {};
  }

  const agentIds = new Set(agents.map((agent) => agent.id));
  const assignments: WorkBacklogState['assignments'] = {};
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !agentIds.has(candidate.id) || !Array.isArray(candidate.assignedWorkItems)) {
      continue;
    }

    for (const item of candidate.assignedWorkItems) {
      const assignment = legacyWorkBacklogAssignment(candidate.id, item);
      if (assignment) {
        const key = workItemAssignmentKey({ provider: assignment.provider, itemId: assignment.itemId });
        if (!assignments[key]) {
          assignments[key] = assignment;
        }
      }
    }
  }
  return assignments;
}

function legacyWorkBacklogAssignment(agentId: string, value: unknown): WorkBacklogAssignment | null {
  if (
    !isRecord(value) ||
    !isWorkProvider(value.provider) ||
    typeof value.id !== 'string' ||
    typeof value.assignedAt !== 'string'
  ) {
    return null;
  }

  return {
    provider: value.provider,
    itemId: value.id,
    agentId,
    assignedAt: value.assignedAt,
    policy: 'review',
    status: 'inProgress',
  };
}

function sanitizeWorkIntegrationConnection(value: unknown): WorkIntegrationConnection | null {
  if (!isRecord(value) || !isWorkProvider(value.provider) || !isWorkIntegrationStatus(value.status)) {
    return null;
  }

  return {
    provider: value.provider,
    status: value.status,
    ...(value.source === 'api' || value.source === 'cli' || value.source === 'none' ? { source: value.source } : {}),
    ...(isRecord(value.hostedMcp) && ['directRequired', 'authorizationRequired', 'available', 'unavailable'].includes(String(value.hostedMcp.status))
      ? { hostedMcp: { status: value.hostedMcp.status as NonNullable<WorkIntegrationConnection['hostedMcp']>['status'] } } : {}),
    ...(typeof value.accountLabel === 'string' ? { accountLabel: value.accountLabel } : {}),
    ...(appText(value.detail) ? { detail: appText(value.detail)! } : {}),
    ...(typeof value.connectedAt === 'string' ? { connectedAt: value.connectedAt } : {}),
  };
}

function cloneWorkBacklogProviderConfigurations(value: WorkBacklogState['providerConfigurations']): WorkBacklogState['providerConfigurations'] {
  return Object.fromEntries(Object.entries(value).map(([provider, configuration]) => [provider, { ...configuration }]));
}

function sanitizeWorkBacklogProviderConfigurations(value: unknown): WorkBacklogState['providerConfigurations'] {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(workProviderKinds.flatMap(provider => {
    const configuration = sanitizeWorkSourceConfiguration(value[provider]);
    return configuration ? [[provider, configuration]] : [];
  }));
}

function sanitizeWorkSourceConfiguration(value: unknown): WorkBacklogState['providerConfigurations']['github'] | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceId = optionalTrimmedString(value.sourceId);
  if (!sourceId) {
    return null;
  }
  const assigneeLogin = optionalTrimmedString(value.assigneeLogin);
  const tagName = optionalTrimmedString(value.tagName);

  return {
    sourceId,
    ...(assigneeLogin ? { assigneeLogin } : {}),
    ...(tagName ? { tagName } : {}),
  };
}

function cloneWorkProviderSettings(value: WorkBacklogState['providerSettings']): WorkBacklogState['providerSettings'] {
  return Object.fromEntries(Object.entries(value).map(([provider, settings]) => [provider, { ...settings }]));
}

function sanitizeWorkProviderSettings(value: unknown): WorkBacklogState['providerSettings'] {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(workProviderKinds.flatMap(provider => {
    const settings = sanitizeWorkProviderSetting(value[provider]);
    return settings ? [[provider, settings]] : [];
  }));
}

function sanitizeWorkProviderSetting(value: unknown): WorkProviderSettings | null {
  if (!isRecord(value)) {
    return null;
  }

  const oauthClientId = optionalTrimmedString(value.oauthClientId) ?? '';
  return oauthClientId ? { oauthClientId } : null;
}

function cloneAutomation(automation: Automation): Automation {
  return { ...automation, target: { ...automation.target }, schedule: { ...automation.schedule },
    executionLog: automation.executionLog.map(entry => ({ ...entry, ...(entry.conversationRef ? { conversationRef: { ...entry.conversationRef } } : {}) })) };
}

function sanitizeAutomation(value: unknown): Automation | null {
  const schedule = isRecord(value) ? normalizeAutomationSchedule(value.schedule) : null;
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string'
    || !isAutomationTarget(value.target) || typeof value.prompt !== 'string' || !value.prompt.trim()
    || !schedule) return null;
  const automationId = value.id;
  const executionLog: AutomationExecutionLogEntry[] = Array.isArray(value.executionLog) ? value.executionLog.flatMap(entry => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.startedAt !== 'string' || entry.automationId !== automationId
      || !['working', 'awaitingInput', 'completed', 'failed'].includes(String(entry.status))) return [];
    return [{ id: entry.id, automationId, startedAt: entry.startedAt, status: entry.status as AutomationExecutionLogEntry['status'],
      ...(typeof entry.agentId === 'string' ? { agentId: entry.agentId } : {}),
      ...(typeof entry.agentName === 'string' ? { agentName: entry.agentName } : {}),
      ...(typeof entry.completedAt === 'string' ? { completedAt: entry.completedAt } : {}),
      ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
      ...(isRecord(entry.conversationRef) && entry.conversationRef.backend === 'codex' && typeof entry.conversationRef.threadId === 'string'
        ? { conversationRef: { backend: 'codex' as const, threadId: entry.conversationRef.threadId } }
        : isRecord(entry.conversationRef) && (entry.conversationRef.backend === 'claude' || entry.conversationRef.backend === 'antigravity') && typeof entry.conversationRef.sessionId === 'string'
          && (entry.conversationRef.folder === null || typeof entry.conversationRef.folder === 'string')
          ? { conversationRef: { backend: entry.conversationRef.backend, folder: entry.conversationRef.folder, sessionId: entry.conversationRef.sessionId } } : {}),
    }];
  }) : [];
  return { id: value.id, name: value.name, enabled: value.enabled !== false, prompt: value.prompt, target: { ...value.target },
    schedule, executionLog, createdAt: value.createdAt, updatedAt: value.updatedAt,
    ...(typeof value.scheduleAnchorAt === 'string' ? { scheduleAnchorAt: value.scheduleAnchorAt } : {}),
    ...(typeof value.lastRunAt === 'string' ? { lastRunAt: value.lastRunAt } : {}),
    ...(typeof value.lastError === 'string' ? { lastError: value.lastError } : {}) };
}

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isWorkProvider(value: unknown): value is WorkProviderKind {
  return isWorkProviderKind(value);
}

function isWorkIntegrationStatus(value: unknown): value is WorkIntegrationStatus {
  return value === 'notConfigured' ||
    value === 'disconnected' ||
    value === 'connecting' ||
    value === 'connected' ||
    value === 'error';
}

function isWorkBacklogAssignmentStatus(value: unknown): value is WorkBacklogAssignment['status'] {
  return value === 'blocked' || value === 'completed' || value === 'inProgress' || value === 'readyForReview';
}

function sanitizeTeam(value: unknown, agents: Agent[], remoteConnectionIds: Set<string>): Team | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }

  const agentIds = Array.isArray(value.agentIds)
    ? value.agentIds.filter((agentId): agentId is string => typeof agentId === 'string' && agents.some((agent) => agent.id === agentId))
    : [];

  const remoteConnectionId = typeof value.remoteConnectionId === 'string' && remoteConnectionIds.has(value.remoteConnectionId)
    ? value.remoteConnectionId
    : null;
  const remoteTeamId = remoteConnectionId && typeof value.remoteTeamId === 'string' && value.remoteTeamId.trim()
    ? value.remoteTeamId
    : null;
  const teamAgentIds = remoteConnectionId && remoteTeamId ? [] : agentIds;

  return {
    id: value.id,
    name: value.name,
    avatar: typeof value.avatar === 'string' ? value.avatar : undefined,
    color: typeof value.color === 'string' ? value.color : defaultTeamColor,
    ...(remoteConnectionId ? { remoteConnectionId } : {}),
    ...(remoteTeamId ? { remoteTeamId } : {}),
    agentIds: teamAgentIds,
    activeAgentId: typeof value.activeAgentId === 'string' && teamAgentIds.includes(value.activeAgentId)
      ? value.activeAgentId
      : undefined,
  };
}

function localRemoteTeamPointerIds(teams: Team[]): Set<string> {
  const ids = new Set<string>();
  for (const team of teams) {
    if (!isRemoteTeamPointer(team)) {
      continue;
    }
    // `remoteTeamId` is owned by another daemon and can collide with local team ids.
    // Only the local pointer team's id participates in local state repair/migration.
    ids.add(team.id);
  }
  return ids;
}

function assignmentsForAgents(assignments: WorkBacklogState['assignments'], agentIds: Set<string>): WorkBacklogState['assignments'] {
  return Object.fromEntries(
    Object.entries(assignments).filter(([, assignment]) => agentIds.has(assignment.agentId)),
  );
}

function cloneBackendSession(session: BackendSession): BackendSession {
  return { ...session };
}

function cloneBackendDefaults(defaults: BackendDefaults): BackendDefaults {
  return defaults.kind === 'claude' && defaults.thinking
    ? { ...defaults, thinking: { ...defaults.thinking } }
    : { ...defaults };
}

function cloneThreadPlan(plan: ThreadPlan): ThreadPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => ({ ...step })),
  };
}

function sanitizeBackend(value: unknown): AgentBackend | null {
  return value === 'codex' || value === 'claude' || value === 'antigravity' ? value : null;
}

function sanitizeBackendSession(value: unknown, expectedBackend: AgentBackend): BackendSession | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return undefined;
  }
  if (value.kind === 'antigravity' && expectedBackend === 'antigravity' && typeof value.sessionId === 'string') {
    return { kind: 'antigravity', sessionId: value.sessionId };
  }

  if (value.kind === 'codex') {
    const session = typeof value.threadId === 'string'
      ? { kind: 'codex' as const, threadId: value.threadId }
      : undefined;
    return session?.kind === expectedBackend ? session : undefined;
  }

  if (value.kind === 'claude') {
    if (
      typeof value.sessionId !== 'string' ||
      (value.transport !== 'stdio' && value.transport !== 'websocket')
    ) {
      return undefined;
    }

    const session = {
      kind: 'claude',
      sessionId: value.sessionId,
      transport: value.transport,
      ...(typeof value.transcriptSessionId === 'string' ? { transcriptSessionId: value.transcriptSessionId } : {}),
      ...(typeof value.transcriptFolder === 'string' ? { transcriptFolder: value.transcriptFolder } : {}),
      ...(typeof value.serverUrl === 'string' ? { serverUrl: value.serverUrl } : {}),
      ...(typeof value.model === 'string' ? { model: value.model } : {}),
      ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}),
    } satisfies BackendSession;
    return session.kind === expectedBackend ? session : undefined;
  }

  return undefined;
}

function sanitizeBackendDefaults(value: unknown, expectedBackend: AgentBackend): BackendDefaults | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return undefined;
  }
  if (value.kind === 'antigravity' && expectedBackend === 'antigravity') return {
    kind: 'antigravity',
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(value.userSelectedModel === true ? { userSelectedModel: true } : {}),
    ...(typeof value.permissionMode === 'string' ? { permissionMode: value.permissionMode } : {}),
  };

  if (value.kind === 'codex') {
    const defaults = {
      kind: 'codex',
      ...(typeof value.model === 'string' ? { model: value.model } : {}),
      ...(value.userSelectedModel === true ? { userSelectedModel: true } : {}),
      ...(isCodexApprovalPreset(value.approvalPreset) ? { approvalPreset: value.approvalPreset } : {}),
      ...(typeof value.approvalPolicy === 'string' ? { approvalPolicy: value.approvalPolicy } : {}),
      ...(isCodexApprovalsReviewer(value.approvalsReviewer) ? { approvalsReviewer: value.approvalsReviewer } : {}),
      ...(typeof value.sandboxMode === 'string' ? { sandboxMode: value.sandboxMode } : {}),
      ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}),
      ...(value.serviceTier === null || typeof value.serviceTier === 'string' ? { serviceTier: value.serviceTier } : {}),
    } satisfies BackendDefaults;
    return defaults.kind === expectedBackend ? defaults : undefined;
  }

  if (value.kind === 'claude') {
    const thinking = sanitizeClaudeThinking(value.thinking);
    const defaults = {
      kind: 'claude',
      ...(typeof value.model === 'string' ? { model: value.model } : {}),
      ...(value.userSelectedModel === true ? { userSelectedModel: true } : {}),
      ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}),
      ...(value.serviceTier === null || typeof value.serviceTier === 'string' ? { serviceTier: value.serviceTier } : {}),
      ...(typeof value.permissionMode === 'string' ? { permissionMode: value.permissionMode } : {}),
      ...(thinking ? { thinking } : {}),
    } satisfies BackendDefaults;
    return defaults.kind === expectedBackend ? defaults : undefined;
  }

  return undefined;
}

function sanitizeClaudeThinking(value: unknown): Extract<BackendDefaults, { kind: 'claude' }>['thinking'] | undefined {
  if (!isRecord(value) || (value.type !== 'enabled' && value.type !== 'disabled')) {
    return undefined;
  }

  return {
    type: value.type,
    ...(typeof value.budgetTokens === 'number' ? { budgetTokens: value.budgetTokens } : {}),
  };
}

function repairTeamMembership(snapshot: AppSnapshot): void {
  const fallbackTeam = snapshot.teams.find((team) => !isRemoteTeamPointer(team));
  if (!fallbackTeam) {
    snapshot.agents = [];
    return;
  }

  for (const agent of snapshot.agents) {
    const team = snapshot.teams.find((candidate) => candidate.id === agent.teamId && !isRemoteTeamPointer(candidate)) ?? fallbackTeam;
    agent.teamId = team.id;
    if (!team.agentIds.includes(agent.id)) {
      team.agentIds.push(agent.id);
    }
  }
}

function repairedActiveTeamId(snapshot: AppSnapshot): string | null {
  if (snapshot.activeTeamId && snapshot.teams.some((team) => team.id === snapshot.activeTeamId)) {
    return snapshot.activeTeamId;
  }

  const activeAgent = snapshot.agents.find((agent) => agent.id === snapshot.activeAgentId);
  if (activeAgent?.teamId && snapshot.teams.some((team) => team.id === activeAgent.teamId)) {
    return activeAgent.teamId;
  }

  return snapshot.teams[0]?.id ?? null;
}

function isRemoteTeamPointer(team: Team): boolean {
  return Boolean(team.remoteConnectionId && team.remoteTeamId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error);
}
