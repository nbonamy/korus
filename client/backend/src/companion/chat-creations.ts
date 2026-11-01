import { randomUUID } from 'node:crypto';
import type { CompanionChatCreation } from '@workspace/core/companion-protocol';

/**
 * A new chat can take minutes (worktree setup), far longer than a relay request may stay open:
 * the phone starts it, then asks how it is going. Only the device that started a creation may ask.
 */
export class ChatCreations {
  private readonly creations = new Map<string, { peerId: string; result: CompanionChatCreation }>();
  constructor(private readonly limit = 20) {}
  start(peerId: string, run: () => Promise<string>): string {
    const id = randomUUID();
    const running = [...this.creations.values()].filter((creation) => creation.peerId === peerId && creation.result.state === 'running').length;
    if (running >= 3) throw new Error('Too many chats are being created.');
    // Oldest first: finished ones go before the room runs out.
    while (this.creations.size >= this.limit) this.creations.delete(this.creations.keys().next().value!);
    const creation = { peerId, result: { state: 'running' } as CompanionChatCreation };
    this.creations.set(id, creation);
    run().then(
      (agentId) => { creation.result = { state: 'success', agentId }; },
      (error: unknown) => { creation.result = { state: 'error', error: error instanceof Error ? error.message : String(error) }; },
    );
    return id;
  }
  status(peerId: string, id: string): CompanionChatCreation {
    const creation = this.creations.get(id);
    if (!creation || creation.peerId !== peerId) throw new Error('Chat creation not found.');
    return creation.result;
  }
}
