import { DictationSettingsStore } from './dictation-settings';
import { createDictationSpeechPreparer, createDictationSpeechStarter } from './dictation-routing';
import type { HarnessProvider, AppApi, WorkProviderConnectOptions } from '@workspace/core/contracts';
import { isConversationFrame } from '@workspace/core/companion-protocol';
import { mobileRuntimePaths } from './mobile/runtime';
import { MobileSimulatorService } from './mobile/service';
import { NativeMobileAdapter } from './mobile/adapter';
import type { MobileRequest, MobileResult } from '@workspace/core/mobile-simulator';
import { product } from '@workspace/core/product';
import { registerMissionIpcHandlers } from './mission-ipc';
import type { MissionReviewDebugState, MissionStage } from '@workspace/core/missions';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { agentResponseFromClientResponse } from '@workspace/core/agent-request';
import { projectClientSnapshot, splitSettingsInput } from '@workspace/core/client-preferences';
import { requireAgentFolder } from '@workspace/core/agent-folder';
import { encodedAppError } from '@workspace/core/app-error';
import { mainT } from './i18n';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, powerMonitor, protocol, safeStorage, shell } from 'electron';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { registerNativeIpc, sendIpcEvent, TypedIpcMain } from '@korus-dev/agent-ui-sdk/electron';
import { AgentActivityPowerSaveBlocker } from './agent-activity-power-save-blocker';
import { initializeMainLogging, installProcessErrorLogging, logMain, warnMain } from './log';
import { COMPACT_MIN_SIZE, createMainWindow } from './main-window';
import { featureAgentIds } from '@workspace/core/feature-groups';
import { WindowRegistry } from './window-registry';
import { readWindowLayout, restorableWindows, writeWindowLayout, type WindowFrame, type WindowLayout } from './window-layout';
import { isWindowSetup, isWindowViewState, type ComposerDraft, type NativeResource, type WindowContext, type WindowViewState } from '@workspace/core/windows';
import { createRuntimeAppBackendClient, type AppBackendClientPort } from './backend-client';
import { getDaemonStatus, refreshDaemon, setDaemonEnabled } from './daemon-launch-agent';
import { ensureCurrentDaemonForStartup } from './daemon-startup-maintenance';
import { isAppSnapshotGetResult, type AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { decodeAppSnapshot, isClientState, type DecodedAppSnapshot } from '@workspace/core/snapshot-guards';
import { applyMainEventToSnapshot, replaceAppSnapshot } from '@workspace/core/snapshot';
import { spokenAnnouncementVoices, type AddSshConnectionInput, type AgentFilePreviewResult, type AgentFileSearchItem, type ApprovalPreset, type AppCommand, type AppPluginStatus, type AppSnapshot, type ProviderConnectionState, type ProviderModelOption, type ProviderPluginSummary, type ProviderSkillSummary, type BrowserAnnotation, type BrowserBounds, type BrowserState, type BrowserViewportBounds, type DaemonStatus, type ClaudeAuthentication, type ClientRequestResponse, type CodexAuthentication, type CodexChatGptLogin, type CodexResourceSharingStatus, type ConversationListInput, type ConversationResumeTarget, type ConversationSummary, type CreateAgentInput, type CreateAutomationInput, type CreateQuickChatInput, type CreateSourceWorktreeInput, type CreateTeamInput, type ClientState, type DesktopUpdateStatus, type DevicePairingSession, type DevicePairingStatus, type DuplicateAgentOptions, type AutomationLocation, type MainToRendererEvent, type MoveAgentToTeamInput, type OpenInApplication, type OpenInApplicationCatalog, type PairedDevice, type RendererMessage, type RendererSendPromptOptions, type RendererSnapshotState, type ReorderAgentsInput, type ReorderRepositoriesInput, type ReorderTeamsInput, type SendPromptOptions, type SetCodexResourceSharingInput, type SourceFolderListing, type SourceFolderListInput, type SourceRepository, type SourceWorktree, type SpokenAnnouncementQueueResult, type SpokenAnnouncementVoice, type SshHostCandidate, type SystemPermissionsStatus, type UpdateAgentInput, type UpdateAutomationInput, type UpdateRemoteConnectionInput, type UpdateSettingsInput, type UpdateTeamInput, type WorkBacklogConfigurationInput, type WorkItem, type WorkProviderConnectResult, type WorkProviderKind, type WorkSource } from '@workspace/core/contracts';
import { ipcChannels, type AppIpcEvents, type AppIpcRequests } from '@workspace/core/ipc';
import { sendAppCommand, sendRendererEvent } from './ipc-events';
import { installAppMenu, type AppMenuCallbacks, type DebugCodeReviewScenario } from './app-menu';
import { runPerformanceCapture } from './performance-capture-dialog';
import type { ThreadFlagId } from '@workspace/core/thread-flags';
import { DesktopAutoUpdateService } from './auto-update';
import { BrowserPane, browserPaneKey } from './browser-pane';
import { BrowserExtensions } from './browser-extensions';
import { cleanupLegacyBrowserProfiles } from './browser-profile-cleanup';
import { launchChatGptApp } from './chatgpt-app';
import { appCommandFromDeepLink, appDeepLinkScheme, deepLinksFromArgv } from './deep-links';
import { ManualUpdateCheckController } from './manual-update-check';
import { AppshotsKeyMonitor } from './appshots-key-monitor';
import { captureAppshot as captureFrontmostAppshot } from './appshots';
import { createOpenInProvider, resolveProjectPath, type OpenInProvider } from './open-in';
import { installLocalMediaProtocol as installLocalMediaProtocolHandler, LocalMediaAttachmentRegistry, LocalMediaRegistry, withRendererMediaUrls } from './local-media';
import { createRuntimeSpokenAnnouncementQueue, PolicyAwareSpokenAnnouncementQueue, type SpokenAnnouncementQueue } from './spoken-announcements';
import { registerAgentGitIpcHandlers } from './agent-git-ipc';
import { installMacAppBeforeStartup } from './mac-install';

type AppLifecycle = Pick<typeof app, 'exit' | 'quit' | 'relaunch'>;
type BadgeApplication = Pick<typeof app, 'setBadgeCount'>;
type StartupMaintenance = () => Promise<void>;
type SpokenAnnouncementQueuePort = Pick<SpokenAnnouncementQueue, 'dispose' | 'queue' | 'queueWithCompletion'>;
type ClientEventInput<Event extends MainToRendererEvent = MainToRendererEvent> = Event extends MainToRendererEvent
  ? Omit<Event, 'seq' | 'source' | 'occurredAt'>
  : never;
type DebugFlags = { missingEngines?: boolean; providerUpgrades?: boolean; reviewUncommitted?: boolean };
type PendingBrowserOpen = {
  agentId: string;
  browserId: string;
  url: string;
  resolve(state: BrowserState): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

export class AppController {
  private dictationSettingsStore: DictationSettingsStore | undefined;
  private dictationSettings(): DictationSettingsStore {
    return this.dictationSettingsStore ??= new DictationSettingsStore(app.getPath('userData'), safeStorage, process.platform);
  }
  private extensionService: BrowserExtensions | null = null;
  private extensions(): BrowserExtensions {
    return this.extensionService ??= new BrowserExtensions({
      parent: () => this.currentWindow() ?? null,
      request: (input) => this.requireBackendClient().request(backendMethods.browserExtensionPackages, { input }),
    });
  }
  /** Every open window. The daemon owns product state; this only tracks what belongs to a window. */
  private readonly windows = new WindowRegistry<BrowserWindow>();
  private readonly nativeLifecycles = new WeakMap<BrowserWindow, { cleanup: Promise<void> }>();
  /** Where the open windows are remembered. Unset until the app asks for it, so nothing else writes there. */
  private layoutFile: string | null = null;
  private layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Main retains product metadata only; full transcripts are transient IPC values. */
  private snapshot: AppSnapshot | null = null;
  private clientState: ClientState = createEmptyClientState();
  private backendClientEventUnsubscribe: (() => void) | null = null;
  private backendClientConnectionUnsubscribe: (() => void) | null = null;
  private nativeIpcUnregister: (() => void) | null = null;
  private readonly localMediaRegistry = new LocalMediaRegistry();
  private readonly nativeAttachmentRegistry = new LocalMediaAttachmentRegistry(this.localMediaRegistry);
  private lastBackendEventSeq = 0;
  private clientEventSeq = 0;
  private backendEventBuffer: AppBackendEvent[] | null = null;
  private backendSynchronization: Promise<AppSnapshot> | null = null;
  private readonly transientSnapshots = new Set<AppSnapshot>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shuttingDown = false;
  private connectionState: ProviderConnectionState = { status: 'connecting' };
  /** Debug fixtures live in one window's renderer, so their menu state follows that window. */
  private readonly debugFlags = new WeakMap<BrowserWindow, DebugFlags>();
  private readonly pendingDeepLinkCommands: AppCommand[] = [];
  private readonly pendingBrowserOpens = new Map<string, PendingBrowserOpen>();
  private autoUpdateService: DesktopAutoUpdateService | null = null;
  private manualUpdateCheckController: ManualUpdateCheckController | null = null;
  private desktopUpdateStatus: DesktopUpdateStatus = { state: 'idle' };
  private selectedMissionId: string | null = null;
  private appshotCapturePending = false;
  private debugBackendRestartPending = false;

  private readonly mobileSimulator = new MobileSimulatorService(new NativeMobileAdapter(mobileRuntimePaths({
    isPackaged: Boolean(app?.isPackaged),
    appPath: app?.getAppPath?.() ?? process.cwd(),
    resourcesPath: process.resourcesPath,
  })));

  private readonly browserPane = new BrowserPane({
    onGuestReady: (agentId, browserId, contents, window) => this.extensions().attachGuest(agentId, browserId, contents, window),
    onGuestSelected: (agentId, browserId) => { void this.extensions().selectGuest(agentId, browserId).catch(() => {}); },
    onAnnotation: (annotation) => this.emitBrowserAnnotation(annotation),
    onViewportRequest: (request, window) => {
      if (window.isDestroyed()) throw new Error('Browser window is not available.');
      sendAppCommand(window.webContents, { type: 'set-browser-viewport', ...request });
    },
  });

  private readonly powerSaveBlocker = new AgentActivityPowerSaveBlocker();
  private lockHoldTimer: ReturnType<typeof setTimeout> | undefined;
  private clearingLockHold = false;
  private readonly handlePowerSourceChanged = (): void => {
    this.syncPowerSaveBlocker();
  };
  private powerSourceListenersInstalled = false;
  private readonly backendClient: AppBackendClientPort | null;
  private readonly policyAwareSpokenAnnouncements: PolicyAwareSpokenAnnouncementQueue;

  constructor(
    initialSnapshot: AppSnapshot | null = null,
    backendClient: AppBackendClientPort | null | undefined = undefined,
    private readonly appLifecycle: AppLifecycle = app,
    private readonly startupMaintenance: StartupMaintenance = async () => undefined,
    private readonly openExternal: (url: string) => Promise<unknown> = (url) => shell.openExternal(url),
    private readonly appshotsKeyMonitor: AppshotsKeyMonitor | null = null,
    private readonly daemonStatusLoader: () => Promise<DaemonStatus> = () => getDaemonStatus(),
    private readonly daemonRefresher: () => Promise<DaemonStatus> = () => refreshDaemon(),
    private readonly openInProvider: OpenInProvider = createOpenInProvider(),
    private readonly badgeApplication: BadgeApplication = app,
    private readonly spokenAnnouncements: SpokenAnnouncementQueuePort = createRuntimeSpokenAnnouncementQueue({
      appPath: app?.getAppPath?.() ?? process.cwd(),
      isPackaged: app?.isPackaged ?? false,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
    }),
  ) {
    this.snapshot = initialSnapshot;
    this.policyAwareSpokenAnnouncements = new PolicyAwareSpokenAnnouncementQueue(
      this.spokenAnnouncements,
      () => ({
        activeAgentId: this.currentSelectedAgentId(),
        visibleAgentIds: this.windows.visibleAgentIdsOf(this.windows.focused()),
        enabled: this.snapshot?.general.spokenAnnouncementsEnabled === true,
        focused: this.windows.anyFocused(),
        muted: this.snapshot?.general.spokenAnnouncementsMuted === true,
        onlyWhenFocused: this.snapshot?.general.spokenAnnouncementsOnlyWhenFocused === true,
        scope: this.snapshot?.general.spokenAnnouncementScope ?? 'selected',
      }),
    );
    this.backendClient = backendClient ?? createRuntimeAppBackendClient({
      debugRestartBackend: app?.isPackaged ? undefined : input => this.requestDebugBackendRestart(input),
      mobileSimulator: (agentId, input) => this.executeMobileSimulator(agentId, input),
      browserOpen: (agentId, browserId, url) => this.requestBrowserOpen(agentId, browserId, url),
      browserExecute: (agentId, browserId, command, arguments_) => this.browserPane.execute(agentId, browserId, command, arguments_),
      spokenAnnouncements: this.policyAwareSpokenAnnouncements,
      spokenAnnouncementVoice: () => this.snapshot?.general.spokenAnnouncementVoice ?? 'af_heart',
    });
  }

  async initialize(): Promise<void> {
    logMain('startup', 'initializing application');
    if (!this.powerSourceListenersInstalled && powerMonitor) {
      powerMonitor.on('on-battery', this.handlePowerSourceChanged);
      powerMonitor.on('on-ac', this.handlePowerSourceChanged);
      powerMonitor.on('resume', this.handleTelemetryActivity);
      this.powerSourceListenersInstalled = true;
    }
    this.autoUpdateService?.start();
    await this.startupMaintenance();
    await this.initializeBackendClient();
    this.syncAppshotsKeyMonitor();
    this.syncPowerSaveBlocker();
    this.syncNativeAppearance();
    logMain('startup', 'application initialized');
  }

  installLocalMediaProtocol(): void {
    installLocalMediaProtocolHandler(this.localMediaRegistry, protocol, (url) => net.fetch(url));
  }

  setAutoUpdateService(service: DesktopAutoUpdateService): void {
    this.autoUpdateService = service;
    this.desktopUpdateStatus = service.getStatus();
    this.manualUpdateCheckController = new ManualUpdateCheckController({
      getWindow: () => this.currentWindow() ?? null,
      installUpdate: () => this.installUpdate(),
      showMessageBox: (window, options) => window
        ? dialog.showMessageBox(window, options)
        : dialog.showMessageBox(options),
    });
  }

  setDesktopUpdateStatus(status: DesktopUpdateStatus): void {
    this.desktopUpdateStatus = status;
    if (this.windows.live().length) {
      for (const window of this.windows.live()) window.webContents.send(ipcChannels.updateStatusChanged, status);
      this.refreshAppMenu();
    }
    this.manualUpdateCheckController?.handleStatus(status);
  }

  registerIpcHandlers(): void {
    this.nativeIpcUnregister?.();
    this.nativeIpcUnregister = registerNativeIpc(
      { clipboard, dialog, ipcMain, shell },
      {
        prepareSpeechSession: (input, onEvent, options) => createDictationSpeechPreparer(this.dictationSettings())(input, onEvent, options),
        startSpeechSession: (input, onEvent, options) => createDictationSpeechStarter(this.dictationSettings())(input, onEvent, options),
      },
      this.nativeAttachmentRegistry,
    );
    const ipc = new TypedIpcMain<AppIpcRequests>(ipcMain);
    ipc.handle(ipcChannels.getDictationSettings, () => this.dictationSettings().get());
    ipc.handle(ipcChannels.getDictationApiKey, () => this.dictationSettings().apiKey() ?? null);
    ipc.handle(ipcChannels.updateDictationSettings, (_event, input) => this.dictationSettings().update(input));
    ipc.handle(ipcChannels.getSnapshot, () => this.getSnapshot());
    ipc.handle(ipcChannels.browserExtensions, (_event, agentId, action, id, browserId) => {
      if (agentId !== null && !this.snapshot?.agents.some(agent => agent.id === agentId)) throw new Error('Agent not found.');
      if (action === 'open' && agentId === null) throw new Error('Select a browser tab first.');
      return this.extensions().manage(agentId, action, id, browserId);
    });
    ipc.handle(ipcChannels.getSnapshotState, () => this.getSnapshotState());

    ipc.handle(ipcChannels.listSshHosts, () => {
      return this.listSshHosts();
    });

    ipc.handle(ipcChannels.addSshConnection, async (_event, input: AddSshConnectionInput) => {
      return this.addSshConnection(input);
    });

    ipc.handle(ipcChannels.checkRemoteConnection, async (_event, connectionId: string, inspectOnly?: boolean, providers?: HarnessProvider[]) => {
      return this.checkRemoteConnection(connectionId, inspectOnly, providers);
    });

    ipc.handle(ipcChannels.updateRemoteConnection, async (_event, connectionId: string, input: UpdateRemoteConnectionInput) => {
      return this.updateRemoteConnection(connectionId, input);
    });

    ipc.handle(ipcChannels.removeRemoteConnection, async (_event, connectionId: string) => {
      return this.removeRemoteConnection(connectionId);
    });

    ipc.handle(ipcChannels.guestConversationControl, (_event, input) => this.requireBackendClient().request(backendMethods.guestConversationControl, { input }));
    ipc.handle(ipcChannels.guestConversationImage, (_event, id, path) => this.requireBackendClient().request(backendMethods.guestConversationImage, { id, path }));
    ipc.handle(ipcChannels.guestConversationContent, (_event, id, input) => this.requireBackendClient().request(backendMethods.guestConversationContent, { id, input }));
    ipc.handle(ipcChannels.conversationShareControl, (_event, input) => this.requireBackendClient().request(backendMethods.conversationShareControl, { input }));
    ipc.handle(ipcChannels.companionControl, (_event, input) => this.requireBackendClient().request(backendMethods.companionControl, { input }));
    ipc.handle(ipcChannels.getRemoteControlStatus, () => this.getRemoteControlStatus());
    ipc.handle(ipcChannels.enableRemoteControl, () => this.enableRemoteControl());
    ipc.handle(ipcChannels.disableRemoteControl, () => this.disableRemoteControl());
    ipc.handle(ipcChannels.startDevicePairing, () => this.startDevicePairing());
    ipc.handle(ipcChannels.checkDevicePairing, (_event, session: DevicePairingSession) => this.checkDevicePairing(session));
    ipc.handle(ipcChannels.listPairedDevices, (_event, environmentId: string) => this.listPairedDevices(environmentId));
    ipc.handle(ipcChannels.revokePairedDevice, (_event, environmentId: string, clientId: string) => this.revokePairedDevice(environmentId, clientId));

    ipc.handle(ipcChannels.connectWorkProvider, async (_event, provider: WorkProviderKind, options?: WorkProviderConnectOptions) => {
      return this.connectWorkProvider(provider, options);
    });


    ipc.handle(ipcChannels.pollWorkProviderAuthorization, async (_event, provider: WorkProviderKind) => {
      return this.pollWorkProviderAuthorization(provider);
    });

    ipc.handle(ipcChannels.disconnectWorkProvider, async (_event, provider: WorkProviderKind) => {
      return this.disconnectWorkProvider(provider);
    });

    ipc.handle(ipcChannels.listWorkSources, async (_event, provider: WorkProviderKind, location?: AutomationLocation) => {
      return this.listWorkSources(provider, location);
    });

    ipc.handle(ipcChannels.configureWorkBacklog, async (_event, input: WorkBacklogConfigurationInput, location?: AutomationLocation) => {
      return this.configureWorkBacklog(input, location);
    });

    ipc.handle(ipcChannels.listGlobalWorkItems, async (_event, provider: WorkProviderKind, location?: AutomationLocation, query?: import('@workspace/core/contracts').GlobalWorkItemQuery) => {
      return this.listGlobalWorkItems(provider, location, query);
    });

    ipc.handle(ipcChannels.listAssignedWorkItems, async (_event, provider: WorkProviderKind, location?: AutomationLocation) => {
      return this.listAssignedWorkItems(provider, location);
    });

    ipc.handle(ipcChannels.listWorkItems, async (_event, provider: WorkProviderKind, repositoryId: string, location?: AutomationLocation, query?: import('@workspace/core/contracts').WorkItemQuery) => {
      return this.listWorkItems(provider, repositoryId, location, query);
    });

    ipc.handle(ipcChannels.listProviderModels, async (_event, agentId: string | null, provider?: import('@workspace/core/contracts').HarnessProvider, remoteConnectionId?: string) => {
      return this.listProviderModels(agentId, provider, remoteConnectionId);
    });

    ipc.handle(ipcChannels.listProviderPlugins, async (_event, agentId: string) => {
      return this.listProviderPlugins(agentId);
    });

    ipc.handle(ipcChannels.listProviderSkills, async (_event, agentId: string) => {
      return this.listProviderSkills(agentId);
    });

    ipc.handle(ipcChannels.getRunProfiles, async (_event, agentId: string) => this.requireBackendClient().request(backendMethods.agentRunProfilesGet, { agentId }));
    ipc.handle(ipcChannels.getRunProfileActions, async (_event, agentId: string, directory: string) => this.requireBackendClient().request(backendMethods.agentRunProfileActionsGet, { agentId, directory }));
    ipc.handle(ipcChannels.saveRunProfile, async (_event, agentId: string, input: unknown) => this.requireBackendClient().request(backendMethods.agentRunProfileSave, { agentId, input }));
    ipc.handle(ipcChannels.deleteRunProfile, async (_event, agentId: string, profileId: string) => this.requireBackendClient().request(backendMethods.agentRunProfileDelete, { agentId, profileId }));
    ipc.handle(ipcChannels.startRunProfile, async (_event, agentId: string, input: unknown) => this.requireBackendClient().request(backendMethods.agentRunProfileStart, { agentId, input }));
    ipc.handle(ipcChannels.stopProfileRun, async (_event, agentId: string, runId: string) => this.requireBackendClient().request(backendMethods.agentProfileRunStop, { agentId, runId }));
    ipc.handle(ipcChannels.stopAgentProfileRuns, async (_event, agentId: string) => this.requireBackendClient().request(backendMethods.agentProfileRunsStop, { agentId }));
    ipc.handle(ipcChannels.listAgentFiles, async (_event, agentId: string) => {
      return this.listAgentFiles(agentId);
    });
    ipc.handle(ipcChannels.listAgentDirectory, (_event, agentId: string, input?: import('@workspace/core/contracts/workspace').AgentDirectoryInput) =>
      this.requireBackendClient().request(backendMethods.agentDirectoryList, { agentId, input }));
    ipc.handle(ipcChannels.listAgentTasks, (_event, agentId) => this.requireBackendClient().request(backendMethods.agentTasksList, { agentId }));
    ipc.handle(ipcChannels.cancelAgentTask, (_event, agentId, taskId) => this.requireBackendClient().request(backendMethods.agentTaskCancel, { agentId, taskId }));

    ipc.handle(ipcChannels.getDocumentWorkspaces, async (_event) => this.requireBackendClient().request(backendMethods.clientWorkspaceGet, {}));
    ipc.handle(ipcChannels.updateDocumentWorkspace, async (_event, agentId: string, change: import('@workspace/core/document-workspace').DocumentWorkspaceChange) => this.requireBackendClient().request(backendMethods.clientWorkspaceApply, { agentId, change }));
    ipc.handle(ipcChannels.readWorkspaceDocument, async (_event, agentId: string, tabId: string) => this.requireBackendClient().request(backendMethods.clientDocumentRead, { agentId, tabId }));
    ipc.handle(ipcChannels.saveWorkspaceDocument, async (_event, agentId: string, input: import('@workspace/core/document-workspace').DocumentSaveInput) => this.requireBackendClient().request(backendMethods.clientDocumentSave, { agentId, input }));
    ipc.handle(ipcChannels.chooseDocumentSavePath, async (_event, defaultPath: string) => {
      const result = await dialog.showSaveDialog({ defaultPath, filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
      return result.canceled ? null : result.filePath ?? null;
    });
    ipc.handle(ipcChannels.previewAgentFile, async (_event, agentId: string, filePath: string) => {
      return this.previewAgentFile(agentId, filePath);
    });
    ipc.handle(ipcChannels.readAgentFileChunk, (_event, agentId, filePath, offset) =>
      this.requireBackendClient().request(backendMethods.agentFileChunkRead, { agentId, filePath, offset }));

    registerAgentGitIpcHandlers(ipc, () => this.requireBackendClient());

    ipc.handle(ipcChannels.getOpenInApplications, () => this.getOpenInApplications());
    ipc.handle(ipcChannels.openAgentPath, (_event, agentId: string, application: OpenInApplication, filePath?: string) => {
      return this.openAgentPath(agentId, application, filePath);
    });
    ipc.handle(ipcChannels.openAgentFile, (_event, agentId, filePath, action) => this.openAgentFile(agentId, filePath, action));

    ipc.handle(ipcChannels.chooseAgentFolder, async () => {
      return this.chooseAgentFolder();
    });

    ipc.handle(ipcChannels.chooseSourceFolder, async () => {
      return this.chooseSourceFolder();
    });

    ipc.handle(ipcChannels.listSourceFolders, async (_event, input?: SourceFolderListInput) => {
      return this.listSourceFolders(input);
    });

    ipc.handle(ipcChannels.listSourceRepositories, async (_event, remoteConnectionId?: string) => {
      return this.listSourceRepositories(remoteConnectionId);
    });

    ipc.handle(ipcChannels.cloneSourceRepository, async (_event, input: import('@workspace/core/contracts').CloneSourceRepositoryInput) => {
      try {
        return await this.cloneSourceRepository(input);
      } catch (error) {
        throw encodedAppError(error);
      }
    });

    ipc.handle(ipcChannels.createSourceRepository, async (_event, input: import('@workspace/core/contracts').CreateSourceRepositoryInput) => {
      try {
        return await this.createSourceRepository(input);
      } catch (error) {
        throw encodedAppError(error);
      }
    });

    ipc.handle(ipcChannels.featureControl, async (_event, input: import('@workspace/core/feature-groups').FeatureGroupRequest) => {
      const result = await this.requireBackendClient().request<import('@workspace/core/feature-groups').FeatureGroupResult>(backendMethods.featureControl, { input });
      if (result.kind === 'updated') this.adoptBackendSnapshot(result.snapshot);
      return result;
    });

    ipc.handle(ipcChannels.previewRepositoryDeletion, (_event, agentId: string) => this.requireBackendClient().request(backendMethods.repositoryDeletePreview, { agentId }));
    ipc.handle(ipcChannels.deleteRepository, async (_event, agentId: string, input: import('@workspace/core/contracts/workspace').DeleteRepositoryInput) =>
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.repositoryDelete, { agentId, input })));

    ipc.handle(ipcChannels.createProject, async (_event, input: import('@workspace/core/contracts').CreateProjectInput) => {
      try {
        return await this.createProject(input);
      } catch (error) {
        throw encodedAppError(error);
      }
    });

    ipc.handle(ipcChannels.listSourceBranches, async (_event, repoPath: string, remoteConnectionId?: string) => {
      return this.listSourceBranches(repoPath, remoteConnectionId);
    });

    ipc.handle(ipcChannels.listSourceWorktrees, async (_event, repoPath: string, remoteConnectionId?: string) => {
      return this.listSourceWorktrees(repoPath, remoteConnectionId);
    });

    ipc.handle(ipcChannels.suggestSourceWorktreePath, async (_event, input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath' | 'remoteConnectionId'>) => {
      return this.suggestSourceWorktreePath(input);
    });

    ipc.handle(ipcChannels.chooseSourceWorktreeDestination, async (_event, defaultPath: string) => {
      return this.chooseSourceWorktreeDestination(defaultPath);
    });

    ipc.handle(ipcChannels.createSourceWorktree, async (_event, input: CreateSourceWorktreeInput) => {
      return this.createSourceWorktree(input);
    });

    ipc.handle(ipcChannels.createTeam, async (_event, input: CreateTeamInput) => {
      return this.createTeam(input);
    });

    ipc.handle(ipcChannels.updateTeam, async (_event, input: UpdateTeamInput) => {
      return this.updateTeam(input);
    });

    ipc.handle(ipcChannels.reorderTeams, async (_event, input: ReorderTeamsInput) => {
      return this.reorderTeams(input);
    });

    ipc.handle(ipcChannels.closeTeam, async (_event, teamId: string) => {
      return this.closeTeam(teamId);
    });

    ipc.handle(ipcChannels.selectTeam, async (_event, teamId: string) => {
      return this.selectTeam(teamId);
    });


    ipc.handle(ipcChannels.getAutomationSnapshot, async (_event, location?: AutomationLocation) => {
      return this.getAutomationSnapshot(location);
    });

    ipc.handle(ipcChannels.createAutomation, async (_event, input: CreateAutomationInput, location?: AutomationLocation) => {
      return this.createAutomation(input, location);
    });

    ipc.handle(ipcChannels.updateAutomation, async (_event, input: UpdateAutomationInput, location?: AutomationLocation) => {
      return this.updateAutomation(input, location);
    });

    ipc.handle(ipcChannels.runAutomation, async (_event, automationId: string, location?: AutomationLocation) => {
      return this.runAutomation(automationId, location);
    });

    ipc.handle(ipcChannels.clearAutomationHistory, async (_event, automationId: string, location?: AutomationLocation) => {
      return this.clearAutomationHistory(automationId, location);
    });

    ipc.handle(ipcChannels.deleteAutomationExecution, async (_event, automationId: string, executionId: string, location?: AutomationLocation) => {
      return this.deleteAutomationExecution(automationId, executionId, location);
    });

    ipc.handle(ipcChannels.deleteAutomation, async (_event, automationId: string, location?: AutomationLocation) => {
      return this.deleteAutomation(automationId, location);
    });

    ipc.handle(ipcChannels.listAgentConversations, async (_event, agentId: string, input?: ConversationListInput) => {
      return this.listAgentConversations(agentId, input);
    });

    ipc.handle(ipcChannels.resumeAgentConversation, async (_event, agentId: string, target: ConversationResumeTarget) => {
      return this.resumeAgentConversation(agentId, target);
    });

    ipc.handle(ipcChannels.readConversationMessages, async (_event, ref: unknown, agentId: string, location?: AutomationLocation) => {
      return this.readConversationMessages(ref, agentId, location);
    });

    ipc.handle(ipcChannels.createAgent, async (_event, input: CreateAgentInput) => {
      return this.createAgent(input);
    });

    registerMissionIpcHandlers(
      ipc,
      () => this.requireBackendClient(),
      snapshot => this.adoptBackendSnapshot(snapshot),
      missionId => this.selectMission(missionId),
    );
    ipc.handle(ipcChannels.createQuickChat, async (_event, input: CreateQuickChatInput) => {
      return this.createQuickChat(input);
    });

    ipc.handle(ipcChannels.updateAgent, async (_event, input: UpdateAgentInput) => {
      return this.updateAgent(input);
    });

    ipc.handle(ipcChannels.assignWorkItemToAgent, async (_event, agentId: string, item: unknown) => {
      return this.assignWorkItemToAgent(agentId, item);
    });

    ipc.handle(ipcChannels.removeWorkItemAssignment, async (_event, item: unknown) => {
      return this.removeWorkItemAssignment(item);
    });

    ipc.handle(ipcChannels.duplicateAgent, async (_event, agentId: string, options?: DuplicateAgentOptions) => {
      return this.duplicateAgent(agentId, options);
    });

    ipc.handle(ipcChannels.forkAgent, async (_event, agentId: string, turnId?: string) => {
      return this.forkAgent(agentId, turnId);
    });
    ipc.handle(ipcChannels.handoffAgent, async (_event, agentId: string, input: import('@workspace/core/agent-handoff').AgentHandoffInput) => {
      return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentHandoff, { agentId, input }));
    });

    ipc.handle(ipcChannels.moveAgentToTeam, async (_event, input: MoveAgentToTeamInput) => {
      return this.moveAgentToTeam(input);
    });

    ipc.handle(ipcChannels.reorderAgents, async (_event, input: ReorderAgentsInput) => {
      return this.reorderAgents(input);
    });

    ipc.handle(ipcChannels.reorderRepositories, async (_event, input: ReorderRepositoriesInput) => {
      return this.reorderRepositories(input);
    });


    ipc.handle(ipcChannels.restartAgent, async (_event, agentId: string) => {
      return this.restartAgent(agentId);
    });

    ipc.handle(ipcChannels.compressAgentSession, async (_event, agentId: string) => {
      return this.compressAgentSession(agentId);
    });

    ipc.handle(ipcChannels.loadConversationHistory, async (_event, agentId: string, options?: { recovery?: boolean }) => {
      return this.loadConversationHistory(agentId, options);
    });

    ipc.handle(ipcChannels.loadAgentTurnHistory, async (_event, agentId: string, turnId: string) => {
      await this.requireBackendClient().request(backendMethods.agentConversationTurnHistoryLoad, { agentId, turnId });
    });
    ipc.handle(ipcChannels.loadOlderAgentHistory, async (_event, agentId: string) => {
      return this.loadOlderAgentHistory(agentId);
    });
    ipc.handle(ipcChannels.readConversationContent, async (_event, agentId: string, input) => {
      return this.requireBackendClient().request(backendMethods.agentConversationContentRead, { agentId, input });
    });

    ipc.handle(ipcChannels.closeAgent, async (_event, agentId: string, input) => {
      return this.closeAgent(agentId, input);
    });

    ipc.handle(ipcChannels.markAgentRead, (_event, agentId: string, revision: number) => this.requireBackendClient().request(backendMethods.agentMarkRead, { agentId, revision }));

    ipc.handle(ipcChannels.selectAgent, async (_event, agentId: string) => {
      return this.selectAgent(agentId);
    });

    ipc.handle(ipcChannels.getUsage, (_event, filter) => this.requireBackendClient().request(backendMethods.usageGet,{filter}));
    ipc.handle(ipcChannels.getTelemetryConsent, () => this.requireBackendClient().request(backendMethods.telemetryConsentGet));
    ipc.handle(ipcChannels.changeTelemetryConsent, (_event, action) => this.requireBackendClient().request(backendMethods.telemetryConsentChange, {action}));
    ipc.handle(ipcChannels.previewTelemetryDay, (_event, day) => this.requireBackendClient().request(backendMethods.telemetryProfilePreview, {day}));
    ipc.handle(ipcChannels.clearUsage, () => this.requireBackendClient().request(backendMethods.usageClear));

    ipc.handle(ipcChannels.updateSettings, async (_event, input: UpdateSettingsInput) => {
      return this.updateSettings(input);
    });
    ipc.handle(ipcChannels.previewSpokenAnnouncementVoice, (_event, voice: SpokenAnnouncementVoice) => {
      return this.previewSpokenAnnouncementVoice(voice);
    });
    ipc.handle(ipcChannels.getCodexResourceSharingStatus, () => this.getCodexResourceSharingStatus());
    ipc.handle(ipcChannels.setCodexResourceSharing, async (_event, input: SetCodexResourceSharingInput) => {
      return this.setCodexResourceSharing(input);
    });
    ipc.handle(ipcChannels.getPluginStatus, () => this.getPluginStatus());
    ipc.handle(ipcChannels.readEngineInstructions, (_event, engine) => this.requireBackendClient().request<{ text: string; path: string }>(backendMethods.engineInstructionsRead, { engine }));
    ipc.handle(ipcChannels.manageSkills, (_event, input) => this.requireBackendClient().request(backendMethods.skillsManage, { input }));
    ipc.handle(ipcChannels.saveEngineInstructions, (_event, input) => this.requireBackendClient().request<void>(backendMethods.engineInstructionsSave, { input }));
    ipc.handle(ipcChannels.getCodexAuthentication, (_event, remoteConnectionId?: string) => this.getCodexAuthentication(remoteConnectionId));
    ipc.handle(ipcChannels.getClaudeAuthentication, (_event, remoteConnectionId?: string) => this.getClaudeAuthentication(remoteConnectionId));
    ipc.handle(ipcChannels.getProviderSetup, (_event, remoteConnectionId) => this.requireBackendClient().request(backendMethods.providerSetupGet, { remoteConnectionId }));
    ipc.handle(ipcChannels.getProviderUpdate, (_event, provider, remoteConnectionId, refresh) => this.requireBackendClient().request(backendMethods.providerUpdateGet, { provider: provider, remoteConnectionId, refresh }));
    ipc.handle(ipcChannels.setProviderUpdate, (_event, provider, input, remoteConnectionId) => this.requireBackendClient().request(backendMethods.providerUpdateSet, { provider: provider, input, remoteConnectionId }));
    ipc.handle(ipcChannels.getProviderConnections, (_event, remoteConnectionId) => this.requireBackendClient().request(backendMethods.providerConnectionsGet, { remoteConnectionId }));
    ipc.handle(ipcChannels.getBankedResets, (_event, remoteConnectionId) => this.requireBackendClient().request(backendMethods.bankedResetsGet, { remoteConnectionId }));
    ipc.handle(ipcChannels.useBankedReset, (_event, input, remoteConnectionId) => this.requireBackendClient().request(backendMethods.bankedResetUse, { input, remoteConnectionId }));
    ipc.handle(ipcChannels.getProviderUsage, (_event, provider) => this.requireBackendClient().request(backendMethods.providerUsageGet, { provider: provider }));
    ipc.handle(ipcChannels.setProviderEnabled, (_event, provider, enabled, remoteConnectionId) => this.requireBackendClient().request(backendMethods.providerEnabledSet, { provider: provider, enabled, remoteConnectionId }));
    ipc.handle(ipcChannels.disconnectProvider, (_event, provider, remoteConnectionId) => this.requireBackendClient().request(backendMethods.providerDisconnect, { provider: provider, remoteConnectionId }));
    ipc.handle(ipcChannels.authenticateProvider, (_event, provider, action) => this.requireBackendClient().request(backendMethods.providerAuthenticate, { provider: provider, action }));
    ipc.handle(ipcChannels.configureProviderSetup, (_event, provider, choice) => this.requireBackendClient().request(backendMethods.providerSetupConfigure, { provider: provider, choice }));
    ipc.handle(ipcChannels.installProvider, (_event, provider, remoteConnectionId) => this.requireBackendClient().request(backendMethods.providerInstall, { provider: provider, remoteConnectionId }));
    ipc.handle(ipcChannels.refreshProvider, (_event, provider, remoteConnectionId) => this.requireBackendClient().request(backendMethods.providerRefresh, { provider: provider, remoteConnectionId }));
    ipc.handle(ipcChannels.cancelCodexChatGptLogin, (_event, remoteConnectionId?: string, loginId?: string) => this.cancelCodexChatGptLogin(remoteConnectionId, loginId));
    ipc.handle(ipcChannels.startCodexChatGptDeviceCodeLogin, (_event, remoteConnectionId: string) => {
      return this.startCodexChatGptDeviceCodeLogin(remoteConnectionId);
    });
    ipc.handle(ipcChannels.startCodexChatGptLogin, () => this.startCodexChatGptLogin());
    ipc.handle(ipcChannels.logoutCodex, () => this.logoutCodex());
    ipc.handle(ipcChannels.getUpdateStatus, () => this.desktopUpdateStatus);
    ipc.handle(ipcChannels.installUpdate, () => this.requestInstallUpdate());
    ipc.handle(ipcChannels.setDockBadgeCount, (_event, count: number) => this.setDockBadgeCount(count));
    ipc.handle(ipcChannels.setMenuBarVisible, (_event, visible) => this.setMenuBarVisible(visible));

    ipc.handle(ipcChannels.getDaemonStatus, () => this.getDaemonStatus());

    ipc.handle(ipcChannels.setDaemonEnabled, async (_event, enabled: boolean) => {
      return this.setDaemonEnabled(enabled);
    });

    ipc.handle(ipcChannels.getSystemPermissions, () => this.getSystemPermissions());

    ipc.handle(ipcChannels.openAccessibilitySettings, () => this.openAccessibilitySettings());

    ipc.handle(ipcChannels.openScreenRecordingSettings, () => this.openScreenRecordingSettings());

    ipc.handle(ipcChannels.launchChatGptApp, (_event, input) => launchChatGptApp(input));

    ipc.handle(ipcChannels.quit, () => {
      this.appLifecycle.quit();
    });

    ipc.handle(ipcChannels.restartApp, () => this.restartApp());
    ipc.handle(ipcChannels.reloadRenderer, (event) => this.reloadRenderer(this.windowOf(event)));
    ipc.handle(ipcChannels.getWindowContext, (event) => this.getWindowContext(this.windowOf(event)));
    ipc.handle(ipcChannels.openWindow, (_event, viewState) => this.openWindowFromRenderer(viewState));
    ipc.handle(ipcChannels.setWindowSetup, (event, setup) => this.setWindowSetup(this.windowOf(event), setup));
    ipc.handle(ipcChannels.setWindowSelection, (event, agentId, visibleAgentIds) => {
      const window = this.windowOf(event);
      if (window) this.windows.setSelectedAgent(window, agentId, visibleAgentIds);
      this.policyAwareSpokenAnnouncements.refresh();
      this.scheduleLayoutSave();
    });
    ipc.handle(ipcChannels.claimNativeResource, (event, resource, agentId, takeOver) => this.claimNativeResource(this.windowOf(event), resource, agentId, takeOver === true));
    ipc.handle(ipcChannels.releaseNativeResource, (event, resource, agentId) => this.releaseNativeResource(this.windowOf(event), resource, agentId));
    ipc.handle(ipcChannels.syncComposerDraft, (event, agentId, draft) => this.syncComposerDraft(this.windowOf(event), agentId, draft));

    ipc.handle(ipcChannels.setAgentGoal, (_event, agentId: string, objective: string) => {
      return this.setAgentGoal(agentId, objective);
    });

    ipc.handle(ipcChannels.clearAgentGoal, (_event, agentId: string) => {
      return this.clearAgentGoal(agentId);
    });

    ipc.handle(ipcChannels.setAgentApprovalPreset, (_event, agentId: string, preset: ApprovalPreset) => {
      return this.setAgentApprovalPreset(agentId, preset);
    });

    ipc.handle(ipcChannels.setAgentPermissionMode, (_event, agentId: string, mode: string) => {
      return this.setAgentPermissionMode(agentId, mode);
    });

    ipc.handle(ipcChannels.respondToPlanReview, async (_event, agentId: string, response: import('@workspace/core/plan-review').PlanReviewResponse) => {
      return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentPlanReviewRespond, { agentId, response }));
    });
    ipc.handle(ipcChannels.design, (_event, agentId: string, input: Parameters<AppApi['design']>[1]) => {
      const resolved = input.type === 'open' && input.attachments !== undefined
        ? { ...input, attachments: this.resolveRendererPromptOptions({ attachments: input.attachments })?.attachments }
        : input;
      return this.requireBackendClient().request(backendMethods.agentDesign, { agentId, input: resolved });
    });
    ipc.handle(ipcChannels.startVisualize, async (_event, agentId: string, input?: import('@workspace/core/visualize').StartVisualizeInput) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentVisualizeStart, { agentId, input }))
    ));
    ipc.handle(ipcChannels.setVisualizeOpen, async (_event, agentId: string, input: import('@workspace/core/visualize').SetVisualizeOpenInput) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentVisualizeOpenSet, { agentId, input }))
    ));
    ipc.handle(ipcChannels.generateVisualizationSuggestion, async (_event, agentId: string, input: import('@workspace/core/visualize').GenerateVisualizationSuggestionInput) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentVisualizationSuggestionGenerate, { agentId, input }))
    ));
    ipc.handle(ipcChannels.selectVisualization, async (_event, agentId: string, input: import('@workspace/core/visualize').SelectVisualizationInput) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentVisualizationSelect, { agentId, input }))
    ));
    ipc.handle(ipcChannels.deleteVisualization, async (_event, agentId: string, input: import('@workspace/core/visualize').DeleteVisualizationInput) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentVisualizationDelete, { agentId, input }))
    ));
    ipc.handle(ipcChannels.saveRepositoryVisualization, async (_event, agentId: string, input: import('@workspace/core/visualize').SaveRepositoryVisualizationInput) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentRepositoryVisualizationSave, { agentId, input }))
    ));
    ipc.handle(ipcChannels.saveVisualizationCanvas, (_event, agentId: string, input: import('@workspace/core/visualize-canvas').SaveCanvasInput) => (
      this.requireBackendClient().request(backendMethods.agentVisualizationCanvasSave, { agentId, input })
    ));
    ipc.handle(ipcChannels.readVisualizationAsset, (_event, agentId: string, visualizationId: string) => (
      this.requireBackendClient().request(backendMethods.agentVisualizationAssetGet, { agentId, visualizationId })
    ));
    ipc.handle(ipcChannels.startCodeReview, async (_event, agentId: string, input: import('@workspace/core/code-review').CodeReviewStartInput) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCodeReviewStart, { agentId, input }))
    ));
    ipc.handle(ipcChannels.decideCodeReviewFinding, async (_event, agentId: string, input: import('@workspace/core/code-review').CodeReviewDecisionInput) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCodeReviewFindingDecide, { agentId, input }))
    ));
    ipc.handle(ipcChannels.discussCodeReviewFinding, async (_event, agentId: string, input: import('@workspace/core/code-review').CodeReviewDiscussionInput) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCodeReviewFindingDiscuss, { agentId, input }))
    ));
    ipc.handle(ipcChannels.submitCodeReviewRound, async (_event, agentId: string, sessionId: string) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCodeReviewRoundSubmit, { agentId, sessionId }))
    ));
    ipc.handle(ipcChannels.finishCodeReview, async (_event, agentId: string, sessionId: string) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCodeReviewFinish, { agentId, sessionId }))
    ));
    ipc.handle(ipcChannels.commitCodeReview, async (_event, agentId: string, sessionId: string) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCodeReviewCommit, { agentId, sessionId }))
    ));
    ipc.handle(ipcChannels.switchCodeReviewToManual, async (_event, agentId: string, sessionId: string) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCodeReviewManual, { agentId, sessionId }))
    ));
    ipc.handle(ipcChannels.discardCodeReview, async (_event, agentId: string, sessionId: string) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCodeReviewDiscard, { agentId, sessionId }))
    ));
    ipc.handle(ipcChannels.reviewCodeAgain, async (_event, agentId: string, sessionId: string) => (
      this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCodeReviewAgain, { agentId, sessionId }))
    ));
    ipc.handle(ipcChannels.setAutoResume, async (_event, agentId: string, enabled: boolean) => this.adoptBackendSnapshot(
      await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentAutoResumeSet, { agentId, enabled })
    ));
    ipc.handle(ipcChannels.respondToThreadFlag, async (_event, agentId: string, response: import('@workspace/core/thread-flags').ThreadFlagResponse) => {
      return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentThreadFlagRespond, { agentId, response }));
    });
    ipc.handle(ipcChannels.sendPrompt, (_event, agentId: string, prompt: string, options?: RendererSendPromptOptions) => {
      return this.sendPrompt(agentId, prompt, options);
    });

    ipc.handle(ipcChannels.steerPrompt, (_event, agentId: string, prompt: string, options?: RendererSendPromptOptions) => {
      return this.steerPrompt(agentId, prompt, options);
    });

    ipc.handle(ipcChannels.deleteQueuedPrompt, (_event, agentId: string, promptId: string) => {
      return this.deleteQueuedPrompt(agentId, promptId);
    });

    ipc.handle(ipcChannels.updateQueuedPrompt, (_event, agentId: string, promptId: string, prompt: string, options?: Pick<RendererSendPromptOptions, 'content'>) => {
      return this.updateQueuedPrompt(agentId, promptId, prompt, options);
    });

    ipc.handle(ipcChannels.steerQueuedPrompt, (_event, agentId: string, promptId: string, prompt?: string, options?: Pick<RendererSendPromptOptions, 'content'>) => {
      return this.steerQueuedPrompt(agentId, promptId, prompt, options);
    });

    ipc.handle(ipcChannels.interruptAgent, (_event, agentId: string) => {
      return this.interruptAgent(agentId);
    });

    ipc.handle(ipcChannels.deleteTurn, (_event, agentId: string, turnId: string) => {
      return this.deleteTurn(agentId, turnId);
    });

    ipc.handle(ipcChannels.editTurn, (_event, agentId: string, turnId: string, content: string, options?: Pick<RendererSendPromptOptions, 'content'>) => {
      return this.editTurn(agentId, turnId, content, options);
    });

    ipc.handle(ipcChannels.retryTurn, (_event, agentId: string, turnId: string) => {
      return this.retryTurn(agentId, turnId);
    });

    ipc.handle(ipcChannels.continueInterruptedTurn, (_event, agentId: string, safetyReview?: import('@workspace/core/provider-safety-block').ProviderSafetyReviewTarget) => {
      return this.continueInterruptedTurn(agentId, safetyReview);
    });

    ipc.handle(ipcChannels.mobileSimulator, (_event, agentId, input) => this.executeMobileSimulator(agentId, input, true));
    ipc.handle(ipcChannels.mobileSimulatorView, async (_event, agentId, input) => {
      this.requireMobileAgent(agentId);
      return this.mobileSimulator.view(agentId, input);
    });
    ipc.handle(ipcChannels.browserOpen, (event, agentId: string, browserId: string, url: string, guestWebContentsId: number) => this.browserOpen(this.windowOf(event), agentId, browserId, url, guestWebContentsId));
    ipc.handle(ipcChannels.browserOpenVisualization, (event, agentId: string, browserId: string, filePath: string, title: string, guestWebContentsId: number) => this.browserOpenVisualization(this.windowOf(event), agentId, browserId, filePath, title, guestWebContentsId));
    ipc.handle(ipcChannels.browserNavigate, (_event, agentId: string, browserId: string, url: string) => this.browserNavigate(agentId, browserId, url));
    ipc.handle(ipcChannels.browserGoBack, (_event, agentId: string, browserId: string) => this.browserPane.goBack(agentId, browserId));
    ipc.handle(ipcChannels.browserGoForward, (_event, agentId: string, browserId: string) => this.browserPane.goForward(agentId, browserId));
    ipc.handle(ipcChannels.browserReload, (_event, agentId: string, browserId: string) => this.browserPane.reload(agentId, browserId));
    ipc.handle(ipcChannels.browserOpenDevTools, (_event, agentId: string, browserId: string) => this.browserPane.openDevTools(agentId, browserId));
    ipc.handle(ipcChannels.browserClearBrowsingData, () => this.browserPane.clearBrowsingData());
    ipc.handle(ipcChannels.browserGetZoom, (_event, agentId: string, browserId: string) => this.browserPane.getZoom(agentId, browserId));
    ipc.handle(ipcChannels.browserSetZoom, (_event, agentId: string, browserId: string, percent: number) => this.browserPane.setZoom(agentId, browserId, percent));
    ipc.handle(ipcChannels.browserCopyScreenshot, (_event, agentId: string, browserId: string, rect?: BrowserBounds) => this.browserPane.copyScreenshot(agentId, browserId, rect));
    ipc.handle(ipcChannels.browserSetBounds, (event, agentId: string, browserId: string, bounds: BrowserViewportBounds) => {
      if (this.hostsBrowserPane(event, agentId, browserId)) this.browserPane.setBounds(agentId, browserId, bounds);
    });
    ipc.handle(ipcChannels.browserViewportApplied, (_event, agentId: string, browserId: string, requestId: string, error?: string) => this.browserPane.viewportApplied(agentId, browserId, requestId, error));
    ipc.handle(ipcChannels.browserSetVisible, (event, agentId: string, browserId: string, visible: boolean) => {
      if (this.hostsBrowserPane(event, agentId, browserId)) this.browserPane.setVisible(agentId, browserId, visible);
    });
    ipc.handle(ipcChannels.browserSetAnnotationMode, (_event, agentId: string, browserId: string, enabled: boolean) => this.browserPane.setAnnotationMode(agentId, browserId, enabled));
    ipc.handle(ipcChannels.browserResolveAnnotation, (_event, token: string, comment: string | null) => this.browserPane.resolveAnnotation(token, comment));
    ipc.handle(ipcChannels.browserClearAnnotations, (_event, agentId: string, browserId: string) => this.browserPane.clearAnnotations(agentId, browserId));
    // A window that lost the pane to another one must not close it on its way out.
    ipc.handle(ipcChannels.browserClose, (event, agentId: string, browserId: string) => this.hostsBrowserPane(event, agentId, browserId) ? this.browserPane.close(agentId, browserId) : undefined);

    ipc.handle(ipcChannels.respondToClientRequest, async (_event, response: ClientRequestResponse) => {
      try {
        return await this.respondToClientRequest(response);
      } catch (error) {
        throw encodedAppError(error);
      }
    });
  }

  setDockBadgeCount(count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('Dock badge count must be a non-negative integer.');
    }
    this.badgeApplication.setBadgeCount(count);
  }

  setMenuBarVisible(visible: boolean): void {
    if (typeof visible !== 'boolean') throw new Error('Menu bar visibility must be a boolean.');
    if (process.platform === 'darwin') return;
    for (const window of this.windows.live()) {
      window.setAutoHideMenuBar(!visible);
      window.setMenuBarVisibility(visible);
    }
  }

  /** Remembers the open windows in this file, and lets {@link openStartupWindows} bring them back. */
  enableWindowLayout(filePath: string): void {
    this.layoutFile = filePath;
  }

  /** Opens the windows the app was left with, or the default workspace window when there is nothing usable to restore. */
  openStartupWindows(): void {
    const layout = this.layoutFile && this.snapshot ? readWindowLayout(this.layoutFile) : null;
    const saved = layout && this.snapshot ? restorableWindows(layout, this.snapshot) : [];
    if (!saved.length) {
      this.createWindow();
      return;
    }
    for (const { viewState, frame } of saved) this.openWindow(viewState, frame);
    // A deep link that opened the app needs a workspace to land in.
    if (this.pendingDeepLinkCommands.length && !this.windows.focusedWorkspace()) this.openWindow();
  }

  private scheduleLayoutSave(): void {
    if (!this.layoutFile || this.shuttingDown) return;
    if (this.layoutSaveTimer) clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = setTimeout(() => this.saveWindowLayout(), 500);
    this.layoutSaveTimer.unref?.();
  }

  private saveWindowLayout(): void {
    if (this.layoutSaveTimer) clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = null;
    const live = this.windows.live();
    // With no window left the app is being quit: keep the layout it had.
    if (!this.layoutFile || !live.length) return;
    try {
      const layout: WindowLayout = {
        version: 1,
        windows: live.map(window => ({
          viewState: this.windows.viewStateOf(window),
          frame: { bounds: window.getNormalBounds(), isMaximized: window.isMaximized() },
        })),
      };
      writeWindowLayout(this.layoutFile, layout);
    } catch (error) {
      warnMain('window', 'failed to save the window layout', { detail: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Brings the workspace forward, opening it when only agent windows (or none) are left. */
  createWindow(): void {
    this.showWorkspace();
  }

  private showWorkspace(): void {
    if (!this.windows.focusedWorkspace()) {
      this.openWindow();
      return;
    }
    this.focusMainWindow();
  }

  private openWindowFromRenderer(viewState: unknown): void {
    if (!isWindowViewState(viewState)) return;
    const snapshot = this.snapshot;
    if (!snapshot) return;
    if (viewState.agentId && !snapshot.agents.some(agent => agent.id === viewState.agentId)) return;
    if (viewState.teamId && !snapshot.teams.some(team => team.id === viewState.teamId)) return;
    if (viewState.scope === 'feature' && !featureAgentIds(snapshot.agents, viewState.teamId, viewState.branch ?? '').length) return;
    if (viewState.scope === 'mission' && !snapshot.missions?.some(mission => mission.id === viewState.missionId && mission.teamId === viewState.teamId)) return;
    this.openWindow(viewState);
  }

  /**
   * Opens a window that starts from `viewState`. Every way of getting a new window (New Window,
   * and later detaching an agent, a feature or a team) is this call with a different state.
   */
  openWindow(viewState: WindowViewState | null = null, frame?: WindowFrame): BrowserWindow {
    const origin = this.windows.focused();
    // A window opened from another starts with a copy of its panes, and then goes its own way.
    const originSetup = !frame && origin ? this.windows.setupOf(origin) : null;
    if (originSetup && Object.keys(originSetup).length && !viewState?.setup) viewState = { ...viewState, setup: originSetup };
    const window = createMainWindow({
      ...(frame ? { frame } : origin ? { cascadeFrom: origin.getNormalBounds() } : {}),
      ...(viewState?.scope === 'agent' ? { compact: true } : {}),
      ...(viewState?.scope === 'mission' ? { minimumSize: COMPACT_MIN_SIZE } : {}),
    });
    this.windows.add(window, viewState);
    logMain('window', 'created main window');
    window.webContents.on('did-start-navigation', (navigation) => {
      if (!navigation.isMainFrame || navigation.isSameDocument) return;
      this.windows.setReady(window, false);
      this.policyAwareSpokenAnnouncements.refresh();
      this.resetNativeResources(window);
      if (this.debugFlags.delete(window)) this.refreshAppMenu();
    });
    window.webContents.on('did-finish-load', () => {
      this.windows.setReady(window, true);
      this.flushPendingDeepLinkCommands();
    });
    const saveLayout = (): void => this.scheduleLayoutSave();
    window.on('move', saveLayout);
    window.on('resize', saveLayout);
    window.on('maximize', saveLayout);
    window.on('unmaximize', saveLayout);
    window.on('focus', () => {
      this.windows.markFocused(window);
      if (process.platform !== 'darwin') this.refreshAppMenu();
      this.scheduleLayoutSave();
      if (!app?.isPackaged) this.refreshAppMenu();
      this.policyAwareSpokenAnnouncements.refresh();
      this.handleTelemetryActivity();
    });
    window.on('blur', () => this.policyAwareSpokenAnnouncements.refresh());
    window.once('closed', () => this.handleWindowClosed(window));
    // Where the Window menu is built here rather than by the system, it follows window titles.
    window.on('page-title-updated', () => { if (process.platform !== 'darwin') this.refreshAppMenu(); });
    this.scheduleLayoutSave();
    this.refreshAppMenu();
    this.handleTelemetryActivity();
    return window;
  }

  /** Moves to the next or previous window, in the order they were opened. */
  private cycleWindow(direction: 1 | -1): void {
    const windows = [...this.windows.live()].sort((left, right) => left.id - right.id);
    if (windows.length < 2) return;
    const current = this.windows.focused();
    const index = Math.max(windows.findIndex(window => window === current), 0);
    this.focusWindowById(windows[(index + direction + windows.length) % windows.length]!.id);
  }

  private focusWindowById(id: number): void {
    const window = this.windows.byId(id);
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** New Window: opens beside the current one on the agent it shows. */
  private openNewWindow(): void {
    const agentId = this.currentSelectedAgentId();
    this.openWindow(agentId ? { agentId } : null);
  }

  private handleWindowClosed(window: BrowserWindow): void {
    this.nativeLifecycles.delete(window);
    void this.browserPane.closeHostedBy(window);
    const released = this.windows.remove(window);
    this.scheduleLayoutSave();
    if (process.platform !== 'darwin') this.refreshAppMenu();
    if (released.length) this.broadcastNativeOwners();
    this.policyAwareSpokenAnnouncements.refresh();
  }

  openDeepLink(value: string): boolean {
    const command = appCommandFromDeepLink(value, process.env.APP_DEV_PROTOCOL_SCHEME);
    if (!command) return false;
    const window = this.commandWindow();
    if (!window || !this.windows.isReady(window)) {
      this.pendingDeepLinkCommands.push(command);
    } else {
      sendAppCommand(window.webContents, command);
    }
    this.focusMainWindow();
    return true;
  }

  async shutdown(): Promise<void> {
    logMain('shutdown', 'closing application');
    // Windows are still open here, so this is the layout to come back to.
    this.saveWindowLayout();
    this.shuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.rejectAllPendingBrowserOpens(new Error('Application is shutting down.'));
    await this.browserPane.closeAll();
    await this.extensionService?.dispose();
    clearTimeout(this.lockHoldTimer);
    this.lockHoldTimer = undefined;
    this.powerSaveBlocker.stop();
    if (this.powerSourceListenersInstalled && powerMonitor) {
      powerMonitor.removeListener('on-battery', this.handlePowerSourceChanged);
      powerMonitor.removeListener('on-ac', this.handlePowerSourceChanged);
      powerMonitor.removeListener('resume', this.handleTelemetryActivity);
      this.powerSourceListenersInstalled = false;
    }
    this.autoUpdateService?.stop();
    this.appshotsKeyMonitor?.stop();
    this.mobileSimulator.clear();
    this.spokenAnnouncements.dispose();
    this.nativeIpcUnregister?.();
    this.nativeIpcUnregister = null;
    this.backendClientEventUnsubscribe?.();
    this.backendClientEventUnsubscribe = null;
    this.backendClientConnectionUnsubscribe?.();
    this.backendClientConnectionUnsubscribe = null;
    await this.backendClient?.close();
    logMain('shutdown', 'application resources closed');
  }

  private async previewSpokenAnnouncementVoice(voice: SpokenAnnouncementVoice): Promise<SpokenAnnouncementQueueResult> {
    if (!spokenAnnouncementVoices.includes(voice)) {
      throw new Error('Invalid spoken announcement voice.');
    }
    const preview = this.spokenAnnouncements.queueWithCompletion({
      agentId: `settings-preview:${voice}`,
      phase: 'start',
      text: `${product.name} is ready. Let's build something.`,
      voice,
    });
    await preview.completion;
    return preview.result;
  }

  private readonly handleTelemetryActivity = (): void => {
    if (this.shuttingDown || this.connectionState.status !== 'connected' || !this.windows.anyFocused()) return;
    // Native lifecycle signal only. The backend owns day markers and all delivery.
    void this.backendClient?.request(backendMethods.telemetryActivity).catch(() => undefined);
  };

  private async initializeBackendClient(): Promise<void> {
    if (!this.backendClient) {
      return;
    }

    try {
      await this.backendClient.start();
      const health = await this.backendClient.health();
      this.subscribeToBackendClient();
      await this.synchronizeBackendState();
      this.setConnectionState({ status: 'connected' });
      this.handleTelemetryActivity();
      logMain('daemon', 'connected to backend', { version: health.version, pid: health.pid });
    } catch (error) {
      this.handleBackendDisconnect(error instanceof Error ? error : new Error(String(error)));
      warnMain('daemon', 'failed to connect to backend process', {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async connectWorkProvider(provider: WorkProviderKind, options?: WorkProviderConnectOptions): Promise<WorkProviderConnectResult> {
    const result = await this.requireBackendClient().request<WorkProviderConnectResult>(backendMethods.workProviderConnect, { provider, ...(options ? { options } : {}) });
    await this.adoptBackendSnapshot(result.snapshot);
    return result;
  }

  private subscribeToBackendClient(): void {
    if (!this.backendClient) return;
    this.backendClientEventUnsubscribe ??= this.backendClient.onEvent((event) => this.emitBackendEvent(event));
    this.backendClientConnectionUnsubscribe ??= this.backendClient.onConnectionState?.((state, error) => {
      if (state === 'disconnected') this.handleBackendDisconnect(error);
    }) ?? null;
  }

  private async listSshHosts(): Promise<SshHostCandidate[]> {
    return this.requireBackendClient().request(backendMethods.connectionsSshHostsList);
  }

  private async addSshConnection(input: AddSshConnectionInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.connectionsSshCreate, { input }));
  }

  private async checkRemoteConnection(connectionId: string, inspectOnly?: boolean, providers?: HarnessProvider[]): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(inspectOnly ? backendMethods.connectionsRuntimeInspect : backendMethods.connectionsRuntimeSync, { connectionId, ...(providers ? { providers } : {}) }));
  }

  private async updateRemoteConnection(connectionId: string, input: UpdateRemoteConnectionInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.connectionsUpdate, { connectionId, input }));
  }

  private async removeRemoteConnection(connectionId: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.connectionsDelete, { connectionId }));
  }

  private getRemoteControlStatus(): Promise<DevicePairingStatus> {
    return this.requireBackendClient().request(backendMethods.remoteControlStatusGet);
  }

  private enableRemoteControl(): Promise<DevicePairingStatus> {
    return this.requireBackendClient().request(backendMethods.remoteControlEnable);
  }

  private disableRemoteControl(): Promise<DevicePairingStatus> {
    return this.requireBackendClient().request(backendMethods.remoteControlDisable);
  }

  private startDevicePairing(): Promise<DevicePairingSession> {
    return this.requireBackendClient().request(backendMethods.remoteControlPairingStart);
  }

  private checkDevicePairing(session: DevicePairingSession): Promise<boolean> {
    return this.requireBackendClient().request(backendMethods.remoteControlPairingCheck, { session });
  }

  private listPairedDevices(environmentId: string): Promise<PairedDevice[]> {
    return this.requireBackendClient().request(backendMethods.remoteControlClientsList, { environmentId });
  }

  private async revokePairedDevice(environmentId: string, clientId: string): Promise<void> {
    await this.requireBackendClient().request(backendMethods.remoteControlClientRevoke, { environmentId, clientId });
  }


  private async pollWorkProviderAuthorization(provider: WorkProviderKind): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.workProviderAuthorizationPoll, { provider }));
  }

  private async disconnectWorkProvider(provider: WorkProviderKind): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.workProviderDisconnect, { provider }));
  }

  private async listWorkSources(provider: WorkProviderKind, location?: AutomationLocation): Promise<WorkSource[]> {
    return this.requireBackendClient().request(backendMethods.workProviderSourcesList, {
      provider,
      ...(location ? { location } : {}),
    });
  }

  private async configureWorkBacklog(input: WorkBacklogConfigurationInput, location?: AutomationLocation): Promise<AppSnapshot> {
    const snapshot = await this.requireBackendClient().request<AppSnapshot>(backendMethods.workProviderBacklogConfigure, {
      input,
      ...(location ? { location } : {}),
    });
    return location?.kind === 'remote' ? snapshot : this.adoptBackendSnapshot(snapshot);
  }

  private async listWorkItems(provider: WorkProviderKind, sourceId: string, location?: AutomationLocation, query?: import('@workspace/core/contracts').WorkItemQuery): Promise<WorkItem[]> {
    return this.requireBackendClient().request(backendMethods.workProviderItemsList, {
      provider,
      sourceId,
      ...(location ? { location } : {}),
      ...(query ? { query } : {}),
    });
  }

  private async listGlobalWorkItems(provider: WorkProviderKind, location?: AutomationLocation, query?: import('@workspace/core/contracts').GlobalWorkItemQuery): Promise<import('@workspace/core/contracts').WorkItemPage> {
    return this.requireBackendClient().request(backendMethods.workProviderGlobalItemsList, {
      provider,
      ...(location ? { location } : {}),
      ...(query ? { query } : {}),
    });
  }

  private async listAssignedWorkItems(provider: WorkProviderKind, location?: AutomationLocation): Promise<WorkItem[]> {
    return this.requireBackendClient().request(backendMethods.workProviderAssignedItemsList, {
      provider,
      ...(location ? { location } : {}),
    });
  }

  private async createAgent(input: CreateAgentInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentCreate, { input }));
  }

  private async createQuickChat(input: CreateQuickChatInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentQuickChatCreate, { input }));
  }

  private async updateAgent(input: UpdateAgentInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentUpdate, { input }));
  }

  private getOpenInApplications(): Promise<OpenInApplicationCatalog> {
    return this.openInProvider.list();
  }

  private async openAgentPath(
    agentId: string,
    application: OpenInApplication,
    filePath?: string,
  ): Promise<AppSnapshot> {
    const agent = this.snapshot?.agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    if (agent.remoteConnectionId) {
      throw new Error('Open In is only available for local agents.');
    }

    const targetPath = await resolveProjectPath(requireAgentFolder(agent), filePath);
    await this.openInProvider.open(application, targetPath);
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(
      backendMethods.clientAgentExternalApplicationUpdate,
      { agentId, application },
    ));
  }

  private async openAgentFile(agentId: string, filePath: string, action: 'open' | 'reveal'): Promise<void> {
    if (action !== 'open' && action !== 'reveal') throw new Error('Invalid file action.');
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('File path is required.');
    const agent = this.snapshot?.agents.find(candidate => candidate.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    if (agent.remoteConnectionId || agent.sharedConversation) throw new Error('File actions are only available for local agents.');
    const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(requireAgentFolder(agent), filePath);
    const target = await realpath(targetPath);
    await this.openInProvider.openFile(target, action);
  }

  private async duplicateAgent(agentId: string, options?: DuplicateAgentOptions): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentDuplicate, {
      agentId,
      ...(options ? { options } : {}),
    }));
  }

  private async forkAgent(agentId: string, turnId?: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentFork, {
      agentId,
      ...(turnId === undefined ? {} : { turnId }),
    }));
  }

  private async moveAgentToTeam(input: MoveAgentToTeamInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentTeamMove, { input }));
  }

  private async reorderAgents(input: ReorderAgentsInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.clientAgentOrderUpdate, { input }));
  }

  private async reorderRepositories(input: ReorderRepositoriesInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.clientRepositoryOrderUpdate, { input }));
  }

  private async closeAgent(agentId: string, input?: import('@workspace/core/contracts').AgentCloseInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentDelete, {
      agentId,
      ...(input ? { input } : {}),
    }));
  }

  private async selectAgent(agentId: string): Promise<AppSnapshot> {
    return this.adoptBackendMutationSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.clientNavigationSelectAgent, { agentId }));
  }

  private async assignWorkItemToAgent(agentId: string, item: unknown): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentWorkItemAssign, { agentId, item }));
  }

  private async removeWorkItemAssignment(item: unknown): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentWorkItemAssignmentDelete, { item }));
  }

  private async createTeam(input: CreateTeamInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.teamCreate, { input }));
  }

  private async updateTeam(input: UpdateTeamInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.teamUpdate, { input }));
  }

  private async reorderTeams(input: ReorderTeamsInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.clientTeamOrderUpdate, { input }));
  }

  private async closeTeam(teamId: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.teamDelete, { teamId }));
  }

  private async selectTeam(teamId: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.clientNavigationSelectTeam, { teamId }));
  }

  private async updateSettings(input: UpdateSettingsInput): Promise<AppSnapshot> {
    const previousCodexBinaryPath = this.snapshot?.general.codexBinaryPath ?? '';
    const { policy, preferences } = splitSettingsInput(input);
    let result: AppSnapshot | undefined;
    if (Object.keys(policy).length) result = await this.requireBackendClient().request<AppSnapshot>(backendMethods.settingsUpdate, { input: policy });
    if (Object.keys(preferences).length) result = await this.requireBackendClient().request<AppSnapshot>(backendMethods.clientPreferencesUpdate, { input: preferences });
    const snapshot = await this.adoptBackendSnapshot(result ?? this.snapshot!);
    if (input.general?.appshots) this.syncAppshotsKeyMonitor();
    if (previousCodexBinaryPath !== snapshot.general.codexBinaryPath) {
      await this.restartApp();
    }
    return snapshot;
  }

  private async setCodexResourceSharing(input: SetCodexResourceSharingInput): Promise<AppSnapshot> {
    const snapshot = await this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(
      backendMethods.settingsCodexResourceSharingSet,
      { input },
    ));
    if (!(input.enabled === false && input.mode === 'keep')) {
      await this.browserPane.closeAll();
      await this.restartBackend();
    }
    return snapshot;
  }

  private getCodexResourceSharingStatus(): Promise<CodexResourceSharingStatus> {
    return this.requireBackendClient().request(backendMethods.settingsCodexResourceSharingGet);
  }

  private getPluginStatus(): Promise<AppPluginStatus> {
    return this.requireBackendClient().request<AppPluginStatus>(backendMethods.settingsPluginStatusGet);
  }

  private getCodexAuthentication(remoteConnectionId?: string): Promise<CodexAuthentication> {
    return this.requireBackendClient().request(backendMethods.codexAuthenticationGet, remoteConnectionId ? { remoteConnectionId } : undefined);
  }

  private getClaudeAuthentication(remoteConnectionId?: string): Promise<ClaudeAuthentication> {
    if (remoteConnectionId !== undefined && (typeof remoteConnectionId !== 'string' || !remoteConnectionId.trim())) throw new Error('A remote connection is required.');
    return this.requireBackendClient().request(backendMethods.claudeAuthenticationGet, remoteConnectionId === undefined ? undefined : { connectionId: remoteConnectionId });
  }

  private startCodexChatGptDeviceCodeLogin(remoteConnectionId: string): Promise<import('@workspace/core/contracts').CodexChatGptDeviceCodeLogin> {
    if (typeof remoteConnectionId !== 'string' || !remoteConnectionId.trim()) throw new Error('A remote connection is required.');
    return this.requireBackendClient().request(backendMethods.codexChatGptDeviceCodeLoginStart, { remoteConnectionId });
  }

  private cancelCodexChatGptLogin(remoteConnectionId?: string, loginId?: string): Promise<CodexAuthentication> {
    return this.requireBackendClient().request(backendMethods.codexLoginCancel,
      remoteConnectionId || loginId ? { ...(remoteConnectionId ? { remoteConnectionId } : {}), ...(loginId ? { loginId } : {}) } : undefined);
  }

  private async startCodexChatGptLogin(): Promise<CodexChatGptLogin> {
    const login = await this.requireBackendClient().request<CodexChatGptLogin>(
      backendMethods.codexChatGptLoginStart,
    );
    await this.openExternal(login.authUrl);
    return login;
  }

  private logoutCodex(): Promise<CodexAuthentication> {
    return this.requireBackendClient().request(backendMethods.codexLogout);
  }

  private async getDaemonStatus(): Promise<DaemonStatus> {
    return this.daemonStatusLoader();
  }

  private async setDaemonEnabled(enabled: boolean): Promise<DaemonStatus> {
    return setDaemonEnabled(enabled);
  }

  private async restartApp(): Promise<void> {
    await this.shutdown();
    this.appLifecycle.relaunch();
    this.appLifecycle.exit(0);
  }

  private async reloadRenderer(window: BrowserWindow | undefined): Promise<void> {
    if (!window) return;
    await this.browserPane.closeHostedBy(window);
    if (!window.isDestroyed()) window.webContents.reload();
  }

  private async restartBackend(): Promise<void> {
    const daemonStatus = await this.daemonStatusLoader();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.backendClientEventUnsubscribe?.();
    this.backendClientEventUnsubscribe = null;
    this.backendClientConnectionUnsubscribe?.();
    this.backendClientConnectionUnsubscribe = null;
    this.setConnectionState({ status: 'reconnecting', detail: { key: 'backend.restarting' } });
    await this.backendClient?.close();
    let restartError: unknown;
    if (daemonStatus.installed) {
      try {
        await this.daemonRefresher();
      } catch (error) {
        restartError = error;
        warnMain('daemon', 'failed to restart background backend', {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await this.initializeBackendClient();
    if (restartError) throw restartError;
  }

  private async requestDebugBackendRestart(input?: { agentId: string; reason: string }): Promise<{ scheduled: boolean }> {
    if (app.isPackaged) throw new Error('Backend restart tools are only available in debug mode.');
    if (this.debugBackendRestartPending) throw new Error('A backend restart is already pending.');
    this.debugBackendRestartPending = true;
    try {
      if (input) {
        const agent = this.snapshot?.agents.find(candidate => candidate.id === input.agentId);
        if (!agent || agent.remoteConnectionId || agent.sharedConversation) throw new Error('Backend restart requires a local agent.');
        if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) throw new Error('Invalid backend restart reason.');
      }
      // Return the scheduling acknowledgment before closing the RPC transport.
      setImmediate(() => {
        void this.restartBackend()
          .catch(error => this.reportDebugBackendRestartError(error, !input))
          .finally(() => { this.debugBackendRestartPending = false; });
      });
      return { scheduled: true };
    } catch (error) { this.debugBackendRestartPending = false; throw error; }
  }

  private reportDebugBackendRestartError(error: unknown, showDialog = true): void {
    const detail = error instanceof Error ? error.message : String(error);
    warnMain('daemon', 'debug backend restart failed', { detail });
    if (showDialog) dialog.showErrorBox('Could not restart backend', detail);
  }

  private async getAutomationSnapshot(location?: AutomationLocation): Promise<AppSnapshot> {
    if (isRemoteAutomationLocation(location)) {
      return this.requireBackendClient().request<AppSnapshot>(backendMethods.snapshotAutomationsGet, { location });
    }
    return this.getSnapshot();
  }

  private async createAutomation(input: CreateAutomationInput, location?: AutomationLocation): Promise<AppSnapshot> {
    return this.adoptAutomationSnapshot(location, await this.requireBackendClient().request<AppSnapshot>(backendMethods.automationCreate, {
      input,
      ...(location ? { location } : {}),
    }));
  }

  private async updateAutomation(input: UpdateAutomationInput, location?: AutomationLocation): Promise<AppSnapshot> {
    return this.adoptAutomationSnapshot(location, await this.requireBackendClient().request<AppSnapshot>(backendMethods.automationUpdate, {
      input,
      ...(location ? { location } : {}),
    }));
  }

  private async runAutomation(automationId: string, location?: AutomationLocation): Promise<AppSnapshot> {
    return this.adoptAutomationSnapshot(location, await this.requireBackendClient().request<AppSnapshot>(backendMethods.automationRun, {
      automationId,
      ...(location ? { location } : {}),
    }));
  }

  private async clearAutomationHistory(automationId: string, location?: AutomationLocation): Promise<AppSnapshot> {
    return this.adoptAutomationSnapshot(location, await this.requireBackendClient().request<AppSnapshot>(backendMethods.automationHistoryClear, {
      automationId,
      ...(location ? { location } : {}),
    }));
  }

  private async deleteAutomationExecution(automationId: string, executionId: string, location?: AutomationLocation): Promise<AppSnapshot> {
    return this.adoptAutomationSnapshot(location, await this.requireBackendClient().request<AppSnapshot>(backendMethods.automationExecutionDelete, {
      automationId,
      executionId,
      ...(location ? { location } : {}),
    }));
  }

  private async deleteAutomation(automationId: string, location?: AutomationLocation): Promise<AppSnapshot> {
    return this.adoptAutomationSnapshot(location, await this.requireBackendClient().request<AppSnapshot>(backendMethods.automationDelete, {
      automationId,
      ...(location ? { location } : {}),
    }));
  }

  private async adoptAutomationSnapshot(location: AutomationLocation | undefined, snapshot: AppSnapshot): Promise<AppSnapshot> {
    if (isRemoteAutomationLocation(location)) {
      return snapshot;
    }
    return this.adoptBackendSnapshot(snapshot);
  }

  private async adoptBackendSnapshot(snapshot: AppSnapshot): Promise<AppSnapshot> {
    const previousDebugMenuState = this.debugMenuState();
    this.snapshot = snapshot;
    this.mobileSimulator.retainAgents(this.snapshot?.agents.map(agent => agent.id) ?? []);
    this.policyAwareSpokenAnnouncements.refresh();
    this.syncNativeAppearance();
    this.transientSnapshots.add(snapshot);
    try {
      await this.refreshClientStateFromBackend();
      return withRendererMediaUrls(snapshot, this.localMediaRegistry);
    } finally {
      this.transientSnapshots.delete(snapshot);
      this.refreshDebugMenuIfChanged(previousDebugMenuState);
    }
  }

  private async adoptBackendMutationSnapshot(nextSnapshot: AppSnapshot): Promise<AppSnapshot> {
    if (!this.snapshot) throw new Error('daemon snapshot is not available.');
    const previousDebugMenuState = this.debugMenuState();
    replaceAppSnapshot(this.snapshot, nextSnapshot);
    this.mobileSimulator.retainAgents(this.snapshot?.agents.map(agent => agent.id) ?? []);
    this.policyAwareSpokenAnnouncements.refresh();
    this.syncPowerSaveBlocker();
    this.syncNativeAppearance();
    this.refreshDebugMenuIfChanged(previousDebugMenuState);
    return nextSnapshot;
  }

  private async getSnapshot(): Promise<AppSnapshot> {
    if (this.backendClient && this.connectionState.status === 'connected') {
      return withRendererMediaUrls(await this.synchronizeBackendState(), this.localMediaRegistry);
    }
    if (this.snapshot) return withRendererMediaUrls(this.snapshot, this.localMediaRegistry);
    throw new Error('daemon snapshot is not available.');
  }

  private async getSnapshotState(): Promise<RendererSnapshotState> {
    return {
      snapshot: await this.getSnapshot(),
      lastBackendEventSeq: this.lastBackendEventSeq,
      connection: { ...this.connectionState },
    };
  }

  private async sendPrompt(
    agentId: string,
    prompt: string,
    options?: RendererSendPromptOptions,
  ): Promise<AppSnapshot> {
    const providerOptions = this.resolveRendererPromptOptions(options);
    return this.adoptBackendMutationSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentPromptSend, {
      agentId,
      prompt,
      options: providerOptions,
    }));
  }

  private requireMobileAgent(agentId: string): void {
    const agent = this.snapshot?.agents.find(agent => agent.id === agentId);
    if (!agent) throw new Error('Agent not found.');
    if (agent.remoteConnectionId) throw new Error('Mobile simulators are available to local agents only.');
    this.mobileSimulator.retainAgents(this.snapshot!.agents.map(agent => agent.id));
  }

  private async executeMobileSimulator(agentId: string, input: MobileRequest, userInitiated = false): Promise<MobileResult> {
    this.requireMobileAgent(agentId);
    const result = await this.mobileSimulator.execute(agentId, input, userInitiated);
    const window = this.nativeTargetWindow('simulator', agentId);
    if (window) {
      // The pane follows an agent's lifecycle; a user detaching or powering off in the pane keeps it open.
      if (input.action === 'attach') sendAppCommand(window.webContents, { type: 'open-simulator', agentId });
      else if (!userInitiated && (input.action === 'detach' || input.action === 'shutdown'))
        sendAppCommand(window.webContents, { type: 'close-simulator', agentId });
    }
    return result;
  }

  private async browserOpen(window: BrowserWindow | undefined, agentId: string, browserId: string, url: string, guestWebContentsId: number): Promise<BrowserState> {
    await this.requireBrowserWindow(window, agentId);
    try {
      const agent = this.snapshot?.agents.find((candidate) => candidate.id === agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      const state = await this.browserPane.open(window!, agentId, browserId, url, agent.folder ?? '', guestWebContentsId);
      this.resolvePendingBrowserOpen(agentId, browserId, url, state);
      return state;
    } catch (error) {
      this.rejectPendingBrowserOpen(agentId, browserId, error);
      throw error;
    }
  }

  private async browserOpenVisualization(
    window: BrowserWindow | undefined,
    agentId: string,
    browserId: string,
    filePath: string,
    title: string,
    guestWebContentsId: number,
  ): Promise<BrowserState> {
    await this.requireBrowserWindow(window, agentId);
    const agent = this.snapshot?.agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return this.browserPane.openVisualization(window!, agentId, browserId, filePath, title, guestWebContentsId);
  }

  private async browserNavigate(agentId: string, browserId: string, url: string): Promise<BrowserState> {
    try {
      const state = await this.browserPane.navigate(agentId, browserId, url);
      this.resolvePendingBrowserOpen(agentId, browserId, url, state);
      return state;
    } catch (error) {
      this.rejectPendingBrowserOpen(agentId, browserId, error);
      throw error;
    }
  }

  private requestBrowserOpen(agentId: string, browserId: string, url: string): Promise<BrowserState> {
    const window = this.nativeTargetWindow('browser', agentId);
    if (!window) return Promise.reject(new Error('Browser window is not available.'));

    this.rejectPendingBrowserOpen(agentId, browserId, new Error('Browser open request was superseded.'));
    return new Promise<BrowserState>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.rejectPendingBrowserOpen(agentId, browserId, new Error('Timed out opening the in-app browser.'));
      }, 30_000);
      this.pendingBrowserOpens.set(browserPaneKey(agentId, browserId), { agentId, browserId, url, resolve, reject, timeout });
      sendAppCommand(window.webContents, { type: 'open-browser', agentId, browserId, url });
    });
  }

  private resolvePendingBrowserOpen(agentId: string, browserId: string, url: string, state: BrowserState): void {
    const key = browserPaneKey(agentId, browserId);
    const pending = this.pendingBrowserOpens.get(key);
    if (!pending || pending.url !== url) return;
    clearTimeout(pending.timeout);
    this.pendingBrowserOpens.delete(key);
    pending.resolve(state);
  }

  private rejectPendingBrowserOpen(agentId: string, browserId: string, reason: unknown): void {
    const key = browserPaneKey(agentId, browserId);
    const pending = this.pendingBrowserOpens.get(key);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingBrowserOpens.delete(key);
    pending.reject(reason instanceof Error ? reason : new Error(String(reason)));
  }

  private rejectAllPendingBrowserOpens(reason: unknown): void {
    for (const pending of [...this.pendingBrowserOpens.values()]) {
      this.rejectPendingBrowserOpen(pending.agentId, pending.browserId, reason);
    }
  }

  private emitBrowserAnnotation(annotation: BrowserAnnotation): void {
    this.emitClientEvent({
      type: 'browser.annotationCreated',
      payload: annotation,
    });
  }

  private async restartAgent(agentId: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentConversationReset, { agentId }));
  }

  private async compressAgentSession(agentId: string): Promise<AppSnapshot> {
    return this.adoptBackendMutationSnapshot(await this.requireBackendClient().request<AppSnapshot>(
      backendMethods.agentConversationReplaceWithSummary,
      { agentId },
    ));
  }

  private async loadConversationHistory(agentId: string, options?: { recovery?: boolean }): Promise<AppSnapshot> {
    const started = performance.now();
    const finish = (snapshot: AppSnapshot) => {
      if (process.env.CODEX_APP_SDK_TRACE_CONVERSATION_LOAD === '1') warnMain('conversation-load', 'electron.history.snapshot-adopted', { agentId, recovery: Boolean(options?.recovery),
        at: performance.timeOrigin + performance.now(), elapsedMs: performance.now() - started });
      return snapshot;
    };
    if (!options?.recovery) {
      return finish(await this.adoptBackendMutationSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentConversationLoad, { agentId, reportFailure: true })));
    }
    const result = await this.requireBackendClient().request<AppSnapshot | null>(backendMethods.agentConversationLoad, { agentId, omitSnapshot: true, reportFailure: true });
    // Older remote daemons may ignore the opt-in and return their snapshot.
    if (result) return finish(await this.adoptBackendMutationSnapshot(result));
    if (!this.snapshot) throw new Error('daemon snapshot is not available.');
    return finish(withRendererMediaUrls(this.snapshot, this.localMediaRegistry));
  }

  private async loadOlderAgentHistory(agentId: string): Promise<{ hasOlder: boolean }> {
    return this.requireBackendClient().request<{ hasOlder: boolean }>(backendMethods.agentConversationHistoryLoadOlder, { agentId });
  }

  private async listAgentConversations(agentId: string, input?: ConversationListInput): Promise<ConversationSummary[]> {
    return this.requireBackendClient().request(backendMethods.agentConversationsList, { agentId, input });
  }

  private async resumeAgentConversation(agentId: string, target: ConversationResumeTarget): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentConversationResume, { agentId, target }));
  }

  private async readConversationMessages(ref: unknown, agentId: string, location?: AutomationLocation): Promise<RendererMessage[]> {
    const messages = await this.requireBackendClient().request<RendererMessage[]>(backendMethods.agentConversationMessagesGet, {
      ref,
      agentId,
      ...(location ? { location } : {}),
    });
    return withRendererMediaUrls(messages, this.localMediaRegistry);
  }

  private async setAgentGoal(agentId: string, objective: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentGoalUpdate, { agentId, objective }));
  }

  private async clearAgentGoal(agentId: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentGoalClear, { agentId }));
  }

  private async setAgentApprovalPreset(agentId: string, preset: ApprovalPreset): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentApprovalPresetUpdate, { agentId, preset }));
  }

  private async setAgentPermissionMode(agentId: string, mode: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentPermissionModeUpdate, { agentId, mode }));
  }

  private async listProviderModels(agentId: string | null, provider?: import('@workspace/core/contracts').HarnessProvider, remoteConnectionId?: string): Promise<ProviderModelOption[]> {
    return this.requireBackendClient().request(backendMethods.agentModelsList, {
      ...(agentId ? { agentId } : {}), ...(provider ? { provider: provider } : {}), ...(remoteConnectionId ? { remoteConnectionId } : {}),
    });
  }

  private async listProviderPlugins(agentId: string): Promise<ProviderPluginSummary[]> {
    return this.requireBackendClient().request(backendMethods.agentPluginsList, { agentId });
  }

  private async listProviderSkills(agentId: string): Promise<ProviderSkillSummary[]> {
    return this.requireBackendClient().request(backendMethods.agentSkillsList, { agentId });
  }

  private async listAgentFiles(agentId: string): Promise<AgentFileSearchItem[]> {
    return this.requireBackendClient().request(backendMethods.agentFilesList, {
      agentId,
    });
  }

  private async previewAgentFile(agentId: string, filePath: string): Promise<AgentFilePreviewResult> {
    return this.requireBackendClient().request(backendMethods.agentFilePreview, {
      agentId,
      filePath,
    });
  }

  private async steerPrompt(agentId: string, prompt: string, options?: RendererSendPromptOptions): Promise<AppSnapshot> {
    const providerOptions = this.resolveRendererPromptOptions(options);
    return this.adoptBackendMutationSnapshot(await this.requireBackendClient().request<AppSnapshot>(
      backendMethods.agentPromptSteer,
      providerOptions ? { agentId, prompt, options: providerOptions } : { agentId, prompt },
    ));
  }

  private resolveRendererPromptOptions(options?: RendererSendPromptOptions): SendPromptOptions | undefined {
    if (!options) return undefined;
    const { attachments, ...rest } = options;
    if (!attachments?.length) return rest;
    return {
      ...rest,
      attachments: attachments.map((attachment) => {
        const resolved = this.nativeAttachmentRegistry.resolve(attachment);
        return attachment.type === 'image' && attachment.detail
          ? { ...resolved, detail: attachment.detail }
          : resolved;
      }),
    };
  }

  private async deleteQueuedPrompt(agentId: string, promptId: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentQueuedPromptDelete, { agentId, promptId }));
  }

  private async updateQueuedPrompt(agentId: string, promptId: string, prompt: string, options?: Pick<RendererSendPromptOptions, 'content'>): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentQueuedPromptUpdate, { agentId, promptId, prompt, ...(options ? { options } : {}) }));
  }

  private async steerQueuedPrompt(agentId: string, promptId: string, prompt?: string, options?: Pick<RendererSendPromptOptions, 'content'>): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentQueuedPromptSteer, {
      agentId,
      promptId,
      ...(prompt === undefined ? {} : { prompt }),
      ...(options ? { options } : {}),
    }));
  }

  private async interruptAgent(agentId: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentInterrupt, { agentId }));
  }

  private async deleteTurn(agentId: string, turnId: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentTurnDelete, { agentId, turnId }));
  }

  private async editTurn(agentId: string, turnId: string, content: string, options?: Pick<RendererSendPromptOptions, 'content'>): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentTurnEdit, { agentId, turnId, content, ...(options ? { options } : {}) }));
  }

  private async retryTurn(agentId: string, turnId: string): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentTurnRetry, { agentId, turnId }));
  }

  private async continueInterruptedTurn(agentId: string, safetyReview?: import('@workspace/core/provider-safety-block').ProviderSafetyReviewTarget): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentTurnContinueInterrupted, { agentId, ...(safetyReview ? { safetyReview } : {}) }));
  }

  private async chooseAgentFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: mainT('dialog.agentFolder'),
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  private async chooseSourceFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: mainT('dialog.sourceFolder'),
      message: mainT('dialog.sourceFolderMessage'),
      defaultPath: this.clientState.sourceFolderPath || undefined,
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  private async chooseSourceWorktreeDestination(defaultPath: string): Promise<string | null> {
    const result = await dialog.showSaveDialog({
      title: mainT('dialog.worktreeFolder'),
      message: mainT('dialog.worktreeFolderMessage'),
      defaultPath,
      properties: ['createDirectory'],
    });

    return result.canceled ? null : result.filePath ?? null;
  }

  private async listSourceRepositories(remoteConnectionId?: string): Promise<SourceRepository[]> {
    return this.requireBackendClient().request(backendMethods.sourceRepositoriesList, remoteConnectionId ? { remoteConnectionId } : undefined);
  }

  private async cloneSourceRepository(input: import('@workspace/core/contracts').CloneSourceRepositoryInput): Promise<SourceRepository> {
    return this.requireBackendClient().request<SourceRepository>(backendMethods.sourceRepositoryClone, { input });
  }

  private async createSourceRepository(input: import('@workspace/core/contracts').CreateSourceRepositoryInput): Promise<SourceRepository> {
    return this.requireBackendClient().request<SourceRepository>(backendMethods.sourceRepositoryCreate, { input });
  }

  private async createProject(input: import('@workspace/core/contracts').CreateProjectInput): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.projectCreate, { input }));
  }

  private async listSourceBranches(repoPath: string, remoteConnectionId?: string): Promise<import('@workspace/core/contracts').SourceBranch[]> {
    return this.requireBackendClient().request(backendMethods.sourceBranchesList, {
      repoPath,
      ...(remoteConnectionId ? { remoteConnectionId } : {}),
    });
  }

  private async listSourceFolders(input?: SourceFolderListInput): Promise<SourceFolderListing> {
    return this.requireBackendClient().request(backendMethods.sourceFoldersList, input);
  }

  private async listSourceWorktrees(repoPath: string, remoteConnectionId?: string): Promise<SourceWorktree[]> {
    return this.requireBackendClient().request(backendMethods.sourceWorktreesList, {
      repoPath,
      ...(remoteConnectionId ? { remoteConnectionId } : {}),
    });
  }

  private async suggestSourceWorktreePath(input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath' | 'remoteConnectionId'>): Promise<string> {
    return this.requireBackendClient().request(backendMethods.sourceWorktreePathSuggest, { input });
  }

  private async createSourceWorktree(input: CreateSourceWorktreeInput): Promise<SourceWorktree> {
    return this.requireBackendClient().request<SourceWorktree>(backendMethods.sourceWorktreeCreate, {
      input,
    });
  }

  private async getSystemPermissions(): Promise<SystemPermissionsStatus> {
    return this.requireBackendClient().request<SystemPermissionsStatus>(backendMethods.systemPermissionsGet);
  }

  private async openAccessibilitySettings(): Promise<SystemPermissionsStatus> {
    return this.requireBackendClient().request(backendMethods.systemPermissionsAccessibilityOpen);
  }

  private async openScreenRecordingSettings(): Promise<SystemPermissionsStatus> {
    return this.requireBackendClient().request(backendMethods.systemPermissionsScreenRecordingOpen);
  }

  private synchronizeBackendState(): Promise<AppSnapshot> {
    if (this.backendSynchronization) return this.backendSynchronization;
    this.backendSynchronization = this.performBackendSynchronization()
      .catch((error) => {
        this.backendEventBuffer = null;
        throw error;
      })
      .finally(() => {
        this.backendSynchronization = null;
      });
    return this.backendSynchronization;
  }

  private async performBackendSynchronization(): Promise<AppSnapshot> {
    this.backendEventBuffer ??= [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const backendState = await this.requireBackendClient().request<unknown>(backendMethods.snapshotGet);
      if (!isAppSnapshotGetResult(backendState)) throw new Error('daemon returned an invalid snapshot.');

      let synchronizedSnapshot = backendState.snapshot;
      this.snapshot = synchronizedSnapshot;
      this.mobileSimulator.retainAgents(this.snapshot?.agents.map(agent => agent.id) ?? []);
      this.policyAwareSpokenAnnouncements.refresh();
      this.clientState = backendState.clientState;
      this.lastBackendEventSeq = backendState.lastEventSeq;
      const buffered = this.backendEventBuffer;
      this.backendEventBuffer = [];
      let gap = false;
      for (const event of buffered) {
        if (event.seq <= this.lastBackendEventSeq) {
          this.forwardProviderFrame(event);
          // Progress is absent from snapshots. Forward covered updates on the
          // client channel without rolling the backend sequence backwards.
          if (event.type === 'agentCreation.progress') {
            this.emitClientEvent({ type: event.type, agentId: event.agentId, payload: event.payload });
          }
          continue;
        }
        if (event.seq !== this.lastBackendEventSeq + 1) {
          gap = true;
          break;
        }
        const rendererEvent = eventForRenderer(event);
        const decodedSnapshot = decodeSnapshotFromBackendEvent(event);
        if (decodedSnapshot) synchronizedSnapshot = decodedSnapshot.value;
        else if (event.type !== 'snapshot.updated') applyMainEventToSnapshot(synchronizedSnapshot, rendererEvent);
        this.applyBackendEvent(event, true);
      }
      if (!gap) {
        this.backendEventBuffer = null;
        this.syncPowerSaveBlocker();
        return synchronizedSnapshot;
      }
      warnMain('daemon', 'backend event gap detected while synchronizing', {
        attempt: attempt + 1,
        lastEventSeq: this.lastBackendEventSeq,
      });
    }
    this.backendEventBuffer = null;
    throw new Error('Unable to obtain a consistent daemon snapshot after repeated event gaps.');
  }

  private async refreshClientStateFromBackend(): Promise<void> {
    this.clientState = await this.requireBackendClient().request<ClientState>(backendMethods.clientStateGet);
    this.syncPowerSaveBlocker();
  }

  private requireBackendClient(): AppBackendClientPort {
    if (!this.backendClient) {
      throw new Error('daemon backend is not connected.');
    }
    return this.backendClient;
  }

  private async respondToClientRequest(response: ClientRequestResponse): Promise<AppSnapshot> {
    return this.adoptBackendSnapshot(await this.requireBackendClient().request<AppSnapshot>(backendMethods.agentRequestRespond, { response: agentResponseFromClientResponse(response) }));
  }

  private installUpdate(): void {
    this.autoUpdateService?.install();
  }

  private requestInstallUpdate(): void {
    if (!this.autoUpdateService) return;
    if (this.manualUpdateCheckController) {
      this.manualUpdateCheckController.begin(this.desktopUpdateStatus);
      return;
    }
    this.installUpdate();
  }

  private runManualUpdateCheck(): void {
    if (!this.autoUpdateService || !this.manualUpdateCheckController) return;
    const status = this.autoUpdateService.getStatus();
    if (status.state === 'disabled' && process.platform !== 'darwin') {
      void this.openExternal(`https://github.com/${product.releaseRepository}/releases/latest`)
        .catch((error) => warnMain('updates', 'failed to open release downloads', {
          error: error instanceof Error ? error.message : String(error),
        }));
      return;
    }
    if (!this.manualUpdateCheckController.begin(status)) return;
    if (!this.autoUpdateService.check()) this.manualUpdateCheckController.cancel();
    this.refreshAppMenu();
  }

  private updateMenuOptions(): {
    updateStatus: DesktopUpdateStatus;
    checkForUpdates: () => void;
    installUpdate: () => void;
    newWindow: () => void;
    showWorkspace: () => void;
    listWindows: () => Array<{ id: number; title: string; focused: boolean }>;
    focusWindow: (id: number) => void;
    cycleWindow: (direction: 1 | -1) => void;
    capturePerformanceProfile: () => void;
  } {
    return {
      updateStatus: this.desktopUpdateStatus,
      checkForUpdates: () => this.runManualUpdateCheck(),
      installUpdate: () => this.requestInstallUpdate(),
      newWindow: () => this.openNewWindow(),
      showWorkspace: () => this.showWorkspace(),
      listWindows: () => this.windows.live().map(window => ({ id: window.id, title: window.getTitle(), focused: window.isFocused() })),
      focusWindow: (id: number) => this.focusWindowById(id),
      cycleWindow: (direction: 1 | -1) => this.cycleWindow(direction),
      capturePerformanceProfile: () => {
        const window = this.windows.focused();
        if (window) void runPerformanceCapture(window);
      },
    };
  }

  private refreshAppMenu(): void {
    if (!this.windows.live().length) return;
    installAppMenu(() => this.windows.focused(), {
      debugMode: !app.isPackaged,
      ...this.updateMenuOptions(),
      ...this.debugMenuOptions(),
    });
  }

  private debugMenuOptions(): Pick<AppMenuCallbacks, 'restartBackend' | 'sendDebugAgentMessage' | 'toggleDebugExecutionPlan' | 'hasDebugExecutionPlan' | 'injectDebugPlanReview' | 'populateDebugVisualize' | 'getDebugMissionStage' | 'getDebugMissionReviewState' | 'setDebugMissionStage' | 'injectDebugCodeReview' | 'isDebugThreadFlagSet' | 'setDebugThreadFlag' | 'getDebugMissingEngines' | 'setDebugMissingEngines' | 'getDebugProviderUpgrades' | 'setDebugProviderUpgrades' | 'getDebugReviewUncommitted' | 'setDebugReviewUncommitted'> {
    return {
      restartBackend: () => {
        if (!this.debugBackendRestartPending) void this.requestDebugBackendRestart().catch(error => this.reportDebugBackendRestartError(error));
      },
      getDebugProviderUpgrades: () => this.currentDebugFlags().providerUpgrades === true,
      setDebugProviderUpgrades: enabled => {
        if (app.isPackaged) return;
        this.setDebugFlag('providerUpgrades', 'debug-provider-upgrades', enabled);
      },
      getDebugReviewUncommitted: () => this.currentDebugFlags().reviewUncommitted === true,
      setDebugReviewUncommitted: enabled => {
        if (app.isPackaged) return;
        this.setDebugFlag('reviewUncommitted', 'debug-review-uncommitted', enabled);
      },
      getDebugMissingEngines: () => this.currentDebugFlags().missingEngines === true,
      setDebugMissingEngines: enabled => {
        if (app.isPackaged) return;
        this.setDebugFlag('missingEngines', 'debug-missing-engines', enabled);
      },
      sendDebugAgentMessage: () => this.sendDebugAgentMessage(),
      toggleDebugExecutionPlan: () => this.toggleDebugExecutionPlan(),
      hasDebugExecutionPlan: () => this.hasDebugExecutionPlan(),
      injectDebugPlanReview: format => this.injectDebugPlanReview(format),
      populateDebugVisualize: (scenario) => this.populateDebugVisualize(scenario),
      getDebugMissionStage: () => this.debugMission()?.stage,
      getDebugMissionReviewState: () => this.debugMissionReviewState(),
      setDebugMissionStage: (stage, reviewState, preset) => this.setDebugMissionStage(stage, reviewState, preset),
      injectDebugCodeReview: (scenario) => this.injectDebugCodeReview(scenario),
      isDebugThreadFlagSet: (id) => this.isDebugThreadFlagSet(id),
      setDebugThreadFlag: (id, value) => this.setDebugThreadFlag(id, value),
    };
  }

  private debugMission(snapshot = this.snapshot) {
    if (!this.selectedMissionId) return undefined;
    return snapshot?.missions?.find(mission => mission.id === this.selectedMissionId);
  }

  private selectMission(missionId: string | null): void {
    this.selectedMissionId = missionId && this.snapshot?.missions?.some(mission => mission.id === missionId)
      ? missionId
      : null;
    this.refreshAppMenu();
  }

  private debugMissionReviewState(): MissionReviewDebugState | undefined {
    const mission = this.debugMission();
    if (mission?.stage !== 'review') return undefined;
    const findings = mission.artifacts.review.findings ?? [];
    return findings.length > 0 && findings.every(finding => finding.remediation.state === 'fixed' || finding.remediation.state === 'skipped')
      ? 'remediated'
      : 'identified';
  }

  private setDebugMissionStage(stage: MissionStage, reviewState?: MissionReviewDebugState, preset?: 'screenshot'): void {
    const mission = this.debugMission();
    if (!mission || !this.backendClient || app?.isPackaged) return;
    void this.backendClient.request<AppSnapshot>(backendMethods.debugMissionStageSet, { missionId: mission.id, stage, ...(reviewState ? { reviewState } : {}), ...(preset ? { preset } : {}) })
      .then(snapshot => this.adoptBackendSnapshot(snapshot))
      .then(() => this.refreshAppMenu())
      .catch((error) => warnMain('debug', 'failed to load mission fixture', {
        missionId: mission.id,
        stage,
        reviewState,
        detail: error instanceof Error ? error.message : String(error),
      }));
  }

  private isDebugThreadFlagSet(id: ThreadFlagId, snapshot = this.snapshot): boolean {
    const activeAgent = snapshot?.agents.find((agent) => agent.id === snapshot.activeAgentId);
    return activeAgent?.threadFlags?.[id] === true;
  }

  private currentDebugFlags(): DebugFlags {
    const window = this.windows.focused();
    return (window && this.debugFlags.get(window)) || {};
  }

  private setDebugFlag(flag: keyof DebugFlags, type: 'debug-provider-upgrades' | 'debug-review-uncommitted' | 'debug-missing-engines', enabled: boolean): void {
    const window = this.windows.focused();
    if (!window) return;
    this.debugFlags.set(window, { ...this.debugFlags.get(window), [flag]: enabled });
    sendAppCommand(window.webContents, { type, enabled });
    this.refreshAppMenu();
  }

  private debugMenuState(snapshot = this.snapshot): string {
    return `${this.isDebugThreadFlagSet('work_proposed', snapshot)}:${this.isDebugThreadFlagSet('ready_for_review', snapshot)}:${this.hasDebugExecutionPlan(snapshot)}`;
  }

  private refreshDebugMenuIfChanged(previousValue: string): void {
    if (!app?.isPackaged && previousValue !== this.debugMenuState()) this.refreshAppMenu();
  }

  private hasDebugExecutionPlan(snapshot = this.snapshot): boolean {
    return Boolean(snapshot?.agents.find(agent => agent.id === snapshot.activeAgentId)?.plan);
  }

  private toggleDebugExecutionPlan(): void {
    const agentId = this.currentSelectedAgentId();
    if (!agentId || !this.backendClient || app?.isPackaged) {
      return;
    }

    void this.backendClient.request<AppSnapshot>(backendMethods.debugExecutionPlanToggle, { agentId })
      .then((snapshot) => this.adoptBackendSnapshot(snapshot))
      .finally(() => this.refreshAppMenu())
      .catch((error) => warnMain('debug', 'failed to toggle execution plan', {
        agentId,
        detail: error instanceof Error ? error.message : String(error),
      }));
  }

  private sendDebugAgentMessage(): void {
    const agentId = this.currentSelectedAgentId();
    if (!agentId || !this.backendClient || app?.isPackaged) {
      return;
    }

    void this.backendClient.request(backendMethods.debugAgentMessageSend, { agentId })
      .catch((error) => warnMain('debug', 'failed to send agent message fixture', {
        agentId,
        detail: error instanceof Error ? error.message : String(error),
      }));
  }

  private injectDebugPlanReview(format: 'text' | 'choices'): void {
    const agentId = this.currentSelectedAgentId();
    if (!agentId || !this.backendClient || app?.isPackaged) {
      return;
    }

    void this.backendClient.request<AppSnapshot>(backendMethods.debugPlanReadyForReviewInject, { agentId, format })
      .then((snapshot) => this.adoptBackendSnapshot(snapshot))
      .catch((error) => warnMain('debug', 'failed to inject plan review fixture', {
        agentId,
        detail: error instanceof Error ? error.message : String(error),
      }));
  }

  private injectDebugCodeReview(scenario: DebugCodeReviewScenario): void {
    const agentId = this.currentSelectedAgentId();
    if (!agentId || !this.backendClient || app?.isPackaged) return;

    void this.backendClient.request<AppSnapshot>(backendMethods.debugCodeReviewSet, { agentId, scenario })
      .then(async (snapshot) => {
        await this.adoptBackendSnapshot(snapshot);
        this.sendAppCommandToFocusedWindow({ type: 'debug-open-code-review' });
      })
      .catch((error) => warnMain('debug', 'failed to inject code review fixture', {
        agentId,
        scenario,
        detail: error instanceof Error ? error.message : String(error),
      }));
  }

  private populateDebugVisualize(scenario: import('@workspace/core/visualize').VisualizeDebugScenario): void {
    const agentId = this.currentSelectedAgentId();
    if (!agentId || !this.backendClient || app?.isPackaged) return;

    void this.backendClient.request<AppSnapshot>(backendMethods.debugVisualizePopulate, { agentId, scenario })
      .then(async (snapshot) => {
        await this.adoptBackendSnapshot(snapshot);
        this.sendAppCommandToFocusedWindow({ type: 'debug-open-visualize' });
      })
      .catch((error) => warnMain('debug', 'failed to populate Visualize fixture', {
        agentId,
        scenario,
        detail: error instanceof Error ? error.message : String(error),
      }));
  }

  private setDebugThreadFlag(id: ThreadFlagId, value: boolean): void {
    const agentId = this.currentSelectedAgentId();
    if (!agentId || !this.backendClient || app?.isPackaged) return;

    void this.backendClient.request<AppSnapshot>(backendMethods.debugThreadFlagSet, { agentId, id, value })
      .then((snapshot) => this.adoptBackendSnapshot(snapshot))
      .catch((error) => {
        warnMain('debug', 'failed to set thread flag fixture', {
          agentId,
          detail: error instanceof Error ? error.message : String(error),
        });
        this.refreshAppMenu();
      });
  }

  private emitBackendEvent(event: AppBackendEvent): void {
    if (event.type === 'snapshot.updated') event = { ...event, payload: projectClientSnapshot(event.payload, 'desktop') };
    if (event.snapshot) event = { ...event, snapshot: projectClientSnapshot(event.snapshot, 'desktop') };
    if (this.backendEventBuffer) {
      this.backendEventBuffer.push(event);
      return;
    }
    if (event.seq <= this.lastBackendEventSeq) { this.forwardProviderFrame(event); return; }
    if (event.seq !== this.lastBackendEventSeq + 1) {
      warnMain('daemon', 'backend event sequence gap; synchronizing snapshot', {
        expected: this.lastBackendEventSeq + 1,
        received: event.seq,
      });
      this.backendEventBuffer = [event];
      void this.synchronizeBackendState()
        .then((snapshot) => this.emitSnapshotToRenderer(snapshot))
        .catch((error) => this.handleBackendDisconnect(error instanceof Error ? error : new Error(String(error))));
      return;
    }
    this.applyBackendEvent(event, true);
  }

  // Product snapshots cover metadata only. Provider revisions are checked by the renderer.
  private forwardProviderFrame(event: AppBackendEvent): void {
    if (!isConversationFrame(event)) return;
    this.broadcastRendererEvent(withRendererMediaUrls(eventForRenderer(event), this.localMediaRegistry));
  }

  private applyBackendEvent(event: AppBackendEvent, notifyRenderer: boolean): void {
    const previousDebugMenuState = this.debugMenuState();
    const rendererEvent = eventForRenderer(event);
    const decodedSnapshot = decodeSnapshotFromBackendEvent(event);
    for (const snapshot of this.transientSnapshots) {
      if (decodedSnapshot) overwriteAppSnapshot(snapshot, decodedSnapshot.value);
      else if (event.type !== 'snapshot.updated') applyMainEventToSnapshot(snapshot, rendererEvent);
    }
    if (decodedSnapshot) {
      this.snapshot = decodedSnapshot.value;
    } else if (this.snapshot) {
      if (event.type !== 'snapshot.updated') applyMainEventToSnapshot(this.snapshot, rendererEvent);
    }
    this.mobileSimulator.retainAgents(this.snapshot?.agents.map(agent => agent.id) ?? []);
    this.policyAwareSpokenAnnouncements.refresh();
    if (isClientState(event.clientState)) {
      this.clientState = event.clientState;
    }

    this.lastBackendEventSeq = event.seq;
    this.syncPowerSaveBlocker();
    this.syncNativeAppearance();
    this.refreshDebugMenuIfChanged(previousDebugMenuState);
    if (notifyRenderer) this.broadcastRendererEvent(withRendererMediaUrls(rendererEvent, this.localMediaRegistry));
  }

  private handleBackendDisconnect(error?: Error): void {
    this.mobileSimulator.clear();
    if (this.shuttingDown) return;
    warnMain('daemon', 'backend connection lost', {
      detail: error?.message ?? 'unknown error',
      lastEventSeq: this.lastBackendEventSeq,
    });
    this.setConnectionState({ status: 'reconnecting', ...(error?.message ? { detail: error.message } : {}) });
    this.scheduleBackendReconnect();
  }

  private scheduleBackendReconnect(): void {
    if (this.reconnectTimer || this.shuttingDown) return;
    const delay = Math.min(10_000, 250 * (2 ** this.reconnectAttempt));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnectBackend();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async reconnectBackend(): Promise<void> {
    if (this.shuttingDown || !this.backendClient) return;
    try {
      await this.backendClient.start();
      const health = await this.backendClient.health();
      this.subscribeToBackendClient();
      const snapshot = await this.synchronizeBackendState();
      this.reconnectAttempt = 0;
      this.setConnectionState({ status: 'connected' });
      this.handleTelemetryActivity();
      this.emitSnapshotToRenderer(snapshot);
      logMain('daemon', 'reconnected to backend', { version: health.version, pid: health.pid });
    } catch (error) {
      this.reconnectAttempt += 1;
      warnMain('daemon', 'backend reconnect failed', {
        attempt: this.reconnectAttempt,
        detail: error instanceof Error ? error.message : String(error),
      });
      this.setConnectionState({ status: 'reconnecting', detail: error instanceof Error ? error.message : String(error) });
      this.scheduleBackendReconnect();
    }
  }

  private setConnectionState(state: ProviderConnectionState): void {
    this.connectionState = state;
    this.emitClientEvent({
      type: 'client.connectionChanged',
      payload: state,
    });
  }

  private emitSnapshotToRenderer(snapshot?: AppSnapshot): void {
    if (snapshot) {
      this.emitClientEvent({
        type: 'snapshot.updated',
        payload: snapshot,
        snapshot,
      });
    } else if (this.snapshot) {
      this.emitClientEvent({
        type: 'snapshot.updated',
        payload: this.snapshot,
      });
    }
  }

  private emitClientEvent(event: ClientEventInput): void {
    if (!this.windows.live().length) return;
    this.clientEventSeq += 1;
    const rendererEvent: MainToRendererEvent = {
      ...event,
      seq: this.clientEventSeq,
      source: 'client',
      occurredAt: new Date().toISOString(),
    };
    this.broadcastRendererEvent(withRendererMediaUrls(rendererEvent, this.localMediaRegistry));
  }

  // Window vibrancy (rail and sidebar) is drawn by the OS, so it only follows the app's appearance setting through nativeTheme.
  private syncNativeAppearance(): void {
    const mode = this.snapshot?.theme?.mode;
    if (nativeTheme && mode && nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode;
  }

  private syncPowerSaveBlocker(): void {
    const isOnBattery = powerMonitor?.isOnBatteryPower?.() ?? false;
    // Computer Use needs an unlocked screen; everything else only needs the system kept available.
    const plugins = this.snapshot?.general.plugins;
    this.powerSaveBlocker.sync(preventsAutomaticLock(plugins, Date.now()) ? 'display'
      : shouldBlockDisplaySleep(this.clientState, isOnBattery) ? 'suspension' : 'none');
    this.syncLockHold(plugins);
  }

  /**
   * An on-demand hold outlives restarts as a stored expiry. It ends at that time, and also when it no longer applies
   * (Computer Use disabled or another mode chosen). Ending it is a settings change, so every client sees it.
   */
  private syncLockHold(plugins: AppSnapshot['general']['plugins']): void {
    clearTimeout(this.lockHoldTimer);
    this.lockHoldTimer = undefined;
    const hold = plugins?.computerUseLockHold;
    if (!hold || this.shuttingDown) return;
    const applies = plugins.computerUseEnabled === true && plugins.computerUseLockPrevention === 'onDemand';
    if (!applies || (hold.until !== null && hold.until <= Date.now())) {
      void this.clearLockHold();
      return;
    }
    if (hold.until !== null) {
      this.lockHoldTimer = setTimeout(() => void this.clearLockHold(), Math.min(hold.until - Date.now(), maxTimerDelayMs));
    }
  }

  private async clearLockHold(): Promise<void> {
    if (this.clearingLockHold) return;
    this.clearingLockHold = true;
    try {
      await this.updateSettings({ general: { plugins: { computerUseLockHold: false } } });
    } catch (error) {
      warnMain('power', 'could not end the lock prevention hold', { message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.clearingLockHold = false;
    }
  }

  private flushPendingDeepLinkCommands(): void {
    const window = this.commandWindow();
    if (!window || !this.windows.isReady(window)) return;
    for (const command of this.pendingDeepLinkCommands.splice(0)) {
      sendAppCommand(window.webContents, command);
    }
  }

  /** Deep links and captures act on the workspace; a window that shows one agent cannot navigate to another. */
  private commandWindow(): BrowserWindow | undefined {
    return this.windows.focusedWorkspace();
  }

  private focusMainWindow(): void {
    const window = this.commandWindow() ?? this.windows.focused();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** The window commands without a target act on: the focused one, else the one last focused. */
  private currentWindow(): BrowserWindow | undefined {
    return this.windows.focused();
  }

  /** The agent the user is looking at: the current window's selection, else the daemon's last selection. */
  private currentSelectedAgentId(): string | null {
    return this.windows.selectedAgentOf(this.windows.focused()) ?? this.snapshot?.activeAgentId ?? null;
  }

  /** Resolves the window an IPC request came from. Senders that are not a known window act as the current one. */
  private setWindowSetup(window: BrowserWindow | undefined, setup: unknown): void {
    if (!window || !isWindowSetup(setup)) return;
    this.windows.setSetup(window, setup);
    this.scheduleLayoutSave();
  }

  private windowOf(event: unknown): BrowserWindow | undefined {
    const sender = (event as { sender?: unknown } | undefined)?.sender;
    return this.windows.live().find(window => window.webContents === sender) ?? this.windows.focused();
  }

  private broadcastRendererEvent(event: MainToRendererEvent): void {
    for (const window of this.windows.live()) sendRendererEvent(window.webContents, event);
  }

  private broadcastAppCommand(command: AppCommand): void {
    for (const window of this.windows.live()) sendAppCommand(window.webContents, command);
  }

  private sendAppCommandToFocusedWindow(command: AppCommand): void {
    const window = this.windows.focused();
    if (window) sendAppCommand(window.webContents, command);
  }

  /** The window a command about an agent's native view goes to: its owner, else the current window. */
  private nativeTargetWindow(resource: NativeResource, agentId: string): BrowserWindow | undefined {
    return this.windows.ownerOf(resource, agentId) ?? this.windows.focused();
  }

  private async requireBrowserWindow(window: BrowserWindow | undefined, agentId: string): Promise<void> {
    if (!window || window.isDestroyed()) throw new Error('Browser window is not available.');
    const lifecycle = this.nativeLifecycles.get(window);
    await lifecycle?.cleanup;
    if (window.isDestroyed() || this.nativeLifecycles.get(window) !== lifecycle) throw new Error('Browser window was reloaded.');
    const owner = this.windows.ownerOf('browser', agentId);
    if (owner && owner !== window) throw new Error('This agent’s browser is open in another window.');
  }

  private hostsBrowserPane(event: unknown, agentId: string, browserId: string): boolean {
    const window = this.windowOf(event);
    return window !== undefined && this.browserPane.isHostedBy(agentId, browserId, window);
  }

  private getWindowContext(window: BrowserWindow | undefined): WindowContext {
    return {
      windowId: window?.id ?? 0,
      viewState: window ? this.windows.viewStateOf(window) : null,
      nativeOwners: this.windows.nativeOwners(),
      composerDrafts: this.windows.composerDrafts(),
    };
  }

  private async claimNativeResource(window: BrowserWindow | undefined, resource: NativeResource, agentId: string, takeOver: boolean): Promise<boolean> {
    if (!window) return false;
    const lifecycle = this.nativeLifecycles.get(window);
    if (lifecycle) await lifecycle.cleanup;
    const owner = this.windows.ownerOf(resource, agentId);
    const ownerLifecycle = owner && this.nativeLifecycles.get(owner);
    if (ownerLifecycle) await ownerLifecycle.cleanup;
    const current = (): boolean => !window.isDestroyed() && this.windows.has(window) && this.nativeLifecycles.get(window) === lifecycle;
    if (!current()) return false;
    const claim = this.windows.claim(window, resource, agentId, takeOver);
    if (!claim.granted) return false;
    // The displaced window unmounts its view only after main has let go of the old guest.
    if (claim.displaced && resource === 'browser') {
      await this.browserPane.closeHostedBy(claim.displaced, agentId);
      if (!current() || this.windows.ownerOf(resource, agentId) !== window) return false;
      // The Browser carries its pages with it: the new owner opens where the old one was.
      const carried = this.windows.setupOf(claim.displaced)?.[agentId];
      if (carried) sendIpcEvent<AppIpcEvents, typeof ipcChannels.windowSetupApply>(window.webContents, ipcChannels.windowSetupApply, { [agentId]: carried });
    }
    this.broadcastNativeOwners();
    return true;
  }

  private resetNativeResources(window: BrowserWindow): void {
    const previous = this.nativeLifecycles.get(window);
    // Finish closing the old guests before any restored gate can mount its replacement.
    const lifecycle = { cleanup: Promise.resolve() };
    this.nativeLifecycles.set(window, lifecycle);
    lifecycle.cleanup = (previous?.cleanup ?? Promise.resolve())
      .then(() => this.browserPane.closeHostedBy(window))
      .then(() => { this.windows.releaseAll(window); })
      .catch(error => warnMain('window', 'failed to close reloaded native views', { detail: String(error) }));
    void lifecycle.cleanup.then(() => {
      if (this.nativeLifecycles.get(window) === lifecycle) this.broadcastNativeOwners();
    });
  }

  private releaseNativeResource(window: BrowserWindow | undefined, resource: NativeResource, agentId: string): void {
    if (window && this.windows.release(window, resource, agentId)) this.broadcastNativeOwners();
  }

  private broadcastNativeOwners(): void {
    const owners = this.windows.nativeOwners();
    for (const window of this.windows.live()) sendIpcEvent<AppIpcEvents, typeof ipcChannels.nativeOwnersChanged>(window.webContents, ipcChannels.nativeOwnersChanged, owners);
  }

  /** Drafts are one per agent: every other window mirrors the change as it happens. */
  private syncComposerDraft(origin: BrowserWindow | undefined, agentId: string, draft: ComposerDraft | null): void {
    this.windows.setDraft(agentId, draft);
    for (const window of this.windows.live()) {
      if (window === origin) continue;
      sendIpcEvent<AppIpcEvents, typeof ipcChannels.composerDraftChanged>(window.webContents, ipcChannels.composerDraftChanged, { agentId, draft });
    }
  }

  private syncAppshotsKeyMonitor(): void {
    if (!this.appshotsKeyMonitor) return;
    const hotkey = this.snapshot?.general.appshots?.hotkey ?? 'command';
    if (!this.appshotsKeyMonitor.start(hotkey, () => void this.captureAppshot())) {
      warnMain('appshots', 'failed to start native hotkey monitor', { hotkey });
    } else {
      logMain('appshots', hotkey === 'none' ? 'hotkey disabled' : 'hotkey monitor started', { hotkey });
    }
  }

  private async captureAppshot(): Promise<void> {
    if (this.appshotCapturePending) return;
    this.appshotCapturePending = true;
    try {
      const capture = await captureFrontmostAppshot();
      logMain('appshots', 'captured frontmost window', {
        appName: capture.appName,
        windowTitle: capture.windowTitle,
        accessibilityText: Boolean(capture.accessibilityText),
      });
      if (this.snapshot?.general.appshots?.playSound !== false) shell.beep();
      this.sendOrQueueAppCommand({ type: 'attach-appshot', ...capture });
    } catch (error) {
      this.sendOrQueueAppCommand({
        type: 'appshot-failed',
        message: error instanceof Error ? error.message : 'The Appshot could not be captured.',
      });
    } finally {
      this.appshotCapturePending = false;
      this.focusMainWindow();
    }
  }

  private sendOrQueueAppCommand(command: AppCommand): void {
    const window = this.commandWindow();
    if (!window || !this.windows.isReady(window)) {
      this.pendingDeepLinkCommands.push(command);
      if (app.isReady()) this.createWindow();
      return;
    }
    sendAppCommand(window.webContents, command);
  }

}

export function startMainApp(): void {
  if (installMacAppBeforeStartup()) return;
  initializeMainLogging();
  installProcessErrorLogging();
  const controller = new AppController(
    null,
    undefined,
    app,
    ensureCurrentDaemonForStartup,
    (url) => shell.openExternal(url),
    new AppshotsKeyMonitor(),
  );
  const autoUpdateService = new DesktopAutoUpdateService({
    app,
    updateBaseUrl: process.env.APP_UPDATE_BASE_URL,
    onStatusChanged: (status) => controller.setDesktopUpdateStatus(status),
  });
  controller.setAutoUpdateService(autoUpdateService);
  let shutdownStarted = false;
  // Native development targets and packaged apps own one instance per profile.
  // Untargeted Forge sessions can coexist with the installed app.
  if (requiresSingleInstanceLock(app.isPackaged, process.env.APP_DEV_PROTOCOL_SCHEME) && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  const openDeepLinks = (values: readonly string[]): void => {
    let accepted = false;
    for (const value of values) accepted = controller.openDeepLink(value) || accepted;
    if (accepted && app.isReady()) {
      controller.createWindow();
    }
  };
  app.on('open-url', (event, url) => {
    event.preventDefault();
    openDeepLinks([url]);
  });
  app.on('second-instance', (_event, argv) => {
    openDeepLinks(deepLinksFromArgv(argv, process.env.APP_DEV_PROTOCOL_SCHEME));
  });
  openDeepLinks(deepLinksFromArgv(process.argv, process.env.APP_DEV_PROTOCOL_SCHEME));
  controller.registerIpcHandlers();

  void app.whenReady().then(async () => {
    // Old partitions are unused; reclaim them without delaying window startup.
    void cleanupLegacyBrowserProfiles(app.getPath('userData')).catch((error) => {
      warnMain('browser', 'obsolete browser profile cleanup failed', {
        detail: error instanceof Error ? error.message : String(error),
      });
    });
    controller.installLocalMediaProtocol();
    if (process.env.APP_DEV_PROTOCOL_SCHEME) {
      // The profile-specific native launcher owns its alias registration.
    } else if (app.isPackaged) {
      app.setAsDefaultProtocolClient(appDeepLinkScheme);
    } else if (process.argv[1]) {
      app.setAsDefaultProtocolClient(appDeepLinkScheme, process.execPath, [path.resolve(process.argv[1])]);
    }
    controller.enableWindowLayout(path.join(app.getPath('userData'), 'window-layout.json'));
    try {
      await controller.initialize();
    } catch (error) {
      warnMain('startup', 'initialization failed; opening the recovery UI', {
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      controller.openStartupWindows();
    }
  });

  app.on('before-quit', (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    void controller.shutdown()
      .catch((error) => {
        warnMain('shutdown', 'failed to close app resources cleanly', {
          detail: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => app.exit(0));
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    controller.createWindow();
  });
}

function createEmptyClientState(): ClientState {
  return {
    sourceFolderPath: '',
    shouldPreventDisplaySleep: false,
  };
}

// Client-state field names are retained for compatibility; native protection allows display sleep.
/** Longest delay a timer takes; a hold never gets near it, but the clamp keeps a malformed expiry from firing at once. */
const maxTimerDelayMs = 2 ** 31 - 1;

/** Computer Use needs the Mac awake and unlocked: always in Always mode, and while a hold lasts in On demand mode. */
function preventsAutomaticLock(plugins: AppSnapshot['general']['plugins'], now: number): boolean {
  if (plugins?.computerUseEnabled !== true) return false;
  if (plugins.computerUseLockPrevention === 'always') return true;
  const hold = plugins.computerUseLockHold;
  return plugins.computerUseLockPrevention === 'onDemand' && !!hold && (hold.until === null || hold.until > now);
}

export function shouldBlockDisplaySleep(clientState: ClientState, isOnBattery: boolean): boolean {
  return clientState.shouldPreventDisplaySleep ||
    (clientState.shouldPreventDisplaySleepForRemoteAccess === true && !isOnBattery);
}

export function requiresSingleInstanceLock(isPackaged: boolean, developmentScheme?: string): boolean {
  return isPackaged || Boolean(developmentScheme);
}

function overwriteAppSnapshot(target: AppSnapshot, source: AppSnapshot): void {
  const mutableTarget = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(mutableTarget)) {
    if (!(key in source)) delete mutableTarget[key];
  }
  Object.assign(target, source);
}

function isRemoteAutomationLocation(location: AutomationLocation | undefined): location is Extract<AutomationLocation, { kind: 'remote' }> {
  return location?.kind === 'remote' && location.remoteConnectionId.trim().length > 0;
}

function eventForRenderer(event: AppBackendEvent): MainToRendererEvent {
  return { ...event, source: 'provider' };
}

function decodeSnapshotFromBackendEvent(event: AppBackendEvent): DecodedAppSnapshot | null {
  const sideChannelSnapshot = decodeAppSnapshot(event.snapshot);
  if (sideChannelSnapshot) return sideChannelSnapshot;
  if (event.type !== 'snapshot.updated') return null;
  return decodeAppSnapshot(event.payload);
}
