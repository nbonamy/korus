import { defaultHarnessProvider, defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import { isProviderSafetyReviewTarget } from '@workspace/core/provider-safety-block';
import { randomUUID } from 'node:crypto';
import type { PendingConversationPrompt } from '@workspace/core/pending-conversation-prompt';
import { utilityMcpServers } from './diagram-icons/utility-mcp';
import { utilityImageAttachments } from './agents/utility-image-attachments';
import { handOffConversation } from './agents/conversation-handoff';
import { sessionHandoff } from './agents/prompts';
import { createProviderDriver } from './harness-drivers';
import type { ExecutionObservation, RequestObservation } from '@workspace/core/usage';
import { assertPromptSession, requireExpectedSessionId, requirePromptText } from './prompt-input';
import { product } from '@workspace/core/product';
import { isUseBankedResetInput } from '@workspace/core/contracts/banked-resets';
import { isHarnessProvider } from '@workspace/core/contracts/shared';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { expandMissionCommand } from './agents/mission-command';
import { expandWorktreeDelegationCommand } from './agents/worktree-delegation';
import { handoffInProgress } from '@workspace/core/agent-handoff';
import { isAgentRequestResponse } from '@workspace/core/agent-request';
import type { AgentProviderDriver, BackendEvent, ProviderSendResult } from '@workspace/core/provider-driver';
import { resolveProviderCoordinationPolicy, unsupportedProviderFeature, utilityTaskComplexities, type UtilityTaskComplexity } from '@workspace/core/provider-driver';
import type { Agent, HarnessProvider, AppGeneralSettings, AppPluginSettings, ProviderSessionData, ConversationListInput, ConversationResumeTarget, CreateSourceWorktreeInput, DevicePairingSession, SendPromptOptions } from '@workspace/core/contracts';
import { stat } from 'node:fs/promises';
import { listAgentFolderFiles, previewAgentFolderFile, readAgentFolderFileChunk } from './agent-files';
import { listAgentDirectory } from './agent-directory';
import { traceCodexDiagnostic } from './codex/diagnostics';
import { codexConversationDefaults } from './codex/codex-model-defaults';
import { resolveCodexLaunch } from './codex/codex-command';
import { listSourceBranches, listSourceWorktrees, suggestedSourceWorktreePath } from './git-worktrees';
import { WorktreeManager } from './worktrees/worktree-manager';
import { buildAppMcpConfigOverrides } from './mcp/codex-config';
import { backendCodexHomeDir } from './state';
import { listSourceFolders } from './source-folders';
import { detectSourceFolder, scanSourceRepositories } from './source-repositories';
import { cloneSourceRepository } from './clone-source-repository';
import { createSourceRepository } from './create-source-repository';
import { filterRequiredModels, type Requirements } from './requirements';
import { harnessProviders } from '@korus-dev/multi-agent-sdk/contracts';

export type ProviderDriverRegistryOptions = {
  appMcpServerUrl?: string | null;
  hostedMcpServerUrls?: () => Readonly<Record<string, string>>;
  generalSettings?: AppGeneralSettings;
  getGeneralSettings?: () => AppGeneralSettings;
  pluginSettings?: () => AppPluginSettings;
  celebrationsEnabled?: () => boolean;
  additionalDeveloperInstructions?: (agent: Agent) => string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

export function createDefaultProviderDrivers(options: ProviderDriverRegistryOptions = {}): Map<HarnessProvider, AgentProviderDriver> {
  // Retain hosts for saved history and cleanup even when their new-work release gate is off.
  return new Map(harnessProviders.map(provider => [provider, createProviderDriver(provider, options)]));
}

export { createProviderDriver };

export class ProviderDriverRpc {
  private readonly pendingPrompts = new Map<string, PendingConversationPrompt[]>();
  private closing = false;

  private async presentPrompt<T>(agent: Agent, prompt: string, send: () => Promise<T>, options?: SendPromptOptions): Promise<T> {
    if (options?.recordUserMessage === false || !prompt.trim()) return send();
    const pending: PendingConversationPrompt = { id: `pending-prompt-${randomUUID()}`, text: prompt, createdAt: new Date().toISOString() };
    const entries = [...(this.pendingPrompts.get(agent.id) ?? []), pending];
    this.pendingPrompts.set(agent.id, entries);
    this.emit({ type: 'agent.updated', agentId: agent.id, payload: { id: agent.id, pendingPrompts: entries } });
    try { return await send(); }
    finally {
      const remaining = (this.pendingPrompts.get(agent.id) ?? []).filter(entry => entry.id !== pending.id);
      if (remaining.length) this.pendingPrompts.set(agent.id, remaining); else this.pendingPrompts.delete(agent.id);
      if (!this.closing) this.emit({ type: 'agent.updated', agentId: agent.id, payload: { id: agent.id, pendingPrompts: remaining } });
    }
  }
  private readonly textGenerations = new Map<string, { controller: AbortController; done: Promise<void>; finish: () => void }>();
  private readonly requestUsageListeners = new Set<(observation: RequestObservation) => void>();
  private readonly unsubscribeRequestUsage = new Map<HarnessProvider, () => void>();
  private readonly usageListeners = new Set<(observation: ExecutionObservation) => void>();
  private readonly unsubscribeUsage = new Map<HarnessProvider, () => void>();
  private bindUsage(provider: HarnessProvider, driver: AgentProviderDriver): void {
    this.unsubscribeRequestUsage.get(provider)?.();
    this.unsubscribeRequestUsage.delete(provider);
    if (driver.onRequestUsage) this.unsubscribeRequestUsage.set(provider, driver.onRequestUsage(observation => {
      for (const listener of this.requestUsageListeners) {
        try { listener(observation); } catch { /* Observer isolation. */ }
      }
    }));
    this.unsubscribeUsage.get(provider)?.();
    this.unsubscribeUsage.delete(provider);
    if (driver.onUsage) this.unsubscribeUsage.set(provider, driver.onUsage(observation => {
      for (const listener of this.usageListeners) {
        try { listener(observation); } catch { /* Observer isolation. */ }
      }
    }));
  }
  onRequestUsage(listener: (observation: RequestObservation) => void): () => void {
    this.requestUsageListeners.add(listener);
    return () => this.requestUsageListeners.delete(listener);
  }
  onUsage(listener: (observation: ExecutionObservation) => void): () => void {
    this.usageListeners.add(listener);
    return () => this.usageListeners.delete(listener);
  }
  private readonly inFlight = new Map<HarnessProvider, number>();
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly unsubscribeDriverEvents = new Map<HarnessProvider, () => void>();

  constructor(
    private readonly drivers: Map<HarnessProvider, AgentProviderDriver>,
    private readonly worktreeManager = new WorktreeManager(),
    private readonly ensureConnected?: (provider: HarnessProvider) => Promise<unknown>,
    private readonly blocked: (provider: HarnessProvider) => boolean = () => false,
    private readonly requirements: Requirements = {},
  ) {
    for (const [provider, driver] of drivers) { this.bindUsage(provider,driver); this.unsubscribeDriverEvents.set(provider, driver.onEvent((event) => this.emit(event))); }
  }

  async replaceDriver(provider: HarnessProvider, create: () => AgentProviderDriver, maintenance?: () => Promise<void>): Promise<void> {
    this.unsubscribeDriverEvents.get(provider)?.();
    await this.drivers.get(provider)?.close();
    try { await maintenance?.(); }
    finally {
      const driver = create();
      this.drivers.set(provider, driver);
      this.bindUsage(provider,driver);
      this.unsubscribeDriverEvents.set(provider, driver.onEvent(event => this.emit(event)));
    }
  }

  isBusy(provider: HarnessProvider): boolean { return (this.inFlight.get(provider) ?? 0) > 0; }

  getCapabilities(agent: Agent) { return this.requireDriver(agent.provider).getCapabilities(agent); }
  providers(): HarnessProvider[] { return [...this.drivers.keys()]; }
  getCoordinationPolicy(provider: HarnessProvider) { return resolveProviderCoordinationPolicy(this.drivers.get(provider)?.coordinationPolicy); }

  async refreshConversationContext(agent: Agent): Promise<void> {
    const driver = this.requireDriver(agent.provider);
    if (!agent.providerSession || !driver.releaseConversation || !driver.loadConversation) return;
    await driver.releaseConversation(agent.id);
    await driver.loadConversation(agent);
  }

  private async requireNewWork(provider: HarnessProvider): Promise<void> {
    await this.ensureConnected?.(provider);
  }

  async handle(method: string, params: unknown, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    const record = isRecord(params) ? params : {};
    const candidate = record.provider ?? (isRecord(record.agent) ? record.agent.provider : undefined);
    const provider = isHarnessProvider(candidate) ? candidate : undefined;
    if (provider) {
      if (method !== backendMethods.driverTextCancel && this.blocked(provider)) throw new Error('Provider upgrade is in progress. Try again when it finishes.');
      this.inFlight.set(provider, (this.inFlight.get(provider) ?? 0) + 1);
    }
    try { return await this.dispatch(method, params, options.signal); }
    finally { if (provider) this.inFlight.set(provider, (this.inFlight.get(provider) ?? 1) - 1); }
  }

  private async dispatch(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    switch (method) {
      case backendMethods.driverProviderAuthentication: {
        const record = requireRecord(params);
        const backend = requireProvider(record.provider);
        const driver = this.requireDriver(backend);
        if (!driver.authenticate) throw new Error(`Authentication is unavailable for ${backend}.`);
        const action = record.action as import('@workspace/core/contracts/provider-setup').ProviderAuthenticationAction['action'];
        if (!this.getCoordinationPolicy(backend).authentication.actions.includes(action)) throw new Error('Invalid authentication action.');
        if (record.method !== undefined && record.method !== 'browser' && record.method !== 'deviceCode') throw new Error('Invalid authentication method.');
        return driver.authenticate({
          action,
          ...(record.method === undefined ? {} : { method: record.method }),
          ...(record.loginId === undefined ? {} : { loginId: requireString(record.loginId, 'loginId') }),
        });
      }
      case backendMethods.driverBankedResetsGet: {
        const driver = this.requireDriver(this.bankedResetsProvider());
        return driver.getBankedResets ? driver.getBankedResets() : { status: 'unsupported' };
      }
      case backendMethods.driverBankedResetUse: {
        const input = requireRecord(params).input;
        if (!isUseBankedResetInput(input)) throw new Error('Reset confirmation is required');
        const driver = this.requireDriver(this.bankedResetsProvider());
        if (!driver.useBankedReset) throw new Error('Reset redemption is unsupported');
        return driver.useBankedReset(input);
      }
      case backendMethods.driverAccountRateLimitsGet: {
        const driver = this.requireDriver(requireProvider(requireRecord(params).provider));
        return driver.getAccountRateLimits ? { supported: true, rateLimits: await driver.getAccountRateLimits() } : { supported: false };
      }
      case backendMethods.workspaceFilesList: {
        const record = requireRecord(params);
        return listAgentFolderFiles(requireString(record.folder, 'folder'));
      }
      case backendMethods.workspaceDirectoryList: {
        const record = requireRecord(params);
        return listAgentDirectory(requireString(record.folder, 'folder'), record.input === undefined ? {} : requireRecord(record.input));
      }
      case backendMethods.remoteControlStatusGet:
        return this.remoteControlOperation(params, 'getRemoteControlStatus')();
      case backendMethods.remoteControlEnable:
        return this.remoteControlOperation(params, 'enableRemoteControl')();
      case backendMethods.remoteControlDisable:
        return this.remoteControlOperation(params, 'disableRemoteControl')();
      case backendMethods.remoteControlPairingStart:
        return this.remoteControlOperation(params, 'startDevicePairing')();
      case backendMethods.remoteControlPairingCheck: {
        const record = requireRecord(params);
        return this.remoteControlOperation(params, 'checkDevicePairing')(record.session as DevicePairingSession);
      }
      case backendMethods.remoteControlClientsList: {
        const record = requireRecord(params);
        return this.remoteControlOperation(params, 'listPairedDevices')(requireString(record.environmentId, 'environmentId'));
      }
      case backendMethods.remoteControlClientRevoke: {
        const record = requireRecord(params);
        await this.remoteControlOperation(params, 'revokePairedDevice')(
          requireString(record.environmentId, 'environmentId'),
          requireString(record.clientId, 'clientId'),
        );
        return null;
      }
      case backendMethods.workspaceFilePreview: {
        const record = requireRecord(params);
        return previewAgentFolderFile(
          record.folder === undefined ? undefined : requireString(record.folder, 'folder'),
          requireString(record.filePath, 'filePath'),
        );
      }
      case backendMethods.workspaceFileChunkRead: {
        const record = requireRecord(params);
        return readAgentFolderFileChunk(
          record.folder === undefined ? undefined : requireString(record.folder, 'folder'),
          requireString(record.filePath, 'filePath'),
          typeof record.offset === 'number' ? record.offset : NaN,
        );
      }
      case backendMethods.workspaceFolderValidate: {
        const record = requireRecord(params);
        const folderStat = await stat(requireString(record.folder, 'folder').trim());
        if (!folderStat.isDirectory()) {
          throw new Error('Agent folder must be a directory.');
        }
        return null;
      }
      case backendMethods.driverTextCancel: {
        const { agent } = requireAgentParams(params);
        const generationId = requireString(requireRecord(params).generationId, 'generationId');
        const job = this.textGenerations.get(JSON.stringify([agent.id, generationId]));
        if (job) { job.controller.abort(new Error('Generation cancelled.')); await job.done; }
        return null;
      }
      case backendMethods.driverTextGenerate: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const generationId = record.generationId === undefined ? undefined : requireString(record.generationId, 'generationId');
        const key = JSON.stringify([agent.id, generationId]);
        if (generationId && this.textGenerations.has(key)) throw new Error('Generation is already running.');
        let finish!: () => void;
        const controller = new AbortController();
        const job = { controller, done: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish() };
        if (generationId) this.textGenerations.set(key, job);
        try {
          await this.requireNewWork(agent.provider);
          const driver = this.requireDriver(agent.provider);
          if (!driver.generateText) throw unsupportedProviderFeature(agent, 'ephemeral text generation');
          if (record.complexity !== undefined && !utilityTaskComplexities.includes(record.complexity as UtilityTaskComplexity)) throw new Error('Invalid utility task complexity.');
          if (record.timeoutMs !== undefined && record.timeoutMs !== null) throw new Error('Invalid utility timeout.');
          controller.signal.throwIfAborted();
          const input = {
            ...(record.timeoutMs === null ? { timeoutMs: null } : {}),
            prompt: requireString(record.prompt, 'prompt'),
            cwd: requireString(record.cwd, 'cwd'),
            ...(record.complexity !== undefined ? { complexity: record.complexity as UtilityTaskComplexity } : {}),
            ...(record.mcpServers !== undefined ? {mcpServers: utilityMcpServers(record.mcpServers)} : {}),
            ...(record.attachments !== undefined ? {attachments:await utilityImageAttachments(record.attachments)} : {}),
            ...(typeof record.developerInstructions === 'string' ? { developerInstructions: record.developerInstructions } : {}),
            ...(record.outputSchema !== undefined ? { outputSchema: record.outputSchema as never } : {}),
          };
          controller.signal.throwIfAborted();
          const result = await driver.generateText(agent, { ...input, ...(generationId ? { signal: controller.signal } : {}) });
          controller.signal.throwIfAborted();
          return result;
        } finally { if (generationId) this.textGenerations.delete(key); job.finish(); }
      }
      case backendMethods.driverImageGenerate: {
        const { agent } = requireAgentParams(params);
        if (!defaultProviderCapabilities(agent.provider).imageGeneration) throw unsupportedProviderFeature(agent, 'image generation');
        await this.requireNewWork(agent.provider);
        const driver = this.requireDriver(agent.provider);
        if (!driver.generateImage) throw unsupportedProviderFeature(agent, 'image generation');
        const record = requireRecord(params);
        return driver.generateImage(agent, { prompt: requireString(record.prompt, 'prompt'), cwd: requireString(record.cwd, 'cwd') }, signal);
      }
      case backendMethods.driverCodeReviewRun: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.provider);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.runCodeReview || !driver.getCapabilities(agent).codeReview) {
          throw unsupportedProviderFeature(agent, 'code review');
        }
        const input = {
          prompt: requireString(record.prompt, 'prompt'),
          cwd: requireString(record.cwd, 'cwd'),
          reviewMcpServerUrl: requireString(record.reviewMcpServerUrl, 'reviewMcpServerUrl'),
          ...(record.reviewerSession ? { reviewerSession: record.reviewerSession as ProviderSessionData } : {}),
        };
        return this.presentPrompt(agent, input.prompt, () => driver.runCodeReview!(agent, input));
      }
      case backendMethods.driverCodeReviewDispose: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.disposeCodeReview) throw unsupportedProviderFeature(agent, 'code review cleanup');
        await driver.disposeCodeReview(agent, record.reviewerSession as ProviderSessionData);
        return null;
      }
      case backendMethods.driverPromptCommandHandle: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        return this.tryHandlePromptCommand(agent, requireString(record.prompt, 'prompt'));
      }
      case backendMethods.driverPromptSend: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.provider);
        const record = requireRecord(params);
        assertPromptSession(agent, requireExpectedSessionId(record));
        const rawPrompt = requirePromptText(record.prompt, record.options as SendPromptOptions | undefined);
        const prompt = record.plainText === true ? rawPrompt : expandWorktreeDelegationCommand(rawPrompt, (record.options as SendPromptOptions | undefined)?.delegation) ?? expandMissionCommand(rawPrompt) ?? rawPrompt;
        const driver = this.requireDriver(agent.provider);
        const options = record.options as SendPromptOptions | undefined;
        return this.presentPrompt(agent, prompt, () => driver.sendPrompt(agent, prompt, options), options);
      }
      case backendMethods.driverConversationReplaceWithSummary: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.provider);
        const driver = this.requireDriver(agent.provider);
        if (!driver.executeScopedPrompt || driver.getCapabilities(agent).scopedExecution !== true) throw unsupportedProviderFeature(agent, 'session compression');
        const current = await driver.loadConversation?.(agent);
        if (current === undefined || current === null) throw new Error('Context must be idle before compressing its session.');
        // Compressing is a handoff from this harness to itself: a fresh conversation for the same agent, seeded with a summary.
        const source = agent.providerSession ? agent : { ...agent, providerSession: current };
        const { providerSession } = await handOffConversation({ from: { driver, agent: source }, to: { driver, agent: { ...agent, providerSession: undefined } }, prompts: sessionHandoff, archiveSource: true });
        return { providerSession };
      }
      case backendMethods.driverConversationTitleUpdate: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.setConversationTitle) {
          throw unsupportedProviderFeature(agent, 'conversation titles');
        }
        await driver.setConversationTitle(agent, requireString(record.title, 'title'));
        return null;
      }
      case backendMethods.driverGoalUpdate: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.setGoal) {
          throw unsupportedProviderFeature(agent, 'goals');
        }
        return driver.setGoal(agent, requireString(record.objective, 'objective'));
      }
      case backendMethods.driverGoalClear: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.clearGoal) {
          throw unsupportedProviderFeature(agent, 'goals');
        }
        return driver.clearGoal(agent);
      }
      case backendMethods.driverApprovalPresetUpdate: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.setApprovalPreset) {
          throw unsupportedProviderFeature(agent, 'approval presets');
        }
        return driver.setApprovalPreset(agent, record.preset as never);
      }
      case backendMethods.driverPermissionModeUpdate: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.setPermissionMode) {
          throw unsupportedProviderFeature(agent, 'permission modes');
        }
        const mode = requireString(record.mode, 'mode');
        const supportedModes = driver.getCapabilities(agent).permissionModes ?? [];
        if (!supportedModes.some((option) => option.id === mode)) {
          throw new Error(`Unsupported permission mode for ${agent.provider}: ${mode}`);
        }
        return driver.setPermissionMode(agent, mode);
      }
      case backendMethods.driverConversationRelease: {
        const { provider: backend, agentId } = requireProviderAgentIdParams(params);
        await this.requireDriver(backend).releaseConversation?.(agentId);
        return null;
      }
      case backendMethods.driverHandoffCheck: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.assertHandoffReady) throw unsupportedProviderFeature(agent, 'handoff readiness checks');
        await driver.assertHandoffReady(agent);
        return null;
      }
      case backendMethods.driverConversationArchive: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.provider);
        // Every driver has the operation; whether its harness archives is a capability.
        if (!driver.archiveAgentConversation || !driver.getCapabilities(agent).conversationArchive) return { supported: false };
        await driver.archiveAgentConversation(agent);
        return { supported: true };
      }
      case backendMethods.driverConversationDelete: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.deleteAgentConversation || !driver.getCapabilities(agent).conversationDelete) return { supported: false };
        await driver.deleteAgentConversation(agent);
        return { supported: true };
      }
      case backendMethods.driverConversationsReconcile: {
        const record = requireRecord(params);
        const provider = requireProvider(record.provider);
        const agents = Array.isArray(record.agents) ? record.agents.map((agent) => requireAgent(agent, 'agent')) : [];
        await this.requireDriver(provider).reconcileConversations?.(agents);
        return null;
      }
      case backendMethods.driverInterrupt: {
        const { agent } = requireAgentParams(params);
        const expectedTurnId = requireRecord(params).expectedTurnId;
        return expectedTurnId === undefined
          ? this.requireDriver(agent.provider).interrupt(agent)
          : this.requireDriver(agent.provider).interrupt(agent, requireString(expectedTurnId, 'expectedTurnId'));
      }
      case backendMethods.driverAgentRequestRespond: {
        const record = requireRecord(params);
        const provider = requireProvider(record.provider);
        if (!isAgentRequestResponse(record.response)) throw new Error('Invalid agent request response.');
        await this.requireDriver(provider).respondToAgentRequest(record.response);
        return null;
      }
      case backendMethods.driverConversationLoad: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.loadConversation) throw unsupportedProviderFeature(agent, 'conversation loading');
        return driver.loadConversation(agent);
      }
      case backendMethods.driverConversationTurnHistoryLoad: {
        const { agent } = requireAgentParams(params);
        const turnId = requireString(requireRecord(params).turnId, 'turnId');
        const driver = this.requireDriver(agent.provider);
        if (!driver.loadTurnHistory) throw unsupportedProviderFeature(agent, 'turn history');
        await driver.loadTurnHistory(agent, turnId);
        return null;
      }
      case backendMethods.driverConversationHistoryLoadOlder: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.loadOlderHistory) {
          throw unsupportedProviderFeature(agent, 'demand-paged conversation history');
        }
        return driver.loadOlderHistory(agent);
      }
      case backendMethods.driverConversationContentRead: {
        const { agent } = requireAgentParams(params);
        const input = requireRecord(requireRecord(params).input);
        if (typeof input.sessionId !== 'string' || typeof input.contentId !== 'string' || !Number.isSafeInteger(input.offset) || (input.offset as number) < 0) throw new Error('Invalid conversation content request.');
        const driver = this.requireDriver(agent.provider);
        if (!driver.readConversationContent) throw unsupportedProviderFeature(agent, 'conversation content');
        return driver.readConversationContent(agent, { sessionId: input.sessionId, contentId: input.contentId, offset: input.offset as number });
      }
      case backendMethods.driverConversationsList: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.listConversations) throw unsupportedProviderFeature(agent, 'conversation listing');
        return driver.listConversations(agent, record.input as ConversationListInput | undefined);
      }
      case backendMethods.driverConversationResume: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.resumeConversation) {
          throw unsupportedProviderFeature(agent, 'conversation resume');
        }
        return driver.resumeConversation(agent, record.target as ConversationResumeTarget);
      }
      case backendMethods.driverWorktreeConversationFork: {
        const { agent } = requireAgentParams(params);
        const targetAgent = requireAgent(requireRecord(params).targetAgent, 'targetAgent');
        if (agent.provider !== targetAgent.provider) throw new Error('Native worktree forks require the same provider.');
        const driver = this.requireDriver(agent.provider);
        return driver.forkWorktreeConversation ? driver.forkWorktreeConversation(agent, targetAgent) : null;
      }
      case backendMethods.driverConversationFork: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const targetAgent = requireAgent(record.targetAgent, 'targetAgent');
        const turnId = record.turnId === undefined ? undefined : requireString(record.turnId, 'turnId');
        const driver = this.requireDriver(agent.provider);
        if (!driver.forkConversation) {
          throw unsupportedProviderFeature(agent, 'conversation fork');
        }
        return turnId === undefined
          ? driver.forkConversation(agent, targetAgent)
          : driver.forkConversation(agent, targetAgent, turnId);
      }
      case backendMethods.driverConversationMessagesGet: {
        const record = requireRecord(params);
        const ref = requireRecord(record.ref);
        const provider = requireProvider(ref.provider);
        const driver = this.requireDriver(provider);
        if (!driver.readConversationMessages) {
          throw new Error(`${provider} does not support reading conversation messages.`);
        }
        return driver.readConversationMessages(record.ref as never, requireString(record.agentId, 'agentId'));
      }
      case backendMethods.driverConversationSummaryGet: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.readConversationSummary) throw unsupportedProviderFeature(agent, 'conversation summaries');
        return driver.readConversationSummary(agent, record.ref as never);
      }
      case backendMethods.driverPromptSteer: {
        const { agent } = requireAgentParams(params);
        if (handoffInProgress(agent)) throw new Error('Wait for the handoff to finish.');
        const driver = this.requireDriver(agent.provider);
        if (!driver.steerPrompt || driver.getCapabilities(agent).steerPrompt === false) {
          throw unsupportedProviderFeature(agent, 'prompt steering');
        }
        await this.requireNewWork(agent.provider);
        const record = requireRecord(params);
        assertPromptSession(agent, requireExpectedSessionId(record));
        const rawPrompt = requirePromptText(record.prompt, record.options as SendPromptOptions | undefined);
        const prompt = record.plainText === true ? rawPrompt : expandWorktreeDelegationCommand(rawPrompt, (record.options as SendPromptOptions | undefined)?.delegation) ?? expandMissionCommand(rawPrompt) ?? rawPrompt;
        const options = record.options as SendPromptOptions | undefined;
        return options
          ? driver.steerPrompt(agent, prompt, options)
          : driver.steerPrompt(agent, prompt);
      }
      case backendMethods.driverTurnDelete: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.deleteTurn) {
          throw unsupportedProviderFeature(agent, 'turn deletion');
        }
        return driver.deleteTurn(agent, requireString(record.turnId, 'turnId'));
      }
      case backendMethods.driverTurnEdit: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.provider);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.editTurn) {
          throw unsupportedProviderFeature(agent, 'turn editing');
        }
        const turnId = requireString(record.turnId, 'turnId');
        const content = requireString(record.content, 'content');
        return record.options ? driver.editTurn(agent, turnId, content, record.options as Pick<SendPromptOptions, 'content'>) : driver.editTurn(agent, turnId, content);
      }
      case backendMethods.driverTurnRetry: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.provider);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.retryTurn) {
          throw unsupportedProviderFeature(agent, 'turn retry');
        }
        return driver.retryTurn(agent, requireString(record.turnId, 'turnId'));
      }
      case backendMethods.driverTurnContinueInterrupted: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.provider);
        const driver = this.requireDriver(agent.provider);
        if (!driver.continueInterruptedTurn) {
          throw unsupportedProviderFeature(agent, 'interrupted turn continuation');
        }
        const review = requireRecord(params).safetyReview;
        if (review !== undefined && (!isProviderSafetyReviewTarget(review) || !defaultProviderCapabilities(agent.provider).safetyReview)) throw new Error('Invalid provider safety review.');
        return review === undefined ? driver.continueInterruptedTurn(agent) : driver.continueInterruptedTurn(agent, review);
      }
      case backendMethods.driverModelsList: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.provider);
        return filterRequiredModels(this.requirements, agent.provider, driver.listModels ? await driver.listModels(agent) : []);
      }
      case backendMethods.driverPluginsList: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.listPlugins) throw unsupportedProviderFeature(agent, 'plugins');
        return driver.listPlugins(agent);
      }
      case backendMethods.driverSkillsList: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.provider);
        if (!driver.listSkills || !driver.getCapabilities(agent).skills) return [];
        return requireRecord(params).forceReload === true ? driver.listSkills(agent, true) : driver.listSkills(agent);
      }
      case backendMethods.sourceFolderDetect:
        return detectSourceFolder();
      case backendMethods.sourceRepositoriesList: {
        const record = requireRecord(params);
        const sourceFolderPath = requireString(record.sourceFolderPath, 'sourceFolderPath').trim();
        return sourceFolderPath ? scanSourceRepositories(sourceFolderPath) : [];
      }
      case backendMethods.sourceRepositoryClone: {
        const record = requireRecord(params);
        return cloneSourceRepository(
          requireString(record.sourceFolderPath, 'sourceFolderPath'),
          requireString(record.url, 'url'),
        );
      }
      case backendMethods.sourceRepositoryCreate: {
        const record = requireRecord(params);
        return createSourceRepository(
          requireString(record.sourceFolderPath, 'sourceFolderPath'),
          requireString(record.name, 'name'),
        );
      }
      case backendMethods.sourceFoldersList: {
        const record = params === undefined ? {} : requireRecord(params);
        return listSourceFolders(typeof record.path === 'string' ? record.path : undefined);
      }
      case backendMethods.sourceWorktreePathSuggest: {
        const record = requireRecord(params);
        const input = requireRecord(record.input) as Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath'>;
        return suggestedSourceWorktreePath(input.repoPath, input.branchName);
      }
      case backendMethods.sourceWorktreesList: {
        const record = requireRecord(params);
        return listSourceWorktrees(requireString(record.repoPath, 'repoPath'));
      }
      case backendMethods.sourceBranchesList: {
        const record = requireRecord(params);
        return listSourceBranches(requireString(record.repoPath, 'repoPath'));
      }
      case backendMethods.sourceWorktreeCreate: {
        const record = requireRecord(params);
        return (await this.worktreeManager.create(record.input as CreateSourceWorktreeInput, { backgroundInitialization: true })).worktree;
      }
      default:
        return undefined;
    }
  }

  /** The harness whose account banks rate-limit resets. */
  private bankedResetsProvider(): HarnessProvider {
    return harnessProviders.find(provider => defaultProviderCapabilities(provider).bankedResets) ?? defaultHarnessProvider;
  }
  private remoteControlOperation<Key extends 'getRemoteControlStatus' | 'enableRemoteControl' | 'disableRemoteControl' | 'startDevicePairing' | 'checkDevicePairing' | 'listPairedDevices' | 'revokePairedDevice'>(
    params: unknown, key: Key,
  ): NonNullable<AgentProviderDriver[Key]> {
    const provider = params === undefined ? defaultHarnessProvider : requireProvider(requireRecord(params).provider ?? defaultHarnessProvider);
    const driver = this.requireDriver(provider);
    const operation = driver[key];
    if (!operation) throw new Error(`${provider} does not support remote control (${key}).`);
    return operation.bind(driver) as NonNullable<AgentProviderDriver[Key]>;
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const job of this.textGenerations.values()) job.controller.abort(new Error('Generation cancelled during shutdown.'));
    for (const unsubscribe of this.unsubscribeDriverEvents.values()) {
      unsubscribe();
    }
    const results = await Promise.allSettled([...this.drivers.values()].map(driver => Promise.resolve().then(() => driver.close())));
    for (const unsubscribe of this.unsubscribeUsage.values()) unsubscribe();
    for (const unsubscribe of this.unsubscribeRequestUsage.values()) unsubscribe();
    this.unsubscribeUsage.clear();
    this.unsubscribeRequestUsage.clear();
    this.unsubscribeDriverEvents.clear();
    this.pendingPrompts.clear();
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  tryHandlePromptCommand(agent: Agent, prompt: string): Promise<ProviderSendResult> | null {
    if (expandWorktreeDelegationCommand(prompt) !== null) return null;
    return this.requireDriver(agent.provider).tryHandlePromptCommand?.(agent, prompt) ?? null;
  }

  onEvent(listener: (event: BackendEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private requireDriver(provider: HarnessProvider): AgentProviderDriver {
    if (this.blocked(provider)) throw new Error('Provider upgrade is in progress. Try again when it finishes.');
    const driver = this.drivers.get(provider);
    if (!driver) {
      throw new Error(`Backend driver is not configured: ${provider}`);
    }
    return driver;
  }

  private emit(event: BackendEvent): void {
    if (event.type === 'models.changed') {
      event = { ...event, payload: { ...event.payload, models: filterRequiredModels(this.requirements, event.provider, event.payload.models) } };
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function requireAgentParams(params: unknown): { agent: Agent } {
  const record = requireRecord(params);
  return { agent: requireAgent(record.agent, 'agent') };
}

function requireAgent(value: unknown, label: string): Agent {
  const agent = requireRecord(value) as Agent;
  requireProvider(agent.provider);
  requireString(agent.id, `${label}.id`);
  return agent;
}

function requireProviderAgentIdParams(params: unknown): { provider: HarnessProvider; agentId: string } {
  const record = requireRecord(params);
  return {
    provider: requireProvider(record.provider),
    agentId: requireString(record.agentId, 'agentId'),
  };
}

function requireProvider(value: unknown): HarnessProvider {
  if (!isHarnessProvider(value)) {
    throw new Error('Invalid backend.');
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${name}.`);
  }
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid request params.');
  }
  return value as Record<string, unknown>;
}
