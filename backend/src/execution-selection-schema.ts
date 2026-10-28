import * as z from 'zod/v4';
import type { ExecutionSelection } from '@workspace/core/contracts/execution';

// Exhaustive keys keep RPC and tool validation in step with the application contract.
const fields = {
  backend: z.enum(['codex', 'claude', 'antigravity']),
  model: z.string().trim().min(1).max(200).nullable(),
  reasoningEffort: z.string().trim().min(1).max(40).nullable(),
  serviceTier: z.string().trim().min(1).max(200).nullable(),
} satisfies { [K in keyof ExecutionSelection]: z.ZodType<ExecutionSelection[K]> };
export const executionSelectionSchema = z.strictObject(fields);
export const executionSelectionOverridesSchema = executionSelectionSchema.partial();

export const executionSelectionRequestSchema = executionSelectionOverridesSchema.required({ backend: true });
