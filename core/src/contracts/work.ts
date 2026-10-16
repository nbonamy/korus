import type { BackendConversationRef } from './conversation';
import type { AppText } from './shared';

import type { WorkProviderKind } from '../work-providers';
export type { WorkProviderKind } from '../work-providers';

export type WorkIntegrationStatus = 'notConfigured' | 'disconnected' | 'connecting' | 'connected' | 'error';

export type WorkIntegrationConnection = {
  provider: WorkProviderKind;
  status: WorkIntegrationStatus;
  /** Missing uses automatic detection; none has no direct connection and can fall back to CLI access. */
  source?: 'api' | 'cli' | 'none';
  accountLabel?: string;
  detail?: AppText;
  connectedAt?: string;
};

export type WorkProviderSettings = {
  oauthClientId?: string;
};

export type WorkBacklogAssignmentPolicy = 'complete' | 'review';

export type WorkBacklogAssignmentStatus = 'blocked' | 'completed' | 'inProgress' | 'readyForReview';

export type WorkBacklogAssignment = {
  item?: WorkItemReference;
  provider: WorkProviderKind;
  itemId: string;
  agentId: string;
  assignedAt: string;
  policy: WorkBacklogAssignmentPolicy;
  status: WorkBacklogAssignmentStatus;
  completedAt?: string;
  note?: string;
  updatedAt?: string;
  automationId?: string;
  automationExecutionId?: string;
};

export type WorkItemReference = Pick<WorkItem, 'provider' | 'id' | 'sourceId' | 'sourceName' | 'number' | 'title' | 'url' | 'identifier' | 'body'>;

export type WorkSourceConfiguration = {
  sourceId?: string;
  assigneeLogin?: string;
  tagName?: string;
};

export type WorkSourceConfigurationInput = {
  sourceId?: string | null;
  assigneeLogin?: string | null;
  tagName?: string | null;
};

export type WorkBacklogProviderConfigurations = Partial<Record<WorkProviderKind, WorkSourceConfiguration>>;

export type WorkBacklogConfigurationInput = {
  provider: WorkProviderKind;
  configuration: WorkSourceConfigurationInput;
};

export type WorkBacklogState = {
  connections: WorkIntegrationConnection[];
  providerConfigurations: WorkBacklogProviderConfigurations;
  providerSettings: Partial<Record<WorkProviderKind, WorkProviderSettings>>;
  assignments: Record<string, WorkBacklogAssignment>;
};

export type WorkProviderAuthorization = {
  provider: WorkProviderKind;
  flow?: 'browser';
  userCode?: string;
  verificationUri: string;
  expiresAt: string;
};

/** An opaque provider-owned backlog scope, independent of an execution repository. */
export type WorkSource = {
  provider: WorkProviderKind;
  id: string;
  owner?: string;
  name: string;
  fullName: string;
  url: string;
  isPrivate?: boolean;
  updatedAt?: string;
  workItemsUpdatedAt?: string;
};

export type WorkItemLabel = {
  name: string;
  color?: string;
};

export type WorkItemState = 'open' | 'closed';

export type WorkItemKind = 'issue' | 'pullRequest';

export type WorkItemQuery = {
  kind?: WorkItemKind | 'all';
  state?: WorkItemState | 'all';
};

export type GlobalWorkItemQuery = WorkItemQuery & {
  assignment?: 'all' | 'viewer';
  cursor?: string;
  pageSize?: number;
};

export type WorkItemPage = {
  items: WorkItem[];
  /** Absent when the provider has no further results. Opaque to callers. */
  nextCursor?: string;
  /** Only supplied when the provider can report a reliable total cheaply. */
  totalItems?: number;
};

export type WorkItem = {
  provider: WorkProviderKind;
  id: string;
  kind?: WorkItemKind;
  branchName?: string;
  sourceId: string;
  sourceName: string;
  /** Optional native numeric reference, used only by code-host operations. */
  number?: number;
  identifier?: string;
  nativeState?: string;
  assignedToViewer?: boolean;
  title: string;
  url: string;
  state: WorkItemState;
  authorName?: string;
  assignees?: string[];
  body?: string;
  labels: WorkItemLabel[];
  createdAt: string;
  updatedAt: string;
};

export type AutomationTarget =
  | { kind: 'agent'; agentId: string }
  | { kind: 'quickChat'; agentId: string }
  | { kind: 'newQuickChat'; teamId: string; backend: import('./shared').AgentBackend; model?: string; reasoningEffort?: string };

export type AutomationSchedule = { intervalMinutes: number } | { rrule: string; timeZone: string };

export type AutomationExecutionStatus = 'working' | 'awaitingInput' | 'completed' | 'failed';

export type AutomationExecutionLogEntry = {
  id: string;
  automationId: string;
  startedAt: string;
  completedAt?: string;
  status: AutomationExecutionStatus;
  agentId?: string;
  agentName?: string;
  conversationRef?: BackendConversationRef;
  error?: string;
};

export type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  prompt: string;
  target: AutomationTarget;
  schedule: AutomationSchedule;
  executionLog: AutomationExecutionLogEntry[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  scheduleAnchorAt?: string;
  lastError?: string;
};

export type AutomationLocation =
  | {
    kind: 'local';
  }
  | {
    kind: 'remote';
    remoteConnectionId: string;
  };

export type CreateAutomationInput = {
  name?: string;
  enabled?: boolean;
  prompt: string;
  target: AutomationTarget;
  schedule: AutomationSchedule;
};

export type UpdateAutomationInput = CreateAutomationInput & {
  id: string;
};
