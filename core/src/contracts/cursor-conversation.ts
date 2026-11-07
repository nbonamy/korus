import type { AgentRequestResponse } from '../agent-request';
import type { AgentContextUsage, ClientRequest, RendererMessage } from './conversation';

export type CursorTurn = {
  id: string;
  status: 'inProgress' | 'completed' | 'interrupted' | 'failed';
  error: null;
  willRetry: false;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

export type CursorConversationSnapshot = {
  agentId: string;
  sessionId: string;
  activeTurnId: string | null;
  turns: CursorTurn[];
  messages: RendererMessage[];
  clientRequests: ClientRequest[];
  answeredClientRequestIds: string[];
  busy: boolean;
  historyLoading: boolean;
  historyState: { hasOlder: false; loadingOlder: false };
  contextUsage: AgentContextUsage | null;
  error: string | null;
};

type Identity = { agentId: string; sessionId: string; turnId: string; occurredAt: string };
export type CursorConversationEvent = Identity & (
  | { type: 'turn.started'; payload: { turn: { id: string } } }
  | { type: 'turn.completed'; payload: { turn: { id: string; status: 'completed' | 'interrupted' | 'failed' }; error?: string } }
  | { type: 'message.upsert'; payload: { message: RendererMessage } }
  | { type: 'request.created'; payload: { request: ClientRequest } }
  | { type: 'request.resolved'; payload: Pick<AgentRequestResponse, 'id' | 'outcome'> }
);
