import type { ExecutionObservation } from '@workspace/core/usage';
import { assertPromptSession, requireExpectedSessionId, requirePromptText } from './prompt-input';
import { product } from '@workspace/core/product';
import { isUseBankedResetInput } from '@workspace/core/contracts/banked-resets';
import { isAgentBackend } from '@workspace/core/contracts/shared';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { expandWorktreeDelegationCommand } from './agents/worktree-delegation';
import { handoffInProgress } from '@workspace/core/agent-handoff';
import { isAgentRequestResponse } from '@workspace/core/agent-request';
import type { AgentBackendDriver, BackendEvent, BackendSendResult } from '@workspace/core/backend-driver';
import { unsupportedBackendFeature } from '@workspace/core/backend-driver';
import type { Agent, AgentBackend, AppGeneralSettings, AppPluginSettings, BackendSession, ConversationListInput, ConversationResumeTarget, CreateSourceWorktreeInput, DevicePairingSession, SendPromptOptions } from '@workspace/core/contracts';
import { stat } from 'node:fs/promises';
import { listAgentFolderFiles, previewAgentFolderFile, readAgentFolderFileChunk } from './agent-files';
import { listAgentDirectory } from './agent-directory';
import { ClaudeBackendDriver } from './claude/claude-driver';
import { AntigravityHost } from './antigravity/antigravity-host';
import { CodexBackendDriver } from './codex/codex-driver';
import { CodexSurfaceAgentAdapter } from './codex/codex-surface-adapter';
import { resolveCodexLaunch } from './codex/codex-command';
import { createCodexSurface } from '@codex-app-sdk/backend';
import { listSourceBranches, listSourceWorktrees, suggestedSourceWorktreePath } from './git-worktrees';
import { WorktreeManager } from './worktrees/worktree-manager';
import { buildAppMcpConfigOverrides, buildAppThreadConfig } from './mcp/codex-config';
import { backendCodexHomeDir } from './state';
import { listSourceFolders } from './source-folders';
import { detectSourceFolder, scanSourceRepositories } from './source-repositories';
import { cloneSourceRepository } from './clone-source-repository';
import { createSourceRepository } from './create-source-repository';
import { filterRequiredModels, type Requirements } from './requirements';

export type BackendDriverRegistryOptions = {
  appMcpServerUrl?: string | null;
  hostedMcpServerUrls?: () => Readonly<Record<string, string>>;
  generalSettings?: AppGeneralSettings;
  pluginSettings?: () => AppPluginSettings;
  celebrationsEnabled?: () => boolean;
  additionalDeveloperInstructions?: (agent: Agent) => string | undefined;
};

type AppLoadingStrategy = 'eager' | 'lazy';

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

type AppSurfaceOptions = Parameters<typeof createCodexSurface>[0] & {
  loadingStrategy?: AppLoadingStrategy;
};

export function createDefaultBackendDrivers(options: BackendDriverRegistryOptions = {}): Map<AgentBackend, AgentBackendDriver> {
  // Retain hosts for saved history and cleanup even when their new-work release gate is off.
  return new Map((['codex', 'claude', 'antigravity'] as const).map(backend => [backend, createBackendDriver(backend, options)]));
}

export function createBackendDriver(backend: AgentBackend, options: BackendDriverRegistryOptions = {}): AgentBackendDriver {
  if (backend === 'antigravity') return new AntigravityHost(options);
  if (backend === 'claude') return new ClaudeBackendDriver(undefined, undefined, {
    appMcpServerUrl: options.appMcpServerUrl ?? null,
    hostedMcpServerUrls: options.hostedMcpServerUrls,
    pluginSettings: options.pluginSettings,
    celebrationsEnabled: options.celebrationsEnabled,
    additionalDeveloperInstructions: options.additionalDeveloperInstructions,
  });
  const codexSurface = createCodexSurface(appSurfaceOptions(options));
  const codexSessionManager = new CodexSurfaceAgentAdapter(codexSurface);
  return new CodexBackendDriver(codexSessionManager);
}

export function appSurfaceOptions(options: BackendDriverRegistryOptions = {}): AppSurfaceOptions {
  return {
    autoSelectFirstConversation: false,
    clientInfo: { name: 'workspace', title: product.name, version: '0.3.0' },
    codexHome: options.generalSettings?.providerHomes?.codex?.homePath ?? backendCodexHomeDir(),
    loadingStrategy: 'lazy',
    transport: {
      ...resolveCodexLaunch(options.generalSettings?.codexBinaryPath),
      configOverrides: buildAppMcpConfigOverrides(
        options.pluginSettings?.() ?? options.generalSettings?.plugins,
      ),
    },
    extensions: [{
      configureConversation: async ({ extensionContext }) => {
        const agent = reviewExtensionAgent(extensionContext) ?? (isAgent(extensionContext) ? extensionContext : null);
        if (!agent) return {};
        const reviewMcpServerUrl = reviewExtensionMcpUrl(extensionContext);
        return buildAppThreadConfig(
          agent,
          reviewMcpServerUrl ?? options.appMcpServerUrl ?? null,
          options.pluginSettings?.() ?? options.generalSettings?.plugins,
          {
            celebrationsEnabled: options.celebrationsEnabled?.() ?? options.generalSettings?.celebrationsEnabled,
            developerInstructions: options.additionalDeveloperInstructions?.(agent),
          },
          reviewMcpServerUrl ? {} : options.hostedMcpServerUrls?.() ?? {},
        );
      },
    }],
  };
}

function isAgent(value: unknown): value is Agent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.backend === 'codex' && typeof record.id === 'string' && (
    typeof record.folder === 'string' || (record.folder === null && record.sessionKind === 'quickChat')
  );
}

function reviewExtensionAgent(value: unknown): Agent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const agent = (value as Record<string, unknown>).agent;
  return isAgent(agent) ? agent : null;
}

function reviewExtensionMcpUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = (value as Record<string, unknown>).reviewMcpServerUrl;
  return typeof url === 'string' ? url : null;
}

export class BackendDriverRpc {
  private readonly usageListeners = new Set<(observation:ExecutionObservation)=>void>();
  private readonly unsubscribeUsage = new Map<AgentBackend,()=>void>();
  private bindUsage(backend:AgentBackend,driver:AgentBackendDriver):void { this.unsubscribeUsage.get(backend)?.(); if(driver.onUsage) this.unsubscribeUsage.set(backend,driver.onUsage(o=>{for(const listener of this.usageListeners) {try{listener(o);}catch{/* Observer isolation. */}}})); }
  onUsage(listener:(observation:ExecutionObservation)=>void):()=>void { this.usageListeners.add(listener);return ()=>this.usageListeners.delete(listener); }
  private readonly inFlight = new Map<AgentBackend, number>();
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly unsubscribeDriverEvents = new Map<AgentBackend, () => void>();

  constructor(
    private readonly drivers: Map<AgentBackend, AgentBackendDriver>,
    private readonly worktreeManager = new WorktreeManager(),
    private readonly ensureConnected?: (backend: AgentBackend) => Promise<unknown>,
    private readonly blocked: (backend: AgentBackend) => boolean = () => false,
    private readonly requirements: Requirements = {},
  ) {
    for (const [backend, driver] of drivers) { this.bindUsage(backend,driver); this.unsubscribeDriverEvents.set(backend, driver.onEvent((event) => this.emit(event))); }
  }

  async replaceDriver(backend: AgentBackend, create: () => AgentBackendDriver, maintenance?: () => Promise<void>): Promise<void> {
    this.unsubscribeDriverEvents.get(backend)?.();
    await this.drivers.get(backend)?.close();
    try { await maintenance?.(); }
    finally {
      const driver = create();
      this.drivers.set(backend, driver);
      this.bindUsage(backend,driver);
      this.unsubscribeDriverEvents.set(backend, driver.onEvent(event => this.emit(event)));
    }
  }

  isBusy(backend: AgentBackend): boolean { return (this.inFlight.get(backend) ?? 0) > 0; }

  async refreshConversationContext(agent: Agent): Promise<void> {
    const driver = this.requireDriver(agent.backend);
    if (!agent.backendSession || !driver.releaseConversation || !driver.loadConversation) return;
    await driver.releaseConversation(agent.id);
    await driver.loadConversation(agent);
  }

  private async requireNewWork(backend: AgentBackend): Promise<void> {
    await this.ensureConnected?.(backend);
  }

  async handle(method: string, params: unknown, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    const record = isRecord(params) ? params : {};
    const candidate = record.backend ?? (isRecord(record.agent) ? record.agent.backend : undefined);
    const backend = candidate === 'codex' || candidate === 'claude' ? candidate : undefined;
    if (backend) {
      if (this.blocked(backend)) throw new Error('Provider upgrade is in progress. Try again when it finishes.');
      this.inFlight.set(backend, (this.inFlight.get(backend) ?? 0) + 1);
    }
    try { return await this.dispatch(method, params, options.signal); }
    finally { if (backend) this.inFlight.set(backend, (this.inFlight.get(backend) ?? 1) - 1); }
  }

  private async dispatch(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    switch (method) {
      case backendMethods.driverProviderAuthentication: {
        const record = requireRecord(params);
        const backend = requireBackend(record.backend);
        const driver = this.requireDriver(backend);
        if (!driver.authenticate) throw new Error(`Authentication is unavailable for ${backend}.`);
        const action = record.action;
        if (action !== 'check' && action !== 'cancel' && action !== 'logout' && !(action === 'login' && backend === 'antigravity')) throw new Error('Invalid authentication action.');
        return driver.authenticate({ action, ...(record.loginId === undefined ? {} : { loginId: requireString(record.loginId, 'loginId') }) });
      }
      case backendMethods.driverBankedResetsGet: {
        const driver = this.requireCodexDriver();
        return driver.getBankedResets ? driver.getBankedResets() : { status: 'unsupported' };
      }
      case backendMethods.driverBankedResetUse: {
        const input = requireRecord(params).input;
        if (!isUseBankedResetInput(input)) throw new Error('Reset confirmation is required');
        const driver = this.requireCodexDriver();
        if (!driver.useBankedReset) throw new Error('Reset redemption is unsupported');
        return driver.useBankedReset(input);
      }
      case backendMethods.driverAccountRateLimitsGet: {
        const driver = this.requireDriver(requireBackend(requireRecord(params).backend));
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
      case backendMethods.driverCodexAuthenticationGet:
        return this.requireCodexDriver().getAuthentication();
      case backendMethods.driverCodexLoginCancel:
        return this.requireCodexDriver().cancelChatGptLogin(params ? requireString(requireRecord(params).loginId, 'loginId') : undefined);
      case backendMethods.driverCodexChatGptDeviceCodeLoginStart:
        return this.requireCodexDriver().startChatGptDeviceCodeLogin();
      case backendMethods.driverCodexChatGptLoginStart:
        return this.requireCodexDriver().startChatGptLogin();
      case backendMethods.driverCodexLogout:
        return this.requireCodexDriver().logout();
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
      case backendMethods.driverTextGenerate: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.backend);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.generateText) throw unsupportedBackendFeature(agent, 'ephemeral text generation');
        return driver.generateText(agent, {
          prompt: requireString(record.prompt, 'prompt'),
          cwd: requireString(record.cwd, 'cwd'),
          ...(typeof record.developerInstructions === 'string' ? { developerInstructions: record.developerInstructions } : {}),
          ...(record.outputSchema !== undefined ? { outputSchema: record.outputSchema as never } : {}),
        });
      }
      case backendMethods.driverImageGenerate: {
        const { agent } = requireAgentParams(params);
        if (agent.backend !== 'codex') throw new Error('Image generation requires the Codex driver.');
        await this.requireNewWork('codex');
        const driver = this.requireDriver('codex');
        if (!driver.generateImage) throw unsupportedBackendFeature(agent, 'image generation');
        const record = requireRecord(params);
        return driver.generateImage(agent, { prompt: requireString(record.prompt, 'prompt'), cwd: requireString(record.cwd, 'cwd') }, signal);
      }
      case backendMethods.driverCodeReviewRun: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.backend);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.runCodeReview || !driver.getCapabilities(agent).codeReview) {
          throw unsupportedBackendFeature(agent, 'code review');
        }
        return driver.runCodeReview(agent, {
          prompt: requireString(record.prompt, 'prompt'),
          cwd: requireString(record.cwd, 'cwd'),
          reviewMcpServerUrl: requireString(record.reviewMcpServerUrl, 'reviewMcpServerUrl'),
          ...(record.reviewerSession ? { reviewerSession: record.reviewerSession as BackendSession } : {}),
        });
      }
      case backendMethods.driverCodeReviewDispose: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.disposeCodeReview) throw unsupportedBackendFeature(agent, 'code review cleanup');
        await driver.disposeCodeReview(agent, record.reviewerSession as BackendSession);
        return null;
      }
      case backendMethods.driverPromptCommandHandle: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        return this.tryHandlePromptCommand(agent, requireString(record.prompt, 'prompt'));
      }
      case backendMethods.driverPromptSend: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.backend);
        const record = requireRecord(params);
        assertPromptSession(agent, requireExpectedSessionId(record));
        const rawPrompt = requirePromptText(record.prompt, record.options as SendPromptOptions | undefined);
        const prompt = expandWorktreeDelegationCommand(rawPrompt, (record.options as SendPromptOptions | undefined)?.delegation) ?? rawPrompt;
        const driver = this.requireDriver(agent.backend);
        return driver.sendPrompt(agent, prompt, record.options as SendPromptOptions | undefined);
      }
      case backendMethods.driverConversationReplaceWithSummary: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.backend);
        const driver = this.requireDriver(agent.backend);
        if (!driver.replaceConversationWithSummary) {
          throw unsupportedBackendFeature(agent, 'session compression');
        }
        return driver.replaceConversationWithSummary(agent);
      }
      case backendMethods.driverConversationTitleUpdate: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.setConversationTitle) {
          throw unsupportedBackendFeature(agent, 'conversation titles');
        }
        await driver.setConversationTitle(agent, requireString(record.title, 'title'));
        return null;
      }
      case backendMethods.driverGoalUpdate: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.setGoal) {
          throw unsupportedBackendFeature(agent, 'goals');
        }
        return driver.setGoal(agent, requireString(record.objective, 'objective'));
      }
      case backendMethods.driverGoalClear: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.clearGoal) {
          throw unsupportedBackendFeature(agent, 'goals');
        }
        return driver.clearGoal(agent);
      }
      case backendMethods.driverApprovalPresetUpdate: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.setApprovalPreset) {
          throw unsupportedBackendFeature(agent, 'approval presets');
        }
        return driver.setApprovalPreset(agent, record.preset as never);
      }
      case backendMethods.driverPermissionModeUpdate: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.setPermissionMode) {
          throw unsupportedBackendFeature(agent, 'permission modes');
        }
        const mode = requireString(record.mode, 'mode');
        const supportedModes = driver.getCapabilities(agent).permissionModes ?? [];
        if (!supportedModes.some((option) => option.id === mode)) {
          throw new Error(`Unsupported permission mode for ${agent.backend}: ${mode}`);
        }
        return driver.setPermissionMode(agent, mode);
      }
      case backendMethods.driverConversationRelease: {
        const { backend, agentId } = requireBackendAgentIdParams(params);
        await this.requireDriver(backend).releaseConversation?.(agentId);
        return null;
      }
      case backendMethods.driverHandoffCheck: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.assertHandoffReady) throw unsupportedBackendFeature(agent, 'handoff readiness checks');
        await driver.assertHandoffReady(agent);
        return null;
      }
      case backendMethods.driverConversationArchive: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.archiveAgentConversation) return { supported: false };
        await driver.archiveAgentConversation(agent);
        return { supported: true };
      }
      case backendMethods.driverConversationDelete: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.deleteAgentConversation) return { supported: false };
        await driver.deleteAgentConversation(agent);
        return { supported: true };
      }
      case backendMethods.driverConversationsReconcile: {
        const record = requireRecord(params);
        const backend = requireBackend(record.backend);
        const agents = Array.isArray(record.agents) ? record.agents.map((agent) => requireAgent(agent, 'agent')) : [];
        await this.requireDriver(backend).reconcileConversations?.(agents);
        return null;
      }
      case backendMethods.driverInterrupt: {
        const { agent } = requireAgentParams(params);
        const expectedTurnId = requireRecord(params).expectedTurnId;
        return expectedTurnId === undefined
          ? this.requireDriver(agent.backend).interrupt(agent)
          : this.requireDriver(agent.backend).interrupt(agent, requireString(expectedTurnId, 'expectedTurnId'));
      }
      case backendMethods.driverAgentRequestRespond: {
        const record = requireRecord(params);
        const backend = requireBackend(record.backend);
        if (!isAgentRequestResponse(record.response)) throw new Error('Invalid agent request response.');
        await this.requireDriver(backend).respondToAgentRequest(record.response);
        return null;
      }
      case backendMethods.driverConversationLoad: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.loadConversation) throw unsupportedBackendFeature(agent, 'conversation loading');
        return driver.loadConversation(agent);
      }
      case backendMethods.driverConversationHistoryLoadOlder: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.loadOlderHistory) {
          throw unsupportedBackendFeature(agent, 'demand-paged conversation history');
        }
        return driver.loadOlderHistory(agent);
      }
      case backendMethods.driverConversationContentRead: {
        const { agent } = requireAgentParams(params);
        const input = requireRecord(requireRecord(params).input);
        if (typeof input.sessionId !== 'string' || typeof input.contentId !== 'string' || !Number.isSafeInteger(input.offset) || (input.offset as number) < 0) throw new Error('Invalid conversation content request.');
        const driver = this.requireDriver(agent.backend);
        if (!driver.readConversationContent) throw unsupportedBackendFeature(agent, 'conversation content');
        return driver.readConversationContent(agent, { sessionId: input.sessionId, contentId: input.contentId, offset: input.offset as number });
      }
      case backendMethods.driverConversationsList: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.listConversations) throw unsupportedBackendFeature(agent, 'conversation listing');
        return driver.listConversations(agent, record.input as ConversationListInput | undefined);
      }
      case backendMethods.driverConversationResume: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.resumeConversation) {
          throw unsupportedBackendFeature(agent, 'conversation resume');
        }
        return driver.resumeConversation(agent, record.target as ConversationResumeTarget);
      }
      case backendMethods.driverWorktreeConversationFork: {
        const { agent } = requireAgentParams(params);
        const targetAgent = requireAgent(requireRecord(params).targetAgent, 'targetAgent');
        if (agent.backend !== targetAgent.backend) throw new Error('Native worktree forks require the same provider.');
        const driver = this.requireDriver(agent.backend);
        return driver.forkWorktreeConversation ? driver.forkWorktreeConversation(agent, targetAgent) : null;
      }
      case backendMethods.driverConversationFork: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const targetAgent = requireAgent(record.targetAgent, 'targetAgent');
        const turnId = record.turnId === undefined ? undefined : requireString(record.turnId, 'turnId');
        const driver = this.requireDriver(agent.backend);
        if (!driver.forkConversation) {
          throw unsupportedBackendFeature(agent, 'conversation fork');
        }
        return turnId === undefined
          ? driver.forkConversation(agent, targetAgent)
          : driver.forkConversation(agent, targetAgent, turnId);
      }
      case backendMethods.driverConversationMessagesGet: {
        const record = requireRecord(params);
        const ref = requireRecord(record.ref);
        const backend = requireBackend(ref.backend);
        const driver = this.requireDriver(backend);
        if (!driver.readConversationMessages) {
          throw new Error(`${backend} does not support reading conversation messages.`);
        }
        return driver.readConversationMessages(record.ref as never, requireString(record.agentId, 'agentId'));
      }
      case backendMethods.driverConversationSummaryGet: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.readConversationSummary) throw unsupportedBackendFeature(agent, 'conversation summaries');
        return driver.readConversationSummary(agent, record.ref as never);
      }
      case backendMethods.driverPromptSteer: {
        const { agent } = requireAgentParams(params);
        if (handoffInProgress(agent)) throw new Error('Wait for the handoff to finish.');
        await this.requireNewWork(agent.backend);
        const record = requireRecord(params);
        assertPromptSession(agent, requireExpectedSessionId(record));
        const driver = this.requireDriver(agent.backend);
        if (!driver.steerPrompt) {
          throw unsupportedBackendFeature(agent, 'prompt steering');
        }
        const rawPrompt = requirePromptText(record.prompt, record.options as SendPromptOptions | undefined);
        const prompt = expandWorktreeDelegationCommand(rawPrompt, (record.options as SendPromptOptions | undefined)?.delegation) ?? rawPrompt;
        const options = record.options as SendPromptOptions | undefined;
        return options
          ? driver.steerPrompt(agent, prompt, options)
          : driver.steerPrompt(agent, prompt);
      }
      case backendMethods.driverTurnDelete: {
        const { agent } = requireAgentParams(params);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.deleteTurn) {
          throw unsupportedBackendFeature(agent, 'turn deletion');
        }
        return driver.deleteTurn(agent, requireString(record.turnId, 'turnId'));
      }
      case backendMethods.driverTurnEdit: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.backend);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.editTurn) {
          throw unsupportedBackendFeature(agent, 'turn editing');
        }
        return driver.editTurn(
          agent,
          requireString(record.turnId, 'turnId'),
          requireString(record.content, 'content'),
        );
      }
      case backendMethods.driverTurnRetry: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.backend);
        const record = requireRecord(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.retryTurn) {
          throw unsupportedBackendFeature(agent, 'turn retry');
        }
        return driver.retryTurn(agent, requireString(record.turnId, 'turnId'));
      }
      case backendMethods.driverTurnContinueInterrupted: {
        const { agent } = requireAgentParams(params);
        await this.requireNewWork(agent.backend);
        const driver = this.requireDriver(agent.backend);
        if (!driver.continueInterruptedTurn) {
          throw unsupportedBackendFeature(agent, 'interrupted turn continuation');
        }
        return driver.continueInterruptedTurn(agent);
      }
      case backendMethods.driverModelsList: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.backend);
        return filterRequiredModels(this.requirements, agent.backend, driver.listModels ? await driver.listModels(agent) : []);
      }
      case backendMethods.driverPluginsList: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.listPlugins) throw unsupportedBackendFeature(agent, 'plugins');
        return driver.listPlugins(agent);
      }
      case backendMethods.driverSkillsList: {
        const { agent } = requireAgentParams(params);
        const driver = this.requireDriver(agent.backend);
        if (!driver.listSkills) return [];
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
        return (await this.worktreeManager.create(record.input as CreateSourceWorktreeInput)).worktree;
      }
      default:
        return undefined;
    }
  }

  private remoteControlOperation<Key extends 'getRemoteControlStatus' | 'enableRemoteControl' | 'disableRemoteControl' | 'startDevicePairing' | 'checkDevicePairing' | 'listPairedDevices' | 'revokePairedDevice'>(
    params: unknown, key: Key,
  ): NonNullable<AgentBackendDriver[Key]> {
    const backend = params === undefined ? 'codex' : requireBackend(requireRecord(params).backend ?? 'codex');
    const driver = this.requireDriver(backend);
    const operation = driver[key];
    if (!operation) throw new Error(`${backend} does not support remote control (${key}).`);
    return operation.bind(driver) as NonNullable<AgentBackendDriver[Key]>;
  }

  private requireCodexDriver(): CodexBackendDriver {
    const driver = this.requireDriver('codex');
    if (!(driver instanceof CodexBackendDriver)) {
      throw new Error('Codex driver is not configured.');
    }
    return driver;
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.unsubscribeUsage.values()) unsubscribe();
    for (const unsubscribe of this.unsubscribeDriverEvents.values()) {
      unsubscribe();
    }
    await Promise.all([...this.drivers.values()].map((driver) => driver.close()));
  }

  tryHandlePromptCommand(agent: Agent, prompt: string): Promise<BackendSendResult> | null {
    if (expandWorktreeDelegationCommand(prompt) !== null) return null;
    return this.requireDriver(agent.backend).tryHandlePromptCommand?.(agent, prompt) ?? null;
  }

  onEvent(listener: (event: BackendEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private requireDriver(backend: AgentBackend): AgentBackendDriver {
    if (this.blocked(backend)) throw new Error('Provider upgrade is in progress. Try again when it finishes.');
    const driver = this.drivers.get(backend);
    if (!driver) {
      throw new Error(`Backend driver is not configured: ${backend}`);
    }
    return driver;
  }

  private emit(event: BackendEvent): void {
    if (event.type === 'models.changed') {
      event = { ...event, payload: { ...event.payload, models: filterRequiredModels(this.requirements, event.backend, event.payload.models) } };
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
  requireBackend(agent.backend);
  requireString(agent.id, `${label}.id`);
  return agent;
}

function requireBackendAgentIdParams(params: unknown): { backend: AgentBackend; agentId: string } {
  const record = requireRecord(params);
  return {
    backend: requireBackend(record.backend),
    agentId: requireString(record.agentId, 'agentId'),
  };
}

function requireBackend(value: unknown): AgentBackend {
  if (!isAgentBackend(value)) {
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
