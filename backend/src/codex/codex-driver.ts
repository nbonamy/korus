import { clientResponseFromAgentResponse } from '@workspace/core/agent-request';
import type {
  Agent,
  ApprovalPreset,
  BackendCapabilities,
  BackendConversationRef,
  BackendModelOption,
  BackendPluginSummary,
  BackendRuntimeStatus,
  BackendSession,
  BackendSkillSummary, ConversationListInput,
  ConversationResumeTarget,
  ConversationSummary,
  RendererMessage,
  SendPromptOptions,
  CodexAuthentication,
  CodexChatGptLogin,
  DevicePairingSession,
  DevicePairingStatus,
  PairedDevice
} from '@workspace/core/contracts';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { AgentBackendDriver, BackendApprovalPresetResult, BackendCodeReviewInput, BackendConversationForkResult, BackendConversationResumeResult, BackendEvent, BackendGoalResult, BackendSendResult, BackendConversationReplacementResult, BackendTextGenerationInput, BackendTextGenerationResult, BackendTurnActionResult } from '@workspace/core/backend-driver';
import type { CodexSurfaceAgentAdapter } from './codex-surface-adapter';

type CodexPromptCommand = { type: 'review'; prompt: string };

export class CodexBackendDriver implements AgentBackendDriver {
  readonly backend = 'codex' as const;

  constructor(
    private readonly sessionManager: CodexSurfaceAgentAdapter,
  ) {}

  getBankedResets() { return this.sessionManager.getBankedResets(); }
  useBankedReset(input: import('@workspace/core/contracts/banked-resets').UseBankedResetInput) { return this.sessionManager.useBankedReset(input); }

  getRuntimeStatus(): BackendRuntimeStatus {
    return this.sessionManager.getRuntimeStatus();
  }

  getAuthentication(): Promise<CodexAuthentication> {
    return this.sessionManager.getAuthentication();
  }

  async authenticate(request: import('@workspace/core/contracts/provider-setup').ProviderAuthenticationAction): Promise<import('@workspace/core/contracts/provider-setup').ProviderAuthentication> {
    const state = await (request.action === 'logout' ? this.logout()
      : request.action === 'cancel' ? this.cancelChatGptLogin(request.loginId) : this.getAuthentication());
    return { kind: 'codex', connected: request.action !== 'logout' && Boolean(state.account || !state.requiresOpenaiAuth), state };
  }

  startChatGptLogin(): Promise<CodexChatGptLogin> {
    return this.sessionManager.startChatGptLogin();
  }

  startChatGptDeviceCodeLogin() {
    return this.sessionManager.startChatGptDeviceCodeLogin();
  }

  cancelChatGptLogin(loginId?: string): Promise<CodexAuthentication> {
    return this.sessionManager.cancelChatGptLogin(loginId);
  }

  logout(): Promise<CodexAuthentication> {
    return this.sessionManager.logout();
  }

  getCapabilities(agent: Agent): BackendCapabilities {
    return this.sessionManager.getCapabilities?.(agent) ?? codexBackendCapabilities;
  }
  async assertHandoffReady(agent: Agent): Promise<void> {
    await this.sessionManager.assertHandoffReady(agent);
  }

  async generateText(agent: Agent, input: BackendTextGenerationInput): Promise<BackendTextGenerationResult> {
    return this.sessionManager.generateText(agent, input);
  }

  generateImage(_agent: Agent, input: import('@workspace/core/backend-driver').BackendImageGenerationInput, signal?: AbortSignal) {
    return this.sessionManager.generateImage(input, signal);
  }

  async runCodeReview(agent: Agent, input: BackendCodeReviewInput) {
    return this.sessionManager.runCodeReview(agent, input);
  }

  async disposeCodeReview(_agent: Agent, reviewerSession: BackendSession): Promise<void> {
    await this.sessionManager.disposeCodeReview(reviewerSession);
  }

  async replaceConversationWithSummary(agent: Agent): Promise<BackendConversationReplacementResult> {
    const result = await this.sessionManager.replaceConversationWithSummary(agent);
    return { backendSession: codexBackendSession(result.threadId) };
  }

  async listModels(_agent: Agent): Promise<BackendModelOption[]> {
    return this.sessionManager.listModels();
  }

  async listSkills(agent: Agent, forceReload = false): Promise<BackendSkillSummary[]> {
    return this.sessionManager.listSkills(agent, forceReload);
  }

  async listPlugins(_agent: Agent): Promise<BackendPluginSummary[]> {
    return this.sessionManager.listPlugins();
  }

  getRemoteControlStatus(): Promise<DevicePairingStatus> {
    return this.sessionManager.getRemoteControlStatus();
  }

  enableRemoteControl(): Promise<DevicePairingStatus> {
    return this.sessionManager.enableRemoteControl();
  }

  disableRemoteControl(): Promise<DevicePairingStatus> {
    return this.sessionManager.disableRemoteControl();
  }

  startDevicePairing(): Promise<DevicePairingSession> {
    return this.sessionManager.startDevicePairing();
  }

  checkDevicePairing(session: DevicePairingSession): Promise<boolean> {
    return this.sessionManager.checkDevicePairing(session);
  }

  listPairedDevices(environmentId: string): Promise<PairedDevice[]> {
    return this.sessionManager.listPairedDevices(environmentId);
  }

  revokePairedDevice(environmentId: string, clientId: string): Promise<void> {
    return this.sessionManager.revokePairedDevice(environmentId, clientId);
  }

  tryHandlePromptCommand(agent: Agent, prompt: string): Promise<BackendSendResult> | null {
    const command = codexPromptCommand(prompt);
    if (!command) {
      return null;
    }

    return this.runPromptCommand(agent, command);
  }

  preparePromptOptions(_agent: Agent, options?: SendPromptOptions): SendPromptOptions | undefined {
    const skills = options?.skills?.length ? options.skills : options?.backendOptions?.kind === 'codex' ? options.backendOptions.skills : undefined;
    return cleanedPromptOptions({ ...options, ...(skills?.length ? { skills } : {}) });
  }

  async sendPrompt(agent: Agent, prompt: string, options?: SendPromptOptions): Promise<BackendSendResult> {
    const result = await this.sessionManager.sendPrompt(agent, prompt, options);
    return {
      backendSession: codexBackendSession(result.threadId),
      turnId: result.turnId,
      ...(result.messageId ? { messageId: result.messageId } : {}),
    };
  }

  async setConversationTitle(agent: Agent, title: string): Promise<void> {
    await this.sessionManager.setConversationTitle(agent, title);
  }

  async setGoal(agent: Agent, objective: string): Promise<BackendGoalResult> {
    const result = await this.sessionManager.setThreadGoal(agent, objective);
    return {
      backendSession: codexBackendSession(result.threadId),
      goal: result.goal,
    };
  }

  async clearGoal(agent: Agent): Promise<BackendGoalResult> {
    const result = await this.sessionManager.clearThreadGoal(agent);
    return {
      backendSession: codexBackendSession(result.threadId),
      cleared: result.cleared,
    };
  }

  async setApprovalPreset(agent: Agent, preset: ApprovalPreset): Promise<BackendApprovalPresetResult> {
    const result = await this.sessionManager.setApprovalPreset(agent, preset);
    return {
      backendSession: codexBackendSession(result.threadId),
      approvalPreset: result.approvalPreset,
    };
  }

  private async runPromptCommand(agent: Agent, command: CodexPromptCommand): Promise<BackendSendResult> {
    const result = await this.sessionManager.sendPrompt(agent, command.prompt);
    return {
      backendSession: codexBackendSession(result.threadId),
      turnId: result.turnId,
    };
  }

  async steerPrompt(agent: Agent, prompt: string, options?: SendPromptOptions): Promise<BackendSendResult> {
    const result = await this.sessionManager.steerPrompt(agent, prompt, options);
    return {
      backendSession: codexBackendSession(result.threadId),
      turnId: result.turnId,
      ...(result.messageId ? { messageId: result.messageId } : {}),
    };
  }

  async interrupt(agent: Agent, expectedTurnId?: string): Promise<BackendSendResult> {
    const result = await this.sessionManager.interruptTurn(agent, expectedTurnId);
    return {
      backendSession: codexBackendSession(result.threadId),
      turnId: result.turnId,
    };
  }

  releaseConversation(agentId: string): void {
    this.sessionManager.releaseConversation(agentId);
  }

  async deleteTurn(agent: Agent, turnId: string): Promise<BackendTurnActionResult> {
    const result = await this.sessionManager.deleteTurn(agent, turnId);
    return {
      backendSession: codexBackendSession(result.threadId),
      activeTurnId: result.activeTurnId,
    };
  }

  async editTurn(agent: Agent, turnId: string, content: string, options?: Pick<SendPromptOptions, 'content'>): Promise<BackendTurnActionResult> {
    const result = await this.sessionManager.editTurn(agent, turnId, content, options);
    return {
      backendSession: codexBackendSession(result.threadId),
      activeTurnId: result.activeTurnId,
    };
  }

  async retryTurn(agent: Agent, turnId: string): Promise<BackendTurnActionResult> {
    const result = await this.sessionManager.retryTurn(agent, turnId);
    return {
      backendSession: codexBackendSession(result.threadId),
      activeTurnId: result.activeTurnId,
    };
  }

  async continueInterruptedTurn(agent: Agent): Promise<BackendTurnActionResult> {
    const result = await this.sessionManager.continueInterruptedTurn(agent);
    return {
      backendSession: codexBackendSession(result.threadId),
      activeTurnId: result.activeTurnId,
    };
  }

  readConversationContent(agent: Agent, input: import('@workspace/core/contracts/conversation').ConversationContentInput) {
    return this.sessionManager.readConversationContent(agent, input);
  }

  async loadConversation(agent: Agent): Promise<BackendSession | null> {
    const threadId = await this.sessionManager.loadConversation(agent);
    return threadId ? codexBackendSession(threadId) : null;
  }

  loadTurnHistory(agent: Agent, turnId: string): Promise<void> {
    return this.sessionManager.loadTurnHistory(agent, turnId);
  }

  async loadOlderHistory(agent: Agent) {
    return this.sessionManager.loadOlderHistory(agent);
  }

  async readConversationMessages(ref: BackendConversationRef, agentId: string): Promise<RendererMessage[]> {
    if (ref.backend !== 'codex') {
      throw new Error('Codex cannot read non-Codex conversation history.');
    }
    return this.sessionManager.readConversationMessages(ref.threadId, agentId);
  }

  async readConversationSummary(agent: Agent, ref: BackendConversationRef): Promise<ConversationSummary | null> {
    if (ref.backend !== 'codex') return null;
    return this.sessionManager.readConversationSummary(agent, ref.threadId);
  }

  async listConversations(agent: Agent, input?: ConversationListInput): Promise<ConversationSummary[]> {
    return this.sessionManager.listConversations(agent, input);
  }

  async resumeConversation(agent: Agent, target: ConversationResumeTarget): Promise<BackendConversationResumeResult> {
    if (target.ref.backend !== 'codex') {
      throw new Error('Codex cannot resume non-Codex conversation history.');
    }

    const result = await this.sessionManager.resumeConversation(agent, target);
    return {
      backendSession: codexBackendSession(result.threadId),
    };
  }

  async archiveAgentConversation(agent: Agent): Promise<void> {
    await this.sessionManager.archiveAgentConversation(agent);
  }

  async deleteAgentConversation(agent: Agent): Promise<void> {
    await this.sessionManager.deleteAgentConversation(agent);
  }

  async reconcileConversations(agents: Agent[]): Promise<void> {
    await this.sessionManager.reconcileConversations(agents);
  }

  async forkWorktreeConversation(agent: Agent, targetAgent: Agent): Promise<BackendConversationForkResult> {
    const result = await this.sessionManager.forkWorktreeConversation(agent, targetAgent);
    return { backendSession: codexBackendSession(result.threadId), ...(result.activeTurnId ? { activeTurnId: result.activeTurnId } : {}) };
  }

  async forkConversation(agent: Agent, targetAgent: Agent, turnId?: string): Promise<BackendConversationForkResult> {
    const result = turnId === undefined
      ? await this.sessionManager.forkConversation(agent, targetAgent)
      : await this.sessionManager.forkConversation(agent, targetAgent, turnId);
    return {
      backendSession: codexBackendSession(result.threadId),
      ...(result.activeTurnId ? { activeTurnId: result.activeTurnId } : {}),
    };
  }

  async respondToAgentRequest(response: import('@workspace/core/agent-request').AgentRequestResponse): Promise<void> {
    await this.sessionManager.respondToClientRequest({
      ...clientResponseFromAgentResponse(response),
      ...(response.agentId ? { agentId: response.agentId } : {}),
    });
  }

  onUsage(listener: (observation: import('@workspace/core/usage').ExecutionObservation)=>void):()=>void { return this.sessionManager.onUsage(listener); }

  onEvent(listener: (event: BackendEvent) => void): () => void {
    return this.sessionManager.onEvent(listener);
  }

  async close(): Promise<void> {
    await this.sessionManager.close();
  }
}

function cleanedPromptOptions(options: SendPromptOptions): SendPromptOptions | undefined {
  return options.content !== undefined || (options.attachments?.length ?? 0) > 0 || (options.skills?.length ?? 0) > 0 || options.selection || typeof options.planMode === 'boolean' || options.backendOptions || options.delegation
    ? options
    : undefined;
}

function codexBackendSession(threadId: string): Extract<BackendSession, { kind: 'codex' }> {
  return {
    kind: 'codex',
    threadId,
  };
}

function codexPromptCommand(prompt: string): CodexPromptCommand | null {
  const parsed = parseSlashName(prompt);
  if (!parsed) {
    return null;
  }

  if (parsed.name === 'review') {
    return {
      type: 'review',
      prompt,
    };
  }

  return null;
}

function parseSlashName(value: string): { name: string; rest: string } | null {
  if (!value.startsWith('/')) {
    return null;
  }

  const stripped = value.slice(1);
  const whitespaceIndex = stripped.search(/\s/);
  const name = whitespaceIndex === -1 ? stripped : stripped.slice(0, whitespaceIndex);
  if (!name || name.includes('/')) {
    return null;
  }

  const rest = whitespaceIndex === -1 ? '' : stripped.slice(whitespaceIndex).trim();
  return { name, rest };
}
