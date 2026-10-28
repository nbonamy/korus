import { agentConversationId } from '@workspace/core/plan-review';
import { createHash } from 'node:crypto';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { agentDisplayName } from '@workspace/core/agent-display';
import { companionAgents, companionTarget, type CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { CompanionNotification } from '@workspace/core/companion-notification';

/** Only live attention events create alerts. Snapshots and reconnects never replay them. */
export class CompanionNotifications {
  private readonly pending = new Map<string, { event: AppBackendEvent }>();
  private readonly read = new Map<string, number>();
  private readonly seen = new Set<string>();
  constructor(private readonly hostId: string) {}
  /** Pair attention with its authoritative read-state update before asynchronous workspace reads. */
  capture(event: AppBackendEvent): { event: AppBackendEvent; revision: number }[] {
    if (event.agentId && this.accepts(event)) {
      this.pending.set(event.agentId, { event });
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
      ...(state.readRevision > previous ? [{ event, revision: state.readRevision }] : []),
    ];
  }
  accepts(event: AppBackendEvent) {
    if (event.type === 'agentRequest.created') {
      const request = event.payload.request;
      return request.kind !== 'question' || request.question.blocking;
    }
    return providerConversationEventView(event).type === 'turn.completed';
  }
  create(event: AppBackendEvent, workspace: CompanionWorkspace, revision?: number): CompanionNotification | null {
    const view = providerConversationEventView(event);
    // Mission workers are not in the team's agent list, but a person still has to answer them.
    const agent = companionAgents(workspace).find(agent => agent.id === view.agentId);
    const team = workspace.teams.find(team => team.id === agent?.teamId);
    if (!agent || !team) return null;
    if (view.conversationId && view.conversationId !== agentConversationId(agent)) return null;
    let kind: CompanionNotification['kind']; let identity: string;
    if (event.type === 'agent.updated' && revision !== undefined) {
      kind = 'read'; identity = `read/${revision}`;
    } else if (event.type === 'agentRequest.created') {
      if (!this.accepts(event)) return null;
      const request = event.payload.request;
      if (request.conversationId !== agentConversationId(agent)) return null;
      kind = request.kind === 'question' ? 'question' : 'approval';
      identity = `${request.conversationId}/${request.id}`;
    } else {
      const payload = view.payload as { status?: string; turn?: { id?: string; status?: string } };
      const turn = payload?.turn;
      if (view.type !== 'turn.completed' || (turn?.status ?? payload?.status) !== 'completed') return null;
      // A mission runs on its own: only a request for input is worth a push, never a finished turn.
      if (agent && missionAgentIds(workspace).has(agent.id)) return null;
      kind = 'completed'; identity = `${view.conversationId}/${view.turnId ?? turn?.id}`;
      if (!view.turnId && !turn?.id) return null;
    }
    if (kind !== 'read' && revision !== undefined && revision <= (agent.readState?.readRevision ?? -1)) return null;
    const target = companionTarget(this.hostId, team, agent);
    const id = createHash('sha256').update(JSON.stringify([target, kind, identity])).digest('hex');
    if (this.seen.has(id)) return null;
    this.seen.add(id); if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value!);
    const label = agentDisplayName(agent);
    const name = !agent.name?.trim() && agent.sessionKind !== 'quickChat' && agent.workspace?.kind === 'git'
      ? `${agent.workspace.repositoryName} - ${agent.workspace.branch ?? label}` : label;
    return { id, target, kind, ...(revision === undefined ? {} : { revision }), name: name.slice(0, 100), createdAt: Date.now() };
  }
}

/** Every mission lead and repository worker retains the mission's input-only alert policy. */
function missionAgentIds(workspace: CompanionWorkspace): Set<string> {
  const ids = new Set((workspace.missionAgents ?? []).map(agent => agent.id));
  for (const mission of workspace.missionProgress ?? []) {
    if (mission.leadAgentId) ids.add(mission.leadAgentId);
    for (const ticket of mission.tickets) if (ticket.agentId) ids.add(ticket.agentId);
  }
  return ids;
}
