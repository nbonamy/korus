type Message = { role?: string; kind?: string; parts?: readonly Part[] };
type Part = { type: string; phase?: string; text?: string; content?: string };

/**
 * Gives backends that do not tag work phases (Claude) the Working / Done grouping Codex has:
 * text followed by more tool work is commentary, text after the last tool is the final answer.
 */
export function withInferredWorkPhases<T extends Message>(message: T): T {
  const parts = message.parts as Part[] | undefined;
  if (message.role !== 'assistant' || !parts?.some(part => part.type === 'tool')) return message;
  if (parts.some(part => part.type === 'reasoning' || part.phase !== undefined)) return message;

  return withInferredTurnWorkPhases([message])[0]!;
}

/** Classify unphased historical text using the whole turn, including continuation inputs. */
export function withInferredTurnWorkPhases<T extends Message>(messages: T[]): T[] {
  let position = 0; let lastWork = -1;
  for (const message of messages) {
    if (message.kind === 'steer') lastWork = position++;
    for (const part of message.parts ?? []) {
      if (message.role === 'assistant' && (part.type === 'tool' || part.type === 'reasoning')) lastWork = position;
      position++;
    }
  }
  if (lastWork < 0) return messages;
  position = 0;
  return messages.map(message => {
    if (message.kind === 'steer') position++;
    const parts = message.parts?.map(part => {
      const index = position++;
      if (message.role !== 'assistant' || part.type !== 'text' || part.phase !== undefined) return part;
      const hasText = (part.text ?? part.content ?? '').trim().length > 0;
      return { ...part, phase: index < lastWork || !hasText ? 'commentary' : 'final_answer' };
    });
    return message.role === 'assistant' && parts ? { ...message, parts } as T : message;
  });
}
