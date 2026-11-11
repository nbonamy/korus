import type { Agent, ProviderSessionData } from '@workspace/core/contracts';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import { unsupportedProviderFeature, type AgentProviderDriver } from '@workspace/core/provider-driver';

export type HandoffSide = { driver: AgentProviderDriver; agent: Agent };
export type HandoffPrompts = {
  /** Asks the first harness to summarize the conversation. */
  request: string;
  /** Wraps the summary for the second harness. */
  continuation: (summary: string) => string;
  model?: string;
  reasoningEffort?: string;
  /** Longest summary passed on. */
  maxCharacters?: number;
};

/**
 * Carries a conversation's context from one harness to another; both can be the same harness.
 * It uses only basic operations every harness has: a quiet prompt for the summary, a new conversation started with it,
 * and the archive of the old one.
 */
export async function handOffConversation(input: { from: HandoffSide; to: HandoffSide; prompts: HandoffPrompts; archiveSource?: boolean }): Promise<{ providerSession: ProviderSessionData; summary: string }> {
  const { from, to, prompts } = input;
  if (!from.driver.executeScopedPrompt) throw unsupportedProviderFeature(from.agent, 'summaries of a conversation');
  const selection = prompts.model || prompts.reasoningEffort ? { selection: { ...(prompts.model ? { model: prompts.model } : {}), ...(prompts.reasoningEffort ? { reasoningEffort: prompts.reasoningEffort } : {}) } } : undefined;
  const reply = await from.driver.executeScopedPrompt(from.agent, {
    prompt: prompts.request, cwd: from.agent.folder ?? '', scope: { id: 'conversation-handoff', mcpServers: [] },
    ...(from.agent.providerSession ? { session: from.agent.providerSession } : {}), silent: true, ...(selection ? { options: selection as never } : {}),
  });
  const summary = reply.text.trim().slice(0, prompts.maxCharacters ?? Infinity);
  if (!summary) throw new Error('The agent returned an empty session handoff.');
  const started = await to.driver.sendPrompt(to.agent, prompts.continuation(summary));
  if (input.archiveSource) {
    const ref = conversationRefFromAgent(from.agent);
    if (ref) await from.driver.setConversationStorage?.(ref, 'archived');
  }
  return { providerSession: started.providerSession, summary };
}
