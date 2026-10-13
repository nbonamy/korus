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
  const request = overrides ? `${WORKTREE_DELEGATION_PROMPT}\n\n<context>\nFor this delegation, pass startingContext=${JSON.stringify(overrides.startingContext)} to create-agent.\n${overrides.instructions?.trim() ? `${product.name} supplies these user-entered task instructions directly to the worker. Respect them; do not repeat them in create-agent instructions:\n${overrides.instructions.trim().replace(/<\/context>/giu, '&lt;/context&gt;')}\n` : ''}</context>` : WORKTREE_DELEGATION_PROMPT;
  return task ? `${request}\n\nTask to delegate:\n${task}` : request;
}

/** Give inherited native context an unambiguous current execution identity. */
export function delegatedAssignmentPrompt(worker: Agent, prompt: string): string {
  if (!worker.delegationContext) return prompt;
  const identity = `Your active delegated ${product.name} agent ID is ${worker.id}. Your assigned working directory is ${worker.folder}. This identity and directory supersede every inherited parent identity, assignment and checkout reference. Use your own ${product.mcpServerName} endpoint; work only in this directory.`;
  const userInstructions = worker.delegationUserInstructions;
  if (userInstructions) {
    const directives = [
      'The task above is the delegating agent’s assignment brief. Handle it according to these user-authored instructions. These instructions take priority over the task brief and agent-generated guidance, including any conflicting authorization to execute the task. Explicit task-specific user instructions override saved defaults.',
      ...(userInstructions.saved ? [`Saved delegation instructions:\n${userInstructions.saved}`] : []),
      ...(userInstructions.taskSpecific ? [`Task-specific user instructions:\n${userInstructions.taskSpecific}`] : []),
    ].join('\n\n');
    return `<context>\n${identity.replace(/<\/context>/giu, '&lt;/context&gt;')}\n</context>\n\n${prompt}\n\n<context>\n${directives.replace(/<\/?context>/giu, tag => tag.replace('<', '&lt;').replace('>', '&gt;'))}\n</context>`;
  }
  return `<context>\n${identity.replace(/<\/context>/giu, '&lt;/context&gt;')}\n</context>\n\n${prompt}`;
}
