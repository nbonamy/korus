import type { Message, MessagePart, SessionState } from '@korus-dev/multi-agent-sdk';
import type { SessionPatchOp } from '@korus-dev/multi-agent-sdk/contracts';
import type { Agent, HarnessProvider, MainToRendererEvent } from '@workspace/core/contracts';
import { projectSessionConversation, type ConversationPresentation } from '../../src/provider-conversation-bindings';

/** A conversation as the harness reports it, with empty defaults for whatever the test does not care about. */
export function sessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    messages: [], busy: false, activeTurnId: null, turns: [], requests: [], error: null,
    title: null, goal: null, contextUsage: null, plan: null,
    ...overrides,
  };
}

/** A complete message made of one text part. */
export function textMessage(
  id: string,
  role: Message['role'],
  text: string,
  options: { agentId?: string; turnId?: string; status?: Message['status']; createdAt?: string; parts?: MessagePart[] } = {},
): Message {
  return {
    id, role, agentId: options.agentId ?? 'agent', status: options.status ?? 'complete', turnId: options.turnId ?? 'turn-1',
    parts: options.parts ?? [{ type: 'text', text }], createdAt: options.createdAt ?? '2026-09-06T00:00:00.000Z',
  };
}

/** A completed turn. */
export function completedTurn(id: string, overrides: Partial<SessionState['turns'][number]> = {}): SessionState['turns'][number] {
  return { id, status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null, ...overrides };
}

/** A turn in progress. */
export function runningTurn(id: string, overrides: Partial<SessionState['turns'][number]> = {}): SessionState['turns'][number] {
  return completedTurn(id, { status: 'inProgress', ...overrides });
}

type Stream = { conversation?: string | null; epoch?: string; seq?: number; provider?: HarnessProvider; occurredAt?: string };

function envelope(agentId: string, options: Stream) {
  return { agentId, provider: options.provider ?? 'codex', seq: options.seq ?? 0, occurredAt: options.occurredAt ?? '2026-11-11T00:00:00.000Z' };
}

/** The event that replaces an agent's conversation with `state` at `revision`. */
export function sessionSnapshotEvent(
  agentId: string,
  state: SessionState,
  options: Stream & { revision?: number } = {},
): Extract<MainToRendererEvent, { type: 'conversation.sessionSnapshot' }> {
  return {
    type: 'conversation.sessionSnapshot', ...envelope(agentId, options),
    payload: { conversation: options.conversation ?? null, epoch: options.epoch ?? 'epoch-1', snapshot: { revision: options.revision ?? 1, state } },
  } as Extract<MainToRendererEvent, { type: 'conversation.sessionSnapshot' }>;
}

/** The event that moves an agent's conversation from `revision - 1` to `revision`. */
export function sessionPatchEvent(
  agentId: string,
  revision: number,
  ops: SessionPatchOp[],
  options: Stream = {},
): Extract<MainToRendererEvent, { type: 'conversation.sessionPatch' }> {
  return {
    type: 'conversation.sessionPatch', ...envelope(agentId, options),
    payload: { conversation: options.conversation ?? null, epoch: options.epoch ?? 'epoch-1', patch: { revision, ops } },
  } as Extract<MainToRendererEvent, { type: 'conversation.sessionPatch' }>;
}

/** Ops that set session fields. */
export function setOps(fields: Partial<Omit<SessionState, 'messages'>>): SessionPatchOp[] {
  return Object.entries(fields).map(([key, value]) => ({ op: 'set', key, value }) as SessionPatchOp);
}

/** An op that appends messages to a transcript of `length` messages. */
export function appendMessages(length: number, ...messages: Message[]): SessionPatchOp {
  return { op: 'spliceMessages', start: length, deleteCount: 0, messages };
}

/** An op that replaces the message at `index`. */
export function replaceMessage(index: number, message: Message): SessionPatchOp {
  return { op: 'spliceMessages', start: index, deleteCount: 1, messages: [message] };
}

/** What an agent's conversation pane shows for `state`; null without one. */
export function conversationFrom(agent: Agent, state: SessionState | null | undefined): ConversationPresentation | null {
  return state ? projectSessionConversation(state, agent) : null;
}
