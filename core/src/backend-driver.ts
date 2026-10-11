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
};

export type BackendGoalResult = {
  backendSession: BackendSession;
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

export type BackendTextGenerationInput = {
  prompt: string;
  cwd: string;
  developerInstructions?: string;
  outputSchema?: BackendJsonValue;
};

export type BackendTextGenerationResult = {
  text: string;
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

export type AgentBackendDriver = {
  readonly backend: AgentBackend;
  authenticate?(request: import('./contracts/provider-setup').ProviderAuthenticationAction): Promise<import('./contracts/provider-setup').ProviderAuthentication>;
  getRuntimeStatus(): BackendRuntimeStatus;
  getBankedResets?(): Promise<import('./contracts/banked-resets').BankedResets>;
  getAccountRateLimits?(): Promise<import('./contracts').AccountRateLimits | null>;
  getCapabilities(agent: Agent): BackendCapabilities;
  generateText?(agent: Agent, input: BackendTextGenerationInput): Promise<BackendTextGenerationResult>;
  runCodeReview?(agent: Agent, input: BackendCodeReviewInput): Promise<BackendCodeReviewResult>;
  disposeCodeReview?(agent: Agent, reviewerSession: BackendSession): Promise<void>;
  tryHandlePromptCommand?(agent: Agent, prompt: string): Promise<BackendSendResult> | null;
  preparePromptOptions?(agent: Agent, options?: SendPromptOptions): SendPromptOptions | undefined;
  sendPrompt(agent: Agent, prompt: string, options?: SendPromptOptions): Promise<BackendSendResult>;
  setConversationTitle?(agent: Agent, title: string): Promise<void>;
  setGoal?(agent: Agent, objective: string): Promise<BackendGoalResult>;
  clearGoal?(agent: Agent): Promise<BackendGoalResult>;
  setApprovalPreset?(agent: Agent, preset: ApprovalPreset): Promise<BackendApprovalPresetResult>;
  setPermissionMode?(agent: Agent, mode: string): Promise<BackendPermissionModeResult>;
  releaseConversation?(agentId: string): void | Promise<void>;
  assertHandoffReady?(agent: Agent): Promise<void>;
  archiveAgentConversation?(agent: Agent): Promise<void>;
  /** Removes the provider-side conversation for good; callers fall back to archiving when absent. */
  deleteAgentConversation?(agent: Agent): Promise<void>;
  reconcileConversations?(agents: Agent[]): Promise<void>;
  interrupt(agent: Agent, expectedTurnId?: string): Promise<BackendSendResult>;
  respondToAgentRequest(response: AgentRequestResponse): Promise<void>;
  loadConversation?(agent: Agent): Promise<BackendSession | null>;
  loadOlderHistory?(agent: Agent): Promise<BackendHistoryLoadResult>;
  listConversations?(agent: Agent, input?: ConversationListInput): Promise<ConversationSummary[]>;
  resumeConversation?(agent: Agent, target: ConversationResumeTarget): Promise<BackendConversationResumeResult>;
  replaceConversationWithSummary?(agent: Agent): Promise<BackendConversationReplacementResult>;
  forkConversation?(agent: Agent, targetAgent: Agent, turnId?: string): Promise<BackendConversationForkResult>;
  readConversationMessages?(ref: BackendConversationRef, agentId: string): Promise<RendererMessage[]>;
  readConversationSummary?(agent: Agent, ref: BackendConversationRef): Promise<ConversationSummary | null>;
  steerPrompt?(agent: Agent, prompt: string, options?: SendPromptOptions): Promise<BackendSendResult>;
  deleteTurn?(agent: Agent, turnId: string): Promise<BackendTurnActionResult>;
  editTurn?(agent: Agent, turnId: string, content: string): Promise<BackendTurnActionResult>;
  retryTurn?(agent: Agent, turnId: string): Promise<BackendTurnActionResult>;
  continueInterruptedTurn?(agent: Agent): Promise<BackendTurnActionResult>;
  listModels?(agent: Agent): Promise<BackendModelOption[]>;
  listPlugins?(agent: Agent): Promise<BackendPluginSummary[]>;
  listSkills?(agent: Agent): Promise<BackendSkillSummary[]>;
  getRemoteControlStatus?(): Promise<DevicePairingStatus>;
  enableRemoteControl?(): Promise<DevicePairingStatus>;
  disableRemoteControl?(): Promise<DevicePairingStatus>;
  startDevicePairing?(): Promise<DevicePairingSession>;
  checkDevicePairing?(session: DevicePairingSession): Promise<boolean>;
  listPairedDevices?(environmentId: string): Promise<PairedDevice[]>;
  revokePairedDevice?(environmentId: string, clientId: string): Promise<void>;
  onEvent(listener: (event: BackendEvent) => void): () => void;
  close(): Promise<void>;
};

export function unsupportedBackendFeature(agent: Agent, feature: string): Error {
  return new Error(`${backendDisplayName(agent.backend)} does not support ${feature}.`);
}

export function backendDisplayName(backend: AgentBackend): string {
  return { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity' }[backend];
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
