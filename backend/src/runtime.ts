import { DesignService } from './design-service';
import { createDesignToolModuleProvider } from './mcp/design-tools';
import { GuestJoins } from './sharing/guest-joins';
import { UsageService } from './usage/usage-service';
import { UsageLedger } from './usage/usage-ledger';
import { PromptRejectedError } from './agents/prompt-rejected';
import { createMobileSimulatorToolModuleProvider } from './mcp/mobile-simulator-tools';
import { relayFromEnvironment, CompanionManager } from './companion/manager';
import { appRpcErrorCodes, createAppRpcRequest } from '@workspace/core/backend-protocol/rpc';
import { DocumentWorkspaceService } from './document-workspace-service';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import path from 'node:path';
import { sendAgentPrompt } from '@workspace/core/agent-chat-service';
import type { Agent, BackendConversationRef, SystemPermissionsStatus } from '@workspace/core/contracts';
import { formatConversationTitle, shouldSyncConversationTitleFromAgent } from '@workspace/core/conversation-title';
import type { AgentBackendDriver, BackendSendResult } from '@workspace/core/backend-driver';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { BackendDriverRpc, createBackendDriver, createDefaultBackendDrivers, type BackendDriverRegistryOptions } from './driver-rpc';
import { ProviderSetup } from './provider-setup';
import { ProviderUpdates } from './provider-updates';
import { ProviderUpdateRuntime } from './provider-update-runtime';
import { resolveClaudeLaunch } from './claude/claude-command';
import { resolveCodexExecutable } from './codex/codex-command';
import { localProviderAgents } from './provider-roster-reset';
import { handoffInProgress } from '@workspace/core/agent-handoff';
import { RemoteDaemonClientManager } from './connections/remote-daemon-client';
import { SshConnectionService } from './connections/ssh-connections';
import { AutomationRunner } from './automations/runner';
import { RuntimeScheduler } from './scheduling/runtime-scheduler';
import { AppMcpService } from './mcp/service';
import { HostedMcpGateway } from './mcp/hosted-mcp-gateway';
import { runtimeGitHubOAuthClientId, runtimeGitLabOAuthClientId, runtimeLinearOAuthSettings } from './runtime-config';
import { loadRequirements } from './requirements';
import { LinearWorkProviderDriver } from './work-integrations/linear-driver';
import { AppBackendServer } from './server';
import { backendCodexHomeDir, backendHomeDir, backendProviderTokensFilePath, backupProviderSetup, deleteBackendMissionHome, ensureBackendCodexHome, ensureBackendMissionHome, loadBackendSnapshot, saveBackendSnapshot } from './state';
import { saveCodeReviewReport } from './review/review-report';
import { FileWorkIntegrationTokenStore } from './work-integrations/file-token-store';
import { GitLabWorkProviderDriver } from './work-integrations/gitlab-driver';
import { GitHubWorkProviderDriver } from './work-integrations/github-driver';
import { GitHubCliWorkProviderDriver } from './work-integrations/github-cli-driver';
import { GitLabCliWorkProviderDriver } from './work-integrations/gitlab-cli-driver';
import { WorkIntegrationManager } from './work-integrations/manager';
import { warnMain } from './log';
import { loadPluginStatus } from './plugin-status';
import { AgentGitService } from './git/agent-git-service';
import { PullRequestMonitor } from './git/pull-request-monitor';
import { WorktreeManager } from './worktrees/worktree-manager';
import { AgentCreationService } from './agents/agent-creation-service';
import { VisualizeService } from './visualize-service';
import { createVisualizeToolModuleProvider } from './mcp/visualize-tools';
import { DurableTaskService } from './agents/durable-task-service';
import { createTaskToolModuleProvider } from './mcp/task-tools';
import { createImageGenerationToolModuleProvider } from './mcp/image-generation-tools';
import { ImageGenerationService } from './image-generation-service';
import { loadBackendTasks, saveBackendTasks } from './state';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import type { RendererMessage } from '@workspace/core/contracts';

type DaemonClientRequest = <Result>(method: string, params?: unknown) => Promise<Result>;

export type DaemonRuntimeOptions = {
  emitEvent(event: AppBackendEvent): void;
  features?: {
    computerUse?: boolean;
    embeddedBrowser?: boolean;
    mobileSimulator?: boolean;
  };
  requestClient: DaemonClientRequest;
  version: string;
};

export type DaemonRuntime = {
  server: AppBackendServer;
  stop(): Promise<void>;
};

export async function createDaemonRuntime(options: DaemonRuntimeOptions): Promise<DaemonRuntime> {
  const requirements = await loadRequirements(backendHomeDir());
  const computerUseAvailable = options.features?.computerUse !== false;
  const embeddedBrowserAvailable = options.features?.embeddedBrowser !== false;
  const snapshot = await loadBackendSnapshot();
  const savedTasks = await loadBackendTasks();
  await ensureBackendCodexHome();
  const providerSetup = new ProviderSetup(snapshot, () => saveBackendSnapshot(snapshot), async backend => {
    if (backend === 'codex') {
      pluginStatus = await loadPluginStatus(snapshot.general.providerHomes?.codex?.homePath);
    }
    await driverRpc.replaceDriver(backend, () => createBackendDriver(backend, { ...driverOptions, generalSettings: snapshot.general }));
  }, undefined, () => backupProviderSetup(snapshot));
  await providerSetup.initialize();
  let pluginStatus = await loadPluginStatus(snapshot.general.providerHomes?.codex?.homePath);
  const pluginSettings = () => ({
    ...(snapshot.general.plugins ?? { computerUseEnabled: false, chromeEnabled: false }),
    computerUseEnabled: computerUseAvailable && snapshot.general.plugins?.computerUseEnabled === true,
    chromeEnabled: pluginStatus.chromeEnabled,
  });
  let server!: AppBackendServer;
  const worktreeManager = new WorktreeManager({
    getInitializationMode: () => snapshot.general.worktreeInitializationMode,
    onInitializationChanged: (folder, state) => {
      const agents = snapshot.agents.filter(agent => agent.folder && path.resolve(agent.folder) === folder
        && !snapshot.teams.find(team => team.id === agent.teamId)?.remoteConnectionId);
      for (const agent of agents) {
        agent.worktreeInitialization = { ...state };
        server?.emitEvent({ agentId: agent.id, type: 'agent.updated', payload: { id: agent.id, worktreeInitialization: { ...state } } });
      }
      if (agents.length) void saveBackendSnapshot(snapshot).catch(error => warnMain('worktree-initialization', 'Could not save setup status', { message: String(error) }));
    },
  });
  const agentGitService = new AgentGitService(
    undefined,
    undefined,
    async (input) => (await worktreeManager.create(input)).worktree,
  );
  const agentCreation = new AgentCreationService(snapshot, folder => worktreeManager.getInitializationState(folder));
  const workIntegrations = new WorkIntegrationManager({
    drivers: [
      new GitHubWorkProviderDriver(() => runtimeGitHubOAuthClientId(snapshot.workBacklog.providerSettings.github)),
      new LinearWorkProviderDriver(() => runtimeLinearOAuthSettings(snapshot.workBacklog.providerSettings.linear)),
      new GitLabWorkProviderDriver(() => runtimeGitLabOAuthClientId(snapshot.workBacklog.providerSettings.gitlab)),
    ],
    githubCli: new GitHubCliWorkProviderDriver(),
    gitlabCli: new GitLabCliWorkProviderDriver(),
    getSnapshot: () => snapshot,
    saveSnapshot: () => saveBackendSnapshot(snapshot),
    tokenStore: new FileWorkIntegrationTokenStore(backendProviderTokensFilePath()),
  });
  await workIntegrations.hydrateConnections();
  const hostedMcpGateway = new HostedMcpGateway({ credentials: workIntegrations });
  const tasks: DurableTaskService = new DurableTaskService({
    tasks: savedTasks,
    save: saveBackendTasks,
    agent: id => snapshot.agents.find(agent => agent.id === id),
    send: (agent, prompt, goal) => server.sendTaskPrompt(agent, prompt, goal),
    interrupt: (agent, expectedTurnId) => driverRpc.handle(backendMethods.driverInterrupt, { agent, expectedTurnId }),
    readHistory: agent => {
      const ref = conversationRefFromAgent(agent);
      return ref ? driverRpc.handle(backendMethods.driverConversationMessagesGet, { ref, agentId: agent.id }) as Promise<RendererMessage[]> : Promise.resolve([]);
    },
    onError: error => warnMain('tasks', 'transition failed', { message: String(error) }),
  });
  const designService = new DesignService({ capture: embeddedBrowserAvailable ? input => options.requestClient<string>(backendMethods.clientDesignCapture, input) : undefined, snapshot, persist: () => saveBackendSnapshot(snapshot), publish: () => server?.emitEvent({ type: 'snapshot.updated', payload: snapshot }) });
  const visualizeService = new VisualizeService({
    snapshot,
    generatedImagesRoot: path.join(backendCodexHomeDir(), 'generated_images'),
    persist: () => saveBackendSnapshot(snapshot),
    publish: () => server?.emitEvent({ type: 'snapshot.updated', payload: snapshot }),
  });
  const documents = new DocumentWorkspaceService(path.join(backendHomeDir(), "document-workspaces.json"));
  const localUsage = new UsageLedger(path.join(backendHomeDir(), 'usage.sqlite'));
  await localUsage.load();
  const usage = new UsageService(localUsage, id => snapshot.agents.find(a => a.id === id), undefined, undefined, () => snapshot.agents);
  // Turns saved before the repository was recorded carry a worktree folder; file them under their repository, once.
  void usage.migrateRepositories();
  const mcpService: AppMcpService = new AppMcpService({
    retainDocument: (agentId, request) => documents.display(agentId, request),
    tasks,
    persistSnapshot: () => saveBackendSnapshot(snapshot),
    missionTools: {
      acquireCommitLock: (agentId, signal) => server.acquireMissionCommitLock(agentId, signal),
      releaseCommitLock: agentId => server.releaseMissionCommitLock(agentId),
      contextForAgent: agentId => server.missionContext(agentId),
      submitResult: (agentId, input) => server.submitMissionResult(agentId, input),
      upsertTicket: (agentId, input) => server.upsertMissionTicket(agentId, input),
      setTitle: (agentId, title) => server.setMissionTitle(agentId, title),
      attachRepository: (agentId, repoPath) => server.attachMissionRepository(agentId, repoPath),
      listArtifacts: agentId => server.listMissionArtifacts(agentId),
      readArtifact: (agentId, stage) => server.readMissionArtifact(agentId, stage),
      writeArtifact: (agentId, input) => server.writeMissionArtifact(agentId, input),
      reportReviewFinding: (agentId, input) => server.reportMissionReviewFinding(agentId, input),
      updateReviewFinding: (agentId, input) => server.updateMissionReviewFinding(agentId, input),
    },
    snapshot,
    computerUse: computerUseAvailable ? {
      execute: (input) => options.requestClient(backendMethods.clientComputerUseExecute, input),
      requestAccessibility: () => options.requestClient(backendMethods.clientComputerUseRequestAccessibility),
      status: () => options.requestClient(backendMethods.clientComputerUseStatusGet),
      stop: () => options.requestClient(backendMethods.clientComputerUseStop),
    } : undefined,
    computerUseEnabled: () => computerUseAvailable && snapshot.general.plugins?.computerUseEnabled === true,
    browser: embeddedBrowserAvailable ? {
      open: (input) => options.requestClient(backendMethods.clientBrowserOpen, input),
      execute: (input) => options.requestClient(backendMethods.clientBrowserExecute, input),
    } : undefined,
    hostedMcpGateway,
    queueSpokenAnnouncement: (input) => options.requestClient(backendMethods.clientSpokenAnnouncementQueue, input),
    resolveWorkspaceIdentity: (folder) => agentGitService.identity(folder),
    worktreeManager,
    agentCreation,
    createProject: (agentId, name, prompt, backend) => server.createProjectFromQuickChat(agentId, name, prompt, backend),
    startMission: (agentId, input) => server.startMissionFromAgent(agentId, input),
    gitDiff: (folder, target) => agentGitService.diff(folder, target as Exclude<typeof target, { type: 'turn' }>),
    startAutomaticReview: (agentId, input) => server.startAutomaticReview(agentId, input),
    closeAgent: (callerAgentId, agentId) => server.closeAgentFromMcp(callerAgentId, agentId),
    toolModuleProviders: [
      createImageGenerationToolModuleProvider(new ImageGenerationService({
        snapshot, generatedImagesRoot: path.join(backendCodexHomeDir(), 'generated_images'), defaultCwd: backendHomeDir(),
        generate: (agent, input, signal) => driverRpc.handle(backendMethods.driverImageGenerate, { agent, ...input }, { signal }) as Promise<import('@workspace/core/backend-driver').BackendImageGenerationResult>,
      })),
      createMobileSimulatorToolModuleProvider(options.features?.mobileSimulator !== false
        ? (agentId, input) => options.requestClient(backendMethods.clientMobileSimulatorExecute, { agentId, input })
        : undefined),
      createVisualizeToolModuleProvider(visualizeService),
      createDesignToolModuleProvider(designService),
      createTaskToolModuleProvider(tasks),
    ],
  });
  const mcpServerUrl = await mcpService.start();
  const driverOptions: BackendDriverRegistryOptions = {
    appMcpServerUrl: mcpServerUrl,
    hostedMcpServerUrls: () => mcpService.hostedMcpServerUrls(),
    generalSettings: snapshot.general,
    pluginSettings,
    celebrationsEnabled: () => snapshot.general.celebrationsEnabled,
    additionalDeveloperInstructions: (agent) => [
      tasks.instructions(agent.id),
      server?.missionDeveloperInstructions(agent.id),
      agent.worktreeInitialization?.state === 'running'
        ? '<context>Worktree initialization is running in the background. Begin independent inspection and editing. Before dependency-dependent checks, changing package manifests, lockfiles or setup inputs, running installation commands, or committing, call wait-for-worktree-initialization. Do not run competing setup commands. If setup fails, report the failure rather than claiming checks passed.</context>' : undefined,
      visualizeService.developerInstructions(),
    ].filter(Boolean).join('\n\n') || undefined,
  };
  const backendDrivers = createDefaultBackendDrivers(driverOptions);
  const driverRpc: BackendDriverRpc = new BackendDriverRpc(backendDrivers, worktreeManager, backend => server.requireConnectedEngine(backend), backend => providerUpdates.isUpdating(backend), requirements);
  const updater = new ProviderUpdateRuntime({
    command: backend => backend === 'codex'
      ? resolveCodexExecutable(snapshot.general.codexBinaryPath) ?? (snapshot.general.codexBinaryPath?.trim() || 'codex')
      : resolveClaudeLaunch().command,
    claudeHome: () => snapshot.general.providerHomes?.claude?.homePath ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(process.env.HOME ?? '', '.claude'),
  });
  const providerUpdates: ProviderUpdates = new ProviderUpdates({
    inspect: backend => updater.inspect(backend),
    upgrade: installation => updater.upgrade(installation),
    busy: backend => {
      const agents = localProviderAgents(snapshot, backend);
      const ids = new Set(agents.map(agent => agent.id));
      return providerSetup.isChanging() || driverRpc.isBusy(backend)
        || agents.some(agent => agent.status.type === 'working' || agent.status.type === 'awaitingInput' || handoffInProgress(agent))
        || (snapshot.queuedPrompts ?? []).some(prompt => ids.has(prompt.agentId));
    },
    withStoppedProvider: async (backend, work) => {
      const agents = localProviderAgents(snapshot, backend).filter(agent => agent.backendSession);
      const current = backendDrivers.get(backend)!;
      for (const agent of agents) await current.assertHandoffReady?.(agent);
      await driverRpc.replaceDriver(backend, () => createBackendDriver(backend, { ...driverOptions, generalSettings: snapshot.general }), work);
      // Rehydrate the same sessions, never restart/reset the conversation identity.
      const replacement = backendDrivers.get(backend)!;
      for (const agent of agents) await replacement.loadConversation?.(agent);
    },
  });
  const automationRunner = new AutomationRunner({
    requireConnectedEngine: backend => server.requireConnectedEngine(backend),
    getSnapshot: () => snapshot,
    notifySnapshotUpdated: () => server.emitEvent({
      type: 'snapshot.updated',
      payload: snapshot,
    }),
    saveSnapshot: () => saveBackendSnapshot(snapshot),
    sendPrompt: (agentId, prompt) => new Promise<BackendConversationRef>((resolve, reject) => {
      const agent = snapshot.agents.find(candidate => candidate.id === agentId);
      if (!agent || agent.status.type === 'working' || agent.status.type === 'awaitingInput') {
        reject(new Error('The automation target is unavailable or busy.'));
        return;
      }
      const driver = requireBackendDriver(backendDrivers, agent);
      mcpService.recordPromptInputMethod(agentId, 'typed');
      sendAgentPrompt(snapshot, driver, agentId, prompt, undefined, event => server.emitEvent(event), {
        onBackendSessionUpdated: (_result, wasNewSession) => setNewConversationTitle(agent, driver, wasNewSession),
        onPromptStarted: result => resolve(conversationRefFromSendResult(agent, result)),
        onPromptFailed: reject,
      });
    }),
  });
  const scheduler = new RuntimeScheduler({
    onError: (taskId, error) => {
      warnMain('runtime-scheduler', 'task failed', {
        taskId,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });
  scheduler.register({
    id: 'automations',
    intervalMs: 60_000,
    runOnStart: true,
    run: () => automationRunner.runAll(),
  });
  scheduler.register({ id: 'provider-updates', intervalMs: 2_000, run: () => providerUpdates.tick() });
  const pullRequestMonitor = new PullRequestMonitor({
    getSnapshot: () => snapshot,
    notifySnapshotUpdated: () => server.emitEvent({
      type: 'snapshot.updated',
      payload: snapshot,
    }),
    onError: (agentId, error) => {
      warnMain('pull-request-monitor', 'check failed', {
        agentId,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    pullRequests: workIntegrations,
    saveSnapshot: () => saveBackendSnapshot(snapshot),
  });
  scheduler.register({
    id: 'pull-request-monitor',
    intervalMs: 5 * 60_000,
    runOnStart: true,
    run: () => pullRequestMonitor.check(),
  });
  const companion = new CompanionManager(path.join(backendHomeDir(), 'companion'), {
    authorizeGuest: (handle, credential) => server.authorizeConversationGuest(handle, credential),
    proposeGuest: (handle, identity, name, input) => server.proposeConversationGuest(handle, identity, name, input),
    guestProposals: (handle, identity) => server.conversationGuestProposals(handle, identity),
    withdrawGuest: (handle, identity, proposalId) => server.withdrawConversationGuest(handle, identity, proposalId),
    guestCount: (handle, count) => server.conversationGuestCount(handle, count),
    desktopFocused: async () => (await options.requestClient<{ focused: boolean }>(backendMethods.clientFocusGet, {})).focused === true,
    onAccessChanged: (enabled) => server.setCompanionAccessEnabled(enabled),
    async request<Result>(method: string, params?: unknown): Promise<Result> {
      const response = await server.handleMessage(createAppRpcRequest('companion-local', method, params));
      if (response && 'error' in response && method === backendMethods.agentPromptSteer && response.error.code === appRpcErrorCodes.invalidParams) throw new PromptRejectedError('Prompt was rejected before dispatch.');
      if (!response || 'error' in response) throw new Error('Owning daemon operation failed.');
      return response.result as Result;
    },
  });
  server = new AppBackendServer({
    worktreeInitializationForFolder: folder => worktreeManager.getInitializationState(folder),
    requirements,
    usage,
    guestJoins: new GuestJoins({ directory: path.join(backendHomeDir(), 'guest-joins'), relay: relayFromEnvironment(process.env).relay ?? undefined }),
    conversationSharing: { directory: path.join(backendHomeDir(), 'conversation-shares'), endpoint: () => companion.shareEndpoint(), routing: { update: routes => companion.updateShareRoutes(routes), subscribe: listener => companion.onShareRoutingStatus(listener) } },
    companionControl: (input) => companion.control(input),
    documents,
    tasks,
    providerSetup,
    providerUpdates,
    version: options.version,
    snapshot,
    agentGitService,
    agentCreation,
    visualizeService,
    designService,
    driverRpc,
    onEvent: (event) => { companion.event(event); options.emitEvent(event); },
    onBackendEventApplied: (event) => { mcpService.handleBackendEvent(event); tasks.handleEvent(event); automationRunner.handleEvent(event); },
    saveSnapshot: (nextSnapshot) => saveBackendSnapshot(nextSnapshot),
    ensureMissionHome: ensureBackendMissionHome,
    deleteMissionHome: deleteBackendMissionHome,
    inspectPluginStatus: async () => {
      pluginStatus = await loadPluginStatus(snapshot.general.providerHomes?.codex?.homePath);
      return pluginStatus;
    },
    sendAgentMessage: (fromAgentId, toAgentId, content) => mcpService.sendMessage(fromAgentId, toAgentId, content),
    onPromptStarting: (agentId, promptOptions) => {
      mcpService.recordPromptInputMethod(agentId, promptOptions?.inputMethod);
    },
    codeReviewTools: mcpService,
    saveCodeReviewReport: (agent, session) => saveCodeReviewReport(backendHomeDir(), agent, session),
    workIntegrations,
    automationRunner,
    remoteClients: new RemoteDaemonClientManager({
      requestHandlers: {
        [backendMethods.clientExternalOpen]: (params) => options.requestClient(backendMethods.clientExternalOpen, params),
        [backendMethods.clientSpokenAnnouncementQueue]: (params) => options.requestClient(backendMethods.clientSpokenAnnouncementQueue, params),
        [backendMethods.clientDesignCapture]: params => options.requestClient(backendMethods.clientDesignCapture, params),
        [backendMethods.clientBrowserOpen]: (params) => options.requestClient(backendMethods.clientBrowserOpen, params),
        [backendMethods.clientBrowserExecute]: (params) => options.requestClient(backendMethods.clientBrowserExecute, params),
        [backendMethods.clientComputerUseExecute]: (params) => options.requestClient(backendMethods.clientComputerUseExecute, params),
        [backendMethods.clientComputerUseStop]: (params) => options.requestClient(backendMethods.clientComputerUseStop, params),
        [backendMethods.clientComputerUseRequestAccessibility]: (params) => options.requestClient(backendMethods.clientComputerUseRequestAccessibility, params),
        [backendMethods.clientComputerUseStatusGet]: (params) => options.requestClient(backendMethods.clientComputerUseStatusGet, params),
        [backendMethods.clientSystemPermissionsGet]: (params) => options.requestClient(backendMethods.clientSystemPermissionsGet, params),
        [backendMethods.clientSystemPermissionsAccessibilityOpen]: (params) => options.requestClient(backendMethods.clientSystemPermissionsAccessibilityOpen, params),
        [backendMethods.clientSystemPermissionsScreenRecordingOpen]: (params) => options.requestClient(backendMethods.clientSystemPermissionsScreenRecordingOpen, params),
      },
    }),
    sshConnections: new SshConnectionService(),
    systemPermissions: {
      getStatus: () => options.requestClient<SystemPermissionsStatus>(backendMethods.clientSystemPermissionsGet),
      openAccessibilitySettings: () => options.requestClient<SystemPermissionsStatus>(backendMethods.clientSystemPermissionsAccessibilityOpen),
      openScreenRecordingSettings: () => options.requestClient<SystemPermissionsStatus>(backendMethods.clientSystemPermissionsScreenRecordingOpen),
    },
  });
  mcpService.setDriverRpc(driverRpc);
  mcpService.setEventSink((event) => server.emitEvent(event));
  await automationRunner.recoverInterruptedRuns();
  await tasks.recover();
  scheduler.start();
  void companion.control({ action: 'status' }).catch(() => warnMain('companion', 'identity or relay unavailable', {}));
  void server.initialize().catch((error) => warnMain('startup', 'backend initialization failed', {
    message: error instanceof Error ? error.message : String(error),
  }));

  return {
    server,
    async stop() {
      await worktreeManager.close();
      await companion.stop();
      tasks.close();
      scheduler.stop();
      await server.close();
      workIntegrations.close();
      await mcpService.stop();
    },
  };
}

function requireBackendDriver(drivers: Map<Agent['backend'], AgentBackendDriver>, agent: Agent): AgentBackendDriver {
  const driver = drivers.get(agent.backend);
  if (!driver) {
    throw new Error(`Backend driver is not configured: ${agent.backend}`);
  }
  return driver;
}

function setNewConversationTitle(agent: Agent, driver: AgentBackendDriver, wasNewSession: boolean): void {
  if (!wasNewSession || !driver.setConversationTitle || !shouldSyncConversationTitleFromAgent(agent)) {
    return;
  }

  agent.conversationTitle = formatConversationTitle(agent);
  void Promise.resolve(driver.setConversationTitle(agent, agent.conversationTitle)).catch((error) => {
    warnMain('conversation-title', 'failed', {
      agentId: agent.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

function conversationRefFromSendResult(agent: Agent, result: BackendSendResult): BackendConversationRef {
  return conversationRefFromAgent({ ...agent, backendSession: result.backendSession })!;
}
