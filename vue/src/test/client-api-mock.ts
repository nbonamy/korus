import { vi, type Mock } from 'vitest';
import type { AppSnapshot, AppApi, RendererSnapshotState } from '@workspace/core/contracts';
import { createInitialSnapshot } from '@workspace/core/snapshot';

type Api = Required<AppApi>;
type ApiMocks = { [K in keyof Api]: Mock<Api[K]> };

function unscripted<K extends keyof Api>(method: K): Mock<Api[K]> {
  return vi.fn<Api[K]>(() => { throw new Error(`Script the UI client method '${method}' before invoking it.`); });
}
function channel<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener: (value: T) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    emit(value: T) { for (const listener of listeners) listener(value); },
    clear() { listeners.clear(); },
  };
}

/** Full external client seam. Responses are scripted; no backend policy or reducer. */
export function createClientApiMock(
  snapshot: AppSnapshot = createInitialSnapshot(),
  state: Pick<RendererSnapshotState, 'lastBackendEventSeq' | 'connection'> = { lastBackendEventSeq: 0, connection: { status: 'connected' } },
) {
  const events = channel<Parameters<Parameters<Api['onEvent']>[0]>[0]>();
  const commands = channel<Parameters<Parameters<Api['onAppCommand']>[0]>[0]>();
  const updates = channel<Parameters<Parameters<Api['onUpdateStatusChanged']>[0]>[0]>();
  // Enumerating the public interface makes new required AND optional methods a type error here.
  const api = {
    startVisualize: unscripted('startVisualize'),
    setVisualizeOpen: unscripted('setVisualizeOpen'),
    generateVisualizationSuggestion: unscripted('generateVisualizationSuggestion'),
    selectVisualization: unscripted('selectVisualization'),
    deleteVisualization: unscripted('deleteVisualization'),
    saveVisualizationCanvas: unscripted('saveVisualizationCanvas'),
    readVisualizationAsset: unscripted('readVisualizationAsset'),
    startCodeReview: unscripted('startCodeReview'),
    decideCodeReviewFinding: unscripted('decideCodeReviewFinding'),
    discussCodeReviewFinding: unscripted('discussCodeReviewFinding'),
    submitCodeReviewRound: unscripted('submitCodeReviewRound'),
    finishCodeReview: unscripted('finishCodeReview'),
    commitCodeReview: unscripted('commitCodeReview'),
    switchCodeReviewToManual: unscripted('switchCodeReviewToManual'),
    discardCodeReview: unscripted('discardCodeReview'),
    reviewCodeAgain: unscripted('reviewCodeAgain'),
    respondToThreadFlag: unscripted('respondToThreadFlag'),
    respondToInteractivePlan: unscripted('respondToInteractivePlan'),
    respondToPlanReview: unscripted('respondToPlanReview'),
    getSnapshot: unscripted('getSnapshot'),
    getSnapshotState: unscripted('getSnapshotState'),
    listSshHosts: unscripted('listSshHosts'),
    addSshConnection: unscripted('addSshConnection'),
    checkRemoteConnection: unscripted('checkRemoteConnection'),
    updateRemoteConnection: unscripted('updateRemoteConnection'),
    removeRemoteConnection: unscripted('removeRemoteConnection'),
    getRemoteControlStatus: unscripted('getRemoteControlStatus'),
    enableRemoteControl: unscripted('enableRemoteControl'),
    disableRemoteControl: unscripted('disableRemoteControl'),
    startDevicePairing: unscripted('startDevicePairing'),
    checkDevicePairing: unscripted('checkDevicePairing'),
    listPairedDevices: unscripted('listPairedDevices'),
    revokePairedDevice: unscripted('revokePairedDevice'),
    connectWorkProvider: unscripted('connectWorkProvider'),
    pollWorkProviderAuthorization: unscripted('pollWorkProviderAuthorization'),
    disconnectWorkProvider: unscripted('disconnectWorkProvider'),
    listWorkSources: unscripted('listWorkSources'),
    configureWorkBacklog: unscripted('configureWorkBacklog'),
    listGlobalWorkItems: unscripted('listGlobalWorkItems'),
    listAssignedWorkItems: unscripted('listAssignedWorkItems'),
    listWorkItems: unscripted('listWorkItems'),
    listBackendModels: unscripted('listBackendModels'),
    listBackendPlugins: unscripted('listBackendPlugins'),
    listBackendSkills: unscripted('listBackendSkills'),
    listAgentFiles: unscripted('listAgentFiles'),
    getDocumentWorkspaces: vi.fn().mockResolvedValue({}),
    updateDocumentWorkspace: unscripted('updateDocumentWorkspace'),
    readWorkspaceDocument: unscripted('readWorkspaceDocument'),
    saveWorkspaceDocument: unscripted('saveWorkspaceDocument'),
    chooseDocumentSavePath: unscripted('chooseDocumentSavePath'),
    previewAgentFile: unscripted('previewAgentFile'),
    readAgentFileChunk: unscripted('readAgentFileChunk'),
    getAgentGitDiff: unscripted('getAgentGitDiff'),
    previewBranchCurrentWork: unscripted('previewBranchCurrentWork'),
    branchCurrentWork: unscripted('branchCurrentWork'),
    getAgentGitWorkflow: unscripted('getAgentGitWorkflow'),
    listAgentTasks: vi.fn().mockResolvedValue([]),
    cancelAgentTask: unscripted('cancelAgentTask'),
    generateAgentGitMessage: unscripted('generateAgentGitMessage'),
    stageAgentGitFiles: unscripted('stageAgentGitFiles'),
    commitAgentGitChanges: unscripted('commitAgentGitChanges'),
    pushAgentGitBranch: unscripted('pushAgentGitBranch'),
    createAgentGitBranch: unscripted('createAgentGitBranch'),
    createAgentGitPullRequest: unscripted('createAgentGitPullRequest'),
    mergeAgentGitBranch: unscripted('mergeAgentGitBranch'),
    updateAgentGitBranchFromBase: unscripted('updateAgentGitBranchFromBase'),
    pullAgentGitBranch: unscripted('pullAgentGitBranch'),
    revertAgentGitChanges: unscripted('revertAgentGitChanges'),
    getAgentGitPrune: unscripted('getAgentGitPrune'),
    pruneAgentGit: unscripted('pruneAgentGit'),
    getOpenInApplications: unscripted('getOpenInApplications'),
    openAgentPath: unscripted('openAgentPath'),
    chooseAgentFolder: unscripted('chooseAgentFolder'),
    chooseSourceFolder: unscripted('chooseSourceFolder'),
    listSourceFolders: unscripted('listSourceFolders'),
    listSourceRepositories: unscripted('listSourceRepositories'),
    cloneSourceRepository: unscripted('cloneSourceRepository'),
    createSourceRepository: unscripted('createSourceRepository'),
    createProject: unscripted('createProject'),
    listSourceBranches: unscripted('listSourceBranches'),
    listSourceWorktrees: unscripted('listSourceWorktrees'),
    suggestSourceWorktreePath: unscripted('suggestSourceWorktreePath'),
    chooseSourceWorktreeDestination: unscripted('chooseSourceWorktreeDestination'),
    createSourceWorktree: unscripted('createSourceWorktree'),
    createTeam: unscripted('createTeam'),
    updateTeam: unscripted('updateTeam'),
    reorderTeams: unscripted('reorderTeams'),
    closeTeam: unscripted('closeTeam'),
    disconnectTeam: unscripted('disconnectTeam'),
    selectTeam: unscripted('selectTeam'),
    getAutomationSnapshot: unscripted('getAutomationSnapshot'),
    createAutomation: unscripted('createAutomation'),
    updateAutomation: unscripted('updateAutomation'),
    runAutomation: unscripted('runAutomation'),
    clearAutomationHistory: unscripted('clearAutomationHistory'),
    deleteAutomationExecution: unscripted('deleteAutomationExecution'),
    deleteAutomation: unscripted('deleteAutomation'),
    listAgentConversations: unscripted('listAgentConversations'),
    resumeAgentConversation: unscripted('resumeAgentConversation'),
    readConversationMessages: unscripted('readConversationMessages'),
    createAgent: unscripted('createAgent'),
    executeMission: unscripted('executeMission'),
    createMission: unscripted('createMission'),
    selectMission: unscripted('selectMission'),
    deleteMission: unscripted('deleteMission'),
    readMissionArtifact: unscripted('readMissionArtifact'),
    updateMission: unscripted('updateMission'),
    createQuickChat: unscripted('createQuickChat'),
    updateAgent: unscripted('updateAgent'),
    assignWorkItemToAgent: unscripted('assignWorkItemToAgent'),
    removeWorkItemAssignment: unscripted('removeWorkItemAssignment'),
    duplicateAgent: unscripted('duplicateAgent'),
    forkAgent: unscripted('forkAgent'),
    handoffAgent: unscripted('handoffAgent'),
    moveAgentToTeam: unscripted('moveAgentToTeam'),
    reorderAgents: unscripted('reorderAgents'),
    reorderRepositories: unscripted('reorderRepositories'),
    restartAgent: unscripted('restartAgent'),
    compressAgentSession: unscripted('compressAgentSession'),
    loadConversationHistory: unscripted('loadConversationHistory'),
    loadOlderAgentHistory: unscripted('loadOlderAgentHistory'),
    closeAgent: unscripted('closeAgent'),
    selectAgent: unscripted('selectAgent'),
    updateSettings: unscripted('updateSettings'),
    readEngineInstructions: unscripted('readEngineInstructions'),
    saveEngineInstructions: unscripted('saveEngineInstructions'),
    previewSpokenAnnouncementVoice: unscripted('previewSpokenAnnouncementVoice'),
    getCodexResourceSharingStatus: unscripted('getCodexResourceSharingStatus'),
    setCodexResourceSharing: unscripted('setCodexResourceSharing'),
    getPluginStatus: unscripted('getPluginStatus'),
    getCodexAuthentication: unscripted('getCodexAuthentication'),
    getClaudeAuthentication: unscripted('getClaudeAuthentication'),
    getProviderSetup: unscripted('getProviderSetup'),
    getProviderUpdate: vi.fn<Api['getProviderUpdate']>(async backend => ({ backend, status: 'unavailable', method: 'manual', canUpgrade: false, busy: false })),
    setProviderUpdate: unscripted('setProviderUpdate'),
    getProviderConnections: unscripted('getProviderConnections'),
    getBankedResets: vi.fn<Api['getBankedResets']>(async () => ({ status: 'unsupported' })),
    useBankedReset: unscripted('useBankedReset'),
    getProviderUsage: unscripted('getProviderUsage'),
    setProviderEnabled: unscripted('setProviderEnabled'),
    disconnectProvider: unscripted('disconnectProvider'),
    authenticateProvider: unscripted('authenticateProvider'),
    configureProviderSetup: unscripted('configureProviderSetup'),
    refreshProvider: unscripted('refreshProvider'),
    cancelCodexChatGptLogin: unscripted('cancelCodexChatGptLogin'),
    startCodexChatGptDeviceCodeLogin: unscripted('startCodexChatGptDeviceCodeLogin'),
    startCodexChatGptLogin: unscripted('startCodexChatGptLogin'),
    logoutCodex: unscripted('logoutCodex'),
    getUpdateStatus: unscripted('getUpdateStatus'),
    installUpdate: unscripted('installUpdate'),
    setDockBadgeCount: unscripted('setDockBadgeCount'),
    getDaemonStatus: unscripted('getDaemonStatus'),
    setDaemonEnabled: unscripted('setDaemonEnabled'),
    getSystemPermissions: unscripted('getSystemPermissions'),
    openAccessibilitySettings: unscripted('openAccessibilitySettings'),
    openScreenRecordingSettings: unscripted('openScreenRecordingSettings'),
    launchChatGptApp: unscripted('launchChatGptApp'),
    quit: unscripted('quit'),
    setMenuBarVisible: vi.fn<AppApi['setMenuBarVisible']>().mockResolvedValue(undefined),
    restartApp: unscripted('restartApp'),
    reloadRenderer: unscripted('reloadRenderer'),
    setAgentGoal: unscripted('setAgentGoal'),
    clearAgentGoal: unscripted('clearAgentGoal'),
    setAgentApprovalPreset: unscripted('setAgentApprovalPreset'),
    setAgentPermissionMode: unscripted('setAgentPermissionMode'),
    sendPrompt: unscripted('sendPrompt'),
    steerPrompt: unscripted('steerPrompt'),
    deleteQueuedPrompt: unscripted('deleteQueuedPrompt'),
    steerQueuedPrompt: unscripted('steerQueuedPrompt'),
    updateQueuedPrompt: unscripted('updateQueuedPrompt'),
    interruptAgent: unscripted('interruptAgent'),
    deleteTurn: unscripted('deleteTurn'),
    editTurn: unscripted('editTurn'),
    retryTurn: unscripted('retryTurn'),
    continueInterruptedTurn: unscripted('continueInterruptedTurn'),
    mobileSimulator: unscripted('mobileSimulator'),
    mobileSimulatorView: unscripted('mobileSimulatorView'),
    browserOpen: unscripted('browserOpen'),
    browserOpenVisualization: unscripted('browserOpenVisualization'),
    browserNavigate: unscripted('browserNavigate'),
    browserGoBack: unscripted('browserGoBack'),
    browserGoForward: unscripted('browserGoForward'),
    browserReload: unscripted('browserReload'),
    browserGetZoom: unscripted('browserGetZoom'),
    browserSetZoom: unscripted('browserSetZoom'),
    browserCopyScreenshot: unscripted('browserCopyScreenshot'),
    browserSetBounds: unscripted('browserSetBounds'),
    browserViewportApplied: unscripted('browserViewportApplied'),
    browserSetVisible: unscripted('browserSetVisible'),
    browserSetAnnotationMode: unscripted('browserSetAnnotationMode'),
    browserResolveAnnotation: unscripted('browserResolveAnnotation'),
    browserClearAnnotations: unscripted('browserClearAnnotations'),
    browserClose: unscripted('browserClose'),
    respondToClientRequest: unscripted('respondToClientRequest'),
    onEvent: unscripted('onEvent'),
    onAppCommand: unscripted('onAppCommand'),
    onUpdateStatusChanged: unscripted('onUpdateStatusChanged'),
  } satisfies ApiMocks;

  api.getSnapshot.mockImplementation(async () => structuredClone(snapshot));
  api.getSnapshotState.mockImplementation(async () => ({ ...structuredClone(state), snapshot: await api.getSnapshot() }));
  api.loadConversationHistory.mockImplementation(async () => api.getSnapshot());
  api.getAutomationSnapshot.mockImplementation(async () => api.getSnapshot());
  api.onEvent.mockImplementation(events.subscribe);
  api.onAppCommand.mockImplementation(commands.subscribe);
  api.onUpdateStatusChanged.mockImplementation(updates.subscribe);

  // Harmless reads have explicit values; writes and consequential operations must be scripted.
  api.listSshHosts.mockResolvedValue([]);
  api.listPairedDevices.mockResolvedValue([]);
  api.listWorkSources.mockResolvedValue([]);
  api.listWorkItems.mockResolvedValue([]);
  api.listAssignedWorkItems.mockResolvedValue([]);
  api.listGlobalWorkItems.mockResolvedValue({ items: [], totalItems: 0 });
  api.listBackendModels.mockResolvedValue([]);
  api.listBackendPlugins.mockResolvedValue([]);
  api.listBackendSkills.mockResolvedValue([]);
  api.listAgentFiles.mockResolvedValue([]);
  api.listSourceRepositories.mockResolvedValue([]);
  api.listSourceBranches.mockResolvedValue([]);
  api.listSourceWorktrees.mockResolvedValue([]);
  api.listAgentConversations.mockResolvedValue([]);
  api.readConversationMessages.mockResolvedValue([]);
  api.getRemoteControlStatus.mockResolvedValue({ status: 'disabled' });
  api.getDaemonStatus.mockResolvedValue({ supported: true, installed: false, running: false, socketPath: '/test/daemon.sock' });
  api.getPluginStatus.mockResolvedValue({ chromeEnabled: false });
  api.getCodexResourceSharingStatus.mockResolvedValue({ enabled: false, migrationRequired: false });
  api.getCodexAuthentication.mockResolvedValue({ account: null, requiresOpenaiAuth: false, login: { status: 'idle', error: null } });
  api.getClaudeAuthentication.mockResolvedValue({ loggedIn: false });
  api.getProviderConnections.mockResolvedValue(snapshot.providerConnections ?? []);
  api.getProviderUsage.mockImplementation(async backend => snapshot.backendAccountRateLimits?.[backend] ?? (backend === 'codex' ? snapshot.accountRateLimits : undefined) ?? null);
  api.getProviderSetup.mockResolvedValue(['codex', 'claude'].map(backend => ({ backend, installed: true, isolated: true, shareSkills: true, locked: false, homePath: `/app/${backend}-home` })) as Awaited<ReturnType<AppApi['getProviderSetup']>>);
  api.getSystemPermissions.mockResolvedValue({ platform: 'darwin', accessibility: { required: true, trusted: true }, screenRecording: { required: true, trusted: true } });
  api.getUpdateStatus.mockResolvedValue({ state: 'idle' });
  api.getOpenInApplications.mockResolvedValue({ defaultApplication: 'vscode', applications: [] });
  // Routine host presentation notifications are observable no-ops, not backend mutations.
  api.setDockBadgeCount.mockResolvedValue(undefined);
  api.browserSetVisible.mockResolvedValue(undefined);
  api.browserSetBounds.mockResolvedValue(undefined);

  return {
    api,
    emit: events.emit,
    emitAppCommand: commands.emit,
    emitUpdateStatus: updates.emit,
    dispose() { events.clear(); commands.clear(); updates.clear(); },
  };
}
