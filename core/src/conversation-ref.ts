import { sessionConversationRef } from '@korus-dev/multi-agent-sdk/contracts';
import type { Agent, ProviderConversationRef } from './contracts';

/** The conversation an agent continues, in its folder; null before it has one. */
export function conversationRefFromAgent(agent: Agent): ProviderConversationRef | null {
  return agent.providerSession ? sessionConversationRef(agent.providerSession, agent.folder) : null;
}
