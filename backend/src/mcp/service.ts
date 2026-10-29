import type { ExecutionSelectionOverrides } from '@workspace/core/contracts/execution';
import { applyExecutionSelection, defaultExecutionSelection, executionSelectionForAgent, resolveExecutionSelection } from '@workspace/core/execution-selection';
import { delegatedAssignmentPrompt } from '../agents/worktree-delegation';
import { completeUserDelegationTurn, type DelegationContext } from '@workspace/core/delegation-context';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { sendAgentPrompt } from '@workspace/core/agent-chat-service';
import { agentDisplayName } from '@workspace/core/agent-display';
import { handoffInProgress } from '@workspace/core/agent-handoff';
import { requireAgentFolder } from '@workspace/core/agent-folder';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { resolveAgentBackend } from '@workspace/core/agent-backends';
import type { AgentBackendDriver, BackendConversationForkResult, BackendEvent, BackendGoalResult, BackendSendResult } from '@workspace/core/backend-driver';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import type {
  Agent,
  AnnouncementPhase,
  AgentWorkspaceIdentity,
  AppSnapshot, CelebrationKind,
  CreateAgentInput,
  CreateSourceWorktreeInput,
  BackendDefaults,
  BackendPublishedEvent,
  SpokenAnnouncementRequest,
  SpokenAnnouncementQueueResult,
  SendPromptOptions,
  SourceRepository,
  SourceWorktree,
  WorkBacklogAssignment,
  WorkBacklogAssignmentStatus
} from '@workspace/core/contracts';
import { updateAgentWorkspace, updateWorkItemAssignmentInSnapshot } from '@workspace/core/agent-manager';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { listSourceWorktrees } from '../git-worktrees';
import { scanSourceRepositories } from '../source-repositories';
import { WorktreeManager } from '../worktrees/worktree-manager';
import { createWorktreeInitializationToolModuleProvider } from './worktree-initialization-tools';
import type { BackendDriverRpc } from '../driver-rpc';
import { AppMcpAgentCoordinator, McpToolError, type AnnouncementResponse, type CelebrationResponse, type DisplayMarkdownInput, type DisplayMarkdownResponse, type McpCreateAgentInput, type McpCreateAgentResponse, type MissionToolPort, type UpdateWorkItemResponse } from './agent-coordinator';
import { agentMessagesPrompt, type MessageInfo } from './agent-prompts';
import { AppMcpHttpServer } from './http-server';
import type { ComputerUseClient } from './computer-use-tools';
import type { InAppBrowserClient } from './browser-tools';
import type { HostedMcpGateway } from './hosted-mcp-gateway';
import path from 'node:path';
import { ReviewToolRegistry, type ReviewToolHandlers } from '../review/review-tool-registry';
import { AgentCreationService } from '../agents/agent-creation-service';
import type { AppMcpToolModuleProvider } from './tool-modules';
import { createQuickChatProjectToolModuleProvider } from './quick-chat-project-tools';
import { createMissionStartToolModuleProvider, type MissionStartInput, type StartedMission } from './mission-start-tools';
import { createAutomaticReviewToolModuleProvider, type StartAutomaticReview } from './automatic-review-tools';
import { createAutomationToolModuleProvider } from './automation-tools';
import { createGitDiffStatsToolModuleProvider } from './git-diff-stats-tools';
import type { CreatedProject } from '../projects/project-creation-service';
import { warnMain } from '../log';
import type { DurableTaskService } from '../agents/durable-task-service';
import type { RemoteWorkerRequest } from '@workspace/core/remote-collaboration';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const maxMarkdownBytes = 2 * 1024 * 1024;

export type AppMcpServiceOptions = {
  getCollaborationAgents?: () => Agent[];
  createRemoteWorker?: (caller: Agent, input: McpCreateAgentInput & { teamId?: string }, intendedId?: string, assignmentPrompt?: string, userInstructions?: Agent['delegationUserInstructions']) => Promise<Agent>;
  sendRemotePrompt?: (agent: Agent, prompt: string, goal?: boolean) => Promise<BackendSendResult>;
  sendRemoteMessage?: (agent: Agent, prompt: string, messageId: string) => Promise<{ accepted: true }>;
  resolveDelegationParent?: (id: string) => string;
  forwardCollaboration?: (agentId: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult | undefined>;
  retainDocument?: (agentId: string, request: import('@workspace/core/contracts').SidePanelMarkdownRequest) => Promise<import('@workspace/core/contracts').SidePanelMarkdownRequest>;
  tasks?: DurableTaskService;
  persistSnapshot?: () => Promise<void>;
  missionTools?: MissionToolPort;
  snapshot: AppSnapshot;
  now?: () => Date;
  onEvent?: (event: BackendEvent) => void;
  computerUse?: ComputerUseClient;
  computerUseEnabled?: () => boolean;
  browser?: InAppBrowserClient;
  hostedMcpGateway?: HostedMcpGateway;
  queueSpokenAnnouncement?: (input: Omit<SpokenAnnouncementRequest, 'voice'>) => Promise<SpokenAnnouncementQueueResult>;
  resolveWorkspaceIdentity?: (folder: string) => Promise<AgentWorkspaceIdentity>;
  worktreeManager?: WorktreeManager;
  agentCreation?: AgentCreationService;
  createProject?: (agentId: string, name: string, prompt: string, selection?: ExecutionSelectionOverrides) => Promise<CreatedProject>;
  startMission?: (agentId: string, input: MissionStartInput) => Promise<StartedMission>;
  gitDiff?: (folder: string, target: import('@workspace/core/contracts').AgentGitDiffTarget) => Promise<import('@workspace/core/contracts').AgentGitDiff>;
  startAutomaticReview?: StartAutomaticReview;
  closeAgent?: (callerAgentId: string, agentId: string) => Promise<void>;
  listRemoteRepositories?: (remoteConnectionId: string) => Promise<SourceRepository[]>;
  listRemoteWorktrees?: (remoteConnectionId: string, repoPath: string) => Promise<SourceWorktree[]>;
  createRemoteWorktree?: (input: CreateSourceWorktreeInput) => Promise<SourceWorktree>;
  toolModuleProviders?: readonly AppMcpToolModuleProvider[];
};

export class AppMcpService {
  private readonly getCollaborationAgents: () => Agent[];
  private readonly retainDocument?: AppMcpServiceOptions['retainDocument'];
  private readonly tasks?: DurableTaskService;
  private readonly persistSnapshot?: () => Promise<void>;
  private readonly snapshot: AppSnapshot;
  private readonly coordinator: AppMcpAgentCoordinator;
  private readonly server: AppMcpHttpServer;
  private readonly computerUseEnabled: () => boolean;
  private readonly now: () => Date;
  private readonly resolveWorkspaceIdentity?: (folder: string) => Promise<AgentWorkspaceIdentity>;
  private readonly worktreeManager: WorktreeManager;
  private readonly queueSpokenAnnouncement?: AppMcpServiceOptions['queueSpokenAnnouncement'];
  private eventSink: ((event: BackendEvent) => void) | null = null;
  private driverRpc: BackendDriverRpc | null = null;
  private readonly queuedMessageIds = new Set<string>();
  private readonly remoteMessageDeliveries = new Set<string>();
  private readonly remoteMessageRetries = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  private readonly promptInputMethodsByAgentId = new Map<string, SendPromptOptions['inputMethod']>();
  private readonly reviewTools = new ReviewToolRegistry();
  private readonly agentCreation: AgentCreationService;
  private lastCelebrationKind?: CelebrationKind;

  constructor(private readonly options: AppMcpServiceOptions) {
    this.retainDocument = options.retainDocument;
    this.tasks = options.tasks;
    this.persistSnapshot = options.persistSnapshot;
    this.snapshot = options.snapshot;
    this.getCollaborationAgents = options.getCollaborationAgents ?? (() => this.snapshot.agents);
    this.now = options.now ?? (() => new Date());
    this.computerUseEnabled = options.computerUseEnabled ?? (() => true);
    this.resolveWorkspaceIdentity = options.resolveWorkspaceIdentity;
    this.queueSpokenAnnouncement = options.queueSpokenAnnouncement;
    this.worktreeManager = options.worktreeManager ?? new WorktreeManager();
    this.agentCreation = options.agentCreation ?? new AgentCreationService(this.snapshot, folder => this.worktreeManager.getInitializationState(folder));
    this.eventSink = options.onEvent ?? null;
    this.coordinator = new AppMcpAgentCoordinator({
      missionTools: options.missionTools,
      getAgents: this.getCollaborationAgents,
      getHosts: () => this.snapshot.remoteConnections.connections.map(({ id, name, status }) => ({ id, name, status })),
      now: this.now,
      onAgentUpdated: (agent) => this.emit({
        agentId: agent.id,
        type: 'agent.updated',
        // JSON-RPC omits undefined properties. Preserve an explicit clear so
        // renderer snapshots can remove a previously displayed status text.
        payload: {
          ...agent,
          threadFlags: agent.threadFlags ?? null,
          statusText: agent.statusText ?? null,
          suggestedPrompt: agent.suggestedPrompt ?? null,
        },
      }),
      onInboxMessage: (agentId) => {
        void this.deliverUnreadAgentMessages(agentId);
      },
      onDisplayMarkdown: (agent, input) => this.displayMarkdownForAgent(agent, input),
      onCelebrate: (agent) => this.celebrateForAgent(agent),
      onAnnounce: (agent, phase, text) => this.announceForAgent(agent, phase, text),
      onUpdateWorkItem: (agent, workItemId, status, note) => this.updateWorkItemForAgent(agent, workItemId, status, note),
      onListSourceRepositories: (connectionId) => this.listSourceRepositories(connectionId),
      onListSourceWorktrees: (repoPath, connectionId) => this.listSourceWorktrees(repoPath, connectionId),
      onCreateSourceWorktree: (input) => this.createSourceWorktree(input),
      onCreateAgent: (agent, input) => this.createAgentFromMcp(agent, input),
      onCloseAgent: options.closeAgent,
    });
    this.server = new AppMcpHttpServer({
      forwardCollaboration: options.forwardCollaboration,
      coordinator: this.coordinator,
      computerUse: options.computerUse,
      computerUseEnabled: this.computerUseEnabled,
      browser: options.browser,
      hostedMcpGateway: options.hostedMcpGateway,
      reviewTools: this.reviewTools,
      toolModuleProviders: [
        createWorktreeInitializationToolModuleProvider(this.snapshot, this.worktreeManager),
        ...(options.persistSnapshot ? [createAutomationToolModuleProvider({ snapshot: this.snapshot, persist: options.persistSnapshot,
          notify: () => this.emit({ type: 'snapshot.updated', payload: this.snapshot }) })] : []),
        ...(options.startAutomaticReview ? [createAutomaticReviewToolModuleProvider({ snapshot: this.snapshot, start: options.startAutomaticReview })] : []),
        ...(options.createProject ? [createQuickChatProjectToolModuleProvider({ snapshot: this.snapshot, createProject: options.createProject })] : []),
        ...(options.gitDiff ? [createGitDiffStatsToolModuleProvider({ snapshot: this.snapshot, diff: options.gitDiff })] : []),
        ...(options.startMission ? [createMissionStartToolModuleProvider({ snapshot: this.snapshot, startMission: options.startMission })] : []),
        ...(options.toolModuleProviders ?? []),
      ],
    });
  }

  setDriverRpc(driverRpc: BackendDriverRpc): void {
    this.driverRpc = driverRpc;
  }

  setEventSink(listener: (event: BackendEvent) => void): void {
    this.eventSink = listener;
  }

  handleBackendEvent(event: BackendPublishedEvent): void {
    const view = providerConversationEventView(event);
    if (event.agentId && view.type === 'turn.completed') {
      this.coordinator.clearStatus(event.agentId);
      // User-entered delegation controls belong to the turn they were submitted for.
      const owner = this.snapshot.agents.find(agent => agent.id === event.agentId);
      if (owner && event.backend && view.conversationId && view.turnId) {
        completeUserDelegationTurn(owner, { backend: event.backend, conversationId: view.conversationId, turnId: view.turnId });
      }
    }
    if (event.type === 'agent.promptDequeued') {
      const ids = event.payload.ids;
      for (const id of ids) this.queuedMessageIds.delete(id);
      this.coordinator.markMessagesRead(ids);
    }
  }

  start(): Promise<string> {
    this.stopped = false;
    return this.server.start();
  }

  callTool(agentId: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.server.callTool(agentId, name, args);
  }

  async provisionRemoteWorker(request: RemoteWorkerRequest): Promise<Agent> {
    // Only a controller-confirmed parent in this hidden team can supply a native session.
    const localCaller = request.localCallerId ? this.snapshot.agents.find(agent =>
      agent.id === request.localCallerId && agent.id === request.caller.id && agent.teamId === request.teamId
      && !agent.remoteConnectionId && this.snapshot.teams.some(team => team.id === request.teamId && team.collaborationOwnerId === request.ownerId)) : undefined;
    if (request.localCallerId && !localCaller) throw new McpToolError('The delegation parent is not a member of this controlled team.');
    const caller = localCaller ?? { ...request.caller, backendSession: undefined };
    const response = await this.createAgentFromMcp(caller, {
      ...request.input, remoteConnectionId: undefined, task: undefined, prompt: undefined, instructions: undefined, teamId: request.teamId,
    }, request.agentId, request.assignmentPrompt, request.userInstructions);
    if (!response.success) throw new McpToolError(response.message);
    await this.persistSnapshot?.();
    return this.snapshot.agents.find(agent => agent.id === request.agentId)!;
  }

  stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.remoteMessageRetries.values()) clearTimeout(timer);
    this.remoteMessageRetries.clear();
    return this.server.stop();
  }

  hostedMcpServerUrls(): Record<string, string> {
    return this.server.hostedMcpServerUrls();
  }

  createReviewToolContext(agentId: string, sessionId: string, handlers: ReviewToolHandlers): { id: string; url: string } {
    const context = this.reviewTools.create(agentId, sessionId, handlers);
    return { id: context.id, url: this.server.reviewMcpServerUrl(agentId, context.id) };
  }

  closeReviewToolContext(contextId: string): void {
    this.reviewTools.close(contextId);
  }

  sendMessage(fromAgentId: string, toAgentId: string, content: string): void {
    this.coordinator.sendMessage(fromAgentId, toAgentId, content);
  }

  recordPromptInputMethod(agentId: string, inputMethod: SendPromptOptions['inputMethod']): void {
    this.promptInputMethodsByAgentId.set(agentId, inputMethod ?? 'typed');
  }

  private async deliverUnreadAgentMessages(agentId: string): Promise<void> {
    const agent = this.getCollaborationAgents().find((candidate) => candidate.id === agentId);
    if (!agent || !this.driverRpc) {
      return;
    }

    const messages = this.coordinator.peekUnreadMessages(agentId);
    if (messages.length === 0) {
      return;
    }

    if (agent.remoteConnectionId) {
      await this.deliverRemoteMessages(agentId);
      return;
    }

    if (handoffInProgress(agent)) {
      this.emitQueuedMessages(agentId, messages);
      return;
    }

    if (agent.status.type === 'working' && defaultBackendCapabilities(agent.backend).steerPrompt) {
      try {
        const prompt = agentMessagesPrompt(messages);
        const result = await this.driverRpc.handle(backendMethods.driverPromptSteer, { agent, prompt }) as BackendSendResult;
        agent.backendSession = result.backendSession;
        this.coordinator.markMessagesRead(messages.map((message) => message.id));
        this.emitDequeuedMessages(agentId, messages.map((message) => message.id));
        this.emitSnapshotUpdated(agent.id);
        return;
      } catch {
        this.emitQueuedMessages(agentId, messages);
        return;
      }
    }

    if (agent.status.type !== 'idle') {
      this.emitQueuedMessages(agentId, messages);
      return;
    }

    this.recordPromptInputMethod(agent.id, 'typed');
    sendAgentPrompt(
      this.snapshot,
      this.backendDriverForAgent(agent),
      agent.id,
      agentMessagesPrompt(messages),
      undefined,
      (event) => this.emit(event),
      {
        onBackendSessionUpdated: () => this.emitSnapshotUpdated(agent.id),
        onPromptFailed: () => this.emitQueuedMessages(agentId, messages, true),
        onPromptStarted: () => {
          this.coordinator.markMessagesRead(messages.map((message) => message.id));
          this.emitDequeuedMessages(agentId, messages.map((message) => message.id));
        },
      },
    );
    this.emitSnapshotUpdated(agent.id);
  }

  private async deliverRemoteMessages(agentId: string): Promise<void> {
    if (this.stopped || this.remoteMessageDeliveries.has(agentId)) return;
    const retry = this.remoteMessageRetries.get(agentId);
    if (retry) clearTimeout(retry);
    this.remoteMessageRetries.delete(agentId);
    this.remoteMessageDeliveries.add(agentId);
    try {
      while (!this.stopped) {
        const agent = this.getCollaborationAgents().find(candidate => candidate.id === agentId);
        const message = this.coordinator.peekUnreadMessages(agentId)[0];
        if (!agent?.remoteConnectionId || !message) return;
        if (!this.options.sendRemoteMessage) throw new Error('Remote message delivery is unavailable.');
        const result = await this.options.sendRemoteMessage(agent, agentMessagesPrompt([message]), message.id);
        if (result?.accepted !== true) throw new Error('The remote host did not acknowledge message admission.');
        this.coordinator.markMessagesRead([message.id]);
      }
    } catch {
      // Unconfirmed messages stay unread on the controller; the worker owns all admitted prompt queues.
      // Retry with the same ID after transport failures, including when reconnect produces no idle event.
      if (!this.stopped) {
        const timer = setTimeout(() => {
          this.remoteMessageRetries.delete(agentId);
          void this.deliverRemoteMessages(agentId);
        }, 1000);
        timer.unref();
        this.remoteMessageRetries.set(agentId, timer);
      }
    } finally {
      this.remoteMessageDeliveries.delete(agentId);
    }
  }

  private emitQueuedMessages(agentId: string, messages: Array<MessageInfo & { id: string }>, submitted = false): void {
    for (const message of messages) {
      if (this.queuedMessageIds.has(message.id)) continue;
      this.queuedMessageIds.add(message.id);
      this.emit({
        agentId,
        type: 'agent.promptQueued',
        payload: { id: message.id, text: agentMessagesPrompt([message]), ...(submitted ? { submitted: true } : {}) },
      });
    }
  }

  private emitDequeuedMessages(agentId: string, messageIds: string[]): void {
    for (const id of messageIds) this.queuedMessageIds.delete(id);
    if (messageIds.length === 0) return;
    this.emit({
      agentId,
      type: 'agent.promptDequeued',
      payload: { ids: messageIds },
    });
  }

  private backendDriverForAgent(agent: Agent): AgentBackendDriver {
    return {
      backend: agent.backend,
      getRuntimeStatus: () => ({ backend: agent.backend, status: 'running' }),
      getCapabilities: currentAgent => this.requireDriverRpc().getCapabilities(currentAgent),
      setGoal: (currentAgent, objective) => this.requireDriverRpc().handle(backendMethods.driverGoalUpdate, { agent: currentAgent, objective }) as Promise<BackendGoalResult>,
      tryHandlePromptCommand: (currentAgent, prompt) => (
        this.requireDriverRpc().tryHandlePromptCommand(currentAgent, prompt)
      ),
      sendPrompt: (currentAgent, prompt, options?: SendPromptOptions) => (
        this.requireDriverRpc().handle(backendMethods.driverPromptSend, {
          agent: currentAgent,
          prompt,
          ...(options ? { options } : {}),
        }) as Promise<BackendSendResult>
      ),
      forkWorktreeConversation: (currentAgent, targetAgent) => this.requireDriverRpc().handle(backendMethods.driverWorktreeConversationFork, { agent: currentAgent, targetAgent }) as Promise<BackendConversationForkResult | null>,
      interrupt: (currentAgent) => this.requireDriverRpc().handle(backendMethods.driverInterrupt, { agent: currentAgent }) as Promise<BackendSendResult>,
      respondToAgentRequest: async (response) => {
        await this.requireDriverRpc().handle(backendMethods.driverAgentRequestRespond, {
          backend: agent.backend,
          response,
        });
      },
      onEvent: () => () => undefined,
      close: () => Promise.resolve(),
    };
  }

  private requireDriverRpc(): BackendDriverRpc {
    if (!this.driverRpc) {
      throw new Error('Backend driver RPC is not configured.');
    }
    return this.driverRpc;
  }

  private emitSnapshotUpdated(agentId: string): void {
    this.emit({
      agentId,
      type: 'snapshot.updated',
      payload: this.snapshot,
    });
  }

  private async displayMarkdownForAgent(agent: Agent, input: DisplayMarkdownInput): Promise<DisplayMarkdownResponse> {
    const resolvedPath = input.path ? resolveAgentFilePath(requireAgentFolder(agent), input.path) : null;
    const content = input.markdown ?? (resolvedPath ? await readAgentMarkdownFile(resolvedPath.absolutePath) : '');
    const title = input.title ?? (resolvedPath ? fileBasename(resolvedPath.relativePath) : 'Markdown');

    const request: import('@workspace/core/contracts').SidePanelMarkdownRequest = {
      kind: 'markdown', title, ...(resolvedPath ? { path: resolvedPath.relativePath } : {}), content,
    };
    // Retention is best-effort: a store failure must not stop the document from being shown.
    const payload = await this.retainDocument?.(agent.id, request).catch(error => {
      warnMain('documents', 'Failed to retain displayed document', { message: String(error) });
      return request;
    }) ?? request;
    this.emit({ agentId: agent.id, type: 'client.markdownDisplayRequested', payload });

    return {
      success: true,
      message: resolvedPath ? `Displayed ${resolvedPath.relativePath} in the side panel.` : 'Displayed Markdown in the side panel.',
      ...(resolvedPath ? { path: resolvedPath.relativePath } : {}),
      title,
    };
  }

  private celebrateForAgent(agent: Agent): CelebrationResponse {
    const kinds: CelebrationKind[] = ['confetti', 'stars', 'shapes', 'schoolPride'];
    const choices = kinds.filter(kind => kind !== this.lastCelebrationKind);
    const kind = choices[Math.floor(Math.random() * choices.length)]!;
    this.lastCelebrationKind = kind;
    this.emit({
      agentId: agent.id,
      type: 'client.celebrationRequested',
      payload: { kind },
    });
    return { success: true, requested: true, kind, message: 'Celebration requested; each client decides whether to display it.' };
  }

  private async announceForAgent(agent: Agent, phase: AnnouncementPhase, text: string): Promise<AnnouncementResponse> {
    const response: AnnouncementResponse = { success: true, phase };
    const canRequestPlayback = this.snapshot.general.spokenAnnouncementsEnabled
      && (!this.snapshot.general.spokenAnnouncementsOnlyForDictatedPrompts
        || this.promptInputMethodsByAgentId.get(agent.id) === 'dictated');
    if (!canRequestPlayback || !this.queueSpokenAnnouncement) {
      return response;
    }
    try {
      await this.queueSpokenAnnouncement({
        agentId: agent.id,
        phase,
        text,
      });
    } catch {
      // Playback is intentionally best-effort. Delivery and suppression remain
      // private so the agent does not retry or discuss presentation policy.
    }
    return response;
  }

  private updateWorkItemForAgent(agent: Agent, workItemId: string, status: WorkBacklogAssignmentStatus, note?: string): UpdateWorkItemResponse {
    const assignment = this.snapshot.workBacklog.assignments[workItemId];
    if (!assignment) {
      throw new McpToolError(`Work item '${workItemId}' is not currently assigned. Use the exact Work item ID from your assignment prompt.`);
    }
    if (assignment.agentId !== agent.id) {
      const assignedAgent = this.snapshot.agents.find((candidate) => candidate.id === assignment.agentId);
      throw new McpToolError(`Work item '${workItemId}' is assigned to ${assignedAgent ? agentDisplayName(assignedAgent) : assignment.agentId}, not ${agentDisplayName(agent)}.`);
    }

    const updatedAt = this.now().toISOString();
    const updatedAssignment = updateWorkItemAssignmentInSnapshot(this.snapshot, agent.id, workItemId, status, updatedAt, note);
    if (!updatedAssignment) {
      throw new McpToolError(`Work item '${workItemId}' could not be updated.`);
    }

    this.emitWorkAssignmentUpdated(agent.id, updatedAssignment);
    return {
      success: true,
      workItemId,
      status,
      updatedAt,
      ...(updatedAssignment.note ? { note: updatedAssignment.note } : {}),
    };
  }

  private async listSourceRepositories(connectionId?: string): Promise<SourceRepository[]> {
    if (connectionId) {
      if (!this.options.listRemoteRepositories) throw new McpToolError('Remote repository listing is unavailable.');
      return this.options.listRemoteRepositories(connectionId);
    }
    const sourceFolder = this.snapshot.sourceFolder.path.trim();
    return sourceFolder ? scanSourceRepositories(sourceFolder) : [];
  }

  private async listSourceWorktrees(repoPath: string, connectionId?: string): Promise<SourceWorktree[]> {
    if (connectionId) {
      if (!this.options.listRemoteWorktrees) throw new McpToolError('Remote worktree listing is unavailable.');
      return this.options.listRemoteWorktrees(connectionId, repoPath);
    }
    return listSourceWorktrees(repoPath);
  }

  private async createSourceWorktree(
    input: CreateSourceWorktreeInput,
  ): Promise<SourceWorktree> {
    if (input.remoteConnectionId) {
      if (!this.options.createRemoteWorktree) throw new McpToolError('Remote worktree creation is unavailable.');
      return this.options.createRemoteWorktree(input);
    }
    return (await this.worktreeManager.create(input, { backgroundInitialization: true })).worktree;
  }

  private async createAgentFromMcp(
    caller: Agent,
    input: McpCreateAgentInput & { teamId?: string },
    intendedId?: string,
    assignmentPrompt?: string,
    assignmentUserInstructions?: Agent['delegationUserInstructions'],
  ): Promise<McpCreateAgentResponse> {
    const prompt = input.prompt?.trim() ?? '';
    if (input.goal && !prompt && !assignmentPrompt) return { success: false, message: 'prompt is required when goal is true' };
    if (input.goal && !input.remoteConnectionId) {
      const backend = resolveAgentBackend(this.snapshot, input.selection?.backend ?? caller.backend);
      const target = { ...caller, id: intendedId ?? '', backend, backendSession: undefined, backendDefaults: delegatedBackendDefaults(caller, input) };
      if (!this.requireDriverRpc().getCapabilities(target).goals) return { success: false, message: 'This backend does not support goals.' };
    }
    const instructions = input.instructions?.trim();
    const userOverrides = input.createWorktree && !assignmentPrompt ? caller.userDelegationOverrides : undefined;
    const startingContext = userOverrides?.startingContext ?? input.startingContext ?? this.snapshot.general.worktreeDelegationStartingContext ?? 'handoff';
    if (instructions && !prompt) {
      return { success: false, message: 'prompt is required when instructions are provided' };
    }
    const savedInstructions = input.createWorktree ? this.snapshot.general.worktreeDelegationInstructions?.trim() : undefined;
    const taskSpecific = userOverrides?.instructions?.trim();
    const userInstructions = assignmentPrompt !== undefined ? assignmentUserInstructions : (savedInstructions || taskSpecific ? { saved: savedInstructions ?? '', ...(taskSpecific ? { taskSpecific } : {}) } : undefined);
    const scopedInstructions = input.createWorktree && prompt ? [
      'Only explicit task-specific user instructions take precedence over saved user delegation instructions. Saved user instructions take precedence over the assignment brief and guidance generated by the delegating agent. None of these instructions grants additional work, Git publication or merge authority beyond the user’s authorized scope.',
      ...(instructions ? [`Assignment guidance from the delegating agent:\n${instructions}`] : []),
    ].join('\n\n') : instructions;
    const fullPrompt = scopedInstructions
      ? `<context>\n${scopedInstructions.replace(/<\/context>/giu, '&lt;/context&gt;')}\n</context>\n\n${prompt}`
      : prompt;
    if (input.task) {
      if (!this.tasks) throw new Error('Durable tasks are unavailable.');
      const task = await this.tasks.create(caller, {
        requestId: input.requestId ?? '', task: input.task, prompt: fullPrompt,
        ...(input.goal ? { goal: true } : {}),
        ...(userInstructions ? { delegationUserInstructions: userInstructions } : {}),
        backend: input.selection?.backend ?? caller.backend, specification: input,
        workspace: {
          ...(input.remoteConnectionId ? { remoteConnectionId: input.remoteConnectionId } : {}),
          repositoryPath: input.repoPath,
          ...(input.createWorktree && input.branchName ? { branchName: input.branchName } : {}),
          ...(input.destinationPath ? { destinationPath: input.destinationPath } : {}),
        },
      }, async task => {
        const response = await this.createAgentFromMcp(caller, { ...input, startingContext, task: undefined, prompt: undefined, instructions: undefined }, task.workerAgentId, task.prompt, task.delegationUserInstructions);
        if (!response.success) throw new Error(response.message);
        await this.persistSnapshot?.();
        return this.getCollaborationAgents().find(agent => agent.id === task.workerAgentId)!;
      });
      const worker = this.getCollaborationAgents().find(agent => agent.id === task.workerAgentId);
      return { success: true, taskId: task.id, task, agentId: task.workerAgentId, folder: task.folder, promptSubmitted: Boolean(task.acceptance), ...(worker?.delegationContext ? { delegationContext: worker.delegationContext } : {}), message: `Task ${task.id}: ${task.state}. Use wait-tasks to inspect the durable outcome.` };
    }
    const repoPath = input.repoPath.trim();
    if (!repoPath) {
      return { success: false, message: 'repoPath is required' };
    }
    const branchName = input.branchName?.trim();
    if (input.createWorktree && !branchName) {
      return { success: false, message: 'branchName is required when createWorktree is true' };
    }

    if (input.remoteConnectionId) {
      if (!this.options.createRemoteWorker) throw new McpToolError('Remote agent creation is unavailable.');
      const worker = await this.options.createRemoteWorker(caller, { ...input, startingContext }, intendedId, assignmentPrompt ?? (prompt ? fullPrompt : undefined), userInstructions);
      if (prompt) await this.startAgentWithPrompt(worker, delegatedAssignmentPrompt(worker, fullPrompt), input.goal);
      return { success: true, agentId: worker.id, agentName: agentDisplayName(worker), folder: worker.folder ?? undefined,
        ...(branchName ? { branchName } : {}), promptSubmitted: Boolean(prompt),
        ...(worker.delegationContext ? { delegationContext: worker.delegationContext } : {}),
        message: `Created agent ${agentDisplayName(worker)} on the selected host${prompt ? ' and started its initial prompt' : ''}.` };
    }

    const progressId = `agent-creation-${randomUUID()}`;
    const progress = {
      id: progressId,
      backend: resolveAgentBackend(this.snapshot, input.selection?.backend ?? caller.backend),
      repositoryName: fileBasename(repoPath),
      createWorktree: input.createWorktree === true,
      ...(branchName ? { branchName } : {}),
      hasPrompt: Boolean(prompt || assignmentPrompt),
    };
    this.emit({
      agentId: caller.id,
      type: 'agentCreation.progress',
      payload: {
        ...progress,
        state: 'running',
        phase: input.createWorktree ? 'creatingWorktree' : 'creatingAgent',
      },
    });

    try {
      let folder = repoPath;
      if (input.createWorktree) {
        folder = (await this.createSourceWorktree({
          repoPath,
          branchName: branchName!,
          ...(input.destinationPath?.trim() ? { destinationPath: input.destinationPath.trim() } : {}),
        })).path;
      }

      if (input.createWorktree) {
        this.emit({
          agentId: caller.id,
          type: 'agentCreation.progress',
          payload: { ...progress, state: 'running', phase: 'creatingAgent' },
        });
      }

      const createInput: CreateAgentInput = { name: input.name?.trim() || null, folder, delegatedByAgentId: this.options.resolveDelegationParent?.(caller.id) ?? caller.id, teamId: input.teamId ?? caller.teamId, selection: { backend: progress.backend } };
      const createdAgent = this.agentCreation.create(createInput, { select: false, ...(intendedId ? { id: intendedId } : {}) });
      if (userInstructions && (prompt || assignmentPrompt)) createdAgent.delegationUserInstructions = { ...userInstructions };
      // Creation applies the target provider's saved model and approval policy first.
      createdAgent.backendDefaults = { ...createdAgent.backendDefaults, ...delegatedBackendDefaults(caller, input) };
      if (this.resolveWorkspaceIdentity) {
        const workspace = await this.resolveWorkspaceIdentity(folder);
        updateAgentWorkspace(this.snapshot, createdAgent.id, workspace, workspace.updatedAt);
      }

      if (input.createWorktree && (prompt || assignmentPrompt)) {
        createdAgent.delegationContext = await this.prepareDelegationContext(caller, createdAgent, { ...input, startingContext });
        Object.assign(progress, { delegationContext: createdAgent.delegationContext });
      }
      this.emitSnapshotUpdated(createdAgent.id);
      if (prompt) {
        this.emit({
          agentId: caller.id,
          type: 'agentCreation.progress',
          payload: { ...progress, state: 'running', phase: 'startingPrompt' },
        });
        await this.startAgentWithPrompt(createdAgent, delegatedAssignmentPrompt(createdAgent, fullPrompt), input.goal);
      }

      const createdAgentName = agentDisplayName(createdAgent);
      this.emit({
        agentId: caller.id,
        type: 'agentCreation.progress',
        payload: {
          ...progress,
          state: 'success',
          agentId: createdAgent.id,
          agentName: createdAgentName,
        },
      });
      return {
        success: true,
        agentId: createdAgent.id,
        agentName: createdAgentName,
        folder,
        ...(branchName ? { branchName } : {}),
        promptSubmitted: Boolean(prompt),
        ...(createdAgent.delegationContext ? { delegationContext: createdAgent.delegationContext } : {}),
        message: prompt
          ? `Created agent ${createdAgentName} and started its initial prompt.`
          : `Created agent ${createdAgentName}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        agentId: caller.id,
        type: 'agentCreation.progress',
        payload: { ...progress, state: 'error', error: message },
      });
      throw error;
    }
  }

  private async prepareDelegationContext(caller: Agent, worker: Agent, input: McpCreateAgentInput): Promise<DelegationContext> {
    const requested = input.startingContext ?? this.snapshot.general.worktreeDelegationStartingContext ?? 'handoff';
    if (requested === 'handoff') return { requested, effective: 'handoff' };
    if (caller.backend !== worker.backend) return { requested, effective: 'handoff', reason: 'cross-provider' };
    if (caller.remoteConnectionId !== worker.remoteConnectionId) return { requested, effective: 'handoff', reason: 'unavailable' };
    const driver = this.backendDriverForAgent(worker);
    if (!driver.forkWorktreeConversation) return { requested, effective: 'handoff', reason: 'unsupported' };
    if (!caller.backendSession) return { requested, effective: 'handoff', reason: 'unavailable' };
    let result;
    try {
      result = await driver.forkWorktreeConversation(caller, worker);
    } catch {
      // No assignment was submitted. A native fork refusal is a fresh handoff,
      // never a transcript replay or an automatic retry of task execution.
      return { requested, effective: 'handoff', reason: 'unavailable' };
    }
    if (!result) return { requested, effective: 'handoff', reason: 'unsupported' };
    const source = caller.backendSession;
    const session = result.backendSession;
    const sameConversation = session.kind === 'codex' && source.kind === 'codex' ? session.threadId === source.threadId
      : session.kind !== 'codex' && source.kind !== 'codex' && session.sessionId === source.sessionId;
    if (session.kind !== worker.backend || sameConversation || result.activeTurnId) throw new Error('Native delegation did not create an independent idle worker conversation.');
    worker.backendSession = session;
    return { requested, effective: 'conversation' };
  }

  private startAgentWithPrompt(agent: Agent, prompt: string, goal?: boolean): Promise<BackendSendResult> {
    if (agent.remoteConnectionId) {
      if (!this.options.sendRemotePrompt) return Promise.reject(new McpToolError('Remote prompt submission is unavailable.'));
      return this.options.sendRemotePrompt(agent, prompt, goal);
    }
    return new Promise((resolve, reject) => {
      this.recordPromptInputMethod(agent.id, 'typed');
      sendAgentPrompt(
        this.snapshot,
        this.backendDriverForAgent(agent),
        agent.id,
        prompt,
        undefined,
        (event) => this.emit(event),
        {
          goal,
          onBackendSessionUpdated: () => this.emitSnapshotUpdated(agent.id),
          onPromptFailed: reject,
          onPromptStarted: result => resolve(result),
        },
      );
      this.emitSnapshotUpdated(agent.id);
    });
  }

  private emitWorkAssignmentUpdated(agentId: string, assignment: WorkBacklogAssignment): void {
    this.emit({
      agentId,
      type: 'workItem.assignmentUpdated',
      payload: assignment,
    });
  }

  private emit(event: BackendEvent): void {
    this.eventSink?.(event);
  }
}

function delegatedBackendDefaults(caller: Agent, input: McpCreateAgentInput): BackendDefaults {
  const backend = input.selection?.backend ?? caller.backend;
  const target = { backend, backendDefaults: undefined as BackendDefaults | undefined };
  const base = caller.backend === backend ? executionSelectionForAgent(caller) : defaultExecutionSelection(backend);
  applyExecutionSelection(target, resolveExecutionSelection(base, input.selection));
  return target.backendDefaults!;
}

async function readAgentMarkdownFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf8');
  return Buffer.byteLength(content, 'utf8') > maxMarkdownBytes
    ? content.slice(0, maxMarkdownBytes)
    : content;
}

function resolveAgentFilePath(folder: string, filePath: string): { absolutePath: string; relativePath: string } {
  const root = resolveUserPath(folder);
  const target = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  const relativePath = path.relative(root, target);

  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`File is outside the agent folder: ${filePath}`);
  }

  return {
    absolutePath: target,
    relativePath: relativePath.split(path.sep).join('/'),
  };
}

function resolveUserPath(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
}

function fileBasename(filePath: string): string {
  return filePath.split('/').filter(Boolean).at(-1) ?? filePath;
}
