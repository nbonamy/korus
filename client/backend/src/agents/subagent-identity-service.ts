import type { Agent, AppSnapshot, ConversationSummary } from '@workspace/core/contracts';
import type { BackendEvent } from '@workspace/core/backend-driver';

export type SubagentIdentityServiceOptions = {
  applyEvent: (event: BackendEvent) => void;
  getSnapshot: () => AppSnapshot;
  loadSummary?: (agent: Agent, conversationId: string) => Promise<ConversationSummary | null>;
  persistSnapshot: () => Promise<unknown>;
};

/** Backfills missing Codex subagent labels without overlapping scans. */
export class SubagentIdentityService {
  private backfillPromise: Promise<void> | null = null;

  constructor(private readonly options: SubagentIdentityServiceOptions) {}

  async backfill(): Promise<void> {
    const loadSummary = this.options.loadSummary;
    if (!loadSummary) return;
    if (this.backfillPromise) return this.backfillPromise;
    const snapshot = this.options.getSnapshot();
    const targets = snapshot.agents.flatMap((agent) => {
      if (agent.backendSession?.kind !== 'codex') return [];
      const tree = snapshot.subagentTrees[agent.id];
      if (!tree || tree.rootConversationId !== agent.backendSession.threadId) return [];
      return Object.values(tree.nodes)
        .filter((node) => !node.agentNickname && !node.agentRole)
        .map((node) => ({ agent, conversationId: node.conversationId, rootConversationId: tree.rootConversationId }));
    });
    if (targets.length === 0) return;

    const backfill = Promise.allSettled(targets.map(async ({ agent, conversationId, rootConversationId }) => {
      const summary = await loadSummary(agent, conversationId);
      if (!summary?.agentNickname && !summary?.agentRole) return false;
      const currentNode = this.options.getSnapshot().subagentTrees[agent.id]?.nodes[conversationId];
      if (currentNode?.agentNickname === summary.agentNickname && currentNode.agentRole === summary.agentRole) {
        return false;
      }
      this.options.applyEvent({
        agentId: agent.id,
        backend: 'codex',
        threadId: rootConversationId,
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
