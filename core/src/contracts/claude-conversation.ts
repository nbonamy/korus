import type {
  AgentContextUsage,
  ClientRequest,
  RendererMessage,
  RendererMessagePart,
  RendererToolPart,
  RendererToolPartUpdate,
  ThreadPlan,
} from './conversation';

export type ClaudeConversationTurn = {
  id: string;
  status: 'inProgress' | 'completed' | 'interrupted' | 'failed';
  error: null | { message: string; additionalDetails: string | null; codexErrorInfo: null };
  willRetry: boolean;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  itemsView?: 'summary' | 'full';
  detailsLoading?: boolean;
  detailsError?: string | null;
};

export type ClaudeConversationSnapshot = {
  agentId: string;
  sessionId: string | null;
  activeTurnId: string | null;
  turnIds: string[];
  turns: ClaudeConversationTurn[];
  messages: RendererMessage[];
  answeredClientRequestIds: string[];
  busy: boolean;
  historyLoading: boolean;
  historyState: { hasOlder: boolean; loadingOlder: boolean };
  contextUsage: AgentContextUsage | null;
  plan: ThreadPlan | null;
  error: string | null;
};

type ClaudeConversationEventBase = {
  seq: number;
  occurredAt: string;
  agentId: string;
  backend: 'claude';
  backendSessionId?: string;
  threadId?: string;
  turnId?: string;
};

export type ClaudeConversationEvent =
  | ClaudeConversationEventBase & {
      type: 'turn.historyUpdated';
      payload: { turn: ClaudeConversationTurn };
    }
  | ClaudeConversationEventBase & {
      type: 'turn.executionPlanUpdated';
      payload: { plan: ThreadPlan | null };
    }
  | ClaudeConversationEventBase & {
      type: 'history.prepended';
      payload: { messages: RendererMessage[]; hasOlder: boolean };
    }
  | ClaudeConversationEventBase & {
      type: 'message.replaced';
      payload: { message: RendererMessage; beforeMessageId?: string };
    }
  | ClaudeConversationEventBase & {
      type: 'context.usageUpdated';
      payload: { contextUsage: AgentContextUsage };
    }
  | ClaudeConversationEventBase & {
      type: 'turn.started';
      turnId: string;
      payload: { turn: { id: string; backend: 'claude' } };
    }
  | ClaudeConversationEventBase & {
      type: 'turn.proposedPlanDelta';
      threadId: string;
      turnId: string;
      payload: { itemId: string; delta: string };
    }
  | ClaudeConversationEventBase & {
      type: 'turn.proposedPlanCompleted';
      threadId: string;
      turnId: string;
      payload: { itemId: string; markdown: string };
    }
  | ClaudeConversationEventBase & {
      type: 'turn.completed';
      turnId: string;
      payload: { turn: { id: string; status: 'completed' | 'interrupted' | 'failed' } };
    }
  | ClaudeConversationEventBase & {
      type: 'context.compactionStarted';
      turnId: string;
      payload: { itemId: string | null } | Record<string, never>;
    }
  | ClaudeConversationEventBase & {
      type: 'context.compactionCompleted';
      turnId: string;
      payload: { itemId: string | null } | Record<string, never>;
    }
  | ClaudeConversationEventBase & {
      type: 'message.delta';
      turnId: string;
      payload: {
        delta: string;
        messageId?: string;
        itemId?: string;
        phase?: Extract<RendererMessagePart, { type: 'text' }>['phase'];
      };
    }
  | ClaudeConversationEventBase & {
      type: 'message.userSubmitted';
      payload: { message: RendererMessage };
    }
  | ClaudeConversationEventBase & {
      type: 'item.started';
      turnId: string;
      payload: { messageId?: string; toolPart: RendererToolPart };
    }
  | ClaudeConversationEventBase & {
      type: 'item.updated';
      turnId: string;
      payload: RendererToolPartUpdate & { messageId?: string };
    }
  | ClaudeConversationEventBase & {
      type: 'approval.requested';
      turnId: string;
      payload: Extract<ClientRequest, { kind: 'confirm_tool' }>;
    }
  | ClaudeConversationEventBase & {
      type: 'toolInput.requested';
      turnId: string;
      payload: Extract<ClientRequest, { kind: 'ask_user' }>;
    }
  | ClaudeConversationEventBase & {
      type: 'clientRequest.resolved';
      payload: Pick<ClientRequest, 'id'>;
    }
  | ClaudeConversationEventBase & {
      type: 'error';
      payload: { message: string; willRetry?: boolean; rateLimit?: import('../auto-resume').RateLimitDetails };
    };
