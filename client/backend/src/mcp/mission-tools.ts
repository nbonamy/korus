import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { featureStages } from '@workspace/core/missions';
import type { AppMcpAgentCoordinator } from './agent-coordinator';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export function createMissionToolModuleProvider(
  coordinator: AppMcpAgentCoordinator,
): AppMcpToolModuleProvider {
  return {
    id: 'mission',
    resolve: ({ agentId }) => coordinator.missionContext(agentId) ? {
      id: 'mission',
      owns: { proposedActions: true },
      register: server => registerMissionTools(server, coordinator, agentId),
    } : undefined,
  };
}

function registerMissionTools(
  server: McpServer,
  coordinator: AppMcpAgentCoordinator,
  callerAgentId: string,
): void {
  server.registerTool('acquire-mission-commit-lock', {
    description: 'Wait for and acquire the cooperative commit lock for your parallel Mission workspace before touching the Git index. No parameters.',
    inputSchema: {},
  }, (_input, extra) => loggedToolResult('acquire-mission-commit-lock', { callerAgentId }, () => coordinator.acquireMissionCommitLock(callerAgentId, extra.signal)));
  server.registerTool('release-mission-commit-lock', {
    description: 'Release the cooperative Mission commit lock you own after completing or abandoning the staging and commit sequence. No parameters.',
    inputSchema: {},
  }, () => loggedToolResult('release-mission-commit-lock', { callerAgentId }, () => coordinator.releaseMissionCommitLock(callerAgentId)));
  server.registerTool('reopen-mission-stage', {
    description: 'Mission lead only: return to an earlier reached stage to revise requirements or add/revise tickets. Preserves existing tickets, completed work and execution history. Stop active repository workers first. This changes the authoritative stage; user approval is still required to advance Requirements, Tickets and Review.',
    inputSchema: { stage: z.enum(['requirements', 'tickets', 'implementation', 'review']) },
  }, ({ stage }) => loggedToolResult('reopen-mission-stage', { callerAgentId, stage }, () => coordinator.reopenMissionStage(callerAgentId, stage)));

  server.registerTool('set-mission-title', {
    description: 'Rename the active Mission once its intended outcome is clear. Use a concise outcome-oriented title. The active Mission and run are inferred from your authenticated agent identity.',
    inputSchema: {
      title: z.string().trim().min(1).max(200),
    },
  }, ({ title }) => loggedToolResult('set-mission-title', { callerAgentId }, () => coordinator.setMissionTitle(callerAgentId, title)));

  server.registerTool('get-mission-assignment', {
    description: 'Read your authenticated Mission implementation assignment: stable ticketId, one-based ticketNumber, exact title/body and repositoryPath. Read before editing, after compaction, and on reassignment; never infer a ticket by counting backlog entries. No parameters.',
    inputSchema: {},
  }, () => loggedToolResult('get-mission-assignment', { callerAgentId }, () => {
    const context = coordinator.missionContext(callerAgentId);
    if (!context?.assignment) throw new Error('This agent has no Mission implementation assignment.');
    return { missionId: context.missionId, runId: context.runId, assignment: context.assignment };
  }));

  server.registerTool('list-mission-artifacts', {
    description: 'List canonical artifact files already written for the active Mission. The Mission is inferred from your authenticated agent identity.',
    inputSchema: {},
  }, () => loggedToolResult('list-mission-artifacts', { callerAgentId }, () => coordinator.listMissionArtifacts(callerAgentId)));

  server.registerTool('read-mission-artifact', {
    description: 'Read a canonical artifact file from the active Mission so work can move between agents and workflow stages.',
    inputSchema: { stage: z.enum(featureStages) },
  }, ({ stage }) => loggedToolResult('read-mission-artifact', { callerAgentId, stage }, () => coordinator.readMissionArtifact(callerAgentId, stage)));

  server.registerTool('write-mission-artifact', {
    description: 'Create or revise the canonical Markdown artifact for your assigned Mission stage. Read the current revision before overwriting an existing artifact.',
    inputSchema: {
      stage: z.enum(featureStages),
      content: z.string().trim().min(1).max(500_000),
      expectedRevision: z.number().int().nonnegative().optional(),
    },
  }, input => loggedToolResult('write-mission-artifact', { callerAgentId, stage: input.stage }, () => coordinator.writeMissionArtifact(callerAgentId, input)));

  server.registerTool('upsert-mission-ticket', {
    description: 'Preserve existing tickets when revising the backlog. An unchanged ticket keeps its completion state; changing its work resets implementation. Create or revise one Mission ticket assigned to exactly one represented repository. Require verified local commits before ticket completion; never instruct the worker to skip or defer commits. Omit ticketId to create; use the returned ID to revise. Read mission-to-tickets for the stage procedure.',
    inputSchema: {
      expectedRevision: z.number().int().nonnegative().optional(),
      ticketId: z.string().regex(/^mission-ticket-[a-zA-Z0-9-]+$/).optional(),
      title: z.string().trim().min(1).max(500),
      body: z.string().trim().min(1).max(100000),
      repositoryPath: z.string().trim().min(1),
      reference: z.string().trim().min(1).max(100000).optional(),
      blockedByTicketIds: z.array(z.string().regex(/^mission-ticket-[a-zA-Z0-9-]+$/)).max(200).optional(),
    },
  }, input => loggedToolResult('upsert-mission-ticket', { callerAgentId, ticketId: input.ticketId }, () => coordinator.upsertMissionTicket(callerAgentId, input)));

  server.registerTool('submit-mission-result', {
    description: 'Submit the structured result of your active Mission stage. The Mission and run are inferred from your authenticated agent identity. This never approves a user-reviewed stage or completes a mission. For Implementation, commit all your ticket changes locally before submission, even if the ticket says not to commit; include commit SHAs in changes. If committing is blocked, report the blocker instead of submitting completion. Send only summary, ticketId and implementation { changes, tests }, using get-mission-assignment. Example: {"summary":"Done","ticketId":"mission-ticket-abc","implementation":{"changes":"Commit abc123: callback fixed","tests":"npm test: 12 passed"}}. Other stages require complete artifacts. Legacy full-artifacts implementation calls remain supported; never combine both forms.',
    inputSchema: {
      summary: z.string().min(1).max(20000),
      ticketId: z.string().regex(/^mission-ticket-[a-zA-Z0-9-]+$/).optional(),
      implementation: z.object({ changes: z.string().trim().min(1).max(100000), tests: z.string().trim().min(1).max(100000) }).optional(),
      artifacts: z.object({
        requirements: z.object({ problem: z.string().max(100000), acceptance: z.string().max(100000) }),
        tickets: z.array(z.object({ id: z.string().regex(/^mission-ticket-[a-zA-Z0-9-]+$/).optional(), title: z.string().max(100000), body: z.string().max(100000).optional(), repositoryPath: z.string().trim().min(1).optional(), done: z.boolean(), reference: z.string().min(1).max(100000).optional(), dependsOn: z.array(z.number().int().nonnegative()).max(200).optional() })).max(200),
        implementation: z.object({ changes: z.string().max(100000), tests: z.string().max(100000) }),
        review: z.object({ summary: z.string().max(100000), pullRequestUrl: z.string().max(100000) }),
      }).optional(),
    },
  }, input => loggedToolResult('submit-mission-result', { callerAgentId }, () => coordinator.submitMissionResult(callerAgentId, input)));
}
