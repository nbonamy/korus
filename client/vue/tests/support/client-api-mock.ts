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
  const nativeOwners = channel<Parameters<Parameters<Api['onNativeOwnersChanged']>[0]>[0]>();
  const setups = channel<Parameters<Parameters<Api['onWindowSetupApply']>[0]>[0]>();
  const drafts = channel<Parameters<Parameters<Api['onComposerDraftChanged']>[0]>[0]>();
  // Enumerating the public interface makes new required AND optional methods a type error here.
  const api = {
    design: unscripted<'design'>('design'),
    startVisualize: unscripted<'startVisualize'>('startVisualize'),
    setVisualizeOpen: unscripted<'setVisualizeOpen'>('setVisualizeOpen'),
    generateVisualizationSuggestion: unscripted<'generateVisualizationSuggestion'>('generateVisualizationSuggestion'),
    selectVisualization: unscripted<'selectVisualization'>('selectVisualization'),
    deleteVisualization: unscripted<'deleteVisualization'>('deleteVisualization'),
    saveRepositoryVisualization: unscripted<'saveRepositoryVisualization'>('saveRepositoryVisualization'),
    saveVisualizationCanvas: unscripted<'saveVisualizationCanvas'>('saveVisualizationCanvas'),
    readVisualizationAsset: unscripted<'readVisualizationAsset'>('readVisualizationAsset'),
    startCodeReview: unscripted<'startCodeReview'>('startCodeReview'),
    decideCodeReviewFinding: unscripted<'decideCodeReviewFinding'>('decideCodeReviewFinding'),
    discussCodeReviewFinding: unscripted<'discussCodeReviewFinding'>('discussCodeReviewFinding'),
    submitCodeReviewRound: unscripted<'submitCodeReviewRound'>('submitCodeReviewRound'),
    finishCodeReview: unscripted<'finishCodeReview'>('finishCodeReview'),
    commitCodeReview: unscripted<'commitCodeReview'>('commitCodeReview'),
    switchCodeReviewToManual: unscripted<'switchCodeReviewToManual'>('switchCodeReviewToManual'),
    discardCodeReview: unscripted<'discardCodeReview'>('discardCodeReview'),
    reviewCodeAgain: unscripted<'reviewCodeAgain'>('reviewCodeAgain'),
    setAutoResume: unscripted<'setAutoResume'>('setAutoResume'),
    respondToThreadFlag: unscripted<'respondToThreadFlag'>('respondToThreadFlag'),
    respondToPlanReview: unscripted<'respondToPlanReview'>('respondToPlanReview'),
    getSnapshot: unscripted<'getSnapshot'>('getSnapshot'),
    getSnapshotState: unscripted<'getSnapshotState'>('getSnapshotState'),
    listSshHosts: unscripted<'listSshHosts'>('listSshHosts'),
    addSshConnection: unscripted<'addSshConnection'>('addSshConnection'),
    checkRemoteConnection: unscripted<'checkRemoteConnection'>('checkRemoteConnection'),
    updateRemoteConnection: unscripted<'updateRemoteConnection'>('updateRemoteConnection'),
    removeRemoteConnection: unscripted<'removeRemoteConnection'>('removeRemoteConnection'),
    guestConversationControl: unscripted<'guestConversationControl'>('guestConversationControl'),
    guestConversationImage: unscripted<'guestConversationImage'>('guestConversationImage'),
    guestConversationContent: unscripted<'guestConversationContent'>('guestConversationContent'),
    conversationShareControl: unscripted<'conversationShareControl'>('conversationShareControl'),
    companionControl: unscripted<'companionControl'>('companionControl'),
    getRemoteControlStatus: unscripted<'getRemoteControlStatus'>('getRemoteControlStatus'),
    enableRemoteControl: unscripted<'enableRemoteControl'>('enableRemoteControl'),
    disableRemoteControl: unscripted<'disableRemoteControl'>('disableRemoteControl'),
    startDevicePairing: unscripted<'startDevicePairing'>('startDevicePairing'),
    checkDevicePairing: unscripted<'checkDevicePairing'>('checkDevicePairing'),
    listPairedDevices: unscripted<'listPairedDevices'>('listPairedDevices'),
    revokePairedDevice: unscripted<'revokePairedDevice'>('revokePairedDevice'),
    connectWorkProvider: unscripted<'connectWorkProvider'>('connectWorkProvider'),
    pollWorkProviderAuthorization: unscripted<'pollWorkProviderAuthorization'>('pollWorkProviderAuthorization'),
    disconnectWorkProvider: unscripted<'disconnectWorkProvider'>('disconnectWorkProvider'),
    listWorkSources: unscripted<'listWorkSources'>('listWorkSources'),
    configureWorkBacklog: unscripted<'configureWorkBacklog'>('configureWorkBacklog'),
    listGlobalWorkItems: unscripted<'listGlobalWorkItems'>('listGlobalWorkItems'),
    listAssignedWorkItems: unscripted<'listAssignedWorkItems'>('listAssignedWorkItems'),
    listWorkItems: unscripted<'listWorkItems'>('listWorkItems'),
    listProviderModels: unscripted<'listProviderModels'>('listProviderModels'),
    listProviderPlugins: unscripted<'listProviderPlugins'>('listProviderPlugins'),
    listProviderSkills: unscripted<'listProviderSkills'>('listProviderSkills'),
    getRunProfiles: unscripted<'getRunProfiles'>('getRunProfiles'),
    getRunProfileActions: unscripted<'getRunProfileActions'>('getRunProfileActions'),
    saveRunProfile: unscripted<'saveRunProfile'>('saveRunProfile'),
    deleteRunProfile: unscripted<'deleteRunProfile'>('deleteRunProfile'),
    startRunProfile: unscripted<'startRunProfile'>('startRunProfile'),
    stopProfileRun: unscripted<'stopProfileRun'>('stopProfileRun'),
    stopAgentProfileRuns: unscripted<'stopAgentProfileRuns'>('stopAgentProfileRuns'),
    listAgentFiles: unscripted<'listAgentFiles'>('listAgentFiles'),
    listAgentDirectory: unscripted<'listAgentDirectory'>('listAgentDirectory'),
    getDocumentWorkspaces: vi.fn().mockResolvedValue({}),
    updateDocumentWorkspace: unscripted<'updateDocumentWorkspace'>('updateDocumentWorkspace'),
    readWorkspaceDocument: unscripted<'readWorkspaceDocument'>('readWorkspaceDocument'),
    saveWorkspaceDocument: unscripted<'saveWorkspaceDocument'>('saveWorkspaceDocument'),
    chooseDocumentSavePath: unscripted<'chooseDocumentSavePath'>('chooseDocumentSavePath'),
    previewAgentFile: unscripted<'previewAgentFile'>('previewAgentFile'),
    readAgentFileChunk: unscripted<'readAgentFileChunk'>('readAgentFileChunk'),
    getAgentGitLog: unscripted<'getAgentGitLog'>('getAgentGitLog'),
    getAgentGitLogCommit: unscripted<'getAgentGitLogCommit'>('getAgentGitLogCommit'),
    getAgentGitLogFile: unscripted<'getAgentGitLogFile'>('getAgentGitLogFile'),
    getAgentGitDiff: unscripted<'getAgentGitDiff'>('getAgentGitDiff'),
    previewBranchCurrentWork: unscripted<'previewBranchCurrentWork'>('previewBranchCurrentWork'),
    branchCurrentWork: unscripted<'branchCurrentWork'>('branchCurrentWork'),
    getAgentGitWorkflow: unscripted<'getAgentGitWorkflow'>('getAgentGitWorkflow'),
    getAgentClosePreview: unscripted<'getAgentClosePreview'>('getAgentClosePreview'),
    listAgentTasks: vi.fn().mockResolvedValue([]),
    cancelAgentTask: unscripted<'cancelAgentTask'>('cancelAgentTask'),
    cancelAgentGitMessage: unscripted<'cancelAgentGitMessage'>('cancelAgentGitMessage'),
    generateAgentGitMessage: unscripted<'generateAgentGitMessage'>('generateAgentGitMessage'),
    stageAgentGitFiles: unscripted<'stageAgentGitFiles'>('stageAgentGitFiles'),
    commitAgentGitChanges: unscripted<'commitAgentGitChanges'>('commitAgentGitChanges'),
    pushAgentGitBranch: unscripted<'pushAgentGitBranch'>('pushAgentGitBranch'),
    createAgentGitBranch: unscripted<'createAgentGitBranch'>('createAgentGitBranch'),
    createAgentGitPullRequest: unscripted<'createAgentGitPullRequest'>('createAgentGitPullRequest'),
    mergeAgentGitBranch: unscripted<'mergeAgentGitBranch'>('mergeAgentGitBranch'),
    updateAgentGitBranchFromBase: unscripted<'updateAgentGitBranchFromBase'>('updateAgentGitBranchFromBase'),
    pullAgentGitBranch: unscripted<'pullAgentGitBranch'>('pullAgentGitBranch'),
    revertAgentGitChanges: unscripted<'revertAgentGitChanges'>('revertAgentGitChanges'),
    getAgentGitPrune: unscripted<'getAgentGitPrune'>('getAgentGitPrune'),
    pruneAgentGit: unscripted<'pruneAgentGit'>('pruneAgentGit'),
    getOpenInApplications: unscripted<'getOpenInApplications'>('getOpenInApplications'),
    openAgentPath: unscripted<'openAgentPath'>('openAgentPath'),
    openAgentFile: unscripted<'openAgentFile'>('openAgentFile'),
    chooseAgentFolder: unscripted<'chooseAgentFolder'>('chooseAgentFolder'),
    chooseSourceFolder: unscripted<'chooseSourceFolder'>('chooseSourceFolder'),
    listSourceFolders: unscripted<'listSourceFolders'>('listSourceFolders'),
    listSourceRepositories: unscripted<'listSourceRepositories'>('listSourceRepositories'),
    cloneSourceRepository: unscripted<'cloneSourceRepository'>('cloneSourceRepository'),
    previewRepositoryDeletion: unscripted<'previewRepositoryDeletion'>('previewRepositoryDeletion'),
    deleteRepository: unscripted<'deleteRepository'>('deleteRepository'),
    createSourceRepository: unscripted<'createSourceRepository'>('createSourceRepository'),
    createProject: unscripted<'createProject'>('createProject'),
    listSourceBranches: unscripted<'listSourceBranches'>('listSourceBranches'),
    listSourceWorktrees: unscripted<'listSourceWorktrees'>('listSourceWorktrees'),
    suggestSourceWorktreePath: unscripted<'suggestSourceWorktreePath'>('suggestSourceWorktreePath'),
    chooseSourceWorktreeDestination: unscripted<'chooseSourceWorktreeDestination'>('chooseSourceWorktreeDestination'),
    createSourceWorktree: unscripted<'createSourceWorktree'>('createSourceWorktree'),
    createTeam: unscripted<'createTeam'>('createTeam'),
    updateTeam: unscripted<'updateTeam'>('updateTeam'),
    reorderTeams: unscripted<'reorderTeams'>('reorderTeams'),
    closeTeam: unscripted<'closeTeam'>('closeTeam'),
    selectTeam: unscripted<'selectTeam'>('selectTeam'),
    getAutomationSnapshot: unscripted<'getAutomationSnapshot'>('getAutomationSnapshot'),
    createAutomation: unscripted<'createAutomation'>('createAutomation'),
    updateAutomation: unscripted<'updateAutomation'>('updateAutomation'),
    runAutomation: unscripted<'runAutomation'>('runAutomation'),
    clearAutomationHistory: unscripted<'clearAutomationHistory'>('clearAutomationHistory'),
    deleteAutomationExecution: unscripted<'deleteAutomationExecution'>('deleteAutomationExecution'),
    deleteAutomation: unscripted<'deleteAutomation'>('deleteAutomation'),
    listAgentConversations: unscripted<'listAgentConversations'>('listAgentConversations'),
    resumeAgentConversation: unscripted<'resumeAgentConversation'>('resumeAgentConversation'),
    readConversationMessages: unscripted<'readConversationMessages'>('readConversationMessages'),
    createAgent: unscripted<'createAgent'>('createAgent'),
    executeMission: unscripted<'executeMission'>('executeMission'),
    createMission: unscripted<'createMission'>('createMission'),
    selectMission: unscripted<'selectMission'>('selectMission'),
    deleteMission: unscripted<'deleteMission'>('deleteMission'),
    featureControl: unscripted<'featureControl'>('featureControl'),
    readMissionArtifact: unscripted<'readMissionArtifact'>('readMissionArtifact'),
    updateMission: unscripted<'updateMission'>('updateMission'),
    createQuickChat: unscripted<'createQuickChat'>('createQuickChat'),
    updateAgent: unscripted<'updateAgent'>('updateAgent'),
    assignWorkItemToAgent: unscripted<'assignWorkItemToAgent'>('assignWorkItemToAgent'),
    removeWorkItemAssignment: unscripted<'removeWorkItemAssignment'>('removeWorkItemAssignment'),
    duplicateAgent: unscripted<'duplicateAgent'>('duplicateAgent'),
    forkAgent: unscripted<'forkAgent'>('forkAgent'),
    handoffAgent: unscripted<'handoffAgent'>('handoffAgent'),
    moveAgentToTeam: unscripted<'moveAgentToTeam'>('moveAgentToTeam'),
    reorderAgents: unscripted<'reorderAgents'>('reorderAgents'),
    reorderRepositories: unscripted<'reorderRepositories'>('reorderRepositories'),
    restartAgent: unscripted<'restartAgent'>('restartAgent'),
    compressAgentSession: unscripted<'compressAgentSession'>('compressAgentSession'),
    loadConversationHistory: unscripted<'loadConversationHistory'>('loadConversationHistory'),
    loadOlderAgentHistory: unscripted<'loadOlderAgentHistory'>('loadOlderAgentHistory'),
    loadAgentTurnHistory: unscripted<'loadAgentTurnHistory'>('loadAgentTurnHistory'),
    readConversationContent: unscripted<'readConversationContent'>('readConversationContent'),
    closeAgent: unscripted<'closeAgent'>('closeAgent'),
    markAgentRead: vi.fn().mockResolvedValue(undefined),
    selectAgent: unscripted<'selectAgent'>('selectAgent'),
  getUsage: vi.fn().mockResolvedValue({recordedSince:0,retainedSince:0,rows:[]}),
  getTelemetryConsent: vi.fn().mockResolvedValue({enabled:false}),
  changeTelemetryConsent: unscripted<'changeTelemetryConsent'>('changeTelemetryConsent'),
  previewTelemetryDay: unscripted<'previewTelemetryDay'>('previewTelemetryDay'),
  clearUsage: unscripted<'clearUsage'>('clearUsage'),
    updateSettings: unscripted<'updateSettings'>('updateSettings'),
    readEngineInstructions: unscripted<'readEngineInstructions'>('readEngineInstructions'),
    manageSkills: unscripted<'manageSkills'>('manageSkills'),
    saveEngineInstructions: unscripted<'saveEngineInstructions'>('saveEngineInstructions'),
    getDictationSettings: unscripted<'getDictationSettings'>('getDictationSettings'),
    getDictationApiKey: unscripted<'getDictationApiKey'>('getDictationApiKey'),
    updateDictationSettings: unscripted<'updateDictationSettings'>('updateDictationSettings'),
    previewSpokenAnnouncementVoice: unscripted<'previewSpokenAnnouncementVoice'>('previewSpokenAnnouncementVoice'),
    getCodexResourceSharingStatus: unscripted<'getCodexResourceSharingStatus'>('getCodexResourceSharingStatus'),
    setCodexResourceSharing: unscripted<'setCodexResourceSharing'>('setCodexResourceSharing'),
    getPluginStatus: unscripted<'getPluginStatus'>('getPluginStatus'),
    getCodexAuthentication: unscripted<'getCodexAuthentication'>('getCodexAuthentication'),
    getClaudeAuthentication: unscripted<'getClaudeAuthentication'>('getClaudeAuthentication'),
    getProviderSetup: unscripted<'getProviderSetup'>('getProviderSetup'),
    getProviderUpdate: vi.fn<Api['getProviderUpdate']>(async provider => ({ provider: provider, status: 'unavailable', method: 'manual', canUpgrade: false, busy: false })),
    setProviderUpdate: unscripted<'setProviderUpdate'>('setProviderUpdate'),
    getProviderConnections: unscripted<'getProviderConnections'>('getProviderConnections'),
    getBankedResets: vi.fn<Api['getBankedResets']>(async () => ({ status: 'unsupported' })),
    useBankedReset: unscripted<'useBankedReset'>('useBankedReset'),
    getProviderUsage: unscripted<'getProviderUsage'>('getProviderUsage'),
    setProviderEnabled: unscripted<'setProviderEnabled'>('setProviderEnabled'),
    disconnectProvider: unscripted<'disconnectProvider'>('disconnectProvider'),
    authenticateProvider: unscripted<'authenticateProvider'>('authenticateProvider'),
    configureProviderSetup: unscripted<'configureProviderSetup'>('configureProviderSetup'),
    installProvider: unscripted<'installProvider'>('installProvider'),
    refreshProvider: unscripted<'refreshProvider'>('refreshProvider'),
    cancelCodexChatGptLogin: unscripted<'cancelCodexChatGptLogin'>('cancelCodexChatGptLogin'),
    startCodexChatGptDeviceCodeLogin: unscripted<'startCodexChatGptDeviceCodeLogin'>('startCodexChatGptDeviceCodeLogin'),
    startCodexChatGptLogin: unscripted<'startCodexChatGptLogin'>('startCodexChatGptLogin'),
    logoutCodex: unscripted<'logoutCodex'>('logoutCodex'),
    getUpdateStatus: unscripted<'getUpdateStatus'>('getUpdateStatus'),
    installUpdate: unscripted<'installUpdate'>('installUpdate'),
    setDockBadgeCount: unscripted<'setDockBadgeCount'>('setDockBadgeCount'),
    getDaemonStatus: unscripted<'getDaemonStatus'>('getDaemonStatus'),
    setDaemonEnabled: unscripted<'setDaemonEnabled'>('setDaemonEnabled'),
    getSystemPermissions: unscripted<'getSystemPermissions'>('getSystemPermissions'),
    openAccessibilitySettings: unscripted<'openAccessibilitySettings'>('openAccessibilitySettings'),
    openScreenRecordingSettings: unscripted<'openScreenRecordingSettings'>('openScreenRecordingSettings'),
    launchChatGptApp: unscripted<'launchChatGptApp'>('launchChatGptApp'),
    quit: unscripted<'quit'>('quit'),
    setMenuBarVisible: vi.fn<AppApi['setMenuBarVisible']>().mockResolvedValue(undefined),
    restartApp: unscripted<'restartApp'>('restartApp'),
    reloadRenderer: unscripted<'reloadRenderer'>('reloadRenderer'),
    getWindowContext: unscripted<'getWindowContext'>('getWindowContext'),
    openWindow: unscripted<'openWindow'>('openWindow'),
    setWindowSelection: unscripted<'setWindowSelection'>('setWindowSelection'),
    setWindowSetup: unscripted<'setWindowSetup'>('setWindowSetup'),
    claimNativeResource: unscripted<'claimNativeResource'>('claimNativeResource'),
    releaseNativeResource: unscripted<'releaseNativeResource'>('releaseNativeResource'),
    syncComposerDraft: unscripted<'syncComposerDraft'>('syncComposerDraft'),
    setAgentGoal: unscripted<'setAgentGoal'>('setAgentGoal'),
    clearAgentGoal: unscripted<'clearAgentGoal'>('clearAgentGoal'),
    setAgentApprovalPreset: unscripted<'setAgentApprovalPreset'>('setAgentApprovalPreset'),
    setAgentPermissionMode: unscripted<'setAgentPermissionMode'>('setAgentPermissionMode'),
    sendPrompt: unscripted<'sendPrompt'>('sendPrompt'),
    steerPrompt: unscripted<'steerPrompt'>('steerPrompt'),
    deleteQueuedPrompt: unscripted<'deleteQueuedPrompt'>('deleteQueuedPrompt'),
    steerQueuedPrompt: unscripted<'steerQueuedPrompt'>('steerQueuedPrompt'),
    updateQueuedPrompt: unscripted<'updateQueuedPrompt'>('updateQueuedPrompt'),
    interruptAgent: unscripted<'interruptAgent'>('interruptAgent'),
    deleteTurn: unscripted<'deleteTurn'>('deleteTurn'),
    editTurn: unscripted<'editTurn'>('editTurn'),
    retryTurn: unscripted<'retryTurn'>('retryTurn'),
    continueInterruptedTurn: unscripted<'continueInterruptedTurn'>('continueInterruptedTurn'),
    mobileSimulator: unscripted<'mobileSimulator'>('mobileSimulator'),
    mobileSimulatorView: unscripted<'mobileSimulatorView'>('mobileSimulatorView'),
    browserExtensions: vi.fn().mockResolvedValue({ extensions: [] }),
    browserOpen: unscripted<'browserOpen'>('browserOpen'),
    browserOpenVisualization: unscripted<'browserOpenVisualization'>('browserOpenVisualization'),
    browserNavigate: unscripted<'browserNavigate'>('browserNavigate'),
    browserGoBack: unscripted<'browserGoBack'>('browserGoBack'),
    browserGoForward: unscripted<'browserGoForward'>('browserGoForward'),
    browserReload: unscripted<'browserReload'>('browserReload'),
    browserOpenDevTools: unscripted<'browserOpenDevTools'>('browserOpenDevTools'),
    browserClearBrowsingData: unscripted<'browserClearBrowsingData'>('browserClearBrowsingData'),
    browserGetZoom: unscripted<'browserGetZoom'>('browserGetZoom'),
    browserSetZoom: unscripted<'browserSetZoom'>('browserSetZoom'),
    browserCopyScreenshot: unscripted<'browserCopyScreenshot'>('browserCopyScreenshot'),
    browserSetBounds: unscripted<'browserSetBounds'>('browserSetBounds'),
    browserViewportApplied: unscripted<'browserViewportApplied'>('browserViewportApplied'),
    browserSetVisible: unscripted<'browserSetVisible'>('browserSetVisible'),
    browserSetAnnotationMode: unscripted<'browserSetAnnotationMode'>('browserSetAnnotationMode'),
    browserResolveAnnotation: unscripted<'browserResolveAnnotation'>('browserResolveAnnotation'),
    browserClearAnnotations: unscripted<'browserClearAnnotations'>('browserClearAnnotations'),
    browserClose: unscripted<'browserClose'>('browserClose'),
    respondToClientRequest: unscripted<'respondToClientRequest'>('respondToClientRequest'),
    onEvent: unscripted<'onEvent'>('onEvent'),
    onAppCommand: unscripted<'onAppCommand'>('onAppCommand'),
    onUpdateStatusChanged: unscripted<'onUpdateStatusChanged'>('onUpdateStatusChanged'),
    onNativeOwnersChanged: unscripted<'onNativeOwnersChanged'>('onNativeOwnersChanged'),
    onComposerDraftChanged: unscripted<'onComposerDraftChanged'>('onComposerDraftChanged'),
    onWindowSetupApply: unscripted<'onWindowSetupApply'>('onWindowSetupApply'),
  } satisfies ApiMocks;

  api.getSnapshot.mockImplementation(async () => structuredClone(snapshot));
  api.getSnapshotState.mockImplementation(async () => ({ ...structuredClone(state), snapshot: await api.getSnapshot() }));
  api.loadConversationHistory.mockImplementation(async () => api.getSnapshot());
  api.getAutomationSnapshot.mockImplementation(async () => api.getSnapshot());
  api.onEvent.mockImplementation(events.subscribe);
  api.guestConversationControl.mockImplementation(async input => { if (input.action === 'state') return { entries: [], view: null }; throw new Error('Unscripted guest operation.'); });
  api.onAppCommand.mockImplementation(commands.subscribe);
  api.onUpdateStatusChanged.mockImplementation(updates.subscribe);
  api.onNativeOwnersChanged.mockImplementation(nativeOwners.subscribe);
  api.onComposerDraftChanged.mockImplementation(drafts.subscribe);
  api.onWindowSetupApply.mockImplementation(setups.subscribe);

  // Harmless reads have explicit values; writes and consequential operations must be scripted.
  api.listSshHosts.mockResolvedValue([]);
  api.listPairedDevices.mockResolvedValue([]);
  api.listWorkSources.mockResolvedValue([]);
  api.listWorkItems.mockResolvedValue([]);
  api.listAssignedWorkItems.mockResolvedValue([]);
  api.listGlobalWorkItems.mockResolvedValue({ items: [], totalItems: 0 });
  api.listProviderModels.mockResolvedValue([]);
  api.listProviderPlugins.mockResolvedValue([]);
  api.listProviderSkills.mockResolvedValue([]);
  api.listAgentFiles.mockResolvedValue([]);
  api.listAgentDirectory.mockResolvedValue({ entries: [], nextCursor: null });
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
  api.getProviderUsage.mockImplementation(async provider => snapshot.providerAccountRateLimits?.[provider] ?? (provider === 'codex' ? snapshot.accountRateLimits : undefined) ?? null);
  api.getProviderSetup.mockResolvedValue(['codex', 'claude'].map(provider => ({ provider: provider, installed: true, isolated: true, shareSkills: true, locked: false, homePath: `/app/${provider}-home` })) as Awaited<ReturnType<AppApi['getProviderSetup']>>);
  api.getSystemPermissions.mockResolvedValue({ platform: 'darwin', accessibility: { required: true, trusted: true }, screenRecording: { required: true, trusted: true } });
  api.getUpdateStatus.mockResolvedValue({ state: 'idle' });
  api.getOpenInApplications.mockResolvedValue({ defaultApplication: 'vscode', applications: [] });
  // Routine host presentation notifications are observable no-ops, not backend mutations.
  api.setDockBadgeCount.mockResolvedValue(undefined);
  api.browserSetVisible.mockResolvedValue(undefined);
  api.browserSetBounds.mockResolvedValue(undefined);
  // A lone window: it owns every native view and has nothing to mirror.
  api.getWindowContext.mockResolvedValue({ windowId: 1, viewState: null, nativeOwners: [], composerDrafts: {} });
  api.setWindowSelection.mockResolvedValue(undefined);
  api.setWindowSetup.mockResolvedValue(undefined);
  api.openWindow.mockResolvedValue(undefined);
  api.claimNativeResource.mockResolvedValue(true);
  api.releaseNativeResource.mockResolvedValue(undefined);
  api.syncComposerDraft.mockResolvedValue(undefined);

  return {
    api,
    emit: events.emit,
    emitAppCommand: commands.emit,
    emitUpdateStatus: updates.emit,
    emitNativeOwners: nativeOwners.emit,
    emitComposerDraft: drafts.emit,
    emitWindowSetup: setups.emit,
    dispose() { events.clear(); commands.clear(); updates.clear(); nativeOwners.clear(); drafts.clear(); setups.clear(); },
  };
}
