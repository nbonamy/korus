import { product } from '@workspace/core/product';
import { createAntigravityConversationState } from './antigravity-conversation-state';
import type { AntigravityConversationSnapshot } from '@workspace/core/contracts/antigravity-conversation';

import { translate } from './i18n';
import { localizedErrorMessage } from './i18n/errors';
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { PlanReviewResolution } from '@workspace/core/plan-review';
import type { AgentGitBranchInput, AgentGitCommitInput, AgentGitMessageGenerationInput, AgentGitMessageGenerationResult, AgentGitPullRequestInput, AgentGitPushInput, AgentGitStageInput, AgentGitUpdateFromBaseInput, AgentGitUpdateFromBaseResult, AgentGitWorkflow } from '@workspace/core/contracts';
import type { AgentCreationProgress, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import type { MissionImplementationStartProgress } from '@workspace/core/mission-execution';
import type { AddSshConnectionInput, Agent, AgentFileActivity, AgentFilePreviewResult, ApprovalPreset, AppPluginStatus, AppSnapshot, BackendApprovalDecision, BackendApprovalScope, BackendCapabilities, BackendCommandSummary, BackendConnectionState, BackendConversationRef, DaemonStatus, ClientRequestResponse, CodexResourceSharingStatus, ConversationListInput, ConversationResumeTarget, ConversationSummary, CreateAgentInput, CreateAutomationInput, CreateQuickChatInput, CreateSourceWorktreeInput, CreateTeamInput, DevicePairingSession, DevicePairingStatus, DuplicateAgentOptions, AutomationLocation, MainToRendererEvent, MoveAgentToTeamInput, OpenInApplication, OpenInApplicationCatalog, PairedDevice, RendererMessage, RendererSnapshotState, ReorderAgentsInput, ReorderRepositoriesInput, ReorderTeamsInput, RendererSendPromptOptions, SetCodexResourceSharingInput, SidePanelRequest, SourceFolderListing, SourceFolderListInput, SshHostCandidate, Team, UpdateAgentInput, UpdateAutomationInput, UpdateRemoteConnectionInput, UpdateSettingsInput, UpdateTeamInput, WorkItem } from '@workspace/core/contracts';
import { selectAgent as selectAgentInSnapshot } from '@workspace/core/agent-manager';
import { selectTeam as selectTeamInSnapshot } from '@workspace/core/team-manager';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { applyMainEventToSnapshot } from '@workspace/core/snapshot';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { defaultBackendCommands } from '@workspace/core/backend-commands';
import { approvalPresetFromDefaults } from '@workspace/core/approval-presets';
import { type CodexComposerState, type CodexNativeAttachment } from '@codex-app-sdk/vue';
import {
  createCodexConversationReplica,
  type CodexConversationReplica,
} from '@codex-app-sdk/core/conversation-replica';
import type { CodexConversationSnapshot } from '@codex-app-sdk/core/surface';
import {
  createClaudeConversationReplica,
  type ClaudeConversationReplica,
} from '@workspace/core/claude-conversation-replica';
import type { ClaudeConversationSnapshot } from '@workspace/core/contracts';
import { workItemAssignmentPrompt } from '@workspace/core/work-item-prompts';
import { decodeAppSnapshot, isAppSnapshot } from '@workspace/core/snapshot-guards';
import { appText } from '@workspace/core/app-text';
import { useConfetti } from './shared/confetti/use-confetti';
import { appHostCapabilities, appApi } from './platform-api';
import { createWorkProviderState, isRemoteAutomationLocation } from './work-provider-state';
import { createAgentComposerState, type AgentComposerConfiguration } from './agent-composer-state';
import { createAgentUnreadState } from './agent-unread-state';
import { createAgentHistoryState } from './agent-history-state';
import { createSourceRepositoryState } from './source-repository-state';
import { workspaceSidebarRepositoryRootForAgent } from '@workspace/core/workspace-sidebar';
import { isSnapshotEventOwnedBy, type RendererOnlySnapshotEvent } from '@workspace/core/snapshot-event-ownership';

const snapshot = ref<AppSnapshot>(createEmptySnapshot());
const hasLoadedSnapshot = ref(false);
const isLoading = ref(false);
const connectionState = ref<BackendConnectionState>({ status: 'connecting' });
const sendingAgentIds = ref(new Set<string>());
const composerStatesByAgentId = ref<Record<string, CodexComposerState>>({});
const composerAttachmentsByAgentId = ref<Record<string, CodexNativeAttachment[]>>({});
const answeredClientRequestIds = ref(new Set<string>());
const sidePanelRequest = ref<SidePanelRequest | null>(null);
const markdownDisplayRequests = ref<Array<Extract<SidePanelRequest, { kind: 'markdown' }>>>([]);
function consumeMarkdownDisplayRequests(count: number): void {
  markdownDisplayRequests.value = markdownDisplayRequests.value.slice(count);
}
const fileActivity = ref<AgentFileActivity | null>(null);
const openInApplications = ref<OpenInApplicationCatalog>({
  defaultApplication: 'finder',
  applications: [],
});
const daemonStatus = ref<DaemonStatus | null>(null);
const daemonStatusError = ref<string | null>(null);
const codexResourceSharingStatus = ref<CodexResourceSharingStatus>({ enabled: true, migrationRequired: false });
const backendRestartInProgress = ref(false);
const agentCreationProgresses = ref<AgentCreationProgress[]>([]);
const backgroundedAgentCreationIds = new Set<string>();
const missionImplementationStartProgress = ref<MissionImplementationStartProgress | null>(null);
/** An agent asked to open a Mission. The sequence makes repeated requests for one Mission distinct. */
const missionFocusRequest = ref<{ missionId: string; sequence: number } | null>(null);
let missionFocusSequence = 0;
const codexConversationFramesByAgentId = ref<Record<string, {
  replica: CodexConversationReplica;
  revision: number;
  snapshot: CodexConversationSnapshot;
  threadId: string;
}>>({});
const claudeConversationFramesByAgentId = ref<Record<string, {
  replica: ClaudeConversationReplica;
  revision: number;
  snapshot: ClaudeConversationSnapshot;
}>>({});
const recoveringCodexConversationAgentIds = new Set<string>();
const recoveringClaudeConversationAgentIds = new Set<string>();
const antigravityConversations = createAntigravityConversationState(async agentId => {
  if (appApi?.loadConversationHistory) adoptBackgroundSnapshot(await appApi.loadConversationHistory(agentId));
});
let agentSelectionRequestId = 0;
let unsubscribeMainEvents: (() => void) | null = null;
let bufferedMainEvents: MainToRendererEvent[] | null = null;
let lastBackendEventSeq = 0;
let rendererSynchronization: Promise<void> | null = null;
let synchronizeRendererSnapshotRequest: (() => Promise<void>) | null = null;
let rendererConnectionRecovery: Promise<void> | null = null;
const workProviders = createWorkProviderState({
  adoptSnapshot: adoptBackgroundSnapshot,
  getSnapshot: () => snapshot.value,
});
const {
  assignedItemsByProvider: assignedWorkItemsByProvider,
  authorization: workProviderAuthorization,
  authorizations: workProviderAuthorizations,
  authorizationErrors: workProviderAuthorizationErrors,
  completeConnection: pollWorkProviderAuthorization,
  configure: configureWorkBacklog,
  connect: connectWorkProvider,
  disconnect: disconnectWorkProvider,
  error: workBacklogError,
  catalogState: workBacklogStateFor,
  itemsByRepository: workItemsByRepository,
  loadAssignedItems: loadAssignedWorkItems,
  loadConnected: loadConnectedWorkBacklogs,
  loadGlobalItems: loadGlobalWorkItems,
  loadItems: loadWorkItems,
  loadRepositories: loadWorkRepositories,
  openAuthorization: openWorkProviderAuthorization,
  repositoriesByProvider: workRepositoriesByProvider,
  status: workBacklogStatus,
} = workProviders;
const agentComposer = createAgentComposerState({
  getSnapshot: () => snapshot.value,
  persistSelection: async (agentId, modelSelection) => {
    const api = appApi;
    if (!api?.updateAgent) throw new Error('Agent settings are unavailable.');
    const updated = await api.updateAgent({ id: agentId, modelSelection });
    if (api === appApi) adoptBackgroundSnapshot(updated);
  },
  onSelectionSaveError: (error) => ElMessage.error(error instanceof Error ? error.message : String(error)),
});
const {
  agentFiles,
  backendModels,
  backendPlugins,
  backendSkills,
  clearActive: clearActiveComposerConfiguration,
  fileCatalogError,
  fileCatalogStatus,
  handleMainEvent: syncComposerStateFromMainEvent,
  loadActive: loadActiveAgentCatalogs,
  loadAll: loadAllAgentCatalogs,
  loadFiles: loadAgentFilesForActiveAgent,
  loadModels: loadBackendModelsForActiveAgent,
  loadPlugins: loadBackendPluginsForActiveAgent,
  loadSkills: loadBackendSkillsForActiveAgent,
  modelCatalogError,
  modelCatalogStatus,
  planMode,
  rememberActive: rememberActiveComposerConfiguration,
  resetIfSourceChanged: resetCatalogStateIfSourceChanged,
  resolvePromptOptions: resolvedPromptOptions,
  restore: restoreComposerConfiguration,
  selectModel,
  selectModelForAgent,
  selectedModelId,
  selectedReasoningEffort,
  selectedServiceTier,
  selectReasoningEffort,
  selectReasoningEffortForAgent,
  selectServiceTier,
  selectServiceTierForAgent,
  setPlanMode,
  setPlanModeForAgent,
  configurationForAgent,
  skillCatalogError,
  skillCatalogStatus,
  synchronizeAgentSelection: synchronizeComposerSelectionForAgent,
} = agentComposer;
const agentUnread = createAgentUnreadState({ getSnapshot: () => snapshot.value });
const {
  handleMainEvent: syncUnreadStateFromMainEvent,
  markDebugAgentsUnread,
  markRead: markAgentRead,
  prune: pruneUnreadAgentIds,
  reset: resetUnreadAgentIds,
  setRendererWindowFocused,
  unreadAgentIds,
} = agentUnread;
const agentHistory = createAgentHistoryState({
  adoptSnapshot: adoptBackgroundSnapshot,
  getSnapshot: () => snapshot.value,
  synchronizeComposerSelection: synchronizeComposerSelectionForAgent,
});
const {
  activeHistoryHasOlder,
  handleMainEvent: syncHistoryPageStateFromMainEvent,
  hydrateActive: hydrateActiveAgentHistory,
  hydrate: hydrateAgentHistory,
  retryActive: retryActiveAgentHistory,
  isActiveAgentHistoryFailed,
  isHydratingActiveAgentHistory,
  isLoadingOlderHistory,
  loadOlder: loadOlderAgentHistory,
  markHydrating: markAgentHistoryHydrating,
  reset: resetAgentHistory,
  statusFor: agentHistoryStatusFor,
} = agentHistory;

export type AgentConversationView = {
  agent: Agent;
  codexSnapshot: CodexConversationSnapshot | null;
  claudeSnapshot: ClaudeConversationSnapshot | null;
  antigravitySnapshot?: AntigravityConversationSnapshot | null;
  composer: AgentComposerConfiguration;
  composerState: CodexComposerState;
  attachments: readonly CodexNativeAttachment[];
  capabilities: BackendCapabilities;
  approvals: AppSnapshot['backendApprovals'][string];
  queuedPrompts: NonNullable<AppSnapshot['queuedPrompts']>;
  history: ReturnType<typeof agentHistoryStatusFor>;
  sending: boolean;
  answeredClientRequestIds: ReadonlySet<string>;
};
const sourceRepositoryState = createSourceRepositoryState({ getSnapshot: () => snapshot.value });
const {
  clone: cloneSourceRepository,
  create: createSourceRepository,
  createWorktree: createSourceWorktree,
  error: sourceRepositoryError,
  list: listSourceRepositories,
  listBranches: listSourceBranches,
  listWorktrees: listSourceWorktrees,
  load: loadSourceRepositories,
  repositories: sourceRepositories,
  status: sourceRepositoryStatus,
} = sourceRepositoryState;

export function useAppState() {
  watch(() => {
    const agent = snapshot.value.agents.find((candidate) => candidate.id === snapshot.value.activeAgentId);
    return agent?.planReview && ['pending', 'revise'].includes(agent.planReview.status) ? agent.planReview.id : null;
  }, () => {
    const agent = snapshot.value.agents.find((candidate) => candidate.id === snapshot.value.activeAgentId);
    if (agent?.planReview && ['pending', 'revise'].includes(agent.planReview.status)) showPlanReview(agent.planReview.markdown);
  }, { immediate: true, flush: 'sync' });

  async function updatePlanReview(agentId: string, response: import('@workspace/core/plan-review').PlanReviewResponse): Promise<import('@workspace/core/plan-review').PlanReview> {
    if (!appApi) throw new Error('App is unavailable.');
    const next = await appApi.respondToPlanReview(agentId, response);
    adoptBackgroundSnapshot(next);
    const plan = next.agents.find(agent => agent.id === agentId)?.planReview;
    if (!plan) throw new Error('Plan is unavailable.');
    return plan;
  }

  async function respondToPlanReviewForAgent(agentId: string, resolution: PlanReviewResolution, feedback?: string): Promise<void> {
    const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
    if (!agent?.planReview || !appApi) throw new Error('No pending plan review.');
    adoptBackgroundSnapshot(await appApi.respondToPlanReview(agent.id, {
      reviewId: agent.planReview.id, resolution, ...(feedback ? { feedback } : {}),
    }));
  }

  async function respondToThreadFlag(response: import('@workspace/core/thread-flags').ThreadFlagResponse): Promise<void> {
    const agentId = snapshot.value.activeAgentId;
    if (agentId) await respondToThreadFlagForAgent(agentId, response);
  }

  async function respondToThreadFlagForAgent(agentId: string, response: import('@workspace/core/thread-flags').ThreadFlagResponse): Promise<void> {
    const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
    if (!agent || agent.threadFlags?.[response.id] !== true || !appApi) {
      throw new Error('No active thread flag.');
    }
    adoptBackgroundSnapshot(await appApi.respondToThreadFlag(agent.id, response));
  }

  async function startCodeReview(agentId: string, input: import('@workspace/core/code-review').CodeReviewStartInput): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.startCodeReview(agentId, input);
    if (input.threadMode === 'independent') adoptNavigationSnapshot(next);
    else adoptBackgroundSnapshot(next);
    return next;
  }

  async function startVisualize(agentId: string, input?: import('@workspace/core/visualize').StartVisualizeInput): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.startVisualize(agentId, input);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function setVisualizeOpen(agentId: string, input: import('@workspace/core/visualize').SetVisualizeOpenInput): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.setVisualizeOpen(agentId, input);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function generateVisualizationSuggestion(agentId: string, input: import('@workspace/core/visualize').GenerateVisualizationSuggestionInput): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.generateVisualizationSuggestion(agentId, input);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function selectVisualization(agentId: string, input: import('@workspace/core/visualize').SelectVisualizationInput): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.selectVisualization(agentId, input);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function deleteVisualization(agentId: string, input: import('@workspace/core/visualize').DeleteVisualizationInput): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.deleteVisualization(agentId, input);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function readVisualizationAsset(agentId: string, visualizationId: string): Promise<import('@workspace/core/visualize').VisualizationAsset> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    return appApi.readVisualizationAsset(agentId, visualizationId);
  }

  async function decideCodeReviewFinding(agentId: string, input: import('@workspace/core/code-review').CodeReviewDecisionInput): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.decideCodeReviewFinding(agentId, input);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function discussCodeReviewFinding(agentId: string, input: import('@workspace/core/code-review').CodeReviewDiscussionInput): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.discussCodeReviewFinding(agentId, input);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function submitCodeReviewRound(agentId: string, sessionId: string): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.submitCodeReviewRound(agentId, sessionId);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function finishCodeReview(agentId: string, sessionId: string): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.finishCodeReview(agentId, sessionId);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function commitCodeReview(agentId: string, sessionId: string): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.commitCodeReview(agentId, sessionId);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function discardCodeReview(agentId: string, sessionId: string): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.discardCodeReview(agentId, sessionId);
    adoptBackgroundSnapshot(next);
    return next;
  }

  async function reviewCodeAgain(agentId: string, sessionId: string): Promise<AppSnapshot> {
    if (!appApi) throw new Error(`${product.name} API is unavailable.`);
    const next = await appApi.reviewCodeAgain(agentId, sessionId);
    adoptBackgroundSnapshot(next);
    return next;
  }
  const activeAgent = computed(() => {
    return snapshot.value.agents.find((agent) => agent.id === snapshot.value.activeAgentId) ?? null;
  });

  const activeBackendCapabilities = computed(() => backendCapabilitiesForAgent(activeAgent.value));
  const activeBackendCommands = computed<BackendCommandSummary[]>(() => defaultBackendCommands(activeAgent.value?.backend ?? 'codex'));
  const activeCodexConversationSnapshot = computed(() => {
    const agent = activeAgent.value;
    if (!agent || agent.backend !== 'codex' || agent.backendSession?.kind !== 'codex') return null;
    const frame = codexConversationFramesByAgentId.value[agent.id];
    return frame?.threadId === agent.backendSession.threadId ? frame.snapshot : null;
  });
  const activeClaudeConversationSnapshot = computed(() => {
    const agent = activeAgent.value;
    if (!agent || agent.backend !== 'claude') return null;
    const frame = claudeConversationFramesByAgentId.value[agent.id];
    const sessionId = agent.backendSession?.kind === 'claude' ? agent.backendSession.sessionId : null;
    return !frame || (sessionId && frame.snapshot.sessionId !== sessionId) ? null : frame.snapshot;
  });

  function agentConversationFor(agentId: string): AgentConversationView | null {
    const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
    if (!agent) return null;
    const codexFrame = codexConversationFramesByAgentId.value[agentId];
    const claudeFrame = claudeConversationFramesByAgentId.value[agentId];
    const sessionId = agent.backendSession?.kind === 'claude' ? agent.backendSession.sessionId : null;
    return {
      agent,
      antigravitySnapshot: antigravityConversations.select(agent),
      codexSnapshot: agent.backend === 'codex' && agent.backendSession?.kind === 'codex' && codexFrame?.threadId === agent.backendSession.threadId
        ? codexFrame.snapshot : null,
      claudeSnapshot: agent.backend === 'claude' && claudeFrame && (!sessionId || claudeFrame.snapshot.sessionId === sessionId)
        ? claudeFrame.snapshot : null,
      composer: configurationForAgent(agentId),
      composerState: composerStatesByAgentId.value[agentId] ?? emptyComposerState(),
      attachments: composerAttachmentsByAgentId.value[agentId] ?? [],
      capabilities: backendCapabilitiesForAgent(agent),
      approvals: snapshot.value.backendApprovals[agentId] ?? [],
      queuedPrompts: (snapshot.value.queuedPrompts ?? []).filter((prompt) => prompt.agentId === agentId),
      history: agentHistoryStatusFor(agentId),
      sending: isAgentSending(agentId),
      answeredClientRequestIds: answeredClientRequestIds.value,
    };
  }

  async function prepareAgentConversation(agentId: string): Promise<void> {
    if (!snapshot.value.agents.some((agent) => agent.id === agentId)) return;
    await Promise.all([
      loadActiveAgentCatalogs(agentId),
      ...(agentNeedsHistory(agentId) || agentHistoryStatusFor(agentId).failed ? [hydrateAgentHistory(agentId)] : []),
    ]);
  }

  const activeQueuedPrompts = computed(() => {
    const agentId = activeAgent.value?.id;
    return agentId ? (snapshot.value.queuedPrompts ?? []).filter((prompt) => prompt.agentId === agentId) : [];
  });

  const activeComposerState = computed<CodexComposerState>(() => {
    const agentId = activeAgent.value?.id;
    return agentId
      ? composerStatesByAgentId.value[agentId] ?? emptyComposerState()
      : emptyComposerState();
  });

  const activeComposerAttachments = computed<readonly CodexNativeAttachment[]>(() => {
    const agentId = activeAgent.value?.id;
    return agentId ? composerAttachmentsByAgentId.value[agentId] ?? [] : [];
  });

  function updateComposerState(agentId: string, state: CodexComposerState): void {
    if (!snapshot.value.agents.some((agent) => agent.id === agentId)) return;
    composerStatesByAgentId.value = {
      ...composerStatesByAgentId.value,
      [agentId]: { ...state },
    };
  }

  function updateComposerAttachments(agentId: string, attachments: readonly CodexNativeAttachment[]): void {
    if (!snapshot.value.agents.some((agent) => agent.id === agentId)) return;
    composerAttachmentsByAgentId.value = {
      ...composerAttachmentsByAgentId.value,
      [agentId]: attachments.map((attachment) => ({ ...attachment })),
    };
  }

  const activeBackendApprovals = computed(() => {
    const agentId = activeAgent.value?.id;
    return agentId ? snapshot.value.backendApprovals[agentId] ?? [] : [];
  });

  const activeGoal = computed(() => activeAgent.value?.goal ?? null);
  const activeApprovalPreset = computed<ApprovalPreset | null>(() => {
    const agent = activeAgent.value;
    const capabilities = backendCapabilitiesForAgent(agent);
    if (!agent || !capabilities.approvals) {
      return null;
    }

    const allowedPresets = capabilities.approvalPresets ?? [];
    const storedPreset = approvalPresetFromDefaults(agent.backendDefaults);
    if (allowedPresets.includes(storedPreset)) {
      return storedPreset;
    }

    return allowedPresets[0] ?? null;
  });

  const activePermissionMode = computed<string | null>(() => {
    const agent = activeAgent.value;
    if (!agent) {
      return null;
    }

    const modes = backendCapabilitiesForAgent(agent).permissionModes ?? [];
    const storedMode = agent.backendDefaults && 'permissionMode' in agent.backendDefaults
      ? agent.backendDefaults.permissionMode
      : undefined;
    if (storedMode && modes.some((option) => option.id === storedMode)) {
      return storedMode;
    }

    return modes[0]?.id ?? null;
  });

  const isSending = computed(() => {
    const agent = activeAgent.value;
    if (!agent) {
      return false;
    }

    return sendingAgentIds.value.has(agent.id) ||
      agent.status.type === 'working' ||
      agent.status.type === 'awaitingInput';
  });

  async function loadSnapshot(): Promise<void> {
    if (!appApi) {
      return;
    }

    resetCatalogStateIfSourceChanged(appApi);
    resetUnreadAgentIds();
    codexConversationFramesByAgentId.value = {};
    claudeConversationFramesByAgentId.value = {};
    antigravityConversations.reset();
    recoveringCodexConversationAgentIds.clear();
    recoveringClaudeConversationAgentIds.clear();
    agentCreationProgresses.value = [];
    backgroundedAgentCreationIds.clear();

    isLoading.value = true;
    bufferedMainEvents = [];
    subscribeToMainEvents();

    try {
      await synchronizeRendererSnapshot(false);
      if (snapshot.value.activeAgentId) restoreComposerConfiguration(snapshot.value.activeAgentId);
      // The SDK publishes a bounded initial page immediately. Older pages stay
      // behind the conversation's demand-paging cursor until the user reaches
      // the top of the transcript.
      void hydrateActiveAgentHistory().catch(() => undefined);
      void loadAllAgentCatalogs().catch(() => undefined);
      await Promise.all([
        loadActiveAgentCatalogs(),
        loadConnectedWorkBacklogs(),
        loadSourceRepositories(),
        loadDaemonStatus(),
        loadCodexResourceSharingStatus(),
      ]);
    } catch (error) {
      connectionState.value = {
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      const pendingConnectionEvents = bufferedMainEvents?.filter(event => event.type === 'client.connectionChanged') ?? [];
      bufferedMainEvents = null;
      isLoading.value = false;
      for (const event of pendingConnectionEvents) handleMainEvent(event);
    }

  }

  async function synchronizeRendererSnapshot(preserveActiveSelection: boolean): Promise<void> {
    if (rendererSynchronization) return rendererSynchronization;
    rendererSynchronization = performRendererSynchronization(preserveActiveSelection).finally(() => {
      rendererSynchronization = null;
    });
    return rendererSynchronization;
  }
  synchronizeRendererSnapshotRequest = async () => {
    await synchronizeRendererSnapshot(true);
    // App snapshots cannot repair provider events skipped by the global
    // sequence fence. Refresh every cached pane from its conversation owner,
    // including split panes and inactive agents, before trusting those frames.
    for (const agentId of Object.keys(codexConversationFramesByAgentId.value)) {
      invalidateAndRecoverCodexConversation(agentId);
    }
    for (const agentId of Object.keys(claudeConversationFramesByAgentId.value)) {
      invalidateAndRecoverClaudeConversation(agentId);
    }
    antigravityConversations.recoverAll();
  };

  async function performRendererSynchronization(preserveActiveSelection: boolean): Promise<void> {
    bufferedMainEvents ??= [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await readRendererSnapshotState();
      const activeAgentId = preserveActiveSelection ? snapshot.value.activeAgentId : null;
      if (activeAgentId && state.snapshot.agents.some((agent) => agent.id === activeAgentId)) {
        selectAgentInSnapshot(state.snapshot, activeAgentId);
      }
      snapshot.value = state.snapshot;
      pruneUnreadAgentIds();
      pruneConversationFrames();
      connectionState.value = state.connection;
      lastBackendEventSeq = state.lastBackendEventSeq;
      const buffered = bufferedMainEvents;
      bufferedMainEvents = [];
      let gap = false;
      for (const event of buffered) {
        if (!isBackendMainEvent(event)) {
          handleMainEvent(event);
          continue;
        }
        if (event.seq <= lastBackendEventSeq) continue;
        if (event.seq !== lastBackendEventSeq + 1) {
          gap = true;
          break;
        }
        lastBackendEventSeq = event.seq;
        handleMainEvent(event);
      }
      if (!gap) {
        // A connection event can overtake an in-flight read of the host's
        // disconnected cache. Re-read before treating that cache as loaded.
        if (state.connection.status !== 'connected' && connectionState.value.status === 'connected') continue;
        bufferedMainEvents = null;
        if (connectionState.value.status === 'connected') hasLoadedSnapshot.value = true;
        return;
      }
    }
    bufferedMainEvents = null;
    throw new Error(translate('surface.app-state.unableToSynchronizeTheConversationAfterRepeatedBackendEv'));
  }

  async function readRendererSnapshotState(): Promise<RendererSnapshotState> {
    if (appApi?.getSnapshotState) return appApi.getSnapshotState();
    return {
      snapshot: await appApi!.getSnapshot(),
      lastBackendEventSeq: 0,
      connection: { status: 'connected' },
    };
  }

  async function sendPrompt(prompt: string, submissionOptions?: RendererSendPromptOptions): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await sendPromptToAgent(agentId, prompt, submissionOptions);
  }

  async function sendPromptToAgent(agentId: string, prompt: string, submissionOptions?: RendererSendPromptOptions): Promise<void> {
    if (!snapshot.value.agents.some((agent) => agent.id === agentId) || !appApi) return;

    const parsedGoalCommand = parseGoalSlashCommand(prompt);
    if (parsedGoalCommand) {
      await handleGoalSlashCommand(agentId, parsedGoalCommand);
      return;
    }

    const parsedPlanCommand = parsePlanSlashCommand(prompt);
    if (parsedPlanCommand) {
      setPlanModeForAgent(agentId, true);
      if (!parsedPlanCommand.prompt) {
        return;
      }
    }

    const trimmed = parsedPlanCommand?.prompt ?? prompt.trim();
    if (!trimmed && !submissionOptions?.attachments?.length) {
      return;
    }

    await sendPromptForAgent(agentId, trimmed, submissionOptions);
  }

  async function steerPrompt(prompt: string, submissionOptions?: RendererSendPromptOptions): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await steerPromptToAgent(agentId, prompt, submissionOptions);
  }

  async function steerPromptToAgent(agentId: string, prompt: string, submissionOptions?: RendererSendPromptOptions): Promise<void> {
    if (!snapshot.value.agents.some((agent) => agent.id === agentId) || !appApi) return;

    const trimmed = prompt.trim();
    if (!trimmed && !submissionOptions?.attachments?.length) {
      return;
    }

    if (!isAgentSending(agentId)) {
      await sendPromptForAgent(agentId, trimmed, submissionOptions);
      return;
    }

    if (!messageActionCapabilities(agentId).steerPrompt || !appApi.steerPrompt) {
      await sendPromptForAgent(agentId, trimmed, submissionOptions);
      return;
    }

    const options = resolvedPromptOptions(agentId, trimmed, submissionOptions);
    adoptBackgroundSnapshot(options
      ? await appApi.steerPrompt(agentId, trimmed, options)
      : await appApi.steerPrompt(agentId, trimmed));
  }

  async function interruptActiveAgent(): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await interruptAgentById(agentId);
  }

  async function interruptAgentById(agentId: string): Promise<void> {
    if (!agentId || !appApi?.interruptAgent || !isAgentSending(agentId)) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.interruptAgent(agentId));
  }

  async function deleteTurn(turnId: string): Promise<void> {
    const agentId = snapshot.value.activeAgentId;
    if (agentId) await deleteTurnForAgent(agentId, turnId);
  }

  async function deleteTurnForAgent(agentId: string, turnId: string): Promise<void> {
    if (!agentId || !appApi?.deleteTurn || isAgentSending(agentId)) {
      return;
    }

    if (!messageActionCapabilities(agentId).deleteTurn) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.deleteTurn(agentId, turnId));
  }

  async function editTurn(payload: { content: string; turnId: string }): Promise<void> {
    const agentId = snapshot.value.activeAgentId;
    if (agentId) await editTurnForAgent(agentId, payload);
  }

  async function editTurnForAgent(agentId: string, payload: { content: string; turnId: string }): Promise<void> {
    const trimmed = payload.content.trim();
    if (!agentId || !trimmed || !appApi?.editTurn || isAgentSending(agentId)) {
      return;
    }

    if (!messageActionCapabilities(agentId).editTurn) {
      return;
    }

    markAgentSending(agentId, true);
    try {
      adoptBackgroundSnapshot(await appApi.editTurn(agentId, payload.turnId, trimmed));
    } finally {
      markAgentSending(agentId, false);
    }
  }

  async function retryTurn(turnId: string): Promise<void> {
    const agentId = snapshot.value.activeAgentId;
    if (agentId) await retryTurnForAgent(agentId, turnId);
  }

  async function retryTurnForAgent(agentId: string, turnId: string): Promise<void> {
    if (!agentId || !appApi?.retryTurn || isAgentSending(agentId)) {
      return;
    }

    if (!messageActionCapabilities(agentId).retryTurn) {
      return;
    }

    markAgentSending(agentId, true);
    try {
      adoptBackgroundSnapshot(await appApi.retryTurn(agentId, turnId));
    } finally {
      markAgentSending(agentId, false);
    }
  }

  async function continueInterruptedTurn(): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await continueInterruptedTurnForAgent(agentId);
  }

  async function continueInterruptedTurnForAgent(agentId: string): Promise<void> {
    const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
    if (agent?.backend !== 'codex' || !agent.backendSession || !appApi?.continueInterruptedTurn || isAgentSending(agent.id)) {
      return;
    }

    markAgentSending(agent.id, true);
    try {
      adoptBackgroundSnapshot(await appApi.continueInterruptedTurn(agent.id));
    } finally {
      markAgentSending(agent.id, false);
    }
  }

  async function updateQueuedPrompt(promptId: string, prompt: string): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await updateQueuedPromptForAgent(agentId, promptId, prompt);
  }

  async function updateQueuedPromptForAgent(agentId: string, promptId: string, prompt: string): Promise<void> {
    if (!agentId || !appApi?.updateQueuedPrompt) {
      return;
    }
    adoptBackgroundSnapshot(await appApi.updateQueuedPrompt(agentId, promptId, prompt));
  }

  async function steerQueuedPrompt(promptId: string, prompt?: string): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await steerQueuedPromptForAgent(agentId, promptId, prompt);
  }

  async function steerQueuedPromptForAgent(agentId: string, promptId: string, prompt?: string): Promise<void> {
    if (!agentId || !messageActionCapabilities(agentId).steerPrompt || !appApi?.steerQueuedPrompt) {
      return;
    }
    adoptBackgroundSnapshot(await appApi.steerQueuedPrompt(agentId, promptId, prompt));
  }

  async function removeQueuedPrompt(promptId: string): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await removeQueuedPromptForAgent(agentId, promptId);
  }

  async function removeQueuedPromptForAgent(agentId: string, promptId: string): Promise<void> {
    if (agentId && appApi?.deleteQueuedPrompt) {
      adoptBackgroundSnapshot(await appApi.deleteQueuedPrompt(agentId, promptId));
    }
  }

  async function sendPromptForAgent(
    agentId: string,
    prompt: string,
    submissionOptions?: RendererSendPromptOptions,
  ): Promise<void> {
    await sendPreparedPromptForAgent(
      agentId,
      prompt,
      resolvedPromptOptions(agentId, prompt, submissionOptions),
    );
  }

  async function sendPreparedPromptForAgent(
    agentId: string,
    prompt: string,
    options?: RendererSendPromptOptions,
  ): Promise<void> {
    const api = appApi;
    if (!api) {
      return;
    }

    markAgentSending(agentId, true);

    try {
      adoptBackgroundSnapshot(options
        ? await api.sendPrompt(agentId, prompt, options)
        : await api.sendPrompt(agentId, prompt));
    } finally {
      markAgentSending(agentId, false);
    }
  }

  async function sendAgentPrompt(agentId: string, prompt: string): Promise<void> {
    const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
    const trimmed = prompt.trim();
    if (!agent || !trimmed || !appApi) {
      return;
    }

    await sendPromptForAgent(agent.id, trimmed);
  }

  async function selectAgent(agentId: string): Promise<void> {
    if (!appApi?.selectAgent || !snapshot.value.agents.some((agent) => agent.id === agentId)) {
      return;
    }

    const requestId = ++agentSelectionRequestId;
    const needsHistory = agentNeedsHistory(agentId);
    rememberActiveComposerConfiguration();
    snapshot.value = selectAgentInSnapshot(snapshot.value, agentId);
    markAgentRead(agentId);
    restoreComposerConfiguration(agentId);
    if (needsHistory) markAgentHistoryHydrating(agentId, true);
    void loadActiveAgentCatalogs(agentId);
    void refreshAgentSelection(agentId, requestId, needsHistory);
  }

  async function chooseAgentFolder(): Promise<string | null> {
    return await appApi?.chooseAgentFolder?.() ?? null;
  }

  async function chooseSourceFolder(): Promise<string | null> {
    return await appApi?.chooseSourceFolder?.() ?? null;
  }

  async function listSourceFolders(input?: SourceFolderListInput): Promise<SourceFolderListing> {
    return await appApi?.listSourceFolders?.(input) ?? { path: '', parentPath: null, entries: [] };
  }

  async function suggestSourceWorktreePath(input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath' | 'remoteConnectionId'>): Promise<string> {
    return await appApi?.suggestSourceWorktreePath?.(input) ?? '';
  }

  async function chooseSourceWorktreeDestination(defaultPath: string): Promise<string | null> {
    return await appApi?.chooseSourceWorktreeDestination?.(defaultPath) ?? null;
  }

  async function previewAgentFile(agentId: string, filePath: string): Promise<AgentFilePreviewResult> {
    if (!appApi?.previewAgentFile) {
      throw new Error(translate('surface.app-state.filePreviewIsNotAvailable'));
    }

    return appApi.previewAgentFile(agentId, filePath);
  }

  async function getAgentGitDiff(agentId: string, target?: import('@workspace/core/contracts').AgentGitDiffTarget): Promise<import('@workspace/core/contracts').AgentGitDiff> {
    if (!appApi?.getAgentGitDiff) {
      throw new Error(translate('surface.app-state.gitDiffPreviewIsNotAvailable'));
    }

    return appApi.getAgentGitDiff(agentId, target ? { ...target } : undefined);
  }

  async function getAgentGitWorkflow(agentId: string, options?: { includePullRequest?: boolean }): Promise<AgentGitWorkflow> {
    if (!appApi?.getAgentGitWorkflow) throw new Error(translate('surface.app-state.gitWorkflowIsNotAvailable'));
    return options ? appApi.getAgentGitWorkflow(agentId, options) : appApi.getAgentGitWorkflow(agentId);
  }

  async function generateAgentGitMessage(agentId: string, input: AgentGitMessageGenerationInput): Promise<AgentGitMessageGenerationResult> {
    if (!appApi?.generateAgentGitMessage) throw new Error(translate('surface.app-state.gitMessageGenerationIsNotAvailable'));
    return appApi.generateAgentGitMessage(agentId, input);
  }

  async function stageAgentGitFiles(agentId: string, input: AgentGitStageInput): Promise<AgentGitWorkflow> {
    if (!appApi?.stageAgentGitFiles) throw new Error(translate('surface.app-state.gitStagingIsNotAvailable'));
    return appApi.stageAgentGitFiles(agentId, input);
  }

  async function commitAgentGitChanges(agentId: string, input: AgentGitCommitInput): Promise<AgentGitWorkflow> {
    if (!appApi?.commitAgentGitChanges) throw new Error(translate('surface.app-state.gitCommitIsNotAvailable'));
    return appApi.commitAgentGitChanges(agentId, input);
  }

  async function pushAgentGitBranch(agentId: string, input: AgentGitPushInput): Promise<AgentGitWorkflow> {
    if (!appApi?.pushAgentGitBranch) throw new Error(translate('surface.app-state.gitPushIsNotAvailable'));
    return appApi.pushAgentGitBranch(agentId, input);
  }

  async function createAgentGitBranch(agentId: string, input: AgentGitBranchInput): Promise<AgentGitWorkflow> {
    if (!appApi?.createAgentGitBranch) throw new Error(translate('surface.app-state.gitBranchCreationIsNotAvailable'));
    return appApi.createAgentGitBranch(agentId, input);
  }

  async function createAgentGitPullRequest(agentId: string, input: AgentGitPullRequestInput): Promise<AgentGitWorkflow> {
    if (!appApi?.createAgentGitPullRequest) throw new Error(translate('surface.app-state.pullRequestCreationIsNotAvailable'));
    return appApi.createAgentGitPullRequest(agentId, input);
  }

  async function mergeAgentGitBranch(agentId: string, input: import('@workspace/core/contracts').AgentGitMergeInput): Promise<AgentGitWorkflow> {
    if (!appApi?.mergeAgentGitBranch) throw new Error(translate('surface.app-state.gitMergeIsNotAvailable'));
    return appApi.mergeAgentGitBranch(agentId, input);
  }

  async function updateAgentGitBranchFromBase(agentId: string, input: AgentGitUpdateFromBaseInput): Promise<AgentGitUpdateFromBaseResult> {
    if (!appApi?.updateAgentGitBranchFromBase) throw new Error(translate('surface.app-state.gitUpdateFromBaseIsNotAvailable'));
    return appApi.updateAgentGitBranchFromBase(agentId, input);
  }

  async function pullAgentGitBranch(agentId: string, input: import('@workspace/core/contracts').AgentGitPullInput): Promise<import('@workspace/core/contracts').AgentGitPullResult> {
    if (!appApi?.pullAgentGitBranch) throw new Error(translate('surface.app-state.gitPullIsNotAvailable'));
    return appApi.pullAgentGitBranch(agentId, input);
  }

  async function revertAgentGitChanges(agentId: string, input: import('@workspace/core/contracts').AgentGitRevertInput): Promise<AgentGitWorkflow> {
    if (!appApi) throw new Error(translate('surface.app-state.gitRevertIsNotAvailable'));
    return appApi.revertAgentGitChanges(agentId, input);
  }

  async function loadOpenInApplications(): Promise<void> {
    if (!appHostCapabilities.openInApplications || !appApi?.getOpenInApplications) return;
    openInApplications.value = await appApi.getOpenInApplications();
  }

  async function openAgentPath(
    agentId: string,
    application: OpenInApplication,
    filePath?: string,
  ): Promise<void> {
    if (!appHostCapabilities.openInApplications || !appApi?.openAgentPath) {
      throw new Error(translate('surface.app-state.openInIsNotAvailable'));
    }
    adoptNavigationSnapshot(await appApi.openAgentPath(agentId, application, filePath));
  }

  async function createAgent(input: CreateAgentInput): Promise<Agent | null> {
    if (!appApi?.createAgent) {
      return null;
    }

    const previousAgentIds = new Set(snapshot.value.agents.map((agent) => agent.id));
    adoptNavigationSnapshot(await appApi.createAgent(input));
    await loadActiveAgentCatalogs();
    return snapshot.value.agents.find((agent) => !previousAgentIds.has(agent.id)) ?? activeAgent.value;
  }

  async function createProject(input: import('@workspace/core/contracts').CreateProjectInput): Promise<void> {
    if (!appApi?.createProject) throw new Error(translate('surface.app-state.repositoryCreationIsNotAvailable'));
    adoptNavigationSnapshot(await appApi.createProject(input));
    await Promise.all([loadActiveAgentCatalogs(), sourceRepositoryState.load()]);
  }

  async function executeMission(input: import('@workspace/core/mission-execution').MissionExecutionInput) {
    if (!appApi) throw new Error('Backend unavailable.');
    adoptNavigationSnapshot(await appApi.executeMission(input));
  }

  async function createMission(input: import('@workspace/core/missions').CreateMissionInput) {
    if (!appApi) throw new Error('Backend unavailable.');
    const previous = new Set(snapshot.value.missions?.map(m => m.id));
    adoptNavigationSnapshot(await appApi.createMission(input));
    return snapshot.value.missions!.find(m => !previous.has(m.id))!;
  }

  async function selectMission(missionId: string | null): Promise<void> {
    await appApi?.selectMission(missionId);
  }

  async function deleteMission(input: import('@workspace/core/missions').DeleteMissionInput) {
    if (!appApi) throw new Error('Missions unavailable.');
    adoptNavigationSnapshot(await appApi.deleteMission(input));
  }

  async function readMissionArtifact(missionId: string, stage: import('@workspace/core/missions').MissionStage) {
    if (!appApi) throw new Error('Mission artifacts unavailable.');
    return appApi.readMissionArtifact(missionId, stage);
  }

  async function updateMission(input: import('@workspace/core/missions').UpdateMissionInput) {
    if (!appApi) throw new Error('Backend unavailable.');
    adoptNavigationSnapshot(await appApi.updateMission(input));
  }

  async function createQuickChat(input: CreateQuickChatInput): Promise<Agent | null> {
    if (!appApi?.createQuickChat) return null;

    const previousAgentIds = new Set(snapshot.value.agents.map((agent) => agent.id));
    adoptNavigationSnapshot(await appApi.createQuickChat(input));
    await loadActiveAgentCatalogs();
    return snapshot.value.agents.find((agent) => !previousAgentIds.has(agent.id)) ?? activeAgent.value;
  }

  async function createTeam(input: CreateTeamInput): Promise<Team | null> {
    if (!appApi?.createTeam) {
      return null;
    }

    const previousTeamIds = new Set(snapshot.value.teams.map((team) => team.id));
    adoptNavigationSnapshot(await appApi.createTeam(input));
    await loadActiveAgentCatalogs();
    return snapshot.value.teams.find((team) => !previousTeamIds.has(team.id)) ?? null;
  }

  async function updateTeam(input: UpdateTeamInput): Promise<void> {
    if (!appApi?.updateTeam || !snapshot.value.teams.some((team) => team.id === input.id)) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.updateTeam(input));
  }

  async function reorderTeams(input: ReorderTeamsInput): Promise<void> {
    if (
      !appApi?.reorderTeams ||
      !snapshot.value.teams.some((team) => team.id === input.teamId) ||
      (input.beforeTeamId !== null && !snapshot.value.teams.some((team) => team.id === input.beforeTeamId))
    ) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.reorderTeams(input));
  }

  async function closeTeam(teamId: string): Promise<void> {
    const team = snapshot.value.teams.find(candidate => candidate.id === teamId);
    if (!appApi?.closeTeam || !team || (snapshot.value.teams.length <= 1 && !team.remoteConnectionId)) {
      return;
    }

    adoptNavigationSnapshot(await appApi.closeTeam(teamId));
    await loadActiveAgentCatalogs();
  }

  async function disconnectTeam(teamId: string): Promise<void> {
    const team = snapshot.value.teams.find(candidate => candidate.id === teamId);
    if (!appApi?.disconnectTeam || !team?.remoteConnectionId) {
      return;
    }

    adoptNavigationSnapshot(await appApi.disconnectTeam(teamId));
    await loadActiveAgentCatalogs();
  }

  async function selectTeam(teamId: string): Promise<void> {
    if (!appApi?.selectTeam || !snapshot.value.teams.some((team) => team.id === teamId)) {
      return;
    }

    const requestId = ++agentSelectionRequestId;
    rememberActiveComposerConfiguration();
    snapshot.value = selectTeamInSnapshot(snapshot.value, teamId);
    const selectedAgentId = snapshot.value.activeAgentId;
    const needsHistory = selectedAgentId ? agentNeedsHistory(selectedAgentId) : false;
    if (selectedAgentId) {
      markAgentRead(selectedAgentId);
      restoreComposerConfiguration(selectedAgentId);
      if (needsHistory) markAgentHistoryHydrating(selectedAgentId, true);
      void loadActiveAgentCatalogs(selectedAgentId);
    } else {
      clearActiveComposerConfiguration();
    }
    await refreshTeamSelection(teamId, requestId, selectedAgentId, needsHistory);
  }

  async function getAutomationSnapshot(location?: AutomationLocation): Promise<AppSnapshot> {
    if (!appApi?.getAutomationSnapshot || !isRemoteAutomationLocation(location)) {
      return snapshot.value;
    }

    return appApi.getAutomationSnapshot(location);
  }

  async function createAutomation(input: CreateAutomationInput, location?: AutomationLocation): Promise<AppSnapshot | void> {
    if (!appApi?.createAutomation) {
      return;
    }

    const nextSnapshot = location
      ? await appApi.createAutomation(input, location)
      : await appApi.createAutomation(input);
    if (!isRemoteAutomationLocation(location)) {
      adoptBackgroundSnapshot(nextSnapshot);
    }
    return nextSnapshot;
  }

  async function updateAutomation(input: UpdateAutomationInput, location?: AutomationLocation): Promise<AppSnapshot | void> {
    if (
      !appApi?.updateAutomation ||
      (!isRemoteAutomationLocation(location) && !snapshot.value.automations.some((automation) => automation.id === input.id))
    ) {
      return;
    }

    const nextSnapshot = location
      ? await appApi.updateAutomation(input, location)
      : await appApi.updateAutomation(input);
    if (!isRemoteAutomationLocation(location)) {
      adoptBackgroundSnapshot(nextSnapshot);
    }
    return nextSnapshot;
  }

  async function runAutomation(automationId: string, location?: AutomationLocation): Promise<AppSnapshot | void> {
    if (
      !appApi?.runAutomation ||
      (!isRemoteAutomationLocation(location) && !snapshot.value.automations.some((automation) => automation.id === automationId))
    ) {
      return;
    }

    const nextSnapshot = location
      ? await appApi.runAutomation(automationId, location)
      : await appApi.runAutomation(automationId);
    if (!isRemoteAutomationLocation(location)) {
      adoptBackgroundSnapshot(nextSnapshot);
    }
    return nextSnapshot;
  }

  async function deleteAutomation(automationId: string, location?: AutomationLocation): Promise<AppSnapshot | void> {
    if (
      !appApi?.deleteAutomation ||
      (!isRemoteAutomationLocation(location) && !snapshot.value.automations.some((automation) => automation.id === automationId))
    ) {
      return;
    }

    const nextSnapshot = location
      ? await appApi.deleteAutomation(automationId, location)
      : await appApi.deleteAutomation(automationId);
    if (!isRemoteAutomationLocation(location)) {
      adoptBackgroundSnapshot(nextSnapshot);
    }
    return nextSnapshot;
  }

  async function clearAutomationHistory(automationId: string, location?: AutomationLocation): Promise<AppSnapshot | void> {
    if (
      !appApi?.clearAutomationHistory ||
      (!isRemoteAutomationLocation(location) && !snapshot.value.automations.some((automation) => automation.id === automationId))
    ) {
      return;
    }

    const nextSnapshot = location
      ? await appApi.clearAutomationHistory(automationId, location)
      : await appApi.clearAutomationHistory(automationId);
    if (!isRemoteAutomationLocation(location)) {
      adoptBackgroundSnapshot(nextSnapshot);
    }
    return nextSnapshot;
  }

  async function deleteAutomationExecution(automationId: string, executionId: string, location?: AutomationLocation): Promise<AppSnapshot | void> {
    if (
      !appApi?.deleteAutomationExecution ||
      (!isRemoteAutomationLocation(location) && !snapshot.value.automations.some((automation) => (
        automation.id === automationId &&
        automation.executionLog.some((entry) => entry.id === executionId)
      )))
    ) {
      return;
    }

    const nextSnapshot = location
      ? await appApi.deleteAutomationExecution(automationId, executionId, location)
      : await appApi.deleteAutomationExecution(automationId, executionId);
    if (!isRemoteAutomationLocation(location)) {
      adoptBackgroundSnapshot(nextSnapshot);
    }
    return nextSnapshot;
  }

  async function readConversationMessages(ref: BackendConversationRef, agentId: string, location?: AutomationLocation): Promise<RendererMessage[]> {
    if (!appApi?.readConversationMessages) {
      return [];
    }

    return location
      ? appApi.readConversationMessages(plainConversationRef(ref), agentId, location)
      : appApi.readConversationMessages(plainConversationRef(ref), agentId);
  }

  async function listAgentConversations(agentId: string, input?: ConversationListInput): Promise<ConversationSummary[]> {
    if (!appApi?.listAgentConversations) {
      return [];
    }

    return appApi.listAgentConversations(agentId, input);
  }

  async function resumeAgentConversation(agentId: string, target: ConversationResumeTarget): Promise<void> {
    if (!appApi?.resumeAgentConversation) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.resumeAgentConversation(agentId, {
      ref: plainConversationRef(target.ref),
      storageState: target.storageState,
    }));
    resetAgentHistory(agentId);
    synchronizeComposerSelectionForAgent(agentId);
    await loadActiveAgentCatalogs();
  }

  async function compressAgentSession(agentId: string): Promise<void> {
    if (!appApi?.compressAgentSession) {
      throw new Error('Session compression is unavailable.');
    }

    adoptBackgroundSnapshot(await appApi.compressAgentSession(agentId));
    resetAgentHistory(agentId);
    synchronizeComposerSelectionForAgent(agentId);
  }

  async function updateAgent(input: UpdateAgentInput): Promise<void> {
    if (!appApi?.updateAgent) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.updateAgent(input));
    if (input.backend) synchronizeComposerSelectionForAgent(input.id);
    await loadActiveAgentCatalogs(input.id);
  }

  async function updateSettings(input: UpdateSettingsInput): Promise<void> {
    if (!appApi?.updateSettings) {
      return;
    }

    const previousSourceFolderPath = snapshot.value.sourceFolder.path;
    adoptBackgroundSnapshot(await appApi.updateSettings(input));
    if (input.sourceFolder && snapshot.value.sourceFolder.path !== previousSourceFolderPath) {
      await loadSourceRepositories();
    }
  }

  async function setCodexResourceSharing(input: SetCodexResourceSharingInput): Promise<void> {
    if (!appApi?.setCodexResourceSharing) return;
    const restartsBackend = !(input.enabled === false && input.mode === 'keep');
    if (restartsBackend) backendRestartInProgress.value = true;
    try {
      adoptBackgroundSnapshot(await appApi.setCodexResourceSharing(input));
      codexResourceSharingStatus.value = { enabled: input.enabled, migrationRequired: false };
      if (restartsBackend) {
        const reload = appApi.reloadRenderer?.();
        if (reload) {
          void reload.catch(() => {
            backendRestartInProgress.value = false;
          });
        } else {
          backendRestartInProgress.value = false;
        }
      }
    } catch (error) {
      backendRestartInProgress.value = false;
      throw error;
    }
  }

  async function loadCodexResourceSharingStatus(): Promise<void> {
    if (!appApi?.getCodexResourceSharingStatus) return;
    codexResourceSharingStatus.value = await appApi.getCodexResourceSharingStatus();
  }

  async function getPluginStatus(): Promise<AppPluginStatus> {
    return appApi?.getPluginStatus?.() ?? { chromeEnabled: false };
  }

  async function listSshHosts(): Promise<SshHostCandidate[]> {
    if (!appApi?.listSshHosts) {
      return [];
    }

    return appApi.listSshHosts();
  }

  async function addSshConnection(input: AddSshConnectionInput): Promise<void> {
    if (!appApi?.addSshConnection) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.addSshConnection(input));
  }

  async function checkRemoteConnection(connectionId: string, inspectOnly?: boolean): Promise<void> {
    if (!appApi?.checkRemoteConnection) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.checkRemoteConnection(connectionId, inspectOnly));
  }

  async function updateRemoteConnection(connectionId: string, input: UpdateRemoteConnectionInput): Promise<void> {
    if (!appApi?.updateRemoteConnection) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.updateRemoteConnection(connectionId, input));
    await loadSourceRepositories();
  }

  async function removeRemoteConnection(connectionId: string): Promise<void> {
    if (!appApi?.removeRemoteConnection) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.removeRemoteConnection(connectionId));
  }

  async function companionControl(input: import('@workspace/core/companion-protocol').CompanionControl) {
    if (!appApi?.companionControl) throw new Error('Mobile access is unavailable on this host.');
    return appApi.companionControl(input);
  }

  async function getRemoteControlStatus(): Promise<DevicePairingStatus> {
    if (!appApi?.getRemoteControlStatus) return { status: 'disabled' };
    return appApi.getRemoteControlStatus();
  }

  async function enableRemoteControl(): Promise<DevicePairingStatus> {
    if (!appApi?.enableRemoteControl) return { status: 'disabled' };
    return appApi.enableRemoteControl();
  }

  async function disableRemoteControl(): Promise<DevicePairingStatus> {
    if (!appApi?.disableRemoteControl) return { status: 'disabled' };
    return appApi.disableRemoteControl();
  }

  async function startDevicePairing(): Promise<DevicePairingSession> {
    if (!appApi?.startDevicePairing) throw new Error(translate('surface.app-state.devicePairingIsNotAvailable'));
    return appApi.startDevicePairing();
  }

  async function checkDevicePairing(session: DevicePairingSession): Promise<boolean> {
    return appApi?.checkDevicePairing?.(plainDevicePairingSession(session)) ?? false;
  }

  async function listPairedDevices(environmentId: string): Promise<PairedDevice[]> {
    return appApi?.listPairedDevices?.(environmentId) ?? [];
  }

  async function revokePairedDevice(environmentId: string, clientId: string): Promise<void> {
    await appApi?.revokePairedDevice?.(environmentId, clientId);
  }

  async function loadDaemonStatus(): Promise<void> {
    if (!appHostCapabilities.daemonManagement || !appApi?.getDaemonStatus) {
      return;
    }

    daemonStatusError.value = null;
    try {
      daemonStatus.value = await appApi.getDaemonStatus();
    } catch (error) {
      daemonStatusError.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function setDaemonEnabled(enabled: boolean): Promise<void> {
    if (!appHostCapabilities.daemonManagement || !appApi?.setDaemonEnabled) {
      return;
    }

    daemonStatusError.value = null;
    try {
      daemonStatus.value = await appApi.setDaemonEnabled(enabled);
    } catch (error) {
      daemonStatusError.value = error instanceof Error ? error.message : String(error);
      try {
        const refreshed = await appApi.getDaemonStatus?.();
        daemonStatus.value = refreshed ?? daemonStatus.value;
      } catch {
        // Keep the action error visible; status refresh failure is secondary.
      }
    }
  }

  async function quit(): Promise<void> {
    if (appHostCapabilities.appLifecycle) await appApi?.quit?.();
  }

  async function restartApp(): Promise<void> {
    if (appHostCapabilities.appLifecycle) await appApi?.restartApp?.();
  }

  async function assignWorkItemToAgent(payload: { agentId: string; item: WorkItem; prompt?: string }): Promise<void> {
    if (!appApi?.assignWorkItemToAgent) {
      return;
    }

    const item = cloneWorkItemForIpc(payload.item);
    adoptBackgroundSnapshot(await appApi.assignWorkItemToAgent(payload.agentId, item));
    await sendAgentPrompt(payload.agentId, payload.prompt ?? workItemAssignmentPrompt(item));
  }

  async function removeWorkItemAssignment(item: WorkItem): Promise<void> {
    if (!appApi?.removeWorkItemAssignment) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.removeWorkItemAssignment(cloneWorkItemForIpc(item)));
  }

  async function duplicateAgent(agentId: string, options?: DuplicateAgentOptions): Promise<Agent | null> {
    if (!appApi?.duplicateAgent) {
      return null;
    }

    const previousAgentIds = new Set(snapshot.value.agents.map((agent) => agent.id));
    const nextSnapshot = options
      ? await appApi.duplicateAgent(agentId, options)
      : await appApi.duplicateAgent(agentId);
    const duplicate = nextSnapshot.agents.find((agent) => !previousAgentIds.has(agent.id)) ?? null;
    if (options?.select === false) {
      adoptBackgroundSnapshot(nextSnapshot);
    } else {
      adoptNavigationSnapshot(nextSnapshot);
      await loadActiveAgentCatalogs();
    }
    return duplicate;
  }

  async function forkAgent(agentId: string, turnId?: string): Promise<void> {
    if (!appApi?.forkAgent) {
      return;
    }

    const previousAgentIds = new Set(snapshot.value.agents.map((agent) => agent.id));
    const nextSnapshot = turnId === undefined
      ? await appApi.forkAgent(agentId)
      : await appApi.forkAgent(agentId, turnId);
    adoptNavigationSnapshot(nextSnapshot);
    const fork = nextSnapshot.agents.find((agent) => !previousAgentIds.has(agent.id));
    await Promise.all([
      loadActiveAgentCatalogs(),
      // A fork has a session but no conversation frame yet; load it so it doesn't show as an empty chat.
      ...(fork && agentNeedsHistory(fork.id) ? [hydrateAgentHistory(fork.id)] : []),
    ]);
  }

  async function handoffAgent(agentId: string, input: import('@workspace/core/agent-handoff').AgentHandoffInput): Promise<void> {
    if (!appApi?.handoffAgent) throw new Error('Handoff is unavailable on this host.');
    try {
      const next = await appApi.handoffAgent(agentId, input);
      const target = next.agents.find(agent => agent.handoff?.operationId === input.operationId && agent.handoff.sourceAgentId === agentId);
      if (target) next.activeAgentId = target.id;
      adoptNavigationSnapshot(next);
      await loadActiveAgentCatalogs();
    } catch (error) {
      ElMessage.error(localizedErrorMessage(error, translate));
      throw error;
    }
  }

  async function forkActiveAgentTurn(turnId: string): Promise<void> {
    const agentId = snapshot.value.activeAgentId;
    if (!agentId) {
      return;
    }
    await forkAgent(agentId, turnId);
  }

  async function moveAgentToTeam(input: MoveAgentToTeamInput): Promise<void> {
    if (
      !appApi?.moveAgentToTeam ||
      !snapshot.value.agents.some((agent) => agent.id === input.agentId) ||
      !snapshot.value.teams.some((team) => team.id === input.teamId)
    ) {
      return;
    }

    try {
      adoptNavigationSnapshot(await appApi.moveAgentToTeam(input));
    } catch (error) {
      ElMessage.error(localizedErrorMessage(error, translate));
    }
  }

  async function reorderAgents(input: ReorderAgentsInput): Promise<void> {
    const team = snapshot.value.teams.find((candidate) => candidate.id === input.teamId);
    if (
      !appApi?.reorderAgents ||
      !team?.agentIds.includes(input.agentId) ||
      (input.beforeAgentId !== null && !team.agentIds.includes(input.beforeAgentId))
    ) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.reorderAgents(input));
  }

  async function reorderRepositories(input: ReorderRepositoriesInput): Promise<void> {
    const team = snapshot.value.teams.find((candidate) => candidate.id === input.teamId);
    const repositoryRoots = new Set((team?.agentIds ?? []).flatMap((agentId) => {
      const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
      const repositoryRoot = agent ? workspaceSidebarRepositoryRootForAgent(agent) : null;
      return repositoryRoot ? [repositoryRoot] : [];
    }));
    if (
      !appApi?.reorderRepositories ||
      !repositoryRoots.has(input.repositoryRoot) ||
      (input.beforeRepositoryRoot !== null && !repositoryRoots.has(input.beforeRepositoryRoot))
    ) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.reorderRepositories(input));
  }

  async function restartAgent(agentId: string): Promise<void> {
    if (!appApi?.restartAgent) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.restartAgent(agentId));
    const { [agentId]: _discarded, ...claudeFrames } = claudeConversationFramesByAgentId.value;
    claudeConversationFramesByAgentId.value = claudeFrames;
    resetAgentHistory(agentId);
  }

  async function closeAgent(agentId: string, input?: import('@workspace/core/contracts').AgentCloseInput): Promise<void> {
    if (!appApi?.closeAgent) {
      return;
    }

    adoptBackgroundSnapshot(await (input
      ? appApi.closeAgent(agentId, input)
      : appApi.closeAgent(agentId)));
    await loadActiveAgentCatalogs();
  }

  async function respondToClientRequest(response: ClientRequestResponse): Promise<void> {
    if (!appApi) {
      return;
    }

    const agentId = response.agentId ?? snapshot.value.activeAgentId;
    adoptBackgroundSnapshot(await appApi.respondToClientRequest({ ...response, ...(agentId ? { agentId } : {}) }));
    markClientRequestAnswered(response.id);
  }

  async function resolveBackendApproval(
    approvalId: string,
    decision: BackendApprovalDecision,
    scope: BackendApprovalScope,
  ): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await resolveBackendApprovalForAgent(agentId, approvalId, decision, scope);
  }

  async function resolveBackendApprovalForAgent(
    agentId: string,
    approvalId: string,
    decision: BackendApprovalDecision,
    scope: BackendApprovalScope,
  ): Promise<void> {
    const approval = agentId
      ? snapshot.value.backendApprovals[agentId]?.find((candidate) => candidate.id === approvalId)
      : undefined;
    if (
      !agentId ||
      !approval ||
      !appApi ||
      (decision === 'deny' && approval.canDeny === false) ||
      (decision === 'approve' && approval.allowedScopes && !approval.allowedScopes.includes(scope))
    ) {
      return;
    }

    await respondToClientRequest({
      id: approvalId,
      agentId,
      payload: {
        decision: decision === 'deny'
          ? 'deny'
          : scope === 'session'
            ? 'allow_conversation'
            : 'allow',
      },
    });
  }

  async function setApprovalPreset(preset: ApprovalPreset): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await setApprovalPresetForAgent(agentId, preset);
  }

  async function setApprovalPresetForAgent(agentId: string, preset: ApprovalPreset): Promise<void> {
    const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
    const capabilities = agent ? messageActionCapabilities(agent.id) : null;
    if (
      !agent ||
      !capabilities?.approvals ||
      !(capabilities.approvalPresets ?? []).includes(preset) ||
      !appApi?.setAgentApprovalPreset
    ) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.setAgentApprovalPreset(agent.id, preset));
  }

  async function setPermissionMode(mode: string): Promise<void> {
    const agentId = activeAgent.value?.id;
    if (agentId) await setPermissionModeForAgent(agentId, mode);
  }

  async function setPermissionModeForAgent(agentId: string, mode: string): Promise<void> {
    const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
    const supportedModes = agent ? backendCapabilitiesForAgent(agent).permissionModes ?? [] : [];
    if (
      !agent ||
      !supportedModes.some((option) => option.id === mode) ||
      !appApi?.setAgentPermissionMode
    ) {
      return;
    }

    adoptBackgroundSnapshot(await appApi.setAgentPermissionMode(agent.id, mode));
  }

  return {
    snapshot,
    activeAgent,
    activeGoal,
    activeBackendApprovals,
    activeApprovalPreset,
    activePermissionMode,
    activeQueuedPrompts,
    activeComposerState,
    activeComposerAttachments,
    unreadAgentIds,
    isLoading,
    hasLoadedSnapshot,
    connectionState,
    isActiveAgentHistoryFailed,
    isHydratingActiveAgentHistory,
    retryActiveAgentHistory,
    activeHistoryHasOlder,
    isLoadingOlderHistory,
    loadOlderAgentHistory,
    isSending,
    answeredClientRequestIds,
    backendModels,
    activeBackendCommands,
    activeCodexConversationSnapshot,
    activeClaudeConversationSnapshot,
    agentConversationFor,
    activeAntigravityConversationSnapshot: computed(() => activeAgent.value ? antigravityConversations.select(activeAgent.value) : null),
    prepareAgentConversation,
    activeBackendCapabilities,
    modelCatalogStatus,
    modelCatalogError,
    backendSkills,
    backendPlugins,
    skillCatalogStatus,
    skillCatalogError,
    agentFiles,
    fileCatalogStatus,
    fileCatalogError,
    selectedModelId,
    selectedReasoningEffort,
    selectedServiceTier,
    planMode,
    sidePanelRequest,
    markdownDisplayRequests,
    consumeMarkdownDisplayRequests,
    fileActivity,
    workProviderAuthorization,
    workProviderAuthorizations,
    workProviderAuthorizationErrors,
    workRepositoriesByProvider,
    workItemsByRepository,
    assignedWorkItemsByProvider,
    workBacklogStatus,
    workBacklogError,
    workBacklogStateFor,
    sourceRepositories,
    openInApplications,
    sourceRepositoryStatus,
    sourceRepositoryError,
    daemonStatus,
    daemonStatusError,
    codexResourceSharingStatus,
    backendRestartInProgress,
    agentCreationProgresses,
    missionImplementationStartProgress,
    missionFocusRequest,
    loadBackendModels: loadBackendModelsForActiveAgent,
    loadBackendPlugins: loadBackendPluginsForActiveAgent,
    loadBackendSkills: loadBackendSkillsForActiveAgent,
    loadAgentFiles: loadAgentFilesForActiveAgent,
    loadWorkRepositories,
    loadWorkItems,
    loadGlobalWorkItems,
    loadAssignedWorkItems,
    loadSourceRepositories,
    loadDaemonStatus,
    loadSnapshot,
    chooseAgentFolder,
    chooseSourceFolder,
    listSourceFolders,
    listSourceRepositories,
    cloneSourceRepository,
    createSourceRepository,
    createProject,
    listSourceBranches,
    listSourceWorktrees,
    suggestSourceWorktreePath,
    chooseSourceWorktreeDestination,
    createSourceWorktree,
    previewAgentFile,
    getAgentGitDiff,
    updatePlanReview,
    respondToPlanReviewForAgent,
    respondToThreadFlag,
    respondToThreadFlagForAgent,
    clearGoalForAgent,
    startCodeReview,
    startVisualize,
    setVisualizeOpen,
    generateVisualizationSuggestion,
    selectVisualization,
    deleteVisualization,
    readVisualizationAsset,
    decideCodeReviewFinding,
    discussCodeReviewFinding,
    submitCodeReviewRound,
    finishCodeReview,
    commitCodeReview,
    discardCodeReview,
    reviewCodeAgain,
    getAgentGitWorkflow,
    generateAgentGitMessage,
    stageAgentGitFiles,
    commitAgentGitChanges,
    pushAgentGitBranch,
    createAgentGitBranch,
    createAgentGitPullRequest,
    mergeAgentGitBranch,
    updateAgentGitBranchFromBase,
    pullAgentGitBranch,
    revertAgentGitChanges,
    loadOpenInApplications,
    openAgentPath,
    createAgent,
    executeMission,
    createMission,
    selectMission,
    deleteMission,
    readMissionArtifact,
    updateMission,
    createQuickChat,
    createTeam,
    updateTeam,
    reorderTeams,
    closeTeam,
    disconnectTeam,
    updateAgent,
    updateSettings,
    setCodexResourceSharing,
    getPluginStatus,
    listSshHosts,
    addSshConnection,
    checkRemoteConnection,
    updateRemoteConnection,
    removeRemoteConnection,
    companionControl,
    getRemoteControlStatus,
    enableRemoteControl,
    disableRemoteControl,
    startDevicePairing,
    checkDevicePairing,
    listPairedDevices,
    revokePairedDevice,
    setDaemonEnabled,
    connectWorkProvider,
    pollWorkProviderAuthorization,
    disconnectWorkProvider,
    openWorkProviderAuthorization,
    configureWorkBacklog,
    getAutomationSnapshot,
    createAutomation,
    updateAutomation,
    runAutomation,
    clearAutomationHistory,
    deleteAutomationExecution,
    deleteAutomation,
    listAgentConversations,
    resumeAgentConversation,
    compressAgentSession,
    readConversationMessages,
    assignWorkItemToAgent,
    removeWorkItemAssignment,
    duplicateAgent,
    forkAgent,
    handoffAgent,
    forkActiveAgentTurn,
    moveAgentToTeam,
    reorderAgents,
    reorderRepositories,
    restartAgent,
    closeAgent,
    resolveBackendApproval,
    resolveBackendApprovalForAgent,
    respondToClientRequest,
    selectModel,
    selectModelForAgent,
    selectReasoningEffort,
    selectReasoningEffortForAgent,
    selectServiceTier,
    selectServiceTierForAgent,
    setPlanMode,
    setPlanModeForAgent,
    setApprovalPreset,
    setApprovalPresetForAgent,
    setPermissionMode,
    setPermissionModeForAgent,
    updateComposerState,
    updateComposerAttachments,
    selectAgent,
    setRendererWindowFocused,
    markDebugAgentsUnread,
    selectTeam,
    clearActiveGoal,
    sendPrompt,
    sendPromptToAgent,
    sendAgentPrompt,
    steerPrompt,
    steerPromptToAgent,
    clearAgentCreationProgress,
    backgroundAgentCreationProgress,
    interruptActiveAgent,
    interruptAgentById,
    deleteTurn,
    deleteTurnForAgent,
    editTurn,
    editTurnForAgent,
    retryTurn,
    retryTurnForAgent,
    continueInterruptedTurn,
    continueInterruptedTurnForAgent,
    steerQueuedPrompt,
    steerQueuedPromptForAgent,
    updateQueuedPrompt,
    updateQueuedPromptForAgent,
    removeQueuedPrompt,
    removeQueuedPromptForAgent,
    quit,
    restartApp,
  };
}

function clearAgentCreationProgress(id: string): void {
  agentCreationProgresses.value = agentCreationProgresses.value.filter((entry) => entry.id !== id);
}

function backgroundAgentCreationProgress(id: string): void {
  const entry = agentCreationProgresses.value.find((candidate) => candidate.id === id);
  if (!entry) return;
  if (entry.state === 'running') backgroundedAgentCreationIds.add(id);
  clearAgentCreationProgress(id);
}

function upsertAgentCreationProgress(progress: AgentCreationProgress): void {
  const index = agentCreationProgresses.value.findIndex((entry) => entry.id === progress.id);
  agentCreationProgresses.value = index < 0
    ? [...agentCreationProgresses.value, progress]
    : agentCreationProgresses.value.map((entry, position) => position === index ? progress : entry);
}

function emptyComposerState(): CodexComposerState {
  return { text: '', selectionStart: 0, selectionEnd: 0 };
}

function plainConversationRef(ref: BackendConversationRef): BackendConversationRef {
  return ref.backend === 'codex'
    ? { backend: 'codex', threadId: ref.threadId }
    : { backend: ref.backend, folder: ref.folder, sessionId: ref.sessionId,
      ...(ref.backend === 'claude' && ref.subagentId !== undefined ? { subagentId: ref.subagentId } : {}),
    };
}

function plainDevicePairingSession(session: DevicePairingSession): DevicePairingSession {
  return JSON.parse(JSON.stringify(session)) as DevicePairingSession;
}

function cloneWorkItemForIpc(item: WorkItem): WorkItem {
  return {
    provider: item.provider,
    id: item.id,
    ...(item.kind ? { kind: item.kind } : {}),
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    number: item.number,
    identifier: item.identifier,
    nativeState: item.nativeState,
    assignedToViewer: item.assignedToViewer,
    branchName: item.branchName,
    title: item.title,
    url: item.url,
    state: item.state,
    ...(typeof item.authorName === 'string' ? { authorName: item.authorName } : {}),
    ...(item.assignees ? { assignees: [...item.assignees] } : {}),
    ...(typeof item.body === 'string' ? { body: item.body } : {}),
    labels: item.labels.map((label) => ({
      name: label.name,
      ...(typeof label.color === 'string' ? { color: label.color } : {}),
    })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function messageActionCapabilities(agentId: string) {
  const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
  return backendCapabilitiesForAgent(agent ?? null);
}

function backendCapabilitiesForAgent(agent: Agent | null): BackendCapabilities {
  const backend = agent?.backend ?? 'codex';
  const defaults = defaultBackendCapabilities(backend);
  const runtime = snapshot.value.backendRuntimes.find((candidate) => candidate.backend === backend);
  return {
    ...defaults,
    ...runtime?.capabilities,
    ...(snapshot.value.teams.some(team => team.id === agent?.teamId && team.remoteConnectionId) ? { attachments: false } : {}),
  };
}

function parsePlanSlashCommand(prompt: string): { prompt: string | null } | null {
  const trimmed = prompt.trim();
  const match = /^\/plan(?:\s+(.*))?$/s.exec(trimmed);
  if (!match) {
    return null;
  }

  const planPrompt = match[1]?.trim() ?? '';
  return {
    prompt: planPrompt || null,
  };
}

type GoalSlashCommand =
  | { action: 'clear' }
  | { action: 'edit' }
  | { action: 'set'; objective: string }
  | { action: 'show' }
  | { action: 'unsupported' };

function parseGoalSlashCommand(prompt: string): GoalSlashCommand | null {
  const trimmed = prompt.trim();
  const match = /^\/goal(?:\s+(.*))?$/s.exec(trimmed);
  if (!match) {
    return null;
  }

  const rest = match[1]?.trim() ?? '';
  if (!rest) {
    return { action: 'show' };
  }

  const normalized = rest.toLowerCase();
  if (normalized === 'clear') {
    return { action: 'clear' };
  }
  if (normalized === 'edit') {
    return { action: 'edit' };
  }
  if (normalized === 'pause' || normalized === 'resume') {
    return { action: 'unsupported' };
  }

  return { action: 'set', objective: rest };
}

async function handleGoalSlashCommand(agentId: string, command: GoalSlashCommand): Promise<void> {
  if (!appApi) {
    return;
  }

  if (command.action === 'clear') {
    await clearGoalForAgent(agentId);
    return;
  }

  if (command.action === 'set') {
    adoptBackgroundSnapshot(await appApi.setAgentGoal(agentId, command.objective));
  }
}

async function clearActiveGoal(): Promise<void> {
  const agentId = snapshot.value.activeAgentId;
  if (agentId) {
    await clearGoalForAgent(agentId);
  }
}

async function clearGoalForAgent(agentId: string): Promise<void> {
  if (!appApi?.clearAgentGoal) {
    return;
  }

  adoptBackgroundSnapshot(await appApi.clearAgentGoal(agentId));
}

function subscribeToMainEvents(): void {
  if (!appApi || typeof appApi.onEvent !== 'function') {
    return;
  }

  unsubscribeMainEvents?.();
  unsubscribeMainEvents = appApi.onEvent((event: MainToRendererEvent) => {
    if (bufferedMainEvents) {
      bufferedMainEvents.push(event);
      return;
    }
    if (isBackendMainEvent(event)) {
      if (event.seq <= lastBackendEventSeq) return;
      if (event.seq !== lastBackendEventSeq + 1) {
        bufferedMainEvents = [event];
        void synchronizeRendererSnapshotRequest?.().catch((error) => {
          connectionState.value = { status: 'error', detail: error instanceof Error ? error.message : String(error) };
        });
        return;
      }
      lastBackendEventSeq = event.seq;
    }
    handleMainEvent(event);
  });
}

function handleMainEvent(event: MainToRendererEvent, adoptSnapshot = true): void {
  if (event.type === 'snapshot.updated' && event.source === 'client') {
    // Electron repaired a transport gap upstream. Its product snapshot does
    // not include conversations, and no later event may arrive on a silent turn.
    void synchronizeRendererSnapshotRequest?.().catch((error) => {
      connectionState.value = { status: 'error', detail: error instanceof Error ? error.message : String(error) };
    });
  }
  if (event.type === 'client.connectionChanged') {
    const wasConnected = connectionState.value.status === 'connected';
    connectionState.value = event.payload;
    if (!wasConnected && event.payload.status === 'connected') {
      void recoverRendererAfterBackendConnection();
    }
  }
  if (adoptSnapshot) adoptSnapshotFromMainEvent(event);
  syncUnreadStateFromMainEvent(event);
  if (isSnapshotEventOwnedBy(event, 'renderer')) {
    handleRendererOwnedMainEvent(event);
    return;
  }
  handleSnapshotOwnedRendererEffect(event);
}

function handleRendererOwnedMainEvent(event: RendererOnlySnapshotEvent): void {
  switch (event.type) {
    case 'client.connectionChanged':
    case 'conversation.shareChanged':
    case 'remoteControl.statusChanged':
    case 'git.branchWorkProgress':
    case 'git.operationProgress':
    case 'browser.annotationCreated':
      return;
    case 'models.changed':
    case 'skills.changed':
    case 'conversation.modeUpdated':
      syncComposerStateFromMainEvent(event);
      return;
    case 'codex.conversationSnapshotChanged': {
      const current = codexConversationFramesByAgentId.value[event.agentId];
      if (
        current?.threadId === event.threadId
        && current.revision >= event.payload.revision
      ) return;
      codexConversationFramesByAgentId.value = {
        ...codexConversationFramesByAgentId.value,
        [event.agentId]: {
          replica: createCodexConversationReplica(event.payload.snapshot),
          revision: event.payload.revision,
          snapshot: event.payload.snapshot,
          threadId: event.threadId,
        },
      };
      return;
    }
    case 'codex.conversationEventReceived': {
      const current = codexConversationFramesByAgentId.value[event.agentId];
      if (
        current?.threadId !== event.threadId
        || event.payload.revision !== current.revision + 1
      ) {
        if (!current || event.payload.revision > current.revision) {
          invalidateAndRecoverCodexConversation(event.agentId);
        }
        return;
      }
      let nextSnapshot: CodexConversationSnapshot;
      try {
        nextSnapshot = current.replica.apply(event.payload.event);
      } catch {
        invalidateAndRecoverCodexConversation(event.agentId);
        return;
      }
      codexConversationFramesByAgentId.value = {
        ...codexConversationFramesByAgentId.value,
        [event.agentId]: {
          ...current,
          revision: event.payload.revision,
          snapshot: nextSnapshot,
        },
      };
      return;
    }
    case 'antigravity.conversationSnapshotChanged':
    case 'antigravity.conversationEventReceived':
      antigravityConversations.receive(event);
      return;
    case 'claude.conversationSnapshotChanged': {
      const current = claudeConversationFramesByAgentId.value[event.agentId];
      if (current && current.revision >= event.payload.revision) return;
      claudeConversationFramesByAgentId.value = {
        ...claudeConversationFramesByAgentId.value,
        [event.agentId]: {
          replica: createClaudeConversationReplica(event.payload.snapshot),
          revision: event.payload.revision,
          snapshot: event.payload.snapshot,
        },
      };
      return;
    }
    case 'claude.conversationEventReceived': {
      const current = claudeConversationFramesByAgentId.value[event.agentId];
      if (!current || event.payload.revision !== current.revision + 1) {
        if (!current || event.payload.revision > current.revision) {
          invalidateAndRecoverClaudeConversation(event.agentId);
        }
        return;
      }
      let nextSnapshot: ClaudeConversationSnapshot;
      try {
        nextSnapshot = current.replica.apply(event.payload.event);
      } catch {
        invalidateAndRecoverClaudeConversation(event.agentId);
        return;
      }
      claudeConversationFramesByAgentId.value = {
        ...claudeConversationFramesByAgentId.value,
        [event.agentId]: {
          ...current,
          revision: event.payload.revision,
          snapshot: nextSnapshot,
        },
      };
      return;
    }
    case 'provider.authenticationChanged':
      // The owning host publishes connection state through snapshot.updated.
      return;
    case 'conversation.historyLoadFailed':
      syncHistoryPageStateFromMainEvent(event);
      return;
    case 'client.markdownDisplayRequested':
      syncSidePanelFromMainEvent(event);
      return;
    case 'client.celebrationRequested':
      syncCelebrationFromMainEvent(event);
      return;
    case 'agentCreation.progress':
      syncAgentCreationProgressFromMainEvent(event);
      return;
    case 'mission.implementationStartProgress':
      missionImplementationStartProgress.value = event.payload;
      return;
    case 'mission.focusRequested':
      missionFocusRequest.value = { missionId: event.payload.missionId, sequence: ++missionFocusSequence };
      return;
    case 'workspace.fileActivityDetected':
      syncFileActivityFromMainEvent(event);
      return;
    default: {
      const exhaustive: never = event;
      void exhaustive;
    }
  }
}

function invalidateAndRecoverCodexConversation(agentId: string): void {
  const frames = { ...codexConversationFramesByAgentId.value };
  delete frames[agentId];
  codexConversationFramesByAgentId.value = frames;
  if (recoveringCodexConversationAgentIds.has(agentId) || !appApi?.loadConversationHistory) return;
  recoveringCodexConversationAgentIds.add(agentId);
  void appApi.loadConversationHistory(agentId)
    .then(adoptBackgroundSnapshot)
    .catch(() => undefined)
    .finally(() => recoveringCodexConversationAgentIds.delete(agentId));
}

function invalidateAndRecoverClaudeConversation(agentId: string): void {
  const frames = { ...claudeConversationFramesByAgentId.value };
  delete frames[agentId];
  claudeConversationFramesByAgentId.value = frames;
  if (recoveringClaudeConversationAgentIds.has(agentId) || !appApi?.loadConversationHistory) return;
  recoveringClaudeConversationAgentIds.add(agentId);
  void appApi.loadConversationHistory(agentId)
    .then(adoptBackgroundSnapshot)
    .catch(() => undefined)
    .finally(() => recoveringClaudeConversationAgentIds.delete(agentId));
}

function showPlanReview(markdown: string): void {
  const lines = markdown.trim().split('\n');
  const headingIndex = lines.findIndex((line) => /^#\s+\S/u.test(line.trim()));
  sidePanelRequest.value = {
    kind: 'markdown', purpose: 'plan',
    title: headingIndex < 0 ? translate('panels.plan') : lines[headingIndex]!.trim().replace(/^#\s+/u, '').trim(),
    content: headingIndex < 0 ? markdown : [...lines.slice(0, headingIndex), ...lines.slice(headingIndex + 1)].join('\n').trim(),
  };
}

function handleSnapshotOwnedRendererEffect(event: Exclude<MainToRendererEvent, RendererOnlySnapshotEvent>): void {
  switch (event.type) {
    case 'agentRequest.resolved':
      syncAnsweredClientRequestsFromMainEvent(event);
      return;
    case 'conversation.settingsUpdated':
      syncComposerStateFromMainEvent(event);
      return;
    default:
      return;
  }
}

function syncCelebrationFromMainEvent(event: Extract<RendererOnlySnapshotEvent, { type: 'client.celebrationRequested' }>): void {
  if (snapshot.value.general.celebrationsEnabled === false) return;
  if (event.agentId !== snapshot.value.activeAgentId) return;
  useConfetti().celebrate({ kind: event.payload.kind });
}

function syncAgentCreationProgressFromMainEvent(event: Extract<RendererOnlySnapshotEvent, { type: 'agentCreation.progress' }>): void {
  if (backgroundedAgentCreationIds.has(event.payload.id)) {
    if (event.payload.state === 'running') return;
    backgroundedAgentCreationIds.delete(event.payload.id);
    // Failures need attention even after the user sent the setup to the background.
    if (event.payload.state === 'error') upsertAgentCreationProgress(event.payload);
    return;
  }
  if (event.payload.state === 'running') {
    if (event.agentId === snapshot.value.activeAgentId) upsertAgentCreationProgress(event.payload);
    return;
  }
  if (agentCreationProgresses.value.some((entry) => entry.id === event.payload.id)) upsertAgentCreationProgress(event.payload);
}

function recoverRendererAfterBackendConnection(): Promise<void> {
  if (rendererConnectionRecovery) return rendererConnectionRecovery;
  rendererConnectionRecovery = (async () => {
    try {
      await synchronizeRendererSnapshotRequest?.();
      const activeAgentId = snapshot.value.activeAgentId;
      if (activeAgentId) restoreComposerConfiguration(activeAgentId);
      await Promise.all([
        hydrateActiveAgentHistory(),
        loadActiveAgentCatalogs(activeAgentId),
      ]);
    } catch (error) {
      connectionState.value = {
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  })().finally(() => {
    rendererConnectionRecovery = null;
  });
  return rendererConnectionRecovery;
}

function isBackendMainEvent(event: MainToRendererEvent): boolean {
  return event.source === 'backend' || (
    event.source === undefined &&
    event.type !== 'browser.annotationCreated' &&
    event.type !== 'client.connectionChanged'
  );
}

function syncAnsweredClientRequestsFromMainEvent(event: Extract<MainToRendererEvent, { type: 'agentRequest.resolved' }>): void {
  const id = event.payload.id;
  if (typeof id === 'string' && id) markClientRequestAnswered(id);
}

function adoptSnapshotFromMainEvent(event: MainToRendererEvent): void {
  if (isAppSnapshot(event.snapshot)) {
    adoptBackgroundSnapshot(event.snapshot);
    return;
  }
  if (event.type === 'snapshot.updated') {
    const decodedSnapshot = decodeAppSnapshot(event.payload);
    if (decodedSnapshot) {
      adoptBackgroundSnapshot(decodedSnapshot.value);
      return;
    }
    return;
  }
  applyMainEventToSnapshot(snapshot.value, event);
  if (event.type === 'agent.conversationAttached' && event.backend === 'claude') {
    synchronizeComposerSelectionForAgent(event.agentId);
  }
}

function adoptBackgroundSnapshot(nextSnapshot: AppSnapshot): void {
  const activeAgentId = snapshot.value.activeAgentId;
  if (activeAgentId && nextSnapshot.agents.some((agent) => agent.id === activeAgentId)) {
    selectAgentInSnapshot(nextSnapshot, activeAgentId);
  }
  if (nextSnapshot.activeAgentId !== activeAgentId) {
    adoptNavigationSnapshot(nextSnapshot);
    if (nextSnapshot.activeAgentId) void loadActiveAgentCatalogs(nextSnapshot.activeAgentId);
    return;
  }
  snapshot.value = nextSnapshot;
  pruneUnreadAgentIds();
  pruneConversationFrames();
}

function adoptNavigationSnapshot(nextSnapshot: AppSnapshot): void {
  const previousAgentId = snapshot.value.activeAgentId;
  rememberActiveComposerConfiguration();
  snapshot.value = nextSnapshot;
  pruneUnreadAgentIds();
  pruneConversationFrames();
  if (nextSnapshot.activeAgentId && nextSnapshot.activeAgentId !== previousAgentId) {
    restoreComposerConfiguration(nextSnapshot.activeAgentId);
  } else if (!nextSnapshot.activeAgentId) {
    clearActiveComposerConfiguration();
  }
}

function pruneConversationFrames(): void {
  const agentsById = new Map(snapshot.value.agents.map((agent) => [agent.id, agent]));
  codexConversationFramesByAgentId.value = Object.fromEntries(
    Object.entries(codexConversationFramesByAgentId.value).filter(([agentId, frame]) => {
      const agent = agentsById.get(agentId);
      return agent?.backend === 'codex'
        && agent.backendSession?.kind === 'codex'
        && agent.backendSession.threadId === frame.threadId;
    }),
  );
  claudeConversationFramesByAgentId.value = Object.fromEntries(
    Object.entries(claudeConversationFramesByAgentId.value).filter(([agentId, frame]) => {
      const agent = agentsById.get(agentId);
      if (agent?.backend !== 'claude') return false;
      return agent.backendSession?.kind !== 'claude'
        || frame.snapshot.sessionId === null
        || frame.snapshot.sessionId === agent.backendSession.sessionId;
    }),
  );
  antigravityConversations.reconcile([...agentsById.values()]);
}

function syncSidePanelFromMainEvent(event: Extract<RendererOnlySnapshotEvent, { type: 'client.markdownDisplayRequested' }>): void {
  const request = { ...event.payload, agentId: event.agentId };
  if (request.purpose === 'plan') sidePanelRequest.value = request;
  else markdownDisplayRequests.value = [...markdownDisplayRequests.value, request];
}

function syncFileActivityFromMainEvent(event: Extract<RendererOnlySnapshotEvent, { type: 'workspace.fileActivityDetected' }>): void {
  if (!event.agentId || !event.turnId) return;
  const { action, itemId, messageId, path, status } = event.payload;
  if (
    !itemId ||
    !messageId ||
    !path.trim()
  ) return;

  fileActivity.value = {
    agentId: event.agentId,
    turnId: event.turnId,
    messageId,
    itemId,
    path: path.trim(),
    action,
    status,
    occurredAt: event.occurredAt,
  };
}

function agentNeedsHistory(agentId: string): boolean {
  const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
  if (!agent?.backendSession) return false;
  if (agent.backendSession.kind === 'antigravity') return !antigravityConversations.select(agent);
  return agent.backendSession.kind === 'codex'
    ? codexConversationFramesByAgentId.value[agentId]?.threadId !== agent.backendSession.threadId
    : claudeConversationFramesByAgentId.value[agentId]?.snapshot.sessionId !== agent.backendSession.sessionId;
}

async function refreshTeamSelection(
  teamId: string,
  requestId: number,
  selectedAgentId: string | null,
  needsHistory: boolean,
): Promise<void> {
  try {
    let nextSnapshot = await appApi!.selectTeam(teamId);
    if (selectedAgentId && appApi?.loadConversationHistory) {
      nextSnapshot = await appApi.loadConversationHistory(selectedAgentId);
      selectTeamInSnapshot(nextSnapshot, teamId);
    }
    if (requestId === agentSelectionRequestId) {
      adoptNavigationSnapshot(nextSnapshot);
      const activeAgentId = snapshot.value.activeAgentId;
      if (activeAgentId) {
        markAgentRead(activeAgentId);
        synchronizeComposerSelectionForAgent(activeAgentId);
      }
    }
  } catch {
    // The optimistic selection remains visible; the next snapshot/event will reconcile it.
  } finally {
    if (selectedAgentId && needsHistory) markAgentHistoryHydrating(selectedAgentId, false);
  }
}

async function refreshAgentSelection(agentId: string, requestId: number, needsHistory = false): Promise<void> {
  try {
    let nextSnapshot = await appApi!.selectAgent(agentId);
    if (appApi?.loadConversationHistory) {
      nextSnapshot = await appApi.loadConversationHistory(agentId);
    }
    if (requestId === agentSelectionRequestId) {
      adoptBackgroundSnapshot(nextSnapshot);
      synchronizeComposerSelectionForAgent(agentId);
    }
  } catch {
    // The optimistic selection remains visible; the next snapshot/event will reconcile it.
  } finally {
    if (needsHistory) markAgentHistoryHydrating(agentId, false);
  }
}

function markAgentSending(agentId: string, sending: boolean): void {
  const next = new Set(sendingAgentIds.value);
  if (sending) {
    next.add(agentId);
  } else {
    next.delete(agentId);
  }
  sendingAgentIds.value = next;
}

function isAgentSending(agentId: string): boolean {
  const agent = snapshot.value.agents.find((candidate) => candidate.id === agentId);
  return sendingAgentIds.value.has(agentId) ||
    agent?.status.type === 'working' ||
    agent?.status.type === 'awaitingInput';
}

function markClientRequestAnswered(requestId: string): void {
  const next = new Set(answeredClientRequestIds.value);
  next.add(requestId);
  answeredClientRequestIds.value = next;
}
