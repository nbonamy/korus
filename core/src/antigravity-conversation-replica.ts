import { createAntigravityConversationReplica as createReplica } from '@korus-dev/multi-agent-sdk/contracts';
import type { AntigravityConversationSnapshot } from '@korus-dev/multi-agent-sdk/antigravity';
import { isBookkeepingTool } from './bookkeeping-tools';
export { emptyAntigravitySnapshot } from '@korus-dev/multi-agent-sdk/contracts';

export function createAntigravityConversationReplica(snapshot: AntigravityConversationSnapshot) {
  return createReplica(snapshot, { isBookkeepingTool });
}
