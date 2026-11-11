import type { Agent, ClaudeConversationSnapshot, ThreadPlan } from '@workspace/core/contracts';
import { planReviewDelivery } from '@workspace/core/plan-review';
import type { CodexConversationSnapshot } from '@korus-dev/multi-agent-sdk/codex';
import type { ConversationPaneIdentityState } from '@korus-dev/agent-ui-sdk';
import type { CursorConversationSnapshot } from '@workspace/core/contracts/cursor-conversation';
import type { AntigravityConversationSnapshot } from '@workspace/core/contracts/antigravity-conversation';

/** Legacy native fixture inputs are interpreted only at this adapter boundary. */
export type NativeConversationSources = {
  codexSnapshot?: CodexConversationSnapshot | null;
  claudeSnapshot?: ClaudeConversationSnapshot | null;
  cursorSnapshot?: CursorConversationSnapshot | null;
  antigravitySnapshot?: AntigravityConversationSnapshot | null;
};

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
export type { ConversationPresentation } from '@korus-dev/multi-agent-sdk/renderer';
import { projectCodexConversation as codexPresentation, projectClaudeConversation as claudePresentation,
  projectCursorConversation as cursorPresentation, projectAntigravityConversation as antigravityPresentation,
  type ConversationPresentation } from '@korus-dev/multi-agent-sdk/renderer';
type Project<S> = (snapshot: S | null | undefined, agent: Agent) => ConversationPresentation | null;
export const projectCodexConversation: Project<CodexConversationSnapshot> = codexPresentation;
export const projectClaudeConversation: Project<ClaudeConversationSnapshot> = claudePresentation;
export const projectAntigravityConversation: Project<AntigravityConversationSnapshot> = antigravityPresentation;
export const projectCursorConversation: Project<CursorConversationSnapshot> = (snapshot, agent) => {
  const presentation = cursorPresentation(snapshot);
  if (!snapshot || !presentation) return null;
  const review = agent.planReview;
  const delivery = review ? planReviewDelivery(review) : null;
  const sidebarRequestId = review?.status === 'pending' && review.conversationId === snapshot.sessionId
    && review.turnId === snapshot.activeTurnId && delivery?.kind === 'request' ? delivery.requestId : undefined;
  return { ...presentation, clientRequests: presentation.clientRequests.filter(request => request.id !== sidebarRequestId) };
};

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
  return view.conversation !== undefined ? view.conversation : legacyBindings[view.agent.provider](view.agent, view);
}
export function legacyConversationPresentation(agent: Agent, sources: {
  codexConversationSnapshot?: CodexConversationSnapshot | null;
  claudeConversationSnapshot?: ClaudeConversationSnapshot | null;
  cursorConversationSnapshot?: CursorConversationSnapshot | null;
  antigravityConversationSnapshot?: AntigravityConversationSnapshot | null;
}): ConversationPresentation | null {
  return legacyBindings[agent.provider](agent, {
    codexSnapshot: sources.codexConversationSnapshot,
    claudeSnapshot: sources.claudeConversationSnapshot,
    cursorSnapshot: sources.cursorConversationSnapshot,
    antigravitySnapshot: sources.antigravityConversationSnapshot,
  });
}
export function conversationKeyForAgent(agent: Agent): NonNullable<ConversationPaneIdentityState['conversationKey']> {
  const session = agent.providerSession;
  return session?.kind === 'codex' ? `codex:${session.threadId}` : session ? `${session.kind}:${session.sessionId}` : `agent:${agent.id}`;
}

export function conversationPlanForAgent(agent: Agent, presentation: ConversationPresentation | null): ThreadPlan | null {
  // Claude's plan belongs to its native cache; other providers may use an app-owned plan.
  return agent.provider === 'claude' ? presentation?.plan ?? null : presentation?.plan ?? agent.plan ?? null;
}
