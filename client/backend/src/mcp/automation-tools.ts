import { executionSelectionOverridesSchema } from '../execution-selection-schema';
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import type { Agent, AppSnapshot, Automation, AutomationTarget } from '@workspace/core/contracts';
import { automationTargetIsAvailable, canTargetAutomationAgent, createAutomationInSnapshot, updateAutomationInSnapshot } from '@workspace/core/automation-manager';
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
        register: server => { server.registerTool('create-automation', {
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
            selection: executionSelectionOverridesSchema.optional().describe('Execution overrides. Same-provider work inherits the caller; a different provider uses its own defaults. Null selects the provider default, including Standard tier.'),
          }),
        }, input => loggedToolResult('create-automation', { agentId }, async () => {
          const snapshot = options.snapshot;
          const schedule = normalizeAutomationSchedule(input.schedule);
          if (!schedule) throw new McpToolError('Invalid recurrence rule or IANA timezone. Use a calendar RRULE with timeZone, or intervalMinutes.');
          if (!snapshot.agents.includes(caller) || !canTargetAutomationAgent(snapshot, caller)) throw new McpToolError('The caller is no longer available for automations.');
          let target: AutomationTarget;
          if (!input.target || input.target.kind === 'newQuickChat') {
            if (!caller.teamId) throw new McpToolError('Choose a team for this conversation first.');
            const provider = input.selection?.provider ?? caller.provider;
            target = { kind: 'newQuickChat', teamId: caller.teamId, selection: { ...input.selection, provider: provider } };
          } else {
            if (input.selection) throw new McpToolError('Existing conversations retain their backend, model and effort. Remove the overrides.');
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
        }));
        server.registerTool('list-automations', {
          description: 'Inspect saved automations in your team before editing. Returns exact target IDs and whether the target is this conversation. Pass id to inspect its full prompt. This does not run or modify schedules.',
          inputSchema: z.strictObject({ id: z.string().min(1).optional() }),
        }, input => loggedToolResult('list-automations', { agentId }, () => {
          const items = options.snapshot.automations.filter(item => visibleAutomation(options.snapshot, caller, item));
          if (input.id && !items.some(item => item.id === input.id)) throw new McpToolError('Automation not found in your team.');
          return { automations: items.filter(item => !input.id || item.id === input.id).map(item => automationDetails(options.snapshot, caller, item, Boolean(input.id))) };
        }));
        server.registerTool('update-automation', {
          description: 'Edit an existing automation only on explicit user request. Inspect with list-automations first and pass its updatedAt as expectedUpdatedAt. Omitted fields are preserved, including the target. Switching to newQuickChat creates a fresh conversation each run. Does not run the automation or alter execution history.',
          inputSchema: z.strictObject({
            id: z.string().min(1), expectedUpdatedAt: z.string().min(1),
            name: z.string().trim().min(1).max(200).optional(), prompt: z.string().trim().min(1).max(100_000).optional(), enabled: z.boolean().optional(),
            schedule: z.union([z.strictObject({rrule:z.string().trim().min(1).max(1000),timeZone:z.string().trim().min(1).max(100)}),z.strictObject({intervalMinutes:z.number().int().min(1).max(525600)})]).optional(),
            target: z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('newQuickChat')}),z.strictObject({kind:z.literal('current')}),z.strictObject({kind:z.literal('agent'),agentId:z.string().min(1)})]).optional(),
            selection: executionSelectionOverridesSchema.optional(),
          }),
        }, input => loggedToolResult('update-automation', { agentId, automationId: input.id }, async () => {
          const snapshot = options.snapshot;
          const existing = snapshot.automations.find(item => item.id === input.id && visibleAutomation(snapshot, caller, item));
          if (!existing) throw new McpToolError('Automation not found in your team.');
          if (existing.updatedAt !== input.expectedUpdatedAt || pending.has(input.id)) throw new McpToolError('Automation changed. Inspect it again before editing.');
          let target = existing.target;
          if (input.target?.kind === 'newQuickChat' || (!input.target && input.selection && target.kind === 'newQuickChat')) {
            if (!caller.teamId) throw new McpToolError('Choose a team first.');
            const previous = target.kind === 'newQuickChat' ? target.selection : { provider: caller.provider };
            const provider = input.selection?.provider ?? previous.provider;
            target = {kind:'newQuickChat',teamId:caller.teamId,selection:{...(provider === previous.provider ? previous : {provider: provider}),...input.selection,provider: provider}};
          } else if (input.target) {
            if (input.selection) throw new McpToolError('Existing conversations retain their model settings. Remove selection overrides.');
            const id = input.target.kind === 'current' ? caller.id : input.target.agentId;
            const agent = snapshot.agents.find(agent => agent.id === id && agent.teamId === caller.teamId && canTargetAutomationAgent(snapshot, agent));
            if (!agent) throw new McpToolError('Choose an available conversation in your team.');
            target = {kind:agent.sessionKind === 'quickChat' ? 'quickChat' : 'agent',agentId:id};
          } else if (input.selection) throw new McpToolError('Selection overrides require a new Quick Chat target.');
          const before = structuredClone(existing);
          const at = new Date(Math.max(Date.now(), Date.parse(existing.updatedAt) + 1)).toISOString();
          const updated = updateAutomationInSnapshot(snapshot, {id:existing.id,name:input.name ?? existing.name,prompt:input.prompt ?? existing.prompt,enabled:input.enabled ?? existing.enabled,target,schedule:input.schedule ?? existing.schedule}, at);
          if (!updated) throw new McpToolError('Invalid automation target or settings.');
          const operation = (async () => {
            try { await options.persist(); options.notify(); return {success:true,automation:automationDetails(snapshot,caller,updated,true)}; }
            catch(error) { if (updated.updatedAt === at) { for (const key of Object.keys(updated)) delete (updated as unknown as Record<string,unknown>)[key]; Object.assign(updated,before); } throw error; }
            finally { pending.delete(input.id); }
          })();
          pending.set(input.id,operation);
          return operation;
        }));
        },
      };
    },
  };
}

function visibleAutomation(snapshot: AppSnapshot, caller: Agent, automation: Automation): boolean {
  if (!snapshot.agents.includes(caller) || !canTargetAutomationAgent(snapshot, caller) || !caller.teamId) return false;
  const target = automation.target;
  return target.kind === 'newQuickChat' ? target.teamId === caller.teamId
    : snapshot.agents.some(agent => agent.id === target.agentId && agent.teamId === caller.teamId);
}
function automationDetails(snapshot: AppSnapshot, caller: Agent, automation: Automation, full: boolean) {
  const target = automation.target;
  const agent = target.kind === 'newQuickChat' ? undefined : snapshot.agents.find(agent => agent.id === target.agentId);
  const teamId = target.kind === 'newQuickChat' ? target.teamId : agent?.teamId;
  return { id: automation.id, name: automation.name, enabled: automation.enabled, updatedAt: automation.updatedAt,
    target, schedule: automation.schedule, nextRunAt: nextAutomationRunAt(automation),
    ...(full ? {prompt:automation.prompt,lastRunAt:automation.lastRunAt,lastError:automation.lastError} : {}),
    targetInfo: {teamId,teamName:snapshot.teams.find(team => team.id === teamId)?.name,agentId:agent?.id,agentName:agent?.name,
      isCurrentConversation:agent?.id === caller.id,available:automationTargetIsAvailable(snapshot,target)},
  };
}
