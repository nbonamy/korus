import type { ConversationMessage, Message } from '@korus-dev/multi-agent-sdk';

/** A message as Korus hands it to the conversation pane: the neutral model, without the agent that owns it. */
export type PaneMessage = Omit<Message, 'agentId' | 'createdAt'> & { createdAt?: string };

/**
 * Transitional: Codex's native messages as the neutral model, until the browser reads harness session state.
 * Mirrors the SDK's own conversion; neutral messages pass through unchanged.
 */
export function paneMessages(messages: readonly (ConversationMessage | Message | PaneMessage)[]): PaneMessage[] {
  return messages.map(message => ({
    ...message,
    ...(message.turnId === undefined && typeof metadataTurnId(message) === 'string' ? { turnId: metadataTurnId(message) } : {}),
    parts: message.parts.map(part => part.type === 'tool' ? { ...part, kind: part.kind ?? 'generic' } : part),
  }) as PaneMessage);
}

/** Codex sometimes records a message's turn only in its metadata. */
function metadataTurnId(message: ConversationMessage | Message | PaneMessage): unknown {
  return (message.metadata as Record<string, unknown> | undefined)?.turnId;
}
