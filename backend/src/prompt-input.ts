import type { Agent, SendPromptOptions } from '@workspace/core/contracts';
import { companionSessionId } from '@workspace/core/companion-protocol';
import { PromptRejectedError } from './agents/prompt-rejected';

/** An absent expectation preserves ordinary desktop prompt behavior; null names a new session. */
export function requireExpectedSessionId(record: Record<string, unknown>): string | null | undefined {
  const value = record.expectedSessionId;
  if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 500)) throw new PromptRejectedError('Invalid expected session.');
  return value as string | null | undefined;
}

export function assertPromptSession(agent: Agent, expectedSessionId: string | null | undefined): void {
  if (expectedSessionId !== undefined && companionSessionId(agent) !== expectedSessionId) throw new PromptRejectedError('Conversation target is stale.');
}

/** An image or file can be the entire prompt; other string-valued RPC fields still require text. */
export function requirePromptText(value: unknown, options?: SendPromptOptions): string {
  if (typeof value !== 'string' || (!value.trim() && !options?.attachments?.length)) throw new Error('Invalid prompt.');
  return value;
}
