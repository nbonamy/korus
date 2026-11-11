import type { CodexConversationSnapshot } from '@korus-dev/multi-agent-sdk/codex';
import type { ClaudeConversationSnapshot } from '@korus-dev/multi-agent-sdk/claude';
import type { CursorConversationSnapshot } from '@korus-dev/multi-agent-sdk/cursor';
import type { AntigravityConversationSnapshot } from '@korus-dev/multi-agent-sdk/antigravity';
import type { ThreadPlan, ThreadGoal, ProviderSessionData, ClientRequest, Approval } from '@korus-dev/multi-agent-sdk';
import { claudePaneClientRequests } from './claude-pane-client-requests';
import { providerPaneClientRequests } from './provider-pane-client-requests';
type NativeSnapshot = CodexConversationSnapshot | ClaudeConversationSnapshot | CursorConversationSnapshot | AntigravityConversationSnapshot;

/** Read-only presentation; native replicas retain sole ownership of transcript transitions. */
export type ConversationPresentation = Pick<NativeSnapshot,
  'messages' | 'turns' | 'activeTurnId' | 'busy' | 'error' | 'historyLoading' | 'historyState' | 'contextUsage' | 'answeredClientRequestIds'
> & {
  latestTurnId: string | null;
  selection?: { model?: string | null; reasoningEffort?: string | null; serviceTier?: string | null };
  permission?: string | null;
  clientRequests: ClientRequest[];
  approvals?: Approval[];
  goal?: ThreadGoal | null;
  plan?: ThreadPlan | null;
};
type Project<S> = (snapshot: S | null | undefined) => ConversationPresentation | null;
/** Settings evidence carried by native session identity, without caller defaults. */
export function projectSessionSelection(session: ProviderSessionData | null | undefined): ConversationPresentation['selection'] {
  return session && 'model' in session && session.model
    ? { model: session.model, reasoningEffort: session.reasoningEffort ?? null }
    : undefined;
}

function common(snapshot: NativeSnapshot) {
  return {
    messages: snapshot.messages, turns: snapshot.turns, activeTurnId: snapshot.activeTurnId,
    busy: snapshot.busy, error: snapshot.error, historyLoading: snapshot.historyLoading,
    historyState: snapshot.historyState, contextUsage: snapshot.contextUsage,
    answeredClientRequestIds: snapshot.answeredClientRequestIds,
  };
}
export const projectCodexConversation: Project<CodexConversationSnapshot> = snapshot => {
  if (!snapshot) return null;
  const executionPlan = snapshot.executionPlan;
  return {
    selection: { model: snapshot.models.find(model => model.id === snapshot.selectedModelId)?.model ?? snapshot.selectedModelId, reasoningEffort: snapshot.selectedReasoningEffort, serviceTier: snapshot.selectedServiceTier },
    permission: snapshot.approvalPreset,
    ...common(snapshot), latestTurnId: snapshot.turnIds.at(-1) ?? null,
    clientRequests: snapshot.clientRequests, approvals: snapshot.approvals, goal: snapshot.goal,
    plan: executionPlan ? {
      threadId: snapshot.activeConversationId, turnId: executionPlan.turnId, kind: 'execution',
      status: executionPlan.steps.length > 0 && executionPlan.steps.every(step => step.status === 'completed') ? 'completed' : 'inProgress',
      explanation: executionPlan.explanation ?? '', steps: executionPlan.steps.map(step => ({ ...step })),
      markdown: executionPlan.markdown, updatedAt: executionPlan.updatedAt,
    } : null,
  };
};
export const projectClaudeConversation: Project<ClaudeConversationSnapshot> = snapshot => snapshot ? {
  ...common(snapshot), latestTurnId: snapshot.turnIds.at(-1) ?? null, clientRequests: claudePaneClientRequests(snapshot),
  plan: snapshot.plan,
} : null;
export const projectCursorConversation: Project<CursorConversationSnapshot> = snapshot => {
  if (!snapshot) return null;
  // Keep native thoughts in the replica, but out of the SDK's activity headings.
  const messages = snapshot.messages.some(message => message.parts.some(part => part.type === 'reasoning'))
    ? snapshot.messages.flatMap(message => {
      const parts = message.parts.filter(part => part.type !== 'reasoning');
      return parts.length === message.parts.length ? [message] : parts.length ? [{ ...message, parts }] : [];
    }) : snapshot.messages;
  return {
    ...common(snapshot), messages, latestTurnId: snapshot.turns.at(-1)?.id ?? null,
    clientRequests: providerPaneClientRequests(snapshot),
  };
};
export const projectAntigravityConversation: Project<AntigravityConversationSnapshot> = snapshot => snapshot ? {
  ...common(snapshot), latestTurnId: snapshot.turns.at(-1)?.id ?? null, clientRequests: providerPaneClientRequests(snapshot),
} : null;
