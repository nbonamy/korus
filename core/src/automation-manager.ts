import type { Agent, AppSnapshot, Automation, AutomationExecutionLogEntry, AutomationTarget, CreateAutomationInput, UpdateAutomationInput } from './contracts';
import { createEntityId, type IdGenerator } from './ids';
import { resolveAgentBackend } from './agent-backends';
import { isAgentBackend } from './contracts/shared';
import { normalizeAutomationSchedule } from './automation-schedule';

export function isAutomationTarget(value: unknown): value is AutomationTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  if (target.kind === 'agent' || target.kind === 'quickChat') return typeof target.agentId === 'string' && Boolean(target.agentId.trim());
  return target.kind === 'newQuickChat' && typeof target.teamId === 'string' && Boolean(target.teamId.trim())
    && isAgentBackend(target.backend)
    && (target.model === undefined || typeof target.model === 'string')
    && (target.reasoningEffort === undefined || typeof target.reasoningEffort === 'string');
}

export function canTargetAutomationAgent(snapshot: Pick<AppSnapshot, 'missions'>, agent: Agent): boolean {
  return !agent.codeReview && !agent.remoteConnectionId
    && !(snapshot.missions ?? []).some(mission => Object.values(mission.stageAgentIds).includes(agent.id)
      || mission.execution?.memberIds.includes(agent.id) || mission.execution?.runs.some(run => run.workerId === agent.id));
}

/** A target is usable only while its conversation (or the team for a fresh Quick Chat) is still local and eligible. */
export function automationTargetIsAvailable(snapshot: Pick<AppSnapshot, 'teams' | 'agents' | 'missions'>, target: AutomationTarget): boolean {
  if (target.kind === 'newQuickChat') return snapshot.teams.some(team => team.id === target.teamId);
  const agent = snapshot.agents.find(item => item.id === target.agentId);
  return Boolean(agent && canTargetAutomationAgent(snapshot, agent) && (target.kind === 'quickChat') === (agent.sessionKind === 'quickChat'));
}

function normalize(snapshot: AppSnapshot, input: CreateAutomationInput, staleTarget?: AutomationTarget) {
  const schedule = normalizeAutomationSchedule(input.schedule);
  if (!isAutomationTarget(input.target) || typeof input.prompt !== 'string' || !input.prompt.trim()
    || !schedule) return null;
  let target: AutomationTarget;
  if (input.target.kind === 'newQuickChat') {
    const teamId = input.target.teamId.trim();
    target = { ...input.target, teamId, backend: resolveAgentBackend(snapshot, input.target.backend) };
  } else target = { kind: input.target.kind, agentId: input.target.agentId.trim() };
  // A schedule whose conversation is gone can still be switched off, never on or re-targeted to a missing one.
  const keepsStaleTarget = input.enabled === false && JSON.stringify(target) === JSON.stringify(staleTarget);
  if (!keepsStaleTarget && !automationTargetIsAvailable(snapshot, target)) return null;
  return { name: input.name?.trim() || input.prompt.trim().split('\n')[0]!.slice(0, 80), enabled: input.enabled !== false,
    prompt: input.prompt.trim(), target, schedule };
}

export function createAutomationInSnapshot(snapshot: AppSnapshot, input: CreateAutomationInput, createdAt = new Date().toISOString(), createId: IdGenerator = () => createEntityId('automation')): Automation | null {
  const normalized = normalize(snapshot, input);
  if (!normalized) return null;
  const id = createId();
  if (snapshot.automations.some(automation => automation.id === id)) return null;
  const automation: Automation = { ...normalized, id, createdAt, updatedAt: createdAt, executionLog: [] };
  snapshot.automations.push(automation);
  return automation;
}

export function updateAutomationInSnapshot(snapshot: AppSnapshot, input: UpdateAutomationInput, updatedAt = new Date().toISOString()): Automation | null {
  const automation = snapshot.automations.find(item => item.id === input.id);
  const normalized = normalize(snapshot, input, automation?.target);
  if (!automation || !normalized) return null;
  if (JSON.stringify(automation.schedule) !== JSON.stringify(normalized.schedule) || (!automation.enabled && normalized.enabled)) {
    automation.scheduleAnchorAt = updatedAt;
  }
  Object.assign(automation, normalized, { updatedAt });
  delete automation.lastError;
  return automation;
}

export function deleteAutomationFromSnapshot(snapshot: AppSnapshot, automationId: string): Automation | null {
  const automation = snapshot.automations.find(item => item.id === automationId);
  if (!automation) return null;
  snapshot.automations = snapshot.automations.filter(item => item.id !== automationId);
  return automation;
}

export function automationExecutionIsActive(entry: AutomationExecutionLogEntry): boolean {
  return entry.status === 'working' || entry.status === 'awaitingInput';
}

export function clearAutomationExecutionHistoryInSnapshot(snapshot: AppSnapshot, automationId: string, updatedAt = new Date().toISOString()): Automation | null {
  const automation = snapshot.automations.find(item => item.id === automationId);
  if (!automation) return null;
  automation.executionLog = automation.executionLog.filter(automationExecutionIsActive);
  automation.updatedAt = updatedAt;
  delete automation.lastError;
  return automation;
}

export function deleteAutomationExecutionFromSnapshot(snapshot: AppSnapshot, automationId: string, executionId: string, updatedAt = new Date().toISOString()): Automation | null {
  const automation = snapshot.automations.find(item => item.id === automationId);
  const entry = automation?.executionLog.find(item => item.id === executionId);
  if (!automation || !entry || automationExecutionIsActive(entry)) return null;
  automation.executionLog = automation.executionLog.filter(item => item.id !== executionId);
  automation.updatedAt = updatedAt;
  return automation;
}

export const automationConversationRemovedMessage = 'The automation conversation was removed.';

export function failAutomationExecution(automation: Automation, run: AutomationExecutionLogEntry, error: string, completedAt: string): void {
  Object.assign(run, { status: 'failed', error, completedAt });
  automation.lastError = error;
  automation.updatedAt = completedAt;
}

/** Closing a conversation or team must not leave a schedule that can only fail; the user re-targets it before re-enabling. */
export function disableUnavailableAutomationsInSnapshot(snapshot: AppSnapshot, updatedAt = new Date().toISOString()): boolean {
  let changed = false;
  for (const automation of snapshot.automations) {
    if (!automation.enabled || automationTargetIsAvailable(snapshot, automation.target)) continue;
    automation.enabled = false;
    automation.updatedAt = updatedAt;
    changed = true;
  }
  return changed;
}

/** A run whose conversation vanished never receives a turn event, so it would stay active (and block the schedule) forever. */
export function failOrphanedAutomationExecutionsInSnapshot(snapshot: AppSnapshot, completedAt = new Date().toISOString()): boolean {
  let changed = false;
  for (const automation of snapshot.automations) {
    for (const run of automation.executionLog) {
      if (!automationExecutionIsActive(run) || !run.agentId || snapshot.agents.some(agent => agent.id === run.agentId)) continue;
      failAutomationExecution(automation, run, automationConversationRemovedMessage, completedAt);
      changed = true;
    }
  }
  return changed;
}

/** Call after removing agents or teams so schedules never outlive their conversation. */
export function releaseRemovedAutomationTargetsInSnapshot(snapshot: AppSnapshot, at = new Date().toISOString()): void {
  failOrphanedAutomationExecutionsInSnapshot(snapshot, at);
  disableUnavailableAutomationsInSnapshot(snapshot, at);
}

export function recordAutomationExecutionInSnapshot(snapshot: AppSnapshot, automationId: string, entry: AutomationExecutionLogEntry): Automation | null {
  const automation = snapshot.automations.find(item => item.id === automationId);
  if (!automation || entry.automationId !== automationId) return null;
  automation.executionLog = [entry, ...automation.executionLog.filter(item => item.id !== entry.id)].slice(0, 50);
  automation.lastRunAt = entry.startedAt;
  automation.updatedAt = entry.completedAt ?? entry.startedAt;
  if (entry.error) automation.lastError = entry.error;
  else delete automation.lastError;
  return automation;
}
