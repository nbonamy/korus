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
  private readonly pending = new Map<string, { event: AppBackendEvent; desktopOrigin: boolean }>();
  private readonly read = new Map<string, number>();
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
  /** Pair attention with its authoritative read-state update before asynchronous workspace reads. */
  capture(event: AppBackendEvent): { event: AppBackendEvent; revision: number; desktopOrigin: boolean }[] {
    const desktopOrigin = this.observe(event);
    if (event.agentId && this.accepts(event)) {
      this.pending.set(event.agentId, { event, desktopOrigin });
      if (this.pending.size > 1024) this.pending.delete(this.pending.keys().next().value!);
      return [];
    }
    if (event.type !== 'agent.updated' || !event.agentId || !event.payload.readState) return [];
    const state = event.payload.readState;
    const pending = this.pending.get(event.agentId); this.pending.delete(event.agentId);
    const previous = this.read.get(event.agentId) ?? 0;
    this.read.set(event.agentId, state.readRevision);
    if (this.read.size > 1024) this.read.delete(this.read.keys().next().value!);
    return [
      ...(pending ? [{ ...pending, revision: state.revision }] : []),
      ...(state.readRevision > previous ? [{ event, revision: state.readRevision, desktopOrigin: false }] : []),
    ];
  }
  accepts(event: AppBackendEvent) {
    return event.type === 'agentRequest.created' || providerConversationEventView(event).type === 'turn.completed';
  }
  create(event: AppBackendEvent, workspace: CompanionWorkspace, revision?: number): CompanionNotification | null {
    const view = providerConversationEventView(event);
    const agent = workspace.agents.find(agent => agent.id === view.agentId);
    const team = workspace.teams.find(team => team.id === agent?.teamId);
    if (!agent || !team) return null;
    if (view.conversationId && view.conversationId !== agentConversationId(agent)) return null;
    let kind: CompanionNotification['kind']; let identity: string;
    if (event.type === 'agent.updated' && revision !== undefined) {
      kind = 'read'; identity = `read/${revision}`;
    } else if (event.type === 'agentRequest.created') {
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
    if (kind !== 'read' && revision !== undefined && revision <= (agent.readState?.readRevision ?? -1)) return null;
    const target = companionTarget(this.hostId, team, agent);
    const id = createHash('sha256').update(JSON.stringify([target, kind, identity])).digest('hex');
    if (this.seen.has(id)) return null;
    this.seen.add(id); if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value!);
    return { id, target, kind, ...(revision === undefined ? {} : { revision }), name: agentDisplayName(agent).slice(0, 100), createdAt: Date.now() };
  }
}
