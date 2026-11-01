import { product } from '@workspace/core/product';
import * as z from 'zod/v4';
import { executionSelectionOverridesSchema } from '../execution-selection-schema';
import { taskContractSchema } from '../persistence/task-schema';

const shared = {
  featureLabel: z.string().trim().min(1).max(120).optional().describe('Initial display label saved in the team roster. Requires createWorktree and branchName. An existing saved label is preserved; users can rename it without renaming Git branches.'),
  selection: executionSelectionOverridesSchema.optional().describe('Execution overrides. Same-provider work inherits the caller; a different provider uses its own defaults. Null selects the provider default, including Standard tier.'),
  branchName: z.string().optional().describe('Shared branch name for all target worktrees. Required when createWorktree is true.'),
  createWorktree: z.boolean().optional().describe('If true, create a new worktree for every target before creating its agent.'),
  startingContext: z.enum(['conversation', 'handoff']).optional().describe('Worktree delegation override: continue the native conversation or start fresh with a handoff. Defaults to saved preferences; unsupported/cross-provider continuation falls back visibly.'),
  planMode: z.boolean().optional().describe('Enable only when explicitly requested by the user. Starts the first prompt in provider Plan mode and waits for user approval before implementation. Defaults to false; cannot be combined with goal. Requires prompt and a Plan-capable backend.'),
  goal: z.boolean().optional().describe('Enable only when explicitly requested by the user. Runs the assignment as a native goal instead of a regular prompt. Defaults to false; cannot be combined with planMode. Requires prompt and a goal-capable backend (Codex or Claude). Claude limits the complete objective, including assignment context, to 4,000 characters.'),
  instructions: z.string().optional().describe(`Assignment guidance and missing context; requires prompt. Applied to forks and handoffs. Saved user instructions take priority; ${product.name} supplies explicit per-task user overrides separately. No secrets.`),
};

const target = z.strictObject({
  ...shared,
  requestId: z.string().trim().min(1).max(200).optional().describe('Required in task mode. Reuse the same stable ID when retrying this target.'),
  task: taskContractSchema.optional().describe('Saved assignment contract. Requires prompt and requestId; returns taskId for wait-tasks.'),
  name: z.string().optional().describe('Optional custom name. When omitted, the agent displays its branch or folder name.'),
  remoteConnectionId: z.string().trim().min(1).optional().describe('Host ID from list-hosts. Omit to create on your current host. Repository paths refer to the selected host.'),
  repoPath: z.string().trim().min(1).describe('Repository or worktree folder on the target host.'),
  destinationPath: z.string().optional().describe('Optional destination path for the new worktree.'),
  prompt: z.string().optional().describe('Concise visible request. Omit to create an idle agent.'),
}).omit({ branchName: true, createWorktree: true, featureLabel: true });

export const createAgentInputSchema = z.strictObject({
  ...shared,
  ...target.shape,
  repoPath: z.string().optional().describe('Compatibility input for a scalar request; prefer targets[].repoPath.'),
  targets: z.array(target).min(1).max(100).optional().describe('One entry per agent. Use a one-element array for a single repository. Results retain input order. A failure with agentId means the worker already exists; recover it instead of creating another.'),
}).superRefine((input, ctx) => {
  if (input.featureLabel && (!input.createWorktree || !input.branchName?.trim())) ctx.addIssue({ code: 'custom', path: ['featureLabel'], message: 'featureLabel requires createWorktree and branchName' });
  if (!input.targets) {
    if (input.repoPath === undefined) ctx.addIssue({ code: 'custom', path: ['targets'], message: 'targets is required' });
    return;
  }
  for (const field of ['repoPath', 'remoteConnectionId', 'destinationPath', 'name', 'prompt', 'task', 'requestId'] as const) {
    if (input[field] !== undefined) ctx.addIssue({ code: 'custom', path: [field], message: `${field} belongs inside each target` });
  }
  if (input.createWorktree && !input.branchName?.trim()) ctx.addIssue({ code: 'custom', path: ['branchName'], message: 'branchName is required when createWorktree is true' });
  const identities = new Set<string>();
  const requests = new Set<string>();
  input.targets.forEach((target, index) => {
    const issue = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: ['targets', index, field], message });
    const identity = JSON.stringify([target.remoteConnectionId ?? '', target.repoPath]);
    if (identities.has(identity)) issue('repoPath', 'Duplicate repository target on the same host');
    identities.add(identity);
    const planMode = target.planMode ?? input.planMode;
    const goal = target.goal ?? input.goal;
    if (planMode && goal) issue('planMode', 'planMode and goal cannot be enabled together');
    if ((planMode || goal || target.task || (target.instructions ?? input.instructions)?.trim()) && !target.prompt?.trim()) issue('prompt', 'prompt is required for modes, instructions or a task');
    if (target.task && !target.requestId) issue('requestId', 'requestId is required with task');
    if (target.task && target.requestId) {
      if (requests.has(target.requestId)) issue('requestId', 'Each task requires a distinct requestId');
      requests.add(target.requestId);
    }
  });
});
