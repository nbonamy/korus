import { createCursorConversationReplica as createReplica } from '@korus-dev/multi-agent-sdk/contracts';
import type { CursorConversationSnapshot } from '@korus-dev/multi-agent-sdk/cursor';
import { isBookkeepingTool } from './bookkeeping-tools';
export { emptyCursorSnapshot } from '@korus-dev/multi-agent-sdk/contracts';

export function createCursorConversationReplica(snapshot: CursorConversationSnapshot) {
  return createReplica(snapshot, { isBookkeepingTool });
}
