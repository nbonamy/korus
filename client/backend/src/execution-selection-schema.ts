import * as z from 'zod/v4';
import type { ExecutionSelection } from '@workspace/core/contracts/execution';
import { harnessProviders } from '@korus-dev/multi-agent-sdk/contracts';

// Exhaustive keys keep RPC and tool validation in step with the application contract.
const fields = {
  provider: z.enum(harnessProviders),
  model: z.string().trim().min(1).max(200).nullable(),
  reasoningEffort: z.string().trim().min(1).max(40).nullable(),
  serviceTier: z.string().trim().min(1).max(200).nullable(),
} satisfies { [K in keyof ExecutionSelection]: z.ZodType<ExecutionSelection[K]> };
export const executionSelectionSchema = z.strictObject(fields);
export const executionSelectionOverridesSchema = executionSelectionSchema.partial();

export const executionSelectionRequestSchema = executionSelectionOverridesSchema.required({ provider: true });
