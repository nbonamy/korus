import { applyExecutionSelection, executionSelectionForAgent, resolveExecutionSelection } from '@workspace/core/execution-selection';
import type { Agent, AppSnapshot, Automation, AutomationExecutionLogEntry, BackendConversationRef, MainToRendererEvent } from '@workspace/core/contracts';
import { createQuickChatInSnapshot } from '@workspace/core/agent-manager';
import { agentDisplayName } from '@workspace/core/agent-display';
import { automationExecutionIsActive, canTargetAutomationAgent, failAutomationExecution, failOrphanedAutomationExecutionsInSnapshot, recordAutomationExecutionInSnapshot } from '@workspace/core/automation-manager';
import { createEntityId } from '@workspace/core/ids';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { warnMain } from '../log';
import { nextAutomationRunAt } from '@workspace/core/automation-schedule';

export type AutomationRunnerOptions = {
  getSnapshot: () => AppSnapshot;
  notifySnapshotUpdated: () => void;
  saveSnapshot: () => Promise<void>;
  sendPrompt: (agentId: string, prompt: string) => Promise<BackendConversationRef>;
  now?: () => Date;
  requireConnectedEngine?: (backend: Agent['backend']) => Promise<unknown>;
};

export class AutomationRunner {
  private readonly dispatching = new Set<string>();
  constructor(private readonly options: AutomationRunnerOptions) {}

  /** A daemon restart cannot claim that interrupted runs finished successfully. */
  async recoverInterruptedRuns(): Promise<void> {
    let changed = false;
    for (const automation of this.options.getSnapshot().automations) {
      for (const run of automation.executionLog.filter(automationExecutionIsActive)) {
        this.fail(automation, run, 'Automation interrupted by a daemon restart.');
        changed = true;
      }
    }
    if (changed) await this.publish();
  }

  async runAll(): Promise<void> {
    // Safety net: whatever removed a conversation, its active run can never finish on its own.
    if (failOrphanedAutomationExecutionsInSnapshot(this.options.getSnapshot(), this.now().toISOString())) await this.publish();
    for (const automation of [...this.options.getSnapshot().automations]) {
      if (automationIsDue(automation, this.now())) await this.runAutomation(automation.id);
    }
  }

  async runAutomation(automationId: string): Promise<void> {
    const snapshot = this.options.getSnapshot();
    const automation = snapshot.automations.find(item => item.id === automationId);
    if (!automation?.enabled || this.dispatching.has(automationId) || automation.executionLog.some(automationExecutionIsActive)) return;
    const target = { ...automation.target };
    // Reserve an existing conversation before yielding, including across different schedules.
    const existing = target.kind === 'newQuickChat' ? undefined : snapshot.agents.find(agent => agent.id === target.agentId);
    if (existing && (existing.status.type === 'working' || existing.status.type === 'awaitingInput'
      || snapshot.automations.some(item => item.executionLog.some(run => run.agentId === existing.id && automationExecutionIsActive(run))))) return;
    this.dispatching.add(automationId);
    const run: AutomationExecutionLogEntry = { id: createEntityId('automation-exec'), automationId, startedAt: this.now().toISOString(), status: 'working',
      ...(existing ? { agentId: existing.id, agentName: agentDisplayName(existing) } : {}) };
    recordAutomationExecutionInSnapshot(snapshot, automationId, run);
    try {
      if (target.kind !== 'newQuickChat' && (!existing || !canTargetAutomationAgent(snapshot, existing)
        || (target.kind === 'quickChat') !== (existing.sessionKind === 'quickChat')
        || snapshot.teams.some(team => team.id === existing.teamId && team.remoteConnectionId))) throw new Error('The automation target is no longer available.');
      if (target.kind === 'newQuickChat' && !snapshot.teams.some(team => team.id === target.teamId && !team.remoteConnectionId)) throw new Error('The automation team is no longer available.');
      await this.options.requireConnectedEngine?.(existing?.backend ?? (target.kind === 'newQuickChat' ? target.selection.backend : 'codex'));
      if (!snapshot.automations.includes(automation) || !automation.enabled) {
        this.fail(automation, run, 'Automation was disabled or deleted before dispatch.');
        await this.publish();
        return;
      }
      let agent = existing;
      if (target.kind === 'newQuickChat') {
        const id = createEntityId('agent');
        createQuickChatInSnapshot(snapshot, { teamId: target.teamId, selection: { backend: target.selection.backend } }, run.startedAt, id, { select: false });
        agent = snapshot.agents.find(item => item.id === id)!;
        agent.name = automation.name;
        applyExecutionSelection(agent, resolveExecutionSelection(executionSelectionForAgent(agent), target.selection));
      }
      if (!agent || !snapshot.agents.includes(agent)) throw new Error('The automation target is no longer available.');
      run.agentId = agent.id;
      run.agentName = agentDisplayName(agent);
      await this.publish();
      if (!snapshot.automations.includes(automation) || !automation.enabled || !snapshot.agents.includes(agent)) {
        throw new Error('The automation or its target was removed or disabled before dispatch.');
      }
      if (agent.status.type === 'working' || agent.status.type === 'awaitingInput') throw new Error('The automation target became busy before dispatch.');
      run.conversationRef = await this.options.sendPrompt(agent.id, automation.prompt);
      await this.publish();
    } catch (error) {
      this.fail(automation, run, error instanceof Error ? error.message : String(error));
      await this.publish();
    } finally {
      this.dispatching.delete(automationId);
    }
  }

  handleEvent(event: MainToRendererEvent): void {
    if (!event.agentId) return;
    const view = providerConversationEventView(event);
    for (const automation of this.options.getSnapshot().automations) {
      const run = automation.executionLog.find(item => item.agentId === event.agentId && automationExecutionIsActive(item));
      if (!run) continue;
      if (view.type === 'turn.completed') {
        const payload = view.payload as { status?: string; turn?: { status?: string; error?: { message?: string } }; error?: { message?: string } } | null;
        const status = payload?.turn?.status ?? payload?.status;
        if (status === 'failed' || status === 'interrupted' || payload?.error || payload?.turn?.error) {
          this.fail(automation, run, payload?.turn?.error?.message ?? payload?.error?.message ?? `Turn ${status ?? 'failed'}.`);
        } else {
          run.status = 'completed';
          run.completedAt = this.now().toISOString();
          automation.updatedAt = run.completedAt;
        }
      } else if (event.type === 'agent.statusChanged') {
        if (event.payload.type === 'error') this.fail(automation, run, typeof event.payload.message === 'string' ? event.payload.message : event.payload.message.key);
        else if (event.payload.type === 'awaitingInput') run.status = 'awaitingInput';
        else if (event.payload.type === 'working') run.status = 'working';
        else continue; // finish_turn clears status before the provider actually ends its turn.
      } else continue;
      void this.publish().catch(error => warnMain('automations', 'could not save run status', { message: String(error) }));
    }
  }

  private fail(automation: Automation, run: AutomationExecutionLogEntry, error: string): void {
    failAutomationExecution(automation, run, error, this.now().toISOString());
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }
  private async publish(): Promise<void> {
    await this.options.saveSnapshot();
    this.options.notifySnapshotUpdated();
  }
}

export function automationIsDue(automation: Automation, now: Date): boolean {
  if (!automation.enabled || automation.executionLog.some(automationExecutionIsActive)) return false;
  const next = nextAutomationRunAt(automation);
  if (next !== null) return Date.parse(next) <= now.getTime();
  if ('rrule' in automation.schedule) {
    return false;
  }
  if (!automation.lastRunAt) return true;
  const last = Date.parse(automation.lastRunAt);
  return !Number.isFinite(last) || now.getTime() - last >= automation.schedule.intervalMinutes * 60_000;
}
