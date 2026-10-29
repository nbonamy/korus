import { executionSelectionOverridesSchema } from '../execution-selection-schema';
import * as z from 'zod/v4';
import type { AppSnapshot } from '@workspace/core/contracts';
import type { AutomaticReviewStartInput } from '../review/code-review-service';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';
import { findingPrioritySchema } from './finding-tool-schemas';

export type StartAutomaticReview = (agentId: string, input: AutomaticReviewStartInput) => Promise<{
  success: true;
  reviewId: string;
  reviewerAgentId: string;
}>;

export function createAutomaticReviewToolModuleProvider(options: {
  snapshot: AppSnapshot;
  start: StartAutomaticReview;
}): AppMcpToolModuleProvider {
  return {
    id: 'automatic-review',
    resolve: ({ agentId }) => {
      const agent = options.snapshot.agents.find(candidate => candidate.id === agentId);
      if (!agent?.folder || agent.sessionKind === 'quickChat' || agent.codeReview) return undefined;
      return {
        id: 'automatic-review',
        register: server => {
          server.registerTool('start_automatic_review', {
            description: 'Start an independent automatic review/fix workflow only for an explicit automatic-review request. Read korus-review-launch first. Can modify files; local commits require explicit approval; never pushes or merges. Returns startup, not completion. Stop editing the reviewed files; reports arrive automatically.',
            inputSchema: z.strictObject({
              scope: z.discriminatedUnion('type', [
                z.strictObject({ type: z.literal('uncommitted') }),
                z.strictObject({ type: z.literal('branch'), baseRef: z.string().trim().min(1).max(500) }),
              ]).describe('Uncommitted changes, or current branch against baseRef including working changes.'),
              selection: executionSelectionOverridesSchema.optional().describe('Execution overrides. Same-provider work inherits the caller; a different provider uses its own defaults. Null selects the provider default, including Standard tier.'),
              maxPriority: findingPrioritySchema.optional().describe('Highest numerical priority to fix; defaults to saved settings or p2 (P0–P2).'),
              maxRounds: z.number().int().min(1).max(10).optional().describe('Review round limit including final verification; defaults to saved settings or 3.'),
              autoCommit: z.boolean().optional().describe('False unless local commits are explicitly authorized, regardless of saved defaults. Includes reviewed working changes and fixes.'),
            }),
          }, input => loggedToolResult('start_automatic_review', { agentId }, () => options.start(agentId, input)));
        },
      };
    },
  };
}
