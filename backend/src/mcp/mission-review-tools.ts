import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { AppMcpAgentCoordinator } from './agent-coordinator';
import { findingBodySchema, findingPrioritySchema, findingTitleSchema } from './finding-tool-schemas';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export function createMissionReviewToolModuleProvider(coordinator: AppMcpAgentCoordinator): AppMcpToolModuleProvider {
  return {
    id: 'mission-review-findings',
    // Providers can retain the first tool catalog when a Mission lead is reused.
    // Discoverability stays stable; MissionAgentTools checks stage and ownership.
    resolve: ({ agentId }) => coordinator.missionContext(agentId) ? {
      id: 'mission-review-findings',
      register: server => registerMissionReviewTools(server, coordinator, agentId),
    } : undefined,
  };
}

function registerMissionReviewTools(server: McpServer, coordinator: AppMcpAgentCoordinator, callerAgentId: string): void {
  server.registerTool('report-mission-review-finding', {
    description: 'Report one durable structured finding for the authenticated Mission Review stage.',
    inputSchema: {
      priority: findingPrioritySchema,
      title: findingTitleSchema,
      body: findingBodySchema,
      repositoryPath: z.string().trim().min(1).describe('Exact represented repository path affected by the finding.'),
      file: z.string().trim().min(1).optional().describe('Repository-relative file path when available.'),
      line: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional(),
    },
  }, input => loggedToolResult('report-mission-review-finding', { callerAgentId }, () => coordinator.reportMissionReviewFinding(callerAgentId, {
    priority: input.priority,
    title: input.title,
    body: input.body,
    repositoryPath: input.repositoryPath,
    ...(input.file ? { location: { file: input.file, ...(input.line ? { line: input.line } : {}), ...(input.endLine ? { endLine: input.endLine } : {}) } } : {}),
  })));

  server.registerTool('update-mission-review-finding', {
    description: 'Correct a Mission Review finding or mark it fixed after completing and verifying its remediation.',
    inputSchema: {
      findingId: z.string().trim().min(1),
      priority: findingPrioritySchema.optional(),
      title: findingTitleSchema.optional(),
      body: findingBodySchema.optional(),
      repositoryPath: z.string().trim().min(1).optional(),
      file: z.string().trim().min(1).optional(),
      line: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional(),
      status: z.literal('fixed').optional(),
      evidence: z.string().trim().min(1).max(100_000).optional(),
    },
  }, input => loggedToolResult('update-mission-review-finding', { callerAgentId, findingId: input.findingId }, () => coordinator.updateMissionReviewFinding(callerAgentId, {
    findingId: input.findingId,
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.body ? { body: input.body } : {}),
    ...(input.repositoryPath ? { repositoryPath: input.repositoryPath } : {}),
    ...(input.file ? { location: { file: input.file, ...(input.line ? { line: input.line } : {}), ...(input.endLine ? { endLine: input.endLine } : {}) } } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  })));
}
