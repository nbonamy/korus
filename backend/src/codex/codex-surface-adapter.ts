import type { ExecutionObservation } from '@workspace/core/usage';
import { codexExecutionConsumption } from './execution-usage';
import { bankedResetsFromSurface } from './banked-resets';
import { randomUUID } from 'node:crypto';
import { isBankedResetResult, isUseBankedResetInput, type BankedResetResult, type UseBankedResetInput } from '@workspace/core/contracts/banked-resets';
import { product } from '@workspace/core/product';
import os from 'node:os';
import { approvalAgentRequest, approvalOutcome, requestFromClientRequest, agentResponseFromClientResponse } from '@workspace/core/agent-request';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  Agent,
  AgentStatus,
  ApprovalPreset,
  BackendModelOption,
  BackendPluginSummary,
  BackendRuntimeStatus,
  BackendSession,
  BackendSkillSummary,
  ClientRequestResponse,
  ConversationListInput,
  ConversationResumeTarget,
  ConversationSummary,
  DevicePairingSession,
  DevicePairingStatus,
  RendererMessage,
  RendererMessagePart,
  RendererToolPart,
  PairedDevice,
  SendPromptOptions,
  CodexAuthentication, SubagentActivityChange,
  SubagentIdentityChange,
  SubagentOperationChange,
  SubagentStatusChange
} from '@workspace/core/contracts';
import type { BackendCodeReviewInput, BackendCodeReviewResult, BackendEvent, BackendTextGenerationInput, BackendTextGenerationResult } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { codexApprovalPresetFromDefaults } from '@workspace/core/codex-approval-presets';
import { agentDisplayName } from '@workspace/core/agent-display';
import { agentFolder } from '@workspace/core/agent-folder';
import { shouldSyncConversationTitleFromAgent } from '@workspace/core/conversation-title';
import type { CodexConversation, CodexSurface } from '@codex-app-sdk/backend';
import type {
  CodexConversationEvent,
  CodexConversationSummary,
  CodexConversationSnapshot,
  CodexSurfaceEvent,
  CodexSurfaceRateLimits,
  CodexSurfaceReviewTarget,
  CodexSurfaceSnapshot,
  CodexSurfaceSkill,
  CodexSurfaceTurnStatus,
  CodexSurfaceThreadStatus,
  SendCodexMessageOptions,
  SurfaceMessage,
  SurfaceMessagePart,
  SurfaceMessageToolPart,
} from '@codex-app-sdk/core/surface';
import {
  invokeCodexConversationBridgeOperation,
  subscribeCodexConversationReplicaBridge,
} from '@codex-app-sdk/core/surface-bridge';

type AdapterListener = (event: BackendEvent) => void;
type ThreadBackendEvent<Event extends BackendEvent = BackendEvent> = Event extends BackendEvent
  ? Omit<Event, 'agentId' | 'backend' | 'threadId' | 'conversationId'>
  : never;

const AGENT_HISTORY_CACHE_TTL_MS = 15 * 60 * 1_000;
const SESSION_HANDOFF_TARGET_CHARACTERS = 4_000;
const SESSION_HANDOFF_MAX_CHARACTERS = 6_000;
const SESSION_HANDOFF_TIMEOUT_MS = 8 * 60 * 1_000;
const REVIEW_TIMEOUT_MS = 30 * 60 * 1_000;
const SESSION_HANDOFF_MODEL = 'gpt-5.6-luna';
const SESSION_HANDOFF_REASONING_EFFORT = 'low';
const SESSION_HANDOFF_PROMPT = `Prepare a handoff for a fresh continuation of this coding session.

Return only a concise Markdown handoff. Do not call tools, modify files, spawn agents, ask questions, or continue the implementation.

Summarize the full session from beginning to end, not only its recent messages. Cover every meaningful activity in chronological order, including completed work, discarded approaches, discoveries, decisions, implementation, fixes, validation, user feedback, and changes in direction. Give earlier activities concise but sufficient coverage, then give substantially more detail to the most recent activity so work can continue without rediscovery. An activity means a coherent body of work, not an individual message or turn.

End with the current objective and status, constraints, unresolved problems, precise next steps, and important user preferences. Preserve exact identifiers, paths, commands, errors, and commit hashes when they matter. Aim for about ${SESSION_HANDOFF_TARGET_CHARACTERS} characters and never exceed ${SESSION_HANDOFF_MAX_CHARACTERS} characters.`;

type AgentConversation = {
  agent: Agent;
  handle: CodexConversation;
  suppressEvents: boolean;
  unsubscribe: () => void;
};

type SubagentOwner = {
  agentId: string;
  rootConversationId: string;
};

export class CodexSurfaceAgentAdapter {
  private readonly listeners = new Set<AdapterListener>();
  private readonly observedTools = new Map<string,Set<string>|null>();
  private readonly usageListeners = new Set<(observation:ExecutionObservation)=>void>();
  private readonly sessionsByAgentId = new Map<string, AgentConversation>();
  private readonly historyHydratedAtByAgentId = new Map<string, number>();
  private readonly agentIdsByThreadId = new Map<string, string>();
  private readonly approvalOwners = new Map<string, AgentConversation>();
  private readonly clientRequestOwners = new Map<string, AgentConversation>();
  private readonly subagentOwners = new Map<string, SubagentOwner>();
  private readonly conversationSummaries = new Map<string, CodexConversationSummary>();
  private readonly lastSubagentIdentityByConversationId = new Map<string, string>();
  private readonly subagentIdentityLoads = new Map<string, Promise<void>>();
  private readonly liveSubagentConversationIds = new Set<string>();
  private readonly conversationRevisionsByAgentId = new Map<string, number>();
  private readonly unsubscribeSurface: () => void;
  private closed = false;
  private accountRevision = 0;
  private accountIdentity = '';
  private readonly resetReadCancellations = new Set<() => void>();
  private resetCreditTokens = new Map<string, { token: string; idempotencyKey?: string; uncertain?: boolean }>();

  constructor(
    private readonly surface: CodexSurface,
    private readonly closeSurface: () => Promise<void> = () => surface.close(),
  ) {
    this.accountIdentity = JSON.stringify(surface.getSnapshot().authentication.account);
    this.unsubscribeSurface = surface.onEvent((event) => this.handleSurfaceEvent(event));
  }

  async start(): Promise<void> {
    await this.surface.connect();
  }

  async getBankedResets(): Promise<import('@workspace/core/contracts/banked-resets').BankedResets> {
    // Feature-detect the narrow public seam for older published SDKs.
    const surface = this.surface as CodexSurface & {
      readRateLimits?: (options: { excludeResetCreditDetails: boolean }) => Promise<CodexSurfaceRateLimits>;
      consumeRateLimitResetCredit?: (options: { idempotencyKey: string; creditId?: string }) => Promise<BankedResetResult>;
    };
    if (!surface.readRateLimits) return { status: 'unsupported' };
    const account = surface.getSnapshot().authentication.account;
    if (account?.type !== 'chatgpt') return { status: account ? 'unsupported' : 'signedOut' };
    const identity = JSON.stringify(account);
    if (identity !== this.accountIdentity) { this.accountIdentity = identity; ++this.accountRevision; this.resetCreditTokens.clear(); }
    const expected = this.accountRevision;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const limits = await Promise.race([
        surface.readRateLimits({ excludeResetCreditDetails: false }),
        new Promise<never>((_resolve, reject) => {
          cancel = () => reject(new Error('Banked reset account changed'));
          this.resetReadCancellations.add(cancel);
          timer = setTimeout(() => reject(new Error('Banked reset read timed out')), 15_000);
        }),
      ]);
      if (this.closed || expected !== this.accountRevision || JSON.stringify(surface.getSnapshot().authentication.account) !== JSON.stringify(account)) {
        throw new Error('Banked reset account changed');
      }
      const nextTokens = new Map<string, { token: string; idempotencyKey?: string; uncertain?: boolean }>();
      const result = bankedResetsFromSurface(limits, typeof surface.consumeRateLimitResetCredit === 'function' ? id => {
        const entry = this.resetCreditTokens.get(id) ?? { token: randomUUID() };
        nextTokens.set(id, entry);
        return entry.token;
      } : undefined);
      for (const [id, entry] of this.resetCreditTokens) {
        if (entry.uncertain && !nextTokens.has(id)) nextTokens.set(id, entry);
      }
      this.resetCreditTokens = nextTokens;
      return result;
    } finally { clearTimeout(timer); if (cancel) this.resetReadCancellations.delete(cancel); }
  }

  async useBankedReset(input: UseBankedResetInput): Promise<BankedResetResult> {
    if (!isUseBankedResetInput(input)) throw new Error('Reset confirmation is required');
    const surface = this.surface as CodexSurface & {
      consumeRateLimitResetCredit?: (options: { idempotencyKey: string; creditId?: string }) => Promise<BankedResetResult>;
    };
    if (!surface.consumeRateLimitResetCredit) throw new Error('Reset redemption is unsupported');
    const account = surface.getSnapshot().authentication.account;
    if (this.closed || account?.type !== 'chatgpt' || JSON.stringify(account) !== this.accountIdentity) {
      this.resetCreditTokens.clear();
      throw new Error('Banked reset account changed');
    }
    const selected = [...this.resetCreditTokens].find(([, entry]) => entry.token === input.redemptionToken);
    if (!selected) throw new Error('Banked reset selection expired. Refresh and try again.');
    const [creditId, entry] = selected;
    // Retain the logical attempt after an uncertain response, including UI reloads.
    entry.idempotencyKey ??= input.idempotencyKey;
    entry.uncertain = true;
    const expected = this.accountRevision;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const result = await Promise.race([
        surface.consumeRateLimitResetCredit({ creditId, idempotencyKey: entry.idempotencyKey }),
        new Promise<never>((_resolve, reject) => {
          cancel = () => reject(new Error('Banked reset account changed'));
          this.resetReadCancellations.add(cancel);
          timer = setTimeout(() => reject(new Error('Banked reset outcome is uncertain')), 15_000);
        }),
      ]);
      if (this.closed || expected !== this.accountRevision || JSON.stringify(surface.getSnapshot().authentication.account) !== JSON.stringify(account)) {
        throw new Error('Banked reset account changed');
      }
      if (!isBankedResetResult(result)) throw new Error('Invalid banked reset outcome');
      entry.uncertain = false;
      if (result.outcome === 'nothingToReset' || result.outcome === 'noCredit') delete entry.idempotencyKey;
      return result;
    } finally { clearTimeout(timer); if (cancel) this.resetReadCancellations.delete(cancel); }
  }

  async getAuthentication(): Promise<CodexAuthentication> {
    return authenticationFromSurface((await this.surface.refreshAccount()).authentication);
  }
  async getAccountUsage():Promise<import('@workspace/core/usage').AccountUsage|null> {
    const surface=this.surface as CodexSurface & {readAccountUsage?:()=>Promise<import('@workspace/core/usage').AccountUsage>};
    return surface.readAccountUsage ? surface.readAccountUsage() : null;
  }

  async startChatGptLogin() {
    return this.surface.startChatGptLogin();
  }

  async startChatGptDeviceCodeLogin() {
    return this.surface.startChatGptDeviceCodeLogin();
  }

  async cancelChatGptLogin(loginId?: string): Promise<CodexAuthentication> {
    return authenticationFromSurface((await this.surface.cancelLogin(loginId)).authentication);
  }

  async logout(): Promise<CodexAuthentication> {
    return authenticationFromSurface((await this.surface.logout()).authentication);
  }

  async getRemoteControlStatus(): Promise<DevicePairingStatus> {
    const status = await this.surface.readRemoteControlStatus();
    const requirements = await this.surface.readConfigRequirements();
    return {
      ...status,
      allowRemoteControl: requirements?.allowRemoteControl ?? null,
    };
  }

  async enableRemoteControl(): Promise<DevicePairingStatus> {
    const status = await this.surface.enableRemoteControl();
    const requirements = await this.surface.readConfigRequirements();
    return {
      ...status,
      allowRemoteControl: requirements?.allowRemoteControl ?? null,
    };
  }

  async disableRemoteControl(): Promise<DevicePairingStatus> {
    const status = await this.surface.disableRemoteControl();
    const requirements = await this.surface.readConfigRequirements();
    return {
      ...status,
      allowRemoteControl: requirements?.allowRemoteControl ?? null,
    };
  }

  async startDevicePairing(): Promise<DevicePairingSession> {
    const pairing = await this.surface.startRemoteControlPairing({ manualCode: true });
    return {
      pairingCode: pairing.pairingCode,
      manualPairingCode: pairing.manualPairingCode,
      environmentId: pairing.environmentId,
      expiresAt: epochTimestampToIso(pairing.expiresAt),
    };
  }

  async checkDevicePairing(session: DevicePairingSession): Promise<boolean> {
    const result = await this.surface.readRemoteControlPairingStatus(
      session.pairingCode
        ? { pairingCode: session.pairingCode }
        : { manualPairingCode: session.manualPairingCode ?? null },
    );
    return result.claimed;
  }

  async listPairedDevices(environmentId: string): Promise<PairedDevice[]> {
    const clients = await this.surface.listRemoteControlClients({ environmentId, limit: 100 });
    return clients.data.map((client) => ({
      clientId: client.clientId,
      displayName: client.displayName,
      deviceType: client.deviceType,
      platform: client.platform,
      osVersion: client.osVersion,
      deviceModel: client.deviceModel,
      appVersion: client.appVersion,
      lastSeenAt: client.lastSeenAt === null ? null : epochTimestampToIso(client.lastSeenAt),
    }));
  }

  async revokePairedDevice(environmentId: string, clientId: string): Promise<void> {
    await this.surface.revokeRemoteControlClient({ environmentId, clientId });
  }

  getRuntimeStatus(): BackendRuntimeStatus {
    return runtimeStatus(this.surface.getSnapshot());
  }

  getCapabilities(agent?: Agent) {
    const session = agent ? this.sessionsByAgentId.get(agent.id) : undefined;
    const presets = session?.handle.getSnapshot().approvalPresets
      ?? this.surface.getSnapshot().approvalPresets;
    return {
      ...codexBackendCapabilities,
      approvalPresets: presets.length > 0 ? [...presets] : codexBackendCapabilities.approvalPresets,
    };
  }

  async listModels(): Promise<BackendModelOption[]> {
    const models = await this.surface.listModels({ includeHidden: false, forceReload: true });
    return models.map((model) => ({
      ...model,
      supportedReasoningEfforts: model.supportedReasoningEfforts?.map((effort) => ({ ...effort })),
      serviceTiers: model.serviceTiers?.map((tier) => ({ ...tier })),
    }));
  }

  async listSkills(agent: Agent, forceReload = false): Promise<BackendSkillSummary[]> {
    const skills = await this.surface.listSkills({ ...agentCwd(agent), forceReload });
    return skills.map(backendSkillSummary);
  }

  async listPlugins(): Promise<BackendPluginSummary[]> {
    await this.start();
    const snapshot = this.surface.getSnapshot();
    if (snapshot.pluginCatalogStatus === 'loaded' || snapshot.pluginCatalogStatus === 'error') {
      return snapshot.plugins.map((plugin) => ({ ...plugin }));
    }

    return new Promise((resolve) => {
      const unsubscribe = this.surface.onEvent((event) => {
        if (event.type !== 'catalog.pluginsChanged' || event.payload.status === 'loading') return;
        unsubscribe();
        resolve(event.payload.plugins.map((plugin) => ({ ...plugin })));
      });
      const current = this.surface.getSnapshot();
      if (current.pluginCatalogStatus === 'loaded' || current.pluginCatalogStatus === 'error') {
        unsubscribe();
        resolve(current.plugins.map((plugin) => ({ ...plugin })));
      }
    });
  }

  async generateText(agent: Agent, input: BackendTextGenerationInput): Promise<BackendTextGenerationResult> {
    const defaults = agent.backendDefaults?.kind === 'codex' ? agent.backendDefaults : undefined;
    return this.surface.generateText(input.prompt, {
      cwd: expandHome(input.cwd),
      ...(defaults?.model ? { model: defaults.model } : {}),
      ...(defaults?.reasoningEffort ? { reasoningEffort: defaults.reasoningEffort } : {}),
      ...(defaults?.serviceTier !== undefined ? { serviceTier: defaults.serviceTier } : {}),
      ...(input.developerInstructions ? { developerInstructions: input.developerInstructions } : {}),
      ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
    });
  }

  async runCodeReview(agent: Agent, input: BackendCodeReviewInput): Promise<BackendCodeReviewResult> {
    await this.start();
    if (input.reviewerSession && input.reviewerSession.kind !== 'codex') {
      throw new Error('Codex cannot continue a non-Codex review conversation.');
    }
    const requestedAgent = input.reviewerSession
      ? { ...agent, backendSession: input.reviewerSession }
      : agent;
    const reviewExtensionContext = { agent, reviewMcpServerUrl: input.reviewMcpServerUrl };
    const session = await this.ensureSession(requestedAgent, reviewExtensionContext);
    session.agent = agent;
    const conversationId = session.handle.id;
    const conversation = session.handle;
    await conversation.load({ extensionContext: reviewExtensionContext });
    let targetTurnId: string | null = null;
    const completedBeforeTarget = new Map<string, CodexSurfaceTurnStatus>();
    let resolveCompletion: ((status: CodexSurfaceTurnStatus) => void) | null = null;
    const completion = new Promise<CodexSurfaceTurnStatus>((resolve) => { resolveCompletion = resolve; });
    const unsubscribe = conversation.onEvent((event) => {
      if (event.type !== 'turn.completed') return;
      if (event.turnId === targetTurnId) resolveCompletion?.(event.payload.status);
      else completedBeforeTarget.set(event.turnId, event.payload.status);
    });
    try {
      const beforeTurnIds = conversation.getSnapshot().turnIds;
      const reviewOptions = codeReviewPromptOptions(agent);
      const started = reviewOptions
        ? await conversation.sendMessage(input.prompt, reviewOptions)
        : await conversation.sendMessage(input.prompt);
      targetTurnId = resultTurnId(started, beforeTurnIds) ?? null;
      if (!targetTurnId) throw new Error('Codex did not start the review round.');
      const immediate = completedBeforeTarget.get(targetTurnId)
        ?? started.turns.find((turn) => turn.id === targetTurnId && turn.status !== 'inProgress')?.status;
      const status = immediate ?? await reviewCompletion(completion);
      const snapshot = conversation.getSnapshot();
      const completedFinalAnswer = sessionFinalAnswerText(snapshot.messages, targetTurnId);
      if (status !== 'completed' && !(status === 'interrupted' && completedFinalAnswer)) {
        throw new Error(`Code review was ${status}.`);
      }
      return {
        text: sessionHandoffText(snapshot.messages, targetTurnId),
        reviewerSession: { kind: 'codex', threadId: conversationId },
      };
    } finally {
      unsubscribe();
      await conversation.load({ ...agentCwd(agent), extensionContext: agent });
    }
  }

  async disposeCodeReview(reviewerSession: BackendSession): Promise<void> {
    if (reviewerSession.kind !== 'codex') throw new Error('Codex cannot dispose a non-Codex review conversation.');
    await this.surface.archiveConversation(reviewerSession.threadId);
    this.surface.forgetConversation(reviewerSession.threadId);
  }

  async sendPrompt(agent: Agent, prompt: string, options: SendPromptOptions = {}) {
    const session = await this.ensureSession(agent);
    const beforeTurnIds = session.handle.getSnapshot().turnIds;
    const snapshot = await session.handle.sendMessage(prompt, surfacePromptOptions(options));
    return { threadId: session.handle.id, turnId: resultTurnId(snapshot, beforeTurnIds) };
  }

  async assertHandoffReady(agent: Agent): Promise<void> {
    const session = await this.ensureSession(agent);
    const snapshot = session.handle.getSnapshot();
    if (snapshot.activeTurnId || snapshot.busy || snapshot.queuedPrompts.length || snapshot.approvals.length || snapshot.clientRequests.length) {
      throw new Error('Resolve the Codex turn, queue and requests before handing off.');
    }
  }

  async replaceConversationWithSummary(agent: Agent) {
    const currentSession = await this.ensureSession(agent);
    const currentSnapshot = currentSession.handle.getSnapshot();
    if (currentSnapshot.activeTurnId || currentSnapshot.busy) {
      throw new Error('Agent must be idle before compressing its session.');
    }

    const defaults = agent.backendDefaults?.kind === 'codex'
      ? { ...agent.backendDefaults }
      : undefined;
    const requestedPreset = codexApprovalPresetFromDefaults(defaults);
    const effectivePreset = effectiveApprovalPreset(requestedPreset, this.surface.getSnapshot().approvalPresets);
    const handoff = await this.captureSessionHandoff(currentSession);
    const previousThreadId = currentSession.handle.id;
    const replacementSnapshot = await this.surface.createConversation({
      ...agentCwd(agent),
      threadSource: 'user',
      ...(effectivePreset ? { approvalPreset: effectivePreset } : {}),
      ...(defaults?.model ? { model: defaults.model } : {}),
      ...(defaults?.reasoningEffort ? { reasoningEffort: defaults.reasoningEffort } : {}),
      ...(defaults?.serviceTier !== undefined ? { serviceTier: defaults.serviceTier } : {}),
    }, { extensionContext: agent });
    const replacementThreadId = replacementSnapshot.activeConversationId;
    if (!replacementThreadId || replacementThreadId === previousThreadId) {
      throw new Error('Codex did not create a replacement conversation.');
    }

    try {
      await this.surface.conversation(replacementThreadId).sendMessage(sessionHandoffPrompt(handoff));
      await this.surface.archiveConversation(previousThreadId);
    } catch (error) {
      await this.surface.archiveConversation(replacementThreadId).catch(() => undefined);
      throw error;
    }

    this.bindRuntime(agent, replacementThreadId, true, false);
    return { threadId: replacementThreadId };
  }

  async setConversationTitle(agent: Agent, title: string): Promise<void> {
    const session = await this.ensureSession(agent);
    await this.renameSessionIfNeeded(session, title);
  }

  async setThreadGoal(agent: Agent, objective: string) {
    const session = await this.ensureSession(agent);
    const snapshot = await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'setGoal', [objective],
    );
    if (!snapshot.goal) throw new Error('Codex did not return the updated goal.');
    return { threadId: session.handle.id, goal: snapshot.goal };
  }

  async clearThreadGoal(agent: Agent) {
    const session = await this.ensureSession(agent);
    await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'clearGoal', [],
    );
    return { threadId: session.handle.id, cleared: true };
  }

  async setApprovalPreset(agent: Agent, preset: ApprovalPreset) {
    const session = await this.ensureSession(agent);
    const effective = effectiveApprovalPreset(preset, session.handle.getSnapshot().approvalPresets);
    if (!effective) throw new Error(`No ${product.name} approval preset satisfies the Codex app-server requirements.`);
    await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'updateConversationSettings', [{ approvalPreset: effective }],
    );
    return { threadId: session.handle.id, approvalPreset: effective };
  }

  async reviewThread(agent: Agent, target: CodexSurfaceReviewTarget) {
    const session = await this.ensureSession(agent);
    const beforeTurnIds = session.handle.getSnapshot().turnIds;
    const snapshot = await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'startReview', [{ target }],
    );
    return { threadId: session.handle.id, turnId: resultTurnId(snapshot, beforeTurnIds) };
  }

  async steerPrompt(agent: Agent, prompt: string, options?: SendPromptOptions) {
    const session = await this.ensureSession(agent);
    const beforeTurnIds = session.handle.getSnapshot().turnIds;
    const snapshot = await session.handle.steerMessage(prompt, surfacePromptOptions(options));
    return { threadId: session.handle.id, turnId: resultTurnId(snapshot, beforeTurnIds) };
  }

  async interruptTurn(agent: Agent, expectedTurnId?: string) {
    const session = await this.ensureSession(agent);
    const turnId = session.handle.getSnapshot().activeTurnId;
    if (!turnId) throw new Error('No active Codex turn to interrupt.');
    if (expectedTurnId && turnId !== expectedTurnId) throw new Error('The requested Codex task turn is no longer active.');
    await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'interrupt', [],
    );
    return { threadId: session.handle.id, turnId };
  }

  releaseConversation(agentId: string): void {
    const session = this.sessionsByAgentId.get(agentId);
    if (!session) return;
    session.unsubscribe();
    this.sessionsByAgentId.delete(agentId);
    this.historyHydratedAtByAgentId.delete(agentId);
    if (this.agentIdsByThreadId.get(session.handle.id) === agentId) {
      this.agentIdsByThreadId.delete(session.handle.id);
    }
    for (const [conversationId, owner] of this.subagentOwners) {
      if (owner.agentId !== agentId) continue;
      this.subagentOwners.delete(conversationId);
      this.lastSubagentIdentityByConversationId.delete(conversationId);
      this.subagentIdentityLoads.delete(conversationId);
      this.liveSubagentConversationIds.delete(conversationId);
    }
    this.removePendingOwners(session);
    this.surface.forgetConversation(session.handle.id);
  }

  async deleteTurn(agent: Agent, turnId: string) {
    const session = await this.ensureSession(agent);
    const snapshot = await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'deleteTurn', [turnId],
    );
    return {
      threadId: session.handle.id,
      activeTurnId: snapshot.activeTurnId,
    };
  }

  async editTurn(agent: Agent, turnId: string, content: string) {
    const session = await this.ensureSession(agent);
    const snapshot = await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'editTurn', [turnId, content],
    );
    return {
      threadId: session.handle.id,
      activeTurnId: snapshot.activeTurnId,
    };
  }

  async retryTurn(agent: Agent, turnId: string) {
    const session = await this.ensureSession(agent);
    const snapshot = await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'retryTurn', [turnId],
    );
    return {
      threadId: session.handle.id,
      activeTurnId: snapshot.activeTurnId,
    };
  }

  async continueInterruptedTurn(agent: Agent) {
    const session = await this.ensureSession(agent);
    const snapshot = await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'continueInterruptedTurn', [],
    );
    return {
      threadId: session.handle.id,
      activeTurnId: snapshot.activeTurnId,
    };
  }

  async readConversationMessages(threadId: string, agentId: string): Promise<RendererMessage[]> {
    await this.start();
    const owner = this.subagentOwners.get(threadId);
    if (owner?.agentId === agentId && this.liveSubagentConversationIds.has(threadId)) {
      return historicalSurfaceMessages(this.surface.conversation(threadId).getSnapshot().messages, agentId);
    }
    const history = await this.surface.conversation(threadId).readHistory();
    const messages = historicalSurfaceMessages(history.messages, agentId);
    const session = this.sessionsByAgentId.get(agentId);
    if (session && session.handle.id !== threadId) {
      const status = subagentStatusFromHistory(history.threadStatus, messages);
      if (status) {
        this.subagentOwners.set(threadId, {
          agentId,
          rootConversationId: session.handle.id,
        });
        this.emitSubagentStatus(
          session,
          threadId,
          status,
          messages.at(-1)?.createdAt ?? new Date().toISOString(),
        );
      }
    }
    return session && session.handle.id !== threadId ? messages.slice(-1) : messages;
  }

  async readConversationSummary(agent: Agent, threadId: string): Promise<ConversationSummary> {
    const session = await this.ensureSession(agent);
    this.subagentOwners.set(threadId, {
      agentId: agent.id,
      rootConversationId: session.handle.id,
    });
    const summary = await this.surface.readConversationSummary(threadId);
    this.conversationSummaries.set(summary.id, summary);
    this.emitSubagentIdentity(session, summary);
    return conversationSummary(summary);
  }

  async loadOlderHistory(agent: Agent): Promise<{ hasOlder: boolean }> {
    const session = await this.ensureSession(agent);
    const loadOlderHistory = (session.handle as CodexConversation & {
      loadOlderHistory?: () => Promise<{ hasOlder: boolean }>;
    }).loadOlderHistory;
    if (!loadOlderHistory) throw new Error('The Codex SDK does not support demand-paged conversation history.');
    const page = await loadOlderHistory();
    return { hasOlder: page.hasOlder };
  }

  async listConversations(agent: Agent, input: ConversationListInput = {}): Promise<ConversationSummary[]> {
    const limit = input.limit ?? 100;
    const options = {
      ...agentCwd(agent),
      limit,
      ...(input.searchTerm?.trim() ? { searchTerm: input.searchTerm.trim() } : {}),
    };
    const [active, archived] = await Promise.all([
      this.surface.listConversations(options),
      this.surface.listConversations({ ...options, archived: true }),
    ]);
    const currentThreadId = codexThreadId(agent);
    const conversations = [
      ...active.filter((conversation) => conversation.id === currentThreadId).map((conversation) => ({ conversation, storageState: 'active' as const })),
      ...archived.map((conversation) => ({ conversation, storageState: 'archived' as const })),
    ].sort((left, right) => {
      if (left.storageState !== right.storageState) return left.storageState === 'active' ? -1 : 1;
      return right.conversation.updatedAt.localeCompare(left.conversation.updatedAt);
    });
    for (const { conversation } of conversations) {
      this.conversationSummaries.set(conversation.id, conversation);
      const owner = this.subagentOwners.get(conversation.id);
      const session = owner ? this.sessionsByAgentId.get(owner.agentId) : undefined;
      if (session && session.handle.id === owner?.rootConversationId) {
        this.emitSubagentIdentity(session, conversation);
      }
    }
    return conversations.map(({ conversation, storageState }) => conversationSummary(conversation, storageState));
  }

  async resumeConversation(agent: Agent, target: ConversationResumeTarget) {
    if (target.ref.backend !== 'codex') throw new Error('Codex cannot resume a non-Codex conversation.');
    const threadId = target.ref.threadId;
    const previousThreadId = codexThreadId(agent);
    const targetWasArchived = target.storageState === 'archived';
    if (targetWasArchived) await this.surface.unarchiveConversation(threadId);
    try {
      await this.bindAndLoad(agent, threadId);
      if (previousThreadId && previousThreadId !== threadId) {
        await this.surface.archiveConversation(previousThreadId);
      }
    } catch (error) {
      if (previousThreadId && previousThreadId !== threadId) {
        await this.bindAndLoad(agent, previousThreadId).catch(() => undefined);
      }
      if (targetWasArchived) {
        await this.surface.archiveConversation(threadId).catch(() => undefined);
      }
      throw error;
    }
    return {
      threadId,
    };
  }

  async archiveAgentConversation(agent: Agent): Promise<void> {
    const threadId = codexThreadId(agent);
    if (!threadId) return;
    await this.surface.archiveConversation(threadId);
  }

  async deleteAgentConversation(agent: Agent): Promise<void> {
    const threadId = codexThreadId(agent);
    if (!threadId) return;
    await this.surface.deleteConversation(threadId);
  }

  async reconcileConversations(agents: Agent[]): Promise<void> {
    const retainedThreadIds = new Set(agents.flatMap((agent) => {
      const threadId = codexThreadId(agent);
      const reviewRound = agent.codeReview?.rounds.find((round) => round.id === agent.codeReview?.activeRoundId);
      const reviewThreadId = reviewRound?.reviewerSession?.kind === 'codex'
        ? reviewRound.reviewerSession.threadId
        : undefined;
      return [threadId, reviewThreadId].filter((id): id is string => Boolean(id));
    }));
    const [active, archived] = await Promise.all([
      this.surface.listConversations(),
      this.surface.listConversations({ archived: true }),
    ]);
    for (const conversation of archived) {
      if (retainedThreadIds.has(conversation.id)) {
        await this.surface.unarchiveConversation(conversation.id);
      }
    }
    for (const conversation of active) {
      if (conversation.parentConversationId || retainedThreadIds.has(conversation.id)) continue;
      await this.surface.archiveConversation(conversation.id);
    }
  }

  async forkWorktreeConversation(agent: Agent, targetAgent: Agent) {
    const source = await this.ensureSession(agent);
    const snapshot = source.handle.getSnapshot();
    if (snapshot.busy || snapshot.activeTurnId) {
      // The delegating turn contains an unfinished tool call. Fork only a
      // completed native boundary; never interrupt or replay the parent.
      const boundary = [...snapshot.turns].reverse().find(turn => turn.status === 'completed' && turn.id !== snapshot.activeTurnId);
      if (!boundary) throw new Error('No completed conversation turn is available to continue from.');
      return this.forkConversation(agent, targetAgent, boundary.id);
    }
    return this.forkConversation(agent, targetAgent);
  }

  async forkConversation(agent: Agent, targetAgent: Agent, turnId?: string) {
    const source = await this.ensureSession(agent);
    const defaults = targetAgent.backendDefaults?.kind === 'codex' ? targetAgent.backendDefaults : undefined;
    const preset = effectiveApprovalPreset(codexApprovalPresetFromDefaults(defaults), this.surface.getSnapshot().approvalPresets);
    const options = {
      ...agentCwd(targetAgent),
      ...(preset ? { approvalPreset: preset } : {}),
      ...(defaults?.model ? { model: defaults.model } : {}),
      ...(defaults?.reasoningEffort ? { reasoningEffort: defaults.reasoningEffort } : {}),
      ...(defaults?.serviceTier !== undefined ? { serviceTier: defaults.serviceTier } : {}),
    };
    const result = await (turnId === undefined ? source.handle.fork(
      options,
      { extensionContext: targetAgent },
    ) : source.handle.forkTurn(
      turnId,
      options,
      { extensionContext: targetAgent },
    ));
    this.bindRuntime(targetAgent, result.conversationId, false);
    return {
      threadId: result.conversationId,
      activeTurnId: result.snapshot.activeTurnId,
    };
  }

  async loadConversation(agent: Agent): Promise<string | null> {
    const threadId = codexThreadId(agent);
    if (!threadId) return null;
    const existing = this.sessionsByAgentId.get(agent.id);
    if (existing?.handle.id === threadId) {
      existing.agent = agent;
      const currentSnapshot = existing.handle.getSnapshot();
      if (currentSnapshot.activeTurnId !== null) {
        // This adapter already owns the live session and receives its events in
        // the background. Keep that richer in-memory transcript authoritative
        // instead of replacing it with load's five-turn bootstrap page.
        this.publishConversationSnapshot(existing, currentSnapshot);
        return threadId;
      }
      const hydratedAt = this.historyHydratedAtByAgentId.get(agent.id) ?? 0;
      if (Date.now() - hydratedAt < AGENT_HISTORY_CACHE_TTL_MS) {
        this.publishConversationSnapshot(existing, currentSnapshot);
        return threadId;
      }

      const wasSuppressingEvents = existing.suppressEvents;
      existing.suppressEvents = true;
      try {
        await existing.handle.load({ ...agentCwd(agent), extensionContext: agent });
        this.historyHydratedAtByAgentId.set(agent.id, Date.now());
        const snapshot = existing.handle.getSnapshot();
        // Publish load's full initial page now. Older messages remain behind
        // the SDK's demand-paging cursor until the conversation requests them.
        this.publishInitial(existing, snapshot);
        existing.suppressEvents = wasSuppressingEvents;
      } finally {
        existing.suppressEvents = wasSuppressingEvents;
      }
      return threadId;
    }
    await this.bindAndLoad(agent, threadId);
    this.historyHydratedAtByAgentId.set(agent.id, Date.now());
    return threadId;
  }

  async respondToClientRequest(response: ClientRequestResponse): Promise<void> {
    const { agentId, ...nativeResponse } = response;
    const owners = [...this.approvalOwners, ...this.clientRequestOwners]
      .filter(([key, owner]) => key === JSON.stringify([owner.agent.id, response.id]) && (!agentId || owner.agent.id === agentId));
    if (!agentId && new Set(owners.map(([, owner]) => owner.agent.id)).size > 1) throw new Error('Agent identity is required for this request.');
    const key = agentId ? JSON.stringify([agentId, response.id]) : owners[0]?.[0];
    const approvalOwner = key ? this.approvalOwners.get(key) : undefined;
    if (approvalOwner) {
      const allow = response.payload?.decision !== 'deny' && response.payload?.cancelled !== true;
      const scope = response.payload?.decision === 'allow_conversation' || response.payload?.decision === 'always_allow'
        ? 'session'
        : 'once';
      await invokeCodexConversationBridgeOperation(
        this.surface, approvalOwner.handle.id, 'resolveApproval', [response.id, allow ? 'approve' : 'deny', scope],
      );
      return;
    }
    const requestOwner = key ? this.clientRequestOwners.get(key) : undefined;
    // A message-derived async question can remain pending in the SDK snapshot
    // even if its clientRequest.requested event was missed during transport.
    const projectedOwner = agentId ? this.sessionsByAgentId.get(agentId) : undefined;
    const pendingQuestionOwner = projectedOwner?.handle.getSnapshot().clientRequests.some(
      (request) => request.id === response.id,
    ) ? projectedOwner : undefined;
    const owner = requestOwner ?? pendingQuestionOwner;
    if (owner) {
      await invokeCodexConversationBridgeOperation(
        this.surface, owner.handle.id, 'respondToClientRequest', [nativeResponse],
      );
      return;
    }
    if (agentId) throw new Error(`Agent request '${response.id}' is no longer pending for '${agentId}'.`);
    await this.surface.respondToClientRequest(nativeResponse);
  }

  private emitUsage(observation:ExecutionObservation):void { for(const listener of this.usageListeners) { try { listener(observation); } catch { /* Observation must not change provider execution. */ } } }
  onUsage(listener:(observation:ExecutionObservation)=>void):()=>void { this.usageListeners.add(listener); return ()=>this.usageListeners.delete(listener); }

  onEvent(listener: AdapterListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.resetCreditTokens.clear();
    for (const cancel of this.resetReadCancellations) cancel();
    this.resetReadCancellations.clear();
    this.unsubscribeSurface();
    for (const session of this.sessionsByAgentId.values()) session.unsubscribe();
    this.sessionsByAgentId.clear();
    this.historyHydratedAtByAgentId.clear();
    this.agentIdsByThreadId.clear();
    this.approvalOwners.clear();
    this.clientRequestOwners.clear();
    this.subagentOwners.clear();
    this.conversationSummaries.clear();
    this.lastSubagentIdentityByConversationId.clear();
    this.subagentIdentityLoads.clear();
    this.liveSubagentConversationIds.clear();
    await this.closeSurface();
  }

  private async ensureSession(
    agent: Agent,
    extensionContext: unknown = agent,
  ): Promise<AgentConversation> {
    const existing = this.sessionsByAgentId.get(agent.id);
    const requestedThreadId = codexThreadId(agent);
    if (existing && (!requestedThreadId || existing.handle.id === requestedThreadId)) {
      existing.agent = agent;
      return existing;
    }
    if (existing) this.releaseConversation(agent.id);
    if (requestedThreadId) return this.bindAndLoad(agent, requestedThreadId);

    await this.start();
    const defaults = agent.backendDefaults?.kind === 'codex'
      ? { ...agent.backendDefaults }
      : undefined;
    const requestedPreset = codexApprovalPresetFromDefaults(defaults);
    const effectivePreset = effectiveApprovalPreset(requestedPreset, this.surface.getSnapshot().approvalPresets);
    const snapshot = await this.surface.createConversation({
      ...agentCwd(agent),
      threadSource: 'user',
      ...(effectivePreset ? { approvalPreset: effectivePreset } : {}),
      ...(defaults?.model ? { model: defaults.model } : {}),
      ...(defaults?.reasoningEffort ? { reasoningEffort: defaults.reasoningEffort } : {}),
      ...(defaults?.serviceTier !== undefined ? { serviceTier: defaults.serviceTier } : {}),
    }, { extensionContext });
    const threadId = snapshot.activeConversationId;
    if (!threadId) throw new Error('Codex did not create a conversation.');
    const session = this.bindRuntime(agent, threadId, true, false);
    try {
      if (shouldSyncConversationTitleFromAgent(agent)) {
        await this.renameSessionIfNeeded(session, agentDisplayName(agent));
      }
    } catch {
      // Naming is best effort and must not prevent the first prompt. daemon
      // retries through its normal post-session title synchronization.
    }
    return session;
  }

  private async captureSessionHandoff(session: AgentConversation): Promise<string> {
    const completedBeforeTarget = new Map<string, CodexSurfaceTurnStatus>();
    let targetTurnId: string | null = null;
    let resolveCompletion: ((status: CodexSurfaceTurnStatus) => void) | null = null;
    const completion = new Promise<CodexSurfaceTurnStatus>((resolve) => {
      resolveCompletion = resolve;
    });
    const unsubscribe = session.handle.onEvent((event) => {
      if (event.type !== 'turn.completed') return;
      if (event.turnId === targetTurnId) {
        resolveCompletion?.(event.payload.status);
      } else {
        completedBeforeTarget.set(event.turnId, event.payload.status);
      }
    });
    const wasSuppressingEvents = session.suppressEvents;
    session.suppressEvents = true;

    try {
      const beforeTurnIds = session.handle.getSnapshot().turnIds;
      const started = await session.handle.sendMessage(SESSION_HANDOFF_PROMPT, {
        model: SESSION_HANDOFF_MODEL,
        reasoningEffort: SESSION_HANDOFF_REASONING_EFFORT,
      });
      targetTurnId = resultTurnId(started, beforeTurnIds) ?? null;
      if (!targetTurnId) throw new Error('Codex did not start the session handoff turn.');

      const alreadyCompleted = completedBeforeTarget.get(targetTurnId)
        ?? started.turns.find((turn) => turn.id === targetTurnId && turn.status !== 'inProgress')?.status;
      const status = alreadyCompleted ?? await sessionHandoffCompletion(completion);
      if (status !== 'completed') {
        throw new Error(`Session handoff was ${status}.`);
      }

      const handoff = sessionHandoffText(session.handle.getSnapshot().messages, targetTurnId);
      if (!handoff) throw new Error('The agent returned an empty session handoff.');
      return handoff.slice(0, SESSION_HANDOFF_MAX_CHARACTERS);
    } finally {
      session.suppressEvents = wasSuppressingEvents;
      unsubscribe();
    }
  }

  private async renameSessionIfNeeded(session: AgentConversation, title: string): Promise<void> {
    const name = title.trim();
    const summary = session.handle.getSnapshot().conversations.find(
      (conversation) => conversation.id === session.handle.id,
    );
    if (summary?.title === name) return;
    await invokeCodexConversationBridgeOperation(
      this.surface, session.handle.id, 'renameConversation', [name],
    );
  }

  private async bindAndLoad(
    agent: Agent,
    threadId: string,
  ): Promise<AgentConversation> {
    const existing = this.sessionsByAgentId.get(agent.id);
    if (existing && existing.handle.id === threadId) {
      existing.agent = agent;
      const snapshot = existing.handle.getSnapshot();
      this.publishInitial(existing, snapshot);
      return existing;
    }

    await this.start();
    const requestedServiceTier = agent.backendDefaults?.kind === 'codex'
      ? agent.backendDefaults.serviceTier
      : undefined;
    const session = this.bindRuntime(agent, threadId, false, true);
    try {
      let snapshot = await session.handle.load({ ...agentCwd(agent), extensionContext: agent });
      const interruptedTurnId = snapshot.activeTurnId;
      const resumedActiveGoal = snapshot.goal?.status === 'active';
      if (interruptedTurnId && !resumedActiveGoal) {
        // A newly created App backend has no ownership of an old in-progress
        // turn unless app-server is continuing a persistent goal. Leaving a
        // genuinely orphaned turn active permanently disables the composer
        // after an app restart, so ask app-server to end only that case before
        // exposing the hydrated conversation.
        snapshot = await session.handle.interrupt();
      }
      snapshot = session.handle.getSnapshot();
      this.publishQuickChatConversationTitle(session, snapshot.conversations.find(
        (conversation) => conversation.id === threadId,
      ));
      this.publishInitial(session, snapshot);
      session.suppressEvents = false;

      const requestedPreset = codexApprovalPresetFromDefaults(agent.backendDefaults);
      const effectivePreset = effectiveApprovalPreset(requestedPreset, snapshot.approvalPresets);
      if (effectivePreset && snapshot.approvalPreset !== effectivePreset) {
        await invokeCodexConversationBridgeOperation(
          this.surface, session.handle.id, 'updateConversationSettings', [{ approvalPreset: effectivePreset }],
        );
      }
      if (requestedServiceTier !== undefined && snapshot.selectedServiceTier !== requestedServiceTier) {
        await invokeCodexConversationBridgeOperation(
          this.surface, session.handle.id, 'updateConversationSettings', [{ serviceTier: requestedServiceTier }],
        );
      }
      return session;
    } catch (error) {
      this.releaseConversation(agent.id);
      throw error;
    }
  }

  private bindRuntime(
    agent: Agent,
    threadId: string,
    publishInitial: boolean,
    suppressEvents = false,
  ): AgentConversation {
    const otherAgentId = this.agentIdsByThreadId.get(threadId);
    if (otherAgentId && otherAgentId !== agent.id) this.releaseConversation(otherAgentId);
    this.releaseConversation(agent.id);
    const handle = this.surface.conversation(threadId);
    const session: AgentConversation = {
      agent,
      handle,
      suppressEvents,
      unsubscribe: () => undefined,
    };
    this.sessionsByAgentId.set(agent.id, session);
    this.agentIdsByThreadId.set(threadId, agent.id);
    try {
      session.unsubscribe = subscribeCodexConversationReplicaBridge(this.surface, threadId, (notification) => {
        if (notification.type === 'snapshot') {
          if (!session.suppressEvents) this.publishConversationSnapshot(session, notification.snapshot);
          return;
        }
        this.handleConversationEvent(session, notification.event);
      });
    } catch (error) {
      this.releaseConversation(agent.id);
      throw error;
    }
    if (publishInitial) {
      this.publishInitial(session, handle.getSnapshot(), {
        publishProviderSnapshot: false,
        publishStatus: false,
      });
    }
    return session;
  }

  private publishInitial(
    session: AgentConversation,
    snapshot: CodexConversationSnapshot,
    options: { publishProviderSnapshot?: boolean; publishStatus?: boolean } = {},
  ): void {
    this.emitThread(session, { type: 'agent.conversationAttached', payload: { cwd: conversationCwd(snapshot) } });
    this.emitSettings(
      session,
      snapshot.approvalPreset,
      snapshot.selectedModelId,
      snapshot.selectedReasoningEffort,
      snapshot.selectedServiceTier,
      snapshot.planMode,
    );
    if (snapshot.goal) this.emitThread(session, { type: 'conversation.goalUpdated', payload: { goal: snapshot.goal } });
    if (snapshot.contextUsage) {
      this.emitThread(session, { type: 'conversation.contextUsageUpdated', payload: { contextUsage: snapshot.contextUsage } });
    }
    if (snapshot.turnGitDiff) this.emitDiff(session, snapshot.turnGitDiff);
    if (options.publishStatus !== false) this.emitStatus(session, statusFromSnapshot(snapshot));
    this.rememberPending(session, snapshot);
    if (options.publishProviderSnapshot !== false) this.publishConversationSnapshot(session, snapshot);
  }

  private publishConversationSnapshot(
    session: AgentConversation,
    snapshot: CodexConversationSnapshot,
  ): void {
    if (this.sessionsByAgentId.get(session.agent.id) !== session) return;
    const revision = (this.conversationRevisionsByAgentId.get(session.agent.id) ?? 0) + 1;
    this.conversationRevisionsByAgentId.set(session.agent.id, revision);
    this.emitThread(session, {
      type: 'codex.conversationSnapshotChanged',
      payload: {
        revision,
        snapshot: conversationSnapshotForTransport(snapshot),
      },
    });
  }

  private rememberPending(
    session: AgentConversation,
    snapshot: CodexConversationSnapshot,
  ): void {
    for (const request of snapshot.clientRequests) {
      this.clientRequestOwners.set(JSON.stringify([session.agent.id, request.id]), session);
      this.emitThread(session, { type: 'agentRequest.created', payload: { request: requestFromClientRequest(request, { conversationId: session.handle.id }) } });
    }
    for (const approval of snapshot.approvals) {
      this.approvalOwners.set(JSON.stringify([session.agent.id, approval.id]), session);
      this.emitThread(session, { type: 'agentRequest.created', payload: { request: approvalAgentRequest(approval) } });
    }
  }

  private handleSurfaceEvent(event: CodexSurfaceEvent): void {
    if (event.type === 'authentication.changed') {
      const identity = JSON.stringify(event.payload.authentication.account);
      if (identity !== this.accountIdentity || event.origin === 'notification') {
        this.accountIdentity = identity; ++this.accountRevision;
        this.resetCreditTokens.clear();
        for (const cancel of this.resetReadCancellations) cancel();
        const state = authenticationFromSurface(event.payload.authentication);
        this.emit({ backend: 'codex', type: 'provider.authenticationChanged', payload: { kind: 'codex', connected: Boolean(state.account || !state.requiresOpenaiAuth), state }, occurredAt: event.occurredAt });
      }
    }

    if (event.type === 'conversation.summaryUpserted') {
      this.conversationSummaries.set(event.conversationId, event.payload.summary);
      const rootAgentId = this.agentIdsByThreadId.get(event.conversationId);
      const rootSession = rootAgentId ? this.sessionsByAgentId.get(rootAgentId) : undefined;
      if (rootSession?.handle.id === event.conversationId) {
        this.publishQuickChatConversationTitle(rootSession, event.payload.summary);
      }
      const owner = this.subagentOwners.get(event.conversationId);
      const session = owner ? this.sessionsByAgentId.get(owner.agentId) : undefined;
      if (session && session.handle.id === owner?.rootConversationId) {
        this.emitSubagentIdentity(session, event.payload.summary);
      }
      return;
    }
    if (event.type === 'conversation.summaryRemoved') {
      this.conversationSummaries.delete(event.conversationId);
      this.lastSubagentIdentityByConversationId.delete(event.conversationId);
      return;
    }
    if ('conversationId' in event) {
      const owner = this.subagentOwners.get(event.conversationId);
      if (!owner) return;
      const session = this.sessionsByAgentId.get(owner.agentId);
      if (!session || session.handle.id !== owner.rootConversationId) return;
      if (
        event.origin === 'notification' &&
        event.type !== 'conversation.historyReplaced' &&
        event.type !== 'conversation.historyPrepended'
      ) {
        this.liveSubagentConversationIds.add(event.conversationId);
      }
      this.refreshSubagentIdentity(session, event.conversationId);
      if (event.type === 'subagent.toolCallChanged') {
        this.emitSubagentToolCall(session, event);
      } else if (event.type === 'subagent.activity') {
        this.emitSubagentActivity(session, event);
      } else if (event.type === 'turn.started') {
        this.emitSubagentStatus(session, event.conversationId, 'running', event.occurredAt);
      } else if (event.type === 'turn.completed') {
        this.emitSubagentStatus(
          session,
          event.conversationId,
          subagentStatusFromTurn(event.payload.status),
          event.occurredAt,
          event.payload.error?.message ?? undefined,
        );
      } else if (event.type === 'turn.error' && !event.payload.willRetry) {
        this.emitSubagentStatus(
          session,
          event.conversationId,
          'errored',
          event.occurredAt,
          event.payload.error.message,
        );
      }
      return;
    }
    if (event.type === 'surface.statusChanged') {
      this.emit({ backend: 'codex', type: 'backend.statusChanged', payload: runtimeStatus(this.surface.getSnapshot()), occurredAt: event.occurredAt });
      return;
    }
    if (event.type === 'rateLimits.changed' && event.payload.rateLimits) {
      this.emit({
        backend: 'codex',
        type: 'account.rateLimitsUpdated',
        payload: { rateLimits: event.payload.rateLimits.rateLimits },
        occurredAt: event.occurredAt,
      });
      return;
    }
    if (event.type === 'catalog.skillsChanged' && event.payload.status === 'loaded') {
      this.emit({
        backend: 'codex',
        type: 'skills.changed',
        payload: skillsChangedPayload(event.payload.cwd, event.payload.skills, event.payload.status),
        occurredAt: event.occurredAt,
      });
      return;
    }
    if (event.type === 'remoteControl.statusChanged') {
      this.emit({
        backend: 'codex',
        type: 'remoteControl.statusChanged',
        payload: event.payload.status,
        occurredAt: event.occurredAt,
      });
    }
  }

  private handleConversationEvent(session: AgentConversation, event: CodexConversationEvent): void {
    if (session.suppressEvents) return;
    if (isRendererConversationEvent(event)) this.publishConversationEvent(session, event);
    this.historyHydratedAtByAgentId.set(session.agent.id, Date.now());
    const observationKey='turnId' in event?JSON.stringify([session.handle.id,event.turnId]):null;
    if(event.type==='turn.started' && observationKey && !this.observedTools.has(observationKey)) {
      this.observedTools.set(observationKey,new Set());
      while(this.observedTools.size>256)this.observedTools.delete(this.observedTools.keys().next().value!);
    }
    if((event.type==='tool.started' || event.type==='tool.completed') && observationKey && event.origin!=='lifecycle') {
      const ids=this.observedTools.get(observationKey);
      if(ids) {
        const id=event.payload.toolPart.id;
        if(typeof id!=='string' || id.length>256 || !ids.has(id) && [...this.observedTools.values()].reduce((n,s)=>n+(s?.size??0),0)>=16384)this.observedTools.set(observationKey,null);
        else ids.add(id);
      }
    }
    const observedTools=observationKey && this.observedTools.has(observationKey) ? {model:null,responses:null,toolCalls:this.observedTools.get(observationKey)?.size??null,toolResponses:null,multiToolResponses:null,stream:null}:undefined;
    const consumption=codexExecutionConsumption(event);
    if ((event as {type:string}).type==='conversation.executionUsageChanged' && consumption) {
      const turnId=(event as unknown as {turnId?:string}).turnId;
      if(typeof turnId==='string') this.emitUsage({agentId:session.agent.id,sessionId:session.handle.id,turnId,provider:'codex',phase:'usage',at:Date.parse(event.occurredAt),model:null,...consumption});
    }
    if (event.type === 'turn.error' && !event.payload.willRetry) {
      this.emitUsage({agentId:session.agent.id,sessionId:session.handle.id,turnId:event.turnId,provider:'codex',phase:'failed',at:Date.parse(event.occurredAt),model:null,...(observedTools?{behavior:observedTools}:{})});
      if(observationKey){this.observedTools.delete(observationKey);}
    }
    if (event.type === 'turn.started' || event.type === 'turn.completed') {
      const observation:ExecutionObservation = {agentId:session.agent.id,sessionId:session.handle.id,turnId:event.turnId,provider:'codex',phase:event.type==='turn.started'?'started':event.payload.status==='inProgress'?'started':event.payload.status,at:Date.parse(event.occurredAt),model:null,...consumption,...(event.type==='turn.completed' && event.payload.durationMs!==null ? {durationMs:event.payload.durationMs}:{})};
      if(event.type==='turn.completed' && event.payload.status!=='inProgress') {
        observation.behavior=observedTools;if(observationKey){this.observedTools.delete(observationKey);}
      }
      this.emitUsage(observation);
    }
    const metadata = { occurredAt: event.occurredAt };
    switch (event.type) {
      case 'conversation.summaryUpserted':
      case 'conversation.summaryRemoved':
        return;
      case 'conversation.activityChanged':
        this.emitStatus(session, statusFromSnapshot(session.handle.getSnapshot()), event.occurredAt);
        return;
      case 'conversation.settingsChanged':
        this.emitSettings(
          session,
          event.payload.approvalPreset,
          event.payload.selectedModelId,
          event.payload.selectedReasoningEffort,
          event.payload.selectedServiceTier,
          event.payload.planMode,
          event.occurredAt,
        );
        return;
      case 'conversation.goalChanged':
        if (event.origin === 'action') return;
        this.emitThread(session, event.payload.goal
          ? { type: 'conversation.goalUpdated', turnId: event.turnId, payload: { goal: event.payload.goal }, ...metadata }
          : { type: 'conversation.goalCleared', turnId: event.turnId, payload: {}, ...metadata });
        return;
      case 'conversation.contextUsageChanged':
        if (event.payload.contextUsage) {
          this.emitThread(session, {
            type: 'conversation.contextUsageUpdated', turnId: event.turnId,
            payload: { contextUsage: event.payload.contextUsage }, ...metadata,
          });
        }
        return;
      case 'conversation.skillsChanged':
        if (event.payload.status === 'loaded') {
          this.emitThread(session, {
            type: 'skills.changed',
            payload: skillsChangedPayload(event.payload.cwd, event.payload.skills, event.payload.status),
            ...metadata,
          });
        }
        return;
      case 'conversation.permissionsChanged':
        return;
      case 'conversation.diffUpdated':
        if (event.payload.diff) this.emitDiff(session, event.payload.diff, event.occurredAt);
        return;
      case 'subagent.toolCallChanged': {
        this.emitSubagentToolCall(session, event);
        return;
      }
      case 'subagent.activity': {
        this.emitSubagentActivity(session, event);
        return;
      }
      case 'turn.completed':
        void this.refreshQuickChatConversationTitle(session);
        return;
      case 'file.activity':
        this.emitThread(session, {
          type: 'workspace.fileActivityDetected', turnId: event.turnId,
          payload: { ...event.payload },
          ...metadata,
        });
        return;
      case 'approval.requested':
        this.approvalOwners.set(JSON.stringify([session.agent.id, event.payload.approval.id]), session);
        this.emitThread(session, { type: 'agentRequest.created', turnId: event.turnId, payload: { request: approvalAgentRequest(event.payload.approval) }, ...metadata });
        return;
      case 'approval.resolved':
        this.approvalOwners.delete(JSON.stringify([session.agent.id, event.payload.approval.id]));
        this.emitThread(session, { type: 'agentRequest.resolved', turnId: event.turnId, payload: {
          id: event.payload.approval.id,
          outcome: approvalOutcome(event.payload.decision, event.payload.scope, event.payload.reason),
        }, ...metadata });
        this.emitStatus(session, statusFromSnapshot(session.handle.getSnapshot()), event.occurredAt);
        return;
      case 'clientRequest.requested':
        this.clientRequestOwners.set(JSON.stringify([session.agent.id, event.payload.request.id]), session);
        this.emitThread(session, { type: 'agentRequest.created', turnId: event.turnId, payload: { request: requestFromClientRequest(event.payload.request, { conversationId: session.handle.id, turnId: event.turnId }) }, ...metadata });
        return;
      case 'clientRequest.resolved':
        this.clientRequestOwners.delete(JSON.stringify([session.agent.id, event.payload.request.id]));
        this.emitThread(session, { type: 'agentRequest.resolved', turnId: event.turnId, payload: {
          id: event.payload.request.id,
          outcome: event.payload.response ? agentResponseFromClientResponse(event.payload.response).outcome : approvalOutcome(null, null, event.payload.reason),
        }, ...metadata });
        this.emitStatus(session, statusFromSnapshot(session.handle.getSnapshot()), event.occurredAt);
        return;
      default:
        return;
    }
  }

  private publishConversationEvent(
    session: AgentConversation,
    event: CodexConversationEvent,
  ): void {
    if (this.sessionsByAgentId.get(session.agent.id) !== session) return;
    const revision = (this.conversationRevisionsByAgentId.get(session.agent.id) ?? 0) + 1;
    this.conversationRevisionsByAgentId.set(session.agent.id, revision);
    this.emitThread(session, {
      type: 'codex.conversationEventReceived',
      payload: {
        revision,
        event: structuredClone(event),
      },
    });
  }

  private emitSettings(
    session: AgentConversation,
    preset: ApprovalPreset | null,
    selectedModelId: string | null,
    selectedReasoningEffort: string | null,
    selectedServiceTier: string | null | undefined,
    planMode: boolean,
    occurredAt?: string,
  ): void {
    if (preset || selectedModelId || selectedReasoningEffort || selectedServiceTier !== undefined) {
      this.emitThread(session, {
        type: 'conversation.settingsUpdated',
        payload: {
          settings: {
            ...(preset ? { approvalPreset: preset } : {}),
            ...(selectedModelId ? { model: selectedModelId } : {}),
            ...(selectedReasoningEffort ? { reasoningEffort: selectedReasoningEffort } : {}),
            ...(selectedServiceTier === undefined ? {} : { serviceTier: selectedServiceTier }),
          },
        },
        ...(occurredAt ? { occurredAt } : {}),
      });
    }
    this.emitThread(session, {
      type: 'conversation.modeUpdated',
      payload: { mode: planMode ? 'plan' : 'default' },
      ...(occurredAt ? { occurredAt } : {}),
    });
  }

  private emitDiff(
    session: AgentConversation,
    diff: NonNullable<CodexConversationSnapshot['turnGitDiff']>,
    occurredAt?: string,
  ): void {
    this.emitThread(session, {
      type: 'conversation.turnDiffUpdated', turnId: diff.turnId,
      payload: { addedLines: diff.addedLines, removedLines: diff.removedLines, diff: diff.diff },
      ...(occurredAt ? { occurredAt } : {}),
    });
  }

  private emitStatus(session: AgentConversation, status: AgentStatus, occurredAt?: string): void {
    this.emitThread(session, {
      type: 'agent.statusChanged', payload: status,
      ...(occurredAt ? { occurredAt } : {}),
    });
  }

  private emitSubagentToolCall(
    session: AgentConversation,
    event: Extract<CodexConversationEvent, { type: 'subagent.toolCallChanged' }>,
  ): void {
    const toolCall = event.payload.toolCall;
    const owner = { agentId: session.agent.id, rootConversationId: session.handle.id };
    for (const conversationId of toolCall.receiverConversationIds) {
      this.subagentOwners.set(conversationId, owner);
    }
    const operation: SubagentOperationChange['operation'] = {
      id: toolCall.id,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      lifecycle: event.payload.lifecycle,
      kind: toolCall.tool,
      status: toolCall.status,
      senderConversationId: toolCall.senderConversationId,
      receiverConversationIds: [...toolCall.receiverConversationIds],
      ...(toolCall.prompt ? { prompt: toolCall.prompt } : {}),
      ...(toolCall.model ? { model: toolCall.model } : {}),
      ...(toolCall.reasoningEffort ? { reasoningEffort: toolCall.reasoningEffort } : {}),
      occurredAt: event.occurredAt,
    };
    const agentStates: SubagentOperationChange['agentStates'] = {};
    for (const [conversationId, state] of Object.entries(toolCall.agentStates)) {
      this.subagentOwners.set(conversationId, owner);
      agentStates[conversationId] = {
        status: state.status,
        ...(state.message ? { message: state.message } : {}),
      };
    }
    this.emitThread(session, {
      type: 'subagent.operationChanged',
      turnId: event.turnId,
      payload: {
        rootConversationId: session.handle.id,
        operation,
        agentStates,
      } satisfies SubagentOperationChange,
      occurredAt: event.occurredAt,
    });
    for (const conversationId of new Set([
      ...toolCall.receiverConversationIds,
      ...Object.keys(toolCall.agentStates),
    ])) {
      const summary = this.conversationSummaries.get(conversationId);
      if (summary) this.emitSubagentIdentity(session, summary);
      this.refreshSubagentIdentity(session, conversationId);
    }
  }

  private emitSubagentActivity(
    session: AgentConversation,
    event: Extract<CodexConversationEvent, { type: 'subagent.activity' }>,
  ): void {
    const activity: SubagentActivityChange['activity'] = {
      id: event.payload.activity.id,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      lifecycle: event.payload.lifecycle,
      kind: event.payload.activity.kind,
      conversationId: event.payload.activity.agentConversationId,
      agentPath: event.payload.activity.agentPath,
      occurredAt: event.occurredAt,
    };
    if (activity.conversationId === session.handle.id) return;
    this.subagentOwners.set(activity.conversationId, {
      agentId: session.agent.id,
      rootConversationId: session.handle.id,
    });
    this.emitThread(session, {
      type: 'subagent.activityChanged',
      turnId: event.turnId,
      payload: {
        rootConversationId: session.handle.id,
        parentConversationId: event.conversationId,
        activity,
      } satisfies SubagentActivityChange,
      occurredAt: event.occurredAt,
    });
    const summary = this.conversationSummaries.get(activity.conversationId);
    if (summary) this.emitSubagentIdentity(session, summary);
    this.refreshSubagentIdentity(session, activity.conversationId);
  }

  private refreshSubagentIdentity(session: AgentConversation, conversationId: string): void {
    if (this.lastSubagentIdentityByConversationId.has(conversationId)) return;
    if (this.subagentIdentityLoads.has(conversationId)) return;
    const load = this.surface.readConversationSummary(conversationId).then((summary) => {
      const owner = this.subagentOwners.get(conversationId);
      if (owner?.agentId !== session.agent.id || owner.rootConversationId !== session.handle.id) return;
      this.conversationSummaries.set(summary.id, summary);
      this.emitSubagentIdentity(session, summary);
    }).catch(() => undefined).finally(() => {
      if (this.subagentIdentityLoads.get(conversationId) === load) {
        this.subagentIdentityLoads.delete(conversationId);
      }
    });
    this.subagentIdentityLoads.set(conversationId, load);
  }

  private emitSubagentIdentity(session: AgentConversation, summary: CodexConversationSummary): void {
    if (summary.id === session.handle.id) return;
    if (!summary.agentNickname && !summary.agentRole) return;
    const identityKey = `${summary.agentNickname ?? ''}\u0000${summary.agentRole ?? ''}`;
    if (this.lastSubagentIdentityByConversationId.get(summary.id) === identityKey) return;
    this.lastSubagentIdentityByConversationId.set(summary.id, identityKey);
    this.emitThread(session, {
      type: 'subagent.identityChanged',
      payload: {
        rootConversationId: session.handle.id,
        conversationId: summary.id,
        ...(summary.agentNickname ? { agentNickname: summary.agentNickname } : {}),
        ...(summary.agentRole ? { agentRole: summary.agentRole } : {}),
      } satisfies SubagentIdentityChange,
      occurredAt: summary.updatedAt,
    });
  }

  private publishQuickChatConversationTitle(
    session: AgentConversation,
    summary: CodexConversationSummary | undefined,
  ): void {
    if (!summary || shouldSyncConversationTitleFromAgent(session.agent)) return;
    const conversationTitle = summary.title.trim();
    if (
      !conversationTitle ||
      conversationTitle === summary.id ||
      conversationTitle === session.agent.conversationTitle
    ) return;

    session.agent.conversationTitle = conversationTitle;
    this.emit({
      backend: 'codex',
      agentId: session.agent.id,
      threadId: session.handle.id,
      type: 'agent.updated',
      payload: {
        id: session.agent.id,
        conversationTitle,
      },
      occurredAt: summary.updatedAt,
    });
  }

  private async refreshQuickChatConversationTitle(session: AgentConversation): Promise<void> {
    if (shouldSyncConversationTitleFromAgent(session.agent)) return;
    const summary = await this.surface.readConversationSummary(session.handle.id).catch(() => undefined);
    if (!summary) return;
    this.conversationSummaries.set(summary.id, summary);
    this.publishQuickChatConversationTitle(session, summary);
  }

  private emitSubagentStatus(
    session: AgentConversation,
    conversationId: string,
    status: SubagentStatusChange['status'],
    occurredAt: string,
    statusMessage?: string,
  ): void {
    this.emitThread(session, {
      type: 'subagent.statusChanged',
      payload: {
        rootConversationId: session.handle.id,
        conversationId,
        status,
        ...(statusMessage ? { statusMessage } : {}),
      } satisfies SubagentStatusChange,
      occurredAt,
    });
  }

  private emitThread(
    session: AgentConversation,
    event: ThreadBackendEvent,
  ): void {
    this.emit({
      ...event,
      agentId: session.agent.id,
      backend: 'codex',
      threadId: session.handle.id,
      conversationId: session.handle.id,
    } as BackendEvent);
  }

  private emit(event: BackendEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private removePendingOwners(session: AgentConversation): void {
    for (const [id, owner] of this.approvalOwners) {
      if (owner === session) this.approvalOwners.delete(id);
    }
    for (const [id, owner] of this.clientRequestOwners) {
      if (owner === session) this.clientRequestOwners.delete(id);
    }
  }
}

function epochTimestampToIso(value: bigint): string {
  const numericValue = Number(value);
  const milliseconds = Math.abs(numericValue) < 100_000_000_000 ? numericValue * 1_000 : numericValue;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw new Error('Codex returned an invalid remote-control timestamp.');
  return date.toISOString();
}

function conversationSummary(
  conversation: CodexConversationSummary,
  storageState: ConversationSummary['storageState'] = 'active',
): ConversationSummary {
  return {
    id: conversation.id,
    ...(conversation.sessionId ? { sessionId: conversation.sessionId } : {}),
    ...(conversation.parentConversationId ? { parentConversationId: conversation.parentConversationId } : {}),
    ...(conversation.agentNickname ? { agentNickname: conversation.agentNickname } : {}),
    ...(conversation.agentRole ? { agentRole: conversation.agentRole } : {}),
    title: conversation.title,
    preview: conversation.preview,
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.turnCount,
    storageState,
    ref: { backend: 'codex', threadId: conversation.id },
  };
}

function sessionHandoffText(messages: readonly SurfaceMessage[], turnId: string): string {
  const assistantMessages = messages.filter((message) => (
    message.role === 'assistant' && message.turnId === turnId
  ));
  const finalText = sessionFinalAnswerText(messages, turnId);
  if (finalText) return finalText;
  return assistantMessages.flatMap((message) => message.parts.flatMap((part) => (
    part.type === 'text' ? [part.text] : []
  ))).join('\n').trim();
}

function sessionFinalAnswerText(messages: readonly SurfaceMessage[], turnId: string): string {
  return messages.filter((message) => (
    message.role === 'assistant' && message.turnId === turnId && message.status === 'complete'
  )).flatMap((message) => message.parts.flatMap((part) => (
    part.type === 'text' && part.phase === 'final_answer' ? [part.text] : []
  ))).join('\n').trim();
}

function sessionHandoffPrompt(handoff: string): string {
  return `<context>\n${handoff}\n\nInstruction: Treat this handoff only as background context. Do not respond, acknowledge, summarize, or take any action. Wait for the user's next prompt.\n</context>\n\nSummary of previous activity. Do not respond or take any action. Wait for my next prompt.`;
}

function sessionHandoffCompletion(
  completion: Promise<CodexSurfaceTurnStatus>,
): Promise<CodexSurfaceTurnStatus> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for the agent to prepare the session handoff.'));
    }, SESSION_HANDOFF_TIMEOUT_MS);
    void completion.then(
      (status) => {
        clearTimeout(timeout);
        resolve(status);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function reviewCompletion(completion: Promise<CodexSurfaceTurnStatus>): Promise<CodexSurfaceTurnStatus> {
  return Promise.race([
    completion,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Code review timed out.')), REVIEW_TIMEOUT_MS);
    }),
  ]);
}

function subagentStatusFromTurn(
  status: Extract<CodexConversationEvent, { type: 'turn.completed' }>['payload']['status'],
): SubagentStatusChange['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'interrupted') return 'interrupted';
  if (status === 'failed') return 'errored';
  return 'running';
}

function subagentStatusFromHistory(
  threadStatus: CodexSurfaceThreadStatus | null,
  messages: readonly RendererMessage[],
): SubagentStatusChange['status'] | null {
  if (threadStatus?.type === 'active') return 'running';
  if (threadStatus?.type === 'systemError') return 'errored';
  if (threadStatus?.type !== 'idle') return null;
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  if (assistantMessages.some((message) => message.status === 'error')) return 'errored';
  return assistantMessages.some((message) => message.status === 'complete') ? 'completed' : null;
}

function authenticationFromSurface(
  authentication: CodexSurfaceSnapshot['authentication'],
): CodexAuthentication {
  return {
    account: authentication.account ? { ...authentication.account } : null,
    requiresOpenaiAuth: authentication.requiresOpenaiAuth === true,
    login: {
      status: authentication.login.status,
      error: authentication.login.error,
    },
  };
}

function resultTurnId(
  snapshot: CodexConversationSnapshot,
  beforeTurnIds: readonly string[],
): string | undefined {
  if (snapshot.activeTurnId) return snapshot.activeTurnId;
  const known = new Set(beforeTurnIds);
  return [...snapshot.turnIds].reverse().find((turnId) => !known.has(turnId))
    ?? snapshot.turnIds.at(-1);
}

function surfacePromptOptions(options: SendPromptOptions = {}): SendCodexMessageOptions {
  const backendOptions = options.backendOptions?.kind === 'codex' ? options.backendOptions : undefined;
  return {
    ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(typeof options.planMode === 'boolean' ? { planMode: options.planMode } : {}),
    ...(options.reasoningEffort || backendOptions?.reasoningEffort
      ? { reasoningEffort: options.reasoningEffort ?? backendOptions?.reasoningEffort ?? undefined }
      : {}),
    ...(options.serviceTier !== undefined || backendOptions?.serviceTier !== undefined
      ? { serviceTier: options.serviceTier !== undefined ? options.serviceTier : backendOptions?.serviceTier }
      : {}),
    ...((options.skills?.length ?? 0) > 0 || (backendOptions?.skills?.length ?? 0) > 0
      ? { skills: options.skills?.length ? options.skills : backendOptions?.skills }
      : {}),
  };
}

function codeReviewPromptOptions(agent: Agent): SendCodexMessageOptions | undefined {
  const defaults = agent.backendDefaults?.kind === 'codex' ? agent.backendDefaults : undefined;
  if (!defaults?.model && !defaults?.reasoningEffort) return undefined;
  return {
    ...(defaults.model ? { model: defaults.model } : {}),
    ...(defaults.reasoningEffort ? { reasoningEffort: defaults.reasoningEffort } : {}),
  };
}

function surfaceMessages(
  messages: readonly SurfaceMessage[],
  agentId: string,
  completeStreaming = false,
  omitToolPayloads = false,
): RendererMessage[] {
  return messages.map((message) => ({
    id: message.id,
    agentId,
    ...(message.kind ? { kind: message.kind } : {}),
    role: message.role,
    status: completeStreaming && message.status === 'streaming' ? 'complete' : message.status,
    ...(message.turnId ? { turnId: message.turnId } : {}),
    parts: rendererParts(message.parts, omitToolPayloads),
    createdAt: message.createdAt ?? new Date(0).toISOString(),
  }));
}

function historicalSurfaceMessages(
  messages: readonly SurfaceMessage[],
  agentId: string,
  completeStreaming = false,
): RendererMessage[] {
  return surfaceMessages(messages, agentId, completeStreaming, true);
}

const MAX_TOOL_LABEL_BYTES = 4 * 1024;
const MAX_TOOL_METADATA_BYTES = 32 * 1024;
const MAX_TOOL_STATUS_BYTES = 64 * 1024;

function rendererParts(parts: readonly SurfaceMessagePart[], omitToolPayloads = false): RendererMessagePart[] {
  const generatedImagePaths = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const savedPath = part.metadata?.savedPath;
    if (typeof savedPath === 'string' && path.isAbsolute(savedPath)) {
      generatedImagePaths.set(part.id, savedPath);
    }
  }

  return parts.map((part) => {
    const rendered = rendererPart(part, omitToolPayloads);
    if (
      rendered.type === 'media' &&
      rendered.itemId &&
      rendered.media.url.startsWith('data:image/')
    ) {
      const savedPath = generatedImagePaths.get(rendered.itemId);
      if (savedPath) {
        return {
          ...rendered,
          media: { ...rendered.media, url: pathToFileURL(savedPath).href },
        };
      }
    }
    return rendered;
  });
}

function rendererPart(part: SurfaceMessagePart, omitToolPayloads = false): RendererMessagePart {
  if (part.type === 'tool') return rendererToolPart(part, omitToolPayloads);
  if (part.type === 'attachment') return { type: 'attachment', attachment: { ...part.attachment } };
  return { ...part };
}

function skillsChangedPayload(
  cwd: string | null,
  skills: readonly CodexSurfaceSkill[],
  status: 'loaded',
): { cwd: string | null; skills: BackendSkillSummary[]; status: 'loaded' } {
  return {
    cwd,
    skills: skills.map(backendSkillSummary),
    status,
  };
}

function backendSkillSummary(skill: CodexSurfaceSkill): BackendSkillSummary {
  const { brandColor, defaultPrompt, ...summary } = skill;
  return {
    id: skill.path,
    ...summary,
    ...(typeof brandColor === 'string' && brandColor.trim() ? { brandColor } : {}),
    ...(typeof defaultPrompt === 'string' ? { defaultPrompt } : {}),
  };
}

function rendererToolPart(part: SurfaceMessageToolPart, omitPayloads = false): RendererToolPart {
  const metadata = omitPayloads ? undefined : boundedToolMetadata(part.metadata);
  const input = omitPayloads ? undefined : toolInputProjection(part.input);
  const output = omitPayloads ? undefined : toolOutputProjection(part.output);
  return {
    type: 'tool',
    id: part.id,
    kind: part.kind ?? 'generic',
    title: boundedToolLabel(part.title),
    status: part.status,
    ...(part.statusText ? { statusText: boundedToolStatus(part.statusText, part.status) } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function boundedToolLabel(value: string): string {
  const bytes = Buffer.byteLength(value);
  return bytes <= MAX_TOOL_LABEL_BYTES
    ? value
    : `${value.slice(0, MAX_TOOL_LABEL_BYTES)}…`;
}

function boundedToolStatus(value: string, fallback: SurfaceMessageToolPart['status']): string {
  return Buffer.byteLength(value) <= MAX_TOOL_STATUS_BYTES ? value : fallback;
}

const toolInputPresentationKeys = new Set([
  'app', 'appName', 'branchName', 'bundleIdentifier', 'changes', 'command', 'commandActions',
  'cwd', 'destinationPath', 'direction', 'displayId', 'element_index', 'key', 'kind', 'name', 'path', 'phase', 'pid',
  'query', 'repoPath', 'rootElementIndex', 'scope', 'title', 'to', 'type', 'url', 'x', 'y',
]);

const toolOutputPresentationKeys = new Set([
  'agentName', 'answers', 'app', 'apps', 'externalUrl', 'kind', 'localizedName', 'name', 'path', 'phase', 'prompt',
  'outcome', 'queued', 'recipientName', 'result', 'structuredContent', 'success', 'url',
]);

function toolInputProjection(value: unknown): unknown {
  return boundedStructuredValue(toolPresentationProjection(value, toolInputPresentationKeys));
}

function toolOutputProjection(value: unknown): unknown {
  return boundedStructuredValue(toolPresentationProjection(value, toolOutputPresentationKeys));
}

function toolPresentationProjection(value: unknown, keys: ReadonlySet<string>, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return Buffer.byteLength(value) <= MAX_TOOL_LABEL_BYTES ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) return undefined;
    const projected = value
      .map((entry) => toolPresentationProjection(entry, keys, depth + 1))
      .filter((entry) => entry !== undefined);
    return projected.length > 0 ? projected : undefined;
  }
  if (typeof value !== 'object') return undefined;

  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!keys.has(key)) continue;
    if (key === 'answers') {
      const answers = boundedStructuredValue(entry);
      if (answers !== undefined) projected[key] = answers;
      continue;
    }
    const child = toolPresentationProjection(entry, keys, depth + 1);
    if (child !== undefined) projected[key] = child;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function boundedStructuredValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized) > MAX_TOOL_METADATA_BYTES) return undefined;
    return JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }
}

function boundedToolMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  try {
    if (Buffer.byteLength(JSON.stringify(metadata)) <= MAX_TOOL_METADATA_BYTES) return { ...metadata };
  } catch {
    // Retain only small scalar identity fields below.
  }

  const bounded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      (typeof value === 'string' && Buffer.byteLength(value) <= 4 * 1024)
    ) {
      bounded[key] = value;
    }
  }
  return Object.keys(bounded).length > 0 ? bounded : undefined;
}

function statusFromSnapshot(snapshot: CodexConversationSnapshot): AgentStatus {
  if (snapshot.error) return { type: 'error', message: snapshot.error };
  if (snapshot.threadStatus?.type === 'active') {
    if (snapshot.threadStatus.activeFlags.includes('waitingOnApproval')) {
      return { type: 'awaitingInput', detail: { key: 'backend.awaitingApproval' } };
    }
    if (snapshot.threadStatus.activeFlags.includes('waitingOnUserInput')) {
      return { type: 'awaitingInput', detail: { key: 'backend.awaitingUserInput' } };
    }
  }
  if (snapshot.clientRequests.some((request) => (
    request.kind !== 'ask_user' || request.payload.request.blocking !== false
  )) || snapshot.approvals.length > 0) {
    return { type: 'awaitingInput', detail: { key: 'backend.awaitingUserInput' } };
  }
  return snapshot.busy || snapshot.goal?.status === 'active' ? { type: 'working' } : { type: 'idle' };
}

function runtimeStatus(snapshot: CodexSurfaceSnapshot): BackendRuntimeStatus {
  if (snapshot.status === 'connecting') {
    return { backend: 'codex', status: 'starting', detail: { key: 'backend.codexConnecting' } };
  }
  if (snapshot.status === 'ready') {
    return { backend: 'codex', status: 'running', detail: { key: 'backend.codexConnected' } };
  }
  if (snapshot.status === 'error') {
    return { backend: 'codex', status: 'error', detail: snapshot.error ?? 'Codex app-server failed.' };
  }
  return { backend: 'codex', status: 'notConfigured', detail: { key: 'backend.codexNotConnected' } };
}

function effectiveApprovalPreset(
  requested: ApprovalPreset,
  available: readonly ApprovalPreset[],
): ApprovalPreset | null {
  if (available.includes(requested)) return requested;
  return (['approve-for-me', 'ask-for-approval', 'full-access'] as const)
    .find((preset) => available.includes(preset)) ?? null;
}

function codexThreadId(agent: Agent): string | null {
  return agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : null;
}

function agentCwd(agent: Pick<Agent, 'folder'>): { cwd?: string } {
  const folder = agentFolder(agent);
  return folder ? { cwd: expandHome(folder) } : {};
}

function expandHome(folder: string): string {
  const trimmed = folder.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

function conversationCwd(snapshot: CodexConversationSnapshot): string | undefined {
  return snapshot.conversations.find((conversation) => conversation.id === snapshot.activeConversationId)?.cwd;
}

function conversationSnapshotForTransport(
  snapshot: CodexConversationSnapshot,
): CodexConversationSnapshot {
  return structuredClone({
    ...snapshot,
    conversations: [],
    models: [],
    skills: [],
    plugins: [],
    permissionProfiles: [],
    approvalPresets: [],
  });
}

function isRendererConversationEvent(event: CodexConversationEvent): boolean {
  switch (event.type) {
    case 'conversation.summaryUpserted':
    case 'conversation.summaryRemoved':
    case 'conversation.skillsChanged':
    case 'conversation.permissionsChanged':
    case 'file.activity':
    case 'subagent.toolCallChanged':
    case 'subagent.activity':
    case 'realtime.started':
    case 'realtime.itemAdded':
    case 'realtime.transcriptDelta':
    case 'realtime.transcriptCompleted':
    case 'realtime.audioDelta':
    case 'realtime.sdp':
    case 'realtime.error':
    case 'realtime.closed':
      return false;
    default:
      return true;
  }
}
