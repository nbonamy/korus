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
  constructor(private readonly hostId: string) {}
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
