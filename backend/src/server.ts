import { randomUUID } from 'node:crypto';
import type { UsageService } from './usage/usage-service';
import type { UsageFilter } from '@workspace/core/usage';
import { assertPromptSession, requireExpectedSessionId, requirePromptText } from './prompt-input';
import { PromptRejectedError } from './agents/prompt-rejected';
import { isBankedResets, isBankedResetResult, isUseBankedResetInput } from '@workspace/core/contracts/banked-resets';
import { DocumentWorkspaceService } from './document-workspace-service';
import { saveMarkdownFile } from './document-files';
import { previewAgentFolderFile } from './agent-files';
import { backendHomeDir } from './state';
import type { DocumentWorkspaceChange, DocumentSaveInput } from '@workspace/core/document-workspace';
import { isWorkProviderKind } from '@workspace/core/work-providers';
import { isAgentBackend } from '@workspace/core/contracts/shared';
import { product } from '@workspace/core/product';
import { bindUserDelegationOverrides, captureUserDelegationOverrides, isDelegationOverrides } from '@workspace/core/delegation-context';
import { normalizeGitSettings } from '@workspace/core/git-preferences';
import { readWorktreeHead } from './git-worktrees';
import type { DurableTaskService } from './agents/durable-task-service';
import { ProviderConnections } from './provider-connections';
import type { Requirements } from './requirements';
import { backendCodexHomeDir } from './state';
import { isProviderConnection, type ProviderAuthentication } from '@workspace/core/contracts/provider-setup';
import { MissionExecutionService } from './mission-execution-service';
import { applyMissionDebugFixture } from './mission-debug-fixtures';
import { createVisualizeDebugFixture } from './visualize-debug-fixtures';
import { missionStageSkills } from './bundled-skills/catalog';
import { featureStages, type DeleteMissionInput, type Mission, type MissionReviewDebugState, type MissionStage } from '@workspace/core/missions';
import type { MissionExecutionInput, MissionResultInput } from '@workspace/core/mission-execution';
import { MissionService } from './mission-service';
import { FileMissionArtifactStore, type MissionArtifactStorage } from './mission-artifact-store';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import path from 'node:path';
import os from 'node:os';
import { mkdir, rm } from 'node:fs/promises';
import { createEntityId } from '@workspace/core/ids';
import { resolveAgentBackend } from '@workspace/core/agent-backends';
import { createAppRpcError, createAppRpcResult, appRpcErrorCodes, isAppRpcNotification, isAppRpcRequest, isAppSnapshotGetResult, type AppRpcMessage, type AppRpcResponse } from '@workspace/core/backend-protocol/rpc';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { applyMainEventToSnapshot } from '@workspace/core/snapshot';
import { decodeAppSnapshot, isAppSnapshot } from '@workspace/core/snapshot-guards';
import type { AddSshConnectionInput, Agent, AgentGitDiffTarget, AgentHistoryLoadResult, AgentStatus, AppPluginStatus, AppSnapshot, BackendConversationRef, CloneSourceRepositoryInput, CodexResourceSharingStatus, ConversationListInput, ConversationResumeTarget, ConversationSummary, CreateAgentInput, CreateAutomationInput, CreateProjectInput, CreateQuickChatInput, CreateSourceRepositoryInput, CreateSourceWorktreeInput, CreateTeamInput, ClientState, DevicePairingStatus, DuplicateAgentOptions, BackendPublishedEvent, MoveAgentToTeamInput, OpenInApplication, RemoteConnection, RendererMessage, ReorderAgentsInput, ReorderRepositoriesInput, ReorderTeamsInput, SendPromptOptions, SetCodexResourceSharingInput, SourceBranch, SourceRepository, SourceWorktree, SystemPermissionsStatus, Team, UpdateAgentInput, UpdateAutomationInput, UpdateRemoteConnectionInput, UpdateSettingsInput, UpdateTeamInput } from '@workspace/core/contracts';
import type { WorkBacklogConfigurationInput, WorkProviderKind } from '@workspace/core/contracts';
import { isAgentGitDiffTarget } from '@workspace/core/snapshot-guard-collections';
import { backendDisplayName } from '@workspace/core/backend-driver';
import type { AgentBackendDriver, BackendApprovalPresetResult, BackendConversationForkResult, BackendConversationResumeResult, BackendEvent, BackendGoalResult, BackendPermissionModeResult, BackendSendResult, BackendConversationReplacementResult } from '@workspace/core/backend-driver';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { assignWorkItemToAgentInSnapshot, attachForkedAgentInSnapshot, closeAgentInSnapshot, createForkedAgentDraft, createQuickChatInSnapshot, duplicateAgentInSnapshot, moveAgentToTeamInSnapshot, removeWorkItemAssignmentFromSnapshot, restartAgentConversation, resumeAgentConversationInSnapshot, updateAgentFromInput } from '@workspace/core/agent-manager';
import { clearAutomationExecutionHistoryInSnapshot, createAutomationInSnapshot, deleteAutomationExecutionFromSnapshot, deleteAutomationFromSnapshot, updateAutomationInSnapshot } from '@workspace/core/automation-manager';
import { updateSettingsInSnapshot } from '@workspace/core/settings';
import { readEngineInstructions, saveEngineInstructions } from './engine-instructions';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { closeTeamInSnapshot, createTeamInSnapshot, updateTeamInSnapshot } from '@workspace/core/team-manager';
import { teamColors } from '@workspace/core/team-colors';
import { sanitizeWorkItemAssignmentSource } from '@workspace/core/work-assignments';
import { approvalBackendDefaultsWithPreset, isApprovalPreset } from '@workspace/core/approval-presets';
import { formatConversationTitle } from '@workspace/core/conversation-title';
import { agentFolder, requireAgentFolder } from '@workspace/core/agent-folder';
import { BackendDriverRpc } from './driver-rpc';
import { ClientPreferencesService } from './client-preferences-service';
import { projectClientSnapshot, splitSettingsInput } from '@workspace/core/client-preferences';
import { RemoteDaemonClientManager } from './connections/remote-daemon-client';
import { RemoteTeamService } from './connections/remote-team-service';
import { SshConnectionService } from './connections/ssh-connections';
import type { AutomationRunner } from './automations/runner';
import type { WorkIntegrationManager } from './work-integrations/manager';
import { warnMain } from './log';
import { loadPluginStatus } from './plugin-status';
import { getCodexResourceSharingStatus, setCodexResourceSharing } from './codex-resource-sharing';
import { AgentGitService } from './git/agent-git-service';
import { AgentGitWorkflowService, parseAgentGitRequest } from './git/agent-git-workflow-service';
import { AgentPromptManager } from './agents/agent-prompt-manager';
import { AgentHandoffService } from './agents/agent-handoff-service';
import { requestHandoffNote } from './agents/handoff-note';
import { handoffInProgress, type AgentHandoffInput } from '@workspace/core/agent-handoff';
import { sendAgentPrompt } from '@workspace/core/agent-chat-service';
import { AgentPlanReviewService } from './agents/agent-plan-review-service';
import { AgentThreadFlagService } from './agents/agent-thread-flag-service';
import type { PlanReviewResponse } from '@workspace/core/plan-review';
import type { ThreadFlagId, ThreadFlagResponse } from '@workspace/core/thread-flags';
import { agentConversationId, planReviewFromEvent } from '@workspace/core/plan-review';
import { isAgentRequestResponse, type AgentRequestResponse } from '@workspace/core/agent-request';
import { AgentWorkspaceService } from './agents/agent-workspace-service';
import { AgentConversationService } from './agents/agent-conversation-service';
import { DelegatedWorkReportService, type DelegatedWorkReportPort } from './agents/delegated-work-report-service';
import { SubagentIdentityService } from './agents/subagent-identity-service';
import { AgentRequestRegistry } from './agent-requests/agent-request-registry';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import { isCodeReviewDecisionInput, isCodeReviewDiscussionInput, isCodeReviewStartInput, type CodeReviewFinding, type CodeReviewSession } from '@workspace/core/code-review';
import { CodeReviewService, type CodeReviewToolPort, type AutomaticReviewStartInput } from './review/code-review-service';
import { BranchCurrentWorkService } from './git/branch-current-work-service';
import { AgentCreationService } from './agents/agent-creation-service';
import { ProjectCreationService, type CreatedProject } from './projects/project-creation-service';
import { VisualizeService, directVisualizationPrompt, generateVisualizationSuggestionPrompt, initialVisualizePrompt } from './visualize-service';
import { visualizeDebugScenarios, type VisualizeDebugScenario } from '@workspace/core/visualize';

export type AppBackendServerOptions = {
  requirements?: Requirements;
  usage?:UsageService;
  onPromptSource?: (agent: Agent, clientId: string) => (() => void) | undefined;
  companionControl?: (input: import('@workspace/core/companion-protocol').CompanionControl) => Promise<import('@workspace/core/companion-protocol').CompanionControlResult>;
  documents?: DocumentWorkspaceService;
  tasks?: DurableTaskService;
  providerSetup?: import('./provider-setup').ProviderSetup;
  providerUpdates?: import('./provider-updates').ProviderUpdates;
  version: string;
  pid?: number;
  snapshot?: AppSnapshot;
  driverRpc?: BackendDriverRpc;
  onEvent?: (event: AppBackendEvent) => void;
  onBackendEventApplied?: (event: BackendPublishedEvent) => void;
  saveSnapshot?: (snapshot: AppSnapshot) => Promise<void>;
  workIntegrations?: WorkIntegrationManager;
  automationRunner?: Pick<AutomationRunner, 'runAll' | 'runAutomation'>;
  systemPermissions?: SystemPermissionsPort;
  sshConnections?: SshConnectionService;
  remoteClients?: RemoteDaemonClientManager;
  sendAgentMessage?: (fromAgentId: string, toAgentId: string, content: string) => void;
  configureCodexResourceSharing?: (input: SetCodexResourceSharingInput) => Promise<void>;
  inspectCodexResourceSharing?: (enabled: boolean) => Promise<CodexResourceSharingStatus>;
  inspectPluginStatus?: () => Promise<AppPluginStatus>;
  agentGitService?: AgentGitService;
  delegatedWorkReports?: DelegatedWorkReportPort;
  onPromptStarting?: (agentId: string, options?: SendPromptOptions) => void;
  ensureMissionHome?: (missionId: string) => Promise<string>;
  deleteMissionHome?: (missionId: string) => Promise<void>;
  missionArtifactStore?: MissionArtifactStorage;
  codeReviewTools?: CodeReviewToolPort;
  saveCodeReviewReport?: (agent: Agent, session: CodeReviewSession) => Promise<string>;
  agentCreation?: AgentCreationService;
  visualizeService?: VisualizeService;
};

export type SystemPermissionsPort = {
  getStatus(): Promise<SystemPermissionsStatus>;
  openAccessibilitySettings(): Promise<SystemPermissionsStatus>;
  openScreenRecordingSettings(): Promise<SystemPermissionsStatus>;
};

type AgentLocation =
  | { kind: 'local'; agent: Agent }
  | { kind: 'remote'; connectionId: string; localTeamId: string; remoteTeamId: string; agent: Agent };

type BackendLocation =
  | { kind: 'local' }
  | { kind: 'remote'; connectionId: string };

type BackendHandle =
  | {
    kind: 'local';
    request<Result>(method: string, params: unknown, localHandler: () => Promise<Result> | Result): Promise<Result>;
  }
  | {
    kind: 'remote';
    connectionId: string;
    request<Result>(method: string, params: unknown, localHandler: () => Promise<Result> | Result): Promise<Result>;
  };

export class AppBackendServer {
  private readonly tasks?: DurableTaskService;

  async sendTaskPrompt(agent: Agent, prompt: string): Promise<BackendSendResult> {
    await this.requireConnectedEngine(agent.backend);
    if (!this.snapshot.agents.includes(agent)) throw new Error('Agent was removed before task prompt admission.');
    if (this.tasks?.mayStartAutomatedPrompt(agent.id) === false || agent.planReview?.status === 'pending') throw new Error('Agent is stopped or waiting for a review decision.');
    const receipt = await this.agentPrompts.sendWithReceipt(agent, prompt);
    await this.persistSnapshotOnly();
    return receipt;
  }
  private readonly version: string;
  private readonly pid: number;
  private readonly snapshot: AppSnapshot;
  private readonly missions: MissionService;
  private readonly missionExecution: MissionExecutionService;
  private readonly missionArtifacts: MissionArtifactStorage;
  private remoteControlStatus: DevicePairingStatus = { status: 'disabled' };
  private remoteControlStatusLoaded = false;
  private companionAccessEnabled = false;
  private readonly driverRpc?: BackendDriverRpc;
  private readonly onEvent?: (event: AppBackendEvent) => void;
  private readonly onBackendEventApplied?: (event: BackendPublishedEvent) => void;
  private readonly saveSnapshot?: (snapshot: AppSnapshot) => Promise<void>;
  private readonly workIntegrations?: WorkIntegrationManager;
  private readonly automationRunner?: Pick<AutomationRunner, 'runAll' | 'runAutomation'>;
  private readonly systemPermissions: SystemPermissionsPort;
  private readonly sshConnections: SshConnectionService;
  private readonly remoteClients: RemoteDaemonClientManager;
  private readonly sendAgentMessage?: (fromAgentId: string, toAgentId: string, content: string) => void;
  private readonly configureCodexResourceSharing: (input: SetCodexResourceSharingInput) => Promise<void>;
  private readonly inspectCodexResourceSharing: (enabled: boolean) => Promise<CodexResourceSharingStatus>;
  private readonly inspectPluginStatus: () => Promise<AppPluginStatus>;
  private readonly agentRequests: AgentRequestRegistry;
  private readonly remoteTeams: RemoteTeamService;
  private readonly documents: DocumentWorkspaceService;
  private unsubscribeUsage?:()=>void;
  private readonly clientPreferences: ClientPreferencesService;
  private readonly agentPrompts: AgentPromptManager;
  private readonly planReviews: AgentPlanReviewService;
  private readonly threadFlags: AgentThreadFlagService;
  private readonly agentConversations: AgentConversationService;
  private readonly delegatedWorkReports: DelegatedWorkReportPort;
  private readonly agentHandoffs: AgentHandoffService;
  private readonly handoffListeners = new Set<(event: BackendPublishedEvent) => void>();
  private readonly agentWorkspaces: AgentWorkspaceService;
  private readonly subagentIdentities: SubagentIdentityService;
  private readonly agentGitService: AgentGitService;
  private readonly agentGitWorkflows: AgentGitWorkflowService;
  private readonly codeReviews?: CodeReviewService;
  private readonly agentCreation: AgentCreationService;
  private readonly projectCreation: ProjectCreationService;
  private readonly visualize: VisualizeService;
  private readonly deleteMissionHome: (missionId: string) => Promise<void>;
  private unsubscribeDriverEvents?: () => void;
  private lastEventSeq = 0;
  private conversationsReconciliation?: Promise<void>;
  private readonly providerSetup?: import('./provider-setup').ProviderSetup;
  private readonly providerConnections?: ProviderConnections;

  constructor(private readonly options: AppBackendServerOptions) {
    this.tasks = options.tasks;
    this.providerSetup = options.providerSetup;
    this.version = options.version;
    this.pid = options.pid ?? process.pid;
    this.snapshot = options.snapshot ?? createEmptySnapshot();
    if (options.providerSetup) {
      this.providerConnections = new ProviderConnections({
        detect: () => options.providerSetup!.list(),
        enabled: backend => options.requirements?.models?.[backend]?.length !== 0 && this.snapshot.general.providerEnabled?.[backend] !== false,
        authenticate: backend => this.authenticateProvider(backend),
        changed: connections => {
          const reconnected = connections.filter(connection => connection.connected && connection.installed && connection.enabled !== false && !connection.checking
            && !this.snapshot.providerConnections?.some(previous => previous.backend === connection.backend && previous.connected && previous.installed && previous.enabled !== false));
          this.snapshot.providerConnections = connections;
          // Publish the client projection without replacing live agents/review contexts.
          this.emitSnapshotUpdated(this.remoteTeams.clientSnapshotFromKnownRemotes());
          for (const agent of this.snapshot.agents) {
            if (reconnected.some(connection => connection.backend === agent.backend)) this.agentPrompts?.drain(agent.id);
          }
        },
      });
    }
    this.missions = new MissionService(this.snapshot, async snapshot => { await options.saveSnapshot?.(snapshot); });
    this.agentCreation = options.agentCreation ?? new AgentCreationService(this.snapshot);
    this.projectCreation = new ProjectCreationService({
      createRepository: name => this.createLocalSourceRepository(name),
      createAgent: async ({ repository, teamId, backend, backendDefaults }) => {
        const input: CreateAgentInput = {
          name: null,
          folder: repository.path,
          backend,
          sourceRepositoryName: repository.name,
          teamId,
          ...(backendDefaults ? { backendDefaults } : {}),
        };
        await this.validateAgentInput(input, null);
        const agent = this.agentCreation.create(input, { select: false });
        await this.agentWorkspaces.refreshIdentity(agent.id);
        await this.persistAndEmitSnapshot();
        await this.agentWorkspaces.refreshGitStatus(agent.id);
        return agent;
      },
      startAgent: (agent, prompt) => this.agentPrompts.sendAndWaitForAcceptance(agent, prompt),
    });
    this.driverRpc = options.driverRpc;
    this.unsubscribeUsage = options.driverRpc?.onUsage?.(event=>options.usage?.observe(event));
    this.onEvent = options.onEvent;
    this.onBackendEventApplied = options.onBackendEventApplied;
    this.saveSnapshot = options.saveSnapshot;
    this.workIntegrations = options.workIntegrations;
    this.automationRunner = options.automationRunner;
    this.systemPermissions = options.systemPermissions ?? createUnsupportedSystemPermissionsPort();
    this.sshConnections = options.sshConnections ?? new SshConnectionService();
    this.remoteClients = options.remoteClients ?? new RemoteDaemonClientManager();
    this.sendAgentMessage = options.sendAgentMessage;
    this.configureCodexResourceSharing = options.configureCodexResourceSharing ?? (options.providerSetup
      ? input => options.providerSetup!.setResourceSharing('codex', input) : setCodexResourceSharing);
    this.inspectCodexResourceSharing = options.inspectCodexResourceSharing ?? (options.providerSetup
      ? () => options.providerSetup!.getResourceSharingStatus('codex') : getCodexResourceSharingStatus);
    this.inspectPluginStatus = options.inspectPluginStatus ?? loadPluginStatus;
    this.agentGitService = options.agentGitService ?? new AgentGitService();
    this.agentGitService.setSettingsProvider?.(() => normalizeGitSettings(this.snapshot.general.git));
    this.agentWorkspaces = new AgentWorkspaceService({
      applyGitStatus: (agentId, status) => this.applyAndEmitBackendEvent({
        agentId,
        type: 'git.statusUpdated',
        payload: status,
      }),
      getGitStatus: (agent) => this.agentGitService.status(requireAgentFolder(agent)),
      getSnapshot: () => this.snapshot,
      persistSnapshot: () => this.persistSnapshotOnly(),
      resolveIdentity: typeof this.agentGitService.identity === 'function'
        ? (folder) => this.agentGitService.identity(folder)
        : undefined,
    });
    this.agentConversations = new AgentConversationService({
      applyEvent: (event) => this.applyAndEmitBackendEvent(event),
      driverRequest: (agent, method, params) => this.handleAgentDriverRequest(agent, method, params),
      getSnapshot: () => this.snapshot,
      persistSnapshot: () => this.persistSnapshotOnly(),
      refreshGitStatus: async (agentId) => { await this.agentWorkspaces.refreshGitStatus(agentId); },
      refreshWorkspaceIdentity: async (agentId) => { await this.agentWorkspaces.refreshIdentity(agentId); },
    });
    this.agentPrompts = new AgentPromptManager({
      isEngineConnected: agent => !this.options.providerUpdates?.isUpdating(agent.backend) && this.snapshot.providerConnections?.some(connection => connection.backend === agent.backend && connection.connected && connection.installed && connection.enabled !== false) === true,
      getSnapshot: () => this.snapshot,
      driverForAgent: (agent, expectedSessionId) => this.backendDriverForAgent(agent, expectedSessionId),
      applyEvent: (event) => this.applyAndEmitBackendEvent(event),
      persistSnapshot: () => this.persistSnapshotOnly(),
      setNewConversationTitle: (agentId, wasNewSession) => this.agentConversations.setNewTitle(agentId, wasNewSession),
      onPromptStarting: options.onPromptStarting,
      onPromptSource: options.onPromptSource,
    });
    this.visualize = options.visualizeService ?? new VisualizeService({
      snapshot: this.snapshot,
      generatedImagesRoot: path.join(os.tmpdir(), 'agent-workspace-generated-images'),
      persist: async () => { await this.persistSnapshotOnly(); },
      publish: () => { void this.emitProjectedSnapshot(); },
    });
    const ensureMissionHome = options.ensureMissionHome ?? (async (missionId: string) => {
      const home = path.join(os.tmpdir(), 'agent-workspace-missions', missionId);
      await mkdir(path.join(home, 'artifacts'), { recursive: true, mode: 0o700 });
      return home;
    });
    this.deleteMissionHome = options.deleteMissionHome ?? (async (missionId: string) => {
      await rm(await ensureMissionHome(missionId), { recursive: true, force: true });
    });
    this.missionArtifacts = options.missionArtifactStore ?? new FileMissionArtifactStore(ensureMissionHome);
    this.missionExecution = new MissionExecutionService({
      getHead: readWorktreeHead,
      snapshot: this.snapshot,
      missions: this.missions,
      publish: () => this.emitProjectedSnapshot(),
      reportImplementationStartProgress: payload => {
        this.onEvent?.({
          seq: this.nextEventSeq(),
          type: 'mission.implementationStartProgress',
          payload,
          occurredAt: new Date().toISOString(),
        });
      },
      ensureMissionHome,
      readArtifact: (missionId, stage) => this.missionArtifacts.read(missionId, stage),
      writeArtifact: (missionId, stage, content) => this.missionArtifacts.write(missionId, stage, content),
      validateRepository: async folder => {
        const identity = await this.agentGitService.identity(folder);
        if (identity.kind !== 'git') throw new Error('Choose a Git repository.');
      },
      createWorktree: input => this.requireDriverRpc().handle(backendMethods.sourceWorktreeCreate, { input }) as Promise<SourceWorktree>,
      ensureStageSkills: async (_missionId, stage) => missionStageSkills(stage),
      refreshWorkspace: async agentId => { await this.agentWorkspaces.refreshIdentity(agentId); },
      refreshConversationContext: async agent => {
        await this.requireDriverRpc().refreshConversationContext(agent);
      },
      continueStage: async (agentId, prompt) => { this.agentPrompts.send(agentId, prompt); },
      startRemediation: async (agentId, prompt) => {
        const agent = this.snapshot.agents.find(candidate => candidate.id === agentId);
        if (!agent) throw new Error('Mission Review worker is unavailable.');
        await this.agentPrompts.sendAndWaitForAcceptance(agent, prompt);
      },
      interrupt: agent => this.handleAgentDriverRequest(agent, backendMethods.driverInterrupt, { agent }),
    });
    this.planReviews = new AgentPlanReviewService({
      persist: () => this.persistAndEmitSnapshot(),
      submit: (agent, prompt, planMode) => this.agentPrompts.sendAndWaitForAcceptance(agent, prompt, { planMode }),
      emit: (event) => this.applyAndEmitBackendEvent(event),
    });
    this.threadFlags = new AgentThreadFlagService({
      submit: (agent, prompt) => this.agentPrompts.sendAndWaitForAcceptance(agent, prompt),
    });
    this.delegatedWorkReports = options.delegatedWorkReports ?? new DelegatedWorkReportService({
      getSnapshot: () => this.snapshot,
      readConversationMessages: async (agent) => {
        const ref = conversationRefFromAgent(agent);
        if (!ref) return [];
        return await this.handleAgentDriverRequest(
          agent,
          backendMethods.driverConversationMessagesGet,
          { ref, agentId: agent.id },
        ) as RendererMessage[];
      },
      sendPrompt: (agentId, prompt) => { this.agentPrompts.send(agentId, prompt); },
      sendMessage: this.sendAgentMessage,
    });
    this.agentHandoffs = new AgentHandoffService({
      snapshot: this.snapshot,
      assertReady: async agent => { await this.requireDriverRpc().handle(backendMethods.driverHandoffCheck, { agent }); },
      create: input => this.agentCreation.create(input, { select: false }),
      persist: () => this.persistAndEmitSnapshot(),
      requestNote: (agent, prompt) => requestHandoffNote(agent, prompt, {
        subscribe: listener => { this.handoffListeners.add(listener); return () => { this.handoffListeners.delete(listener); }; },
        send: (source, text) => this.sendHandoffPrompt(source, text),
        read: agent => this.requireDriverRpc().handle(backendMethods.driverConversationMessagesGet, { ref: conversationRefFromAgent(agent), agentId: agent.id }) as Promise<RendererMessage[]>,
      }),
      retire: async agent => {
        await this.retireConversation(agent);
        await this.requireDriverRpc().handle(backendMethods.driverConversationRelease, { backend: agent.backend, agentId: agent.id });
      },
      start: async (agent, prompt) => { await this.sendHandoffPrompt(agent, prompt); },
    });
    this.subagentIdentities = new SubagentIdentityService({
      applyEvent: (event) => this.handleBackendEvent(event, { persist: false }),
      getSnapshot: () => this.snapshot,
      loadSummary: this.driverRpc
        ? (agent, conversationId) => this.driverRpc!.handle(backendMethods.driverConversationSummaryGet, {
            agent,
            ref: { backend: 'codex', threadId: conversationId },
          }) as Promise<ConversationSummary | null>
        : undefined,
      persistSnapshot: () => this.persistSnapshotOnly(),
    });
    this.agentRequests = new AgentRequestRegistry({
      getSnapshot: () => this.snapshot,
      remoteConnectionIdForAgent: (agent) => {
        const team = agent.teamId
          ? this.snapshot.teams.find((candidate) => candidate.id === agent.teamId)
          : null;
        return team?.remoteConnectionId?.trim() || null;
      },
    });
    this.remoteTeams = new RemoteTeamService({
      clients: this.remoteClients,
      getSnapshot: () => this.snapshot,
      onForwardedEvent: (connectionId, event) => this.forwardRemoteBackendEvent(connectionId, event),
      onProjectedSnapshotChanged: () => { void this.emitProjectedSnapshot(); },
    });
    this.documents = options.documents ?? new DocumentWorkspaceService(path.join(backendHomeDir(), "document-workspaces.json"));
    this.clientPreferences = new ClientPreferencesService({
      snapshot: () => this.remoteTeams.clientSnapshot(),
      save: async (id, value) => {
        this.snapshot.clientPreferences = { ...this.snapshot.clientPreferences, [id]: value };
        await this.persistSnapshotOnly();
      },
    });
    this.agentGitWorkflows = new AgentGitWorkflowService({
      branchWork: new BranchCurrentWorkService({
        progress: payload => this.applyAndEmitBackendEvent({ agentId: payload.agentId, type: 'git.branchWorkProgress', payload }),
        provision: async (parent, input, folder, agentId) => {
          const worker = this.snapshot.agents.find(candidate => candidate.id === agentId)
            ?? this.agentCreation.create({ name: input.branchName, folder, backend: parent.backend, teamId: parent.teamId, delegatedByAgentId: parent.id }, { id: agentId, select: false });
          if (worker.folder !== folder) throw new Error('Reserved agent is bound to a different folder.');
          await this.agentWorkspaces.refreshIdentity(worker.id);
          await this.agentWorkspaces.refreshGitStatus(worker.id);
          await this.persistAndEmitSnapshot();
        },
      }),
      applyEvent: (event) => this.applyAndEmitBackendEvent(event),
      archiveConversation: async (agent) => {
        if (!agent.backendSession) return;
        await this.driverRpc?.handle(backendMethods.driverConversationArchive, { agent });
      },
      delegatedWorkReports: this.delegatedWorkReports,
      driverRequest: (agent, method, params) => this.handleAgentDriverRequest(agent, method, params),
      releaseConversation: async (agent) => {
        await this.driverRpc?.handle(backendMethods.driverConversationRelease, { backend: agent.backend, agentId: agent.id });
      },
      getSnapshot: () => this.snapshot,
      getWorkIntegrations: () => this.requireWorkIntegrations(),
      git: this.agentGitService,
      persistAndEmitSnapshot: () => this.persistAndEmitSnapshot(),
      refreshGitStatus: async (agentId) => { await this.agentWorkspaces.refreshGitStatus(agentId); },
      refreshWorkspaceIdentity: (agentId) => this.agentWorkspaces.refreshIdentity(agentId),
      sendPrompt: (agentId, prompt) => { this.agentPrompts.send(agentId, prompt); },
    });
    if (options.codeReviewTools) {
      this.codeReviews = new CodeReviewService({
        snapshot: this.snapshot,
        createAgent: (input, creationOptions) => this.agentCreation.create(input, creationOptions),
        tools: options.codeReviewTools,
        saveReport: options.saveCodeReviewReport ?? (async () => { throw new Error('Review report storage is unavailable.'); }),
        runReview: async (agent, prompt, reviewMcpServerUrl, reviewerSession) => {
          return await this.handleAgentDriverRequest(agent, backendMethods.driverCodeReviewRun, {
            agent,
            prompt,
            cwd: requireAgentFolder(agent),
            reviewMcpServerUrl,
            ...(reviewerSession ? { reviewerSession } : {}),
          }) as import('@workspace/core/backend-driver').BackendCodeReviewResult;
        },
        resetReviewer: async (agent) => {
          await this.disposeAndReleaseReviewConversation(agent, true);
          restartAgentConversation(this.snapshot, agent.id);
          this.agentRequests.clearAgent(agent.id);
        },
        deleteReviewer: async (agent, handoff, retainConversation) => {
          await this.disposeAndReleaseReviewConversation(agent, retainConversation);
          if (handoff && this.sendAgentMessage) {
            this.sendAgentMessage(agent.id, handoff.targetAgentId, handoff.content);
          }
          closeAgentInSnapshot(this.snapshot, agent.id);
          delete this.snapshot.agentGitStatuses[agent.id];
          this.agentRequests.clearAgent(agent.id);
        },
        changed: async () => { await this.persistAndEmitSnapshot(); },
        reportProgress: (agent, targetAgentId, content) => { this.sendAgentMessage?.(agent.id, targetAgentId, content); },
      });
    }
    this.unsubscribeDriverEvents = this.driverRpc?.onEvent((event) => this.handleBackendEvent(event));
  }

  async submitMissionResult(agentId: string, input: MissionResultInput) {
    return this.missionExecution.submit(agentId, input);
  }

  async closeAgentFromMcp(callerAgentId: string, agentId: string): Promise<void> {
    const caller = this.snapshot.agents.find(agent => agent.id === callerAgentId);
    const agent = this.snapshot.agents.find(agent => agent.id === agentId);
    if (!caller || !agent || agent.id === caller.id || agent.delegatedByAgentId !== caller.id) {
      throw new Error('Only the creator of an agent can close it.');
    }
    if (agent.status.type !== 'idle' || handoffInProgress(agent)
      || this.snapshot.queuedPrompts?.some(prompt => prompt.agentId === agentId)
      || this.snapshot.agentRequests?.[agentId]?.length) {
      throw new Error('Wait for the agent to become idle and resolve pending prompts or requests before closing it.');
    }
    if (this.tasks?.list(agentId).some(task => !['completed', 'cancelled', 'failed'].includes(task.state))) {
      throw new Error('Complete or cancel unfinished tasks before closing this agent.');
    }
    const response = await this.handleMessage({ jsonrpc: '2.0', id: randomUUID(), method: backendMethods.agentDelete, params: { agentId } });
    if (!response || 'error' in response) throw new Error(response && 'error' in response ? response.error.message : 'Agent closing failed.');
  }

  async startAutomaticReview(agentId: string, input: AutomaticReviewStartInput) {
    const agent = this.snapshot.agents.find(candidate => candidate.id === agentId);
    if (!agent) throw new Error('The review target is no longer available.');
    const session = this.requireCodeReviews().startAutomatic(agent, input);
    await this.persistAndEmitSnapshot();
    return { success: true as const, reviewId: session.id, reviewerAgentId: session.reviewerAgentId };
  }

  async createProjectFromQuickChat(agentId: string, name: string, prompt: string, backend?: Agent['backend']): Promise<CreatedProject> {
    const caller = this.snapshot.agents.find(agent => agent.id === agentId);
    if (caller?.sessionKind !== 'quickChat' || !caller.teamId) {
      throw new Error('create-project is available only in a Quick Chat with a team.');
    }
    if (!prompt.trim()) throw new Error('A self-contained project handoff prompt is required.');
    return this.projectCreation.create({
      name,
      teamId: caller.teamId,
      backend: resolveAgentBackend(this.snapshot, backend ?? caller.backend),
      backendDefaults: !backend || backend === caller.backend ? caller.backendDefaults : undefined,
      prompt,
    }, payload => this.applyAndEmitBackendEvent({ agentId: caller.id, type: 'agentCreation.progress', payload }));
  }

  async upsertMissionTicket(agentId: string, input: import('@workspace/core/mission-execution').MissionTicketDraftInput) {
    return this.missionExecution.upsertTicket(agentId, input);
  }

  listMissionArtifacts(agentId: string) {
    return this.missionExecution.listArtifacts(agentId);
  }

  readMissionArtifact(agentId: string, stage: import('@workspace/core/missions').MissionStage) {
    return this.missionExecution.readArtifact(agentId, stage);
  }

  writeMissionArtifact(agentId: string, input: import('@workspace/core/mission-execution').MissionArtifactWriteInput) {
    return this.missionExecution.writeArtifact(agentId, input);
  }

  reportMissionReviewFinding(agentId: string, input: import('@workspace/core/mission-execution').MissionReviewFindingInput) {
    return this.missionExecution.reportReviewFinding(agentId, input);
  }

  updateMissionReviewFinding(agentId: string, input: import('@workspace/core/mission-execution').MissionReviewFindingUpdateInput) {
    return this.missionExecution.updateReviewFinding(agentId, input);
  }

  missionContext(agentId: string) {
    return this.missionExecution.contextForAgent(agentId);
  }

  missionDeveloperInstructions(agentId: string) {
    return this.missionExecution.developerInstructionsForAgent(agentId);
  }

  async setMissionTitle(agentId: string, title: string) {
    return this.missionExecution.setTitle(agentId, title);
  }

  async attachMissionRepository(agentId: string, repoPath: string) {
    return this.missionExecution.attachRepository(agentId, repoPath);
  }

  private async deleteMission(input: DeleteMissionInput): Promise<void> {
    await this.missions.remove(input, async (deleted, workers) => {
      const workspacePaths = missionWorktreePaths(deleted);
      if (input.deleteWorktrees) {
        const workerIds = new Set(workers.map(worker => worker.id));
        for (const folder of workspacePaths) {
          const sharedAgent = this.snapshot.agents.find(agent => !workerIds.has(agent.id) && agent.folder === folder);
          if (sharedAgent) throw new Error(`The worktree is also used by ${sharedAgent.name}.`);
          await this.agentGitService.validateLinkedWorktreeDeletion(folder, false, undefined, true);
        }
      }
      for (const worker of workers) {
        if (worker.status.type === 'working' || worker.status.type === 'awaitingInput') {
          await this.handleAgentDriverRequest(worker, backendMethods.driverInterrupt, { agent: worker });
        }
        if (worker.backendSession) {
          await this.driverRpc?.handle(backendMethods.driverConversationArchive, { agent: worker });
          await this.driverRpc?.handle(backendMethods.driverConversationRelease, { backend: worker.backend, agentId: worker.id });
        }
      }
      if (input.deleteWorktrees) {
        for (const folder of workspacePaths) await this.agentGitService.deleteLinkedWorktree(folder, false, undefined, true);
      }
      await this.deleteMissionHome(deleted.id);
    });
  }

  /** A quick chat has no project to come back to, so closing it deletes the provider session; everything else is archived. */
  private async retireConversation(agent: Agent): Promise<void> {
    if (agent.sessionKind === 'quickChat') {
      const deleted = await this.driverRpc?.handle(backendMethods.driverConversationDelete, { agent });
      if (isRecord(deleted) && deleted.supported === true) return;
    }
    await this.driverRpc?.handle(backendMethods.driverConversationArchive, { agent });
  }

  private async disposeAndReleaseReviewConversation(agent: Agent, retainConversation = false): Promise<void> {
    if (agent.status.type === 'working' || agent.status.type === 'awaitingInput') {
      await this.handleAgentDriverRequest(agent, backendMethods.driverInterrupt, { agent }).catch(() => undefined);
    }
    if (agent.backendSession && retainConversation) {
      // Archive when supported (Codex); otherwise leave native history intact (Claude).
      // Archiving is housekeeping; a provider failure must not block reset, retry or finish.
      await this.driverRpc?.handle(backendMethods.driverConversationArchive, { agent }).catch(() => undefined);
    } else if (agent.backendSession) {
      await this.handleAgentDriverRequest(agent, backendMethods.driverCodeReviewDispose, {
        agent,
        reviewerSession: agent.backendSession,
      }).catch(() => undefined);
    }
    await this.driverRpc?.handle(backendMethods.driverConversationRelease, {
      backend: agent.backend,
      agentId: agent.id,
    });
  }

  async initialize(): Promise<void> {
    await this.agentHandoffs.recover();
    await this.providerConnections?.refresh();
    await this.initializeSourceFolderIfNeeded();
    if (this.snapshot.providerConnections?.some(provider => provider.backend === 'codex' && provider.connected)) await this.ensureRemoteControlStatus();
    await this.agentWorkspaces.reconcile();
    await this.reconcileConversationsOnce();
    await this.subagentIdentities.backfill();
    await this.missionExecution.refreshOwnedSkills();
    await this.missionExecution.recoverInterruptedRuns();
    for (const agent of this.snapshot.agents) await this.codeReviews?.resumeInterrupted(agent);
  }

  async requireConnectedEngine(backend?: Agent['backend']): Promise<Agent['backend']> {
    if (this.options.providerUpdates?.isUpdating(backend)) throw new Error('Provider upgrade is in progress. Try again when it finishes.');
    if (this.providerSetup?.isChanging(backend)) throw new Error('Engine setup is changing. Try again when it finishes.');
    await this.providerConnections?.refreshDisconnected(backend);
    if (this.options.providerUpdates?.isUpdating(backend)) throw new Error('Provider upgrade is in progress. Try again when it finishes.');
    return resolveAgentBackend(this.snapshot, backend);
  }

  private async authenticateProvider(backend: Agent['backend'], action: 'check' | 'cancel' | 'logout' | 'login' = 'check', loginId?: string): Promise<ProviderAuthentication> {
    return await this.requireDriverRpc().handle(backendMethods.driverProviderAuthentication, { backend, action, ...(loginId ? { loginId } : {}) }) as ProviderAuthentication;
  }

  private async observeAuthentication(authentication: ProviderAuthentication): Promise<void> {
    const { kind: backend, connected } = authentication;
    if (connected) {
      this.snapshot.general.providerEnabled = { ...this.snapshot.general.providerEnabled, [backend]: true };
    }
    this.providerConnections?.observe(backend, connected, authentication);
    await this.persistAndEmitSnapshot();
  }

  async handleMessage(message: AppRpcMessage): Promise<AppRpcResponse | undefined> {
    if (!isAppRpcRequest(message)) return this.dispatchMessage(message);
    if (message.method === backendMethods.companionControl) {
      try {
        if (!this.options.companionControl) throw new Error('Mobile access is unavailable.');
        return createAppRpcResult(message.id, await this.options.companionControl(requireRecord(message.params).input as import('@workspace/core/companion-protocol').CompanionControl));
      } catch { return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'Mobile access operation failed. Check the relay configuration or pairing state.'); }
    }
    if (this.providerSetup?.isChanging() && ![backendMethods.snapshotGet, backendMethods.providerSetupGet].some(method => method === message.method)) {
      return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'Engine setup is changing. Try again when it finishes.');
    }
    const params = isRecord(message.params) ? { ...message.params } : undefined;
    const clientId = typeof params?._clientId === 'string' ? params._clientId : 'desktop';
    if (!clientId.trim() || clientId.length > 200) return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'Invalid client identity.');
    if (params) delete params._clientId;
    const request = { ...message, params: params && Object.keys(params).length ? params : undefined };
    if ([backendMethods.usageGet,backendMethods.usageClear].some(method=>method===message.method)) {
      try {
        const usage=this.options.usage;if(!usage) throw new Error('Usage is unavailable on this host.');
        if(message.method===backendMethods.usageClear) {if(params&&Object.keys(params).length)throw new Error('Invalid clear request.');await usage.clear();return createAppRpcResult(message.id,null);}
        if(message.method===backendMethods.usageGet) {await usage.drain();return createAppRpcResult(message.id,usage.local.query((params?.filter??{}) as UsageFilter));}
      } catch { return createAppRpcError(message.id,appRpcErrorCodes.invalidParams,'Usage request is unavailable or invalid.'); }
    }

    if ([backendMethods.clientWorkspaceGet, backendMethods.clientWorkspaceApply, backendMethods.clientDocumentRead, backendMethods.clientDocumentSave].some(method => method === message.method)) {
      try {
        if (message.method === backendMethods.clientWorkspaceGet) return createAppRpcResult(message.id, await this.documents.get(clientId));
        const agentId = requireString(params?.agentId, 'agentId');
        if (message.method === backendMethods.clientWorkspaceApply) return createAppRpcResult(message.id, await this.documents.apply(clientId, agentId, requireRecord(params?.change) as DocumentWorkspaceChange));
        if (message.method === backendMethods.clientDocumentRead) return createAppRpcResult(message.id, await this.documents.read(clientId, agentId, requireString(params?.tabId, 'tabId'), async filePath => {
          const location = await this.locationForAgentId(agentId);
          if (!location) throw new Error('Agent not found.');
          const result = await this.requestInLocation<import('@workspace/core/contracts').AgentFilePreviewResult>(location, backendMethods.agentFilePreview, { agentId, filePath }, () => previewAgentFolderFile(agentFolder(location.agent), filePath));
          if (result.kind !== 'text') throw new Error('File cannot be previewed as text.');
          return result.content ?? '';
        }));
        const input = requireRecord(params?.input) as DocumentSaveInput;
        const location = await this.locationForAgentId(agentId);
        if (!location) throw new Error('Agent not found.');
        return createAppRpcResult(message.id, await this.documents.save(clientId, agentId, input, (filePath, content, overwrite) => this.requestInLocation(location, backendMethods.agentDocumentWrite, { agentId, filePath, content, overwrite }, () => saveMarkdownFile(agentFolder(location.agent), filePath, content, overwrite, backendHomeDir()))));
      } catch (error) { return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, error instanceof Error ? error.message : String(error)); }
    }
    const preferences = this.clientPreferences;
    if (preferences.supports(message.method)) {
      try { return createAppRpcResult(message.id, await preferences.update(clientId, message.method, params ?? {})); }
      catch (error) { return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, error instanceof Error ? error.message : String(error)); }
    }
    const startsIndependentReview = message.method === backendMethods.agentCodeReviewStart
      && isRecord(params?.input)
      && params.input.threadMode === 'independent';
    const completesReview = message.method === backendMethods.agentCodeReviewFinish
      || message.method === backendMethods.agentCodeReviewDiscard;
    const createsAgent = startsIndependentReview
      || [backendMethods.agentCreate, backendMethods.projectCreate, backendMethods.agentQuickChatCreate, backendMethods.agentDuplicate, backendMethods.agentFork].some((method) => method === message.method);
    const createsTeam = message.method === backendMethods.teamCreate || message.method === backendMethods.teamConnect;
    const before = createsAgent || createsTeam || completesReview ? await this.remoteTeams.clientSnapshot() : undefined;
    const reviewTargetAgentId = completesReview && before && typeof params?.agentId === 'string'
      ? projectClientSnapshot(before, clientId).agents.find((agent) => agent.id === params.agentId)?.codeReview?.targetAgentId
      : undefined;
    if (before && (message.method === backendMethods.agentCreate || message.method === backendMethods.projectCreate || message.method === backendMethods.agentQuickChatCreate)) {
      const input = isRecord(params?.input) ? params.input : {};
      const teamId = input.teamId ?? projectClientSnapshot(before, clientId).activeTeamId;
      if (typeof teamId !== 'string' || !before.teams.some((team) => team.id === teamId)) {
        return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'A valid target team is required.');
      }
      request.params = { ...params, input: { ...input, teamId } };
    }
    const creation: { id?: string } = {};
    const startsWork = createsAgent || [backendMethods.agentPromptSend, backendMethods.agentPromptSteer,
      backendMethods.agentUpdate, backendMethods.sourceWorktreeCreate, backendMethods.missionExecute].some(method => method === message.method);
    if (startsWork) {
      const effectiveParams = isRecord(request.params) ? request.params : {};
      const input = isRecord(effectiveParams.input) ? effectiveParams.input : {};
      const agent = (before ?? this.remoteTeams.clientSnapshotFromKnownRemotes()).agents.find(candidate => candidate.id === (params?.agentId ?? input.id));
      const teamId = typeof input.teamId === 'string' ? input.teamId : agent?.teamId;
      const remote = params?.remoteConnectionId || input.remoteConnectionId || this.snapshot.teams.find(team => team.id === teamId)?.remoteConnectionId;
      if (!remote && (message.method !== backendMethods.agentUpdate || input.backend !== undefined)) {
        try {
          const requested = isAgentBackend(input.backend) ? input.backend : agent?.backend;
          if (this.providerConnections) await this.requireConnectedEngine(requested);
        } catch (error) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, error instanceof Error ? error.message : String(error));
        }
      }
    }
    const sourceAgentId=[backendMethods.agentPromptSend,backendMethods.agentTurnRetry,backendMethods.agentTurnContinueInterrupted].some(method=>method===message.method) && typeof params?.agentId==='string' ? params.agentId : null;
    const source=sourceAgentId ? this.options.usage?.beginPrompt(sourceAgentId) : null;
    let response:AppRpcResponse|undefined;
    try { response = await this.dispatchMessage(request, (id) => { creation.id = id; }, clientId); }
    catch(error) {
      if(sourceAgentId)this.options.usage?.cancelPrompt(sourceAgentId,source);
      throw error;
    }
    if(sourceAgentId && response && 'error' in response)this.options.usage?.cancelPrompt(sourceAgentId,source);
    if (response && 'result' in response) {
      if (isAppSnapshot(response.result) && (createsAgent || createsTeam)) {
        const created = (createsAgent ? response.result.agents : response.result.teams).find((item) => item.id === creation.id);
        if (created && message.method === backendMethods.agentDuplicate && before) {
          const source = projectClientSnapshot(before, clientId).agents.find((agent) => agent.id === params?.agentId);
          if (source?.openInApplication) await preferences.update(clientId, backendMethods.clientAgentExternalApplicationUpdate,
            { agentId: created.id, application: source.openInApplication });
        }
        const shouldSelect = !isRecord(params?.options) || params.options.select !== false;
        if (created && shouldSelect) return { ...response, result: await preferences.update(clientId,
          createsAgent ? backendMethods.clientNavigationSelectAgent : backendMethods.clientNavigationSelectTeam,
          createsAgent ? { agentId: created.id } : { teamId: created.id }) };
      }
      if (isAppSnapshot(response.result) && reviewTargetAgentId && response.result.agents.some((agent) => agent.id === reviewTargetAgentId)) {
        return { ...response, result: await preferences.update(clientId, backendMethods.clientNavigationSelectAgent, { agentId: reviewTargetAgentId }) };
      }
      if (isAppSnapshot(response.result)) return { ...response, result: projectClientSnapshot(response.result, clientId) };
      if (isAppSnapshotGetResult(response.result)) return { ...response, result: { ...response.result, snapshot: projectClientSnapshot(response.result.snapshot, clientId) } };
    }
    return response;
  }

  private async withPromptSource<T>(agent: Agent, clientId: string, run: () => T | Promise<T>): Promise<T> {
    const rollback = this.options.onPromptSource?.(agent, clientId);
    try { return await run(); } catch (error) { rollback?.(); throw error; }
  }

  private async dispatchMessage(message: AppRpcMessage, onCreated: (id: string) => void = () => undefined, clientId = 'desktop'): Promise<AppRpcResponse | undefined> {
    if (isAppRpcNotification(message)) {
      return undefined;
    }

    if (!isAppRpcRequest(message)) {
      return createAppRpcError(null, appRpcErrorCodes.invalidRequest, 'Backend received a JSON-RPC response where a request was expected.');
    }

    const agentGitRequest = parseAgentGitRequest(message.method, message.params);
    if (agentGitRequest) {
      return this.routeAgentResultRequest(
        message.id,
        agentGitRequest.agentId,
        agentGitRequest.method,
        agentGitRequest.params,
        (agent) => this.agentGitWorkflows.execute(agentGitRequest, agent),
      );
    }

    switch (message.method) {
      case backendMethods.agentMarkRead: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const revision = params.revision;
        if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid read revision.');
        return this.routeAgentResultRequest(message.id, agentId, message.method, { agentId, revision }, async (agent) => {
          const current = agent.readState ?? { revision: 0, readRevision: 0 };
          if (revision > current.revision) throw new Error('Unknown read revision.');
          if (revision <= current.readRevision) return null;
          this.applyAndEmitBackendEvent({ type: 'agent.updated', agentId, payload: { id: agentId, readState: { ...current, readRevision: revision } } });
          await this.persistSnapshotOnly();
          return null;
        });
      }
      case backendMethods.backendHealthGet:
        return createAppRpcResult(message.id, {
          ok: true,
          name: product.daemonName,
          version: this.version,
          pid: this.pid,
        });
      case backendMethods.snapshotGet:
        const snapshot = await this.remoteTeams.clientSnapshot();
        return createAppRpcResult(message.id, {
          snapshot,
          lastEventSeq: this.lastEventSeq,
          clientState: this.clientStateFromSnapshot(snapshot),
        });
      case backendMethods.clientStateGet:
        return createAppRpcResult(message.id, this.clientStateFromSnapshot(await this.remoteTeams.clientSnapshot()));
      case backendMethods.debugAgentMessageSend: {
        const agentId = requireAgentId(message.params);
        const recipient = this.snapshot.agents.find((candidate) => candidate.id === agentId);
        if (!recipient) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Agent not found: ${agentId}`);
        }
        if (!this.sendAgentMessage) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Agent messaging is not configured.');
        }

        const sender = this.snapshot.agents.find((candidate) => (
          candidate.teamId === recipient.teamId && candidate.id !== recipient.id
        )) ?? recipient;
        this.sendAgentMessage(
          sender.id,
          recipient.id,
          'Reply with a brief confirmation that the Debug menu message arrived.',
        );
        return createAppRpcResult(message.id, {
          recipientId: recipient.id,
          senderId: sender.id,
        });
      }
      case backendMethods.debugExecutionPlanToggle: {
        const agentId = requireAgentId(message.params);
        const agent = this.snapshot.agents.find((candidate) => candidate.id === agentId);
        if (!agent) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Agent not found: ${agentId}`);
        }

        if (agent.plan) {
          delete agent.plan;
          return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
        }

        const turnId = `debug-plan-${Date.now()}`;
        agent.plan = {
          explanation: 'Debug execution plan',
          kind: 'execution',
          markdown: '- [x] Inspect the current state\n- [ ] Exercise the execution-plan overlay\n- [ ] Remove the debug fixture',
          status: 'inProgress',
          steps: [
            { step: 'Inspect the current state', status: 'completed' },
            { step: 'Exercise the execution-plan overlay', status: 'inProgress' },
            { step: 'Remove the debug fixture', status: 'pending' },
          ],
          threadId: agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : `debug-thread-${agentId}`,
          turnId,
          updatedAt: new Date().toISOString(),
        };
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.debugPlanReadyForReviewInject: {
        const params = requireRecord(message.params);
        const format = params.format ?? 'text';
        if (format !== 'text' && format !== 'choices') throw new Error('Plan fixture format must be text or choices.');
        const agentId = requireAgentId(params);
        const agent = this.snapshot.agents.find((candidate) => candidate.id === agentId);
        if (!agent) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Agent not found: ${agentId}`);
        }

        const markdown = [
          format === 'choices' ? '# Review the proposed workflow' : '# Debug text plan review',
          ...(format === 'choices' ? ['','## Which platforms should we support?', '', '- [x] macOS', '- [ ] Windows', '- [ ] Linux', '', '## Where should settings live?', '', '- ( ) In the project', '- (x) In the user home directory', '', '## Compatibility', '', '| Existing data | Proposed behavior |', '| --- | --- |', '| Settings | Preserve originals |', '| History | Retain all conversations |', '', '```text', '- ( ) This example is not an interactive choice', '```', ''] : []),
          '',
          '## Summary',
          '',
          'Exercise the full Plan-mode review workflow with a realistic proposal.',
          '',
          '## Key Changes',
          '',
          '- [ ] Inspect the current state and identify the relevant files.',
          '- [ ] Review the proposed changes before implementation.',
          '- [ ] Keep the implementation scoped to the requested behavior.',
          '',
          '## Implementation Notes',
          '',
          '- Preserve the existing conversation and side-panel state.',
          '- Prefer the smallest change that keeps the host boundary explicit.',
          '- Surface any assumptions before making a destructive change.',
          '',
          '## Tests',
          '',
          '- [ ] Run the focused tests.',
          '- [ ] Check the affected UI state in the running app.',
          '',
          '## Commit Strategy',
          '',
          'Keep the change reviewable and separate from unrelated work.',
        ].join('\n');
        this.applyAndEmitBackendEvent({
          agentId,
          backend: agent.backend,
          type: 'plan.readyForReview',
          turnId: `debug-plan-review-${Date.now()}`,
          payload: {
            markdown,
          },
        });
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.debugMissionStageSet: {
        const params = requireRecord(message.params);
        const missionId = requireString(params.missionId, 'missionId');
        const stage = params.stage;
        if (typeof stage !== 'string' || !featureStages.includes(stage as MissionStage)) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'stage must be a supported Mission stage');
        }
        const reviewState = params.reviewState;
        if (reviewState !== undefined && (stage !== 'review' || !['identified', 'remediated'].includes(reviewState as string))) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'reviewState must be identified or remediated for Review');
        }
        const mission = this.snapshot.missions?.find(candidate => candidate.id === missionId);
        for (const workerId of new Set(mission?.execution?.runs.flatMap(run => run.workerId ? [run.workerId] : []) ?? [])) {
          const worker = this.snapshot.agents.find(agent => agent.id === workerId);
          if (worker && (worker.status.type === 'working' || worker.status.type === 'awaitingInput')) {
            await this.handleAgentDriverRequest(worker, backendMethods.driverInterrupt, { agent: worker });
          }
        }
        applyMissionDebugFixture(this.snapshot, missionId, stage as MissionStage, undefined, reviewState as MissionReviewDebugState | undefined);
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.debugCodeReviewSet: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const scenario = debugCodeReviewScenario(params.scenario);
        const agent = this.snapshot.agents.find((candidate) => candidate.id === agentId);
        if (!agent) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Agent not found: ${agentId}`);
        }
        const session = createDebugCodeReviewSession(agent, scenario);
        if (scenario === 'automaticReviewing') this.requireCodeReviews().simulateInspection(agent, session);
        else {
          this.codeReviews?.closeForAgentRemoval(agent);
          agent.codeReview = session;
        }
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.debugVisualizePopulate: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const scenario = params.scenario ?? 'complete';
        if (typeof scenario !== 'string' || !visualizeDebugScenarios.includes(scenario as VisualizeDebugScenario)) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'scenario must be a supported Visualize debug scenario');
        }
        const agent = this.snapshot.agents.find((candidate) => candidate.id === agentId);
        if (!agent) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Agent not found: ${agentId}`);
        }
        agent.visualize = createVisualizeDebugFixture(agent, new Date().toISOString(), scenario as VisualizeDebugScenario);
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.debugThreadFlagSet: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const id = debugThreadFlagId(params.id);
        const value = params.value;
        if (typeof value !== 'boolean') {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'value must be a boolean');
        }
        const agent = this.snapshot.agents.find((candidate) => candidate.id === agentId);
        if (!agent) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Agent not found: ${agentId}`);
        }
        const threadFlags = { ...agent.threadFlags };
        if (value) threadFlags[id] = true;
        else delete threadFlags[id];
        agent.threadFlags = Object.keys(threadFlags).length > 0 ? threadFlags : undefined;
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.systemPermissionsGet:
        return createAppRpcResult(message.id, await this.systemPermissions.getStatus());
      case backendMethods.systemPermissionsAccessibilityOpen:
        return createAppRpcResult(message.id, await this.systemPermissions.openAccessibilitySettings());
      case backendMethods.systemPermissionsScreenRecordingOpen:
        return createAppRpcResult(message.id, await this.systemPermissions.openScreenRecordingSettings());
      case backendMethods.remoteControlStatusGet:
      case backendMethods.remoteControlEnable:
      case backendMethods.remoteControlDisable:
        {
          const status = await this.requireDriverRpc().handle(message.method, message.params) as DevicePairingStatus;
          this.publishRemoteControlStatus(status);
          return createAppRpcResult(message.id, status);
        }
      case backendMethods.remoteControlPairingStart:
      case backendMethods.remoteControlPairingCheck:
      case backendMethods.remoteControlClientsList:
      case backendMethods.remoteControlClientRevoke:
        return createAppRpcResult(message.id, await this.requireDriverRpc().handle(message.method, message.params));
      case backendMethods.connectionsSshHostsList:
        return createAppRpcResult(message.id, await this.sshConnections.listHostCandidates());
      case backendMethods.connectionsSshCreate: {
        const input = requireAddSshConnectionInput(message.params);
        const connection = await this.sshConnections.createConnection(input);
        this.snapshot.remoteConnections.connections = [
          ...this.snapshot.remoteConnections.connections.filter((candidate) => candidate.host !== connection.host),
          connection,
        ];
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.connectionsRuntimeInspect:
      case backendMethods.connectionsRuntimeSync: {
        const connectionId = requireConnectionId(message.params);
        const connection = this.snapshot.remoteConnections.connections.find((candidate) => candidate.id === connectionId);
        if (!connection) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Remote connection not found: ${connectionId}`);
        }
        if (message.method === backendMethods.connectionsRuntimeInspect) {
          const inspected = await this.sshConnections.inspectVersions(connection);
          // Do not replace a connection edited or deleted while SSH was probing.
          this.snapshot.remoteConnections.connections = this.snapshot.remoteConnections.connections.map((candidate) => (
            candidate === connection ? { ...candidate, daemonVersion: inspected.daemonVersion, codexVersion: inspected.codexVersion, detail: inspected.detail } : candidate
          ));
          return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
        }
        await this.remoteClients.closeConnection(connectionId);
        const checked = await this.sshConnections.checkConnection(connection);
        this.snapshot.remoteConnections.connections = this.snapshot.remoteConnections.connections.map((candidate) => (
          candidate.id === connectionId ? checked : candidate
        ));
        if (checked.status === 'ready' && checked.transport) {
          const remoteSnapshot = await this.remoteTeams.request<AppSnapshot>(
            connectionId,
            backendMethods.workProviderConnectionsReload,
          );
          this.remoteTeams.rememberSnapshot(connectionId, remoteSnapshot);
        }
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.connectionsUpdate: {
        const { connectionId, input } = requireUpdateRemoteConnectionInput(message.params);
        const sourceFolderPath = input.sourceFolderPath?.trim() ?? '';
        const connection = this.snapshot.remoteConnections.connections.find((candidate) => candidate.id === connectionId);
        if (!connection) throw new Error(`Remote connection not found: ${connectionId}`);
        await this.remoteClients.request(connection, backendMethods.settingsUpdate, {
          input: {
            sourceFolder: {
              path: sourceFolderPath,
            },
          },
        });
        this.snapshot.remoteConnections.connections = this.snapshot.remoteConnections.connections.map((candidate) => (
          candidate.id === connectionId
            ? remoteConnectionWithSourceFolder(candidate, sourceFolderPath)
            : candidate
        ));
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.connectionsDelete: {
        const connectionId = requireConnectionId(message.params);
        await this.remoteClients.closeConnection(connectionId);
        this.deleteTeamsForRemoteConnection(connectionId);
        this.snapshot.remoteConnections.connections = this.snapshot.remoteConnections.connections.filter((candidate) => candidate.id !== connectionId);
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.agentRequestRespond: {
        const response = requireAgentRequestResponse(message.params);
        const pendingSnapshot = await this.remoteTeams.clientSnapshot();
        const candidates = Object.entries(pendingSnapshot.agentRequests ?? {})
          .filter(([agentId, requests]) => (!response.agentId || response.agentId === agentId)
            && requests.some((request) => request.id === response.id));
        if (!response.agentId && candidates.length > 1) throw new Error('Agent identity is required for this request.');
        const agentId = response.agentId ?? candidates[0]?.[0];
        const targetedResponse = { ...response, ...(agentId ? { agentId } : {}) };
        const location = agentId ? await this.locationForAgentId(agentId) : null;
        if (location?.kind === 'remote') {
          // The owning daemon validates its authoritative pending state. A reconnect
          // need not replay every request-created event to the controlling client.
          return this.routeAgentSnapshotRequest(message.id, agentId!, backendMethods.agentRequestRespond,
            { response: targetedResponse }, () => { throw new Error('Expected remote request owner.'); });
        }
        await this.agentRequests.respond(targetedResponse, async (owner) => { await this.requestInLocation(
          this.locationFromRemoteConnectionId(owner.remoteConnectionId),
          backendMethods.driverAgentRequestRespond,
          { backend: owner.backend, response: targetedResponse },
          () => this.requireDriverRpc().handle(backendMethods.driverAgentRequestRespond, { backend: owner.backend, response: targetedResponse }),
        ); });
        return createAppRpcResult(message.id, await this.remoteTeams.clientSnapshot());
      }
      case backendMethods.agentCreate: {
        const input = requireAgentCreateInput(message.params);
        const remoteTeamPointer = this.remoteTeams.pointerForAgentInput(input);
        if (remoteTeamPointer) {
          const remoteSnapshot = await this.remoteTeams.request<AppSnapshot>(remoteTeamPointer.connectionId, backendMethods.agentCreate, {
            input: {
              ...input,
              teamId: remoteTeamPointer.remoteTeamId,
            },
          });
          this.remoteTeams.adoptCreatedAgentSnapshot(remoteTeamPointer, remoteSnapshot);
          if (remoteSnapshot.activeAgentId) onCreated(remoteSnapshot.activeAgentId);
          return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
        }
        await this.validateAgentInput(input, null);
        const createdAgent = this.agentCreation.create(input, { select: false });
        onCreated(createdAgent.id);
        this.addRecentSourceRepository(input.sourceRepositoryName);
        await this.agentWorkspaces.refreshIdentity(createdAgent.id);
        const snapshot = await this.persistAndEmitSnapshot();
        await this.agentWorkspaces.refreshGitStatus(createdAgent.id);
        return createAppRpcResult(message.id, snapshot);
      }
      case backendMethods.projectCreate: {
        const input = requireProjectCreateInput(message.params);
        const remoteTeamPointer = this.remoteTeams.pointerForAgentInput(input);
        if (remoteTeamPointer) {
          const remoteSnapshot = await this.remoteTeams.request<AppSnapshot>(remoteTeamPointer.connectionId, backendMethods.projectCreate, {
            input: { ...input, teamId: remoteTeamPointer.remoteTeamId },
          });
          this.remoteTeams.adoptCreatedAgentSnapshot(remoteTeamPointer, remoteSnapshot);
          if (remoteSnapshot.activeAgentId) onCreated(remoteSnapshot.activeAgentId);
          return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
        }
        const team = this.snapshot.teams.find(candidate => candidate.id === input.teamId);
        if (!team) throw new Error(`Team not found: ${input.teamId}`);
        const created = await this.projectCreation.create({ ...input, teamId: team.id, backend: resolveAgentBackend(this.snapshot, input.backend) });
        onCreated(created.agent.id);
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.missionExecute: {
        const input = requireRecord(message.params).input as MissionExecutionInput;
        await this.missionExecution.execute(input);
        return createAppRpcResult(message.id, await this.remoteTeams.clientSnapshot());
      }
      case backendMethods.missionArtifactRead: {
        const params = requireRecord(message.params);
        if (typeof params.missionId !== 'string' || typeof params.stage !== 'string') throw new Error('Invalid mission artifact request.');
        return createAppRpcResult(message.id, await this.missionExecution.readArtifactForMission(
          params.missionId,
          params.stage as import('@workspace/core/missions').MissionStage,
        ));
      }
      case backendMethods.missionCreate: {
        const input = requireRecord(message.params).input as import('@workspace/core/missions').CreateMissionInput;
        const previousIds = new Set(this.snapshot.missions?.map(mission => mission.id));
        await this.missions.mutate('create', input);
        const mission = this.snapshot.missions?.find(candidate => !previousIds.has(candidate.id));
        if (!mission) throw new Error('Mission creation did not produce a mission.');
        await this.missionExecution.execute({
          id: mission.id,
          revision: mission.revision,
          action: 'run',
          memberId: input.orchestratorMemberId,
        });
        const snapshot = await this.remoteTeams.clientSnapshot();
        this.emitSnapshotUpdated(snapshot);
        return createAppRpcResult(message.id, snapshot);
      }
      case backendMethods.missionUpdate: {
        const input = isRecord(message.params) ? message.params.input : undefined;
        await this.missions.mutate('update', input);
        const snapshot = await this.remoteTeams.clientSnapshot();
        this.emitSnapshotUpdated(snapshot);
        return createAppRpcResult(message.id, snapshot);
      }
      case backendMethods.missionDelete: {
        const input = requireRecord(message.params).input as DeleteMissionInput;
        await this.deleteMission(input);
        const snapshot = await this.remoteTeams.clientSnapshot();
        this.emitSnapshotUpdated(snapshot);
        return createAppRpcResult(message.id, snapshot);
      }
      case backendMethods.agentQuickChatCreate: {
        const input = requireQuickChatCreateInput(message.params);
        const remoteTeamPointer = this.remoteTeams.pointerForAgentInput(input);
        if (remoteTeamPointer) {
          const remoteSnapshot = await this.remoteTeams.request<AppSnapshot>(remoteTeamPointer.connectionId, backendMethods.agentQuickChatCreate, {
            input: { ...input, teamId: remoteTeamPointer.remoteTeamId },
          });
          this.remoteTeams.adoptCreatedAgentSnapshot(remoteTeamPointer, remoteSnapshot);
          if (remoteSnapshot.activeAgentId) onCreated(remoteSnapshot.activeAgentId);
          return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
        }
        const createdAgentId = createEntityId('agent');
        createQuickChatInSnapshot(this.snapshot, input, undefined, createdAgentId, { select: false });
        onCreated(createdAgentId);
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.agentUpdate: {
        const input = requireAgentUpdateInput(message.params);
        return this.routeAgentSnapshotRequest(message.id, input.id, backendMethods.agentUpdate, { input }, async (existingAgent) => {
          const previousName = existingAgent.name;
          const agent = updateAgentFromInput(this.snapshot, input);
          if (!agent) {
            throw new Error(`Agent not found: ${input.id}`);
          }
          const shouldSyncConversationTitle = agent.name !== previousName && Boolean(agent.backendSession);
          if (shouldSyncConversationTitle) {
            agent.conversationTitle = formatConversationTitle(agent);
          }
          const snapshot = await this.persistAndEmitSnapshot();
          if (shouldSyncConversationTitle) {
            void this.agentConversations.syncTitle(agent.id);
          }
          return snapshot;
        });
      }


      case backendMethods.agentDuplicate: {
        const { agentId, options } = requireDuplicateAgentRequest(message.params);
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentDuplicate, {
          agentId,
          options: { ...options, select: true },
        }, async () => {
          const agent = duplicateAgentInSnapshot(this.snapshot, agentId, undefined, undefined, { ...options, select: false });
          if (!agent) {
            throw new Error(`Agent not found: ${agentId}`);
          }
          onCreated(agent.id);
          return this.persistAndEmitSnapshot();
        }, onCreated);
      }
      case backendMethods.agentFork: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const turnId = params.turnId === undefined ? undefined : requireString(params.turnId, 'turnId');
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentFork, {
          agentId,
          ...(turnId === undefined ? {} : { turnId }),
        }, async (agent) => {
          if (agent.status.type !== 'idle') {
            throw new Error('Agent must be idle before forking.');
          }
          if (!agent.backendSession) {
            throw new Error('Agent must have a conversation before forking.');
          }
          const targetAgent = createForkedAgentDraft(this.snapshot, agentId);
          if (!targetAgent) {
            throw new Error(`Agent not found: ${agentId}`);
          }
          const result = await this.handleAgentDriverRequest(agent, backendMethods.driverConversationFork, {
            agent,
            targetAgent,
            ...(turnId === undefined ? {} : { turnId }),
          }) as BackendConversationForkResult;
          const forked = attachForkedAgentInSnapshot(
            this.snapshot,
            agentId,
            targetAgent,
            result.backendSession,
            { select: false },
          );
          if (!forked) {
            throw new Error(`Agent not found: ${agentId}`);
          }
          onCreated(forked.id);
          if (result.activeTurnId) {
            forked.status = { type: 'working' };
          }
          this.agentConversations.setTitle(forked.id);
          return this.persistAndEmitSnapshot();
        }, onCreated);
      }
      case backendMethods.agentHandoff: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const value = requireRecord(params.input);
        const operationId = requireString(value.operationId, 'operationId');
        if (!operationId.trim() || operationId.length > 128 || !isAgentBackend(value.backend)) throw new Error('Invalid handoff request.');
        if (value.instructions !== undefined && (typeof value.instructions !== 'string' || value.instructions.length > 4000)) throw new Error('Handoff instructions must be at most 4,000 characters.');
        const input: AgentHandoffInput = {
          operationId, backend: value.backend as Agent['backend'],
          ...(value.model === undefined ? {} : { model: requireString(value.model, 'model') }),
          ...(value.instructions === undefined ? {} : { instructions: value.instructions as string }),
        };
        const replacement = this.snapshot.agents.find(agent => agent.handoff?.sourceAgentId === agentId && agent.handoff.operationId === operationId);
        if (replacement && replacement.id !== agentId) {
          await this.agentHandoffs.run(agentId, input);
          return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
        }
        if (!this.localAgentForId(agentId)) {
          const projected = await this.remoteTeams.clientSnapshot();
          const remoteTarget = projected.agents.find(agent => agent.handoff?.sourceAgentId === agentId && agent.handoff.operationId === operationId);
          if (remoteTarget) return this.routeAgentSnapshotRequest(message.id, remoteTarget.id, message.method, { agentId, input }, async () => { throw new Error('Remote handoff owner is unavailable.'); });
        }
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, input }, async () => {
          if (this.tasks?.list(agentId).some(task => !['completed', 'cancelled', 'failed'].includes(task.state))) {
            throw new Error('Resolve or cancel durable tasks before handing off this agent.');
          }
          await this.agentHandoffs.run(agentId, input);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentTeamMove: {
        const input = requireMoveAgentInput(message.params);
        const route = await this.locationForAgentId(input.agentId);
        if (route?.kind === 'remote') {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Remote agents cannot be moved between teams from the local pointer.');
        }
        const movingAgent = this.snapshot.agents.find((candidate) => candidate.id === input.agentId);
        const targetTeam = this.snapshot.teams.find((candidate) => candidate.id === input.teamId) ?? null;
        if (!movingAgent || !targetTeam) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Agent or team not found: ${input.agentId} -> ${input.teamId}`);
        }
        if (handoffInProgress(movingAgent)) throw new Error('Wait for the handoff to finish.');
        if (this.remoteTeams.pointerForTeam(targetTeam)) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Agents cannot be moved between backend locations.');
        }
        const agent = moveAgentToTeamInSnapshot(this.snapshot, input.agentId, input.teamId);
        if (!agent) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Agent or team not found: ${input.agentId} -> ${input.teamId}`);
        }
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }


      case backendMethods.agentDelete: {
        const { agentId, input } = requireAgentCloseRequest(message.params);
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentDelete, {
          agentId,
          ...(input ? { input } : {}),
        }, async (existingAgent) => {
          const finishedPullRequest = input?.pullRequestCleanup === true
            ? existingAgent.pullRequest
            : undefined;
          if (input?.pullRequestCleanup === true) {
            if (!finishedPullRequest || (finishedPullRequest.state !== 'merged' && finishedPullRequest.state !== 'closed')) {
              throw new Error('This agent does not have a finished pull request ready for cleanup.');
            }
            if (existingAgent.status.type === 'working' || existingAgent.status.type === 'awaitingInput') {
              throw new Error('Wait for the agent to finish before cleaning up its pull request.');
            }
            if (finishedPullRequest.state === 'closed' && input.deleteRemoteBranch === true) {
              throw new Error('Keep the remote branch when cleaning up a pull request that was closed without merging.');
            }
          }
          if (input?.deleteWorktree) {
            const folder = requireAgentFolder(existingAgent);
            const sharedAgent = this.snapshot.agents.find((agent) => agent.id !== agentId && agent.folder === folder);
            if (sharedAgent) throw new Error(`The worktree is also used by ${sharedAgent.name}.`);
            await this.agentGitService.validateLinkedWorktreeDeletion(
              folder,
              input.deleteRemoteBranch === true,
              finishedPullRequest?.headSha,
              input.discardChanges === true,
            );
          }
          if (existingAgent.backendSession) {
            await this.retireConversation(existingAgent);
            await this.driverRpc?.handle(backendMethods.driverConversationRelease, {
              backend: existingAgent.backend,
              agentId,
            });
          }
          if (input?.deleteWorktree) {
            await this.agentGitService.deleteLinkedWorktree(
              requireAgentFolder(existingAgent),
              input.deleteRemoteBranch === true,
              finishedPullRequest?.headSha,
              input.discardChanges === true,
            );
          }
          this.codeReviews?.closeForAgentRemoval(existingAgent);
          const agent = closeAgentInSnapshot(this.snapshot, agentId);
          this.agentRequests.clearAgent(agentId);
          if (!agent) {
            throw new Error(`Agent not found: ${agentId}`);
          }
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentDocumentWrite: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        return this.routeAgentResultRequest(message.id, agentId, message.method, params, agent => saveMarkdownFile(agentFolder(agent), requireString(params.filePath, 'filePath'), requireString(params.content, 'content'), params.overwrite === true, backendHomeDir()));
      }
      case backendMethods.agentFilesList: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentResultRequest(message.id, agentId, backendMethods.agentFilesList, { agentId }, (agent) => this.handleAgentDriverRequest(agent, backendMethods.workspaceFilesList, {
          folder: requireAgentFolder(agent),
        }));
      }
      case backendMethods.agentFileChunkRead:
      case backendMethods.agentFilePreview: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const chunk = message.method === backendMethods.agentFileChunkRead;
        const offset = chunk ? { offset: params.offset } : {};
        return this.routeAgentResultRequest(message.id, agentId, message.method, {
          agentId,
          filePath: requireString(params.filePath, 'filePath'),
          ...offset,
        }, (agent) => this.handleAgentDriverRequest(agent, chunk ? backendMethods.workspaceFileChunkRead : backendMethods.workspaceFilePreview, {
          folder: agentFolder(agent),
          filePath: requireString(params.filePath, 'filePath'),
          ...offset,
        }));
      }
      case backendMethods.agentVisualizeStart: {
        const agentId = requireStringParam(message.params, 'agentId');
        const params = requireRecord(message.params);
        const input = isRecord(params.input) ? params.input : undefined;
        const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, {
          agentId,
          ...(input ? { input: { ...(prompt ? { prompt } : {}) } } : {}),
        }, async () => {
          const result = await this.visualize.enter(agentId);
          if (prompt) this.agentPrompts.send(agentId, directVisualizationPrompt(prompt));
          else if (result.created) this.agentPrompts.send(agentId, initialVisualizePrompt());
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentVisualizeOpenSet: {
        const agentId = requireStringParam(message.params, 'agentId');
        const input = requireRecordParam(message.params, 'input');
        const open = input.open;
        if (typeof open !== 'boolean') {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'open must be a boolean');
        }
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, {
          agentId,
          input: { open },
        }, async () => {
          await this.visualize.setOpen(agentId, open);
          return this.remoteTeams.clientSnapshot();
        });
      }
      case backendMethods.agentVisualizationSuggestionGenerate: {
        const agentId = requireStringParam(message.params, 'agentId');
        const input = requireRecordParam(message.params, 'input');
        const suggestionId = requireString(input.suggestionId, 'suggestionId');
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, {
          agentId,
          input: { suggestionId },
        }, async () => {
          const session = this.visualize.contextForAgent(agentId);
          if (!session) throw new Error('Visualize mode is not active for this conversation.');
          this.agentPrompts.send(agentId, generateVisualizationSuggestionPrompt(session, suggestionId));
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentVisualizationSelect: {
        const agentId = requireStringParam(message.params, 'agentId');
        const input = requireRecordParam(message.params, 'input');
        const visualizationId = requireString(input.visualizationId, 'visualizationId');
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, {
          agentId,
          input: { visualizationId },
        }, async () => {
          await this.visualize.select(agentId, visualizationId);
          return this.remoteTeams.clientSnapshot();
        });
      }
      case backendMethods.agentVisualizationDelete: {
        const agentId = requireStringParam(message.params, 'agentId');
        const input = requireRecordParam(message.params, 'input');
        const visualizationId = requireString(input.visualizationId, 'visualizationId');
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, {
          agentId,
          input: { visualizationId },
        }, async () => {
          await this.visualize.delete(agentId, visualizationId);
          return this.remoteTeams.clientSnapshot();
        });
      }
      case backendMethods.agentVisualizationCanvasSave: {
        const agentId = requireStringParam(message.params, 'agentId');
        const input = requireRecordParam(message.params, 'input') as unknown as import('@workspace/core/visualize-canvas').SaveCanvasInput;
        return this.routeAgentResultRequest(message.id, agentId, message.method, { agentId, input },
          () => this.visualize.saveCanvas(agentId, input));
      }
      case backendMethods.agentVisualizationAssetGet: {
        const agentId = requireStringParam(message.params, 'agentId');
        const visualizationId = requireStringParam(message.params, 'visualizationId');
        return this.routeAgentResultRequest(message.id, agentId, message.method, {
          agentId,
          visualizationId,
        }, () => this.visualize.readAsset(agentId, visualizationId));
      }
      case backendMethods.agentModelsList: {
        const agentId = requireAgentId(message.params);
        const backend = requireRecord(message.params).backend;
        if (backend !== undefined && !isAgentBackend(backend)) throw new Error('Invalid model provider.');
        return this.routeAgentResultRequest(message.id, agentId, backendMethods.agentModelsList, { agentId, ...(backend ? { backend } : {}) }, (agent) => {
          const modelAgent = backend ? { ...agent, backend: resolveAgentBackend(this.snapshot, backend), backendSession: undefined, backendDefaults: undefined } : agent;
          return this.handleAgentDriverRequest(modelAgent, backendMethods.driverModelsList, { agent: modelAgent });
        });
      }
      case backendMethods.agentPluginsList: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentResultRequest(message.id, agentId, backendMethods.agentPluginsList, { agentId }, (agent) => this.handleAgentDriverRequest(agent, backendMethods.driverPluginsList, { agent }));
      }
      case backendMethods.agentSkillsList: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentResultRequest(message.id, agentId, backendMethods.agentSkillsList, { agentId }, (agent) => this.handleAgentDriverRequest(agent, backendMethods.driverSkillsList, { agent }));
      }
      case backendMethods.agentCodeReviewStart: {
        const agentId = requireStringParam(message.params, 'agentId');
        const input = requireRecordParam(message.params, 'input');
        if (!isCodeReviewStartInput(input)) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'Invalid code review start input.');
        }
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, input }, async (agent) => {
          const session = this.requireCodeReviews().start(agent, input);
          if (session.threadMode === 'independent') onCreated(session.reviewerAgentId);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentCodeReviewFindingDecide: {
        const agentId = requireStringParam(message.params, 'agentId');
        const input = requireRecordParam(message.params, 'input');
        if (!isCodeReviewDecisionInput(input)) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'Invalid code review decision input.');
        }
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, input }, async (agent) => {
          this.requireCodeReviews().decide(agent, input);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentCodeReviewFindingDiscuss: {
        const agentId = requireStringParam(message.params, 'agentId');
        const input = requireRecordParam(message.params, 'input');
        if (!isCodeReviewDiscussionInput(input)) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'Invalid code review discussion input.');
        }
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, input }, async (agent) => {
          this.requireCodeReviews().discuss(agent, input);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentCodeReviewRoundSubmit: {
        const agentId = requireStringParam(message.params, 'agentId');
        const sessionId = requireStringParam(message.params, 'sessionId');
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, sessionId }, async (agent) => {
          this.requireCodeReviews().submit(agent, sessionId);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentCodeReviewFinish: {
        const agentId = requireStringParam(message.params, 'agentId');
        const sessionId = requireStringParam(message.params, 'sessionId');
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, sessionId }, async (agent) => {
          await this.requireCodeReviews().finish(agent, sessionId);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentCodeReviewCommit: {
        const agentId = requireStringParam(message.params, 'agentId');
        const sessionId = requireStringParam(message.params, 'sessionId');
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, sessionId }, async (agent) => {
          await this.requireCodeReviews().commit(agent, sessionId);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentCodeReviewManual: {
        const agentId = requireStringParam(message.params, 'agentId');
        const sessionId = requireStringParam(message.params, 'sessionId');
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, sessionId }, async (agent) => {
          await this.requireCodeReviews().switchToManual(agent, sessionId);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentCodeReviewDiscard: {
        const agentId = requireStringParam(message.params, 'agentId');
        const sessionId = requireStringParam(message.params, 'sessionId');
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, sessionId }, async (agent) => {
          await this.requireCodeReviews().discard(agent, sessionId);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentCodeReviewAgain: {
        const agentId = requireStringParam(message.params, 'agentId');
        const sessionId = requireStringParam(message.params, 'sessionId');
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, sessionId }, async (agent) => {
          await this.requireCodeReviews().reviewAgain(agent, sessionId);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentConversationsList: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const input = conversationListInput(params.input);
        return this.routeAgentResultRequest(message.id, agentId, backendMethods.agentConversationsList, { agentId, input }, async (agent) => {
          await this.reconcileConversationsOnce();
          return this.handleAgentDriverRequest(agent, backendMethods.driverConversationsList, { agent, input });
        });
      }
      case backendMethods.agentConversationMessagesGet: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const ref = params.ref;
        if (!isBackendConversationRef(ref)) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Invalid conversation reference.');
        }
        const remoteConnectionId = automationLocationRemoteConnectionId(params);
        if (remoteConnectionId) {
          return createAppRpcResult(message.id, await this.remoteTeams.request(remoteConnectionId, backendMethods.agentConversationMessagesGet, { ref, agentId }));
        }
        const route = await this.locationForAgentId(agentId);
        if (route?.kind === 'remote') {
          return createAppRpcResult(message.id, await this.remoteTeams.request(route.connectionId, backendMethods.agentConversationMessagesGet, { ref, agentId }));
        }
        if (!this.agentConversations.isStoredConversationRef(ref, agentId)) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Conversation reference is not available.');
        }
        if (!route) {
          return createAppRpcResult(message.id, await this.requireDriverRpc().handle(backendMethods.driverConversationMessagesGet, { ref, agentId }));
        }
        return this.routeAgentResultRequest(message.id, agentId, backendMethods.agentConversationMessagesGet, { ref, agentId }, (agent) => {
          if (!this.agentConversations.isStoredConversationRef(ref, agentId)) {
            throw new Error('Conversation reference is not available.');
          }
          return this.handleAgentDriverRequest(agent, backendMethods.driverConversationMessagesGet, { ref, agentId });
        });
      }
      case backendMethods.agentWorkItemAssign: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const item = sanitizeWorkItemAssignmentSource(params.item);
        if (!item) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Invalid work item assignment.');
        }
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentWorkItemAssign, { agentId, item }, async () => {
          const agent = assignWorkItemToAgentInSnapshot(this.snapshot, agentId, item);
          if (!agent) {
            throw new Error(`Agent not found: ${agentId}`);
          }
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentWorkItemAssignmentDelete: {
        const params = requireRecord(message.params);
        const item = sanitizeWorkItemAssignmentSource(params.item);
        if (!item) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Invalid work item assignment.');
        }
        const remoteOwner = await this.remoteTeams.workItemAssignmentOwner(item);
        if (remoteOwner) {
          const remoteSnapshot = await this.remoteTeams.request<AppSnapshot>(
            remoteOwner.connectionId,
            backendMethods.agentWorkItemAssignmentDelete,
            { item },
          );
          this.remoteTeams.rememberSnapshot(remoteOwner.connectionId, remoteSnapshot);
          return createAppRpcResult(message.id, await this.remoteTeams.clientSnapshot());
        }
        if (removeWorkItemAssignmentFromSnapshot(this.snapshot, item)) {
          return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
        }
        return createAppRpcResult(message.id, await this.remoteTeams.clientSnapshot());
      }
      case backendMethods.agentConversationReset: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentConversationReset, { agentId }, async (agent) => {
          if (agent.backendSession) {
            await this.driverRpc?.handle(backendMethods.driverConversationArchive, { agent });
          }
          await this.driverRpc?.handle(backendMethods.driverConversationRelease, { backend: agent.backend, agentId });
          restartAgentConversation(this.snapshot, agentId);
          this.agentRequests.clearAgent(agentId);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentConversationLoad: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentConversationLoad, { agentId }, async () => {
          await this.agentConversations.hydrateAndRefresh(agentId);
          return this.snapshot;
        });
      }
      case backendMethods.agentConversationHistoryLoadOlder: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentResultRequest(message.id, agentId, backendMethods.agentConversationHistoryLoadOlder, { agentId }, async (agent) => (
          await this.handleAgentDriverRequest(agent, backendMethods.driverConversationHistoryLoadOlder, { agent }) as AgentHistoryLoadResult
        ));
      }
      case backendMethods.agentConversationContentRead: {
        const agentId = requireAgentId(message.params);
        const input = requireRecord(message.params).input;
        return this.routeAgentResultRequest(message.id, agentId, backendMethods.agentConversationContentRead, { agentId, input }, async (agent) => (
          this.handleAgentDriverRequest(agent, backendMethods.driverConversationContentRead, { agent, input })
        ));
      }
      case backendMethods.agentConversationResume: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const target = params.target as ConversationResumeTarget | undefined;
        const ref = target?.ref;
        if (!target || !isBackendConversationRef(ref) || (target.storageState !== 'active' && target.storageState !== 'archived')) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Invalid conversation reference.');
        }
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentConversationResume, { agentId, target }, async (agent) => {
          await this.reconcileConversationsOnce();
          if (ref.backend !== agent.backend) {
            throw new Error('Conversation backend does not match the agent backend.');
          }
          if (agent.status.type !== 'idle') {
            throw new Error('Agent must be idle before resuming a conversation.');
          }
          const previousAgent = structuredClone(agent);
          const previousRef = conversationRefFromAgent(previousAgent);
          const result = await this.handleAgentDriverRequest(agent, backendMethods.driverConversationResume, { agent, target }) as BackendConversationResumeResult;
          const resumedAgent = resumeAgentConversationInSnapshot(this.snapshot, agentId, result.backendSession);
          if (!resumedAgent) {
            throw new Error(`Agent not found: ${agentId}`);
          }
          this.agentConversations.setTitle(resumedAgent.id);
          try {
            return await this.persistAndEmitSnapshot();
          } catch (error) {
            const switchedAgent = this.snapshot.agents.find((candidate) => candidate.id === agentId);
            if (switchedAgent) {
              if (previousRef) {
                await this.handleAgentDriverRequest(switchedAgent, backendMethods.driverConversationResume, {
                  agent: switchedAgent,
                  target: { ref: previousRef, storageState: 'archived' },
                }).catch((rollbackError) => warnMain('sessions', 'conversation switch rollback failed', {
                  detail: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
                }));
              } else {
                await this.handleAgentDriverRequest(switchedAgent, backendMethods.driverConversationArchive, {
                  agent: switchedAgent,
                }).catch((rollbackError) => warnMain('sessions', 'new conversation rollback failed', {
                  detail: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
                }));
                await this.driverRpc?.handle(backendMethods.driverConversationRelease, {
                  backend: switchedAgent.backend,
                  agentId,
                });
              }
            }
            const agentIndex = this.snapshot.agents.findIndex((candidate) => candidate.id === agentId);
            if (agentIndex >= 0) this.snapshot.agents[agentIndex] = previousAgent;
            throw error;
          }
        });
      }
      case backendMethods.agentConversationReplaceWithSummary: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentConversationReplaceWithSummary, { agentId }, async (agent) => {
          if (agent.backend !== 'codex' || agent.backendSession?.kind !== 'codex') {
            throw new Error('Only an existing Codex session can be compressed.');
          }
          if (agent.status.type !== 'idle') {
            throw new Error('Agent must be idle before compressing its session.');
          }
          const result = await this.handleAgentDriverRequest(
            agent,
            backendMethods.driverConversationReplaceWithSummary,
            { agent },
          ) as BackendConversationReplacementResult;
          const compressedAgent = resumeAgentConversationInSnapshot(this.snapshot, agentId, result.backendSession);
          if (!compressedAgent) throw new Error(`Agent not found: ${agentId}`);
          this.agentConversations.setTitle(compressedAgent.id);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentGoalUpdate: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const objective = requireString(params.objective, 'objective').trim();
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentGoalUpdate, { agentId, objective }, async (agent) => {
          if (!objective) {
            return this.snapshot;
          }
          const wasNewSession = !agent.backendSession;
          const result = await this.handleAgentDriverRequest(agent, backendMethods.driverGoalUpdate, { agent, objective }) as BackendGoalResult;
          agent.backendSession = result.backendSession;
          this.agentConversations.setNewTitle(agentId, wasNewSession);
          if (result.goal) {
            agent.goal = result.goal;
            this.handleBackendEvent({
              agentId,
              threadId: result.goal.threadId,
              type: 'conversation.goalUpdated',
              payload: { goal: result.goal },
            }, { persist: false });
          }
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentGoalClear: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentGoalClear, { agentId }, async (agent) => {
          const wasNewSession = !agent.backendSession;
          const result = await this.handleAgentDriverRequest(agent, backendMethods.driverGoalClear, { agent }) as BackendGoalResult;
          agent.backendSession = result.backendSession;
          this.agentConversations.setNewTitle(agentId, wasNewSession);
          if (result.cleared) {
            delete agent.goal;
            this.handleBackendEvent({
              agentId,
              threadId: result.backendSession.kind === 'codex' ? result.backendSession.threadId : undefined,
              type: 'conversation.goalCleared',
              payload: {},
            }, { persist: false });
          }
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentApprovalPresetUpdate: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const preset = params.preset;
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentApprovalPresetUpdate, { agentId, preset }, async (agent) => {
          if (!isApprovalPreset(preset)) {
            return this.snapshot;
          }
          const wasNewSession = !agent.backendSession;
          const result = await this.handleAgentDriverRequest(agent, backendMethods.driverApprovalPresetUpdate, { agent, preset }) as BackendApprovalPresetResult;
          agent.backendSession = result.backendSession;
          this.agentConversations.setNewTitle(agentId, wasNewSession);
          agent.backendDefaults = approvalBackendDefaultsWithPreset(agent.backendDefaults, result.approvalPreset);
          this.snapshot.general.providerApprovalDefaults = {
            ...this.snapshot.general.providerApprovalDefaults, codex: result.approvalPreset,
          };
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentPermissionModeUpdate: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const mode = requireString(params.mode, 'mode');
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentPermissionModeUpdate, { agentId, mode }, async (agent) => {
          const result = await this.handleAgentDriverRequest(agent, backendMethods.driverPermissionModeUpdate, { agent, mode }) as BackendPermissionModeResult;
          agent.backendDefaults = result.backendDefaults;
          this.snapshot.general.providerApprovalDefaults = {
            ...this.snapshot.general.providerApprovalDefaults, [agent.backend]: mode,
          };
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentPlanReviewRespond: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const input = requireRecord(params.response);
        const response: PlanReviewResponse = {
          reviewId: requireString(input.reviewId, 'reviewId'),
          resolution: requireString(input.resolution, 'resolution') as PlanReviewResponse['resolution'],
          ...(input.feedback === undefined ? {} : { feedback: requireString(input.feedback, 'feedback') }),
          ...(input.draft === undefined ? {} : { draft: input.draft as PlanReviewResponse['draft'] }),
          ...(input.draftVersion === undefined ? {} : { draftVersion: input.draftVersion as number }),
        };
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, response }, async (agent) => {
          await this.planReviews.respond(agent, response);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentThreadFlagRespond: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const input = requireRecord(params.response);
        const response: ThreadFlagResponse = {
          id: requireString(input.id, 'id') as ThreadFlagResponse['id'],
          action: requireString(input.action, 'action') as ThreadFlagResponse['action'],
        };
        return this.routeAgentSnapshotRequest(message.id, agentId, message.method, { agentId, response }, async (agent) => {
          await this.threadFlags.respond(agent, response);
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentPromptSend: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const prompt = requirePromptText(params.prompt, params.options as SendPromptOptions | undefined);
        const expectedSessionId = requireExpectedSessionId(params);
        const expectation = expectedSessionId === undefined ? {} : { expectedSessionId };
        return this.routeAgentSnapshotRequest(
          message.id,
          agentId,
          backendMethods.agentPromptSend,
          {
            agentId,
            prompt,
            options: params.options as SendPromptOptions | undefined,
            ...expectation,
          },
          async (agent) => {
            assertPromptSession(agent, expectedSessionId);
            const options = params.options as SendPromptOptions | undefined;
            // Phone receipts await provider acceptance when idle; busy sends enter the desktop queue.
            let result: AppSnapshot;
            if (expectedSessionId !== undefined && this.agentPrompts.canStart(agent)) {
              await this.agentPrompts.sendAndWaitForAcceptance(agent, prompt, options, expectedSessionId, clientId);
              result = this.snapshot;
            } else result = this.agentPrompts.send(agentId, prompt, options, clientId);
            if (prompt.trim() || options?.attachments?.length) this.clearTurnSuggestionsForNewPrompt(agent);
            await this.persistSnapshotOnly();
            return result;
          },
        ).catch(error => {
          if (error instanceof PromptRejectedError) return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, error.message);
          throw error;
        });
      }
      case backendMethods.agentPromptSteer: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const prompt = requirePromptText(params.prompt, params.options as SendPromptOptions | undefined).trim();
        const options = params.options as SendPromptOptions | undefined;
        if (params.startIfIdle !== undefined && typeof params.startIfIdle !== 'boolean') throw new Error('Invalid startIfIdle.');
        const startIfIdle = params.startIfIdle === true;
        const expectedSessionId = requireExpectedSessionId(params);
        const expectation = expectedSessionId === undefined ? {} : { expectedSessionId };
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentPromptSteer, { agentId, prompt, options, ...expectation, ...(startIfIdle ? { startIfIdle } : {}) }, async (agent) => {
          assertPromptSession(agent, expectedSessionId);
          if (!prompt && !options?.attachments?.length) {
            return this.snapshot;
          }
          // Decide at the owning daemon, never from a phone's potentially stale snapshot.
          // Receipt-based admission starts immediately or rejects; it cannot enqueue.
          if (startIfIdle && this.agentPrompts.canStart(agent)) {
            await this.agentPrompts.sendAndWaitForAcceptance(agent, prompt, options, expectedSessionId, clientId);
            this.clearTurnSuggestionsForNewPrompt(agent);
            await this.persistSnapshotOnly();
            return this.snapshot;
          }
          if (options?.delegation !== undefined) {
            if (!isDelegationOverrides(options.delegation)) throw new Error('Invalid worktree delegation overrides.');
          }
          const previousControls = agent.userDelegationOverrides;
          const controls = options?.delegation !== undefined ? captureUserDelegationOverrides(agent, options.delegation) : previousControls;
          let result: BackendSendResult;
          try {
            result = await this.withPromptSource(agent, clientId, () => this.handleAgentDriverRequest(agent, backendMethods.driverPromptSteer, { agent, prompt, options, ...expectation })) as BackendSendResult;
            if (options?.delegation !== undefined) bindUserDelegationOverrides(agent, controls, result);
          } catch (error) {
            if (options?.delegation !== undefined && agent.userDelegationOverrides === controls) agent.userDelegationOverrides = previousControls;
            throw error;
          }
          agent.backendSession = result.backendSession;
          this.clearTurnSuggestionsForNewPrompt(agent);
          await this.persistSnapshotOnly();
          return this.snapshot;
        }).catch(error => {
          if (error instanceof PromptRejectedError) return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, error.message);
          throw error;
        });
      }
      case backendMethods.agentQueuedPromptDelete: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const promptId = requireString(params.promptId, 'promptId');
        const expectedSessionId = requireExpectedSessionId(params);
        const expectation = expectedSessionId === undefined ? {} : { expectedSessionId };
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentQueuedPromptDelete, { agentId, promptId, ...expectation }, async agent => {
          assertPromptSession(agent, expectedSessionId);
          this.agentPrompts.dequeue(agentId, promptId);
          return this.snapshot;
        });
      }
      case backendMethods.agentQueuedPromptUpdate: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const promptId = requireString(params.promptId, 'promptId');
        const prompt = requireString(params.prompt, 'prompt').trim();
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentQueuedPromptUpdate, { agentId, promptId, prompt }, async () => {
          const queuedPrompt = (this.snapshot.queuedPrompts ?? []).find((candidate) => candidate.agentId === agentId && candidate.id === promptId);
          if (!queuedPrompt) return this.snapshot;
          queuedPrompt.text = prompt;
          return this.persistAndEmitSnapshot();
        });
      }
      case backendMethods.agentQueuedPromptSteer: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const promptId = requireString(params.promptId, 'promptId');
        const replacement = params.prompt === undefined ? undefined : requireString(params.prompt, 'prompt').trim();
        const expectedSessionId = requireExpectedSessionId(params);
        const expectation = expectedSessionId === undefined ? {} : { expectedSessionId };
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentQueuedPromptSteer, {
          agentId,
          promptId,
          ...expectation,
          ...(replacement === undefined ? {} : { prompt: replacement }),
        }, async (agent) => {
          assertPromptSession(agent, expectedSessionId);
          const queuedPrompt = (this.snapshot.queuedPrompts ?? []).find((prompt) => prompt.agentId === agentId && prompt.id === promptId);
          if (!queuedPrompt) return this.snapshot;
          const prompt = replacement ?? queuedPrompt.text;
          if (this.agentPrompts.canStart(agent)) {
            return this.agentPrompts.startQueued(agent, queuedPrompt.id, prompt);
          }
          const result = await this.handleAgentDriverRequest(agent, backendMethods.driverPromptSteer, {
            agent,
            prompt,
            options: queuedPrompt.options,
            ...expectation,
          }) as BackendSendResult;
          agent.backendSession = result.backendSession;
          this.agentPrompts.dequeue(agentId, promptId);
          return this.snapshot;
        });
      }
      case backendMethods.agentInterrupt: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentInterrupt, { agentId }, async (agent) => {
          if (await this.codeReviews?.interruptSimulatedInspection(agent)) return this.snapshot;
          await this.tasks?.blockParent(agentId);
          // The inspection can settle before the provider acknowledges interruption.
          const inspectionRoundId = this.codeReviews?.activeInspectionRoundId(agent);
          try {
            const result = await this.handleAgentDriverRequest(agent, backendMethods.driverInterrupt, { agent }) as BackendSendResult;
            agent.backendSession = result.backendSession;
            const reviewChanged = await this.codeReviews?.handleTurnInterrupted(agent, inspectionRoundId) ?? false;
            if (!reviewChanged) await this.persistSnapshotOnly();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.applyAndEmitBackendEvent({
              agentId,
              type: 'agent.statusChanged',
              payload: { type: 'error', message: `Failed to interrupt ${backendDisplayName(agent.backend)}: ${errorMessage}` },
            });
          }
          return this.snapshot;
        });
      }
      case backendMethods.agentTasksList: {
        const agentId = requireAgentId(message.params);
        return this.routeAgentResultRequest(message.id, agentId, message.method, { agentId }, () => this.tasks?.list(agentId) ?? []);
      }
      case backendMethods.agentTaskCancel: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const taskId = requireString(params.taskId, 'taskId');
        return this.routeAgentResultRequest(message.id, agentId, message.method, { agentId, taskId }, () => {
          if (!this.tasks) throw new Error('Durable tasks are unavailable.');
          return this.tasks.cancel(agentId, taskId);
        });
      }
      case backendMethods.agentTurnDelete: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const turnId = requireString(params.turnId, 'turnId');
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentTurnDelete, { agentId, turnId }, async () => {
          const snapshot = await this.agentConversations.deleteTurn(agentId, turnId);
          if (!snapshot) {
            throw new Error(`Agent not found: ${agentId}`);
          }
          return snapshot;
        });
      }
      case backendMethods.agentTurnEdit: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const turnId = requireString(params.turnId, 'turnId');
        const content = requireString(params.content, 'content').trim();
        if (!content) {
          return createAppRpcResult(message.id, await this.remoteTeams.clientSnapshot());
        }
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentTurnEdit, { agentId, turnId, content }, async () => {
          const snapshot = await this.agentConversations.editTurn(agentId, turnId, content);
          if (!snapshot) throw new Error(`Agent not found: ${agentId}`);
          return snapshot;
        });
      }
      case backendMethods.agentTurnRetry: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        const turnId = requireString(params.turnId, 'turnId');
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentTurnRetry, { agentId, turnId }, async () => {
          const snapshot = await this.agentConversations.retryTurn(agentId, turnId);
          if (!snapshot) throw new Error(`Agent not found: ${agentId}`);
          return snapshot;
        });
      }
      case backendMethods.agentTurnContinueInterrupted: {
        const params = requireRecord(message.params);
        const agentId = requireString(params.agentId, 'agentId');
        return this.routeAgentSnapshotRequest(message.id, agentId, backendMethods.agentTurnContinueInterrupted, { agentId }, async () => {
          const snapshot = await this.agentConversations.continueInterruptedTurn(agentId);
          if (!snapshot) throw new Error(`Agent not found: ${agentId}`);
          return snapshot;
        });
      }
      case backendMethods.teamConnect:
      case backendMethods.teamCreate: {
        const input = requireTeamCreateInput(message.params);
        if (message.method === backendMethods.teamConnect
          ? !input.remoteConnectionId || !input.remoteTeamId
          : Boolean(input.remoteTeamId)) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams,
            'Use team/connect with a connection and existing team ID, or team/create without an existing team ID.');
        }
        validateTeamInput(input);
        this.remoteTeams.validateConnection(input.remoteConnectionId);
        const remoteConnectionId = input.remoteConnectionId?.trim() ?? '';
        if (remoteConnectionId) {
          let remoteTeam: Team;
          try {
            remoteTeam = await this.remoteTeams.resolveTeamForPointerInput(input);
          } catch (error) {
            return createAppRpcError(message.id, appRpcErrorCodes.internalError, error instanceof Error ? error.message : String(error));
          }
          const team = createTeamInSnapshot(this.snapshot, {
            name: remoteTeam.name,
            color: remoteTeam.color ?? input.color,
            remoteConnectionId,
            remoteTeamId: remoteTeam.id,
          }, undefined, { select: false });
          onCreated(team.id);
        } else {
          onCreated(createTeamInSnapshot(this.snapshot, input, undefined, { select: false }).id);
        }
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.teamUpdate: {
        const input = requireTeamUpdateInput(message.params);
        validateTeamInput(input);
        this.remoteTeams.validateConnection(input.remoteConnectionId);
        const existingTeam = this.snapshot.teams.find((candidate) => candidate.id === input.id) ?? null;
        if (!existingTeam) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Team not found: ${input.id}`);
        }
        const existingConnectionId = existingTeam.remoteConnectionId?.trim() ?? '';
        const nextConnectionId = input.remoteConnectionId?.trim() ?? '';
        const connectionChanged = existingConnectionId !== nextConnectionId;
        if (connectionChanged && await this.remoteTeams.teamHasAgents(existingTeam)) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Team connection cannot be changed while it has agents.');
        }

        const pointer = this.remoteTeams.pointerForTeam(existingTeam);
        let updateInput = input;
        if (connectionChanged && nextConnectionId) {
          let remoteTeam: Team;
          try {
            remoteTeam = await this.remoteTeams.resolveTeamForPointerInput(input);
          } catch (error) {
            return createAppRpcError(message.id, appRpcErrorCodes.internalError, error instanceof Error ? error.message : String(error));
          }
          updateInput = {
            ...input,
            remoteConnectionId: nextConnectionId,
            remoteTeamId: remoteTeam.id,
          };
        } else if (pointer && !connectionChanged) {
          const remoteSnapshot = await this.remoteTeams.request<AppSnapshot>(pointer.connectionId, backendMethods.teamUpdate, {
            input: {
              id: pointer.remoteTeamId,
              name: input.name,
              color: input.color,
            },
          });
          this.remoteTeams.rememberSnapshot(pointer.connectionId, remoteSnapshot);
          updateInput = {
            ...input,
            remoteConnectionId: pointer.connectionId,
            remoteTeamId: pointer.remoteTeamId,
          };
        }
        try {
          updateTeamInSnapshot(this.snapshot, updateInput);
        } catch (error) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, error instanceof Error ? error.message : String(error));
        }
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }

      case backendMethods.teamDelete: {
        const teamId = requireTeamId(message.params);
        const existingTeam = this.snapshot.teams.find((candidate) => candidate.id === teamId) ?? null;
        const pointer = this.remoteTeams.pointerForTeam(existingTeam);
        if (pointer) {
          const remoteSnapshot = await this.remoteTeams.request<AppSnapshot>(pointer.connectionId, backendMethods.teamDelete, {
            teamId: pointer.remoteTeamId,
          });
          this.remoteTeams.rememberSnapshot(pointer.connectionId, remoteSnapshot);
          this.ensureLocalFallbackBeforeRemovingTeam(teamId);
        } else if (existingTeam) {
          if (this.snapshot.teams.length <= 1) throw new Error('At least one team must remain open.');
          const missions = this.snapshot.missions?.filter(candidate => candidate.teamId === teamId) ?? [];
          let deletedMissions = 0;
          try {
            for (const mission of missions) {
              await this.deleteMission({ id: mission.id, revision: mission.revision, confirmed: true, deleteWorktrees: false });
              deletedMissions++;
            }
            const agents = existingTeam.agentIds
              .map((agentId) => this.snapshot.agents.find((candidate) => candidate.id === agentId))
              .filter((agent): agent is Agent => agent !== undefined && agent.backendSession !== undefined);
            for (const agent of agents) {
              await this.retireConversation(agent);
            }
            for (const agent of agents) {
              await this.driverRpc?.handle(backendMethods.driverConversationRelease, {
                backend: agent.backend,
                agentId: agent.id,
              });
            }
          } catch (error) {
            if (deletedMissions === 0) throw error;
            await this.emitProjectedSnapshot();
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(`Team deletion stopped after removing ${deletedMissions} of ${missions.length} Missions. The team remains; retry deletion to finish cleanup. ${reason}`, { cause: error });
          }
        }
        const team = closeTeamInSnapshot(this.snapshot, teamId);
        if (!team) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Team not found: ${teamId}`);
        }
        for (const agentId of team.agentIds) this.agentRequests.clearAgent(agentId);
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.teamDisconnect: {
        const teamId = requireTeamId(message.params);
        const existingTeam = this.snapshot.teams.find((candidate) => candidate.id === teamId) ?? null;
        if (this.remoteTeams.pointerForTeam(existingTeam)) {
          this.ensureLocalFallbackBeforeRemovingTeam(teamId);
        }
        const team = closeTeamInSnapshot(this.snapshot, teamId);
        if (!team) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Team not found: ${teamId}`);
        }
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }

      case backendMethods.settingsUpdate: {
        const { policy, preferences } = splitSettingsInput(requireSettingsUpdateInput(message.params));
        if (policy.general && 'providerHomes' in policy.general) throw new Error('Provider homes must be changed through provider setup.');
        if (Object.keys(preferences).length) throw new Error('Presentation settings must use client/preferences/update.');
        updateSettingsInSnapshot(this.snapshot, policy);
        if (policy.general?.providerEnabled) this.providerConnections?.updateEnabled();
        if (policy.general?.codexBinaryPath !== undefined) {
          this.providerSetup?.invalidateInstallation('codex');
          this.providerConnections?.invalidate('codex');
          await this.providerConnections?.refresh();
        }
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.engineInstructionsRead: {
        const { engine } = requireRecord(message.params);
        if (engine !== 'codex' && engine !== 'claude') throw new Error('Unknown instruction engine.');
        return createAppRpcResult(message.id, await readEngineInstructions(engine, this.snapshot.general.providerHomes));
      }
      case backendMethods.engineInstructionsSave: {
        const input = requireRecord(requireRecord(message.params).input);
        if (input.engine !== 'codex' && input.engine !== 'claude') throw new Error('Unknown instruction engine.');
        if (typeof input.text !== 'string') throw new Error('Invalid instruction text.');
        await saveEngineInstructions({ engine: input.engine, text: input.text, all: input.all as boolean | undefined, confirmed: input.confirmed === true }, this.snapshot.general.providerHomes);
        return createAppRpcResult(message.id, null);
      }
      case backendMethods.settingsCodexResourceSharingGet:
        return createAppRpcResult(
          message.id,
          await this.inspectCodexResourceSharing(this.snapshot.general.providerHomes?.codex?.shareSkills !== false),
        );
      case backendMethods.settingsCodexResourceSharingSet: {
        const input = requireCodexResourceSharingInput(message.params);
        if (this.snapshot.general.providerHomes?.codex?.isolated === false) throw new Error('Codex uses your existing setup, including its skills and plugins.');
        if (hasActiveChats(this.snapshot) && !(input.enabled === false && input.mode === 'keep')) {
          throw new Error('Skills and plugins sharing cannot be changed while chats are running.');
        }
        await this.configureCodexResourceSharing(input);
        const home = this.snapshot.general.providerHomes?.codex ?? { isolated: true, homePath: backendCodexHomeDir() };
        this.snapshot.general.providerHomes = { ...this.snapshot.general.providerHomes, codex: { ...home, shareSkills: input.enabled } };
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.settingsPluginStatusGet:
        return createAppRpcResult(message.id, await this.inspectPluginStatus());
      case backendMethods.providerSetupGet: {
        const connectionId = requireOptionalConnectionId(message.params);
        if (connectionId) return createAppRpcResult(message.id, await this.remoteTeams.request(connectionId, message.method));
        if (!this.providerSetup) throw new Error('Provider setup is unavailable.');
        return createAppRpcResult(message.id, this.providerSetup.list());
      }
      case backendMethods.providerAuthenticate: {
        const params = requireRecord(message.params);
        const backend = requireAgentBackend(params.backend);
        if (backend !== 'antigravity' || (params.action !== 'login' && params.action !== 'cancel')) throw new Error('Unsupported native authentication action.');
        const authentication = await this.authenticateProvider(backend, params.action);
        this.providerConnections?.observe(backend, authentication.connected, authentication);
        await this.persistAndEmitSnapshot();
        return createAppRpcResult(message.id, authentication);
      }
      case backendMethods.providerUpdateGet:
      case backendMethods.providerUpdateSet: {
        const params = requireRecord(message.params);
        const backend = requireAgentBackend(params.backend);
        const connectionId = requireOptionalConnectionId(params);
        if (connectionId) return createAppRpcResult(message.id, await this.remoteTeams.request(connectionId, message.method, {
          backend, ...(params.input === undefined ? {} : { input: params.input }), ...(params.refresh === undefined ? {} : { refresh: params.refresh }),
        }));
        const updates = this.options.providerUpdates;
        if (!updates) throw new Error('Provider updates are unavailable.');
        if (message.method === backendMethods.providerUpdateGet) {
          if (params.refresh !== undefined && typeof params.refresh !== 'boolean') throw new Error('Invalid refresh option.');
          return createAppRpcResult(message.id, await updates.get(backend, params.refresh === true));
        }
        const input = requireRecord(params.input);
        if (input.action !== 'cancel' && input.action !== 'upgrade') throw new Error('Invalid provider update action.');
        return createAppRpcResult(message.id, updates.request(backend, input.action === 'cancel' ? { action: 'cancel' } : {
          action: 'upgrade', confirmed: input.confirmed === true, token: typeof input.token === 'string' ? input.token : undefined,
        }));
      }
      case backendMethods.providerDisconnect: {
        const backend = requireAgentBackend(requireRecord(message.params).backend);
        return this.respondInLocation(message.id,
          this.locationFromRemoteConnectionId(requireOptionalConnectionId(message.params)), message.method, { backend },
          async () => {
            const authentication = await this.authenticateProvider(backend, 'logout');
            await this.observeAuthentication(authentication);
            return authentication;
          });
      }
      case backendMethods.providerEnabledSet: {
        const input = requireRecord(message.params);
        if ((!isAgentBackend(input.backend)) || typeof input.enabled !== 'boolean') throw new Error('Invalid engine availability setting.');
        const connectionId = requireOptionalConnectionId(message.params);
        if (connectionId) {
          const providers = await this.remoteTeams.request(connectionId, message.method, { backend: input.backend, enabled: input.enabled });
          if (!Array.isArray(providers) || !providers.every(isProviderConnection)) throw new Error('Remote engine connections are unavailable. Update the remote runtime.');
          const connection = this.snapshot.remoteConnections.connections.find(item => item.id === connectionId);
          if (connection) connection.providerConnections = providers;
          this.emitSnapshotUpdated(this.remoteTeams.clientSnapshotFromKnownRemotes());
          return createAppRpcResult(message.id, providers);
        }
        if (!this.providerConnections) throw new Error('Engine connections are unavailable. Update the backend runtime.');
        updateSettingsInSnapshot(this.snapshot, { general: { providerEnabled: { ...this.snapshot.general.providerEnabled, [input.backend]: input.enabled } } });
        this.providerConnections.updateEnabled();
        await this.persistAndEmitSnapshot();
        return createAppRpcResult(message.id, this.providerConnections.list());
      }
      case backendMethods.bankedResetsGet: {
        const connectionId = requireOptionalConnectionId(message.params);
        if (connectionId) {
          const result = await this.remoteTeams.request(connectionId, message.method);
          if (!isBankedResets(result)) throw new Error('Could not read banked resets. Update the remote runtime.');
          return createAppRpcResult(message.id, result);
        }
        const provider = this.snapshot.providerConnections?.find(item => item.backend === 'codex');
        if (!provider?.installed || provider.enabled === false) return createAppRpcResult(message.id, { status: 'unsupported' });
        if (!provider.connected) return createAppRpcResult(message.id, { status: 'signedOut' });
        const result = await this.requireDriverRpc().handle(backendMethods.driverBankedResetsGet, {});
        if (!isBankedResets(result)) throw new Error('Could not read banked resets. Update the backend runtime.');
        return createAppRpcResult(message.id, result);
      }
      case backendMethods.bankedResetUse: {
        const input = requireRecord(message.params).input;
        if (!isUseBankedResetInput(input)) throw new Error('Reset confirmation is required');
        const connectionId = requireOptionalConnectionId(message.params);
        if (connectionId) {
          const result = await this.remoteTeams.request(connectionId, message.method, { input });
          if (!isBankedResetResult(result)) throw new Error('Invalid banked reset outcome');
          return createAppRpcResult(message.id, result);
        }
        const provider = this.snapshot.providerConnections?.find(item => item.backend === 'codex');
        if (!provider?.installed || provider.enabled === false || !provider.connected) throw new Error('Codex account is unavailable');
        const result = await this.requireDriverRpc().handle(backendMethods.driverBankedResetUse, { input });
        if (!isBankedResetResult(result)) throw new Error('Invalid banked reset outcome');
        return createAppRpcResult(message.id, result);
      }
      case backendMethods.providerUsageGet: {
        const backend = requireRecord(message.params).backend;
        if (!isAgentBackend(backend)) throw new Error('Unknown provider.');
        if (!this.snapshot.providerConnections?.some(item => item.backend === backend && item.installed && item.connected && item.enabled !== false)) return createAppRpcResult(message.id, null);
        const result = await this.requireDriverRpc().handle(backendMethods.driverAccountRateLimitsGet, { backend }) as { supported: boolean; rateLimits?: import('@workspace/core/contracts').AccountRateLimits | null };
        const limits = result.supported ? result.rateLimits ?? null : this.snapshot.backendAccountRateLimits?.[backend] ?? (backend === 'codex' ? this.snapshot.accountRateLimits : undefined) ?? null;
        if (limits) this.applyAndEmitBackendEvent({ type: 'account.rateLimitsUpdated', backend, payload: { rateLimits: limits } });
        return createAppRpcResult(message.id, limits);
      }
      case backendMethods.providerConnectionsGet: {
        const connectionId = requireOptionalConnectionId(message.params);
        if (connectionId) {
          let providers: unknown;
          try { providers = await this.remoteTeams.request(connectionId, backendMethods.providerConnectionsGet); }
          catch { throw new Error('Could not read remote engine connections. Check the connection and update the remote runtime.'); }
          if (!Array.isArray(providers) || !providers.every(isProviderConnection)) throw new Error('Remote engine connections are unavailable. Update the remote runtime.');
          const connection = this.snapshot.remoteConnections.connections.find(item => item.id === connectionId);
          if (connection) connection.providerConnections = providers;
          this.emitSnapshotUpdated(this.remoteTeams.clientSnapshotFromKnownRemotes());
          return createAppRpcResult(message.id, providers);
        }
        if (!this.providerConnections) throw new Error('Engine connections are unavailable. Update the backend runtime.');
        return createAppRpcResult(message.id, await this.providerConnections.refreshDisconnected());
      }
      case backendMethods.providerSetupConfigure:
      case backendMethods.providerInstall:
      case backendMethods.providerRefresh: {
        const connectionId = requireOptionalConnectionId(message.params);
        if (connectionId && message.method !== backendMethods.providerSetupConfigure) {
          const input = requireRecord(message.params);
          return createAppRpcResult(message.id, await this.remoteTeams.request(connectionId, message.method, { backend: input.backend }));
        }
        if (!this.providerSetup) throw new Error('Provider setup is unavailable.');
        if (this.options.providerUpdates?.isUpdating()) throw new Error('Wait for the provider upgrade to finish.');
        const input = requireRecord(message.params);
        if (!isAgentBackend(input.backend)) throw new Error('Unknown provider.');
        let result;
        if (message.method === backendMethods.providerRefresh) result = await this.providerSetup.refresh(input.backend);
        else if (message.method === backendMethods.providerInstall) result = await this.providerSetup.install(input.backend);
        else {
          if (connectionId) throw new Error('Change remote engine setup on its owning host.');
          const choice = requireRecord(input.choice);
          if (typeof choice.isolated !== 'boolean' || typeof choice.shareSkills !== 'boolean') throw new Error('Invalid provider setup.');
          if (choice.removeAgentIds !== undefined && (!Array.isArray(choice.removeAgentIds) || !choice.removeAgentIds.every(id => typeof id === 'string'))) throw new Error('Invalid provider reset confirmation.');
          const previousIds = this.snapshot.agents.map(agent => agent.id);
          result = await this.providerSetup.configure(input.backend, { isolated: choice.isolated, shareSkills: choice.shareSkills, ...(choice.removeAgentIds === undefined ? {} : { removeAgentIds: choice.removeAgentIds as string[] }) });
          for (const agentId of previousIds) {
            if (!this.snapshot.agents.some(agent => agent.id === agentId)) this.agentRequests.clearAgent(agentId);
          }
        }
        this.providerConnections?.invalidate(input.backend);
        await this.providerConnections?.refresh();
        await this.persistAndEmitSnapshot();
        return createAppRpcResult(message.id, result);
      }
      case backendMethods.claudeAuthenticationGet: {
        if (!isRecord(message.params) || message.params.connectionId === undefined) {
          const auth = await this.authenticateProvider('claude');
          await this.observeAuthentication(auth);
          return createAppRpcResult(message.id, auth.state);
        }
        const connectionId = requireConnectionId(message.params);
        const connection = this.snapshot.remoteConnections.connections.find((candidate) => candidate.id === connectionId);
        if (!connection) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Remote connection not found: ${connectionId}`);
        }
        if (connection.status !== 'ready') {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, `Remote connection is not ready: ${connection.name}`);
        }
        return createAppRpcResult(message.id, await this.remoteTeams.request(connectionId, backendMethods.claudeAuthenticationGet));
      }
      case backendMethods.codexAuthenticationGet:
      case backendMethods.codexLoginCancel:
      case backendMethods.codexChatGptDeviceCodeLoginStart: {
        if (isRecord(message.params) && message.params.remoteConnectionId !== undefined
          && (typeof message.params.remoteConnectionId !== 'string' || !message.params.remoteConnectionId.trim())) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'remoteConnectionId must be a non-empty string.');
        }
        const remoteConnectionId = requireOptionalConnectionId(message.params);
        const loginId = isRecord(message.params) ? message.params.loginId : undefined;
        if (loginId !== undefined && (typeof loginId !== 'string' || !loginId.trim())) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'loginId must be a non-empty string.');
        }
        if (remoteConnectionId && message.method === backendMethods.codexLoginCancel && !loginId) {
          return createAppRpcError(message.id, appRpcErrorCodes.invalidParams, 'Remote cancellation requires a loginId.');
        }
        const params = loginId ? { loginId } : undefined;
        return this.respondInLocation(message.id,
          this.locationFromRemoteConnectionId(remoteConnectionId), message.method, params,
          async () => {
            if (message.method === backendMethods.codexChatGptDeviceCodeLoginStart) {
              return this.requireDriverRpc().handle(backendMethods.driverCodexChatGptDeviceCodeLoginStart, params);
            }
            const auth = await this.authenticateProvider('codex', message.method === backendMethods.codexLoginCancel ? 'cancel' : 'check', loginId as string | undefined);
            await this.observeAuthentication(auth);
            return auth.state;
          });
      }
      case backendMethods.codexChatGptLoginStart:
        return createAppRpcResult(
          message.id,
          await this.requireDriverRpc().handle(backendMethods.driverCodexChatGptLoginStart, undefined),
        );
      case backendMethods.codexLogout: {
        const auth = await this.authenticateProvider('codex', 'logout');
        await this.observeAuthentication(auth);
        return createAppRpcResult(message.id, auth.state);
      }
      case backendMethods.sourceRepositoriesList: {
        return this.respondInLocation(
          message.id,
          this.locationFromRemoteConnectionId(requireOptionalConnectionId(message.params)),
          backendMethods.sourceRepositoriesList,
          undefined,
          async () => {
            await this.initializeSourceFolderIfNeeded();
            const sourceFolderPath = this.snapshot.sourceFolder.path.trim();
            if (!sourceFolderPath) {
              return [];
            }
            return this.requireDriverRpc().handle(backendMethods.sourceRepositoriesList, {
              sourceFolderPath,
            });
          },
        );
      }
      case backendMethods.sourceRepositoryClone: {
        const input = requireSourceRepositoryCloneInput(message.params);
        const location = this.locationFromRemoteConnectionId(input.remoteConnectionId ?? null);
        try {
          const repository = await this.requestInLocation(
            location,
            backendMethods.sourceRepositoryClone,
            { input: { url: input.url } },
            async () => {
              await this.initializeSourceFolderIfNeeded();
              const sourceFolderPath = this.snapshot.sourceFolder.path.trim();
              if (!sourceFolderPath) throw new Error('Choose a source folder before cloning a repository.');
              return this.requireDriverRpc().handle(backendMethods.sourceRepositoryClone, {
                sourceFolderPath,
                url: input.url,
              }) as Promise<SourceRepository> | SourceRepository;
            },
          );
          if (location.kind === 'local') {
            this.addRecentSourceRepository(repository.name);
            await this.persistAndEmitSnapshot();
          }
          return createAppRpcResult(message.id, repository);
        } catch (error) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, error instanceof Error ? error.message : String(error));
        }
      }
      case backendMethods.sourceRepositoryCreate: {
        const input = requireSourceRepositoryCreateInput(message.params);
        const location = this.locationFromRemoteConnectionId(input.remoteConnectionId ?? null);
        try {
          const repository = await this.requestInLocation(
            location,
            backendMethods.sourceRepositoryCreate,
            { input: { name: input.name } },
            () => this.createLocalSourceRepository(input.name),
          );
          return createAppRpcResult(message.id, repository);
        } catch (error) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, error instanceof Error ? error.message : String(error));
        }
      }
      case backendMethods.sourceFoldersList: {
        const input = requireSourceFolderListInput(message.params);
        const request = {
          ...(input.path ? { path: input.path } : {}),
        };
        return this.respondInLocation(
          message.id,
          this.locationFromRemoteConnectionId(input.remoteConnectionId ?? null),
          backendMethods.sourceFoldersList,
          request,
          () => this.requireDriverRpc().handle(backendMethods.sourceFoldersList, request),
        );
      }
      case backendMethods.sourceWorktreePathSuggest: {
        const input = requireSourceWorktreeSuggestionInput(message.params);
        const location = this.locationFromRemoteConnectionId(input.remoteConnectionId ?? null);
        return this.respondInLocation(
          message.id,
          location,
          backendMethods.sourceWorktreePathSuggest,
          { input: sourceWorktreeInputWithoutRemoteConnection(input) },
          () => this.requireDriverRpc().handle(backendMethods.sourceWorktreePathSuggest, { input }),
        );
      }
      case backendMethods.sourceWorktreesList: {
        const params = requireRecord(message.params);
        const request = {
          repoPath: requireString(params.repoPath, 'repoPath'),
        };
        return this.respondInLocation(
          message.id,
          this.locationFromRemoteConnectionId(optionalTrimmedString(params.remoteConnectionId)),
          backendMethods.sourceWorktreesList,
          request,
          () => this.requireDriverRpc().handle(backendMethods.sourceWorktreesList, request),
        );
      }
      case backendMethods.sourceBranchesList: {
        const params = requireRecord(message.params);
        const request = { repoPath: requireString(params.repoPath, 'repoPath') };
        return this.respondInLocation(
          message.id,
          this.locationFromRemoteConnectionId(optionalTrimmedString(params.remoteConnectionId)),
          backendMethods.sourceBranchesList,
          request,
          () => this.requireDriverRpc().handle(backendMethods.sourceBranchesList, request) as Promise<SourceBranch[]> | SourceBranch[],
        );
      }
      case backendMethods.sourceWorktreeCreate: {
        const input = requireSourceWorktreeInput(message.params);
        const location = this.locationFromRemoteConnectionId(input.remoteConnectionId ?? null);
        try {
          const worktree = await this.requestInLocation(
            location,
            backendMethods.sourceWorktreeCreate,
            {
              input: sourceWorktreeInputWithoutRemoteConnection(input),
            },
            () => this.requireDriverRpc().handle(backendMethods.sourceWorktreeCreate, { input }) as Promise<SourceWorktree> | SourceWorktree,
          );
          if (location.kind === 'local') {
            this.addRecentSourceRepository(path.basename(input.repoPath));
            await this.persistAndEmitSnapshot();
          }
          return createAppRpcResult(message.id, worktree);
        } catch (error) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, error instanceof Error ? error.message : String(error));
        }
      }
      case backendMethods.workProviderConnect:
        return createAppRpcResult(message.id, await this.requireWorkIntegrations().connect(requireWorkProvider(message.params)));
      case backendMethods.workProviderAuthorizationPoll:
        return createAppRpcResult(message.id, await this.requireWorkIntegrations().pollAuthorization(requireWorkProvider(message.params)));
      case backendMethods.workProviderConnectionsReload: {
        await this.requireWorkIntegrations().hydrateConnections();
        return createAppRpcResult(message.id, await this.persistAndEmitSnapshot());
      }
      case backendMethods.workProviderDisconnect:
        return createAppRpcResult(message.id, await this.requireWorkIntegrations().disconnect(requireWorkProvider(message.params)));
      case backendMethods.workProviderBranchesList: {
        const params = requireRecord(message.params);
        const provider = requireWorkProvider(params);
        const sourceId = requireString(params.sourceId, 'sourceId');
        return this.respondInLocation(message.id, this.automationLocationFromParams(params), backendMethods.workProviderBranchesList,
          { provider, sourceId }, () => this.requireWorkIntegrations().listBranches(provider, sourceId));
      }
      case backendMethods.workProviderSourcesList: {
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(message.params),
          backendMethods.workProviderSourcesList,
          {
            provider: requireWorkProvider(message.params),
          },
          () => this.requireWorkIntegrations().listSources(requireWorkProvider(message.params)),
        );
      }
      case backendMethods.workProviderBacklogConfigure: {
        const params = requireRecord(message.params);
        const input = requireBacklogConfiguration(params);
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(params),
          backendMethods.workProviderBacklogConfigure,
          { input },
          () => this.requireWorkIntegrations().configureBacklog(input),
        );
      }
      case backendMethods.workProviderItemsList: {
        const params = requireRecord(message.params);
        const query = workItemQuery(params.query);
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(params),
          backendMethods.workProviderItemsList,
          {
            provider: requireWorkProvider(params),
            sourceId: requireString(params.sourceId, 'sourceId'),
            ...(query ? { query } : {}),
          },
          () => query
            ? this.requireWorkIntegrations().listItems(requireWorkProvider(params), requireString(params.sourceId, 'sourceId'), query)
            : this.requireWorkIntegrations().listItems(requireWorkProvider(params), requireString(params.sourceId, 'sourceId')),
        );
      }
      case backendMethods.workProviderGlobalItemsList: {
        const params = requireRecord(message.params);
        const query = globalWorkItemQuery(params.query);
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(params),
          backendMethods.workProviderGlobalItemsList,
          {
            provider: requireWorkProvider(params),
            ...(query ? { query } : {}),
          },
          () => query
            ? this.requireWorkIntegrations().listGlobalItems(requireWorkProvider(params), query)
            : this.requireWorkIntegrations().listGlobalItems(requireWorkProvider(params)),
        );
      }
      case backendMethods.workProviderAssignedItemsList: {
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(message.params),
          backendMethods.workProviderAssignedItemsList,
          { provider: requireWorkProvider(message.params) },
          () => this.requireWorkIntegrations().listAssignedItems(requireWorkProvider(message.params)),
        );
      }
      case backendMethods.snapshotAutomationsGet: {
        const location = this.automationLocationFromParams(message.params);
        if (location.kind === 'local') {
          return createAppRpcResult(message.id, this.snapshot);
        }
        const remoteSnapshotResult = await this.remoteTeams.request(location.connectionId, backendMethods.snapshotGet);
        if (!isAppSnapshotGetResult(remoteSnapshotResult)) {
          return createAppRpcError(message.id, appRpcErrorCodes.internalError, 'Remote automation snapshot is invalid.');
        }
        return createAppRpcResult(message.id, remoteSnapshotResult.snapshot);
      }
      case backendMethods.automationCreate: {
        const input = requireAutomationCreateInput(message.params);
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(message.params),
          backendMethods.automationCreate,
          { input },
          async () => {
            const automation = createAutomationInSnapshot(this.snapshot, input);
            if (!automation) {
              throw new Error('Invalid automation configuration.');
            }
            return this.persistAndEmitSnapshot();
          },
        );
      }
      case backendMethods.automationUpdate: {
        const input = requireAutomationUpdateInput(message.params);
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(message.params),
          backendMethods.automationUpdate,
          { input },
          async () => {
            const automation = updateAutomationInSnapshot(this.snapshot, input);
            if (!automation) {
              throw new Error(`Automation not found or invalid: ${input.id}`);
            }
            return this.persistAndEmitSnapshot();
          },
        );
      }
      case backendMethods.automationRun: {
        const automationId = requireAutomationId(message.params);
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(message.params),
          backendMethods.automationRun,
          { automationId },
          async () => {
            if (!this.snapshot.automations.some((automation) => automation.id === automationId)) {
              throw new Error(`Automation not found: ${automationId}`);
            }
            await this.requireAutomationRunner().runAutomation(automationId);
            return this.snapshot;
          },
        );
      }
      case backendMethods.automationHistoryClear: {
        const automationId = requireAutomationId(message.params);
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(message.params),
          backendMethods.automationHistoryClear,
          { automationId },
          async () => {
            const automation = clearAutomationExecutionHistoryInSnapshot(this.snapshot, automationId);
            if (!automation) {
              throw new Error(`Automation not found: ${automationId}`);
            }
            return this.persistAndEmitSnapshot();
          },
        );
      }
      case backendMethods.automationExecutionDelete: {
        const params = requireRecord(message.params);
        const automationId = requireString(params.automationId, 'automationId');
        const executionId = requireString(params.executionId, 'executionId');
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(params),
          backendMethods.automationExecutionDelete,
          { automationId, executionId },
          async () => {
            const automation = deleteAutomationExecutionFromSnapshot(this.snapshot, automationId, executionId);
            if (!automation) {
              throw new Error(`Automation execution not found: ${automationId}/${executionId}`);
            }
            return this.persistAndEmitSnapshot();
          },
        );
      }
      case backendMethods.automationDelete: {
        const automationId = requireAutomationId(message.params);
        return this.respondInLocation(
          message.id,
          this.automationLocationFromParams(message.params),
          backendMethods.automationDelete,
          { automationId },
          async () => {
            const automation = deleteAutomationFromSnapshot(this.snapshot, automationId);
            if (!automation) {
              throw new Error(`Automation not found: ${automationId}`);
            }
            return this.persistAndEmitSnapshot();
          },
        );
      }
      default:
        if (this.driverRpc) {
          try {
            const result = await this.driverRpc.handle(message.method, message.params);
            if (result !== undefined) {
              return createAppRpcResult(message.id, result);
            }
          } catch (error) {
            return createAppRpcError(message.id, appRpcErrorCodes.internalError, error instanceof Error ? error.message : String(error));
          }
        }
        return createAppRpcError(message.id, appRpcErrorCodes.methodNotFound, `Unknown backend method: ${message.method}`);
    }
  }

  async close(): Promise<void> {
    this.unsubscribeUsage?.();
    await this.options.providerUpdates?.close();
    this.providerConnections?.close();
    this.agentWorkspaces.close();
    this.delegatedWorkReports.close();
    this.agentPrompts.close();
    this.unsubscribeDriverEvents?.();
    await this.driverRpc?.close();
    await this.remoteClients.close();
    await this.options.usage?.close();
  }

  emitEvent(event: BackendEvent): void {
    this.handleBackendEvent(event);
  }

  setCompanionAccessEnabled(enabled: boolean): void {
    if (this.companionAccessEnabled === enabled) return;
    this.companionAccessEnabled = enabled;
    this.emitSnapshotUpdated(this.remoteTeams.clientSnapshotFromKnownRemotes());
  }

  private requireWorkIntegrations(): WorkIntegrationManager {
    if (!this.workIntegrations) {
      throw new Error('Work integrations are not configured.');
    }
    return this.workIntegrations;
  }

  private requireAutomationRunner(): Pick<AutomationRunner, 'runAll' | 'runAutomation'> {
    if (!this.automationRunner) {
      throw new Error('Automation runner is not configured.');
    }
    return this.automationRunner;
  }

  private requireDriverRpc(): BackendDriverRpc {
    if (!this.driverRpc) {
      throw new Error('Backend driver RPC is not configured.');
    }
    return this.driverRpc;
  }

  private requireCodeReviews(): CodeReviewService {
    if (!this.codeReviews) throw new Error('Code review is not configured.');
    return this.codeReviews;
  }

  private async handleAgentDriverRequest(agent: Agent, method: string, params: unknown): Promise<unknown> {
    const remoteConnectionId = this.remoteTeams.connectionIdForAgent(agent);
    return this.backendHandleForLocation(this.locationFromRemoteConnectionId(remoteConnectionId))
      .request(method, params, () => this.requireDriverRpc().handle(method, params));
  }

  private sendHandoffPrompt(agent: Agent, prompt: string): Promise<BackendSendResult> {
    return new Promise((resolve, reject) => {
      sendAgentPrompt(this.snapshot, this.backendDriverForAgent(agent), agent.id, prompt, undefined,
        event => this.applyAndEmitBackendEvent(event), {
          handoff: true,
          onPromptStarted: resolve,
          onPromptFailed: reject,
        });
    });
  }

  private async locationForAgentId(agentId: string): Promise<AgentLocation | null> {
    const localAgent = this.localAgentForId(agentId);
    if (localAgent) {
      return { kind: 'local', agent: localAgent };
    }

    const remoteOwner = await this.remoteTeams.agentOwner(agentId);
    return remoteOwner ? { kind: 'remote', ...remoteOwner } : null;
  }

  private localAgentForId(agentId: string): Agent | null {
    return this.snapshot.agents.find((agent) => agent.id === agentId) ?? null;
  }

  private async routeAgentSnapshotRequest(
    messageId: AppRpcResponse['id'],
    agentId: string,
    method: string,
    params: unknown,
    localHandler: (agent: Agent) => Promise<AppSnapshot> | AppSnapshot,
    onCreated?: (id: string) => void,
  ): Promise<AppRpcResponse> {
    const route = await this.locationForAgentId(agentId);
    if (!route) {
      return createAppRpcError(messageId, appRpcErrorCodes.internalError, `Agent not found: ${agentId}`);
    }
    if (route.kind === 'local') {
      if (handoffInProgress(route.agent) && method !== backendMethods.agentHandoff && method !== backendMethods.agentInterrupt) {
        throw new Error('Wait for the handoff to finish.');
      }
      return createAppRpcResult(messageId, await localHandler(route.agent));
    }
    if (method === backendMethods.agentPromptSend || method === backendMethods.agentPromptSteer) {
      const options = requireRecord(params).options as SendPromptOptions | undefined;
      if (options?.attachments?.length) throw new Error('Remote attachments require a trusted file transfer. Send text or use a local agent.');
    }
    const result = await this.backendHandleForAgentLocation(route).request<AppSnapshot>(method, params, () => localHandler(route.agent));
    const decodedSnapshot = decodeAppSnapshot(result);
    if (decodedSnapshot) {
      this.remoteTeams.rememberSnapshot(route.connectionId, decodedSnapshot.value);
      if (decodedSnapshot.value.activeAgentId) onCreated?.(decodedSnapshot.value.activeAgentId);
    }
    return createAppRpcResult(messageId, await this.remoteTeams.clientSnapshot());
  }

  private async routeAgentResultRequest<Result>(
    messageId: AppRpcResponse['id'],
    agentId: string,
    method: string,
    params: unknown,
    localHandler: (agent: Agent) => Promise<Result> | Result,
  ): Promise<AppRpcResponse> {
    const route = await this.locationForAgentId(agentId);
    if (!route) {
      return createAppRpcError(messageId, appRpcErrorCodes.internalError, `Agent not found: ${agentId}`);
    }
    if (route.kind === 'local') {
      return createAppRpcResult(messageId, await localHandler(route.agent));
    }
    return createAppRpcResult(messageId, await this.backendHandleForAgentLocation(route).request<Result>(method, params, () => localHandler(route.agent)));
  }

  private locationFromRemoteConnectionId(remoteConnectionId: string | null | undefined): BackendLocation {
    const connectionId = remoteConnectionId?.trim() ?? '';
    return connectionId ? { kind: 'remote', connectionId } : { kind: 'local' };
  }

  private backendHandleForLocation(location: BackendLocation): BackendHandle {
    if (location.kind === 'remote') {
      const { connectionId } = location;
      return {
        kind: 'remote',
        connectionId,
        request: <Result>(method: string, params: unknown) => this.remoteTeams.request<Result>(connectionId, method, params),
      };
    }
    return {
      kind: 'local',
      request: async <Result>(_method: string, _params: unknown, localHandler: () => Promise<Result> | Result) => localHandler(),
    };
  }

  private backendHandleForAgentLocation(location: AgentLocation): BackendHandle {
    return location.kind === 'remote'
      ? this.backendHandleForLocation({ kind: 'remote', connectionId: location.connectionId })
      : this.backendHandleForLocation({ kind: 'local' });
  }

  private automationLocationFromParams(params: unknown): BackendLocation {
    return this.locationFromRemoteConnectionId(automationLocationRemoteConnectionId(params));
  }

  private async requestInLocation<Result>(
    location: BackendLocation,
    remoteMethod: string,
    remoteParams: unknown,
    localHandler: () => Promise<Result> | Result,
  ): Promise<Result> {
    return this.backendHandleForLocation(location).request(remoteMethod, remoteParams, localHandler);
  }

  private async respondInLocation<Result>(
    messageId: AppRpcResponse['id'],
    location: BackendLocation,
    remoteMethod: string,
    remoteParams: unknown,
    localHandler: () => Promise<Result> | Result,
  ): Promise<AppRpcResponse> {
    try {
      return createAppRpcResult(messageId, await this.requestInLocation(location, remoteMethod, remoteParams, localHandler));
    } catch (error) {
      return createAppRpcError(messageId, appRpcErrorCodes.internalError, error instanceof Error ? error.message : String(error));
    }
  }

  private forwardRemoteBackendEvent(connectionId: string, event: AppBackendEvent): void {
    // The account menu describes local engines, not accounts on SSH hosts.
    if (event.type === 'account.rateLimitsUpdated') return;
    // Catalog broadcasts belong to one host. Scope them to its projected agents
    // before crossing the client boundary, which otherwise treats them as local.
    if (!event.agentId && (event.type === 'models.changed' || event.type === 'skills.changed')) {
      const projected = this.remoteTeams.clientSnapshotFromKnownRemotes();
      const teamIds = new Set(projected.teams.filter((team) => team.remoteConnectionId === connectionId).map((team) => team.id));
      for (const agent of projected.agents) {
        if (agent.teamId && teamIds.has(agent.teamId) && agent.backend === event.backend) {
          if (event.type === 'skills.changed' && event.payload.cwd && event.payload.cwd !== agent.folder) continue;
          this.forwardRemoteBackendEvent(connectionId, { ...event, agentId: agent.id });
        }
      }
      return;
    }
    const {
      clientState: _clientState,
      occurredAt: _occurredAt,
      seq: _seq,
      snapshot: _snapshot,
      ...backendEvent
    } = event;
    if (backendEvent.type === 'client.markdownDisplayRequested' && backendEvent.agentId && backendEvent.payload.purpose !== 'plan') {
      void this.documents.display(backendEvent.agentId, backendEvent.payload).then(payload => {
        this.emitRemoteBackendEvent(this.nextMainEvent({ ...backendEvent, payload }));
      }).catch(error => warnMain('documents', 'Failed to retain remote document', { message: String(error) }));
      return;
    }
    const fullEvent = this.nextMainEvent(backendEvent);
    this.agentRequests.record(fullEvent, connectionId);
    this.emitRemoteBackendEvent(fullEvent);
  }

  private deleteTeamsForRemoteConnection(connectionId: string): void {
    const teamIds = this.snapshot.teams
      .filter((team) => team.remoteConnectionId === connectionId)
      .map((team) => team.id);
    if (teamIds.length === 0) {
      return;
    }

    if (teamIds.length === this.snapshot.teams.length) {
      createTeamInSnapshot(this.snapshot, {
        name: 'Local',
        color: teamColors[0] ?? '#1B4FB2',
      }, new Date().toISOString(), { select: false });
    }

    for (const teamId of teamIds) {
      closeTeamInSnapshot(this.snapshot, teamId);
    }
  }

  private ensureLocalFallbackBeforeRemovingTeam(teamId: string): void {
    if (this.snapshot.teams.length !== 1 || this.snapshot.teams[0]?.id !== teamId) {
      return;
    }
    createTeamInSnapshot(this.snapshot, {
      name: 'Local',
      color: teamColors[0] ?? '#1B4FB2',
    }, new Date().toISOString(), { select: false });
  }

  private async persistAndEmitSnapshot(): Promise<AppSnapshot> {
    await this.saveSnapshot?.(this.snapshot);
    const snapshot = await this.remoteTeams.clientSnapshot();
    this.emitSnapshotUpdated(snapshot);
    return snapshot;
  }

  private async persistSnapshotOnly(): Promise<AppSnapshot> {
    await this.saveSnapshot?.(this.snapshot);
    return this.snapshot;
  }

  private async emitProjectedSnapshot(): Promise<void> {
    this.emitSnapshotUpdated(await this.remoteTeams.clientSnapshot());
  }

  private emitSnapshotUpdated(snapshot: AppSnapshot): void {
    const event: AppBackendEvent = {
      seq: this.nextEventSeq(),
      type: 'snapshot.updated',
      payload: snapshot,
      occurredAt: new Date().toISOString(),
      clientState: this.clientStateFromSnapshot(snapshot),
    };
    this.onEvent?.(event);
    this.onBackendEventApplied?.(event);
  }

  private backendDriverForAgent(agent: Agent, expectedSessionId?: string | null): AgentBackendDriver {
    return {
      backend: agent.backend,
      getRuntimeStatus: () => ({ backend: agent.backend, status: 'running' }),
      getCapabilities: () => defaultBackendCapabilities(agent.backend),
      tryHandlePromptCommand: (currentAgent, prompt) => (
        this.remoteTeams.connectionIdForAgent(currentAgent) ? null : this.requireDriverRpc().tryHandlePromptCommand(currentAgent, prompt)
      ),
      preparePromptOptions: (_currentAgent, options) => options,
      sendPrompt: async (currentAgent, prompt, options) => (
        await this.handleAgentDriverRequest(currentAgent, backendMethods.driverPromptSend, { agent: currentAgent, prompt, options, ...(expectedSessionId === undefined ? {} : { expectedSessionId }) }) as BackendSendResult
      ),
      interrupt: async (currentAgent) => (
        await this.handleAgentDriverRequest(currentAgent, backendMethods.driverInterrupt, { agent: currentAgent }) as BackendSendResult
      ),
      respondToAgentRequest: async (response) => {
        await this.handleAgentDriverRequest(agent, backendMethods.driverAgentRequestRespond, { backend: agent.backend, response });
      },
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
  }

  private addRecentSourceRepository(repoName?: string): void {
    const trimmed = repoName?.trim() ?? '';
    if (!trimmed) {
      return;
    }
    const nextNames = this.snapshot.sourceFolder.recentRepoNames.filter((name) => name !== trimmed);
    nextNames.unshift(trimmed);
    this.snapshot.sourceFolder.recentRepoNames = nextNames.slice(0, 5);
  }

  private async validateAgentInput(input: Pick<CreateAgentInput, 'name' | 'folder'>, remoteConnectionId: string | null = null): Promise<void> {
    if (input.name !== null && !input.name.trim()) {
      throw new Error('Agent name is required.');
    }

    const folder = input.folder.trim();
    if (!folder) {
      throw new Error('Agent folder is required.');
    }

    if (remoteConnectionId) {
      await this.remoteTeams.request(remoteConnectionId, backendMethods.workspaceFolderValidate, { folder });
      return;
    }

    await this.requireDriverRpc().handle(backendMethods.workspaceFolderValidate, { folder });
  }

  private async reconcileConversationsOnce(): Promise<void> {
    if (!this.driverRpc) return;
    if (this.conversationsReconciliation) return this.conversationsReconciliation;
    const reconciliation = (async () => {
      const localCodexAgents = this.snapshot.agents.filter((agent) => agent.backend === 'codex' && !this.remoteTeams.connectionIdForAgent(agent));
      try {
        await this.driverRpc!.handle(backendMethods.driverConversationsReconcile, {
          backend: 'codex',
          agents: localCodexAgents,
        });
      } catch (error) {
        this.conversationsReconciliation = undefined;
        warnMain('sessions', 'conversation archive reconciliation failed', {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    this.conversationsReconciliation = reconciliation;
    return reconciliation;
  }

  private async createLocalSourceRepository(name: string): Promise<SourceRepository> {
    await this.initializeSourceFolderIfNeeded();
    const sourceFolderPath = this.snapshot.sourceFolder.path.trim();
    if (!sourceFolderPath) throw new Error('Choose a source folder before creating a project.');
    const repository = await this.requireDriverRpc().handle(backendMethods.sourceRepositoryCreate, {
      sourceFolderPath,
      name,
    }) as SourceRepository;
    this.addRecentSourceRepository(repository.name);
    await this.persistAndEmitSnapshot();
    return repository;
  }

  private async initializeSourceFolderIfNeeded(): Promise<void> {
    if ((this.snapshot.sourceFolder.initialized && this.snapshot.sourceFolder.path.trim()) || !this.driverRpc) {
      return;
    }

    try {
      const detected = await this.driverRpc.handle(backendMethods.sourceFolderDetect, undefined);
      updateSettingsInSnapshot(this.snapshot, {
        sourceFolder: {
          path: typeof detected === 'string' ? detected : '',
        },
      });
      await this.persistSnapshotOnly();
    } catch {
      // Source-folder detection is best effort; an explicit user setting can still initialize it.
    }
  }

  private applyAndEmitBackendEvent(event: BackendEvent): void {
    const fullEvent = this.nextMainEvent(event);
    this.options.usage?.observeEvent(fullEvent);
    applyMainEventToSnapshot(this.snapshot, fullEvent);
    this.delegatedWorkReports?.handleEvent(fullEvent);
    for (const listener of this.handoffListeners) listener(fullEvent);
    this.agentRequests.record(fullEvent);
    this.emitBackendEvent(fullEvent);
    this.emitDerivedDomainEvents(fullEvent);
    this.onBackendEventApplied?.(fullEvent);
  }

  private clearTurnSuggestionsForNewPrompt(agent: Agent): void {
    if (agent.threadFlags?.ready_for_review !== true && agent.suggestedPrompt === undefined) return;
    const threadFlags = { ...agent.threadFlags };
    delete threadFlags.ready_for_review;
    this.applyAndEmitBackendEvent({
      agentId: agent.id,
      type: 'agent.updated',
      payload: {
        id: agent.id,
        threadFlags: Object.keys(threadFlags).length > 0 ? threadFlags : null,
        suggestedPrompt: null,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  private handleBackendEvent(event: BackendEvent, options: { persist?: boolean } = {}): void {
    if (event.type === 'provider.authenticationChanged') {
      const authentication = event.payload;
      this.providerConnections?.observe(authentication.kind, authentication.connected, authentication);
    }
    if (event.type === 'remoteControl.statusChanged') {
      const status = remoteControlStatusFromUnknown(event.payload);
      if (status) {
        this.remoteControlStatus = status;
        this.remoteControlStatusLoaded = true;
      }
    }
    const fullEvent = this.nextMainEvent(event);
    this.options.usage?.observeEvent(fullEvent);
    applyMainEventToSnapshot(this.snapshot, fullEvent);
    this.delegatedWorkReports.handleEvent(fullEvent);
    for (const listener of this.handoffListeners) listener(fullEvent);
    if (fullEvent.agentId && providerConversationEventView(fullEvent).type === 'turn.completed') {
      void this.missionExecution.agentFinished(fullEvent.agentId, providerConversationEventView(fullEvent).turnId).catch(error => warnMain('missions', 'failed to record mission completion', { message: String(error) }));
    }
    this.agentRequests.record(fullEvent);
    this.emitBackendEvent(fullEvent);
    this.emitDerivedDomainEvents(fullEvent);
    this.onBackendEventApplied?.(fullEvent);
    if (
      event.agentId && (
        providerConversationEventView(fullEvent).type === 'turn.completed' ||
        (event.type === 'agent.statusChanged' && event.payload.type === 'idle')
      )
    ) {
      this.agentPrompts.drain(event.agentId);
    }
    if (event.type === 'agent.promptQueued' && event.agentId) {
      this.agentPrompts.drain(event.agentId);
    }
    if (options.persist !== false && shouldPersistSnapshotForEvent(fullEvent)) {
      const persistence = this.saveSnapshot?.(this.snapshot);
      if (persistence) {
        void persistence.catch((error) => {
          warnMain('state', 'failed to persist backend event snapshot', {
            eventType: event.type,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
    if (event.agentId && shouldRefreshGitStatusForEvent(fullEvent)) {
      if (providerConversationEventView(fullEvent).type === 'turn.completed') {
        void this.agentWorkspaces.refreshGitStatus(event.agentId);
      } else {
        this.agentWorkspaces.scheduleGitStatusRefresh(event.agentId);
      }
    }
  }

  private nextMainEvent(event: BackendEvent): BackendPublishedEvent {
    const agent = event.agentId ? this.snapshot.agents.find((candidate) => candidate.id === event.agentId) : undefined;
    const conversationId = event.conversationId ?? event.threadId ?? event.backendSessionId ?? (agent ? agentConversationId(agent) : null);
    return {
      ...event,
      ...(conversationId ? { conversationId } : {}),
      seq: this.nextEventSeq(),
      occurredAt: event.occurredAt ?? new Date().toISOString(),
    };
  }

  private nextEventSeq(): number {
    this.lastEventSeq += 1;
    return this.lastEventSeq;
  }

  private emitBackendEvent(event: BackendPublishedEvent): void {
    this.onEvent?.({
      ...event,
      clientState: this.clientStateFromSnapshot(this.snapshot),
    });
  }

  private publishRemoteControlStatus(status: DevicePairingStatus): void {
    this.remoteControlStatusLoaded = true;
    this.handleBackendEvent({
      type: 'remoteControl.statusChanged',
      payload: status,
    }, { persist: false });
  }

  private clientStateFromSnapshot(snapshot: AppSnapshot): ClientState {
    return clientStateFromSnapshot(snapshot, this.remoteControlStatus, this.companionAccessEnabled);
  }

  private async ensureRemoteControlStatus(): Promise<void> {
    if (this.remoteControlStatusLoaded || !this.driverRpc) return;
    try {
      const status = await this.driverRpc.handle(backendMethods.remoteControlStatusGet, undefined);
      const parsed = remoteControlStatusFromUnknown(status);
      if (parsed) this.remoteControlStatus = parsed;
    } catch {
      // Remote-control status is an optional capability. Keep the safe default
      // when an older or unavailable driver cannot answer the status request.
    } finally {
      this.remoteControlStatusLoaded = true;
    }
  }

  private emitRemoteBackendEvent(event: BackendPublishedEvent): void {
    const snapshot = this.remoteTeams.clientSnapshotFromKnownRemotes();
    this.onEvent?.({
      ...event,
      clientState: this.clientStateFromSnapshot(snapshot),
    });
  }

  private emitDerivedDomainEvents(event: BackendPublishedEvent): void {
    this.emitPlanReadyForReview(event);
    const type = providerConversationEventView(event).type;
    if (!event.agentId || !['turn.completed', 'approval.requested', 'agentRequest.created', 'toolInput.requested', 'error'].includes(type)) return;
    const agent = this.snapshot.agents.find((agent) => agent.id === event.agentId);
    if (!agent) return;
    const previous = agent.readState ?? { revision: 0, readRevision: 0 };
    this.applyAndEmitBackendEvent({ type: 'agent.updated', agentId: agent.id,
      payload: { id: agent.id, readState: { revision: previous.revision + 1, readRevision: previous.readRevision } } });
    void this.persistSnapshotOnly().catch(error => warnMain('state', 'failed to persist read state', { message: String(error) }));
  }

  private emitPlanReadyForReview(event: BackendPublishedEvent): void {
    const conversationEvent = providerConversationEventView(event);
    const payload = conversationEvent.payload;
    if (
      conversationEvent.type !== 'turn.proposedPlanCompleted'
      && conversationEvent.type !== 'plan.completed'
      || !conversationEvent.agentId
      || !conversationEvent.turnId
      || typeof payload !== 'object'
      || payload === null
      || !('markdown' in payload)
      || typeof payload.markdown !== 'string'
      || !payload.markdown.trim()
    ) {
      return;
    }

    const agent = this.snapshot.agents.find((candidate) => candidate.id === conversationEvent.agentId);
    if (!agent) return;
    const currentConversationId = agentConversationId(agent);
    if (currentConversationId && event.conversationId && currentConversationId !== event.conversationId) return;
    const ready: Extract<BackendPublishedEvent, { type: 'plan.readyForReview' }> = {
      seq: event.seq,
      occurredAt: event.occurredAt,
      agentId: conversationEvent.agentId,
      backend: event.backend,
      ...(event.conversationId ? { conversationId: event.conversationId } : {}),
      ...(event.threadId ? { threadId: event.threadId } : {}),
      turnId: conversationEvent.turnId,
      type: 'plan.readyForReview',
      payload: {
        markdown: payload.markdown,
        ...('itemId' in payload && typeof payload.itemId === 'string' ? { itemId: payload.itemId } : {}),
      },
    };
    const review = planReviewFromEvent(agent, ready);
    if (agent.planReview?.id === review.id) return;
    this.applyAndEmitBackendEvent(ready);
  }

}

function requireBacklogConfiguration(params: unknown): WorkBacklogConfigurationInput {
  const record = requireRecord(params);
  const input = record.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid work backlog configuration input.');
  }
  const value = input as Record<string, unknown>;
  const provider = requireWorkProvider(value);
  const configuration = requireRecord(value.configuration);
  for (const key of ['repositoryId', 'assigneeLogin', 'tagName']) {
    if (configuration[key] !== undefined && configuration[key] !== null && typeof configuration[key] !== 'string') throw new Error('Invalid work backlog configuration input.');
  }
  return { provider, configuration };
}

function requireWorkProvider(params: unknown): WorkProviderKind {
  const record = requireRecord(params);
  const provider = requireString(record.provider, 'provider');
  if (!isWorkProviderKind(provider)) {
    throw new Error(`Unsupported work provider: ${provider}`);
  }
  return provider;
}

function workItemQuery(value: unknown): import('@workspace/core/contracts').WorkItemQuery | undefined {
  if (value === undefined) return undefined;
  const query = requireRecord(value);
  const kind = query.kind;
  const state = query.state;
  if (kind !== undefined && kind !== 'issue' && kind !== 'pullRequest' && kind !== 'all') {
    throw new Error('Invalid work item kind.');
  }
  if (state !== undefined && state !== 'open' && state !== 'closed' && state !== 'all') {
    throw new Error('Invalid work item state.');
  }
  return {
    ...(kind ? { kind } : {}),
    ...(state ? { state } : {}),
  };
}

function globalWorkItemQuery(value: unknown): import('@workspace/core/contracts').GlobalWorkItemQuery | undefined {
  if (value === undefined) return undefined;
  const query = requireRecord(value);
  const base = workItemQuery(query) ?? {};
  const assignment = query.assignment;
  const cursor = query.cursor;
  const pageSize = query.pageSize;
  if (assignment !== undefined && assignment !== 'all' && assignment !== 'viewer') {
    throw new Error('Invalid global work item assignment filter.');
  }
  if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 4096)) {
    throw new Error('Invalid global work item cursor.');
  }
  if (pageSize !== undefined && (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
    throw new Error('Invalid global work item page size.');
  }
  return {
    ...base,
    ...(assignment ? { assignment } : {}),
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(typeof pageSize === 'number' ? { pageSize } : {}),
  };
}

function requireAgentCreateInput(params: unknown): CreateAgentInput {
  const record = requireRecord(params);
  const input = requireRecord(record.input);
  return {
    ...input,
    name: input.name === null ? null : requireString(input.name, 'agent name'),
  } as CreateAgentInput;
}

function requireProjectCreateInput(params: unknown): CreateProjectInput & { teamId: string } {
  const input = requireRecord(requireRecord(params).input);
  return {
    name: requireString(input.name, 'project name'),
    teamId: requireString(input.teamId, 'team id'),
    ...(input.backend === undefined ? {} : { backend: requireAgentBackend(input.backend) }),
  };
}

function requireQuickChatCreateInput(params: unknown): CreateQuickChatInput {
  const record = requireRecord(params);
  const input = requireRecord(record.input);
  return {
    ...(input.teamId === undefined ? {} : { teamId: requireString(input.teamId, 'team id') }),
    ...(input.backend === undefined ? {} : { backend: requireAgentBackend(input.backend) }),
  };
}

function requireAgentBackend(value: unknown): Agent['backend'] {
  if (!isAgentBackend(value)) throw new Error('Invalid agent backend.');
  return value;
}

function requireAgentUpdateInput(params: unknown): UpdateAgentInput {
  const record = requireRecord(params);
  const input = requireRecord(record.input);
  const result: UpdateAgentInput = {
    id: requireString(input.id, 'agent id'),
  };
  if (input.backend !== undefined) result.backend = requireAgentBackend(input.backend);
  if ('modelSelection' in input) {
    const selection = requireRecord(input.modelSelection);
    result.modelSelection = {
      model: requireString(selection.model, 'composer model'),
      reasoningEffort: selection.reasoningEffort === null ? null : requireString(selection.reasoningEffort, 'composer reasoning effort'),
      serviceTier: selection.serviceTier === null ? null : requireString(selection.serviceTier, 'composer service tier'),
    };
  }
  if ('name' in input) {
    result.name = input.name === null ? null : requireString(input.name, 'agent name');
  }
  if ('gitDiffTarget' in input) {
    result.gitDiffTarget = input.gitDiffTarget === null
      ? null
      : requireAgentGitDiffTarget(input.gitDiffTarget);
  }
  if (result.name === undefined && result.gitDiffTarget === undefined && result.backend === undefined && result.modelSelection === undefined) {
    throw new Error('Agent update must include a name, backend, model selection, or Git diff target.');
  }
  return result;
}

function requireAgentGitDiffTarget(value: unknown): AgentGitDiffTarget {
  if (!isAgentGitDiffTarget(value)) throw new Error('Invalid Git diff target.');
  return { ...value };
}

function requireAgentOpenInApplicationUpdate(params: unknown): {
  agentId: string;
  application: OpenInApplication;
} {
  const record = requireRecord(params);
  const application = requireString(record.application, 'application');
  if (!isOpenInApplication(application)) {
    throw new Error(`Unsupported Open In application: ${application}`);
  }
  return {
    agentId: requireString(record.agentId, 'agentId'),
    application,
  };
}

function isOpenInApplication(value: string): value is OpenInApplication {
  return value === 'vscode' ||
    value === 'finder' ||
    value === 'terminal' ||
    value === 'iterm2' ||
    value === 'ghostty' ||
    value === 'xcode' ||
    value === 'android-studio' ||
    value === 'jetbrains';
}

function requireMoveAgentInput(params: unknown): MoveAgentToTeamInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as MoveAgentToTeamInput;
}

function requireReorderAgentsInput(params: unknown): ReorderAgentsInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as ReorderAgentsInput;
}

function requireReorderRepositoriesInput(params: unknown): ReorderRepositoriesInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as ReorderRepositoriesInput;
}

function requireAutomationCreateInput(params: unknown): CreateAutomationInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as CreateAutomationInput;
}

function requireAutomationUpdateInput(params: unknown): UpdateAutomationInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as UpdateAutomationInput;
}

function requireAutomationId(params: unknown): string {
  const record = requireRecord(params);
  return requireString(record.automationId, 'automationId');
}

function requireTeamCreateInput(params: unknown): CreateTeamInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as CreateTeamInput;
}

function requireTeamUpdateInput(params: unknown): UpdateTeamInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as UpdateTeamInput;
}

function requireTeamReorderInput(params: unknown): ReorderTeamsInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as ReorderTeamsInput;
}

function requireTeamId(params: unknown): string {
  const record = requireRecord(params);
  return requireString(record.teamId, 'teamId');
}

function requireAgentId(params: unknown): string {
  const record = requireRecord(params);
  return requireString(record.agentId, 'agentId');
}

function requireAgentCloseRequest(params: unknown): {
  agentId: string;
  input?: { deleteWorktree: boolean; deleteRemoteBranch?: boolean; discardChanges?: boolean; pullRequestCleanup?: boolean; confirmed: true };
} {
  const record = requireRecord(params);
  const agentId = requireString(record.agentId, 'agentId');
  if (record.input === undefined) return { agentId };
  const input = requireRecord(record.input);
  if (input.confirmed !== true) throw new Error('Deleting a worktree requires confirmation.');
  if (typeof input.deleteWorktree !== 'boolean') throw new Error('deleteWorktree must be a boolean.');
  if (input.deleteRemoteBranch !== undefined && typeof input.deleteRemoteBranch !== 'boolean') {
    throw new Error('deleteRemoteBranch must be a boolean.');
  }
  if (input.pullRequestCleanup !== undefined && typeof input.pullRequestCleanup !== 'boolean') {
    throw new Error('pullRequestCleanup must be a boolean.');
  }
  if (input.discardChanges !== undefined && typeof input.discardChanges !== 'boolean') {
    throw new Error('discardChanges must be a boolean.');
  }
  if (input.discardChanges === true && input.deleteWorktree !== true) {
    throw new Error('Changes can only be discarded when deleting the worktree.');
  }
  if (input.deleteRemoteBranch === true && input.deleteWorktree !== true) {
    throw new Error('Delete the worktree before deleting its remote branch.');
  }
  if (input.pullRequestCleanup === true && input.deleteWorktree !== true) {
    throw new Error('Delete the worktree when cleaning up a pull request.');
  }
  return {
    agentId,
    input: {
      deleteWorktree: input.deleteWorktree,
      ...(input.deleteRemoteBranch === undefined ? {} : { deleteRemoteBranch: input.deleteRemoteBranch }),
      ...(input.pullRequestCleanup === undefined ? {} : { pullRequestCleanup: input.pullRequestCleanup }),
      ...(input.discardChanges === undefined ? {} : { discardChanges: input.discardChanges }),
      confirmed: true,
    },
  };
}

function missionWorktreePaths(mission: Mission): string[] {
  const paths = mission.execution?.workspaces?.map(workspace => workspace.path) ?? [];
  if (mission.execution?.workspace?.path) paths.push(mission.execution.workspace.path);
  return [...new Set(paths)];
}

function requireDuplicateAgentRequest(params: unknown): { agentId: string; options?: DuplicateAgentOptions } {
  const record = requireRecord(params);
  const agentId = requireString(record.agentId, 'agentId');
  if (record.options === undefined) {
    return { agentId };
  }

  const options = requireRecord(record.options);
  if (options.select !== undefined && typeof options.select !== 'boolean') {
    throw new Error('select must be a boolean.');
  }
  if (options.name !== undefined && (typeof options.name !== 'string' || !options.name.trim())) {
    throw new Error('name must be a non-empty string.');
  }
  return {
    agentId,
    options: {
      ...(options.select === undefined ? {} : { select: options.select }),
      ...(options.name === undefined ? {} : { name: options.name.trim() }),
    },
  };
}

function requireSettingsUpdateInput(params: unknown): UpdateSettingsInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as UpdateSettingsInput;
}

function requireCodexResourceSharingInput(params: unknown): SetCodexResourceSharingInput {
  const record = requireRecord(params);
  const input = requireRecord(record.input);
  if (input.enabled === true) return { enabled: true };
  if (input.enabled === false && (input.mode === 'fresh' || input.mode === 'copy' || input.mode === 'keep')) {
    return { enabled: false, mode: input.mode };
  }
  throw new Error('Invalid Codex resource sharing input.');
}

function hasActiveChats(snapshot: AppSnapshot): boolean {
  return snapshot.agents.some((agent) => (
    agent.status.type === 'working' ||
    agent.status.type === 'awaitingInput'
  ));
}

function requireAddSshConnectionInput(params: unknown): AddSshConnectionInput {
  const record = requireRecord(params);
  const input = requireRecord(record.input);
  return {
    host: requireString(input.host, 'host'),
    ...(typeof input.name === 'string' ? { name: input.name } : {}),
    ...(typeof input.hostName === 'string' ? { hostName: input.hostName } : {}),
    ...(typeof input.user === 'string' ? { user: input.user } : {}),
    ...(typeof input.port === 'number' ? { port: input.port } : {}),
    ...(typeof input.identityFile === 'string' ? { identityFile: input.identityFile } : {}),
    ...(typeof input.configPath === 'string' ? { configPath: input.configPath } : {}),
    ...(typeof input.line === 'number' ? { line: input.line } : {}),
  };
}

function requireUpdateRemoteConnectionInput(params: unknown): { connectionId: string; input: UpdateRemoteConnectionInput } {
  const record = requireRecord(params);
  const input = requireRecord(record.input);
  return {
    connectionId: requireString(record.connectionId, 'connectionId'),
    input: {
      ...(typeof input.sourceFolderPath === 'string' ? { sourceFolderPath: input.sourceFolderPath } : {}),
    },
  };
}

function remoteConnectionWithSourceFolder(connection: RemoteConnection, sourceFolderPath: string): RemoteConnection {
  const next: RemoteConnection = {
    ...connection,
    updatedAt: new Date().toISOString(),
  };
  if (sourceFolderPath) {
    next.sourceFolderPath = sourceFolderPath;
  } else {
    delete next.sourceFolderPath;
  }
  return next;
}

function requireSourceWorktreeInput(params: unknown): CreateSourceWorktreeInput {
  const record = requireRecord(params);
  return requireRecord(record.input) as CreateSourceWorktreeInput;
}

function requireSourceRepositoryCloneInput(params: unknown): CloneSourceRepositoryInput {
  const record = requireRecord(params);
  const input = requireRecord(record.input);
  return {
    url: requireString(input.url, 'url'),
    ...(optionalTrimmedString(input.remoteConnectionId) ? { remoteConnectionId: optionalTrimmedString(input.remoteConnectionId)! } : {}),
  };
}

function requireSourceRepositoryCreateInput(params: unknown): CreateSourceRepositoryInput {
  const record = requireRecord(params);
  const input = requireRecord(record.input);
  return {
    name: requireString(input.name, 'name'),
    ...(optionalTrimmedString(input.remoteConnectionId) ? { remoteConnectionId: optionalTrimmedString(input.remoteConnectionId)! } : {}),
  };
}

function requireSourceWorktreeSuggestionInput(params: unknown): Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath' | 'remoteConnectionId'> {
  const input = requireSourceWorktreeInput(params);
  return {
    branchName: input.branchName,
    repoPath: input.repoPath,
    ...(input.remoteConnectionId ? { remoteConnectionId: input.remoteConnectionId } : {}),
  };
}

function sourceWorktreeInputWithoutRemoteConnection(input: CreateSourceWorktreeInput): Omit<CreateSourceWorktreeInput, 'remoteConnectionId'> {
  return {
    repoPath: input.repoPath,
    branchName: input.branchName,
    ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
    ...(input.destinationPath ? { destinationPath: input.destinationPath } : {}),
    ...(input.reuseExisting ? { reuseExisting: true } : {}),
    ...(input.fetchRemoteBranch ? { fetchRemoteBranch: true } : {}),
    ...(input.requireNewBranch ? { requireNewBranch: true } : {}),
  };
}

function requireOptionalConnectionId(params: unknown): string | null {
  if (params === undefined) {
    return null;
  }
  const record = requireRecord(params);
  return optionalTrimmedString(record.remoteConnectionId);
}

function automationLocationRemoteConnectionId(params: unknown): string | null {
  return locationRemoteConnectionId(params, 'automation');
}

function locationRemoteConnectionId(params: unknown, label: string): string | null {
  if (params === undefined) {
    return null;
  }
  const record = requireRecord(params);
  const location = record.location;
  if (location === undefined) {
    return null;
  }
  const locationRecord = requireRecord(location);
  if (locationRecord.kind === 'local') {
    return null;
  }
  if (locationRecord.kind !== 'remote') {
    throw new Error(`Invalid ${label} location.`);
  }
  return requireString(locationRecord.remoteConnectionId, 'remoteConnectionId');
}

type DebugCodeReviewScenario = 'automaticReviewing' | 'reviewing' | 'ready' | 'fixing' | 'readyToFinish';

function debugCodeReviewScenario(value: unknown): DebugCodeReviewScenario {
  if (value === 'automaticReviewing' || value === 'reviewing' || value === 'ready' || value === 'fixing' || value === 'readyToFinish') return value;
  throw new Error('Invalid code review debug scenario.');
}

function debugThreadFlagId(value: unknown): ThreadFlagId {
  if (value === 'delegate_to_worktree' || value === 'ready_for_review') return value;
  throw new Error('Invalid thread flag id.');
}

function createDebugCodeReviewSession(agent: Agent, scenario: DebugCodeReviewScenario): CodeReviewSession {
  const now = new Date().toISOString();
  const roundId = scenario === 'automaticReviewing' ? createEntityId('debug-review-round') : 'debug-review-round-1';
  const findings = debugCodeReviewFindings(roundId, scenario, now);
  return {
    id: 'debug-review',
    targetAgentId: agent.id,
    reviewerAgentId: agent.id,
    scope: { type: 'uncommitted' },
    threadMode: 'current',
    status: scenario === 'automaticReviewing' ? 'reviewing' : scenario,
    ...(scenario === 'automaticReviewing' ? {
      automation: { enabled: true, state: 'running' as const, maxPriority: 'p2' as const, maxRounds: 3, autoCommit: false, commits: [] },
    } : {}),
    activeRoundId: roundId,
    rounds: [{
      id: roundId,
      number: 1,
      status: scenario === 'reviewing' || scenario === 'automaticReviewing'
        ? 'reviewing'
        : scenario === 'ready'
          ? 'ready'
          : scenario === 'fixing'
            ? 'submitted'
            : 'completed',
      ...(agent.backendSession ? { reviewerSession: structuredClone(agent.backendSession) } : {}),
      findings,
      startedAt: now,
      ...(scenario === 'readyToFinish' ? { completedAt: now } : {}),
    }],
    createdAt: now,
    updatedAt: now,
  };
}

function debugCodeReviewFindings(
  roundId: string,
  scenario: DebugCodeReviewScenario,
  now: string,
): CodeReviewFinding[] {
  if (scenario === 'readyToFinish') return [];
  const fixtures: Array<Pick<CodeReviewFinding, 'id' | 'priority' | 'title' | 'body' | 'location'>> = [
    {
      id: 'debug-review-restoration',
      priority: 'p0',
      title: 'Preserve the review across reloads',
      body: 'A renderer reload must restore the active round and every finding before the user continues arbitration.',
      location: { file: 'backend/src/state-persistence.ts', line: 133, endLine: 178 },
    },
    {
      id: 'debug-provider-boundary',
      priority: 'p1',
      title: 'Keep review state provider-independent',
      body: 'Route review state through the unified backend contract so every provider exposes the same workflow.',
      location: { file: 'backend/src/review/code-review-service.ts', line: 40, endLine: 58 },
    },
    {
      id: 'debug-stable-context',
      priority: 'p2',
      title: 'Keep clarification linked to its finding',
      body: 'The clarification prompt should retain the finding and round identifiers when it returns to the reviewer thread.',
    },
    {
      id: 'debug-compact-finding',
      priority: 'p3',
      title: 'Keep finding rows compact',
      body: 'Collapsed findings should remain scannable while expanded findings show the complete evidence without nested cards.',
      location: { file: 'vue/src/components/CodeReviewPanel.vue', line: 182, endLine: 251 },
    },
  ];

  return fixtures.map((fixture) => {
    const remediation = scenario !== 'fixing'
      ? { state: 'notStarted' as const }
      : fixture.priority === 'p1'
        ? { state: 'skipped' as const, startedAt: now }
        : fixture.priority === 'p2'
          ? { state: 'fixing' as const, startedAt: now }
          : { state: 'fixed' as const, completedAt: now, evidence: 'Focused review checks passed.' };
    const decision = scenario === 'fixing' && fixture.priority === 'p1'
      ? { state: 'rejected' as const, decidedAt: now, reason: 'The existing behavior is intentional for this workflow.' }
      : { state: 'selected' as const, decidedAt: now };
    return {
      ...fixture,
      roundId,
      decision,
      discussion: [],
      remediation,
      createdAt: now,
      updatedAt: now,
    };
  });
}

function requireSourceFolderListInput(params: unknown): { path?: string; remoteConnectionId?: string } {
  if (params === undefined) {
    return {};
  }
  const record = requireRecord(params);
  return {
    ...(typeof record.path === 'string' ? { path: record.path } : {}),
    ...(optionalTrimmedString(record.remoteConnectionId) ? { remoteConnectionId: optionalTrimmedString(record.remoteConnectionId)! } : {}),
  };
}

function requireConnectionId(params: unknown): string {
  const record = requireRecord(params);
  return requireString(record.connectionId, 'connectionId');
}

function requireAgentRequestResponse(params: unknown): AgentRequestResponse {
  const record = requireRecord(params);
  const response = requireRecord(record.response);
  if (!isAgentRequestResponse(response)) throw new Error('Invalid agent request response.');
  return response;
}

function validateTeamInput(input: CreateTeamInput): void {
  if (!input.name.trim()) {
    throw new Error('Team name is required.');
  }

  if (!teamColors.some((color) => color === input.color.trim().toUpperCase())) {
    throw new Error('Team color is invalid.');
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Invalid work integration request params.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${name}.`);
  }
  return value;
}

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function createUnsupportedSystemPermissionsPort(): SystemPermissionsPort {
  return {
    async getStatus() {
      return unsupportedSystemPermissionsStatus();
    },
    async openAccessibilitySettings() {
      return unsupportedSystemPermissionsStatus();
    },
    async openScreenRecordingSettings() {
      return unsupportedSystemPermissionsStatus();
    },
  };
}

function unsupportedSystemPermissionsStatus(): SystemPermissionsStatus {
  return {
    platform: 'unsupported',
    accessibility: {
      required: false,
      trusted: true,
    },
    screenRecording: {
      required: false,
      trusted: true,
    },
  };
}

function isBackendConversationRef(value: unknown): value is BackendConversationRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.backend === 'codex') {
    return typeof candidate.threadId === 'string' && candidate.threadId.trim().length > 0;
  }

  return (candidate.backend === 'claude' || candidate.backend === 'antigravity') &&
    (candidate.folder === null || (typeof candidate.folder === 'string' && candidate.folder.trim().length > 0)) &&
    typeof candidate.sessionId === 'string' &&
    candidate.sessionId.trim().length > 0 &&
    (candidate.backend !== 'claude' || candidate.subagentId === undefined || typeof candidate.subagentId === 'string' && candidate.subagentId.trim().length > 0);
}

function requireStringParam(params: unknown, key: string): string {
  if (!isRecord(params) || typeof params[key] !== 'string' || !params[key].trim()) {
    throw new Error(`Invalid ${key}.`);
  }
  return params[key];
}

function requireRecordParam(params: unknown, key: string): Record<string, unknown> {
  if (!isRecord(params) || !isRecord(params[key])) throw new Error(`Invalid ${key}.`);
  return params[key];
}

function conversationListInput(value: unknown): ConversationListInput | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid conversation list input.');
  }
  const record = value as Record<string, unknown>;
  if (record.searchTerm !== undefined && typeof record.searchTerm !== 'string') {
    throw new Error('Conversation search term must be a string.');
  }
  if (record.limit !== undefined && (!Number.isInteger(record.limit) || Number(record.limit) < 1)) {
    throw new Error('Conversation list limit must be a positive integer.');
  }
  return {
    ...(typeof record.searchTerm === 'string' ? { searchTerm: record.searchTerm } : {}),
    ...(typeof record.limit === 'number' ? { limit: record.limit } : {}),
  };
}

function shouldPersistSnapshotForEvent(event: BackendPublishedEvent): boolean {
  const conversationEventType = providerConversationEventView(event).type;
  return event.type === 'agent.updated' ||
    event.type === 'plan.readyForReview' ||
    event.type === 'plan.reviewResolved' ||
    event.type === 'snapshot.updated' ||
    event.type === 'workItem.assignmentUpdated' ||
    event.type === 'agent.conversationAttached' ||
    event.type === 'conversation.settingsUpdated' ||
    event.type === 'subagent.operationChanged' ||
    event.type === 'subagent.activityChanged' ||
    event.type === 'subagent.identityChanged' ||
    event.type === 'subagent.statusChanged' ||
    // Token usage and plan updates are high-frequency during a turn. The
    // completed event persists their latest state in one durable write.
    conversationEventType === 'turn.completed' ||
    conversationEventType === 'turn.proposedPlanCompleted';
}

function shouldRefreshGitStatusForEvent(event: BackendPublishedEvent): boolean {
  const view = providerConversationEventView(event);
  if (view.type === 'turn.completed' || view.type === 'conversation.turnDiffUpdated' || view.type === 'conversation.diffUpdated') return true;
  if (!isRecord(view.payload)) return false;
  if ((view.type === 'workspace.fileActivityDetected' || view.type === 'file.activity')) {
    return view.payload.status === 'completed' &&
      (view.payload.action === 'edit' || view.payload.action === 'create' || view.payload.action === 'delete');
  }
  // Shell commands can mutate files without publishing structured file activity.
  return view.type === 'tool.completed' && isRecord(view.payload.toolPart) &&
    (view.payload.toolPart.kind === 'command' || view.payload.toolPart.kind === 'fileChange');
}

function clientStateFromSnapshot(snapshot: AppSnapshot, remoteControlStatus: DevicePairingStatus, companionAccessEnabled: boolean): ClientState {
  return {
    sourceFolderPath: snapshot.sourceFolder.path,
    shouldPreventDisplaySleep: snapshot.general.preventSleepWhenAgentsRun &&
      snapshot.agents.some((agent) => isActiveAgentStatus(agent.status)),
    shouldPreventDisplaySleepForRemoteAccess: snapshot.general.preventSleepWhenRemoteAccessEnabled !== false &&
      (remoteControlStatus.status === 'connected' || companionAccessEnabled),
  };
}

function isActiveAgentStatus(status: AgentStatus): boolean {
  return status.type === 'working' || status.type === 'awaitingInput';
}

function remoteControlStatusFromUnknown(value: unknown): DevicePairingStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    (record.status !== 'disabled' && record.status !== 'connecting' && record.status !== 'connected' && record.status !== 'errored') ||
    (record.serverName !== undefined && typeof record.serverName !== 'string') ||
    (record.installationId !== undefined && typeof record.installationId !== 'string') ||
    (record.environmentId !== undefined && record.environmentId !== null && typeof record.environmentId !== 'string')
  ) {
    return null;
  }
  const status: DevicePairingStatus = {
    status: record.status,
  };
  if (typeof record.serverName === 'string') status.serverName = record.serverName;
  if (typeof record.installationId === 'string') status.installationId = record.installationId;
  if (record.environmentId === null || typeof record.environmentId === 'string') status.environmentId = record.environmentId;
  return status;
}
