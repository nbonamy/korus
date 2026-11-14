import { normalizePromptContent, promptContentDispatchText } from '@korus-dev/multi-agent-sdk/prompt';
import { type PromptPart } from '@korus-dev/multi-agent-sdk';
import { computerUsePluginId } from '@workspace/core/app-plugins';
import { product } from '@workspace/core/product';

/** Stable targets selected by the person, independent of current catalogs. */
export function promptWithSelectedReferences(prompt: string, content: readonly PromptPart[] | undefined, nativeMentions = false): string {
  if (content === undefined) return prompt;
  const parts = normalizePromptContent(content);
  const dispatched = promptContentDispatchText(parts, prompt);
  // Korus's own plugins are never native, so they always travel as a reference.
  const references = parts.filter(part => part.type === 'mention' && (!nativeMentions || part.kind === 'custom' || (part.kind === 'plugin' && part.id === computerUsePluginId)));
  if (!references.length) return dispatched;
  const data = JSON.stringify(references).replace(/</g, '\\u003c');
  const computerUse = references.some(part => part.type === 'mention' && part.kind === 'plugin' && part.id === computerUsePluginId)
    ? `\nThe Computer Use reference asks for macOS GUI automation in this turn: load korus-computer-use and use only ${product.mcpServerName} Computer Use tools.`
    : '';
  return `${dispatched}\n\n<context>\nExplicitly selected references (use these stable targets):\n${data}\nLoad and follow selected skills by canonical name or path. References with an agent: value identify teammates by stable id.${computerUse}\n</context>`;
}
