import { agentConversationId } from '@workspace/core/plan-review';
import { createHash } from 'node:crypto';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { agentDisplayName } from '@workspace/core/agent-display';
import { companionAgents, companionTarget, type CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { CompanionNotification } from '@workspace/core/companion-notification';

/** A turn that finished on its own, as the agent's session stream reports it. */
export type TurnCompletion = { type: 'turn.completed'; agentId: string; conversationId?: string; turnId: string; payload: { status: 'completed' } };
type AttentionEvent = AppBackendEvent | TurnCompletion;
type Followed = { conversation: string | null; epoch: string; statuses: Map<string, string> };

/** Only live attention events create alerts. Snapshots and reconnects never replay them. */
export class CompanionNotifications {
  private readonly pending = new Map<string, { event: AttentionEvent }>();
  /** Each agent's turn statuses as its session stream last reported them, so a finished turn is seen once. */
  private readonly followed = new Map<string, Followed>();
  private readonly revisions = new Map<string, number>();
  private readonly read = new Map<string, number>();
  private readonly seen = new Set<string>();
  constructor(private readonly hostId: string) {}
  /** Pair attention with its authoritative read-state update before asynchronous workspace reads. */
  capture(event: AppBackendEvent): { event: AttentionEvent; revision?: number }[] {
    // The read-state update a finished turn causes is published before the session state reports the turn, so
    // the completion pairs with the latest read revision instead of waiting for one.
    if (event.type === 'conversation.sessionSnapshot' || event.type === 'conversation.sessionPatch') {
      return this.completions(event).map(completion => {
        const revision = this.revisions.get(completion.agentId);
        return revision === undefined ? { event: completion } : { event: completion, revision };
      });
    }
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
    this.revisions.set(event.agentId, state.revision);
    if (this.revisions.size > 1024) this.revisions.delete(this.revisions.keys().next().value!);
    if (this.read.size > 1024) this.read.delete(this.read.keys().next().value!);
    return [
      ...(pending ? [{ ...pending, revision: state.revision }] : []),
      ...(state.readRevision > previous ? [{ event, revision: state.readRevision }] : []),
    ];
  }
  accepts(event: AttentionEvent) {
    if (event.type === 'agentRequest.created') {
      const request = event.payload.request;
      return request.kind !== 'question' || request.question.blocking;
    }
    return event.type === 'turn.completed';
  }
  /** Turns a patch moves to completed. A snapshot, or a stream the agent did not report before, only sets the baseline. */
  private completions(event: Extract<AppBackendEvent, { type: 'conversation.sessionSnapshot' | 'conversation.sessionPatch' }>): TurnCompletion[] {
    const { conversation, epoch } = event.payload;
    const previous = this.followed.get(event.agentId);
    const turns = event.type === 'conversation.sessionSnapshot' ? event.payload.snapshot.state.turns
      : event.payload.patch.ops.flatMap(op => op.op === 'set' && op.key === 'turns' && Array.isArray(op.value) ? [op.value as { id: string; status: string }[]] : []).at(-1);
    const sameStream = previous && previous.conversation === conversation && previous.epoch === epoch;
    if (!turns) { if (!sameStream) this.followed.delete(event.agentId); return []; }
    const statuses = new Map(turns.map(turn => [turn.id, turn.status]));
    this.followed.set(event.agentId, { conversation, epoch, statuses });
    if (this.followed.size > 1024) this.followed.delete(this.followed.keys().next().value!);
    if (event.type === 'conversation.sessionSnapshot' || !sameStream) return [];
    return turns.filter(turn => turn.status === 'completed' && previous.statuses.get(turn.id) !== 'completed').map(turn => ({
      type: 'turn.completed', agentId: event.agentId, ...(conversation ? { conversationId: conversation } : {}), turnId: turn.id, payload: { status: 'completed' },
    }));
  }
  create(event: AttentionEvent, workspace: CompanionWorkspace, revision?: number): CompanionNotification | null {
    const view = event.type === 'turn.completed' ? event : providerConversationEventView(event);
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
