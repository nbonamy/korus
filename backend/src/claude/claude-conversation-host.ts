import { validConsumption, type Consumption, type ExecutionObservation, type RequestObservation } from '@workspace/core/usage';
import path from 'node:path';
import { cp, rm } from 'node:fs/promises';
import { warnMain } from '../log';
import { promptContentDirectory, restorePromptContent, savePromptContent } from './prompt-content';
import { promptWithSelectedReferences } from '../agents/prompt-content';
import { isAppMcpServerName, product } from '@workspace/core/product';
import { randomUUID } from 'node:crypto';
import { getLocalClaudeAuthentication, logoutLocalClaude } from './authentication';
import { getClaudeAccountUsage } from './account-usage';
import { requestFromClientRequest, clientResponseFromAgentResponse, type AgentRequestResponse } from '@workspace/core/agent-request';
import type {
  AccountRateLimits,
  Agent,
  AppPluginSettings,
  BackendConversationRef,
  BackendModelOption,
  BackendRuntimeStatus,
  BackendSession,
  BackendSkillSummary,
  ClientRequest, ClaudeConversationEvent,
  ClaudeConversationSnapshot,
  ClaudeConversationTurn,
  ConversationResumeTarget,
  ConversationSummary,
  RendererMessage,
  RendererToolPart,
  SendPromptOptions,
  ThreadGoal,
} from '@workspace/core/contracts';
import {
  createClaudeConversationReplica,
  type ClaudeConversationReplica,
} from '@workspace/core/claude-conversation-replica';
import { createUserMessage } from '@workspace/core/claude-conversation-transcript';
import { type AgentBackendDriver, type BackendCodeReviewInput, type BackendCodeReviewResult, type BackendConversationResumeResult, type BackendEvent, type BackendPermissionModeResult, type BackendSendResult } from '@workspace/core/backend-driver';
import { claudeWorkingDirectory } from './working-directory';
import { claudeConfigDirectory, claudeConfigDirectoryOverride } from './config-directory';
import { agentScopedMcpUrl, appMcpUrlForAgent } from '../mcp/codex-config';
import { appDeveloperInstructions, type AgentEffectInstructionSettings } from '../mcp/agent-prompts';
import { ClaudeAgentSdkTransport } from './agent-sdk-transport';
import {
  type ClaudePermissionRequest,
  type ClaudeContextUsage,
  type ClaudeTurnHandle,
  type ClaudeTurnParams,
  type ClaudeTurnTransport,
} from './transport';
import { ClaudeProviderCatalog } from './claude-provider-catalog';
import { listClaudeTranscriptSummaries, loadClaudeTranscriptHistory, type ClaudeTranscriptHistory } from './transcript-history-adapter';
import { ClaudeHistoryWindow } from './history-window';
import { ClaudeTaskPlan } from './claude-task-plan';
import { ClaudeSubagents } from './claude-subagents';
import { claudeToolResultText } from './claude-tool-result';
import {
  claudeToolFileActivity,
  claudeMcpToolName,
  claudeToolPart,
  claudeToolPartInputUpdate,
  completedClaudeToolPart,
  type ClaudeToolFileActivity,
} from './claude-tool-part-adapter';
import {
  claudeMessageContentBlocks,
  claudeMessageSessionId,
  claudeCompactionEvent,
  claudeResultErrorMessage,
  claudeStreamTextDelta,
  claudeStreamToolInputDelta,
  claudeStreamToolUseStart,
  type ClaudeSdkContentBlock,
  type ClaudeSdkMessage,
} from './protocol';

type StreamedClaudeTool = {
  id: string;
  name: string;
  inputJson: string;
  emitted: boolean;
  planContent: string;
};

type ActiveClaudeTurn = {
  observedAt?:number;
  requestCoverage?: "complete" | "partial";
  consumption?:Consumption;
  agentId: string;
  cwd: string;
  turnId: string;
  sessionId: string | null;
  transcriptFolder?: string;
  model: string | null;
  reasoningEffort: ClaudeTurnParams['effort'];
  serviceTier: 'fast' | null;
  handle: ClaudeTurnHandle;
  planMode: boolean;
  completed: boolean;
  interrupted: boolean;
  streamedText: string;
  streamedToolsByIndex: Map<number, StreamedClaudeTool>;
  toolPartsById: Map<string, RendererToolPart>;
  fileActivitiesById: Map<string, ClaudeToolFileActivity>;
  completedPlanMarkdown: string | null;
  compactionStarted: boolean;
  compactionCompleted: boolean;
  resolveStart: (result: BackendSendResult) => void;
  rejectStart: (error: Error) => void;
  startResolved: boolean;
  error: Error | null;
  authenticationFailed?: boolean;
  rateLimit?: import('@workspace/core/auto-resume').RateLimitDetails;
  rateLimitMessage?: string;
};

type EventListener = (event: BackendEvent) => void;
type UnsequencedClaudeConversationEvent<Event extends ClaudeConversationEvent = ClaudeConversationEvent> =
  Event extends ClaudeConversationEvent
    ? Omit<Event, 'seq' | 'occurredAt'> & { occurredAt?: string }
    : never;
type ClaudeHistoryLoader = (agent: Agent) => Promise<ClaudeTranscriptHistory | null>;
type ClaudeBackendDriverOptions = {
  appMcpServerUrl?: string | null;
  hostedMcpServerUrls?: () => Readonly<Record<string, string>>;
  homeDir?: string;
  pluginSettings?: () => AppPluginSettings;
  celebrationsEnabled?: () => boolean;
  additionalDeveloperInstructions?: (agent: Agent) => string | undefined;
};

type ClaudeReviewTurnConfiguration = {
  mcpServerUrl: string;
  allowedTools: string[];
};

export class ClaudeConversationHost implements AgentBackendDriver {
  async authenticate(request: import('@workspace/core/contracts/provider-setup').ProviderAuthenticationAction): Promise<import('@workspace/core/contracts/provider-setup').ProviderAuthentication> {
    if (request.action === 'cancel') throw new Error('Manage Claude authentication through its CLI.');
    const state = await (request.action === 'logout' ? logoutLocalClaude() : getLocalClaudeAuthentication());
    return { kind: 'claude', connected: state.loggedIn, state };
  }
  readonly backend = 'claude' as const;

  private readonly listeners = new Set<EventListener>();
  private readonly requestUsageListeners = new Set<(observation: RequestObservation) => void>();
  private readonly usageListeners = new Set<(observation:ExecutionObservation)=>void>();
  private accountLimits: AccountRateLimits = {
    limitId: 'claude', limitName: null, primary: null, secondary: null,
    credits: null, individualLimit: null, planType: null, rateLimitReachedType: null,
  };
  private readonly activeTurnsByAgentId = new Map<string, ActiveClaudeTurn>();
  private readonly forkingAgentIds = new Set<string>();
  private readonly turnBoundariesByAgentId = new Map<string, Map<string, string>>();
  private readonly goalsByAgentId = new Map<string, ThreadGoal>();
  private readonly goalRefreshIds = new Map<string, symbol>();
  private readonly conversationReplicasByAgentId = new Map<string, ClaudeConversationReplica>();
  private readonly taskPlansByAgentId = new Map<string, ClaudeTaskPlan>();
  private readonly conversationRevisionsByAgentId = new Map<string, number>();
  private readonly historyWindows = new Map<string, ClaudeHistoryWindow>();
  private readonly pendingTurnHistory = new Map<string, { window: ClaudeHistoryWindow; promise: Promise<void> }>();
  private readonly historyLoads = new Map<string, { token: symbol; sessionId: string | null }>();
  private readonly pendingRequestOwners = new Map<string, ActiveClaudeTurn>();
  private readonly liveSessionIdsByAgentId = new Map<string, string>();
  private readonly subagents = new ClaudeSubagents(event => this.emit(event));
  private readonly catalog: ClaudeProviderCatalog;
  private readonly contextUsageRefreshesByAgentId = new Map<string, Promise<void>>();
  private readonly contextUsageSessionIdsByAgentId = new Map<string, string>();
  private turnCounter = 0;
  private readonly promptContentWrites = new Map<string, Set<Promise<void>>>();

  constructor(
    private readonly transport: ClaudeTurnTransport = new ClaudeAgentSdkTransport(),
    private readonly historyLoader: ClaudeHistoryLoader = loadClaudeTranscriptHistory,
    private readonly driverOptions: ClaudeBackendDriverOptions = {},
  ) {
    this.catalog = new ClaudeProviderCatalog({
      transport,
      homeDir: driverOptions.homeDir,
      emit: (event) => this.emit(event),
    });
  }

  getRuntimeStatus(): BackendRuntimeStatus {
    return this.catalog.getRuntimeStatus();
  }

  getCapabilities(_agent?: Agent) {
    return this.catalog.getCapabilities();
  }

  async listModels(agent: Agent): Promise<BackendModelOption[]> {
    return this.catalog.listModels(agent);
  }

  async listSkills(agent: Agent): Promise<BackendSkillSummary[]> {
    return this.catalog.listSkills(agent);
  }

  async generateText(_agent: Agent, input: import('@workspace/core/backend-driver').BackendTextGenerationInput) {
    if (!this.transport.generateText) throw new Error('Claude text generation is unavailable.');
    return this.transport.generateText(input);
  }

  async runCodeReview(agent: Agent, input: BackendCodeReviewInput): Promise<BackendCodeReviewResult> {
    if (input.reviewerSession && input.reviewerSession.kind !== 'claude') {
      throw new Error('Claude cannot continue a non-Claude review conversation.');
    }
    const reviewer = input.reviewerSession
      ? { ...agent, backendSession: input.reviewerSession }
      : agent;
    let targetTurnId: string | null = null;
    const completedBeforeTarget = new Map<string, Error | null>();
    let resolveCompletion: (() => void) | null = null;
    let rejectCompletion: ((error: Error) => void) | null = null;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const errorsByTurnId = new Map<string, string>();
    const unsubscribe = this.onEvent((event) => {
      if (event.agentId !== agent.id || event.type !== 'claude.conversationEventReceived') return;
      const providerEvent = event.payload.event;
      if (providerEvent.type === 'error') {
        if (providerEvent.turnId) errorsByTurnId.set(providerEvent.turnId, providerEvent.payload.message);
        return;
      }
      if (providerEvent.type !== 'turn.completed') return;
      const error = errorsByTurnId.get(providerEvent.turnId);
      const result = error ? new Error(error) : null;
      if (providerEvent.turnId === targetTurnId) {
        if (result) rejectCompletion?.(result);
        else resolveCompletion?.();
      } else {
        completedBeforeTarget.set(providerEvent.turnId, result);
      }
    });
    try {
      const started = await this.sendPromptWithConfiguration(reviewer, input.prompt, {}, {
        mcpServerUrl: input.reviewMcpServerUrl,
        allowedTools: ['report_finding', 'update_finding', 'delete_finding', 'finish_review_round', 'set-status', 'finish_turn']
          .map(tool => `mcp__${product.mcpServerName}__${tool}`),
      });
      targetTurnId = started.turnId ?? null;
      if (!targetTurnId) throw new Error('Claude did not start the review turn.');
      if (completedBeforeTarget.has(targetTurnId)) {
        const error = completedBeforeTarget.get(targetTurnId);
        if (error) throw error;
      } else {
        await completion;
      }
      const sessionId = started.backendSession.kind === 'claude'
        ? started.backendSession.sessionId
        : null;
      if (!sessionId) throw new Error('Claude did not create a review conversation.');
      const snapshot = this.conversationReplicasByAgentId.get(agent.id)?.getSnapshot();
      const text = snapshot?.messages
        .filter((message) => message.turnId === targetTurnId && message.role === 'assistant')
        .flatMap((message) => message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []))
        .join('\n')
        .trim() ?? '';
      return {
        text,
        reviewerSession: { kind: 'claude', sessionId, transport: 'stdio' },
      };
    } finally {
      unsubscribe();
    }
  }

  async disposeCodeReview(agent: Agent, reviewerSession: BackendSession): Promise<void> {
    if (reviewerSession.kind !== 'claude') throw new Error('Claude cannot dispose a non-Claude review conversation.');
    if (this.transport.deleteSession) {
      await this.transport.deleteSession(reviewerSession.sessionId, reviewerSession.transcriptFolder ?? claudeWorkingDirectory(agent));
    } else {
      await this.transport.closeSession?.(reviewerSession.sessionId);
    }
  }

  async deleteAgentConversation(agent: Agent): Promise<void> {
    const sessionId = claudeSessionId(agent);
    if (!sessionId) return;
    await this.flushPromptContent(sessionId);
    if (this.transport.deleteSession) {
      await this.transport.deleteSession(sessionId, agent.backendSession?.kind === 'claude' ? agent.backendSession.transcriptFolder ?? claudeWorkingDirectory(agent) : claudeWorkingDirectory(agent));
    } else {
      await this.transport.closeSession?.(sessionId);
    }
    await rm(promptContentDirectory(this.promptContentHome(), sessionId), { recursive: true, force: true });
  }

  async setPermissionMode(agent: Agent, mode: string): Promise<BackendPermissionModeResult> {
    return this.catalog.setPermissionMode(agent, mode);
  }

  tryHandlePromptCommand(agent: Agent, prompt: string): Promise<BackendSendResult> | null {
    return /^\/(?:compact|goal)(?:\s+.*)?$/s.test(prompt) ? this.sendPrompt(agent, prompt) : null;
  }

  async setGoal(agent: Agent, objective: string): Promise<import('@workspace/core/backend-driver').BackendGoalResult> {
    const condition = objective.trim();
    if (!condition || /^(?:clear|stop|off|reset|none|cancel)$/i.test(condition)) throw new Error('Enter a goal condition instead of a clear command.');
    if (condition.length > 4000) throw new Error('Claude goal conditions must be at most 4,000 characters, including assignment context.');
    const now = Date.now() / 1000;
    const started = await this.sendPrompt(agent, `/goal ${condition}`, { recordUserMessage: false });
    if (started.backendSession.kind !== 'claude') throw new Error('Claude did not return a session.');
    const goal: ThreadGoal = { threadId: started.backendSession.sessionId, objective: condition, status: 'active', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: now, updatedAt: now };
    this.goalsByAgentId.set(agent.id, goal);
    return { backendSession: started.backendSession, ...(started.turnId ? { turnId: started.turnId } : {}), goal };
  }

  async clearGoal(agent: Agent): Promise<import('@workspace/core/backend-driver').BackendGoalResult> {
    if (this.activeTurnsByAgentId.has(agent.id)) await this.interrupt(agent);
    const started = await this.sendPromptWithConfiguration(agent, '/goal clear', { recordUserMessage: false }, undefined, true);
    this.goalRefreshIds.delete(agent.id);
    this.goalsByAgentId.delete(agent.id);
    return { backendSession: started.backendSession, cleared: true };
  }

  async sendPrompt(agent: Agent, prompt: string, options: SendPromptOptions = {}): Promise<BackendSendResult> {
    return this.sendPromptWithConfiguration(agent, prompt, options);
  }

  async continueInterruptedTurn(agent: Agent): Promise<import('@workspace/core/backend-driver').BackendTurnActionResult> {
    if (agent.backendSession?.kind !== 'claude') throw new Error('No Claude session to continue.');
    if (!this.conversationReplicasByAgentId.has(agent.id)) await this.loadConversation(agent);
    const result = await this.sendPromptWithConfiguration(agent, 'continue', {}, undefined, false, true);
    return { backendSession: result.backendSession, activeTurnId: result.turnId ?? null };
  }

  async steerPrompt(agent: Agent, prompt: string, options: SendPromptOptions = {}): Promise<BackendSendResult> {
    const turn = this.activeTurnsByAgentId.get(agent.id);
    if (!turn) return this.sendPrompt(agent, prompt, options);
    if (!turn.sessionId) throw new Error('Claude has not initialized its session yet.');
    if (!turn.handle.steer) throw new Error('This Claude transport does not support steering.');
    const messageId = randomUUID();
    if (options.content !== undefined) await savePromptContent(this.promptContentHome(), turn.sessionId, messageId, options.content);
    if (!await turn.handle.steer(promptWithSelectedReferences(prompt, options.content), options.attachments, messageId)) return this.sendPrompt(agent, prompt, options);
    // Match the native history adapter's identity so guest authorship survives reload.
    const canonicalMessageId = `user-${turn.sessionId}-${messageId}`;
    if (options.recordUserMessage !== false) {
      const createdAt = new Date().toISOString();
      this.emitConversation({
        type: 'message.userSubmitted', agentId: agent.id, backend: 'claude',
        backendSessionId: turn.sessionId ?? undefined, turnId: turn.turnId, occurredAt: createdAt,
        payload: { message: { ...createUserMessage(agent.id, prompt, createdAt, `steer-${messageId}`, turn.turnId, options.attachments, options.content), id: canonicalMessageId } },
      });
    }
    return { backendSession: claudeBackendSession(turn.sessionId, turn.model, turn.reasoningEffort, turn.transcriptFolder), turnId: turn.turnId, ...(options.recordUserMessage !== false ? { messageId: canonicalMessageId } : {}) };
  }

  private async sendPromptWithConfiguration(
    agent: Agent,
    prompt: string,
    options: SendPromptOptions,
    review?: ClaudeReviewTurnConfiguration,
    waitForCompletion = false,
    waitForInputReplay = false,
  ): Promise<BackendSendResult> {
    if (this.forkingAgentIds.has(agent.id)) throw new Error('Claude conversation is being forked.');
    if (this.activeTurnsByAgentId.has(agent.id)) {
      throw new Error('Claude already has an active turn for this agent.');
    }
    const folder = claudeWorkingDirectory(agent);
    const goalRefreshId = Symbol();
    this.goalRefreshIds.set(agent.id, goalRefreshId);
    const turnId = this.nextTurnId();
    const existingSessionId = claudeSessionId(agent);
    const liveSessionId = this.liveSessionIdsByAgentId.get(agent.id);
    if (liveSessionId && liveSessionId !== existingSessionId) {
      await this.transport.closeSession?.(liveSessionId);
      this.liveSessionIdsByAgentId.delete(agent.id);
    }
    let activeTurn: ActiveClaudeTurn | null = null;
    const messageId = options.content === undefined ? undefined : randomUUID();
    const started = new Promise<BackendSendResult>((resolve, reject) => {
      const defaults = claudeTurnParams(
        agent,
        prompt,
        options,
        existingSessionId,
        this.driverOptions.appMcpServerUrl,
        this.driverOptions.hostedMcpServerUrls?.(),
        this.driverOptions.pluginSettings?.(),
        {
          celebrationsEnabled: this.driverOptions.celebrationsEnabled?.(),
          developerInstructions: this.driverOptions.additionalDeveloperInstructions?.(agent),
        },
      );
      const turnParams: ClaudeTurnParams = review
        ? { ...defaults, mcpServerUrl: review.mcpServerUrl, allowedTools: review.allowedTools }
        : defaults;
      if (messageId) turnParams.messageId = messageId;
      if (waitForInputReplay) turnParams.waitForInputReplay = true;
      const handle = this.transport.startTurn(
        turnParams,
        (message) => {
          if (activeTurn) {
            this.handleSdkMessage(activeTurn, message);
          }
        },
        (request) => {
          if (activeTurn) {
            this.emitPermissionRequest(activeTurn, request);
          }
        },
        (requestId) => {
          if (activeTurn) this.cancelPermissionRequest(activeTurn, requestId);
        },
        (usage) => {
          if (!activeTurn?.sessionId || !activeTurn.observedAt) return;
          if (usage === null) {
            const wasComplete = activeTurn.requestCoverage === 'complete';
            activeTurn.requestCoverage = 'partial';
            if (wasComplete) this.emitUsage(activeTurn, 'usage');
            return;
          }
          const observation: RequestObservation = { ...usage, provider: 'claude', agentId: activeTurn.agentId,
            sessionId: activeTurn.sessionId, turnId: activeTurn.turnId };
          for (const listener of this.requestUsageListeners) { try { listener(observation); } catch { /* Numeric evidence must not change execution. */ } }
        },
      );
      activeTurn = {
        agentId: agent.id,
        cwd: folder,
        turnId,
        sessionId: existingSessionId,
        ...(agent.backendSession?.kind === 'claude' && agent.backendSession.transcriptFolder ? { transcriptFolder: agent.backendSession.transcriptFolder } : {}),
        model: turnParams.model ?? null,
        reasoningEffort: turnParams.effort ?? null,
        serviceTier: turnParams.fastMode ? 'fast' : null,
        handle,
        planMode: Boolean(options.planMode),
        completed: false,
        interrupted: false,
        streamedText: '',
        streamedToolsByIndex: new Map(),
        toolPartsById: new Map(),
        fileActivitiesById: new Map(),
        completedPlanMarkdown: null,
        compactionStarted: false,
        compactionCompleted: false,
        resolveStart: result => {
          if (messageId && options.content && result.backendSession.kind === 'claude') {
            const sessionId = result.backendSession.sessionId;
            const pending = this.promptContentWrites.get(sessionId) ?? new Set<Promise<void>>();
            this.promptContentWrites.set(sessionId, pending);
            const write = savePromptContent(this.promptContentHome(), sessionId, messageId, options.content)
              .catch(error => warnMain('claude', 'Prompt mention metadata could not be saved.', { message: String(error) }));
            pending.add(write);
            void write.finally(() => { pending.delete(write); if (!pending.size) this.promptContentWrites.delete(sessionId); });
          }
          resolve(result);
        },
        rejectStart: reject,
        startResolved: false,
        error: null,
      };
      this.activeTurnsByAgentId.set(agent.id, activeTurn);
      if (existingSessionId) {
        this.resolveTurnStart(activeTurn, existingSessionId);
      }

      this.ensureConversationReplica(agent);
      this.emitConversation({
        agentId: agent.id,
        backend: this.backend,
        backendSessionId: existingSessionId ?? undefined,
        turnId,
        type: 'turn.started',
        payload: { turn: { id: turnId, backend: this.backend } },
      });
      const taskPlan = this.taskPlansByAgentId.get(agent.id)?.startTurn(turnId);
      if (taskPlan) {
        this.emitConversation({ agentId: agent.id, backend: 'claude',
          backendSessionId: existingSessionId ?? undefined, turnId,
          type: 'turn.executionPlanUpdated', payload: { plan: taskPlan.plan } });
      }
      this.emit({
        agentId: agent.id,
        type: 'agent.statusChanged',
        payload: { type: 'working' },
      });
      if (options.recordUserMessage !== false && !/^\/compact(?:\s+.*)?$/s.test(prompt)) {
        const createdAt = new Date().toISOString();
        this.emitConversation({
          agentId: agent.id,
          backend: this.backend,
          backendSessionId: existingSessionId ?? undefined,
          turnId,
          type: 'message.userSubmitted',
          payload: {
            message: createUserMessage(
              agent.id,
              prompt,
              createdAt,
              'message',
              turnId,
              options.attachments,
              options.content,
            ),
          },
          occurredAt: createdAt,
        });
      }
      void handle.done
        .then(() => this.finishProcess(activeTurn as ActiveClaudeTurn))
        .catch((error: unknown) => this.failProcess(activeTurn as ActiveClaudeTurn, error))
        .then(() => this.refreshGoal(agent, activeTurn as ActiveClaudeTurn, goalRefreshId));
    });

    const result = await started.catch((error: unknown) => {
      const normalizedError = normalizeProcessError(error);
      if (isClaudeAuthenticationError(normalizedError.message)) this.markAuthenticationFailed(activeTurn ?? undefined);
      throw normalizedError;
    });
    const turn = activeTurn as ActiveClaudeTurn | null;
    if (waitForCompletion && turn) {
      await turn.handle.done;
      if (turn.error) throw turn.error;
    }
    return result;
  }

  async interrupt(agent: Agent, expectedTurnId?: string): Promise<BackendSendResult> {
    const activeTurn = this.activeTurnsByAgentId.get(agent.id);
    if (!activeTurn) {
      throw new Error('No active Claude turn to interrupt.');
    }
    if (expectedTurnId && activeTurn.turnId !== expectedTurnId) throw new Error('The requested Claude task turn is no longer active.');

    activeTurn.interrupted = true;
    await activeTurn.handle.interrupt();
    this.completeTurn(activeTurn);
    if (this.activeTurnsByAgentId.get(agent.id) === activeTurn) this.activeTurnsByAgentId.delete(agent.id);

    return {
      backendSession: claudeBackendSession(
        activeTurn.sessionId ?? claudeSessionId(agent) ?? agent.id,
        activeTurn.model,
        activeTurn.reasoningEffort,
        activeTurn.transcriptFolder,
      ),
      turnId: activeTurn.turnId,
    };
  }

  async respondToAgentRequest(response: AgentRequestResponse): Promise<void> {
    if (!this.transport.respondToPermissionRequest) {
      throw new Error('Claude permission responses are not supported by the active transport.');
    }
    const matches = [...this.pendingRequestOwners].filter(([key, turn]) => (
      key === JSON.stringify([turn.agentId, response.id]) && (!response.agentId || response.agentId === turn.agentId)
    ));
    if (matches.length > 1) throw new Error('Agent identity is required for this request.');
    const [key, owner] = matches[0] ?? [];
    if (!owner) {
      throw new Error(`Claude permission request '${response.id}' is no longer pending.`);
    }
    await this.transport.respondToPermissionRequest(response.id, clientResponseFromAgentResponse(response).payload ?? {}, owner.agentId);
    if (this.pendingRequestOwners.get(key!) !== owner) return;
    this.pendingRequestOwners.delete(key!);
    this.emitConversation({
      agentId: owner.agentId,
      backend: this.backend,
      backendSessionId: owner.sessionId ?? undefined,
      turnId: owner.turnId,
      type: 'clientRequest.resolved',
      payload: { id: response.id },
    }, response.outcome);
    this.resumeStatusAfterRequest(owner);
  }

  async releaseConversation(agentId: string): Promise<void> {
    this.subagents.release(agentId);
    const releasedWindow = this.historyWindows.get(agentId);
    this.historyWindows.delete(agentId);
    for (const [key, pending] of this.pendingTurnHistory) if (pending.window === releasedWindow) this.pendingTurnHistory.delete(key);
    this.historyLoads.delete(agentId);
    this.turnBoundariesByAgentId.delete(agentId);
    this.goalRefreshIds.delete(agentId);
    this.goalsByAgentId.delete(agentId);
    this.conversationReplicasByAgentId.delete(agentId);
    this.taskPlansByAgentId.delete(agentId);
    this.conversationRevisionsByAgentId.delete(agentId);
    const sessionId = this.liveSessionIdsByAgentId.get(agentId);
    this.contextUsageSessionIdsByAgentId.delete(agentId);
    if (!sessionId) return;
    this.liveSessionIdsByAgentId.delete(agentId);
    await this.transport.closeSession?.(sessionId);
  }

  async assertHandoffReady(agent: Agent): Promise<void> {
    const snapshot = this.conversationReplicasByAgentId.get(agent.id)?.getSnapshot();
    if (this.activeTurnsByAgentId.has(agent.id) || snapshot?.busy || snapshot?.activeTurnId || [...this.pendingRequestOwners.values()].some(turn => turn.agentId === agent.id)) {
      throw new Error('Resolve the Claude turn and requests before handing off.');
    }
  }

  async loadConversation(agent: Agent): Promise<BackendSession | null> {
    const sessionId = claudeSessionId(agent);
    const load = { token: Symbol(), sessionId };
    this.historyLoads.set(agent.id, load);
    const startingRevision = this.conversationRevisionsByAgentId.get(agent.id);
    const hasLiveSession = () => sessionId !== null && this.liveSessionIdsByAgentId.get(agent.id) === sessionId;
    const cachedWindow = this.historyWindows.get(agent.id);
    const cached = this.conversationReplicasByAgentId.get(agent.id)?.getSnapshot();
    if (!hasLiveSession() && cached?.sessionId === sessionId && cachedWindow && await cachedWindow.isCurrent()) {
      if (this.historyLoads.get(agent.id) !== load || this.conversationRevisionsByAgentId.get(agent.id) !== startingRevision) return null;
      this.publishConversationSnapshot(cached);
      return agent.backendSession ?? null;
    }
    const history = hasLiveSession() ? null : await this.loadHistory(agent);
    if (this.historyLoads.get(agent.id) !== load) return null;
    const current = this.conversationReplicasByAgentId.get(agent.id)?.getSnapshot();
    // A turn can start while history is being read. Keep its live message identities.
    if (hasLiveSession() && current?.sessionId === sessionId) {
      this.publishConversationSnapshot(current);
      return agent.backendSession ?? null;
    }
    if (this.conversationRevisionsByAgentId.get(agent.id) !== startingRevision && current) return null;
    if (!history) {
      return null;
    }

    this.resetConversationReplica(
      agent,
      history.backendSession.kind === 'claude' ? history.backendSession.sessionId : null,
      history.messages,
      history.taskPlan,
      history.turns,
      history.source,
    );
    for (const event of history.subagentEvents ?? []) this.emit(event);

    if (history.backendSession.kind === 'claude') {
      this.publishGoal(agent.id, history.goal);
      this.queueHydratedContextUsageRefresh(agent, history.backendSession);
    }

    return history.backendSession;
  }

  async loadOlderHistory(agent: Agent): Promise<import('@workspace/core/backend-driver').BackendHistoryLoadResult> {
    const window = this.historyWindows.get(agent.id);
    const snapshot = this.conversationReplicasByAgentId.get(agent.id)?.getSnapshot();
    if (!window || !snapshot || window.sessionId !== claudeSessionId(agent) || snapshot.sessionId !== window.sessionId) {
      throw new Error('Claude history is no longer open. Reload the conversation.');
    }
    const page = window.older();
    const frame = this.emitConversation({ agentId: agent.id, backend: 'claude', backendSessionId: window.sessionId ?? undefined,
      type: 'history.prepended', payload: page });
    return { hasOlder: page.hasOlder, frame };
  }

  async loadTurnHistory(agent: Agent, turnId: string): Promise<void> {
    const window = this.historyWindows.get(agent.id);
    const snapshot = this.conversationReplicasByAgentId.get(agent.id)?.getSnapshot();
    if (!window || !snapshot || window.sessionId !== claudeSessionId(agent) || snapshot.sessionId !== window.sessionId) {
      throw new Error('Claude history is no longer open. Reload the conversation.');
    }
    const turn = snapshot.turns.find(candidate => candidate.id === turnId);
    if (!turn || !snapshot.messages.some(message => message.turnId === turnId)) throw new Error('Claude turn is no longer available. Reload the conversation.');
    if (!window.isSummaryTurn(turnId)) return;
    const key = JSON.stringify([agent.id, turnId]);
    const existing = this.pendingTurnHistory.get(key);
    if (existing?.window === window) return existing.promise;
    const current = () => this.historyWindows.get(agent.id) === window
      && (!this.historyLoads.has(agent.id) || this.historyLoads.get(agent.id)!.sessionId === snapshot.sessionId)
      && this.conversationReplicasByAgentId.get(agent.id)?.getSnapshot().sessionId === snapshot.sessionId;
    const publishTurn = (update: Partial<ClaudeConversationTurn>) => this.emitConversation({
      agentId: agent.id, backend: 'claude', backendSessionId: snapshot.sessionId ?? undefined,
      type: 'turn.historyUpdated', payload: { turn: { ...turn, ...update } },
    });
    const promise = (async () => {
      publishTurn({ detailsLoading: true, detailsError: null });
      try {
        const messages = await window.expandTurn(turnId);
        if (!current()) throw new Error('Claude history is no longer open. Reload the conversation.');
        const latest = this.conversationReplicasByAgentId.get(agent.id)!.getSnapshot();
        window.capture(latest.messages);
        const latestIds = new Set(latest.messages.map(message => message.id));
        const visible = new Set([...window.visibleMessageIds()].filter(id => latestIds.has(id)));
        // Live rows after the selected history were delivered incrementally, not by the last reset.
        for (const message of latest.messages) if (!window.isHistoricalMessage(message.id)) visible.add(message.id);
        for (const message of messages) {
          const beforeMessageId = window.nextVisibleMessage(message.id, visible);
          this.emitConversation({ agentId: agent.id, backend: 'claude', backendSessionId: snapshot.sessionId ?? undefined,
            type: 'message.replaced', payload: { message, ...(beforeMessageId ? { beforeMessageId } : {}) } });
          visible.add(message.id);
        }
        window.reveal(messages);
        publishTurn({ itemsView: 'full', detailsLoading: false, detailsError: null });
      } catch (error) {
        if (current()) publishTurn({ itemsView: 'summary', detailsLoading: false, detailsError: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    })();
    this.pendingTurnHistory.set(key, { window, promise });
    try { await promise; }
    finally { if (this.pendingTurnHistory.get(key)?.promise === promise) this.pendingTurnHistory.delete(key); }
  }

  async readConversationContent(agent: Agent, input: import('@workspace/core/contracts/conversation').ConversationContentInput): Promise<import('@workspace/core/contracts/conversation').ConversationContentChunk> {
    const window = this.historyWindows.get(agent.id);
    if (!window || input.sessionId !== claudeSessionId(agent)) throw new Error('Conversation content is no longer available.');
    return window.read(input);
  }

  async listConversations(agent: Agent): Promise<ConversationSummary[]> {
    return listClaudeTranscriptSummaries(agent, {
      projectsRoot: this.claudeProjectsRoot(),
    });
  }

  async resumeConversation(agent: Agent, target: ConversationResumeTarget): Promise<BackendConversationResumeResult> {
    const ref = target.ref;
    if (ref.backend !== 'claude') {
      throw new Error('Claude cannot resume non-Claude conversation history.');
    }
    const currentTranscriptFolder = agent.backendSession?.kind === 'claude' && agent.backendSession.sessionId === ref.sessionId ? agent.backendSession.transcriptFolder : undefined;
    if (ref.folder !== agent.folder && ref.folder !== currentTranscriptFolder) {
      throw new Error('Claude conversation folder does not match the agent folder.');
    }

    const backendSession = claudeBackendSession(ref.sessionId, undefined, undefined, currentTranscriptFolder);
    const load = { token: Symbol(), sessionId: ref.sessionId };
    this.historyLoads.set(agent.id, load);
    const revision = this.conversationRevisionsByAgentId.get(agent.id);
    const history = await this.loadHistory({
      ...agent,
      backendSession,
    });
    if (this.historyLoads.get(agent.id) !== load || this.conversationRevisionsByAgentId.get(agent.id) !== revision) {
      throw new Error('Claude conversation changed while loading history.');
    }
    const resolvedBackendSession = history?.backendSession ?? backendSession;
    this.resetConversationReplica(
      agent,
      resolvedBackendSession.kind === 'claude' ? resolvedBackendSession.sessionId : ref.sessionId,
      history?.messages ?? [],
      history?.taskPlan,
      history?.turns,
    );
    if (resolvedBackendSession.kind === 'claude') {
      this.turnBoundariesByAgentId.delete(agent.id);
      this.goalRefreshIds.delete(agent.id);
      this.publishGoal(agent.id, history?.goal ?? null);
      this.queueHydratedContextUsageRefresh({ ...agent, backendSession: resolvedBackendSession }, resolvedBackendSession);
    }
    return {
      backendSession: resolvedBackendSession,
    };
  }

  async forkConversation(agent: Agent, targetAgent: Agent, turnId?: string): Promise<import('@workspace/core/backend-driver').BackendConversationForkResult> {
    const sessionId = claudeSessionId(agent);
    if (!sessionId) throw new Error('Claude needs an existing conversation to fork.');
    if (this.activeTurnsByAgentId.has(agent.id) || this.forkingAgentIds.has(agent.id)) throw new Error('Claude must be idle before forking.');
    if (agent.folder !== targetAgent.folder) throw new Error('Claude fork folder must match the source folder.');
    if (!this.transport.forkSession) throw new Error('Native Claude forks are unavailable.');
    this.forkingAgentIds.add(agent.id);
    try {
      const history = turnId ? await this.loadHistory(agent) : null;
      const liveBoundary = turnId ? this.turnBoundariesByAgentId.get(agent.id)?.get(turnId) : undefined;
      const historicalTurnId = liveBoundary ? history?.nativeMessageTurnIds?.[liveBoundary] : turnId;
      const boundary = historicalTurnId ? history?.turnBoundaries?.[historicalTurnId] : undefined;
      if (turnId && !boundary) throw new Error('Native Claude message boundary is unavailable for this turn. Reload the conversation and retry.');
      const storageFolder = agent.backendSession?.kind === 'claude' ? agent.backendSession.transcriptFolder : undefined;
      const childId = await this.transport.forkSession(sessionId, claudeWorkingDirectory(agent), boundary, ...(storageFolder ? [storageFolder] : []));
      await this.flushPromptContent(sessionId);
      await cp(promptContentDirectory(this.promptContentHome(), sessionId), promptContentDirectory(this.promptContentHome(), childId), { recursive: true }).catch(error => { if (error.code !== 'ENOENT') throw error; });
      const backendSession = claudeBackendSession(childId,
        agent.backendSession?.kind === 'claude' ? agent.backendSession.model : undefined,
        agent.backendSession?.kind === 'claude' ? agent.backendSession.reasoningEffort as ClaudeTurnParams['effort'] : undefined, storageFolder);
      return { backendSession };
    } finally { this.forkingAgentIds.delete(agent.id); }
  }

  async forkWorktreeConversation(agent: Agent, _targetAgent: Agent): Promise<import('@workspace/core/backend-driver').BackendConversationForkResult | null> {
    if (!this.transport.forkWorktreeSession) return null;
    const sessionId = claudeSessionId(agent);
    if (!sessionId) throw new Error('Claude needs an existing conversation to fork.');
    if (this.forkingAgentIds.has(agent.id)) throw new Error('Claude conversation is being forked.');
    const snapshot = this.conversationReplicasByAgentId.get(agent.id)?.getSnapshot();
    let boundary: string | undefined;
    if (this.activeTurnsByAgentId.has(agent.id) || snapshot?.busy) {
      const completed = snapshot ? [...snapshot.turns].reverse().find(turn => turn.status === 'completed') : undefined;
      boundary = completed ? this.turnBoundariesByAgentId.get(agent.id)?.get(completed.id) : undefined;
      if (!boundary) throw new Error('Claude needs a completed native boundary to delegate while running.');
    }
    this.forkingAgentIds.add(agent.id);
    try {
      const storageFolder = agent.backendSession?.kind === 'claude' ? agent.backendSession.transcriptFolder : undefined;
      const childId = await this.transport.forkWorktreeSession(sessionId, claudeWorkingDirectory(agent), boundary, storageFolder);
      await this.flushPromptContent(sessionId);
      await cp(promptContentDirectory(this.promptContentHome(), sessionId), promptContentDirectory(this.promptContentHome(), childId), { recursive: true }).catch(error => { if (error.code !== 'ENOENT') throw error; });
      // The destination query resumes the provider-owned fork with the worker's
      // cwd, permissions, model, system appendix and identity-scoped MCP URL.
      return { backendSession: claudeBackendSession(childId, undefined, undefined, storageFolder ?? claudeWorkingDirectory(agent)) };
    } finally { this.forkingAgentIds.delete(agent.id); }
  }

  async readConversationMessages(ref: BackendConversationRef, agentId: string): Promise<RendererMessage[]> {
    if (ref.backend !== 'claude') {
      throw new Error('Claude cannot read non-Claude conversation history.');
    }

    const current = this.conversationReplicasByAgentId.get(agentId)?.getSnapshot();
    if (ref.subagentId === undefined && current?.sessionId === ref.sessionId) return this.historyWindows.get(agentId)?.readMessages(current.messages) ?? structuredClone(current.messages);

    const historyAgent: Agent = {
      id: agentId,
      name: agentId,
      folder: ref.folder,
      backend: 'claude',
      backendSession: {
        kind: 'claude',
        sessionId: ref.sessionId,
        transport: 'stdio',
      },
      status: { type: 'idle' },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const history = ref.subagentId === undefined ? await this.loadHistory(historyAgent)
      : await loadClaudeTranscriptHistory(historyAgent, { projectsRoot: this.claudeProjectsRoot(), subagentId: ref.subagentId });
    return history?.messages ?? [];
  }

  private promptContentHome(): string {
    return this.driverOptions.homeDir ? path.join(this.driverOptions.homeDir, '.claude') : claudeConfigDirectory();
  }

  private async flushPromptContent(sessionId?: string): Promise<void> {
    await Promise.all(sessionId ? [...this.promptContentWrites.get(sessionId) ?? []] : [...this.promptContentWrites.values()].flatMap(writes => [...writes]));
  }

  private async loadHistory(agent: Agent): Promise<ClaudeTranscriptHistory | null> {
    const history = this.historyLoader === loadClaudeTranscriptHistory
      ? await loadClaudeTranscriptHistory(agent, {
        projectsRoot: this.claudeProjectsRoot(),
      }) : await this.historyLoader(agent);
    if (history?.backendSession.kind === 'claude') {
      await this.flushPromptContent(history.backendSession.sessionId);
      await restorePromptContent(this.promptContentHome(), history.backendSession.sessionId, history.messages);
      const source = history.source;
      if (source) {
        const home = this.promptContentHome(); const sessionId = history.backendSession.sessionId;
        const restore = async (messages: RendererMessage[]) => { await restorePromptContent(home, sessionId, messages); return messages; };
        history.source = { ...source, readTurn: async id => restore(await source.readTurn(id)), readAll: async () => restore(await source.readAll()) };
      }
    }
    return history;
  }

  private async refreshGoal(agent: Agent, turn: ActiveClaudeTurn, refreshId: symbol): Promise<void> {
    if (!turn.sessionId || this.goalRefreshIds.get(agent.id) !== refreshId) return;
    try {
      let goal: ThreadGoal | null | undefined;
      let verified = false;
      // The CLI can emit result before its goal_status attachment reaches disk.
      // Bound the retry and invalidate it when a newer turn or release wins.
      for (const delay of [0, 100, 200, 400, 800]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.goalRefreshIds.get(agent.id) !== refreshId) return;
        const history = await this.loadHistory({ ...agent, backendSession: claudeBackendSession(turn.sessionId, undefined, undefined, turn.transcriptFolder) });
        if (this.goalRefreshIds.get(agent.id) !== refreshId) return;
        const pending = this.goalsByAgentId.get(agent.id);
        verified = history?.goal !== undefined;
        goal = history?.goal !== undefined ? history.goal : pending;
        if (goal && pending?.status === 'active' && goal.createdAt < pending.createdAt) { goal = pending; verified = false; }
        if (goal?.status !== 'active' || turn.error || turn.interrupted) break;
      }
      if (goal?.status === 'active' && (turn.error || turn.interrupted || !verified)) {
        goal = { ...goal, status: turn.interrupted ? 'paused' : 'blocked', updatedAt: Date.now() / 1000 };
      }
      this.publishGoal(agent.id, goal);
    } catch {
      // History is best effort; an unreadable transcript must not claim success.
      const goal = this.goalsByAgentId.get(agent.id);
      if (goal && this.goalRefreshIds.get(agent.id) === refreshId) this.publishGoal(agent.id, { ...goal, status: 'blocked' });
    }
  }

  private publishGoal(agentId: string, goal: ThreadGoal | null | undefined): void {
    if (goal === undefined) return;
    if (goal === null) {
      this.goalsByAgentId.delete(agentId);
      this.emit({ agentId, type: 'conversation.goalCleared', payload: {} });
    } else {
      this.goalsByAgentId.set(agentId, goal);
      this.emit({ agentId, type: 'conversation.goalUpdated', payload: { goal } });
    }
  }

  private claudeProjectsRoot(): string | undefined {
    return this.driverOptions.homeDir ? path.join(this.driverOptions.homeDir, '.claude', 'projects') : undefined;
  }

  onRequestUsage(listener: (observation: RequestObservation) => void): () => void { this.requestUsageListeners.add(listener); return () => this.requestUsageListeners.delete(listener); }

  onUsage(listener:(observation:ExecutionObservation)=>void):()=>void { this.usageListeners.add(listener); return ()=>this.usageListeners.delete(listener); }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async getAccountRateLimits(): Promise<AccountRateLimits | null> {
    const limits = await getClaudeAccountUsage();
    if (limits) this.accountLimits = limits;
    return limits;
  }

  async close(): Promise<void> {
    this.goalRefreshIds.clear();
    this.goalsByAgentId.clear();
    this.turnBoundariesByAgentId.clear();
    const interrupts: Promise<void>[] = [];
    for (const activeTurn of this.activeTurnsByAgentId.values()) {
      activeTurn.interrupted = true;
      interrupts.push(activeTurn.handle.interrupt());
    }
    this.activeTurnsByAgentId.clear();
    this.conversationReplicasByAgentId.clear();
    this.taskPlansByAgentId.clear();
    this.historyWindows.clear();
    this.pendingTurnHistory.clear();
    this.historyLoads.clear();
    this.conversationRevisionsByAgentId.clear();
    this.liveSessionIdsByAgentId.clear();
    await Promise.allSettled(interrupts);
    await this.flushPromptContent();
    await this.transport.close();
  }

  private handleSdkMessage(activeTurn: ActiveClaudeTurn, message: ClaudeSdkMessage): void {
    if (activeTurn.completed) {
      if (activeTurn.sessionId && this.liveSessionIdsByAgentId.get(activeTurn.agentId) === activeTurn.sessionId) {
        this.subagents.observe(activeTurn.agentId, activeTurn.sessionId, message);
      }
      return;
    }
    if (message.type === 'rate_limit_event') {
      const info = 'rate_limit_info' in message ? message.rate_limit_info : undefined;
      if (!info || typeof info !== 'object') return;
      const { rateLimitType, utilization, resetsAt, status } = info as Record<string, unknown>;
      if (status === 'rejected' && typeof resetsAt === 'number' && Number.isFinite(resetsAt)) activeTurn.rateLimit = { resumeAt: resetsAt * 1000 };
      const slot = rateLimitType === 'five_hour' ? 'primary' : rateLimitType === 'seven_day' ? 'secondary' : null;
      // Model-specific and overage limits must not replace the overall weekly quota.
      if (!slot || typeof utilization !== 'number' || !Number.isFinite(utilization) || utilization < 0) return;
      this.accountLimits = { ...this.accountLimits, [slot]: {
        usedPercent: utilization * 100,
        windowDurationMins: slot === 'primary' ? 300 : 10_080,
        resetsAt: typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? resetsAt : null,
      } };
      this.emit({ type: 'account.rateLimitsUpdated', backend: 'claude', payload: { rateLimits: this.accountLimits } });
      return;
    }
    const sessionId = claudeMessageSessionId(message);
    if (sessionId) {
      this.resolveTurnStart(activeTurn, sessionId);
    }
    if (activeTurn.sessionId && this.subagents.observe(activeTurn.agentId, activeTurn.sessionId, message)) return;

    if (activeTurn.sessionId && !activeTurn.observedAt && (message.type === 'assistant' || message.type === 'stream_event' || message.type === 'result' || message.type === 'system' && message.subtype === 'init')) {
      activeTurn.observedAt = Date.now();
      // The SDK init model is execution evidence. Requested defaults alone are not.
      activeTurn.model = message.type === 'system' && typeof message.model === 'string' ? message.model : null;
      this.emitUsage(activeTurn,'started');
    }
    if (message.type === 'system') {
      if ((message as Record<string, unknown>).subtype === 'init') {
        void this.catalog.refreshModels().catch(() => undefined);
        this.queueContextUsageRefresh(activeTurn);
      }
      this.handleCompactionEvent(activeTurn, message);
      this.emitPermissionModeStatus(activeTurn, message);
      return;
    }

    if (message.type === 'assistant') {
      if (typeof message.error === 'string' && message.error.trim()) {
        if (message.error === 'rate_limit') activeTurn.rateLimitMessage = claudeMessageContentBlocks(message).flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n') || 'Usage limit reached';
        if (message.error === 'authentication_failed') this.markAuthenticationFailed(activeTurn);
        return;
      }

      this.rememberTurnBoundary(activeTurn, message);
      this.emitAssistantMessage(activeTurn, message);
      return;
    }

    if (message.type === 'stream_event') {
      this.emitStreamEvent(activeTurn, message);
      return;
    }

    if (message.type === 'user') {
      this.rememberTurnBoundary(activeTurn, message);
      this.emitToolResults(activeTurn, message);
      return;
    }

    if (message.type === 'result') {
      activeTurn.requestCoverage = message.executionRequestCoverage === 'complete' ? 'complete' : 'partial';
      if (message.executionModel !== undefined) activeTurn.model = typeof message.executionModel === 'string' && message.executionModel.length <= 200 ? message.executionModel : null;
      if (validConsumption(message.executionConsumption)) activeTurn.consumption=message.executionConsumption;
      const errorMessage = claudeResultErrorMessage(message) ?? activeTurn.rateLimitMessage;
      if (errorMessage) {
        this.failTurn(activeTurn, new Error(normalizeClaudeErrorMessage(activeTurn.authenticationFailed ? 'authentication_failed' : errorMessage)));
      } else {
        this.completeTurn(activeTurn);
      }
      if (!activeTurn.compactionCompleted) {
        this.queueContextUsageRefresh(activeTurn);
      }
      this.activeTurnsByAgentId.delete(activeTurn.agentId);
    }
  }

  private rememberTurnBoundary(turn: ActiveClaudeTurn, message: ClaudeSdkMessage): void {
    if (!('uuid' in message) || typeof message.uuid !== 'string') return;
    let boundaries = this.turnBoundariesByAgentId.get(turn.agentId);
    if (!boundaries) this.turnBoundariesByAgentId.set(turn.agentId, boundaries = new Map());
    boundaries.set(turn.turnId, message.uuid);
  }

  private handleCompactionEvent(activeTurn: ActiveClaudeTurn, message: ClaudeSdkMessage): void {
    const event = claudeCompactionEvent(message);
    if (!event) return;
    if (event.phase === 'started') {
      this.emitCompactionStarted(activeTurn);
      return;
    }
    if (event.phase === 'failed') {
      if (event.error) {
        this.emitConversation({
          agentId: activeTurn.agentId,
          backend: this.backend,
          backendSessionId: activeTurn.sessionId ?? undefined,
          turnId: activeTurn.turnId,
          type: 'error',
          payload: { message: `Claude context compaction failed: ${event.error}` },
        });
      }
      return;
    }
    this.emitCompactionStarted(activeTurn);
    if (!activeTurn.compactionCompleted) {
      activeTurn.compactionCompleted = true;
      this.emitConversation({
        agentId: activeTurn.agentId,
        backend: this.backend,
        backendSessionId: activeTurn.sessionId ?? undefined,
        turnId: activeTurn.turnId,
        type: 'context.compactionCompleted',
        payload: {},
      });
    }
    this.queueContextUsageRefresh(activeTurn);
  }

  private emitCompactionStarted(activeTurn: ActiveClaudeTurn): void {
    if (activeTurn.compactionStarted) return;
    activeTurn.compactionStarted = true;
    this.emitConversation({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      turnId: activeTurn.turnId,
      type: 'context.compactionStarted',
      payload: {},
    });
  }

  private queueContextUsageRefresh(activeTurn: ActiveClaudeTurn): void {
    const sessionId = activeTurn.sessionId;
    if (!sessionId || !this.transport.getContextUsage) return;
    const previous = this.contextUsageRefreshesByAgentId.get(activeTurn.agentId) ?? Promise.resolve();
    const refresh = previous
      .catch(() => undefined)
      .then(async () => {
        const usage = await this.transport.getContextUsage?.(sessionId);
        if (!usage || this.liveSessionIdsByAgentId.get(activeTurn.agentId) !== sessionId) return;
        this.emitContextUsage(activeTurn.agentId, sessionId, usage, activeTurn.turnId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.contextUsageRefreshesByAgentId.get(activeTurn.agentId) === refresh) {
          this.contextUsageRefreshesByAgentId.delete(activeTurn.agentId);
        }
      });
    this.contextUsageRefreshesByAgentId.set(activeTurn.agentId, refresh);
  }

  private queueHydratedContextUsageRefresh(agent: Agent, backendSession: Extract<BackendSession, { kind: 'claude' }>): void {
    if (!this.transport.readContextUsage) return;
    const sessionId = backendSession.sessionId;
    this.contextUsageSessionIdsByAgentId.set(agent.id, sessionId);
    const previous = this.contextUsageRefreshesByAgentId.get(agent.id) ?? Promise.resolve();
    const refresh = previous
      .catch(() => undefined)
      .then(async () => {
        const turnParams = claudeTurnParams(
          { ...agent, backendSession },
          '',
          {},
          sessionId,
          this.driverOptions.appMcpServerUrl,
          this.driverOptions.hostedMcpServerUrls?.(),
          this.driverOptions.pluginSettings?.(),
          {
            celebrationsEnabled: this.driverOptions.celebrationsEnabled?.(),
            developerInstructions: this.driverOptions.additionalDeveloperInstructions?.(agent),
          },
        );
        const { prompt: _prompt, attachments: _attachments, ...params } = turnParams;
        const usage = await this.transport.readContextUsage?.({ ...params, sessionId });
        if (!usage || this.contextUsageSessionIdsByAgentId.get(agent.id) !== sessionId) return;
        this.emitContextUsage(agent.id, sessionId, usage);
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.contextUsageRefreshesByAgentId.get(agent.id) === refresh) {
          this.contextUsageRefreshesByAgentId.delete(agent.id);
        }
      });
    this.contextUsageRefreshesByAgentId.set(agent.id, refresh);
  }

  private emitContextUsage(agentId: string, sessionId: string, usage: ClaudeContextUsage, turnId?: string): void {
    const contextUsage = {
      totalTokens: usage.totalTokens,
      inputTokens: usage.totalTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      lastTotalTokens: usage.totalTokens,
      modelContextWindow: usage.maxTokens,
      usedPercent: usage.percentage,
    };
    this.emit({
      agentId,
      backend: this.backend,
      backendSessionId: sessionId,
      threadId: sessionId,
      ...(turnId ? { turnId } : {}),
      type: 'conversation.contextUsageUpdated',
      payload: { contextUsage },
    });
    const current = this.conversationReplicasByAgentId.get(agentId)?.getSnapshot();
    if (current?.sessionId === sessionId) this.emitConversation({ agentId, backend: 'claude', backendSessionId: sessionId,
      type: 'context.usageUpdated', payload: { contextUsage } });
  }

  private emitAssistantMessage(activeTurn: ActiveClaudeTurn, message: ClaudeSdkMessage): void {
    for (const block of claudeMessageContentBlocks(message)) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        const text = finalAssistantTextDelta(activeTurn, block.text);
        if (text) {
          this.emitTextDelta(activeTurn, text);
        }
        continue;
      }

      if (isClaudeToolUseBlock(block)) {
        if (this.handlePlanToolBlock(activeTurn, block)) {
          continue;
        }

        this.emitClaudeToolPart(activeTurn, block);
      }
    }
  }

  private emitStreamEvent(activeTurn: ActiveClaudeTurn, message: ClaudeSdkMessage): void {
    const delta = claudeStreamTextDelta(message);
    if (delta) {
      activeTurn.streamedText += delta;
      this.emitTextDelta(activeTurn, delta);
      return;
    }

    const toolUseStart = claudeStreamToolUseStart(message);
    if (toolUseStart) {
      const suppressToolPart = this.shouldSuppressPlanTool(activeTurn, toolUseStart.name);
      activeTurn.streamedToolsByIndex.set(toolUseStart.index, {
        id: toolUseStart.id,
        name: toolUseStart.name,
        inputJson: '',
        emitted: !suppressToolPart,
        planContent: '',
      });
      if (suppressToolPart) {
        return;
      }

      this.emitClaudeToolPart(activeTurn, {
        type: 'tool_use',
        id: toolUseStart.id,
        name: toolUseStart.name,
        input: toolUseStart.input,
      });
      return;
    }

    const toolInputDelta = claudeStreamToolInputDelta(message);
    if (toolInputDelta) {
      this.emitToolInputDelta(activeTurn, toolInputDelta.index, toolInputDelta.partialJson);
    }
  }

  private emitTextDelta(activeTurn: ActiveClaudeTurn, delta: string): void {
    this.emitConversation({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      turnId: activeTurn.turnId,
      type: 'message.delta',
      payload: { delta },
    });
  }

  private emitToolResults(activeTurn: ActiveClaudeTurn, message: ClaudeSdkMessage): void {
    for (const block of claudeMessageContentBlocks(message)) {
      if (!isClaudeToolResultBlock(block)) {
        continue;
      }

      const existingToolPart = activeTurn.toolPartsById.get(block.tool_use_id);
      const status = block.is_error ? 'failed' : 'completed';
      const body = claudeToolResultText(block.content);
      const completedToolPart = existingToolPart
        ? completedClaudeToolPart(existingToolPart, status, block.content, body)
        : null;
      if (completedToolPart) {
        activeTurn.toolPartsById.set(completedToolPart.id, completedToolPart);
      }
      this.emitConversation({
        agentId: activeTurn.agentId,
        backend: this.backend,
        backendSessionId: activeTurn.sessionId ?? undefined,
        turnId: activeTurn.turnId,
        type: 'item.updated',
        payload: {
          itemId: block.tool_use_id,
          status,
          ...(completedToolPart?.statusText ? { statusText: completedToolPart.statusText } : {}),
          output: block.content,
          body,
        },
      });
      this.emitClaudeFileActivity(activeTurn, block.tool_use_id, status);
      const tasks = this.taskPlansByAgentId.get(activeTurn.agentId);
      const output = message.type === 'user' ? message.tool_use_result : undefined;
      if (completedToolPart && tasks?.apply(completedToolPart, output ?? block.content,
        activeTurn.sessionId ?? activeTurn.agentId, activeTurn.turnId, new Date().toISOString())) {
        this.emitConversation({ agentId: activeTurn.agentId, backend: 'claude',
          backendSessionId: activeTurn.sessionId ?? undefined, turnId: activeTurn.turnId,
          type: 'turn.executionPlanUpdated', payload: { plan: tasks.plan } });
      }
    }
  }

  private emitToolInputDelta(activeTurn: ActiveClaudeTurn, index: number, partialJson: string): void {
    const streamedTool = activeTurn.streamedToolsByIndex.get(index);
    if (!streamedTool) {
      return;
    }

    streamedTool.inputJson += partialJson;
    const input = parseJsonObject(streamedTool.inputJson);
    if (this.handlePlanToolInput(activeTurn, streamedTool, input)) {
      return;
    }
    if (!streamedTool.emitted) {
      return;
    }

    if (!input) {
      this.emitConversation({
        agentId: activeTurn.agentId,
        backend: this.backend,
        backendSessionId: activeTurn.sessionId ?? undefined,
        turnId: activeTurn.turnId,
        type: 'item.updated',
        payload: {
          itemId: streamedTool.id,
          statusText: 'Preparing tool input...',
        },
      });
      return;
    }

    this.emitClaudeToolPart(activeTurn, {
      type: 'tool_use',
      id: streamedTool.id,
      name: streamedTool.name,
      input,
    });
  }

  private emitClaudeToolPart(
    activeTurn: ActiveClaudeTurn,
    block: Extract<ClaudeSdkContentBlock, { type: 'tool_use' }>,
  ): void {
    const toolPart = claudeToolPart(block, { cwd: activeTurn.cwd });
    const existing = activeTurn.toolPartsById.get(toolPart.id);
    activeTurn.toolPartsById.set(toolPart.id, toolPart);
    if (existing) {
      this.emitConversation({
        agentId: activeTurn.agentId,
        backend: this.backend,
        backendSessionId: activeTurn.sessionId ?? undefined,
        turnId: activeTurn.turnId,
        type: 'item.updated',
        payload: claudeToolPartInputUpdate(toolPart),
      });
    } else {
      this.emitConversation({
        agentId: activeTurn.agentId,
        backend: this.backend,
        backendSessionId: activeTurn.sessionId ?? undefined,
        turnId: activeTurn.turnId,
        type: 'item.started',
        payload: { toolPart },
      });
    }
    this.emitClaudeFileActivity(activeTurn, toolPart.id, 'running');
  }

  private emitClaudeFileActivity(
    activeTurn: ActiveClaudeTurn,
    itemId: string,
    status: RendererToolPart['status'],
  ): void {
    const toolPart = activeTurn.toolPartsById.get(itemId);
    if (!toolPart) {
      return;
    }
    const activity = claudeToolFileActivity(toolPart);
    if (!activity) {
      return;
    }
    const previous = activeTurn.fileActivitiesById.get(itemId);
    if (status === 'running' && previous?.path === activity.path && previous.action === activity.action) {
      return;
    }
    activeTurn.fileActivitiesById.set(itemId, activity);
    this.emit({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      threadId: claudeThreadId(activeTurn),
      turnId: activeTurn.turnId,
      type: 'workspace.fileActivityDetected',
      payload: {
        messageId: `assistant-${activeTurn.turnId}`,
        itemId,
        path: activity.path,
        action: activity.action,
        status,
      },
    });
  }

  private emitPermissionModeStatus(activeTurn: ActiveClaudeTurn, message: ClaudeSdkMessage): void {
    const messageRecord = message as Record<string, unknown>;
    const subtype = messageRecord.subtype;
    const permissionMode = messageRecord.permissionMode;
    if (subtype !== 'status' || typeof permissionMode !== 'string') {
      return;
    }

    this.emit({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      threadId: activeTurn.sessionId ?? undefined,
      turnId: activeTurn.turnId,
      type: 'conversation.modeUpdated',
      payload: {
        mode: permissionMode === 'plan' ? 'plan' : 'default',
        permissionMode,
      },
    });
  }

  private emitPermissionRequest(activeTurn: ActiveClaudeTurn, request: ClaudePermissionRequest): void {
    if (request.kind === 'ask_user') {
      const payload: Extract<ClientRequest, { kind: 'ask_user' }> = {
        id: request.id,
        kind: 'ask_user',
        payload: {
          request: {
            itemId: request.id,
            questions: request.questions ?? [],
          },
        },
      };
      this.pendingRequestOwners.set(JSON.stringify([activeTurn.agentId, request.id]), activeTurn);
      this.emitConversation({
        agentId: activeTurn.agentId,
        backend: this.backend,
        backendSessionId: activeTurn.sessionId ?? undefined,
        turnId: activeTurn.turnId,
        type: 'toolInput.requested',
        payload,
      });
      this.emit({
        agentId: activeTurn.agentId,
        type: 'agent.statusChanged',
        payload: {
          type: 'awaitingInput',
          detail: request.questions?.[0]?.question ?? 'Waiting for user input',
        },
      });
      return;
    }
    const mcp = claudeMcpToolName(request.toolName);
    const payload: Extract<ClientRequest, { kind: 'confirm_tool' }> = {
      id: request.id,
      kind: 'confirm_tool',
      payload: {
        confirmation: {
          argumentsPreview: formatPermissionArguments(request),
          integrationId: mcp?.server ?? 'claude',
          integrationName: isAppMcpServerName(mcp?.server) ? product.name : mcp?.server ?? 'Claude',
          summary: permissionSummary(request),
          toolName: mcp?.tool ?? request.toolName,
          allowConversation: request.allowConversation,
          allowAlways: request.allowAlways,
        },
      },
    };
    this.pendingRequestOwners.set(JSON.stringify([activeTurn.agentId, request.id]), activeTurn);
    this.emitConversation({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      turnId: activeTurn.turnId,
      type: 'approval.requested',
      payload,
    });
    this.emit({
      agentId: activeTurn.agentId,
      type: 'agent.statusChanged',
      payload: {
        type: 'awaitingInput',
        detail: payload.payload.confirmation.summary,
      },
    });
  }

  private shouldSuppressPlanTool(activeTurn: ActiveClaudeTurn, toolName: string): boolean {
    if (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode') {
      return true;
    }

    if (!activeTurn.planMode) {
      return false;
    }

    return toolName === 'ToolSearch' || toolName === 'Write';
  }

  private handlePlanToolBlock(
    activeTurn: ActiveClaudeTurn,
    block: Extract<ClaudeSdkContentBlock, { type: 'tool_use' }>,
  ): boolean {
    if (this.shouldSuppressPlanTool(activeTurn, block.name)) {
      const streamedTool = Array.from(activeTurn.streamedToolsByIndex.values()).find((tool) => tool.id === block.id) ?? {
        id: block.id,
        name: block.name,
        inputJson: '',
        emitted: false,
        planContent: '',
      };
      this.handlePlanToolInput(activeTurn, streamedTool, recordValue(block.input));
      return true;
    }

    return false;
  }

  private handlePlanToolInput(
    activeTurn: ActiveClaudeTurn,
    streamedTool: StreamedClaudeTool,
    input: Record<string, unknown> | null,
  ): boolean {
    if (streamedTool.name === 'EnterPlanMode') {
      return true;
    }

    if (streamedTool.name === 'ExitPlanMode') {
      const plan = typeof input?.plan === 'string' ? input.plan : '';
      if (plan.trim()) {
        this.emitProposedPlanCompleted(activeTurn, streamedTool.id, plan);
      }
      return true;
    }

    if (activeTurn.planMode && streamedTool.name === 'ToolSearch') {
      return true;
    }

    if (activeTurn.planMode && streamedTool.name === 'Write') {
      const content = isClaudePlanWriteInput(input) ? input.content : '';
      if (content) {
        this.emitProposedPlanContentDelta(activeTurn, streamedTool, content);
      }
      return true;
    }

    return false;
  }

  private emitProposedPlanContentDelta(
    activeTurn: ActiveClaudeTurn,
    streamedTool: StreamedClaudeTool,
    content: string,
  ): void {
    if (content === streamedTool.planContent) {
      return;
    }

    const delta = content.startsWith(streamedTool.planContent)
      ? content.slice(streamedTool.planContent.length)
      : content;
    streamedTool.planContent = content;
    if (!delta) {
      return;
    }

    this.emitConversation({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      threadId: claudeThreadId(activeTurn),
      turnId: activeTurn.turnId,
      type: 'turn.proposedPlanDelta',
      payload: {
        itemId: streamedTool.id,
        delta,
      },
    });
  }

  private emitProposedPlanCompleted(activeTurn: ActiveClaudeTurn, itemId: string, markdown: string): void {
    const normalizedMarkdown = markdown.trim();
    if (!normalizedMarkdown || activeTurn.completedPlanMarkdown === normalizedMarkdown) {
      return;
    }

    activeTurn.completedPlanMarkdown = normalizedMarkdown;
    this.emitConversation({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      threadId: claudeThreadId(activeTurn),
      turnId: activeTurn.turnId,
      type: 'turn.proposedPlanCompleted',
      payload: {
        itemId,
        markdown: normalizedMarkdown,
      },
    });
  }

  private resolveTurnStart(activeTurn: ActiveClaudeTurn, sessionId: string): void {
    activeTurn.sessionId = sessionId;
    this.liveSessionIdsByAgentId.set(activeTurn.agentId, sessionId);
    this.contextUsageSessionIdsByAgentId.set(activeTurn.agentId, sessionId);
    this.rebindConversationSession(activeTurn.agentId, sessionId);
    this.emit({
      backend: this.backend,
      type: 'backend.statusChanged',
      payload: {
        backend: this.backend,
        status: 'running',
        detail: { key: 'backend.claudeConnected' },
        capabilities: this.getCapabilities(),
      },
    });
    this.emit({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: sessionId,
      type: 'agent.conversationAttached',
      conversationId: sessionId,
      payload: {},
    });

    this.emit({
      agentId: activeTurn.agentId, backend: this.backend, backendSessionId: sessionId,
      type: 'conversation.settingsUpdated',
      payload: { settings: {
        ...(activeTurn.model ? { model: activeTurn.model } : {}),
        ...(activeTurn.reasoningEffort ? { reasoningEffort: activeTurn.reasoningEffort } : {}),
        serviceTier: activeTurn.serviceTier,
      } },
    });
    if (!activeTurn.startResolved) {
      activeTurn.startResolved = true;
      activeTurn.resolveStart({
        backendSession: claudeBackendSession(sessionId, activeTurn.model, activeTurn.reasoningEffort, activeTurn.transcriptFolder),
        turnId: activeTurn.turnId,
      });
    }
  }

  private finishProcess(activeTurn: ActiveClaudeTurn): void {
    if (activeTurn.interrupted || activeTurn.completed) {
      return;
    }

    if (!activeTurn.startResolved) {
      activeTurn.rejectStart(new Error('Claude exited before reporting a session id.'));
      this.activeTurnsByAgentId.delete(activeTurn.agentId);
      return;
    }

    this.completeTurn(activeTurn);
    this.activeTurnsByAgentId.delete(activeTurn.agentId);
  }

  private failProcess(activeTurn: ActiveClaudeTurn, error: unknown): void {
    if (activeTurn.interrupted || activeTurn.completed) {
      return;
    }

    const normalizedError = normalizeProcessError(error);
    if (isClaudeAuthenticationError(normalizedError.message)) this.markAuthenticationFailed(activeTurn);
    if (!activeTurn.startResolved) {
      activeTurn.rejectStart(normalizedError);
    } else {
      this.failTurn(activeTurn, normalizedError);
    }
    this.activeTurnsByAgentId.delete(activeTurn.agentId);
  }

  private failTurn(activeTurn: ActiveClaudeTurn, error: Error): void {
    if (isClaudeAuthenticationError(error.message)) this.markAuthenticationFailed(activeTurn);
    activeTurn.error = error;
    this.emit({
      backend: this.backend,
      type: 'backend.statusChanged',
      payload: {
        backend: this.backend,
        status: 'error',
        detail: error.message,
      },
    });
    this.emitConversation({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      turnId: activeTurn.turnId,
      type: 'error',
      payload: { message: error.message, ...(activeTurn.rateLimit ? { rateLimit: activeTurn.rateLimit } : {}) },
    });
    this.completeTurn(activeTurn);
  }

  private markAuthenticationFailed(activeTurn?: ActiveClaudeTurn): void {
    if (activeTurn?.authenticationFailed) return;
    if (activeTurn) activeTurn.authenticationFailed = true;
    this.emit({
      type: 'provider.authenticationChanged',
      payload: {
        kind: 'claude', connected: false,
        state: { loggedIn: false, configDirectory: claudeConfigDirectoryOverride() ?? null },
      },
    });
  }

  private emitUsage(turn:ActiveClaudeTurn,phase:ExecutionObservation['phase']):void {
    if (!turn.observedAt || !turn.sessionId) return;
    const at=Date.now();
    const observation:ExecutionObservation={agentId:turn.agentId,sessionId:turn.sessionId,turnId:turn.turnId,provider:'claude',requestCoverage:turn.requestCoverage ?? 'partial',phase,at,model:turn.model,reasoningEffort:turn.reasoningEffort ?? null,serviceTier:turn.serviceTier ?? 'normal',...(phase!=='started' && phase!=='usage'?{durationMs:at-turn.observedAt,...(turn.consumption?{tokens:turn.consumption}:{})}:{})};
    for (const listener of this.usageListeners) { try { listener(observation); } catch { /* Observation must not change provider execution. */ } }
  }
  private completeTurn(activeTurn: ActiveClaudeTurn): void {
    if (activeTurn.completed) {
      return;
    }

    activeTurn.completed = true;
    this.emitUsage(activeTurn,activeTurn.interrupted ? 'interrupted' : activeTurn.error ? 'failed' : 'completed');
    this.resolvePendingRequests(activeTurn);
    this.emitConversation({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      turnId: activeTurn.turnId,
      type: 'turn.completed',
      payload: { turn: { id: activeTurn.turnId, status: activeTurn.interrupted ? 'interrupted' : activeTurn.error ? 'failed' : 'completed' } },
    });
    this.emit({
      agentId: activeTurn.agentId,
      type: 'agent.statusChanged',
      payload: { type: 'idle' },
    });
  }

  private cancelPermissionRequest(activeTurn: ActiveClaudeTurn, requestId: string): void {
    const key = JSON.stringify([activeTurn.agentId, requestId]);
    if (this.pendingRequestOwners.get(key) !== activeTurn) return;
    this.pendingRequestOwners.delete(key);
    this.emitConversation({
      agentId: activeTurn.agentId,
      backend: this.backend,
      backendSessionId: activeTurn.sessionId ?? undefined,
      turnId: activeTurn.turnId,
      type: 'clientRequest.resolved',
      payload: { id: requestId },
    }, { kind: 'cancelled', reason: 'provider_cancelled' });
    this.resumeStatusAfterRequest(activeTurn);
  }

  private resumeStatusAfterRequest(activeTurn: ActiveClaudeTurn): void {
    if (this.activeTurnsByAgentId.get(activeTurn.agentId) === activeTurn && !activeTurn.completed
      && ![...this.pendingRequestOwners.values()].includes(activeTurn)) {
      this.emit({ agentId: activeTurn.agentId, type: 'agent.statusChanged', payload: { type: 'working' } });
    }
  }

  private resolvePendingRequests(activeTurn: ActiveClaudeTurn): void {
    for (const [requestId, owner] of this.pendingRequestOwners) {
      if (owner !== activeTurn) continue;
      this.pendingRequestOwners.delete(requestId);
      this.emitConversation({
        agentId: activeTurn.agentId,
        backend: this.backend,
        backendSessionId: activeTurn.sessionId ?? undefined,
        turnId: activeTurn.turnId,
        type: 'clientRequest.resolved',
        payload: { id: (JSON.parse(requestId) as [string, string])[1] },
      });
    }
  }

  private emit(event: BackendEvent): void {
    const conversationId = event.conversationId ?? event.backendSessionId ?? event.threadId
      ?? (event.agentId ? this.liveSessionIdsByAgentId.get(event.agentId) : undefined);
    for (const listener of this.listeners) {
      listener(conversationId ? { ...event, conversationId } : event);
    }
  }

  private emitConversation(input: UnsequencedClaudeConversationEvent, resolution?: import('@workspace/core/agent-request').AgentRequestOutcome): NonNullable<import('@workspace/core/backend-driver').BackendHistoryLoadResult['frame']> {
    const revision = this.nextConversationRevision(input.agentId);
    const event = {
      ...input,
      seq: revision,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    } as ClaudeConversationEvent;
    const replica = this.conversationReplicasByAgentId.get(input.agentId);
    if (!replica) {
      throw new Error(`Claude conversation '${input.agentId}' has not been initialized.`);
    }
    replica.apply(event);
    let publishedEvent = event;
    if (input.type === 'message.delta' || input.type === 'message.userSubmitted' || input.type === 'item.started' || input.type === 'item.updated') {
      const snapshot = replica.getSnapshot();
      const itemId = input.type === 'item.started' ? input.payload.toolPart.id : input.type === 'item.updated' ? input.payload.itemId : null;
      const message = input.type === 'message.userSubmitted' ? input.payload.message
        : [...snapshot.messages].reverse().find((candidate) => candidate.role === 'assistant' && candidate.turnId === input.turnId
          && (!itemId || candidate.parts.some((part) => part.type === 'tool' && part.id === itemId)));
      const window = this.historyWindows.get(input.agentId);
      if (message && window) {
        const wasDeferred = window.isDeferred(message.id);
        const projected = window.project(message);
        if (projected.deferredContent || wasDeferred) publishedEvent = { ...event, backendSessionId: snapshot.sessionId ?? undefined,
          type: input.type === 'message.userSubmitted' ? 'message.userSubmitted' : 'message.replaced', payload: { message: projected } };
      }
    }
    const frame: NonNullable<import('@workspace/core/backend-driver').BackendHistoryLoadResult['frame']> = {
      agentId: input.agentId,
      backend: 'claude',
      type: 'claude.conversationEventReceived',
      seq: revision,
      occurredAt: event.occurredAt,
      payload: { revision, event: publishedEvent },
    };
    this.emit(frame);
    if (input.type === 'turn.completed') {
      const snapshot = replica.getSnapshot();
      const window = this.historyWindows.get(input.agentId);
      for (const message of snapshot.messages) {
        if (message.turnId !== input.turnId || !window?.isDeferred(message.id)) continue;
        const revision = this.nextConversationRevision(input.agentId);
        const update: ClaudeConversationEvent = { agentId: input.agentId, backend: 'claude', backendSessionId: snapshot.sessionId ?? undefined,
          seq: revision, occurredAt: event.occurredAt, type: 'message.replaced', payload: { message: window.project(message) } };
        // The server retains the full row; only the transport replica receives its preview.
        this.emit({ agentId: input.agentId, backend: 'claude', type: 'claude.conversationEventReceived', payload: { revision, event: update } });
      }
    }
    if (input.type === 'toolInput.requested' || input.type === 'approval.requested') {
      this.emit({
        agentId: input.agentId, backend: 'claude', type: 'agentRequest.created',
        payload: { request: requestFromClientRequest(input.payload, {
          conversationId: input.backendSessionId ?? replica.getSnapshot().sessionId ?? input.agentId,
          turnId: input.turnId,
        }) },
      });
    } else if (input.type === 'clientRequest.resolved') {
      this.emit({ agentId: input.agentId, backend: 'claude', type: 'agentRequest.resolved', payload: { id: input.payload.id, outcome: resolution ?? { kind: 'cancelled', reason: 'conversation_released' } } });
    }
    return frame;
  }

  private ensureConversationReplica(agent: Agent): void {
    if (this.conversationReplicasByAgentId.has(agent.id)) return;
    this.resetConversationReplica(agent, claudeSessionId(agent), []);
  }

  private resetConversationReplica(
    agent: Agent,
    sessionId: string | null,
    messages: RendererMessage[],
    taskPlan = new ClaudeTaskPlan(),
    turns: ClaudeConversationTurn[] = [],
    source?: import('./history-source').ClaudeHistorySource,
  ): void {
    this.taskPlansByAgentId.set(agent.id, taskPlan);
    const window = new ClaudeHistoryWindow(sessionId, messages, new Set(turns.filter(turn => turn.status !== 'inProgress').map(turn => turn.id)), source);
    this.historyWindows.set(agent.id, window);
    const page = window.older();
    this.publishConversationSnapshot({
      agentId: agent.id,
      sessionId,
      activeTurnId: null,
      turnIds: turns.map(turn => turn.id),
      turns: turns.map(turn => ({ ...turn, itemsView: window.isSummaryTurn(turn.id) ? 'summary' : 'full' })),
      messages: page.messages,
      answeredClientRequestIds: [],
      busy: false,
      historyLoading: false,
      historyState: { hasOlder: page.hasOlder, loadingOlder: false },
      contextUsage: agent.contextUsage ?? null,
      plan: taskPlan.plan ?? agent.plan ?? null,
      error: null,
    });
  }

  private rebindConversationSession(agentId: string, sessionId: string): void {
    const current = this.conversationReplicasByAgentId.get(agentId)?.getSnapshot();
    if (!current || current.sessionId === sessionId) return;
    const window = this.historyWindows.get(agentId);
    if (window?.sessionId === null) window.sessionId = sessionId;
    else if (window?.sessionId !== sessionId) this.historyWindows.set(agentId, new ClaudeHistoryWindow(sessionId));
    this.publishConversationSnapshot({ ...current, sessionId });
  }

  private publishConversationSnapshot(snapshot: ClaudeConversationSnapshot): void {
    const window = this.historyWindows.get(snapshot.agentId);
    let publishedSnapshot = snapshot;
    if (window) {
      publishedSnapshot = { ...snapshot, messages: window.reopen(snapshot.messages),
        turns: snapshot.turns.map(turn => window.isSummaryTurn(turn.id) ? { ...turn, itemsView: 'summary' } : turn),
        historyState: { hasOlder: window.hasOlder, loadingOlder: false } };
      snapshot = { ...snapshot, turns: publishedSnapshot.turns, historyState: publishedSnapshot.historyState };
    }
    const revision = this.nextConversationRevision(snapshot.agentId);
    this.conversationReplicasByAgentId.set(
      snapshot.agentId,
      createClaudeConversationReplica(snapshot),
    );
    this.emit({
      agentId: snapshot.agentId,
      backend: 'claude',
      type: 'claude.conversationSnapshotChanged',
      payload: { revision, snapshot: publishedSnapshot },
    });
  }

  private nextConversationRevision(agentId: string): number {
    const revision = (this.conversationRevisionsByAgentId.get(agentId) ?? 0) + 1;
    this.conversationRevisionsByAgentId.set(agentId, revision);
    return revision;
  }

  private nextTurnId(): string {
    this.turnCounter += 1;
    return `claude-turn-${Date.now().toString(36)}-${this.turnCounter}`;
  }

}

function claudeTurnParams(
  agent: Agent,
  prompt: string,
  options: SendPromptOptions,
  existingSessionId: string | null,
  appMcpServerUrl: string | null | undefined,
  hostedMcpServerUrls: Readonly<Record<string, string>> | undefined,
  pluginSettings?: AppPluginSettings,
  effects: AgentEffectInstructionSettings = {},
): ClaudeTurnParams {
  const claudeOptions = options.backendOptions?.kind === 'claude' ? options.backendOptions : undefined;
  const defaults = agent.backendDefaults?.kind === 'claude' ? agent.backendDefaults : undefined;
  const tier = options.selection?.serviceTier !== undefined ? options.selection?.serviceTier : defaults?.serviceTier;
  if (tier != null && !['normal', 'default', 'fast'].includes(tier)) throw new Error('Unsupported Claude service tier.');
  const mcpServerUrl = appMcpServerUrl ? appMcpUrlForAgent(appMcpServerUrl, agent) : null;
  return {
    ownerId: agent.id,
    cwd: claudeWorkingDirectory(agent),
    prompt: promptWithSelectedReferences(prompt, options.content),
    sessionId: existingSessionId ?? undefined,
    model: options.selection?.model ?? defaults?.model ?? null,
    effort: claudeEffort(options.selection?.reasoningEffort ?? defaults?.reasoningEffort),
    fastMode: tier === 'fast',
    permissionMode: options.planMode ? 'plan' : claudeOptions?.permissionMode ?? defaults?.permissionMode ?? null,
    appendSystemPrompt: appDeveloperInstructions(agent, pluginSettings, effects),
    mcpServerUrl,
    hostedMcpServerUrls: Object.fromEntries(
      Object.entries(hostedMcpServerUrls ?? {}).map(([serverId, serverUrl]) => [
        serverId,
        agentScopedMcpUrl(serverUrl, agent.id),
      ]),
    ),
    allowedTools: mcpServerUrl ? [`mcp__${product.mcpServerName}__*`] : [],
    ...(options.attachments?.length ? { attachments: [...options.attachments] } : {}),
  };
}

function claudeEffort(value: string | null | undefined): ClaudeTurnParams['effort'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max'
    ? value
    : null;
}

function claudeSessionId(agent: Agent): string | null {
  return agent.backendSession?.kind === 'claude' ? agent.backendSession.sessionId : null;
}

function claudeBackendSession(
  sessionId: string,
  model?: string | null,
  reasoningEffort?: string | null,
  transcriptFolder?: string,
): BackendSession {
  return {
    kind: 'claude',
    sessionId,
    transport: 'stdio',
    ...(transcriptFolder ? { transcriptFolder } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

function isClaudeToolUseBlock(block: ClaudeSdkContentBlock): block is Extract<ClaudeSdkContentBlock, { type: 'tool_use' }> {
  return block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string';
}

function isClaudeToolResultBlock(block: ClaudeSdkContentBlock): block is Extract<ClaudeSdkContentBlock, { type: 'tool_result' }> {
  return block.type === 'tool_result' && typeof block.tool_use_id === 'string';
}

function finalAssistantTextDelta(activeTurn: ActiveClaudeTurn, text: string): string {
  if (!activeTurn.streamedText) {
    return text;
  }

  if (text === activeTurn.streamedText) {
    activeTurn.streamedText = '';
    return '';
  }

  if (text.startsWith(activeTurn.streamedText)) {
    const suffix = text.slice(activeTurn.streamedText.length);
    activeTurn.streamedText = '';
    return suffix;
  }

  activeTurn.streamedText = '';
  return text;
}

function permissionSummary(request: ClaudePermissionRequest): string {
  const filePath = request.input.file_path ?? request.input.notebook_path ?? request.blockedPath;
  if (typeof filePath === 'string' && filePath.trim()) {
    if (request.toolName === 'Edit') return `${request.input.replace_all === true ? 'Replace all matches in' : 'Edit file'} ${filePath}?`;
    if (request.toolName === 'Write') return `Write file ${filePath}?`;
    if (request.toolName === 'NotebookEdit') return `Edit notebook ${filePath}?`;
  }
  return request.title ?? request.description ?? request.displayName ?? `Claude wants to use ${request.toolName}.`;
}

function formatPermissionArguments(request: ClaudePermissionRequest): string {
  const { input, toolName } = request;
  if (toolName === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return `Before:\n${input.old_string || '(empty)'}\n\nAfter:\n${input.new_string || '(empty)'}`;
  }
  if (toolName === 'Write' && typeof input.content === 'string') {
    return `New contents (replaces any existing file contents):\n${input.content || '(empty)'}`;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return '[Unable to display tool arguments]';
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return recordValue(parsed);
  } catch {
    return null;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function claudeThreadId(activeTurn: ActiveClaudeTurn): string {
  return activeTurn.sessionId ?? activeTurn.agentId;
}

function isClaudePlanWriteInput(input: Record<string, unknown> | null): input is { file_path: string; content: string } {
  return typeof input?.file_path === 'string' &&
    (input.file_path.includes('/.claude/plans/') ||
      path.dirname(input.file_path) === path.join(claudeConfigDirectory(), 'plans')) &&
    typeof input.content === 'string';
}

function normalizeProcessError(error: unknown): Error {
  const rawMessage = error instanceof Error ? error.message : String(error);
  return new Error(normalizeClaudeErrorMessage(rawMessage));
}

function normalizeClaudeErrorMessage(message: string): string {
  const trimmedMessage = message.trim();
  if (isClaudeAuthenticationError(trimmedMessage)) {
    return 'Claude Code is not logged in. Open Claude Code and run /login, then try again.';
  }

  if (/spawn .*claude.*enoent/i.test(trimmedMessage) || /enoent/i.test(trimmedMessage)) {
    return 'Claude Code CLI was not found. Install Claude Code and make sure the claude command is available on PATH.';
  }

  return trimmedMessage || 'Claude failed to run.';
}

function isClaudeAuthenticationError(message: string): boolean {
  return /not logged in|authentication_failed|OAuth session expired and could not be refreshed/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
