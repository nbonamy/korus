import type {
  AgentBackend,
  AppText,
  ApprovalPreset,
  ReasoningEffort,
} from './shared';

export type CodexApprovalPreset = ApprovalPreset;

export type CodexApprovalsReviewer = 'user' | 'auto_review' | 'guardian_subagent';

export type BackendSession =
  | { kind: 'antigravity'; sessionId: string }
  | {
    kind: 'codex';
    threadId: string;
  }
  | {
    kind: 'claude';
    sessionId: string;
    transport: 'stdio' | 'websocket';
    transcriptSessionId?: string;
    /** Native store location; execution still uses the agent's folder. */
    transcriptFolder?: string;
    serverUrl?: string;
    model?: string;
    reasoningEffort?: ReasoningEffort;
  };

export type BackendDefaults =
  | { kind: 'antigravity'; model?: string; userSelectedModel?: boolean; permissionMode?: string; reasoningEffort?: ReasoningEffort }
  | {
    kind: 'codex';
    model?: string;
    userSelectedModel?: boolean;
    approvalPreset?: CodexApprovalPreset;
    approvalPolicy?: string;
    approvalsReviewer?: CodexApprovalsReviewer;
    sandboxMode?: string;
    reasoningEffort?: string;
    serviceTier?: string | null;
  }
  | {
    kind: 'claude';
    model?: string;
    userSelectedModel?: boolean;
    reasoningEffort?: ReasoningEffort;
    serviceTier?: string | null;
    permissionMode?: string;
    thinking?: {
      type: 'enabled' | 'disabled';
      budgetTokens?: number;
    };
  };

export type AgentModelSelection = {
  model: string;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: string | null;
};

export type CodexThreadSettings = {
  cwd?: string;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string | null;
  approvalPolicy?: string;
  approvalsReviewer?: CodexApprovalsReviewer;
  sandboxPolicy?: { type: string };
  activePermissionProfile?: { id: string };
};

export type AccountRateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type AccountRateLimits = {
  limitId: string | null;
  limitName: string | null;
  primary: AccountRateLimitWindow | null;
  secondary: AccountRateLimitWindow | null;
  credits: unknown;
  individualLimit: unknown;
  planType: string | null;
  rateLimitReachedType: string | null;
};

export type BackendPlanModeSupport = 'native' | 'prompted' | 'unsupported';

export type BackendCapabilities = {
  codeReview?: boolean;
  planReview?: boolean;
  questions?: boolean;
  plugins?: boolean;
  conversationArchive?: boolean;
  conversationResume?: boolean;
  conversationReplaceWithSummary?: boolean;
  remoteControl?: boolean;
  attachments: boolean;
  models: boolean;
  skills: boolean;
  reasoningEffort: boolean;
  serviceTier?: boolean;
  thinkingBudget: boolean;
  planMode: BackendPlanModeSupport;
  goals: boolean;
  steerPrompt: boolean;
  interrupt: boolean;
  history: boolean;
  conversationFork?: boolean;
  deleteTurn: boolean;
  editTurn: boolean;
  retryTurn: boolean;
  approvals: boolean;
  approvalPresets?: ApprovalPreset[];
  permissionModes?: BackendPermissionModeOption[];
};

export type BackendPermissionModeOption = {
  id: string;
  label: AppText;
  description: AppText;
  dangerous?: boolean;
};

export type CodexAccount =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string | null; planType: string }
  | { type: 'amazonBedrock'; credentialSource: 'codexManaged' | 'awsManaged' };

export type CodexAuthentication = {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
  login: {
    status: 'idle' | 'starting' | 'pending' | 'completed' | 'cancelled' | 'error';
    error: string | null;
  };
};

export type CodexChatGptLogin = {
  loginId: string;
  authUrl: string;
};

export type CodexChatGptDeviceCodeLogin = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
};

export type BackendReasoningEffortOption = {
  reasoningEffort: ReasoningEffort;
  description: string;
};

export type BackendServiceTier = {
  id: string;
  name: string;
  description: string;
};

export type BackendModelOption = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: BackendReasoningEffortOption[];
  defaultReasoningEffort?: ReasoningEffort | null;
  serviceTiers?: BackendServiceTier[];
  defaultServiceTier?: string | null;
  isDefault?: boolean;
  capabilities?: Partial<BackendCapabilities>;
  providerMetadata?: Record<string, unknown>;
};

export type BackendSkillSummary = {
  id?: string;
  name: string;
  description?: string;
  shortDescription?: string;
  displayName?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
  defaultPrompt?: string;
  path: string;
  scope?: string;
  enabled: boolean;
  providerMetadata?: Record<string, unknown>;
};

export type BackendPluginSummary = {
  id: string;
  name: string;
  displayName: string;
  shortDescription?: string;
  longDescription?: string;
  brandColor?: string;
  iconUrl?: string;
  iconUrlDark?: string;
  enabled: boolean;
};

export type BackendCommandSummary = {
  id: string;
  backend: AgentBackend;
  name: string;
  displayName?: string;
  description?: string;
  slashName?: string;
  submitOnSelect?: boolean;
  composerMode?: {
    label?: string;
    placeholder?: string;
  };
  providerMetadata?: Record<string, unknown>;
};

export type BackendRuntimeStatus = {
  backend: AgentBackend;
  status: 'notConfigured' | 'starting' | 'running' | 'error';
  detail?: AppText;
  capabilities?: Partial<BackendCapabilities>;
};

export type BackendConnectionState = {
  status: 'connecting' | 'connected' | 'reconnecting' | 'error';
  detail?: AppText;
};
