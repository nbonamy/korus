import type { Agent } from '@workspace/core/contracts';
import type { DelegationOverrides } from '@workspace/core/delegation-context';
import { isDelegationOverrides } from '@workspace/core/delegation-context';
import { product } from '@workspace/core/product';
const delegationInstructions = [
  'Load korus-delegation through read-skill and delegate the specified task, or the work just agreed in this conversation.',
  `The user requests a new ${product.name} co-agent in a dedicated worktree. Preserve the agreed task and its authority: implementation approval must not be invented for investigation or discussion. Keep commits local; no push or merge is authorized.`,
].join(' ');

export const WORKTREE_DELEGATION_PROMPT = `Delegate this task to a new agent in a dedicated worktree.\n\n<context>\n${delegationInstructions}\n</context>`;

export function expandWorktreeDelegationCommand(prompt: string, overrides?: DelegationOverrides): string | null {
  const match = /^\/(?:delegate|worktree)(?:\s+([\s\S]*))?$/.exec(prompt.trim());
  if (!match) return null;
  if (overrides && !isDelegationOverrides(overrides)) throw new Error('Invalid worktree delegation overrides.');
  const task = match[1]?.trim();
  const request = overrides ? `${WORKTREE_DELEGATION_PROMPT}\n\n<context>\nFor this delegation, pass startingContext=${JSON.stringify(overrides.startingContext)} to create-agent.\n${overrides.instructions?.trim() ? `Pass these task-specific instructions in its instructions field (in addition to the assignment brief):\n${overrides.instructions.trim().replace(/<\/context>/giu, '&lt;/context&gt;')}\n` : ''}</context>` : WORKTREE_DELEGATION_PROMPT;
  return task ? `${request}\n\nTask to delegate:\n${task}` : request;
}

/** Give inherited native context an unambiguous current execution identity. */
export function delegatedAssignmentPrompt(worker: Agent, prompt: string): string {
  if (!worker.delegationContext) return prompt;
  const identity = `Your active delegated ${product.name} agent ID is ${worker.id}. Your assigned working directory is ${worker.folder}. This identity and directory supersede every inherited parent identity, assignment and checkout reference. Use your own ${product.mcpServerName} endpoint; work only in this directory.`;
  return `<context>\n${identity.replace(/<\/context>/giu, '&lt;/context&gt;')}\n</context>\n\n${prompt}`;
}
