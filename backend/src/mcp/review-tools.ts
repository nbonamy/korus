import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { ReviewToolContext } from '../review/review-tool-registry';
import { errorToolResult, structuredToolResult } from './tool-result';
import { findingBodySchema, findingPrioritySchema, findingTitleSchema } from './finding-tool-schemas';

const priority = findingPrioritySchema;
const findingTitle = findingTitleSchema;
const findingBody = findingBodySchema;

export function registerReviewTools(server: McpServer, context: ReviewToolContext): void {
  server.registerTool('finish_review_round', {
    description: 'Confirm each inspection, including clean reviews, after registering all identified findings. Read korus-reviewer for the procedure. Count all current-round findings across priorities; acceptance completes only inspection, not the review.',
    inputSchema: {
      findingCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).describe('Total identified current-round findings across P0–P3, all registered; zero for a clean inspection.'),
    },
  }, (input) => reviewToolResult(() => context.finishReviewRound(input)));

  server.registerTool('report_finding', {
    description: 'Create one durable structured code review finding supported by concrete evidence.',
    inputSchema: {
      priority,
      title: findingTitle,
      body: findingBody,
      file: z.string().trim().min(1).optional().describe('Repository-relative file path when available.'),
      line: z.number().int().positive().optional().describe('One-based start line when available.'),
      endLine: z.number().int().positive().optional().describe('One-based end line when available.'),
      priorFindingId: z.string().trim().min(1).optional().describe('Stable prior finding ID when this is a re-observation.'),
    },
  }, (input) => reviewToolResult(() => context.reportFinding({
    priority: input.priority,
    title: input.title,
    body: input.body,
    ...(input.file ? { location: { file: input.file, ...(input.line ? { line: input.line } : {}), ...(input.endLine ? { endLine: input.endLine } : {}) } } : {}),
    ...(input.priorFindingId ? { priorFindingId: input.priorFindingId } : {}),
  })));

  server.registerTool('update_finding', {
    description: 'Correct a finding or mark it fixed after completing and verifying its remediation.',
    inputSchema: {
      findingId: z.string().trim().min(1).describe('Stable finding ID returned by report_finding or supplied in the ledger.'),
      priority: priority.optional(),
      title: findingTitle.optional(),
      body: findingBody.optional(),
      file: z.string().trim().min(1).optional(),
      line: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional(),
      status: z.literal('fixed').optional().describe('Set to fixed only after the finding is fully remediated and verified.'),
      evidence: z.string().trim().min(1).optional().describe('Concise verification evidence when setting status to fixed.'),
    },
  }, (input) => reviewToolResult(() => context.updateFinding({
    findingId: input.findingId,
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.body ? { body: input.body } : {}),
    ...(input.file ? { location: { file: input.file, ...(input.line ? { line: input.line } : {}), ...(input.endLine ? { endLine: input.endLine } : {}) } } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  })));

  server.registerTool('delete_finding', {
    description: 'Delete a finding from the open review ledger when it is no longer actionable.',
    inputSchema: {
      findingId: z.string().trim().min(1).describe('Stable ID of the finding to remove from this review.'),
    },
  }, (input) => reviewToolResult(() => context.deleteFinding({ findingId: input.findingId })));
}

async function reviewToolResult(run: () => unknown) {
  try {
    return structuredToolResult(await run());
  } catch (error) {
    return errorToolResult(error instanceof Error ? error.message : String(error));
  }
}
