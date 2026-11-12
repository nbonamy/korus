import { describe, expectTypeOf, it } from 'vitest';
import type {
  AccountRateLimits,
  Agent,
  HarnessProvider,
  AgentContextUsage,
  AgentCreationProgress,
  AgentFileActivity,
  AgentGitStatus,
  AgentGitOperationProgress,
  AgentStatus,
  AppCommand,
  AppSnapshot, ProviderConnectionState,
  ProviderModelOption,
  ProviderRuntimeStatus,
  ProviderSkillSummary,
  BrowserAnnotation,
  CelebrationKind, DesktopUpdateStatus,
  DevicePairingStatus,
  LaunchChatGptAppInput,
  LaunchChatGptAppResult,
  MainToRendererEvent,
  OpenInApplication, RendererSendPromptOptions,
  SendPromptOptions,
  SidePanelMarkdownRequest,
  SubagentActivityChange,
  SubagentIdentityChange,
  SubagentOperationChange,
  SubagentStatusChange,
  ThreadGoal, TurnGitDiff,
  WorkBacklogAssignment,
  WorkBacklogAssignmentPolicy,
  WorkBacklogAssignmentStatus
} from '../contracts';
import { ipcChannels, type AppIpcEvents, type AppIpcRequests } from '../ipc';

describe('ipc channels', () => {
  it('derives request and event payloads from the preload API contract', () => {
    type AgentScopedEventContext = {
      agentId: string;
      provider?: HarnessProvider;
      turnId?: string;
      source?: 'provider' | 'client';
    };
    type OptionalEventContext = {
      agentId?: string;
      provider?: HarnessProvider;
      snapshot?: AppSnapshot;
      turnId?: string;
      source?: 'provider' | 'client';
    };
    type ClientRequestResolvedEventContext = {
      agentId: string;
      provider: HarnessProvider;
      snapshot?: AppSnapshot;
      turnId?: string;
      source?: 'provider' | 'client';
    };
    type AgentOnlyEventContext = {
      agentId: string;
      provider?: HarnessProvider;
      snapshot?: AppSnapshot;
      turnId?: string;
      source?: 'provider' | 'client';
    };
    type CodexThreadEventContext = {
      agentId: string;
      provider: 'codex';
      snapshot?: AppSnapshot;
      turnId?: string;
      source?: 'provider' | 'client';
    };
    type AgentThreadEventContext = {
      agentId: string;
      provider?: HarnessProvider;
      snapshot?: AppSnapshot;
      turnId?: string;
      source?: 'provider' | 'client';
    };
    type ProviderThreadEventContext = {
      agentId: string;
      provider: HarnessProvider;
      snapshot?: AppSnapshot;
      turnId?: string;
      source?: 'provider' | 'client';
    };
    type ClaudeSessionEventContext = {
      agentId: string;
      provider: 'claude';
      providerSessionId: string;
      snapshot?: AppSnapshot;
      turnId?: string;
      source?: 'provider' | 'client';
    };
    type ClaudeModeEventContext = {
      agentId: string;
      provider: 'claude';
      snapshot?: AppSnapshot;
      turnId: string;
      source?: 'provider' | 'client';
    };
    type TurnEventContext = {
      agentId: string;
      provider: HarnessProvider;
      snapshot?: AppSnapshot;
      turnId: string;
      source?: 'provider' | 'client';
    };
    type ThreadTurnEventContext = {
      agentId: string;
      provider: HarnessProvider;
      snapshot?: AppSnapshot;
      turnId: string;
      source?: 'provider' | 'client';
    };

    expectTypeOf<AppIpcRequests[typeof ipcChannels.sendPrompt]['args']>()
      .toEqualTypeOf<[agentId: string, prompt: string, options?: RendererSendPromptOptions]>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.sendPrompt]['result']>()
      .toEqualTypeOf<AppSnapshot>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.compressAgentSession]['args']>()
      .toEqualTypeOf<[agentId: string]>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.compressAgentSession]['result']>()
      .toEqualTypeOf<AppSnapshot>();
    expectTypeOf<AppIpcEvents[typeof ipcChannels.event]>()
      .toEqualTypeOf<MainToRendererEvent>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'client.connectionChanged' }>['payload']>()
      .toEqualTypeOf<ProviderConnectionState>();
    type SnapshotUpdatedEvent = Extract<MainToRendererEvent, { type: 'snapshot.updated' }>;
    expectTypeOf<SnapshotUpdatedEvent['payload']>().toEqualTypeOf<AppSnapshot>();
    expectTypeOf<Pick<
      SnapshotUpdatedEvent,
      keyof OptionalEventContext
    >>().toEqualTypeOf<OptionalEventContext>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'provider.statusChanged' }>['payload']>()
      .toEqualTypeOf<ProviderRuntimeStatus>();
    expectTypeOf<Pick<Extract<MainToRendererEvent, { type: 'provider.statusChanged' }>, 'provider'>>()
      .toEqualTypeOf<{ provider: HarnessProvider }>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'account.rateLimitsUpdated' }>['payload']>()
      .toEqualTypeOf<{ rateLimits: AccountRateLimits }>();
    expectTypeOf<Pick<Extract<MainToRendererEvent, { type: 'account.rateLimitsUpdated' }>, 'provider'>>()
      .toEqualTypeOf<{ provider: HarnessProvider }>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'models.changed' }>['payload']>()
      .toEqualTypeOf<{ models: ProviderModelOption[] }>();
    expectTypeOf<Pick<Extract<MainToRendererEvent, { type: 'models.changed' }>, 'provider'>>()
      .toEqualTypeOf<{ provider: HarnessProvider }>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'skills.changed' }>['payload']>()
      .toEqualTypeOf<{
        cwd: string | null;
        status: 'loaded';
        skills: ProviderSkillSummary[];
      }>();
    expectTypeOf<Pick<Extract<MainToRendererEvent, { type: 'skills.changed' }>, 'provider'>>()
      .toEqualTypeOf<{ provider: HarnessProvider }>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'remoteControl.statusChanged' }>['payload']>()
      .toEqualTypeOf<DevicePairingStatus>();
    expectTypeOf<Pick<Extract<MainToRendererEvent, { type: 'remoteControl.statusChanged' }>, 'provider'>>()
      .toEqualTypeOf<{ provider?: HarnessProvider }>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'client.markdownDisplayRequested' }>['payload']>()
      .toEqualTypeOf<SidePanelMarkdownRequest>();
    expectTypeOf<Pick<
      Extract<MainToRendererEvent, { type: 'client.markdownDisplayRequested' }>,
      keyof AgentScopedEventContext
    >>().toEqualTypeOf<AgentScopedEventContext>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'plan.readyForReview' }>['payload']>()
      .toEqualTypeOf<{ markdown: string; itemId?: string; requestId?: string }>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'client.celebrationRequested' }>['payload']>()
      .toEqualTypeOf<{ kind: CelebrationKind }>();
    expectTypeOf<Pick<
      Extract<MainToRendererEvent, { type: 'client.celebrationRequested' }>,
      keyof AgentScopedEventContext
    >>().toEqualTypeOf<AgentScopedEventContext>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'agentCreation.progress' }>['payload']>()
      .toEqualTypeOf<AgentCreationProgress>();
    expectTypeOf<Pick<
      Extract<MainToRendererEvent, { type: 'agentCreation.progress' }>,
      keyof AgentScopedEventContext
    >>().toEqualTypeOf<AgentScopedEventContext>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'git.operationProgress' }>['payload']>()
      .toEqualTypeOf<AgentGitOperationProgress>();
    expectTypeOf<Pick<
      Extract<MainToRendererEvent, { type: 'git.operationProgress' }>,
      keyof AgentScopedEventContext
    >>().toEqualTypeOf<AgentScopedEventContext>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'browser.annotationCreated' }>['payload']>()
      .toEqualTypeOf<BrowserAnnotation>();
    type WorkBacklogAssignmentUpdatedEvent = Extract<
      MainToRendererEvent,
      { type: 'workItem.assignmentUpdated' }
    >;
    expectTypeOf<WorkBacklogAssignmentUpdatedEvent['payload']>()
      .toEqualTypeOf<
        Omit<WorkBacklogAssignment, 'policy' | 'status'> & {
          policy?: WorkBacklogAssignmentPolicy;
          status: WorkBacklogAssignmentStatus | 'working';
        }
      >();
    expectTypeOf<Pick<WorkBacklogAssignmentUpdatedEvent, keyof OptionalEventContext>>()
      .toEqualTypeOf<OptionalEventContext>();
    expectTypeOf<Extract<MainToRendererEvent, { type: 'clientRequest.resolved' }>>().toEqualTypeOf<never>();
    type AgentUpdatedEvent = Extract<MainToRendererEvent, { type: 'agent.updated' }>;
    expectTypeOf<AgentUpdatedEvent['payload']>()
      .toEqualTypeOf<
        Omit<Partial<Agent>, 'threadFlags' | 'id' | 'statusText' | 'suggestedPrompt' | 'rateLimitPause'> & {
          threadFlags?: Agent['threadFlags'] | null;
          id: string;
          statusText?: string | null;
          suggestedPrompt?: string | null;
          rateLimitPause?: Agent['rateLimitPause'] | null;
        }
      >();
    expectTypeOf<Pick<AgentUpdatedEvent, keyof AgentOnlyEventContext>>()
      .toEqualTypeOf<AgentOnlyEventContext>();
    type AgentStatusChangedEvent = Extract<MainToRendererEvent, { type: 'agent.statusChanged' }>;
    expectTypeOf<AgentStatusChangedEvent['payload']>().toEqualTypeOf<AgentStatus>();
    expectTypeOf<Pick<AgentStatusChangedEvent, keyof AgentOnlyEventContext>>()
      .toEqualTypeOf<AgentOnlyEventContext>();
    type ThreadStartedEvent = Extract<MainToRendererEvent, { type: 'agent.conversationAttached' }>;
    expectTypeOf<ThreadStartedEvent['payload']>().toEqualTypeOf<{ cwd?: string }>();
    expectTypeOf<ThreadStartedEvent['conversationId']>().toEqualTypeOf<string>();
    expectTypeOf<ThreadStartedEvent['provider']>().toEqualTypeOf<HarnessProvider>();
    type ThreadSettingsUpdatedEvent = Extract<MainToRendererEvent, { type: 'conversation.settingsUpdated' }>;
    expectTypeOf<ThreadSettingsUpdatedEvent['payload']>()
      .toEqualTypeOf<{ settings: import('../contracts/events').ConversationSettings }>();
    type ThreadModeUpdatedEvent = Extract<MainToRendererEvent, { type: 'conversation.modeUpdated' }>;
    expectTypeOf<ThreadModeUpdatedEvent['payload']>().toEqualTypeOf<{ mode: 'default' | 'plan'; permission?: string }>();
    expectTypeOf<ThreadModeUpdatedEvent['provider']>().toEqualTypeOf<HarnessProvider>();
    type ThreadGoalUpdatedEvent = Extract<MainToRendererEvent, { type: 'conversation.goalUpdated' }>;
    expectTypeOf<ThreadGoalUpdatedEvent['payload']>()
      .toEqualTypeOf<{ goal: ThreadGoal }>();
    expectTypeOf<Pick<ThreadGoalUpdatedEvent, keyof AgentThreadEventContext>>()
      .toEqualTypeOf<AgentThreadEventContext>();
    type ThreadGoalClearedEvent = Extract<MainToRendererEvent, { type: 'conversation.goalCleared' }>;
    expectTypeOf<ThreadGoalClearedEvent['payload']>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<Pick<ThreadGoalClearedEvent, keyof AgentOnlyEventContext>>()
      .toEqualTypeOf<AgentOnlyEventContext>();
    type ThreadTokenUsageUpdatedEvent = Extract<MainToRendererEvent, { type: 'conversation.contextUsageUpdated' }>;
    expectTypeOf<ThreadTokenUsageUpdatedEvent['payload']>()
      .toEqualTypeOf<{ contextUsage: AgentContextUsage }>();
    expectTypeOf<Pick<ThreadTokenUsageUpdatedEvent, keyof ProviderThreadEventContext>>()
      .toEqualTypeOf<ProviderThreadEventContext>();
    type SubagentOperationChangedEvent = Extract<MainToRendererEvent, { type: 'subagent.operationChanged' }>;
    expectTypeOf<SubagentOperationChangedEvent['payload']>().toEqualTypeOf<SubagentOperationChange>();
    expectTypeOf<Pick<SubagentOperationChangedEvent, keyof ProviderThreadEventContext>>()
      .toEqualTypeOf<ProviderThreadEventContext>();
    type SubagentActivityChangedEvent = Extract<MainToRendererEvent, { type: 'subagent.activityChanged' }>;
    expectTypeOf<SubagentActivityChangedEvent['payload']>().toEqualTypeOf<SubagentActivityChange>();
    expectTypeOf<Pick<SubagentActivityChangedEvent, keyof ProviderThreadEventContext>>()
      .toEqualTypeOf<ProviderThreadEventContext>();
    type SubagentIdentityChangedEvent = Extract<MainToRendererEvent, { type: 'subagent.identityChanged' }>;
    expectTypeOf<SubagentIdentityChangedEvent['payload']>().toEqualTypeOf<SubagentIdentityChange>();
    expectTypeOf<Pick<SubagentIdentityChangedEvent, keyof ProviderThreadEventContext>>()
      .toEqualTypeOf<ProviderThreadEventContext>();
    type SubagentStatusChangedEvent = Extract<MainToRendererEvent, { type: 'subagent.statusChanged' }>;
    expectTypeOf<SubagentStatusChangedEvent['payload']>().toEqualTypeOf<SubagentStatusChange>();
    expectTypeOf<Pick<SubagentStatusChangedEvent, keyof ProviderThreadEventContext>>()
      .toEqualTypeOf<ProviderThreadEventContext>();
    type AgentPromptQueuedEvent = Extract<MainToRendererEvent, { type: 'agent.promptQueued' }>;
    expectTypeOf<AgentPromptQueuedEvent['payload']>().toEqualTypeOf<{
      id: string;
      text: string;
      options?: SendPromptOptions;
      submitted?: boolean;
    }>();
    expectTypeOf<Pick<AgentPromptQueuedEvent, keyof AgentOnlyEventContext>>()
      .toEqualTypeOf<AgentOnlyEventContext>();
    type AgentPromptRetryScheduledEvent = Extract<MainToRendererEvent, { type: 'agent.promptRetryScheduled' }>;
    expectTypeOf<AgentPromptRetryScheduledEvent['payload']>().toEqualTypeOf<{
      id: string;
      attempts: number;
      lastError: string;
      retryAt?: string;
    }>();
    expectTypeOf<Pick<AgentPromptRetryScheduledEvent, keyof AgentOnlyEventContext>>()
      .toEqualTypeOf<AgentOnlyEventContext>();
    type AgentPromptDequeuedEvent = Extract<MainToRendererEvent, { type: 'agent.promptDequeued' }>;
    expectTypeOf<AgentPromptDequeuedEvent['payload']>().toEqualTypeOf<{ ids: string[] }>();
    expectTypeOf<Pick<AgentPromptDequeuedEvent, keyof AgentOnlyEventContext>>()
      .toEqualTypeOf<AgentOnlyEventContext>();
    type DiffUpdatedEvent = Extract<MainToRendererEvent, { type: 'conversation.turnDiffUpdated' }>;
    expectTypeOf<DiffUpdatedEvent['payload']>()
      .toEqualTypeOf<Omit<TurnGitDiff, 'agentId' | 'turnId' | 'updatedAt'>>();
    expectTypeOf<Pick<DiffUpdatedEvent, keyof ThreadTurnEventContext>>()
      .toEqualTypeOf<ThreadTurnEventContext>();
    type FileActivityEvent = Extract<MainToRendererEvent, { type: 'workspace.fileActivityDetected' }>;
    expectTypeOf<FileActivityEvent['payload']>()
      .toEqualTypeOf<Omit<AgentFileActivity, 'agentId' | 'turnId' | 'occurredAt'>>();
    expectTypeOf<Pick<FileActivityEvent, keyof ThreadTurnEventContext>>()
      .toEqualTypeOf<ThreadTurnEventContext>();
    type GitStatusUpdatedEvent = Extract<MainToRendererEvent, { type: 'git.statusUpdated' }>;
    expectTypeOf<GitStatusUpdatedEvent['payload']>().toEqualTypeOf<AgentGitStatus>();
    expectTypeOf<Pick<GitStatusUpdatedEvent, keyof AgentOnlyEventContext>>()
      .toEqualTypeOf<AgentOnlyEventContext>();
    type ProviderApprovalRequestedEvent = Extract<MainToRendererEvent, { type: 'agentRequest.created' }>;
    expectTypeOf<ProviderApprovalRequestedEvent['payload']>()
      .toEqualTypeOf<{ request: import('../agent-request').AgentRequest }>();
    expectTypeOf<Pick<ProviderApprovalRequestedEvent, keyof ProviderThreadEventContext>>()
      .toEqualTypeOf<ProviderThreadEventContext>();
    type ProviderApprovalResolvedEvent = Extract<MainToRendererEvent, { type: 'agentRequest.resolved' }>;
    expectTypeOf<ProviderApprovalResolvedEvent['payload']>().toEqualTypeOf<{
      id: string; outcome: import('../agent-request').AgentRequestOutcome;
    }>();
    expectTypeOf<Pick<ProviderApprovalResolvedEvent, keyof ProviderThreadEventContext>>()
      .toEqualTypeOf<ProviderThreadEventContext>();
    expectTypeOf<AppIpcEvents[typeof ipcChannels.appCommand]>()
      .toEqualTypeOf<AppCommand>();
    expectTypeOf<AppIpcEvents[typeof ipcChannels.updateStatusChanged]>()
      .toEqualTypeOf<DesktopUpdateStatus>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.launchChatGptApp]['args']>()
      .toEqualTypeOf<[input?: LaunchChatGptAppInput]>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.launchChatGptApp]['result']>()
      .toEqualTypeOf<LaunchChatGptAppResult>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.openAgentPath]['args']>()
      .toEqualTypeOf<[agentId: string, application: OpenInApplication, filePath?: string]>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.openAgentPath]['result']>()
      .toEqualTypeOf<AppSnapshot>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.setDockBadgeCount]['args']>()
      .toEqualTypeOf<[count: number]>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.setDockBadgeCount]['result']>()
      .toEqualTypeOf<void>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.setMenuBarVisible]['args']>()
      .toEqualTypeOf<[visible: boolean]>();
    expectTypeOf<AppIpcRequests[typeof ipcChannels.setMenuBarVisible]['result']>()
      .toEqualTypeOf<void>();
  });
});
