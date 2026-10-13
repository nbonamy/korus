import { product } from '@workspace/core/product';
const delegationInstructions = [
  'Load korus-delegation through read-skill and delegate the specified task, or the work just agreed in this conversation.',
  `The user requests a new ${product.name} co-agent in a dedicated worktree. Preserve the agreed task and its authority: implementation approval must not be invented for investigation or discussion. Keep commits local; no push or merge is authorized.`,
].join(' ');

export const WORKTREE_DELEGATION_PROMPT = `Delegate this task to a new agent in a dedicated worktree.\n\n<context>\n${delegationInstructions}\n</context>`;

export function expandWorktreeDelegationCommand(prompt: string): string | null {
  const match = /^\/(?:delegate|worktree)(?:\s+([\s\S]*))?$/.exec(prompt.trim());
  if (!match) return null;
  const task = match[1]?.trim();
  return task ? `${WORKTREE_DELEGATION_PROMPT}\n\nTask to delegate:\n${task}` : WORKTREE_DELEGATION_PROMPT;
}
