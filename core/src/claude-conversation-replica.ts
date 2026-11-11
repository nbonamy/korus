import { createClaudeConversationReplica as createReplica, type ClaudeConversationReplica } from '@korus-dev/multi-agent-sdk/contracts';
import type { ClaudeConversationSnapshot } from '@korus-dev/multi-agent-sdk/claude';
import { isBookkeepingTool } from './bookkeeping-tools';
export type { ClaudeConversationReplica } from '@korus-dev/multi-agent-sdk/contracts';

export function createClaudeConversationReplica(snapshot: ClaudeConversationSnapshot): ClaudeConversationReplica {
  return createReplica(snapshot, { isBookkeepingTool });
}
