import type { Agent } from '@workspace/core/contracts';
import { agentConversationId } from '@workspace/core/plan-review';
import { createHash } from 'node:crypto';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { agentDisplayName } from '@workspace/core/agent-display';
import { companionTarget, type CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { CompanionNotification } from '@workspace/core/companion-notification';

/** Only live attention events create alerts. Snapshots and reconnects never replay them. */
export class CompanionNotifications {
  private readonly seen = new Set<string>();
  private readonly origins = new Map<string, { desktop: boolean; conversationId?: string; turnId?: string }>();
  constructor(private readonly hostId: string) {}
  /** Volatile attention policy, never provider conversation state. Unknown origins keep push available. */
  recordPrompt(agent: Agent, clientId: string): () => void {
    const previous = this.origins.get(agent.id);
    const entry = { desktop: clientId === 'desktop', conversationId: agentConversationId(agent) ?? undefined };
    this.origins.set(agent.id, entry);
    if (this.origins.size > 1024) this.origins.delete(this.origins.keys().next().value!);
    return () => { if (this.origins.get(agent.id) === entry) { if (previous) this.origins.set(agent.id, previous); else this.origins.delete(agent.id); } };
  }
  /** Capture origin at event time, before asynchronous workspace/focus reads or a newer prompt. */
  observe(event: AppBackendEvent): boolean {
    const view = providerConversationEventView(event);
    const entry = view.agentId && this.origins.get(view.agentId);
    if (!entry || !view.agentId) return false;
    const request = event.type === 'agentRequest.created' ? event.payload.request : undefined;
    const conversationId = request?.conversationId ?? view.conversationId;
    const turnId = request?.turnId ?? view.turnId;
    if (entry.conversationId && conversationId && entry.conversationId !== conversationId) return false;
    if (view.type === 'turn.started') {
      if (entry.turnId && entry.turnId !== turnId) { this.origins.delete(view.agentId); return false; }
      entry.turnId = turnId; entry.conversationId = conversationId;
    }
    if (entry.turnId && turnId && entry.turnId !== turnId) return false;
    if (view.type === 'turn.completed') this.origins.delete(view.agentId);
    return entry.desktop;
  }
  accepts(event: AppBackendEvent) {
    return event.type === 'agentRequest.created' || providerConversationEventView(event).type === 'turn.completed';
  }
  create(event: AppBackendEvent, workspace: CompanionWorkspace): CompanionNotification | null {
    const view = providerConversationEventView(event);
    const agent = workspace.agents.find(agent => agent.id === view.agentId);
    const team = workspace.teams.find(team => team.id === agent?.teamId);
    if (!agent || !team) return null;
    if (view.conversationId && view.conversationId !== agentConversationId(agent)) return null;
    let kind: CompanionNotification['kind']; let identity: string;
    if (event.type === 'agentRequest.created') {
      const request = event.payload.request;
      if (request.conversationId !== agentConversationId(agent)) return null;
      kind = request.kind === 'question' ? 'question' : 'approval';
      identity = `${request.conversationId}/${request.id}`;
    } else {
      const payload = view.payload as { status?: string; turn?: { id?: string; status?: string } };
      const turn = payload?.turn;
      if (view.type !== 'turn.completed' || (turn?.status ?? payload?.status) !== 'completed') return null;
      kind = 'completed'; identity = `${view.conversationId}/${view.turnId ?? turn?.id}`;
      if (!view.turnId && !turn?.id) return null;
    }
    const target = companionTarget(this.hostId, team, agent);
    const id = createHash('sha256').update(JSON.stringify([target, kind, identity])).digest('hex');
    if (this.seen.has(id)) return null;
    this.seen.add(id); if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value!);
    return { id, target, kind, name: agentDisplayName(agent).slice(0, 100), createdAt: Date.now() };
  }
}
