import type { HarnessDriver } from 'multi-agents-sdk';
import type {
  Agent,
  AgentBackend,
  ApprovalPreset,
  AppSnapshot,
  BackendCapabilities,
  BackendConversationRef,
  BackendDefaults,
  BackendModelOption,
  BackendPluginSummary,
  BackendPromptOptions,
  BackendRuntimeStatus,
  BackendSession,
  BackendSkillSummary, ConversationSummary,
  ConversationListInput,
  ConversationResumeTarget,
  DevicePairingSession,
  DevicePairingStatus,
  PairedDevice,
  RendererMessage,
  PromptAttachment,
  SendPromptOptions,
  ThreadGoal
} from './contracts';
import type { BackendPublishedEvent } from './contracts/events';
import type { AgentRequestResponse } from './agent-request';

type BackendEventFrom<Event extends BackendPublishedEvent> = Event extends BackendPublishedEvent
  ? Omit<Event, 'seq' | 'occurredAt'> & Partial<Pick<Event, 'seq' | 'occurredAt'>>
  : never;

export type BackendEvent = BackendEventFrom<BackendPublishedEvent>;

export type BackendSendResult = {
  backendSession: BackendSession;
  turnId?: string;
  /** Public provider user-message ID, preserved by canonical history. */
  messageId?: string;
};

export type BackendTurnActionResult = {
  backendSession: BackendSession;
  activeTurnId: string | null;
};

export type BackendConversationResumeResult = {
  backendSession: BackendSession;
};

export type BackendConversationReplacementResult = {
  backendSession: BackendSession;
};

export type BackendConversationForkResult = BackendConversationResumeResult & {
  activeTurnId?: string;
};

export type BackendHistoryLoadResult = {
  hasOlder: boolean;
  frame?: Extract<BackendPublishedEvent, { type: 'claude.conversationEventReceived' }>;
};

export type BackendGoalResult = {
  backendSession: BackendSession;
  turnId?: string;
  goal?: ThreadGoal;
  cleared?: boolean;
};

export type BackendApprovalPresetResult = {
  backendSession: BackendSession;
  approvalPreset: ApprovalPreset;
};

export type BackendPermissionModeResult = {
  backendDefaults: BackendDefaults;
};

export type BackendJsonValue = null | boolean | number | string | BackendJsonValue[] | { [key: string]: BackendJsonValue };

export const utilityTaskComplexities = ['simple', 'normal', 'complex'] as const;
export type UtilityTaskComplexity = typeof utilityTaskComplexities[number];
export type UtilityMcpServer = { name: string; url: string; enabledTools: readonly ['fetch_tech_icon'] };
export type BackendTextGenerationInput = {
  /** Explicitly null lets inspection run until completion or cancellation. */
  timeoutMs?: null;
  /** Host-local cancellation; never serialized over RPC. */
  signal?: AbortSignal;
  prompt: string;
  cwd: string;
  /** Omitted keeps legacy utilities on the simple tier. */
  complexity?: UtilityTaskComplexity;
  /** Isolated inspection utilities may use read-only Git and source tools. */
  tools?: boolean;
  /** Private host-owned HTTP capabilities for this invocation only. */
  mcpServers?: readonly UtilityMcpServer[];
  developerInstructions?: string;
  outputSchema?: BackendJsonValue;
  /** Image paths resolved and authorized by the owning host; independent of workspace tools. */
  attachments?: readonly Extract<PromptAttachment, { type: 'image' }>[];
};

export type BackendTextGenerationResult = {
  text: string;
};

export type BackendImageGenerationInput = { prompt: string; cwd: string };
export type BackendImageGenerationResult = {
  images: { mimeType: string; data?: string; path?: string }[];
};

export type BackendCodeReviewInput = {
  prompt: string;
  cwd: string;
  reviewMcpServerUrl: string;
  reviewerSession?: BackendSession;
};

export type BackendCodeReviewResult = {
  /** Normal assistant response from the reviewer turn, used for finding discussion. */
  text: string;
  /** Provider-owned conversation continued by clarification and remediation in this round. */
  reviewerSession: BackendSession;
};

/** Provider-owned coordination policy; omitted fields preserve legacy host behavior. */
export type BackendCoordinationPolicy = {
  permissionModeScope?: 'provider' | 'conversation';
  rollbackStorageState?: 'active' | 'archived';
  authentication?: {
    actions?: readonly import('./contracts/provider-setup').ProviderAuthenticationAction['action'][];
    refreshOnAdmission?: boolean;
    enableOnSuccess?: boolean;
  };
};

export function resolveBackendCoordinationPolicy(policy?: BackendCoordinationPolicy) {
  return { permissionModeScope: policy?.permissionModeScope ?? 'provider', rollbackStorageState: policy?.rollbackStorageState ?? 'archived', authentication: {
    actions: policy?.authentication?.actions ?? ['check', 'cancel', 'logout'] as const,
    refreshOnAdmission: policy?.authentication?.refreshOnAdmission ?? false,
    enableOnSuccess: policy?.authentication?.enableOnSuccess ?? true,
  } };
}

export type AgentBackendDriver = Omit<HarnessDriver<Agent, BackendEvent, Extract<BackendPublishedEvent, { type: 'claude.conversationEventReceived' }>>, 'getCapabilities' | 'getRuntimeStatus' | 'generateText'> & {
  readonly backend: AgentBackend;
  readonly coordinationPolicy?: BackendCoordinationPolicy;
  onRequestUsage?(listener: (observation: import('./usage').RequestObservation) => void): () => void;
  onUsage?(listener: (observation: import('./usage').ExecutionObservation) => void): () => void;
  authenticate?(request: import('./contracts/provider-setup').ProviderAuthenticationAction): Promise<import('./contracts/provider-setup').ProviderAuthentication>;
  getRuntimeStatus(): BackendRuntimeStatus;
  getCapabilities(agent: Agent): BackendCapabilities;
  getBankedResets?(): Promise<import('./contracts/banked-resets').BankedResets>;
  useBankedReset?(input: import('./contracts/banked-resets').UseBankedResetInput): Promise<import('./contracts/banked-resets').BankedResetResult>;
  generateText?(agent: Agent, input: BackendTextGenerationInput): Promise<BackendTextGenerationResult>;
  generateImage?(agent: Agent, input: BackendImageGenerationInput, signal?: AbortSignal): Promise<BackendImageGenerationResult>;
  runCodeReview?(agent: Agent, input: BackendCodeReviewInput): Promise<BackendCodeReviewResult>;
  disposeCodeReview?(agent: Agent, reviewerSession: BackendSession): Promise<void>;
  tryHandlePromptCommand?(agent: Agent, prompt: string): Promise<BackendSendResult> | null;
  preparePromptOptions?(agent: Agent, options?: SendPromptOptions): SendPromptOptions | undefined;
  assertHandoffReady?(agent: Agent): Promise<void>;
  forkWorktreeConversation?(agent: Agent, targetAgent: Agent): Promise<BackendConversationForkResult | null>;
  continueInterruptedTurn?(agent: Agent, safetyReview?: import('./provider-safety-block').ProviderSafetyReviewTarget): Promise<BackendTurnActionResult>;
  getRemoteControlStatus?(): Promise<DevicePairingStatus>;
  enableRemoteControl?(): Promise<DevicePairingStatus>;
  disableRemoteControl?(): Promise<DevicePairingStatus>;
  startDevicePairing?(): Promise<DevicePairingSession>;
  checkDevicePairing?(session: DevicePairingSession): Promise<boolean>;
  listPairedDevices?(environmentId: string): Promise<PairedDevice[]>;
  revokePairedDevice?(environmentId: string, clientId: string): Promise<void>;
};

export function unsupportedBackendFeature(agent: Agent, feature: string): Error {
  return new Error(`${backendDisplayName(agent.backend)} does not support ${feature}.`);
}

export function backendDisplayName(backend: AgentBackend): string {
  return { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity', cursor: 'Cursor' }[backend];
}

export function backendRuntimeFromSnapshot(snapshot: AppSnapshot, backend: AgentBackend): BackendRuntimeStatus {
  return snapshot.backendRuntimes.find((runtime) => runtime.backend === backend) ?? {
    backend,
    status: 'notConfigured',
  };
}

export function codexPromptOptions(options: SendPromptOptions | undefined): Extract<BackendPromptOptions, { kind: 'codex' }> | undefined {
  return options?.backendOptions?.kind === 'codex' ? options.backendOptions : undefined;
}
