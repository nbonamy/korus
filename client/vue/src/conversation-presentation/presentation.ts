import type { Message, ProviderSessionData, SessionState } from '@korus-dev/multi-agent-sdk';

/** A message as Korus hands it to the conversation pane: the neutral model, without the agent that owns it. */
export type PaneMessage = Omit<Message, 'agentId' | 'createdAt'> & { createdAt?: string };

/** What a conversation pane shows: the harness's session state, read-only. */
export type ConversationPresentation = Pick<SessionState,
  'turns' | 'activeTurnId' | 'busy' | 'error' | 'historyLoading' | 'historyState' | 'contextUsage' | 'answeredClientRequestIds'
  | 'selection' | 'permission' | 'requests' | 'goal' | 'plan'
> & {
  messages: PaneMessage[];
  latestTurnId: string | null;
};

export function presentSessionState(state: SessionState | null | undefined): ConversationPresentation | null {
  if (!state) return null;
  return {
    messages: state.messages, turns: state.turns, activeTurnId: state.activeTurnId, latestTurnId: state.turns.at(-1)?.id ?? null,
    busy: state.busy, error: state.error, historyLoading: state.historyLoading, historyState: state.historyState,
    contextUsage: state.contextUsage, answeredClientRequestIds: state.answeredClientRequestIds,
    selection: state.selection, permission: state.permission, requests: state.requests, goal: state.goal, plan: state.plan,
  };
}

/** Settings evidence carried by native session identity, without caller defaults. */
export function projectSessionSelection(session: ProviderSessionData | null | undefined): ConversationPresentation['selection'] {
  return session && 'model' in session && session.model
    ? { model: session.model, reasoningEffort: session.reasoningEffort ?? null }
    : undefined;
}
