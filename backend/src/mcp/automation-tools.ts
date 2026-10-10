import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import type { AppSnapshot, AutomationTarget } from '@workspace/core/contracts';
import { canTargetAutomationAgent, createAutomationInSnapshot } from '@workspace/core/automation-manager';
import { McpToolError } from './agent-coordinator';
import { nextAutomationRunAt, normalizeAutomationSchedule } from '@workspace/core/automation-schedule';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export function createAutomationToolModuleProvider(options: {
  snapshot: AppSnapshot;
  persist: () => Promise<void>;
  notify: () => void;
}): AppMcpToolModuleProvider {
  const pending = new Map<string, Promise<unknown>>();
  return {
    id: 'automations',
    resolve: ({ agentId }) => {
      const caller = options.snapshot.agents.find(agent => agent.id === agentId);
      if (!caller || !canTargetAutomationAgent(options.snapshot, caller)) return undefined;
      return {
        id: 'automations',
        register: server => server.registerTool('create-automation', {
          description: 'Schedule a recurring Korus prompt only on explicit user request. Read korus-automations first. Calendar times require RRULE and IANA timezone. Runs on the owning daemon; returns a saved schedule and next occurrence, not a completed run.',
          inputSchema: z.strictObject({
            requestId: z.string().trim().min(1).max(200).describe('Unique ID for this creation request. Reuse it with the same settings on retries to avoid duplicate schedules.'),
            name: z.string().trim().min(1).max(200),
            prompt: z.string().trim().min(1).max(100_000),
            schedule: z.union([
              z.strictObject({ rrule: z.string().trim().min(1).max(1000).describe('One RRULE without DTSTART; MINUTELY through YEARLY.'), timeZone: z.string().trim().min(1).max(100).describe('IANA timezone for this calendar schedule.') }),
              z.strictObject({ intervalMinutes: z.number().int().min(1).max(525_600) }),
            ]),
            enabled: z.boolean().optional().describe('Defaults to true. False saves a disabled automation for later activation in the UI.'),
            target: z.discriminatedUnion('kind', [
              z.strictObject({ kind: z.literal('newQuickChat') }),
              z.strictObject({ kind: z.literal('current') }),
              z.strictObject({ kind: z.literal('agent'), agentId: z.string().trim().min(1).describe('An existing agent or Quick Chat ID from list-agents in your team.') }),
            ]).optional(),
            backend: z.enum(['codex', 'claude']).optional().describe('New Quick Chats only. Otherwise inferred from the caller.'),
            model: z.string().trim().min(1).max(200).optional().describe('New Quick Chats only. Omit to use saved defaults.'),
            reasoningEffort: z.string().trim().min(1).max(200).optional().describe('New Quick Chats only. Omit to use saved defaults.'),
          }),
        }, input => loggedToolResult('create-automation', { agentId }, async () => {
          const snapshot = options.snapshot;
          const schedule = normalizeAutomationSchedule(input.schedule);
          if (!schedule) throw new McpToolError('Invalid recurrence rule or IANA timezone. Use a calendar RRULE with timeZone, or intervalMinutes.');
          if (!snapshot.agents.includes(caller) || !canTargetAutomationAgent(snapshot, caller)) throw new McpToolError('The caller is no longer available for automations.');
          let target: AutomationTarget;
          if (!input.target || input.target.kind === 'newQuickChat') {
            if (!caller.teamId) throw new McpToolError('Choose a team for this conversation first.');
            target = { kind: 'newQuickChat', teamId: caller.teamId, backend: input.backend ?? caller.backend,
              ...(input.model ? { model: input.model } : {}), ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}) };
          } else {
            if (input.backend || input.model || input.reasoningEffort) throw new McpToolError('Existing conversations retain their backend, model and effort. Remove the overrides.');
            const id = input.target.kind === 'current' ? caller.id : input.target.agentId;
            const agent = snapshot.agents.find(candidate => candidate.id === id && candidate.teamId === caller.teamId);
            if (!agent || !canTargetAutomationAgent(snapshot, agent)) throw new McpToolError('Choose an available conversation in your team.');
            target = { kind: agent.sessionKind === 'quickChat' ? 'quickChat' : 'agent', agentId: agent.id };
          }
          const id = `automation-${createHash('sha256').update(JSON.stringify([caller.id, input.requestId])).digest('hex')}`;
          const config = { name: input.name, prompt: input.prompt, enabled: input.enabled ?? true, target, schedule };
          const existing = snapshot.automations.find(automation => automation.id === id);
          if (existing && JSON.stringify({ name: existing.name, prompt: existing.prompt, enabled: existing.enabled, target: existing.target, schedule: existing.schedule }) !== JSON.stringify(config)) {
            throw new McpToolError('This requestId already created an automation with different settings. Use a new requestId for a separate automation.');
          }
          if (pending.has(id)) return pending.get(id)!;
          const result = () => ({ success: true, automationId: id, name: config.name, enabled: config.enabled, target, schedule: config.schedule,
            nextRunAt: nextAutomationRunAt(snapshot.automations.find(item => item.id === id)!) });
          if (existing) return result();
          const automation = createAutomationInSnapshot(snapshot, config, undefined, () => id);
          if (!automation) throw new McpToolError('Invalid automation target or settings.');
          const operation = (async () => {
            try {
              await options.persist();
              options.notify();
              return result();
            } catch (error) {
              snapshot.automations = snapshot.automations.filter(item => item !== automation);
              throw error;
            } finally { pending.delete(id); }
          })();
          pending.set(id, operation);
          return operation;
        })),
      };
    },
  };
}
