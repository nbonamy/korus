import type { Agent, ThreadPlan } from '@workspace/core/contracts';
import type { SessionState } from '@korus-dev/multi-agent-sdk';
import { planReviewDelivery } from '@workspace/core/plan-review';
import type { ConversationPaneIdentityState } from '@korus-dev/agent-ui-sdk';
import { presentSessionState, type ConversationPresentation } from './conversation-presentation/presentation';
import { sessionConversationId } from '@korus-dev/multi-agent-sdk/contracts';

/** Injected prompts remain presentation metadata until their provider-owned message arrives. */
export function pendingConversationPrompts(
  pending: readonly import('@workspace/core/pending-conversation-prompt').PendingConversationPrompt[],
  messages: readonly { id?: string; role: string; createdAt?: string; content?: string; parts?: readonly { type: string; text?: string }[] }[],
) {
  const previewIds = new Set(pending.map(prompt => prompt.id));
  const acknowledged = new Set<string | undefined>();
  return pending.filter(prompt => {
    // Ignore metadata from a daemon still running the removed steering preview.
    if ('steering' in prompt && prompt.steering === true) return false;
    const accepted = messages.find(message => message.role === 'user' && !previewIds.has(message.id ?? '') && !acknowledged.has(message.id)
      && Date.parse(message.createdAt ?? '') >= Date.parse(prompt.createdAt)
      && (message.content ?? message.parts?.filter(part => part.type === 'text').map(part => part.text).join('') ?? '') === prompt.text);
    if (accepted) acknowledged.add(accepted.id);
    return !accepted;
  });
}
export type { ConversationPresentation } from './conversation-presentation/presentation';

/** An agent's conversation as Korus shows it, from the harness's session state. */
export function projectSessionConversation(state: SessionState | null | undefined, agent: Agent): ConversationPresentation | null {
  const presentation = presentSessionState(state);
  if (!presentation) return null;
  // Cursor's thoughts stay out of the pane's activity headings.
  const messages = agent.provider !== 'cursor' ? presentation.messages : presentation.messages.flatMap(message => {
    const parts = message.parts.filter(part => part.type !== 'reasoning');
    return parts.length === message.parts.length ? [message] : parts.length ? [{ ...message, parts }] : [];
  });
  // A plan under review in the sidebar is answered there, not in the pane.
  const review = agent.planReview;
  const delivery = review ? planReviewDelivery(review) : null;
  const sidebarRequestId = review?.status === 'pending' && review.conversationId === conversationIdOf(agent)
    && review.turnId === presentation.activeTurnId && delivery?.kind === 'request' ? delivery.requestId : undefined;
  return { ...presentation, messages, requests: sidebarRequestId ? presentation.requests.filter(request => request.id !== sidebarRequestId) : presentation.requests };
}

const conversationIdOf = (agent: Agent) => agent.providerSession ? sessionConversationId(agent.providerSession) : null;

export function conversationForView(view: { conversation?: ConversationPresentation | null }): ConversationPresentation | null {
  return view.conversation ?? null;
}
export function conversationKeyForAgent(agent: Agent): NonNullable<ConversationPaneIdentityState['conversationKey']> {
  const session = agent.providerSession;
  return session ? `${session.kind}:${sessionConversationId(session)}` : `agent:${agent.id}`;
}

export function conversationPlanForAgent(agent: Agent, presentation: ConversationPresentation | null): ThreadPlan | null {
  // Claude's plan belongs to its native cache; other providers may use an app-owned plan.
  return agent.provider === 'claude' ? presentation?.plan ?? null : presentation?.plan ?? agent.plan ?? null;
}
