import type {
  AccountRateLimits, Agent, HarnessProvider, AgentContextUsage, AgentCreationProgress,
  AgentFileActivity, AgentGitOperationProgress, AgentGitStatus, AgentStatus, AppSnapshot, ProviderConnectionState,
  ProviderModelOption, ProviderRuntimeStatus, ProviderSkillSummary, BrowserAnnotation,
  CelebrationKind, ClaudeConversationEvent, ClaudeConversationSnapshot, DevicePairingStatus,
  SendPromptOptions, SidePanelMarkdownRequest, SubagentActivityChange, SubagentIdentityChange,
  SubagentOperationChange, SubagentStatusChange, ThreadGoal, TurnGitDiff,
  WorkBacklogAssignment, WorkBacklogAssignmentPolicy, WorkBacklogAssignmentStatus
} from '../contracts';
import type { CodexConversationSnapshot } from '@korus-dev/multi-agent-sdk';
import type { CodexWireConversationEvent as CodexConversationEvent } from '../codex-event-wire';
import type { MissionImplementationStartProgress } from '../mission-execution';
import type { CursorConversationEvent, CursorConversationSnapshot } from './cursor-conversation';
import type { AntigravityConversationEvent, AntigravityConversationSnapshot } from './antigravity-conversation';

type EventEnvelope = {
  seq: number;
  source?: 'provider' | 'client';
  agentId?: string;
  provider?: HarnessProvider;
  providerSessionId?: string;
  /** Opaque provider conversation identity for app-owned projections. */
  conversationId?: string;
  snapshot?: AppSnapshot;
  threadId?: string;
  turnId?: string;
  occurredAt: string;
};

type EventWith<Variant> = EventEnvelope & Variant;
export type ConversationSettings = {
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string | null;
  approvalPreset?: import('../contracts').ApprovalPreset;
  permissionMode?: string;
};
type WorkBacklogAssignmentUpdatedPayload = Omit<WorkBacklogAssignment, 'policy' | 'status'> & {
  policy?: WorkBacklogAssignmentPolicy;
  status: WorkBacklogAssignmentStatus | 'working';
};
type AgentUpdatedPayload = Omit<Partial<Agent>, 'threadFlags' | 'id' | 'statusText' | 'suggestedPrompt' | 'rateLimitPause'> & {
  id: string;
  threadFlags?: import('../thread-flags').ThreadFlags | null;
  statusText?: string | null;
  suggestedPrompt?: string | null;
  rateLimitPause?: import('../auto-resume').RateLimitPause | null;
};
type ThreadMode = 'default' | 'plan';
type TurnEventContext = {
  agentId: string;
  provider: HarnessProvider;
  turnId: string;
};
type ThreadTurnEventContext = TurnEventContext;
type AgentPromptQueuedPayload = {
  id: string;
  text: string;
  options?: SendPromptOptions;
  submitted?: boolean;
};
type AgentPromptRetryScheduledPayload = {
  id: string;
  attempts: number;
  lastError: string;
  retryAt?: string;
};
type AppEvent =
  | EventWith<{ type: 'cursor.conversationSnapshotChanged'; agentId: string; provider: 'cursor'; payload: { revision: number; snapshot: CursorConversationSnapshot } }>
  | EventWith<{ type: 'cursor.conversationEventReceived'; agentId: string; provider: 'cursor'; payload: { revision: number; event: CursorConversationEvent } }>
  | EventWith<{ type: 'conversation.shareChanged'; agentId: string; payload: import('../conversation-sharing').ConversationShareState }>
  | EventWith<{ type: 'antigravity.conversationSnapshotChanged'; agentId: string; provider: 'antigravity'; payload: { revision: number; snapshot: AntigravityConversationSnapshot } }>
  | EventWith<{ type: 'antigravity.conversationEventReceived'; agentId: string; provider: 'antigravity'; payload: { revision: number; event: AntigravityConversationEvent } }>
  | EventWith<{
      type: 'provider.authenticationChanged';
      payload: import('./provider-setup').ProviderAuthentication;
    }>
  | EventWith<{
      type: 'provider.statusChanged';
      provider: HarnessProvider;
      payload: ProviderRuntimeStatus;
    }>
  | EventWith<{
      type: 'client.connectionChanged';
      payload: ProviderConnectionState;
    }>
  | EventWith<{
      type: 'snapshot.updated';
      payload: AppSnapshot;
    }>
  | EventWith<{
      type: 'account.rateLimitsUpdated';
      provider: HarnessProvider;
      payload: { rateLimits: AccountRateLimits };
    }>
  | EventWith<{
      type: 'remoteControl.statusChanged';
      payload: DevicePairingStatus;
    }>
  | EventWith<{
      type: 'models.changed';
      provider: HarnessProvider;
      payload: { models: ProviderModelOption[] };
    }>
  | EventWith<{
      type: 'skills.changed';
      provider: HarnessProvider;
      payload: {
        cwd: string | null;
        status: 'loaded';
        skills: ProviderSkillSummary[];
      };
    }>
  | EventWith<{
      type: 'codex.conversationSnapshotChanged';
      agentId: string;
      provider: 'codex';
      threadId: string;
      payload: {
        revision: number;
        snapshot: CodexConversationSnapshot;
      };
    }>
  | EventWith<{
      type: 'codex.conversationEventReceived';
      agentId: string;
      provider: 'codex';
      threadId: string;
      payload: {
        revision: number;
        event: CodexConversationEvent;
      };
    }>
  | EventWith<{
      type: 'claude.conversationSnapshotChanged';
      agentId: string;
      provider: 'claude';
      payload: {
        revision: number;
        snapshot: ClaudeConversationSnapshot;
      };
    }>
  | EventWith<{
      type: 'claude.conversationEventReceived';
      agentId: string;
      provider: 'claude';
      payload: {
        revision: number;
        event: ClaudeConversationEvent;
      };
    }>
  | EventWith<{
      type: 'client.markdownDisplayRequested';
      agentId: string;
      payload: SidePanelMarkdownRequest;
    }>
  | EventWith<{
      type: 'plan.readyForReview';
      agentId: string;
      turnId: string;
      payload: { markdown: string; itemId?: string; requestId?: string };
    }>
  | EventWith<{
      type: 'plan.reviewResolved';
      agentId: string;
      payload: { reviewId: string; resolution: import('../plan-review').PlanReviewResolution };
    }>
  | EventWith<{
      type: 'client.celebrationRequested';
      agentId: string;
      payload: { kind: CelebrationKind };
    }>
  | EventWith<{
      type: 'agentCreation.progress';
      agentId: string;
      payload: AgentCreationProgress;
    }>
  | EventWith<{
      type: 'mission.focusRequested';
      payload: { missionId: string };
    }>
  | EventWith<{
      type: 'mission.implementationStartProgress';
      payload: MissionImplementationStartProgress;
    }>
  | EventWith<{
      type: 'git.branchWorkProgress';
      agentId: string;
      payload: import('../branch-current-work').BranchWorkProgress;
    }>
  | EventWith<{
      type: 'git.operationProgress';
      agentId: string;
      payload: AgentGitOperationProgress;
    }>
  | EventWith<{
      type: 'browser.annotationCreated';
      payload: BrowserAnnotation;
    }>
  | EventWith<{
      type: 'workItem.assignmentUpdated';
      payload: WorkBacklogAssignmentUpdatedPayload;
    }>
  | EventWith<{
      type: 'agent.updated';
      agentId: string;
      payload: AgentUpdatedPayload;
    }>
  | EventWith<{
      type: 'agent.statusChanged';
      agentId: string;
      payload: AgentStatus;
    }>
  | EventWith<{
      type: 'agent.conversationAttached';
      agentId: string;
      provider: HarnessProvider;
      conversationId: string;
      payload: { cwd?: string };
    }>
  | EventWith<{
      type: 'conversation.settingsUpdated';
      agentId: string;
      provider: HarnessProvider;
      payload: { settings: ConversationSettings };
    }>
  | EventWith<{
      type: 'conversation.modeUpdated';
      agentId: string;
      provider: HarnessProvider;
      payload: { mode: ThreadMode; permissionMode?: string };
    }>
  | EventWith<{
      type: 'conversation.goalUpdated';
      agentId: string;
      payload: { goal: ThreadGoal };
    }>
  | EventWith<{
      type: 'conversation.goalCleared';
      agentId: string;
      payload: Record<string, never>;
    }>
  | EventWith<{
      type: 'conversation.contextUsageUpdated';
      agentId: string;
      provider: HarnessProvider;
      payload: { contextUsage: AgentContextUsage };
    }>
  | EventWith<{
      type: 'conversation.historyLoadFailed';
      agentId: string;
      payload: { error: string };
    }>
  | EventWith<{
      type: 'subagent.operationChanged';
      agentId: string;
      provider: HarnessProvider;
      payload: SubagentOperationChange;
    }>
  | EventWith<{
      type: 'subagent.activityChanged';
      agentId: string;
      provider: HarnessProvider;
      payload: SubagentActivityChange;
    }>
  | EventWith<{
      type: 'subagent.identityChanged';
      agentId: string;
      provider: HarnessProvider;
      payload: SubagentIdentityChange;
    }>
  | EventWith<{
      type: 'subagent.statusChanged';
      agentId: string;
      provider: HarnessProvider;
      payload: SubagentStatusChange;
    }>
  | EventWith<{
      type: 'agent.promptQueued';
      agentId: string;
      payload: AgentPromptQueuedPayload;
    }>
  | EventWith<{
      type: 'agent.promptRetryScheduled';
      agentId: string;
      payload: AgentPromptRetryScheduledPayload;
    }>
  | EventWith<{
      type: 'agent.promptDequeued';
      agentId: string;
      payload: { ids: string[] };
    }>
  | EventWith<ThreadTurnEventContext & {
      type: 'conversation.turnDiffUpdated';
      payload: Omit<TurnGitDiff, 'agentId' | 'turnId' | 'updatedAt'>;
    }>
  | EventWith<ThreadTurnEventContext & {
      type: 'workspace.fileActivityDetected';
      payload: Omit<AgentFileActivity, 'agentId' | 'turnId' | 'occurredAt'>;
    }>
  | EventWith<{
      type: 'git.statusUpdated';
      agentId: string;
      payload: AgentGitStatus;
    }>
  | EventWith<{
      type: 'agentRequest.created';
      agentId: string;
      provider: HarnessProvider;
      turnId?: string;
      payload: { request: import('../agent-request').AgentRequest };
    }>
  | EventWith<{
      type: 'agentRequest.resolved';
      agentId: string;
      provider: HarnessProvider;
      turnId?: string;
      payload: {
        id: string;
        outcome: import('../agent-request').AgentRequestOutcome;
      };
    }>;

export type ClientTransportEvent = Extract<AppEvent, { type: "client.connectionChanged" }>;
export type ClientEffectEvent = Extract<AppEvent, { type: "client.markdownDisplayRequested" | "client.celebrationRequested" | "browser.annotationCreated" }>;
export type ProviderConversationFrame = Extract<AppEvent, { type: "cursor.conversationSnapshotChanged" | "cursor.conversationEventReceived" | "codex.conversationSnapshotChanged" | "codex.conversationEventReceived" | "claude.conversationSnapshotChanged" | "claude.conversationEventReceived" | "antigravity.conversationSnapshotChanged" | "antigravity.conversationEventReceived" }>;
export type BackendDomainEvent = Exclude<AppEvent, ClientTransportEvent | ClientEffectEvent | ProviderConversationFrame>;
export type BackendPublishedEvent = BackendDomainEvent | ClientEffectEvent | ProviderConversationFrame;
export type MainToRendererEvent = BackendPublishedEvent | ClientTransportEvent;
