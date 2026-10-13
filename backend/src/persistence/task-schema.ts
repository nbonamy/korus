import { MAX_DELEGATION_INSTRUCTIONS_LENGTH } from '@workspace/core/delegation-context';
import * as z from 'zod/v4';
import type { DelegatedTask, TaskContract, TaskResultInput } from '@workspace/core/delegated-task';

const text = z.string().trim().min(1);
export const taskContractSchema = z.strictObject({ title: text.max(200), doneWhen: text.max(4000) }) satisfies z.ZodType<TaskContract>;
export const taskResultSchema = z.strictObject({
  summary: text.max(4000),
  evidence: z.array(text.max(500)).max(10),
  artifacts: z.array(text.max(500)).max(10),
  caveats: z.array(text.max(500)).max(10),
}) satisfies z.ZodType<TaskResultInput>;
const session = z.discriminatedUnion('kind', [
  z.looseObject({ kind: z.literal('antigravity'), sessionId: text }),
  z.looseObject({ kind: z.literal('codex'), threadId: text }),
  z.looseObject({
    kind: z.literal('claude'), sessionId: text, transport: z.enum(['stdio', 'websocket']),
    transcriptSessionId: text.optional(), transcriptFolder: text.optional(), serverUrl: text.optional(), model: text.optional(),
    reasoningEffort: text.optional(),
  }),
]);
const acceptance = z.looseObject({ backendSession: session, turnId: text.optional() });
// Command inputs stay strict; stored records accept additive fields from newer builds.
const taskSchema = z.looseObject({
  id: text, requestId: text.max(200), requestFingerprint: text,
  parentAgentId: text, workerAgentId: text, backend: z.enum(['codex', 'claude', 'antigravity']),
  assignment: taskContractSchema.loose(), prompt: text.max(100000), attemptId: text,
  delegationUserInstructions: z.looseObject({ saved: z.string().max(MAX_DELEGATION_INSTRUCTIONS_LENGTH), taskSpecific: z.string().max(MAX_DELEGATION_INSTRUCTIONS_LENGTH).optional() }).optional(),
  workspace: z.looseObject({ repositoryPath: text, branchName: text.optional(), destinationPath: text.optional() }).optional(),
  state: z.enum(['preparing', 'running', 'needs-input', 'interrupted', 'failed', 'completed', 'cancelled']),
  createdAt: text, updatedAt: text, folder: text.optional(), acceptance: acceptance.optional(), executionTurnId: text.optional(),
  submission: taskResultSchema.loose().extend({ id: text, attemptId: text, turnId: text, backendSession: session }).optional(),
  delivery: z.looseObject({ id: text, state: z.enum(['pending', 'sending', 'accepted', 'uncertain']), acceptance: acceptance.optional() }).optional(),
  parentWakeBlocked: z.boolean(), parentStopRequested: z.boolean().optional(), detail: z.string().optional(),
}).superRefine((task, ctx) => {
  if (task.state === 'completed' && (!task.submission || !task.delivery)) ctx.addIssue({ code: 'custom', message: 'completed task requires a result and delivery' });
  if (task.delivery && task.state !== 'completed') ctx.addIssue({ code: 'custom', message: 'only completed results can be delivered' });
  if (task.delivery?.state === 'accepted' && !task.delivery.acceptance) ctx.addIssue({ code: 'custom', message: 'accepted delivery requires a provider receipt' });
  if ((task.acceptance && task.acceptance.backendSession.kind !== task.backend) || (task.submission && task.submission.backendSession.kind !== task.backend)) ctx.addIssue({ code: 'custom', message: 'worker provider mismatch' });
  if (task.submission && task.submission.attemptId !== task.attemptId) ctx.addIssue({ code: 'custom', message: 'result attempt mismatch' });
});
export const tasksSchema = z.looseObject({ tasks: z.array(taskSchema) }).superRefine(({ tasks }, ctx) => {
  for (const key of [(task: DelegatedTask) => task.id, (task: DelegatedTask) => task.workerAgentId, (task: DelegatedTask) => JSON.stringify([task.parentAgentId, task.requestId])]) {
    if (new Set(tasks.map(key)).size !== tasks.length) ctx.addIssue({ code: 'custom', message: 'duplicate task identity' });
  }
}) satisfies z.ZodType<{ tasks: DelegatedTask[] }>;
