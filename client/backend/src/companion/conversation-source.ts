import { CompanionJournal, type CompanionCheckpoint, type CompanionConversationSync } from '@workspace/core/companion-journal';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { followCompanionConversation, isCompanionConversationFrame, type CompanionConversation } from '@workspace/core/companion-protocol';

const maxConversations = 64;

/**
 * The authoritative conversation for each agent, as neutral session state: the last snapshot the daemon published with
 * every patch since applied to it. Only a broken stream, or a conversation it no longer holds, asks the provider again,
 * whose load publishes a fresh snapshot.
 */
export class ConversationSource {
  private readonly journal = new CompanionJournal();
  private readonly conversations = new Map<string, CompanionConversation>();

  constructor(private readonly load: (agentId: string) => Promise<void>) {}

  observe(event: AppBackendEvent): void {
    if (event.type === 'conversation.historyLoadFailed') { this.forget(event.agentId); return; }
    if (event.type === 'snapshot.updated') {
      const agents = new Set(event.payload.agents.map(agent => agent.id));
      for (const id of this.conversations.keys()) if (!agents.has(id)) this.forget(id);
      return;
    }
    if (!isCompanionConversationFrame(event)) return;
    this.journal.observe(event);
    const next = followCompanionConversation(this.conversations.get(event.agentId) ?? null, event);
    this.conversations.delete(event.agentId);
    if (!next) return;
    this.conversations.set(event.agentId, next);
    while (this.conversations.size > maxConversations) this.forget(this.conversations.keys().next().value!);
  }

  clear(): void { this.conversations.clear(); this.journal.clear(); }

  private forget(agentId: string): void { this.conversations.delete(agentId); this.journal.forget(agentId); }

  async synchronize(agentId: string, since: CompanionCheckpoint | null): Promise<CompanionConversationSync> {
    const resumed = since && this.journal.resume(agentId, since);
    if (resumed) return resumed;
    const conversation = await this.read(agentId);
    // A conversation held longer than the journal's window starts a new continuity domain from itself.
    if (!this.journal.checkpoint(agentId)) this.journal.observe(conversation);
    const head = this.journal.checkpoint(agentId);
    if (!head) throw new Error('Conversation checkpoint unavailable.');
    const checkpoint = { epoch: head.epoch, revision: conversation.payload.snapshot.revision };
    const tail = this.journal.resume(agentId, checkpoint);
    return { checkpoint: tail?.checkpoint ?? checkpoint, frames: [conversation, ...tail?.frames ?? []] };
  }

  async read(agentId: string): Promise<CompanionConversation> {
    const current = this.conversations.get(agentId);
    if (current) return current;
    // A shared hydration may already have published its snapshot while still saving.
    // Retain that snapshot; a failed hydration invalidates it through its event.
    await this.load(agentId);
    const loaded = this.conversations.get(agentId);
    if (!loaded) throw new Error('Authoritative conversation is unavailable.');
    return loaded;
  }
}
