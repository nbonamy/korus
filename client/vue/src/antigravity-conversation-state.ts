import { shallowRef } from 'vue';
import type { Agent } from '@workspace/core/contracts';
import type { ProviderConversationFrame } from '@workspace/core/contracts/events';
import { createAntigravityConversationReplica } from '@workspace/core/antigravity-conversation-replica';
import type { AntigravityConversationSnapshot } from '@workspace/core/contracts/antigravity-conversation';

type Frame = { replica: ReturnType<typeof createAntigravityConversationReplica>; snapshot: AntigravityConversationSnapshot; revision: number };
type Event = Extract<ProviderConversationFrame, { backend: 'antigravity' }>;

/** App routing/cache only. Antigravity's replica owns every transcript transition. */
export function createAntigravityConversationState(recover: (agentId: string) => Promise<unknown>) {
  const frames = shallowRef<Record<string, Frame>>({});
  const pending = new Set<string>();
  const lastAttachedSessions = new Map<string, string>();
  function matchesAgent(agent: Agent, frame: Frame): boolean {
    if (agent.backend !== 'antigravity') return false;
    if (agent.backendSession?.kind === 'antigravity') return frame.snapshot.sessionId === agent.backendSession.sessionId;
    // New session frames can precede attachment. A detached old session cannot.
    return frame.snapshot.sessionId !== lastAttachedSessions.get(agent.id);
  }
  function invalidate(agentId: string) {
    const next = { ...frames.value }; delete next[agentId]; frames.value = next;
    if (pending.has(agentId)) return;
    pending.add(agentId);
    void recover(agentId).catch(() => {}).finally(() => pending.delete(agentId));
  }
  return {
    select(agent: Agent): AntigravityConversationSnapshot | null {
      if (agent.backend !== 'antigravity') return null;
      const frame = frames.value[agent.id];
      return frame && matchesAgent(agent, frame) ? frame.snapshot : null;
    },
    receive(event: Event): void {
      const current = frames.value[event.agentId];
      if (current && event.payload.revision <= current.revision) return;
      if (event.type === 'antigravity.conversationSnapshotChanged') {
        frames.value = { ...frames.value, [event.agentId]: { replica: createAntigravityConversationReplica(event.payload.snapshot), snapshot: event.payload.snapshot, revision: event.payload.revision } };
        return;
      }
      if (!current || event.payload.revision !== current.revision + 1) { invalidate(event.agentId); return; }
      try {
        frames.value = { ...frames.value, [event.agentId]: { ...current, snapshot: current.replica.apply(event.payload.event), revision: event.payload.revision } };
      } catch { invalidate(event.agentId); }
    },
    reset() { frames.value = {}; pending.clear(); lastAttachedSessions.clear(); },
    recoverAll() { for (const id of Object.keys(frames.value)) invalidate(id); },
    reconcile(agents: Agent[]) {
      const agentsById = new Map(agents.map(agent => [agent.id, agent]));
      for (const id of lastAttachedSessions.keys()) {
        if (agentsById.get(id)?.backend !== 'antigravity') lastAttachedSessions.delete(id);
      }
      for (const agent of agents) {
        if (agent.backend === 'antigravity' && agent.backendSession?.kind === 'antigravity') lastAttachedSessions.set(agent.id, agent.backendSession.sessionId);
      }
      frames.value = Object.fromEntries(Object.entries(frames.value).filter(([id, frame]) => {
        const agent = agentsById.get(id);
        return agent && matchesAgent(agent, frame);
      }));
    },
  };
}
