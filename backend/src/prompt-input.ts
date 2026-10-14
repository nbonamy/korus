import type { SendPromptOptions } from '@workspace/core/contracts';

/** An image or file can be the entire prompt; other string-valued RPC fields still require text. */
export function requirePromptText(value: unknown, options?: SendPromptOptions): string {
  if (typeof value !== 'string' || (!value.trim() && !options?.attachments?.length)) throw new Error('Invalid prompt.');
  return value;
}
