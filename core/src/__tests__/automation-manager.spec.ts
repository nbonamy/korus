import { describe, expect, it } from 'vitest';
import type { AutomationExecutionLogEntry, CreateAutomationInput } from '../contracts';
import { clearAutomationExecutionHistoryInSnapshot, createAutomationInSnapshot, deleteAutomationExecutionFromSnapshot,
  deleteAutomationFromSnapshot, disableUnavailableAutomationsInSnapshot, failOrphanedAutomationExecutionsInSnapshot,
  recordAutomationExecutionInSnapshot, updateAutomationInSnapshot } from '../automation-manager';
import { createInitialSnapshot } from '../snapshot';
import { createQuickChatInSnapshot } from '../agent-manager';

function setup() {
  const snapshot = createInitialSnapshot();
  snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
  return snapshot;
}
const input: CreateAutomationInput = { prompt: ' Check tasks. ', target: { kind: 'newQuickChat', teamId: 'team-app', backend: 'codex' }, schedule: { intervalMinutes: 60.9 } };
function execution(id: string, status: AutomationExecutionLogEntry['status'] = 'completed'): AutomationExecutionLogEntry {
  return { id, automationId: 'auto', status, startedAt: '2026-10-06T12:00:00Z', agentId: 'agent-dina', agentName: 'Dina' };
}
describe('prompt automation configuration', () => {
  it('reanchors changed or re-enabled schedules but keeps timing when editing just the prompt', () => {
    const snapshot = setup();
    const schedule = { rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0;BYSECOND=0', timeZone: 'America/Chicago' };
    const automation = createAutomationInSnapshot(snapshot, { ...input, schedule, enabled: false }, '2026-10-06T12:00:00Z', () => 'auto')!;
    updateAutomationInSnapshot(snapshot, { ...input, schedule, id: 'auto', enabled: true }, '2026-10-06T14:00:00Z');
    expect(automation.scheduleAnchorAt).toBe('2026-10-06T14:00:00Z');
    updateAutomationInSnapshot(snapshot, { ...input, schedule, id: 'auto', prompt: 'Changed' }, '2026-10-07T14:00:00Z');
    expect(automation.scheduleAnchorAt).toBe('2026-10-06T14:00:00Z');
  });
  it('creates without a repository and edits configuration without losing run history', () => {
    const snapshot = setup();
    const automation = createAutomationInSnapshot(snapshot, input, 'now', () => 'auto')!;
    expect(automation).toStrictEqual({ id: 'auto', name: 'Check tasks.', enabled: true, prompt: 'Check tasks.',
      target: input.target, schedule: { intervalMinutes: 60 }, executionLog: [], createdAt: 'now', updatedAt: 'now' });
    recordAutomationExecutionInSnapshot(snapshot, 'auto', execution('run'));
    updateAutomationInSnapshot(snapshot, { ...input, id: 'auto', name: 'Nightly', enabled: false,
      target: { kind: 'agent', agentId: 'agent-dina' } }, 'later');
    expect(automation).toMatchObject({ name: 'Nightly', enabled: false, target: { kind: 'agent', agentId: 'agent-dina' },
      executionLog: [execution('run')], updatedAt: 'later' });
    expect(deleteAutomationFromSnapshot(snapshot, 'auto')).toBe(automation);
    expect(snapshot.automations).toEqual([]);
  });

  it('validates target identity, target kind, local ownership, prompt, and schedule', () => {
    const snapshot = setup();
    for (const bad of [
      { ...input, prompt: '' }, { ...input, target: { kind: 'agent', agentId: 'missing' } },
      { ...input, target: { kind: 'quickChat', agentId: 'agent-dina' } },
      { ...input, schedule: { intervalMinutes: 0 } }, { ...input, schedule: { intervalMinutes: NaN } },
      { ...input, target: { kind: 'newQuickChat', teamId: 'missing', backend: 'codex' } },
      { ...input, target: undefined },
    ]) expect(createAutomationInSnapshot(snapshot, bad as CreateAutomationInput)).toBeNull();
    createQuickChatInSnapshot(snapshot, { teamId: 'team-app', backend: 'claude' }, 'now', 'quick');
    expect(createAutomationInSnapshot(snapshot, { ...input, target: { kind: 'quickChat', agentId: 'quick' } })).not.toBeNull();
    snapshot.agents.find(agent => agent.id === 'agent-dina')!.remoteConnectionId = 'remote';
    expect(createAutomationInSnapshot(snapshot, { ...input, target: { kind: 'agent', agentId: 'agent-dina' } })).toBeNull();
    expect(updateAutomationInSnapshot(snapshot, { ...input, id: 'missing' })).toBeNull();
  });

  it('preserves active runs and schedule timing when clearing history', () => {
    const snapshot = setup();
    const automation = createAutomationInSnapshot(snapshot, input, 'now', () => 'auto')!;
    recordAutomationExecutionInSnapshot(snapshot, 'auto', execution('done'));
    recordAutomationExecutionInSnapshot(snapshot, 'auto', execution('active', 'awaitingInput'));
    const lastRunAt = automation.lastRunAt;
    expect(deleteAutomationExecutionFromSnapshot(snapshot, 'auto', 'active')).toBeNull();
    clearAutomationExecutionHistoryInSnapshot(snapshot, 'auto');
    expect(automation.executionLog).toEqual([execution('active', 'awaitingInput')]);
    expect(automation.lastRunAt).toBe(lastRunAt);
    automation.executionLog[0]!.status = 'completed';
    expect(deleteAutomationExecutionFromSnapshot(snapshot, 'auto', 'active')?.executionLog).toEqual([]);
    expect(recordAutomationExecutionInSnapshot(snapshot, 'missing', execution('run'))).toBeNull();
    expect(recordAutomationExecutionInSnapshot(snapshot, 'auto', { ...execution('run'), automationId: 'other' })).toBeNull();
  });

  it('disables automations whose conversation is gone and refuses to re-enable them', () => {
    const snapshot = setup();
    const agentTarget = { kind: 'agent', agentId: 'agent-dina' } as const;
    const stale = createAutomationInSnapshot(snapshot, { ...input, target: agentTarget }, 'created', () => 'stale')!;
    const fresh = createAutomationInSnapshot(snapshot, input, 'created', () => 'fresh')!;
    const alreadyOff = createAutomationInSnapshot(snapshot, { ...input, target: agentTarget, enabled: false }, 'created', () => 'off')!;
    expect(disableUnavailableAutomationsInSnapshot(snapshot, 'later')).toBe(false);
    snapshot.agents = snapshot.agents.filter(agent => agent.id !== 'agent-dina');
    expect(disableUnavailableAutomationsInSnapshot(snapshot, 'later')).toBe(true);
    expect(stale).toMatchObject({ enabled: false, updatedAt: 'later' });
    expect(fresh).toMatchObject({ enabled: true, updatedAt: 'created' });
    expect(alreadyOff.updatedAt).toBe('created');
    expect(disableUnavailableAutomationsInSnapshot(snapshot, 'again')).toBe(false);
    expect(updateAutomationInSnapshot(snapshot, { ...input, id: 'stale', target: agentTarget, enabled: true })).toBeNull();
    expect(stale.enabled).toBe(false);
    // Automations saved before this guard can still be switched off, but not re-targeted to a missing chat.
    fresh.target = agentTarget;
    expect(updateAutomationInSnapshot(snapshot, { ...input, id: 'fresh', target: agentTarget, enabled: false })).not.toBeNull();
    expect(fresh.enabled).toBe(false);
    expect(updateAutomationInSnapshot(snapshot, { ...input, id: 'fresh', target: { kind: 'agent', agentId: 'other-missing' }, enabled: false })).toBeNull();
  });

  it('disables new Quick Chat automations when their team is gone', () => {
    const snapshot = setup();
    const automation = createAutomationInSnapshot(snapshot, input, 'created', () => 'auto')!;
    snapshot.teams = [];
    expect(disableUnavailableAutomationsInSnapshot(snapshot, 'later')).toBe(true);
    expect(automation.enabled).toBe(false);
  });

  it('fails active runs whose conversation was removed so the automation can run again', () => {
    const snapshot = setup();
    const automation = createAutomationInSnapshot(snapshot, input, 'created', () => 'auto')!;
    recordAutomationExecutionInSnapshot(snapshot, 'auto', { ...execution('done'), startedAt: '2026-10-06T10:00:00Z' });
    recordAutomationExecutionInSnapshot(snapshot, 'auto', { ...execution('live', 'working'), agentId: 'agent-jesse' });
    recordAutomationExecutionInSnapshot(snapshot, 'auto', { ...execution('gone', 'awaitingInput'), agentId: 'removed' });
    recordAutomationExecutionInSnapshot(snapshot, 'auto', { ...execution('pending', 'working'), agentId: undefined });
    expect(failOrphanedAutomationExecutionsInSnapshot(snapshot, 'now')).toBe(true);
    const status = (id: string) => automation.executionLog.find(run => run.id === id)!;
    expect(status('gone')).toMatchObject({ status: 'failed', completedAt: 'now', error: 'The automation conversation was removed.' });
    expect(automation).toMatchObject({ lastError: 'The automation conversation was removed.', updatedAt: 'now' });
    expect(['done', 'live', 'pending'].map(id => status(id).status)).toStrictEqual(['completed', 'working', 'working']);
    expect(failOrphanedAutomationExecutionsInSnapshot(snapshot, 'again')).toBe(false);
  });
});
