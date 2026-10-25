import type { CodexChatMessage } from '@codex-app-sdk/vue';
import type { SurfaceMessage } from '@codex-app-sdk/core/surface';

type Message = CodexChatMessage | SurfaceMessage;
type Part = { type: string; phase?: string; text?: string; content?: string };

/**
 * Gives backends that do not tag work phases (Claude) the Working / Done grouping Codex has:
 * text followed by more tool work is commentary, text after the last tool is the final answer.
 */
export function withInferredWorkPhases<T extends Message>(message: T): T {
  const parts = message.parts as Part[] | undefined;
  if (message.role !== 'assistant' || !parts?.some(part => part.type === 'tool')) return message;
  if (parts.some(part => part.type === 'reasoning' || part.phase !== undefined)) return message;

  const lastToolIndex = parts.map(part => part.type).lastIndexOf('tool');
  const phased = parts.map((part, index) => {
    if (part.type !== 'text') return part;
    const hasText = (part.text ?? part.content ?? '').trim().length > 0;
    return { ...part, phase: index < lastToolIndex || !hasText ? 'commentary' : 'final_answer' };
  });
  return { ...message, parts: phased } as T;
}
