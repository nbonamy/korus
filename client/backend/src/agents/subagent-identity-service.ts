import type { Agent, AppSnapshot, ConversationSummary, ProviderConversationRef } from '@workspace/core/contracts';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import type { BackendEvent } from '@workspace/core/provider-driver';
import { conversationRefId, sessionConversationId, subagentRef } from '@korus-dev/multi-agent-sdk/contracts';

export type SubagentIdentityServiceOptions = {
  applyEvent: (event: BackendEvent) => void;
  getSnapshot: () => AppSnapshot;
  loadSummary?: (agent: Agent, ref: ProviderConversationRef) => Promise<ConversationSummary | null>;
  persistSnapshot: () => Promise<unknown>;
};

/** Backfills missing labels of subagents that have conversations of their own, without overlapping scans. */
export class SubagentIdentityService {
  private backfillPromise: Promise<void> | null = null;

  constructor(private readonly options: SubagentIdentityServiceOptions) {}

  async backfill(): Promise<void> {
    const loadSummary = this.options.loadSummary;
    if (!loadSummary) return;
    if (this.backfillPromise) return this.backfillPromise;
    const snapshot = this.options.getSnapshot();
    const targets = snapshot.agents.flatMap((agent) => {
      const root = conversationRefFromAgent(agent);
      const tree = snapshot.subagentTrees[agent.id];
      if (!root || !agent.providerSession || !tree || tree.rootConversationId !== sessionConversationId(agent.providerSession)) return [];
      return Object.values(tree.nodes)
        .filter((node) => !node.agentNickname && !node.agentRole)
        .flatMap((node) => {
          // Only a subagent with a conversation of its own has a summary that can name it.
          const ref = subagentRef(root, node.conversationId);
          return ref && conversationRefId(ref) !== conversationRefId(root) ? [{ agent, ref, conversationId: node.conversationId, rootConversationId: tree.rootConversationId }] : [];
        });
    });
    if (targets.length === 0) return;

    const backfill = Promise.allSettled(targets.map(async ({ agent, ref, conversationId, rootConversationId }) => {
      const summary = await loadSummary(agent, ref);
      if (!summary?.agentNickname && !summary?.agentRole) return false;
      const currentNode = this.options.getSnapshot().subagentTrees[agent.id]?.nodes[conversationId];
      if (currentNode?.agentNickname === summary.agentNickname && currentNode.agentRole === summary.agentRole) {
        return false;
      }
      this.options.applyEvent({
        agentId: agent.id,
        provider: agent.provider,
        conversationId: rootConversationId,
        type: 'subagent.identityChanged',
        payload: {
          rootConversationId,
          conversationId,
          ...(summary.agentNickname ? { agentNickname: summary.agentNickname } : {}),
          ...(summary.agentRole ? { agentRole: summary.agentRole } : {}),
        },
        occurredAt: summary.updatedAt,
      });
      return true;
    })).then(async (results) => {
      if (results.some((result) => result.status === 'fulfilled' && result.value)) {
        await this.options.persistSnapshot();
      }
    }).finally(() => {
      if (this.backfillPromise === backfill) this.backfillPromise = null;
    });
    this.backfillPromise = backfill;
    return backfill;
  }
}
