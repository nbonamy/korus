import type { ExecutionSelectionOverrides } from './execution';
import type { CodexPromptPart, SurfaceMessageQuestionPart } from '@codex-app-sdk/core/surface';
import type { ReasoningEffort } from './shared';

export type ThreadGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';

export type ThreadGoal = {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type ThreadPlanStepStatus = 'pending' | 'inProgress' | 'completed';

export type ThreadPlanKind = 'execution' | 'proposed';

export type ThreadPlanStatus = 'inProgress' | 'completed' | 'incomplete' | 'interrupted' | 'failed';

export type ThreadPlanStep = {
  step: string;
  status: ThreadPlanStepStatus;
};

export type ThreadPlan = {
  threadId: string;
  turnId: string;
  kind: ThreadPlanKind;
  status: ThreadPlanStatus;
  explanation: string;
  steps: ThreadPlanStep[];
  markdown: string;
  updatedAt: string;
};

export type AgentContextUsage = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  lastTotalTokens: number;
  modelContextWindow: number | null;
  usedPercent: number | null;
};

export type BackendConversationRef =
  | { backend: 'antigravity'; folder: string | null; sessionId: string }
  | {
    backend: 'codex';
    threadId: string;
  }
  | {
    backend: 'claude';
    folder: string | null;
    sessionId: string;
    subagentId?: string;
  };

export type ConversationStorageState = 'active' | 'archived';

export type ConversationListInput = {
  searchTerm?: string;
  limit?: number;
};

export type ConversationResumeTarget = {
  ref: BackendConversationRef;
  storageState: ConversationStorageState;
};

export type ConversationSummary = {
  id: string;
  sessionId?: string;
  parentConversationId?: string;
  agentNickname?: string;
  agentRole?: string;
  title: string;
  preview?: string;
  status?: 'idle' | 'active' | 'error';
  createdAt?: string;
  updatedAt: string;
  messageCount: number;
  storageState: ConversationStorageState;
  ref: BackendConversationRef;
};

export const subagentStatuses = [
  'pendingInit',
  'running',
  'interrupted',
  'completed',
  'errored',
  'shutdown',
  'notFound',
] as const;

export type SubagentStatus = typeof subagentStatuses[number];

export const subagentOperationKinds = [
  'spawnAgent',
  'sendInput',
  'resumeAgent',
  'wait',
  'closeAgent',
  'sendMessage',
  'followupTask',
  'interruptAgent',
  'listAgents',
] as const;

export type SubagentOperationKind = typeof subagentOperationKinds[number];

export const subagentOperationLifecycles = ['started', 'completed'] as const;

export type SubagentOperationLifecycle = typeof subagentOperationLifecycles[number];

export const subagentOperationStatuses = ['inProgress', 'completed', 'failed', 'interrupted'] as const;

export type SubagentOperationStatus = typeof subagentOperationStatuses[number];

export const subagentActivityKinds = ['started', 'interacted', 'interrupted', 'completed'] as const;

export type SubagentActivityKind = typeof subagentActivityKinds[number];

export type SubagentNode = {
  conversationId: string;
  parentConversationId: string;
  createdAt: string;
  status: SubagentStatus;
  statusMessage?: string;
  agentPath?: string;
  agentNickname?: string;
  agentRole?: string;
  prompt?: string;
  model?: string;
  reasoningEffort?: string;
  updatedAt: string;
};

export type SubagentOperation = {
  id: string;
  turnId?: string;
  lifecycle: SubagentOperationLifecycle;
  kind: SubagentOperationKind;
  status: SubagentOperationStatus;
  senderConversationId: string;
  receiverConversationIds: string[];
  prompt?: string;
  model?: string;
  reasoningEffort?: string;
  occurredAt: string;
};

export type SubagentOperationChange = {
  rootConversationId: string;
  operation: SubagentOperation;
  agentStates: Record<string, { status: SubagentStatus; message?: string }>;
};

export type SubagentActivity = {
  id: string;
  turnId?: string;
  lifecycle: SubagentOperationLifecycle;
  kind: SubagentActivityKind;
  conversationId: string;
  agentPath: string;
  occurredAt: string;
};

export type SubagentActivityChange = {
  rootConversationId: string;
  parentConversationId: string;
  activity: SubagentActivity;
};

export type SubagentStatusChange = {
  rootConversationId: string;
  conversationId: string;
  status: SubagentStatus;
  statusMessage?: string;
};

export type SubagentIdentityChange = {
  rootConversationId: string;
  conversationId: string;
  agentNickname?: string;
  agentRole?: string;
};

export type AgentSubagentTree = {
  rootConversationId: string;
  nodes: Record<string, SubagentNode>;
  operations: Record<string, SubagentOperation>;
  activities: Record<string, SubagentActivity>;
};

export type PromptSkillInput = {
  name: string;
  path: string;
};

export type PromptAttachment =
  | {
    type: 'image';
    path: string;
    detail?: 'auto' | 'low' | 'high' | 'original';
    name?: string;
    mimeType?: string;
    previewUrl?: string;
  }
  | {
    type: 'file';
    path: string;
    name?: string;
    mimeType?: string;
  };

export type RendererPromptAttachment =
  | {
    type: 'image';
    reference: string;
    detail?: 'auto' | 'low' | 'high' | 'original';
  }
  | {
    type: 'file';
    reference: string;
  };

export type SendPromptOptions = {
  content?: readonly CodexPromptPart[];
  /** User-selected options for the /delegate command, consumed by the app adapter. */
  delegation?: import('../delegation-context').DelegationOverrides;
  attachments?: readonly PromptAttachment[];
  selection?: ExecutionSelectionOverrides;
  planMode?: boolean;
  skills?: PromptSkillInput[];
  inputMethod?: 'typed' | 'dictated';
  /** Internal delivery hint: the provider must not create another visible user row. */
  recordUserMessage?: boolean;
  backendOptions?: BackendPromptOptions;
};

export type RendererSendPromptOptions = Omit<SendPromptOptions, 'attachments' | 'recordUserMessage'> & {
  attachments?: readonly RendererPromptAttachment[];
};

export type PromptContentOptions = Pick<SendPromptOptions, 'content'>;

export type BackendPromptOptions =
  | { kind: 'antigravity'; permissionMode?: string | null }
  | {
    kind: 'codex';
    skills?: PromptSkillInput[];
  }
  | {
    kind: 'claude';
    thinkingBudgetTokens?: number | null;
    permissionMode?: string | null;
  };

export type RendererMessageAttachment = {
  kind: 'file' | 'image';
  name: string;
  path?: string;
  url?: string;
  mimeType?: string;
};

export type RendererMessageMedia = {
  url: string;
  alt?: string;
  mimeType?: string;
  prompt?: string;
  title?: string;
};

export type RendererMessagePart =
  | { type: 'attachment'; attachment: RendererMessageAttachment }
  | { type: 'media'; media: RendererMessageMedia; itemId?: string }
  | SurfaceMessageQuestionPart
  | { type: 'reasoning'; summary: string; itemId: string; summaryIndex: number }
  | { type: 'text'; text: string; itemId?: string; phase?: 'commentary' | 'partial_answer' | 'final_answer' }
  | {
    type: 'tool';
    id: string;
    kind: string;
    title: string;
    status: 'running' | 'completed' | 'failed';
    statusText?: string;
    body?: string;
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
  }
  | { type: 'status'; text: string };

export type RendererToolPart = Extract<RendererMessagePart, { type: 'tool' }>;

export type RendererToolPartUpdate = {
  itemId: string;
  title?: string;
  status?: RendererToolPart['status'];
  statusText?: string | null;
  body?: string;
  bodyDelta?: string;
  bodyAppend?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  fallbackToolPart?: RendererToolPart;
};

export type RendererMessage = {
  metadata?: { promptContent?: readonly CodexPromptPart[] };
  id: string;
  agentId: string;
  kind?: 'compaction' | 'steer';
  role: 'user' | 'assistant' | 'system';
  status: 'complete' | 'streaming' | 'error';
  turnId?: string;
  parts: RendererMessagePart[];
  createdAt: string;
  /** Lossless JSON of this message, retrieved in bounded chunks from its owning session. */
  deferredContent?: { contentId: string; byteLength: number };
};

export type ConversationContentInput = { sessionId: string; contentId: string; offset: number };
export type ConversationContentChunk = { data: string; nextOffset: number | null; totalBytes: number };

export type AgentFileActivity = {
  agentId: string;
  turnId: string;
  messageId: string;
  itemId: string;
  path: string;
  action: 'read' | 'edit' | 'create';
  status: 'running' | 'completed' | 'failed';
  occurredAt: string;
};

export type ConversationFileLink = {
  kind: 'file';
  href: string;
  path: string;
  filepath?: string;
  action?: 'read' | 'edit' | 'create';
  line?: number;
  column?: number;
  turnId?: string;
  messageId?: string;
  itemId?: string;
};

export type AgentQueuedPrompt = {
  id: string;
  agentId: string;
  text: string;
  createdAt: string;
  options?: SendPromptOptions;
  attempts?: number;
  lastError?: string;
  retryAt?: string;
  submitted?: boolean;
};

export type AgentHistoryLoadResult = {
  hasOlder: boolean;
};

export type ToolConfirmationDecision =
  | 'allow'
  | 'allow_conversation'
  | 'always_allow'
  | 'deny';

export type ConfirmToolRequest = {
  argumentsPreview: string;
  integrationId: string;
  integrationName: string;
  summary: string;
  toolName: string;
  allowConversation?: boolean;
  allowAlways?: boolean;
};

export type AskUserQuestionOption = {
  label: string;
  description: string;
};

export type AskUserQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  multiSelect?: boolean;
  options: readonly AskUserQuestionOption[] | null;
};

export type AskUserRequest = {
  itemId: string;
  delivery?: 'tool' | 'async';
  blocking?: boolean;
  questions: readonly AskUserQuestion[];
  autoResolutionMs?: number;
};

export type AskUserAnswers = Record<string, { answers: string[] }>;

export type ClientRequest =
  | {
    id: string;
    kind: 'confirm_tool';
    payload: {
      confirmation: ConfirmToolRequest;
    };
  }
  | {
    id: string;
    kind: 'ask_user';
    conversationId?: string;
    turnId?: string;
    itemId?: string;
    payload: {
      request: AskUserRequest;
    };
  };

export type ClientRequestResponse = {
  id: string;
  /** App routing identity; never forwarded as provider request data. */
  agentId?: string;
  payload?: {
    answers?: AskUserAnswers;
    cancelled?: boolean;
    decision?: ToolConfirmationDecision | null;
  };
};
