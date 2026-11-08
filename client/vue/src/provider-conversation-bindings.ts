import type { Agent, ClaudeConversationSnapshot, ThreadPlan } from '@workspace/core/contracts';
import { planReviewDelivery } from '@workspace/core/plan-review';
import type { CodexConversationSnapshot } from '@codex-app-sdk/core/surface';
import type { CodexConversationPaneIdentityState, CodexConversationPaneThreadState } from '@codex-app-sdk/vue';
import type { CursorConversationSnapshot } from '@workspace/core/contracts/cursor-conversation';
import type { AntigravityConversationSnapshot } from '@workspace/core/contracts/antigravity-conversation';
import { claudePaneClientRequests } from './components/claude-pane-client-requests';
import { providerPaneClientRequests } from './components/provider-pane-client-requests';

/** Legacy native fixture inputs are interpreted only at this adapter boundary. */
export type NativeConversationSources = {
  codexSnapshot?: CodexConversationSnapshot | null;
  claudeSnapshot?: ClaudeConversationSnapshot | null;
  cursorSnapshot?: CursorConversationSnapshot | null;
  antigravitySnapshot?: AntigravityConversationSnapshot | null;
};
type NativeSnapshot = NonNullable<NativeConversationSources[keyof NativeConversationSources]>;
export type ConversationPresentation = Pick<NativeSnapshot,
  'messages' | 'turns' | 'activeTurnId' | 'busy' | 'error' | 'historyLoading' | 'historyState' | 'contextUsage' | 'answeredClientRequestIds'
> & {
  latestTurnId: string | null;
  clientRequests: NonNullable<CodexConversationPaneThreadState['clientRequests']>;
  approvals?: CodexConversationPaneThreadState['approvals'];
  goal?: CodexConversationPaneThreadState['goal'];
  plan?: ThreadPlan | null;
};
type Project<S> = (snapshot: S | null | undefined, agent: Agent) => ConversationPresentation | null;
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
export const projectCursorConversation: Project<CursorConversationSnapshot> = (snapshot, agent) => {
  if (!snapshot) return null;
  const review = agent.planReview;
  const delivery = review ? planReviewDelivery(review) : null;
  const sidebarRequestId = review?.status === 'pending' && review.conversationId === snapshot.sessionId
    && review.turnId === snapshot.activeTurnId && delivery?.kind === 'request' ? delivery.requestId : undefined;
  return {
    ...common(snapshot), latestTurnId: snapshot.turns.at(-1)?.id ?? null,
    clientRequests: providerPaneClientRequests(snapshot).filter(request => request.id !== sidebarRequestId),
  };
};
export const projectAntigravityConversation: Project<AntigravityConversationSnapshot> = snapshot => snapshot ? {
  ...common(snapshot), latestTurnId: snapshot.turns.at(-1)?.id ?? null, clientRequests: providerPaneClientRequests(snapshot),
} : null;

/** Native cache selection and projection are registered together; no native state is recreated here. */
export function bindConversation<S>(select: (agent: Agent) => S | null, project: Project<S>, needsHistory: (agent: Agent) => boolean) {
  return { selectNative: select, select: (agent: Agent) => project(select(agent), agent), needsHistory };
}

// Compatibility for standalone/native fixture callers. Production views supply the selected presentation.
const legacyBindings = {
  codex: (agent: Agent, sources: NativeConversationSources) => projectCodexConversation(sources.codexSnapshot, agent),
  claude: (agent: Agent, sources: NativeConversationSources) => projectClaudeConversation(sources.claudeSnapshot, agent),
  cursor: (agent: Agent, sources: NativeConversationSources) => projectCursorConversation(sources.cursorSnapshot, agent),
  antigravity: (agent: Agent, sources: NativeConversationSources) => projectAntigravityConversation(sources.antigravitySnapshot, agent),
};
export function conversationForView(view: NativeConversationSources & { agent: Agent; conversation?: ConversationPresentation | null }): ConversationPresentation | null {
  return view.conversation !== undefined ? view.conversation : legacyBindings[view.agent.backend](view.agent, view);
}
export function legacyConversationPresentation(agent: Agent, sources: {
  codexConversationSnapshot?: CodexConversationSnapshot | null;
  claudeConversationSnapshot?: ClaudeConversationSnapshot | null;
  cursorConversationSnapshot?: CursorConversationSnapshot | null;
  antigravityConversationSnapshot?: AntigravityConversationSnapshot | null;
}): ConversationPresentation | null {
  return legacyBindings[agent.backend](agent, {
    codexSnapshot: sources.codexConversationSnapshot,
    claudeSnapshot: sources.claudeConversationSnapshot,
    cursorSnapshot: sources.cursorConversationSnapshot,
    antigravitySnapshot: sources.antigravityConversationSnapshot,
  });
}
export function conversationKeyForAgent(agent: Agent): NonNullable<CodexConversationPaneIdentityState['conversationKey']> {
  const session = agent.backendSession;
  return session?.kind === 'codex' ? `codex:${session.threadId}` : session ? `${session.kind}:${session.sessionId}` : `agent:${agent.id}`;
}

export function conversationPlanForAgent(agent: Agent, presentation: ConversationPresentation | null): ThreadPlan | null {
  // Claude's plan belongs to its native cache; other providers may use an app-owned plan.
  return agent.backend === 'claude' ? presentation?.plan ?? null : presentation?.plan ?? agent.plan ?? null;
}
