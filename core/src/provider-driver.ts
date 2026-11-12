import type * as Sdk from '@korus-dev/multi-agent-sdk';
import type {
  Agent,
  HarnessProvider,
  ApprovalPreset,
  AppSnapshot,
  ProviderCapabilities,
  ProviderConversationRef,
  ProviderDefaults,
  ProviderModelOption,
  ProviderPluginSummary,
  ProviderPromptOptions,
  ProviderRuntimeStatus,
  ProviderSessionData,
  ProviderSkillSummary, ConversationSummary,
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

export type ProviderSendResult = {
  providerSession: ProviderSessionData;
  turnId?: string;
  /** Public provider user-message ID, preserved by canonical history. */
  messageId?: string;
};

export type ProviderTurnActionResult = {
  providerSession: ProviderSessionData;
  activeTurnId: string | null;
};

export type ProviderConversationResumeResult = {
  providerSession: ProviderSessionData;
};

export type ProviderConversationReplacementResult = {
  providerSession: ProviderSessionData;
};

export type ProviderConversationForkResult = ProviderConversationResumeResult & {
  activeTurnId?: string;
};

export type ProviderHistoryLoadResult = {
  hasOlder: boolean;
};

export type ProviderGoalResult = {
  providerSession: ProviderSessionData;
  turnId?: string;
  goal?: ThreadGoal;
  cleared?: boolean;
};

export type ProviderApprovalPresetResult = {
  providerSession: ProviderSessionData;
  approvalPreset: ApprovalPreset;
};

export type ProviderPermissionModeResult = {
  providerDefaults: ProviderDefaults;
};

export type ProviderJsonValue = null | boolean | number | string | ProviderJsonValue[] | { [key: string]: ProviderJsonValue };

export const utilityTaskComplexities = ['simple', 'normal', 'complex'] as const;
export type UtilityTaskComplexity = typeof utilityTaskComplexities[number];
export type UtilityMcpServer = { name: string; url: string; enabledTools: readonly ['fetch_tech_icon'] };
export type ProviderTextGenerationInput = {
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
  outputSchema?: ProviderJsonValue;
  /** Image paths resolved and authorized by the owning host; independent of workspace tools. */
  attachments?: readonly Extract<PromptAttachment, { type: 'image' }>[];
};

export type ProviderTextGenerationResult = {
  text: string;
};

export type ProviderImageGenerationInput = { prompt: string; cwd: string };
export type ProviderImageGenerationResult = {
  images: { mimeType: string; data?: string; path?: string }[];
};

export type ProviderCodeReviewInput = {
  prompt: string;
  cwd: string;
  reviewMcpServerUrl: string;
  reviewerSession?: ProviderSessionData;
};

export type ProviderCodeReviewResult = {
  /** Normal assistant response from the reviewer turn, used for finding discussion. */
  text: string;
  /** Provider-owned conversation continued by clarification and remediation in this round. */
  reviewerSession: ProviderSessionData;
};

/** Provider-owned coordination policy; omitted fields preserve legacy host behavior. */
/** The operations a provider driver offers the daemon; the daemon's own contract, implemented over the SDK's Harness. */
type HarnessDriver<Context, Event, HistoryFrame = unknown> = {
  readonly provider: string;
  authenticate?(request: Sdk.ProviderAuthenticationAction): Promise<Sdk.ProviderAuthentication>;
  getRuntimeStatus(): ProviderRuntimeStatus;
  getBankedResets?(): Promise<Sdk.BankedResets>;
  useBankedReset?(input: Sdk.UseBankedResetInput): Promise<Sdk.BankedResetResult>;
  getAccountRateLimits?(): Promise<Sdk.AccountRateLimits | null>;
  setConversationStorage?(ref: ProviderConversationRef, state: Sdk.ConversationStorageState): Promise<void>;
  startRealtime?(agent: Context, options: Sdk.RealtimeOptions): Promise<Sdk.RealtimeSession>;
  getRemoteControlStatus?(): Promise<DevicePairingStatus>;
  enableRemoteControl?(): Promise<DevicePairingStatus>;
  disableRemoteControl?(): Promise<DevicePairingStatus>;
  startDevicePairing?(): Promise<DevicePairingSession>;
  checkDevicePairing?(session: DevicePairingSession): Promise<boolean>;
  listPairedDevices?(environmentId: string): Promise<PairedDevice[]>;
  revokePairedDevice?(environmentId: string, clientId: string): Promise<void>;
  getCapabilities(agent?: Context): ProviderCapabilities;
  sendPrompt(agent: Context, prompt: string, options?: SendPromptOptions): Promise<ProviderSendResult>;
  executeScopedPrompt?(agent: Context, input: { prompt: string; cwd: string; session?: ProviderSessionData; scope: Sdk.HarnessPromptScope; options?: SendPromptOptions; signal?: AbortSignal; /** Keeps the run out of the conversation's published events (for example a summary the user did not ask to see). */ silent?: boolean }): Promise<{ text: string; session: ProviderSessionData }>;
  cancelScopedPrompt?(agent: Context): Promise<void>;
  disposeScopedSession?(agent: Context, session: ProviderSessionData): Promise<void>;
  generateImage?(agent: Context, input: Sdk.HarnessImageGenerationInput, signal?: AbortSignal): Promise<Sdk.HarnessImageGenerationResult>;
  generateText?(agent: Context, input: Sdk.HarnessTextGenerationInput): Promise<Sdk.HarnessTextGenerationResult>;
  setConversationTitle?(agent: Context, title: string): Promise<void>;
  setGoal?(agent: Context, objective: string): Promise<{ providerSession: ProviderSessionData; turnId?: string; goal?: Sdk.ThreadGoal; cleared?: boolean }>;
  clearGoal?(agent: Context): Promise<{ providerSession: ProviderSessionData; turnId?: string; goal?: Sdk.ThreadGoal; cleared?: boolean }>;
  setApprovalPreset?(agent: Context, preset: ApprovalPreset): Promise<{ providerSession: ProviderSessionData; approvalPreset: ApprovalPreset }>;
  setPermissionMode?(agent: Context, mode: string): Promise<{ providerDefaults: ProviderDefaults }>;
  releaseConversation?(agentId: string): void | Promise<void>;
  archiveAgentConversation?(agent: Context): Promise<void>;
  deleteAgentConversation?(agent: Context): Promise<void>;
  reconcileConversations?(agents: Context[]): Promise<void>;
  interrupt(agent: Context, expectedTurnId?: string): Promise<ProviderSendResult>;
  respondToAgentRequest(response: Sdk.AgentRequestResponse): Promise<void>;
  loadConversation?(agent: Context): Promise<ProviderSessionData | null>;
  loadOlderHistory?(agent: Context): Promise<{ hasOlder: boolean; frame?: HistoryFrame }>;
  loadTurnHistory?(agent: Context, turnId: string): Promise<void>;
  readConversationContent?(agent: Context, input: Sdk.ConversationContentInput): Promise<Sdk.ConversationContentChunk>;
  listConversations?(agent: Context, input?: Sdk.ConversationListInput): Promise<Sdk.ProviderConversationSummary[]>;
  resumeConversation?(agent: Context, target: Sdk.ConversationResumeTarget): Promise<ProviderConversationResumeResult>;
  forkConversation?(agent: Context, targetAgent: Context, turnId?: string): Promise<ProviderConversationForkResult>;
  readConversationMessages?(ref: ProviderConversationRef, agentId: string): Promise<Sdk.Message[]>;
  readConversationSummary?(agent: Context, ref: ProviderConversationRef): Promise<Sdk.ProviderConversationSummary | null>;
  steerPrompt?(agent: Context, prompt: string, options?: SendPromptOptions): Promise<ProviderSendResult>;
  continueInterruptedTurn?(agent: Context, safetyReview?: Sdk.ProviderSafetyReviewTarget): Promise<ProviderTurnActionResult>;
  deleteTurn?(agent: Context, turnId: string): Promise<ProviderTurnActionResult>;
  editTurn?(agent: Context, turnId: string, content: string, options?: Pick<SendPromptOptions, 'content'>): Promise<ProviderTurnActionResult>;
  retryTurn?(agent: Context, turnId: string): Promise<ProviderTurnActionResult>;
  listModels?(agent: Context): Promise<ProviderModelOption[]>;
  listPlugins?(agent: Context): Promise<ProviderPluginSummary[]>;
  listSkills?(agent: Context, forceReload?: boolean): Promise<ProviderSkillSummary[]>;
  onEvent(listener: (event: Event) => void): () => void;
  onUsage?(listener: (event: Sdk.ExecutionObservation) => void): () => void;
  onRequestUsage?(listener: (event: Sdk.RequestObservation) => void): () => void;
  close(): Promise<void>;
};

export type ProviderCoordinationPolicy = {
  authentication?: {
    actions?: readonly import('./contracts/provider-setup').ProviderAuthenticationAction['action'][];
  };
};

export function resolveProviderCoordinationPolicy(policy?: ProviderCoordinationPolicy) {
  return { authentication: {
    actions: policy?.authentication?.actions ?? ['check', 'cancel', 'logout'] as const,
  } };
}

export type AgentProviderDriver = Omit<HarnessDriver<Agent, BackendEvent>, 'getCapabilities' | 'getRuntimeStatus' | 'generateText'> & {
  readonly provider: HarnessProvider;
  readonly coordinationPolicy?: ProviderCoordinationPolicy;
  /** The agent's record changed; an operation in flight for it sees the new conversation, folder, name and defaults. */
  agentChanged?(agent: Agent): void;
  onRequestUsage?(listener: (observation: import('./usage').RequestObservation) => void): () => void;
  onUsage?(listener: (observation: import('./usage').ExecutionObservation) => void): () => void;
  authenticate?(request: import('./contracts/provider-setup').ProviderAuthenticationAction): Promise<import('./contracts/provider-setup').ProviderAuthentication>;
  getRuntimeStatus(): ProviderRuntimeStatus;
  getCapabilities(agent: Agent): ProviderCapabilities;
  getBankedResets?(): Promise<import('./contracts/banked-resets').BankedResets>;
  useBankedReset?(input: import('./contracts/banked-resets').UseBankedResetInput): Promise<import('./contracts/banked-resets').BankedResetResult>;
  generateText?(agent: Agent, input: ProviderTextGenerationInput): Promise<ProviderTextGenerationResult>;
  generateImage?(agent: Agent, input: ProviderImageGenerationInput, signal?: AbortSignal): Promise<ProviderImageGenerationResult>;
  runCodeReview?(agent: Agent, input: ProviderCodeReviewInput): Promise<ProviderCodeReviewResult>;
  disposeCodeReview?(agent: Agent, reviewerSession: ProviderSessionData): Promise<void>;
  tryHandlePromptCommand?(agent: Agent, prompt: string): Promise<ProviderSendResult> | null;
  preparePromptOptions?(agent: Agent, options?: SendPromptOptions): SendPromptOptions | undefined;
  assertHandoffReady?(agent: Agent): Promise<void>;
  forkWorktreeConversation?(agent: Agent, targetAgent: Agent): Promise<ProviderConversationForkResult | null>;
  continueInterruptedTurn?(agent: Agent, safetyReview?: import('./provider-safety-block').ProviderSafetyReviewTarget): Promise<ProviderTurnActionResult>;
  getRemoteControlStatus?(): Promise<DevicePairingStatus>;
  enableRemoteControl?(): Promise<DevicePairingStatus>;
  disableRemoteControl?(): Promise<DevicePairingStatus>;
  startDevicePairing?(): Promise<DevicePairingSession>;
  checkDevicePairing?(session: DevicePairingSession): Promise<boolean>;
  listPairedDevices?(environmentId: string): Promise<PairedDevice[]>;
  revokePairedDevice?(environmentId: string, clientId: string): Promise<void>;
};

export function unsupportedProviderFeature(agent: Agent, feature: string): Error {
  return new Error(`${providerDisplayName(agent.provider)} does not support ${feature}.`);
}

export function providerDisplayName(provider: HarnessProvider): string {
  return { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity', cursor: 'Cursor' }[provider];
}

export function providerRuntimeFromSnapshot(snapshot: AppSnapshot, provider: HarnessProvider): ProviderRuntimeStatus {
  return snapshot.providerRuntimes.find((runtime) => runtime.provider === provider) ?? {
    provider: provider,
    status: 'notConfigured',
  };
}
