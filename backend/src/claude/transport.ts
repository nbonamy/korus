import type { AskUserAnswers, AskUserQuestion, PromptAttachment } from '@workspace/core/contracts';
import type { randomUUID } from 'node:crypto';
import type { ClaudeSdkMessage } from './protocol';

export type ClaudeTurnParams = {
  ownerId?: string;
  cwd: string;
  prompt: string;
  messageId?: ReturnType<typeof randomUUID>;
  /** Ignore cold-resume output until this input is replayed by the SDK. */
  waitForInputReplay?: boolean;
  sessionId?: string;
  model?: string | null;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null;
  fastMode?: boolean;
  permissionMode?: string | null;
  appendSystemPrompt?: string | null;
  mcpServerUrl?: string | null;
  hostedMcpServerUrls?: Readonly<Record<string, string>>;
  allowedTools?: string[];
  attachments?: readonly PromptAttachment[];
};

export type ClaudeAvailableModel = {
  value: string;
  resolvedModel?: string;
  displayName: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: Array<'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
};

export type ClaudeModelDiscoveryParams = {
  cwd: string;
};

export type ClaudeTurnHandle = {
  readonly done: Promise<void>;
  steer?(prompt: string, attachments?: readonly PromptAttachment[], messageId?: ReturnType<typeof randomUUID>): Promise<boolean>;
  interrupt(): Promise<void>;
};

export type ClaudeContextUsage = {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
};

export type ClaudeContextUsageParams = Omit<ClaudeTurnParams, 'prompt' | 'attachments'> & {
  sessionId: string;
};

export type ClaudePermissionRequest = {
  kind: 'confirm_tool' | 'ask_user';
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  blockedPath?: string;
  decisionReason?: string;
  title?: string;
  displayName?: string;
  description?: string;
  allowConversation: boolean;
  allowAlways: boolean;
  questions?: AskUserQuestion[];
};

type ClaudePermissionDecision = 'allow' | 'allow_conversation' | 'always_allow' | 'deny';

export type ClaudePermissionResponse = {
  decision?: ClaudePermissionDecision | null;
  answers?: AskUserAnswers;
  cancelled?: boolean;
};

export type ClaudeTurnTransport = {
  generateText?(input: import('@workspace/core/backend-driver').BackendTextGenerationInput): Promise<import('@workspace/core/backend-driver').BackendTextGenerationResult>;
  startTurn(
    params: ClaudeTurnParams,
    onMessage: (message: ClaudeSdkMessage) => void,
    onPermissionRequest?: (request: ClaudePermissionRequest) => void,
    onPermissionCancelled?: (requestId: string) => void,
    /** null reports an incomplete request set without fabricating an identity. */
    onRequestUsage?: (usage: import('./request-usage').ClaudeRequestUsage | null) => void,
  ): ClaudeTurnHandle;
  respondToPermissionRequest?(requestId: string, response: ClaudePermissionResponse, ownerId?: string): Promise<void>;
  discoverModels?(params: ClaudeModelDiscoveryParams): Promise<ClaudeAvailableModel[] | null>;
  listModels?(): Promise<ClaudeAvailableModel[] | null>;
  getContextUsage?(sessionId: string): Promise<ClaudeContextUsage | null>;
  readContextUsage?(params: ClaudeContextUsageParams): Promise<ClaudeContextUsage | null>;
  closeSession?(sessionId: string): void | Promise<void>;
  deleteSession?(sessionId: string, cwd: string): Promise<void>;
  forkSession?(sessionId: string, cwd: string, upToMessageId?: string, transcriptFolder?: string): Promise<string>;
  forkWorktreeSession?(sessionId: string, sourceCwd: string, upToMessageId?: string, transcriptFolder?: string): Promise<string>;
  close(): Promise<void>;
};
