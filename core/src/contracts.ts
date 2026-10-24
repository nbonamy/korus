import type {
  AgentBackend,
  AppText,
  ApprovalPreset,
  ReasoningEffort,
} from './contracts/shared';
import type { GitPruneInput, GitPruneInventory, GitPruneResult } from './contracts/git-prune';
export type { GitPruneInput, GitPruneInventory, GitPruneResult, GitPruneTarget } from './contracts/git-prune';
import type {
  AgentCloseInput,
  AgentGitBranchInput,
  AgentGitCommitInput,
  AgentGitDiffTarget,
  AgentGitDiffSection,
  AgentGitDiffSummary,
  AgentGitMergeInput,
  AgentGitMessageGenerationInput,
  AgentGitMessageGenerationResult, AgentGitPullRequestInput,
  AgentGitPushInput,
  AgentGitPullInput,
  AgentGitRevertInput,
  AgentGitPullResult,
  AgentGitStageInput,
  AgentGitStatus,
  AgentGitUpdateFromBaseInput,
  AgentGitUpdateFromBaseResult,
  AgentGitLogInput,
  AgentGitLogCommit,
  AgentGitLogPage,
  AgentGitLogCommitInput,
  AgentGitLogFile,
  AgentGitLogDetails,
  AgentGitLogFileInput,
  AgentGitLogFileDiff,
  AgentGitWorkflow,
  AgentPullRequestTracking,
  TurnGitDiff
} from './contracts/git';
import type {
  AgentFilePreviewResult,
  AgentFileSearchItem,
  AgentWorkspaceIdentity,
  CloneSourceRepositoryInput,
  CreateSourceRepositoryInput,
  CreateProjectInput,
  CreateSourceWorktreeInput,
  SourceBranch,
  SourceFolderListInput,
  SourceFolderListing,
  SourceFolderState,
  SourceRepository,
  SourceWorktree,
} from './contracts/workspace';
import type {
  AddSshConnectionInput,
  ClaudeAuthentication,
  DevicePairingSession,
  DevicePairingStatus,
  PairedDevice,
  RemoteConnectionsState,
  SshHostCandidate,
  UpdateRemoteConnectionInput,
} from './contracts/connections';
import type {
  AccountRateLimits,
  AgentModelSelection,
  BackendConnectionState,
  BackendDefaults,
  BackendModelOption,
  BackendPluginSummary,
  BackendRuntimeStatus,
  BackendSession,
  BackendSkillSummary,
  CodexAuthentication,
  CodexChatGptLogin,
  CodexChatGptDeviceCodeLogin
} from './contracts/backend';
import type {
  AgentHistoryLoadResult,
  AgentContextUsage,
  AgentQueuedPrompt,
  AgentSubagentTree, BackendConversationRef, ClientRequestResponse, ConversationListInput,
  ConversationResumeTarget,
  ConversationSummary, RendererMessage, RendererSendPromptOptions, ThreadGoal,
  ThreadPlan
} from './contracts/conversation';
import type {
  Automation,
  AutomationLocation,
  CreateAutomationInput,
  GlobalWorkItemQuery,
  UpdateAutomationInput, WorkBacklogConfigurationInput,
  WorkBacklogState,
  WorkItem,
  WorkItemPage,
  WorkItemQuery,
  WorkProviderAuthorization,
  WorkProviderKind,
  WorkProviderSettings,
  WorkSource
} from './contracts/work';
import type { MainToRendererEvent } from './contracts/events';

export type {
  AgentBackend,
  AppText,
  AppTextDescriptor,
  ApprovalPreset,
  ReasoningEffort,
} from './contracts/shared';
export type {
  AgentCloseInput,
  AgentGitBranchInput,
  AgentGitCommitInput,
  AgentGitDiff,
  AgentGitCommitSummary,
  AgentGitDiffCatalog,
  AgentGitDiffSummary,
  AgentGitDiffScope,
  AgentGitDiffSection,
  AgentGitDiffTarget,
  AgentGitFile,
  AgentGitMergeInput,
  AgentGitMessageGenerationInput,
  AgentGitMessageGenerationResult,
  AgentGitOperationProgress,
  AgentGitPullRequest,
  AgentGitPullRequestInput,
  AgentGitPushInput,
  AgentGitPullInput,
  AgentGitRevertInput,
  AgentGitPullResult,
  AgentGitStageInput,
  AgentGitStatus,
  AgentGitUpdateFromBaseInput,
  AgentGitUpdateFromBaseResult,
  AgentGitLogInput,
  AgentGitLogCommit,
  AgentGitLogPage,
  AgentGitLogCommitInput,
  AgentGitLogFile,
  AgentGitLogDetails,
  AgentGitLogFileInput,
  AgentGitLogFileDiff,
  AgentGitWorkflow,
  AgentPullRequestTracking,
  TurnGitDiff,
} from './contracts/git';
export type {
  AgentFilePreviewResult,
  AgentFileSearchItem,
  AgentWorkspaceIdentity,
  CloneSourceRepositoryInput,
  CreateSourceRepositoryInput,
  CreateProjectInput,
  CreateSourceWorktreeInput,
  SourceBranch,
  SourceFolderEntry,
  SourceFolderListInput,
  SourceFolderListing,
  SourceFolderState,
  SourceRepository,
  SourceWorktree,
} from './contracts/workspace';
export type {
  AddSshConnectionInput,
  ClaudeAuthentication,
  DevicePairingSession,
  DevicePairingStatus,
  PairedDevice,
  RemoteConnection,
  RemoteConnectionStatus,
  RemoteConnectionTransport,
  RemoteConnectionsState,
  SshHostCandidate,
  UpdateRemoteConnectionInput,
} from './contracts/connections';
export type {
  AccountRateLimitWindow,
  AccountRateLimits,
  AgentModelSelection,
  BackendCapabilities,
  BackendCommandSummary,
  BackendConnectionState,
  BackendDefaults,
  BackendModelOption,
  BackendPermissionModeOption,
  BackendPlanModeSupport,
  BackendPluginSummary,
  BackendReasoningEffortOption,
  BackendRuntimeStatus,
  BackendServiceTier,
  BackendSession,
  BackendSkillSummary,
  CodexAccount,
  CodexApprovalPreset,
  CodexApprovalsReviewer,
  CodexAuthentication,
  CodexChatGptLogin,
  CodexChatGptDeviceCodeLogin,
  CodexThreadSettings,
} from './contracts/backend';
export {
  subagentActivityKinds,
  subagentOperationKinds,
  subagentOperationLifecycles,
  subagentOperationStatuses,
  subagentStatuses,
} from './contracts/conversation';
export type {
  ClaudeConversationEvent,
  ClaudeConversationSnapshot,
  ClaudeConversationTurn,
} from './contracts/claude-conversation';
export type {
  AgentFileActivity,
  AgentHistoryLoadResult,
  AgentContextUsage,
  AgentQueuedPrompt,
  AgentSubagentTree,
  AskUserAnswers,
  AskUserQuestion,
  AskUserQuestionOption,
  AskUserRequest,
  BackendConversationRef,
  BackendPromptOptions,
  ClientRequest,
  ClientRequestResponse,
  ConfirmToolRequest,
  ConversationListInput,
  ConversationResumeTarget,
  ConversationStorageState,
  ConversationFileLink,
  ConversationSummary,
  PromptAttachment,
  PromptSkillInput,
  RendererMessage,
  RendererMessageAttachment,
  RendererMessageMedia,
  RendererMessagePart,
  RendererPromptAttachment,
  RendererSendPromptOptions,
  RendererToolPart,
  RendererToolPartUpdate,
  SendPromptOptions,
  SubagentActivity,
  SubagentActivityChange,
  SubagentActivityKind,
  SubagentIdentityChange,
  SubagentNode,
  SubagentOperation,
  SubagentOperationChange,
  SubagentOperationKind,
  SubagentOperationLifecycle,
  SubagentOperationStatus,
  SubagentStatus,
  SubagentStatusChange,
  ThreadGoal,
  ThreadGoalStatus,
  ThreadPlan,
  ThreadPlanKind,
  ThreadPlanStatus,
  ThreadPlanStep,
  ThreadPlanStepStatus,
  ToolConfirmationDecision,
} from './contracts/conversation';
export type {
  Automation,
  AutomationExecutionLogEntry,
  AutomationExecutionStatus,
  AutomationLocation,
  AutomationTarget,
  AutomationSchedule,
  CreateAutomationInput,
  WorkSourceConfiguration,
  WorkSourceConfigurationInput,
  GlobalWorkItemQuery,
  UpdateAutomationInput,
  WorkBacklogAssignment,
  WorkBacklogAssignmentPolicy,
  WorkBacklogAssignmentStatus,
  WorkBacklogConfigurationInput,
  WorkBacklogProviderConfigurations,
  WorkBacklogState,
  WorkIntegrationConnection,
  WorkIntegrationStatus,
  WorkItem,
  WorkItemKind,
  WorkItemReference,
  WorkItemLabel,
  WorkItemPage,
  WorkItemQuery,
  WorkItemState,
  WorkProviderAuthorization,
  WorkProviderKind,
  WorkProviderSettings,
  WorkSource,
} from './contracts/work';

export type AgentStatus =
  | { type: 'idle' }
  | { type: 'working'; detail?: AppText }
  | { type: 'awaitingInput'; detail?: AppText }
  | { type: 'error'; message: AppText };

export type Team = {
  id: string;
  name: string;
  avatar?: string;
  color?: string;
  remoteConnectionId?: string;
  remoteTeamId?: string;
  agentIds: string[];
  activeAgentId?: string;
};

export type BackendApprovalDecision = 'approve' | 'deny';
export type BackendApprovalScope = 'once' | 'session';
export type BackendRequestedPermission =
  | {
    kind: 'filesystem';
    access: 'read' | 'write' | 'deny';
    path: string;
  }
  | {
    kind: 'network';
    enabled: boolean;
    host?: string;
    protocol?: string;
  };
export type BackendApprovalRequest = {
  id: string;
  kind: 'command' | 'file-change' | 'permissions';
  conversationId: string;
  turnId?: string;
  itemId: string;
  title: string;
  description?: string;
  command?: string;
  cwd?: string;
  requestedPermissions?: BackendRequestedPermission[];
  allowedScopes?: BackendApprovalScope[];
  canDeny?: boolean;
};

export type OpenInApplication =
  | 'vscode'
  | 'finder'
  | 'terminal'
  | 'iterm2'
  | 'ghostty'
  | 'xcode'
  | 'android-studio'
  | 'jetbrains';

export type OpenInApplicationOption = {
  id: OpenInApplication;
  label: string;
  iconDataUrl?: string;
};

export type OpenInApplicationCatalog = {
  defaultApplication: OpenInApplication;
  applications: OpenInApplicationOption[];
};

export type Agent = {
  handoff?: import('./agent-handoff').AgentHandoff;
  id: string;
  teamId?: string;
  delegatedByAgentId?: string;
  delegationContext?: import('./delegation-context').DelegationContext;
  /** User-entered controls for the current delegation turn; never supplied by create-agent. */
  userDelegationOverrides?: import('./delegation-context').TurnDelegationOverrides;
  delegationUserInstructions?: import('./delegation-context').DelegationUserInstructions;
  pullRequest?: AgentPullRequestTracking;
  sessionKind?: 'quickChat';
  name: string | null;
  conversationTitle?: string;
  avatar?: string;
  folder: string | null;
  workspace?: AgentWorkspaceIdentity;
  backend: AgentBackend;
  backendSession?: BackendSession;
  /** Locks provider choice as soon as the first prompt is admitted. */
  hasSubmittedPrompt?: boolean;
  readState?: import('./agent-read-state').AgentReadState;
  backendDefaults?: BackendDefaults;
  openInApplication?: OpenInApplication;
  gitDiffTarget?: AgentGitDiffTarget;
  contextUsage?: AgentContextUsage;
  plan?: ThreadPlan;
  planReview?: import('./plan-review').PlanReview;
  /** Durable only while a review workflow is active; removed when the user finishes it. */
  codeReview?: import('./code-review').CodeReviewSession;
  threadFlags?: import('./thread-flags').ThreadFlags;
  /** Optional next-prompt hint, never composer draft text. Cleared on a new prompt or conversation reset. */
  suggestedPrompt?: string;
  goal?: ThreadGoal;
  visualize?: import('./visualize').VisualizeSession;
  isRegistered?: boolean;
  mcpSessionId?: string;
  statusText?: string;
  status: AgentStatus;
  createdAt: string;
  /** Last meaningful runtime activity, independent of metadata hydration. */
  lastActivityAt?: string;
  updatedAt: string;
};

export type WorkProviderConnectResult = {
  snapshot: AppSnapshot;
  authorization?: WorkProviderAuthorization;
};

export type AppearanceMode = 'dark' | 'light' | 'system';

export type AppThemeSettings = {
  id: string;
  mode: AppearanceMode;
  uiFontSize: number;
  chatFontSize: number;
  codeFontSize: number;
};

export type AppPluginSettings = {
  computerUseEnabled: boolean;
  chromeEnabled: boolean;
};

export type AppPluginStatus = {
  chromeEnabled: boolean;
};

export type AppshotHotkey = 'command' | 'option' | 'shift' | 'none';

export type AppshotSettings = {
  hotkey: AppshotHotkey;
  destination: 'active-agent';
  playSound: boolean;
};

export type WorktreeInitializationMode = 'automatic' | 'repository' | 'off';

export type SpokenAnnouncementScope = 'selected' | 'all';

export const spokenAnnouncementVoices = [
  'af_heart',
  'af_bella',
  'af_nicole',
  'af_sarah',
  'am_adam',
  'am_michael',
  'bf_emma',
  'bm_george',
] as const;

export type SpokenAnnouncementVoice = typeof spokenAnnouncementVoices[number];

export type AnnouncementPhase = 'start' | 'finish';

export type SpokenAnnouncementRequest = {
  agentId: string;
  phase: AnnouncementPhase;
  text: string;
  voice: SpokenAnnouncementVoice;
};

export type SpokenAnnouncementQueueResult = {
  queued: boolean;
  reason?: 'suppressed' | 'unsupported' | 'rateLimited' | 'superseded';
};

export type ModelFavorite = {
  backend: AgentBackend;
  modelId: string;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: string | null;
};

export type SavedPromptDraft = {
  id: string;
  agentId: string;
  text: string;
  createdAt: number;
};

export type CockpitAgentViewMode = 'teams' | 'recent';

export type AppGeneralSettings = {
  git?: import('./git-preferences').GitSettings;
  commitMessageInstructions: string;
  pullRequestInstructions: string;
  preventSleepWhenAgentsRun: boolean;
  preventSleepWhenRemoteAccessEnabled: boolean;
  celebrationsEnabled: boolean;
  followUpBehavior: 'queue' | 'steer';
  spokenAnnouncementsEnabled: boolean;
  spokenAnnouncementsMuted: boolean;
  spokenAnnouncementsOnlyForDictatedPrompts: boolean;
  spokenAnnouncementsOnlyWhenFocused: boolean;
  spokenAnnouncementScope: SpokenAnnouncementScope;
  spokenAnnouncementVoice: SpokenAnnouncementVoice;
  codexBinaryPath: string;
  claudeCodeEnabled: boolean;
  /** Undefined preserves Codex for existing installations. */
  codexEnabled?: boolean;
  providerOnboardingComplete?: boolean;
  providerHomes?: Partial<Record<AgentBackend, import('./contracts/provider-setup').ProviderHomeSettings>>;
  providerEnabled?: Partial<Record<AgentBackend, boolean>>;
  /** Last model selection made in a chat, per provider; seeds new agents. */
  providerModelDefaults?: Partial<Record<AgentBackend, AgentModelSelection>>;
  codeReviewDefaults?: import('./code-review').CodeReviewPreferences;
  /** Last explicitly selected approval mode; seeds new chats without changing existing ones. */
  providerApprovalDefaults?: { codex?: ApprovalPreset; claude?: string; antigravity?: string };
  agentListCompact: boolean;
  cockpitAgentViewMode: CockpitAgentViewMode;
  collapsedRepositoryKeys: string[];
  modelFavorites: ModelFavorite[];
  backlogRepositoryFavorites: Partial<Record<WorkProviderKind, string[]>>;
  savedPromptDrafts: SavedPromptDraft[];
  /** User-wide on the owning client, independent of browser tabs and agents. */
  browserBookmarks?: import('./browser-bookmarks').BrowserBookmark[];
  /** Adds optional Markdown choices to native plan review; defaults on. */
  useInteractivePlans?: boolean;
  worktreeInitializationMode: WorktreeInitializationMode;
  worktreeDelegationStartingContext?: import('./delegation-context').DelegationStartingContext;
  worktreeDelegationInstructions?: string;
  sessionCompressionWarningEnabled: boolean;
  repositoryIcons: Record<string, string>;
  appshots: AppshotSettings;
  /** Optional for backwards compatibility with pre-plugin state files. */
  plugins?: AppPluginSettings;
};

export type UpdateGeneralSettingsInput = Partial<Omit<AppGeneralSettings, 'plugins' | 'git'>> & {
  git?: Partial<import('./git-preferences').GitSettings>;
  plugins?: Partial<AppPluginSettings>;
};

export type ClientState = {
  sourceFolderPath: string;
  /** Agent activity requires sleep prevention regardless of power source. */
  shouldPreventDisplaySleep: boolean;
  /** Remote access requires sleep prevention only while connected to AC power. */
  shouldPreventDisplaySleepForRemoteAccess?: boolean;
};

export type SidePanelMarkdownRequest = {
  agentId?: string;
  documentId?: string;
  kind: 'markdown';
  purpose?: 'plan';
  title?: AppText;
  path?: string;
  content: string;
};

export type SidePanelGitDiffRequest = {
  kind: 'gitDiff';
  target?: AgentGitDiffTarget;
  summary?: AgentGitDiffSummary;
  scope?: 'workingTree' | 'turn';
  title?: AppText;
  subtitle?: AppText | null;
  diff: string;
  sections?: AgentGitDiffSection[];
  state?: 'idle' | 'error';
  error?: string | null;
};

export type SidePanelRequest = SidePanelMarkdownRequest | SidePanelGitDiffRequest;

export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserViewportBounds = BrowserBounds & {
  /** Guest viewport pixels hidden above or to the left of the visible bounds. */
  contentOffset?: { x: number; y: number };
};

export const PRIMARY_BROWSER_ID = 'primary';

export type BrowserAnnotation = {
  id: string;
  agentId: string;
  browserId: string;
  url: string;
  kind: 'element' | 'area';
  selector?: string;
  label?: string;
  comment?: string;
  rect: { x: number; y: number; width: number; height: number };
};

export type BrowserState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type SystemPermissionsStatus = {
  platform: string;
  accessibility: {
    required: boolean;
    trusted: boolean;
  };
  screenRecording: {
    required: boolean;
    trusted: boolean;
  };
};

export type LaunchChatGptAppInput = {
  quitRunning?: boolean;
};

export type LaunchChatGptAppResult = {
  status: 'alreadyRunning' | 'launched';
};

export type DaemonStatus = {
  supported: boolean;
  installed: boolean;
  running: boolean;
  socketPath: string;
  launchAgentPath?: string;
  version?: string;
  pid?: number;
  detail?: string;
};

export type UpdateSettingsInput = {
  general?: UpdateGeneralSettingsInput;
  sourceFolder?: Partial<Pick<SourceFolderState, 'path' | 'recentRepoNames'>>;
  theme?: Partial<AppThemeSettings>;
  workProviders?: Partial<Record<WorkProviderKind, WorkProviderSettings>>;
};

export type SetCodexResourceSharingInput =
  | { enabled: true }
  | { enabled: false; mode: 'fresh' | 'copy' | 'keep' };

export type CodexResourceSharingStatus = {
  enabled: boolean;
  migrationRequired: boolean;
};

export type AppSnapshot = {
  providerConnections?: import('./contracts/provider-setup').ProviderConnection[];
  missions?: import('./missions').Mission[];
  repositoryVisualizations?: import('./visualize').RepositoryVisualizations;
  clientPreferences?: Record<string, import('./client-preferences').ClientPreferences>;
  teams: Team[];
  agents: Agent[];
  automations: Automation[];
  activeTeamId: string | null;
  activeAgentId: string | null;
  queuedPrompts?: AgentQueuedPrompt[];
  backendApprovals: Record<string, BackendApprovalRequest[]>;
  agentRequests?: Record<string, import('./agent-request').AgentRequest[]>;
  agentGitStatuses: Record<string, AgentGitStatus>;
  turnGitDiffs: Record<string, TurnGitDiff>;
  subagentTrees: Record<string, AgentSubagentTree>;
  backendRuntimes: BackendRuntimeStatus[];
  accountRateLimits?: AccountRateLimits;
  /** Live account quotas, kept separate for each local engine. */
  backendAccountRateLimits?: Partial<Record<AgentBackend, AccountRateLimits>>;
  workBacklog: WorkBacklogState;
  remoteConnections: RemoteConnectionsState;
  general: AppGeneralSettings;
  sourceFolder: SourceFolderState;
  theme: AppThemeSettings;
};

export type RendererSnapshotState = {
  snapshot: AppSnapshot;
  lastBackendEventSeq: number;
  connection: BackendConnectionState;
};

export type { MainToRendererEvent, BackendPublishedEvent, BackendDomainEvent, ProviderConversationFrame, ClientEffectEvent, ClientTransportEvent } from './contracts/events';

export type CelebrationKind = 'confetti' | 'stars' | 'shapes' | 'schoolPride';

export type AgentCreationProgress = {
  id: string;
  state: 'running' | 'success' | 'error';
  backend: AgentBackend;
  repositoryName: string;
  createWorktree: boolean;
  createProject?: boolean;
  branchName?: string;
  hasPrompt: boolean;
  phase?: 'creatingProject' | 'creatingWorktree' | 'initializingWorktree' | 'creatingAgent' | 'startingPrompt';
  initializationDetail?: string;
  delegationContext?: import('./delegation-context').DelegationContext;
  agentId?: string;
  agentName?: string;
  error?: string;
};

export type AppCommand =
  | ({ type: 'set-browser-viewport' } & import('./browser-viewport').BrowserViewportRequest)
  | {
    type: 'attach-appshot';
    accessibilityText?: string;
    appName?: string;
    imageDataUrl: string;
    windowTitle?: string;
  }
  | { type: 'appshot-failed'; message: string }
  | { type: 'close-active-agent' }
  | { type: 'close-active-team' }
  | { type: 'compress-active-session' }
  | { type: 'compact-active-session' }
  | { type: 'cycle-agents'; direction: -1 | 1 }
  | { type: 'cycle-teams' }
  | { type: 'duplicate-active-agent' }
  | { type: 'fork-active-agent' }
  | { type: 'handoff-active-agent' }
  | { type: 'debug-approval-request' }
  | { type: 'debug-user-questions' }
  | { type: 'debug-celebrate'; kind: CelebrationKind }
  | { type: 'debug-image-annotation'; imageDataUrl?: string; pixelRatio?: 1 | 2 }
  | { type: 'debug-mark-unread' }
  | { type: 'debug-open-code-review' }
  | { type: 'debug-open-visualize' }
  | { type: 'debug-open-markdown' }
  | { type: 'debug-missing-engines'; enabled: boolean }
  | { type: 'debug-provider-upgrades'; enabled: boolean }
  | { type: 'debug-review-uncommitted'; enabled: boolean }
  | { type: 'debug-operation-progress'; kind: 'worktreeInitialization' | 'pullRequest' | 'merge' }
  | { type: 'edit-active-agent' }
  | { type: 'new-team' }
  | { type: 'open-agent-composer'; agentId?: string; prompt?: string; submit?: boolean }
  | { type: 'open-agent-palette' }
  | { type: 'open-simulator'; agentId: string }
  | { type: 'close-simulator'; agentId: string }
  | { type: 'open-browser'; agentId?: string; browserId?: string; url?: string }
  | { type: 'open-review' }
  | { type: 'open-saved-prompt-drafts' }
  | { type: 'open-settings' }
  | { type: 'open-whats-new' }
  | { type: 'open-keyboard-shortcuts' }
  | { type: 'open-command-palette' }
  | { type: 'quit' }
  | { type: 'restart-active-agent' }
  | { type: 'resume-active-session' }
  | { type: 'save-active-prompt-draft' }
  | { type: 'toggle-spoken-announcements-muted' };

export type CreateAgentInput = {
  name: string | null;
  folder: string;
  /** Open the selected repository branch without moving its primary checkout. */
  repositorySession?: {
    existingBranch?: string;
    fetchRemoteBranch?: boolean;
    worktree?: Omit<CreateSourceWorktreeInput, 'repoPath' | 'remoteConnectionId'>;
  };
  avatar?: string;
  backend?: AgentBackend;
  backendDefaults?: BackendDefaults;
  /** A model chosen at creation, layered over the provider defaults (unlike `backendDefaults`, which replaces them). */
  modelSelection?: Pick<AgentModelSelection, 'model'> & Partial<AgentModelSelection>;
  delegatedByAgentId?: string;
  sourceRepositoryName?: string;
  teamId?: string;
};

export type CreateQuickChatInput = {
  backend?: AgentBackend;
  teamId?: string;
};

/** Explicit command outcome; requested with entityResult, without changing legacy snapshot responses. */
export type CreatedAgentResult = { agentId: string; snapshot: AppSnapshot };

export type CreateTeamInput = {
  name: string;
  color: string;
  remoteConnectionId?: string;
  remoteTeamId?: string;
};

export type UpdateTeamInput = {
  id: string;
  name: string;
  color: string;
  remoteConnectionId?: string;
  remoteTeamId?: string;
};

export type ReorderTeamsInput = {
  teamId: string;
  beforeTeamId: string | null;
};

export type UpdateAgentInput = {
  id: string;
  backend?: AgentBackend;
  modelSelection?: AgentModelSelection;
  name?: string | null;
  gitDiffTarget?: AgentGitDiffTarget | null;
};

export type DuplicateAgentOptions = {
  select?: boolean;
  name?: string;
  backend?: AgentBackend;
};

export type MoveAgentToTeamInput = {
  agentId: string;
  teamId: string;
};

export type ReorderAgentsInput = {
  teamId: string;
  agentId: string;
  beforeAgentId: string | null;
};

export type ReorderRepositoriesInput = {
  teamId: string;
  repositoryRoot: string;
  beforeRepositoryRoot: string | null;
};

export type DesktopUpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type DesktopUpdateStatus = {
  state: DesktopUpdateState;
  error?: string;
  version?: string;
};

export type AppApi = {
  getUsage(filter?: import('./usage').UsageFilter): Promise<import('./usage').UsageSummary>;
  clearUsage(): Promise<void>;
  startVisualize(agentId: string, input?: import('./visualize').StartVisualizeInput): Promise<AppSnapshot>;
  setVisualizeOpen(agentId: string, input: import('./visualize').SetVisualizeOpenInput): Promise<AppSnapshot>;
  generateVisualizationSuggestion(agentId: string, input: import('./visualize').GenerateVisualizationSuggestionInput): Promise<AppSnapshot>;
  selectVisualization(agentId: string, input: import('./visualize').SelectVisualizationInput): Promise<AppSnapshot>;
  deleteVisualization(agentId: string, input: import('./visualize').DeleteVisualizationInput): Promise<AppSnapshot>;
  saveVisualizationCanvas(agentId: string, input: import('./visualize-canvas').SaveCanvasInput): Promise<import('./visualize-canvas').CanvasDocument>;
  readVisualizationAsset(agentId: string, visualizationId: string): Promise<import('./visualize').VisualizationAsset>;
  startCodeReview(agentId: string, input: import('./code-review').CodeReviewStartInput): Promise<AppSnapshot>;
  decideCodeReviewFinding(agentId: string, input: import('./code-review').CodeReviewDecisionInput): Promise<AppSnapshot>;
  discussCodeReviewFinding(agentId: string, input: import('./code-review').CodeReviewDiscussionInput): Promise<AppSnapshot>;
  submitCodeReviewRound(agentId: string, sessionId: string): Promise<AppSnapshot>;
  finishCodeReview(agentId: string, sessionId: string): Promise<AppSnapshot>;
  commitCodeReview(agentId: string, sessionId: string): Promise<AppSnapshot>;
  switchCodeReviewToManual(agentId: string, sessionId: string): Promise<AppSnapshot>;
  discardCodeReview(agentId: string, sessionId: string): Promise<AppSnapshot>;
  reviewCodeAgain(agentId: string, sessionId: string): Promise<AppSnapshot>;
  respondToThreadFlag(agentId: string, response: import('./thread-flags').ThreadFlagResponse): Promise<AppSnapshot>;
  respondToPlanReview(agentId: string, response: import('./plan-review').PlanReviewResponse): Promise<AppSnapshot>;
  getSnapshot(): Promise<AppSnapshot>;
  getSnapshotState(): Promise<RendererSnapshotState>;
  listSshHosts(): Promise<SshHostCandidate[]>;
  addSshConnection(input: AddSshConnectionInput): Promise<AppSnapshot>;
  checkRemoteConnection(connectionId: string, inspectOnly?: boolean): Promise<AppSnapshot>;
  updateRemoteConnection(connectionId: string, input: UpdateRemoteConnectionInput): Promise<AppSnapshot>;
  removeRemoteConnection(connectionId: string): Promise<AppSnapshot>;
  companionControl(input: import('./companion-protocol').CompanionControl): Promise<import('./companion-protocol').CompanionControlResult>;
  getRemoteControlStatus(): Promise<DevicePairingStatus>;
  enableRemoteControl(): Promise<DevicePairingStatus>;
  disableRemoteControl(): Promise<DevicePairingStatus>;
  startDevicePairing(): Promise<DevicePairingSession>;
  checkDevicePairing(session: DevicePairingSession): Promise<boolean>;
  listPairedDevices(environmentId: string): Promise<PairedDevice[]>;
  revokePairedDevice(environmentId: string, clientId: string): Promise<void>;
  connectWorkProvider(provider: WorkProviderKind): Promise<WorkProviderConnectResult>;
  pollWorkProviderAuthorization(provider: WorkProviderKind): Promise<AppSnapshot>;
  disconnectWorkProvider(provider: WorkProviderKind): Promise<AppSnapshot>;
  listWorkSources(provider: WorkProviderKind, location?: AutomationLocation): Promise<WorkSource[]>;
  configureWorkBacklog(input: WorkBacklogConfigurationInput, location?: AutomationLocation): Promise<AppSnapshot>;
  listGlobalWorkItems(provider: WorkProviderKind, location?: AutomationLocation, query?: GlobalWorkItemQuery): Promise<WorkItemPage>;
  listAssignedWorkItems?(provider: WorkProviderKind, location?: AutomationLocation): Promise<WorkItem[]>;
  listWorkItems(provider: WorkProviderKind, repositoryId: string, location?: AutomationLocation, query?: WorkItemQuery): Promise<WorkItem[]>;
  listBackendModels(agentId: string, backend?: AgentBackend): Promise<BackendModelOption[]>;
  listBackendPlugins(agentId: string): Promise<BackendPluginSummary[]>;
  listBackendSkills(agentId: string): Promise<BackendSkillSummary[]>;
  listAgentFiles(agentId: string): Promise<AgentFileSearchItem[]>;
  listAgentDirectory(agentId: string, input?: import('./contracts/workspace').AgentDirectoryInput): Promise<import('./contracts/workspace').AgentDirectoryPage>;
  getDocumentWorkspaces(): Promise<import('./document-workspace').DocumentWorkspaces>;
  updateDocumentWorkspace(agentId: string, change: import('./document-workspace').DocumentWorkspaceChange): Promise<import('./document-workspace').DocumentWorkspace>;
  readWorkspaceDocument(agentId: string, tabId: string): Promise<import('./document-workspace').DocumentReadResult>;
  saveWorkspaceDocument(agentId: string, input: import('./document-workspace').DocumentSaveInput): Promise<import('./document-workspace').DocumentWorkspace>;
  chooseDocumentSavePath(defaultPath: string): Promise<string | null>;
  previewAgentFile(agentId: string, filePath: string): Promise<AgentFilePreviewResult>;
  readAgentFileChunk(agentId: string, filePath: string, offset: number): Promise<import('./contracts/workspace').AgentFileChunk>;
  getAgentGitDiff(agentId: string, target?: AgentGitDiffTarget): Promise<import('./contracts/git').AgentGitDiff>;
  previewBranchCurrentWork(agentId: string): Promise<import('./branch-current-work').BranchWorkPreview>;
  branchCurrentWork(agentId: string, input: import('./branch-current-work').BranchWorkInput): Promise<import('./branch-current-work').BranchWorkResult>;
  getAgentGitLog(agentId: string, input?: AgentGitLogInput): Promise<AgentGitLogPage>;
  getAgentGitLogCommit(agentId: string, input: AgentGitLogCommitInput): Promise<AgentGitLogDetails>;
  getAgentGitLogFile(agentId: string, input: AgentGitLogFileInput): Promise<AgentGitLogFileDiff>;
  getAgentGitWorkflow(agentId: string): Promise<AgentGitWorkflow>;
  getAgentClosePreview(agentId: string): Promise<import('./agent-close').AgentClosePreview>;
  listAgentTasks(agentId: string): Promise<import('./delegated-task').DelegatedTask[]>;
  cancelAgentTask(agentId: string, taskId: string): Promise<import('./delegated-task').DelegatedTask>;
  generateAgentGitMessage(agentId: string, input: AgentGitMessageGenerationInput): Promise<AgentGitMessageGenerationResult>;
  stageAgentGitFiles(agentId: string, input: AgentGitStageInput): Promise<AgentGitWorkflow>;
  commitAgentGitChanges(agentId: string, input: AgentGitCommitInput): Promise<AgentGitWorkflow>;
  pushAgentGitBranch(agentId: string, input: AgentGitPushInput): Promise<AgentGitWorkflow>;
  pullAgentGitBranch(agentId: string, input: AgentGitPullInput): Promise<AgentGitPullResult>;
  revertAgentGitChanges(agentId: string, input: AgentGitRevertInput): Promise<AgentGitWorkflow>;
  getAgentGitPrune(agentId: string): Promise<GitPruneInventory>;
  pruneAgentGit(agentId: string, input: GitPruneInput): Promise<GitPruneResult>;
  createAgentGitBranch(agentId: string, input: AgentGitBranchInput): Promise<AgentGitWorkflow>;
  createAgentGitPullRequest(agentId: string, input: AgentGitPullRequestInput): Promise<AgentGitWorkflow>;
  mergeAgentGitBranch(agentId: string, input: AgentGitMergeInput): Promise<AgentGitWorkflow>;
  updateAgentGitBranchFromBase(agentId: string, input: AgentGitUpdateFromBaseInput): Promise<AgentGitUpdateFromBaseResult>;
  getOpenInApplications(): Promise<OpenInApplicationCatalog>;
  openAgentPath(agentId: string, application: OpenInApplication, filePath?: string): Promise<AppSnapshot>;
  chooseAgentFolder(): Promise<string | null>;
  chooseSourceFolder(): Promise<string | null>;
  listSourceFolders(input?: SourceFolderListInput): Promise<SourceFolderListing>;
  listSourceRepositories(remoteConnectionId?: string): Promise<SourceRepository[]>;
  cloneSourceRepository(input: CloneSourceRepositoryInput): Promise<SourceRepository>;
  createSourceRepository(input: CreateSourceRepositoryInput): Promise<SourceRepository>;
  createProject(input: CreateProjectInput): Promise<AppSnapshot>;
  listSourceBranches(repoPath: string, remoteConnectionId?: string): Promise<SourceBranch[]>;
  listSourceWorktrees(repoPath: string, remoteConnectionId?: string): Promise<SourceWorktree[]>;
  suggestSourceWorktreePath(input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath' | 'remoteConnectionId'>): Promise<string>;
  chooseSourceWorktreeDestination(defaultPath: string): Promise<string | null>;
  createSourceWorktree(input: CreateSourceWorktreeInput): Promise<SourceWorktree>;
  createTeam(input: CreateTeamInput): Promise<AppSnapshot>;
  updateTeam(input: UpdateTeamInput): Promise<AppSnapshot>;
  reorderTeams(input: ReorderTeamsInput): Promise<AppSnapshot>;
  closeTeam(teamId: string): Promise<AppSnapshot>;
  disconnectTeam(teamId: string): Promise<AppSnapshot>;
  selectTeam(teamId: string): Promise<AppSnapshot>;
  getAutomationSnapshot(location?: AutomationLocation): Promise<AppSnapshot>;
  createAutomation(input: CreateAutomationInput, location?: AutomationLocation): Promise<AppSnapshot>;
  updateAutomation(input: UpdateAutomationInput, location?: AutomationLocation): Promise<AppSnapshot>;
  runAutomation(automationId: string, location?: AutomationLocation): Promise<AppSnapshot>;
  clearAutomationHistory(automationId: string, location?: AutomationLocation): Promise<AppSnapshot>;
  deleteAutomationExecution(automationId: string, executionId: string, location?: AutomationLocation): Promise<AppSnapshot>;
  deleteAutomation(automationId: string, location?: AutomationLocation): Promise<AppSnapshot>;
  listAgentConversations(agentId: string, input?: ConversationListInput): Promise<ConversationSummary[]>;
  resumeAgentConversation(agentId: string, target: ConversationResumeTarget): Promise<AppSnapshot>;
  readConversationMessages(ref: BackendConversationRef, agentId: string, location?: AutomationLocation): Promise<RendererMessage[]>;
  createAgent(input: CreateAgentInput): Promise<AppSnapshot>;
  executeMission(input: import('./mission-execution').MissionExecutionInput): Promise<AppSnapshot>;
  createMission(input: import('./missions').CreateMissionInput): Promise<AppSnapshot>;
  selectMission(missionId: string | null): Promise<void>;
  deleteMission(input: import('./missions').DeleteMissionInput): Promise<AppSnapshot>;
  readMissionArtifact(missionId: string, stage: import('./missions').MissionStage): Promise<import('./mission-execution').MissionArtifactReadResult>;
  updateMission(input: import('./missions').UpdateMissionInput): Promise<AppSnapshot>;
  createQuickChat(input: CreateQuickChatInput): Promise<AppSnapshot>;
  updateAgent(input: UpdateAgentInput): Promise<AppSnapshot>;
  assignWorkItemToAgent(agentId: string, item: WorkItem): Promise<AppSnapshot>;
  removeWorkItemAssignment(item: WorkItem): Promise<AppSnapshot>;
  duplicateAgent(agentId: string, options?: DuplicateAgentOptions): Promise<AppSnapshot>;
  handoffAgent(agentId: string, input: import('./agent-handoff').AgentHandoffInput): Promise<AppSnapshot>;
  forkAgent(agentId: string, turnId?: string): Promise<AppSnapshot>;
  moveAgentToTeam(input: MoveAgentToTeamInput): Promise<AppSnapshot>;
  reorderAgents(input: ReorderAgentsInput): Promise<AppSnapshot>;
  reorderRepositories(input: ReorderRepositoriesInput): Promise<AppSnapshot>;
  restartAgent(agentId: string): Promise<AppSnapshot>;
  compressAgentSession(agentId: string): Promise<AppSnapshot>;
  loadConversationHistory(agentId: string): Promise<AppSnapshot>;
  loadOlderAgentHistory(agentId: string): Promise<AgentHistoryLoadResult>;
  readConversationContent(agentId: string, input: import('./contracts/conversation').ConversationContentInput): Promise<import('./contracts/conversation').ConversationContentChunk>;
  closeAgent(agentId: string, input?: AgentCloseInput): Promise<AppSnapshot>;
  selectAgent(agentId: string): Promise<AppSnapshot>;
  markAgentRead(agentId: string, revision: number): Promise<void>;
  updateSettings(input: UpdateSettingsInput): Promise<AppSnapshot>;
  readEngineInstructions(engine: AgentBackend): Promise<{ text: string; path: string }>;
  manageSkills(input: import('./skill-manager').SkillManagerInput): Promise<import('./skill-manager').SkillManagerState>;
  saveEngineInstructions(input: { engine: AgentBackend; text: string; all?: boolean; confirmed?: boolean }): Promise<void>;
  previewSpokenAnnouncementVoice(voice: SpokenAnnouncementVoice): Promise<SpokenAnnouncementQueueResult>;
  getCodexResourceSharingStatus(): Promise<CodexResourceSharingStatus>;
  setCodexResourceSharing(input: SetCodexResourceSharingInput): Promise<AppSnapshot>;
  getPluginStatus(): Promise<AppPluginStatus>;
  getCodexAuthentication(remoteConnectionId?: string): Promise<CodexAuthentication>;
  getClaudeAuthentication(remoteConnectionId?: string): Promise<ClaudeAuthentication>;
  getProviderSetup(remoteConnectionId?: string): Promise<import('./contracts/provider-setup').ProviderSetupStatus[]>;
  getProviderUpdate(backend: AgentBackend, remoteConnectionId?: string, refresh?: boolean): Promise<import('./contracts/provider-updates').ProviderUpdateStatus>;
  setProviderUpdate(backend: AgentBackend, input: import('./contracts/provider-updates').ProviderUpdateInput, remoteConnectionId?: string): Promise<import('./contracts/provider-updates').ProviderUpdateStatus>;
  getProviderConnections(remoteConnectionId?: string): Promise<import('./contracts/provider-setup').ProviderConnection[]>;
  getProviderUsage(backend: AgentBackend): Promise<AccountRateLimits | null>;
  getBankedResets(remoteConnectionId?: string): Promise<import('./contracts/banked-resets').BankedResets>;
  useBankedReset(input: import('./contracts/banked-resets').UseBankedResetInput, remoteConnectionId?: string): Promise<import('./contracts/banked-resets').BankedResetResult>;
  setProviderEnabled(backend: AgentBackend, enabled: boolean, remoteConnectionId?: string): Promise<import('./contracts/provider-setup').ProviderConnection[]>;
  disconnectProvider(backend: AgentBackend, remoteConnectionId?: string): Promise<import('./contracts/provider-setup').ProviderAuthentication>;
  authenticateProvider(backend: AgentBackend, action: 'login' | 'cancel'): Promise<import('./contracts/provider-setup').ProviderAuthentication>;
  configureProviderSetup(backend: AgentBackend, choice: import('./contracts/provider-setup').ProviderSetupChange): Promise<import('./contracts/provider-setup').ProviderSetupStatus>;
  installProvider(backend: AgentBackend, remoteConnectionId?: string): Promise<import('./contracts/provider-setup').ProviderSetupStatus>;
  refreshProvider(backend: AgentBackend, remoteConnectionId?: string): Promise<import('./contracts/provider-setup').ProviderSetupStatus>;
  cancelCodexChatGptLogin(remoteConnectionId?: string, loginId?: string): Promise<CodexAuthentication>;
  startCodexChatGptDeviceCodeLogin(remoteConnectionId: string): Promise<CodexChatGptDeviceCodeLogin>;
  startCodexChatGptLogin(): Promise<CodexChatGptLogin>;
  logoutCodex(): Promise<CodexAuthentication>;
  getUpdateStatus(): Promise<DesktopUpdateStatus>;
  installUpdate(): Promise<void>;
  setDockBadgeCount(count: number): Promise<void>;
  setMenuBarVisible(visible: boolean): Promise<void>;
  getDaemonStatus(): Promise<DaemonStatus>;
  setDaemonEnabled(enabled: boolean): Promise<DaemonStatus>;
  getSystemPermissions(): Promise<SystemPermissionsStatus>;
  openAccessibilitySettings(): Promise<SystemPermissionsStatus>;
  openScreenRecordingSettings(): Promise<SystemPermissionsStatus>;
  launchChatGptApp(input?: LaunchChatGptAppInput): Promise<LaunchChatGptAppResult>;
  quit(): Promise<void>;
  restartApp(): Promise<void>;
  reloadRenderer(): Promise<void>;
  setAgentGoal(agentId: string, objective: string): Promise<AppSnapshot>;
  clearAgentGoal(agentId: string): Promise<AppSnapshot>;
  setAgentApprovalPreset(agentId: string, preset: ApprovalPreset): Promise<AppSnapshot>;
  setAgentPermissionMode(agentId: string, mode: string): Promise<AppSnapshot>;
  sendPrompt(agentId: string, prompt: string, options?: RendererSendPromptOptions): Promise<AppSnapshot>;
  steerPrompt(agentId: string, prompt: string, options?: RendererSendPromptOptions): Promise<AppSnapshot>;
  deleteQueuedPrompt(agentId: string, promptId: string): Promise<AppSnapshot>;
  steerQueuedPrompt(agentId: string, promptId: string, prompt?: string): Promise<AppSnapshot>;
  updateQueuedPrompt(agentId: string, promptId: string, prompt: string): Promise<AppSnapshot>;
  interruptAgent(agentId: string): Promise<AppSnapshot>;
  deleteTurn(agentId: string, turnId: string): Promise<AppSnapshot>;
  editTurn(agentId: string, turnId: string, content: string): Promise<AppSnapshot>;
  retryTurn(agentId: string, turnId: string): Promise<AppSnapshot>;
  continueInterruptedTurn(agentId: string): Promise<AppSnapshot>;
  mobileSimulator?(agentId: string, input: import('./mobile-simulator').MobileRequest): Promise<import('./mobile-simulator').MobileResult>;
  mobileSimulatorView?(agentId: string, input: import('./mobile-simulator').MobileViewRequest): Promise<import('./mobile-simulator').MobileViewResult>;
  browserOpen(agentId: string, browserId: string, url: string, guestWebContentsId: number): Promise<BrowserState>;
  browserOpenVisualization(agentId: string, browserId: string, path: string, title: string, guestWebContentsId: number): Promise<BrowserState>;
  browserNavigate(agentId: string, browserId: string, url: string): Promise<BrowserState>;
  browserGoBack(agentId: string, browserId: string): Promise<BrowserState>;
  browserGoForward(agentId: string, browserId: string): Promise<BrowserState>;
  browserReload(agentId: string, browserId: string): Promise<BrowserState>;
  browserGetZoom(agentId: string, browserId: string): Promise<number>;
  browserSetZoom(agentId: string, browserId: string, percent: number): Promise<number>;
  browserCopyScreenshot(agentId: string, browserId: string, rect?: BrowserBounds): Promise<void>;
  browserSetBounds(agentId: string, browserId: string, bounds: BrowserViewportBounds): Promise<void>;
  browserViewportApplied(agentId: string, browserId: string, requestId: string, error?: string): Promise<void>;
  browserSetVisible(agentId: string, browserId: string, visible: boolean): Promise<void>;
  browserSetAnnotationMode(agentId: string, browserId: string, enabled: boolean): Promise<void>;
  browserResolveAnnotation(token: string, comment: string | null): Promise<void>;
  browserClearAnnotations(agentId: string, browserId: string): Promise<void>;
  browserClose(agentId: string, browserId: string): Promise<void>;
  respondToClientRequest(response: ClientRequestResponse): Promise<AppSnapshot>;
  onEvent(listener: (event: MainToRendererEvent) => void): () => void;
  onAppCommand(listener: (command: AppCommand) => void): () => void;
  onUpdateStatusChanged(listener: (status: DesktopUpdateStatus) => void): () => void;
};
