import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { ReviewToolContext } from '../review/review-tool-registry';
import { errorToolResult, structuredToolResult } from './tool-result';
import { findingBodySchema, findingPrioritySchema, findingTitleSchema } from './finding-tool-schemas';

const priority = findingPrioritySchema;
const findingTitle = findingTitleSchema;
const findingBody = findingBodySchema;
const updateFindingFields = {
  findingId: z.string().trim().min(1).describe('Stable finding ID returned by report_finding or supplied in the ledger.'),
  priority: priority.optional(),
  title: findingTitle.optional(),
  body: findingBody.optional(),
  file: z.string().trim().min(1).optional(),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  status: z.literal('fixed').optional().describe('Set to fixed only after the finding is fully remediated and verified.'),
  evidence: z.string().trim().min(1).optional().describe('Concise verification evidence when setting status to fixed.'),
};

export function registerReviewTools(server: McpServer, context: ReviewToolContext): void {
  server.registerTool('finish_review_round', {
    description: 'Confirm a Korus review inspection after saving every finding with report_finding. Native ReportFindings does not save to this ledger. findingCount is the total across p0–p3, including zero for a clean inspection; acceptance completes only inspection, not the review. Read korus-reviewer for the procedure. Example: {"findingCount":0}.',
    inputSchema: {
      findingCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).describe('Total identified current-round findings across P0–P3, all registered; zero for a clean inspection.'),
    },
  }, (input) => reviewToolResult(() => context.finishReviewRound(input)));

  server.registerTool('report_finding', {
    description: 'Save one finding in the Korus review ledger. Use this in Korus review rounds instead of native ReportFindings: required fields are priority, title and body, not summary, failure_scenario, category or verdict. Priority accepts p0, p1, p2, p3 or P0, P1, P2, P3; title is imperative and at most 80 characters; body explains evidence and impact. Optional file is repository-relative; line/endLine are positive one-based integers. Example: {"priority":"p2","title":"Validate ownership before writing","body":"An unowned request can write files.","file":"src/handler.ts","line":42}.',
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
    description: 'Correct an existing Korus review finding or record a verified fix. Required findingId is the ledger ID. To record remediation use status:"fixed" and evidence, not outcome/note. Corrections may set priority (p0–p3 or P0–P3), title (imperative, at most 80 characters), body, file, line and endLine. Unknown keys are rejected. Example: {"findingId":"<ledger ID>","status":"fixed","evidence":"npm test: 12 tests passed."}.',
    inputSchema: z.strictObject(updateFindingFields, {
      error: issue => issue.code === 'unrecognized_keys'
        ? `Unknown update_finding keys: ${issue.keys.join(', ')}. Valid keys: ${Object.keys(updateFindingFields).join(', ')}.`
        : undefined,
    }),
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
