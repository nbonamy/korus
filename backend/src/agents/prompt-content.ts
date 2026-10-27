import { normalizePromptContent, promptContentDispatchText, type CodexPromptPart } from '@codex-app-sdk/core/surface';

/** Stable targets selected by the person, independent of current catalogs. */
export function promptWithSelectedReferences(prompt: string, content: readonly CodexPromptPart[] | undefined, nativeMentions = false): string {
  if (content === undefined) return prompt;
  const parts = normalizePromptContent(content);
  const dispatched = promptContentDispatchText(parts, prompt);
  const references = parts.filter(part => part.type === 'mention' && (!nativeMentions || part.kind === 'custom'));
  if (!references.length) return dispatched;
  const data = JSON.stringify(references).replace(/</g, '\\u003c');
  return `${dispatched}\n\n<context>\nExplicitly selected references (use these stable targets):\n${data}\nLoad and follow selected skills by canonical name or path. References in the agents group identify teammates by stable id.\n</context>`;
}
