import { shallowRef } from 'vue';
import { applySessionPatch, type SessionSnapshot } from '@korus-dev/multi-agent-sdk/contracts';
import type { SessionState } from '@korus-dev/multi-agent-sdk';
import type { Agent, MainToRendererEvent } from '@workspace/core/contracts';

type Event = Extract<MainToRendererEvent, { type: 'conversation.sessionSnapshot' | 'conversation.sessionPatch' }>;
type Frame = { conversation: string | null; epoch: string; snapshot: SessionSnapshot; awaitingRecovery: boolean };

const conversationOf = (agent: Agent): string | null => {
  const session = agent.providerSession;
  return !session ? null : session.kind === 'codex' ? session.threadId : session.sessionId;
};

/**
 * Every agent's conversation as the harness reports it: a snapshot, then patches applied in revision order within one stream.
 * A missed revision, an invalid patch or a patch from another stream keeps the last state visible and reloads the
 * conversation, which sends a fresh snapshot.
 */
export function createSessionConversationState(recover: (agentId: string) => Promise<unknown>) {
  const frames = shallowRef<Record<string, Frame>>({});
  const pending = new Set<string>();
  const lastAttached = new Map<string, string>();
  function matches(agent: Agent, frame: Frame): boolean {
    const conversation = conversationOf(agent);
    if (conversation) return frame.conversation === null || frame.conversation === conversation;
    // A new conversation can report before the agent is attached to it; a detached one cannot.
    return frame.conversation === null || frame.conversation !== lastAttached.get(agent.id);
  }
  function invalidate(agentId: string) {
    const frame = frames.value[agentId];
    if (frame && !frame.awaitingRecovery) frames.value = { ...frames.value, [agentId]: { ...frame, awaitingRecovery: true } };
    if (pending.has(agentId)) return;
    pending.add(agentId);
    void recover(agentId).catch(() => {}).finally(() => pending.delete(agentId));
  }
  return {
    select(agent: Agent): SessionState | null {
      const frame = frames.value[agent.id];
      return frame && matches(agent, frame) ? frame.snapshot.state : null;
    },
    planModeOf(agentId: string): boolean | undefined { return frames.value[agentId]?.snapshot.state.planMode; },
    needsHistory(agent: Agent): boolean {
      const frame = frames.value[agent.id];
      return !frame || !matches(agent, frame) || frame.awaitingRecovery;
    },
    /** Applies the event and returns the state it produced, or undefined when it changed nothing. */
    receive(event: Event): SessionState | undefined {
      const { conversation, epoch } = event.payload;
      const current = frames.value[event.agentId];
      const sameStream = current !== undefined && current.epoch === epoch && current.conversation === conversation;
      if (event.type === 'conversation.sessionSnapshot') {
        // A snapshot older than the state of its own stream arrived late; a new stream starts over at any revision.
        if (sameStream && !current.awaitingRecovery && event.payload.snapshot.revision < current.snapshot.revision) return;
        frames.value = { ...frames.value, [event.agentId]: { conversation, epoch, snapshot: event.payload.snapshot, awaitingRecovery: false } };
        return event.payload.snapshot.state;
      }
      if (sameStream && !current.awaitingRecovery && event.payload.patch.revision <= current.snapshot.revision) return;
      if (!sameStream || current.awaitingRecovery) { invalidate(event.agentId); return; }
      try {
        const snapshot = applySessionPatch(current.snapshot, event.payload.patch);
        frames.value = { ...frames.value, [event.agentId]: { ...current, snapshot } };
        return snapshot.state;
      } catch { invalidate(event.agentId); }
    },
    discard(agentId: string) { const next = { ...frames.value }; delete next[agentId]; frames.value = next; },
    reset() { frames.value = {}; pending.clear(); lastAttached.clear(); },
    recoverAll() { for (const id of Object.keys(frames.value)) invalidate(id); },
    reconcile(agents: Agent[]) {
      const agentsById = new Map(agents.map(agent => [agent.id, agent]));
      for (const id of lastAttached.keys()) if (!agentsById.has(id)) lastAttached.delete(id);
      for (const agent of agents) { const conversation = conversationOf(agent); if (conversation) lastAttached.set(agent.id, conversation); }
      frames.value = Object.fromEntries(Object.entries(frames.value).filter(([id, frame]) => {
        const agent = agentsById.get(id);
        return agent && matches(agent, frame);
      }));
    },
  };
}
