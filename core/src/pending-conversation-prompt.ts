/** Process-local presentation until a dispatched prompt reaches the provider transcript. */
export type PendingConversationPrompt = { id: string; text: string; createdAt: string; steering?: boolean };

export function isPendingConversationPrompt(value: unknown): value is PendingConversationPrompt {
  if (typeof value !== 'object' || value === null) return false;
  const pending = value as Record<string, unknown>;
  return typeof pending.id === 'string' && Boolean(pending.id.trim())
    && typeof pending.text === 'string' && Boolean(pending.text.trim())
    && typeof pending.createdAt === 'string' && Number.isFinite(Date.parse(pending.createdAt))
    && (pending.steering === undefined || typeof pending.steering === 'boolean');
}
