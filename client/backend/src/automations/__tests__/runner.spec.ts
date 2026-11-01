import { describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { createAgentInSnapshot } from '@workspace/core/agent-manager';
import { createMission } from '@workspace/core/missions';
import type { Automation } from '@workspace/core/contracts';
import { AutomationRunner, automationIsDue } from '../runner';

function setup(target: Automation['target'] = { kind: 'newQuickChat', teamId: 'team', selection: { backend: 'codex', model: null, reasoningEffort: null, serviceTier: null } }) {
  const snapshot = createEmptySnapshot();
  snapshot.teams = [{ id: 'team', name: 'Team', agentIds: [] }];
  snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, enabled: true, checking: false }];
  createAgentInSnapshot(snapshot, { name: 'Existing', folder: '/repo', teamId: 'team' }, '', 'existing');
  const automation: Automation = { id: 'auto', name: 'Daily check', enabled: true, prompt: 'Check my tasks', target,
    schedule: { intervalMinutes: 60 }, executionLog: [], createdAt: '', updatedAt: '' };
  snapshot.automations = [automation];
  const sendPrompt = vi.fn().mockResolvedValue({ backend: 'codex', threadId: 'thread' });
  const saveSnapshot = vi.fn().mockResolvedValue(undefined);
  const runner = new AutomationRunner({ getSnapshot: () => snapshot, sendPrompt, saveSnapshot,
    notifySnapshotUpdated: vi.fn(), now: () => new Date('2026-10-06T12:00:00Z') });
  return { snapshot, automation, runner, sendPrompt, saveSnapshot };
}

describe('scheduled prompts', () => {
  it('waits for the calendar occurrence, catches up once after downtime, and keeps timing after restart', async () => {
    const { snapshot, automation, sendPrompt, saveSnapshot } = setup({ kind: 'agent', agentId: 'existing' });
    automation.schedule = { rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0;BYSECOND=0', timeZone: 'America/Chicago' };
    automation.createdAt = '2026-10-06T12:00:00Z';
    let now = new Date('2026-10-06T12:59:59Z');
    const runner = new AutomationRunner({ getSnapshot: () => snapshot, sendPrompt, saveSnapshot, notifySnapshotUpdated: vi.fn(), now: () => now });
    await runner.runAll();
    expect(sendPrompt).not.toHaveBeenCalled();
    now = new Date('2026-10-09T15:00:00Z');
    await runner.runAll();
    expect(sendPrompt).toHaveBeenCalledOnce();
    runner.handleEvent({ type: 'turn.completed', agentId: 'existing', payload: {} } as never);
    const restarted = new AutomationRunner({ getSnapshot: () => snapshot, sendPrompt, saveSnapshot, notifySnapshotUpdated: vi.fn(), now: () => now });
    await restarted.runAll();
    expect(sendPrompt).toHaveBeenCalledOnce();
    now = new Date('2026-10-10T13:00:00Z');
    await restarted.runAll();
    expect(sendPrompt).toHaveBeenCalledTimes(2);
  });
  it('does not dispatch after an automation is disabled during persistence', async () => {
    const { automation, runner, sendPrompt, saveSnapshot } = setup();
    saveSnapshot.mockImplementationOnce(async () => { automation.enabled = false; });
    await runner.runAutomation('auto');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(automation.executionLog[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('disabled') });
  });

  it('records a disconnected provider failure without creating a replacement chat', async () => {
    const { snapshot, automation, sendPrompt, saveSnapshot } = setup();
    const runner = new AutomationRunner({ getSnapshot: () => snapshot, sendPrompt, saveSnapshot,
      notifySnapshotUpdated: vi.fn(), requireConnectedEngine: async () => { throw new Error('Sign in to Codex'); } });
    await runner.runAutomation('auto');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(snapshot.agents).toHaveLength(1);
    expect(automation.executionLog[0]).toMatchObject({ status: 'failed', error: 'Sign in to Codex' });
  });
  it('runs only when due and recovers interrupted runs honestly after restart', async () => {
    const { automation, runner, sendPrompt } = setup();
    automation.enabled = false;
    await runner.runAll();
    expect(sendPrompt).not.toHaveBeenCalled();
    automation.enabled = true;
    automation.lastRunAt = '2026-10-06T11:01:00Z';
    expect(automationIsDue(automation, new Date('2026-10-06T12:00:00Z'))).toBe(false);
    automation.lastRunAt = '2026-10-06T11:00:00Z';
    await runner.runAll();
    expect(sendPrompt).toHaveBeenCalledOnce();
    await runner.recoverInterruptedRuns();
    expect(automation.executionLog[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('restart') });
  });

  it('fails a run whose conversation was removed so the schedule is not blocked forever', async () => {
    const { snapshot, automation, sendPrompt, saveSnapshot } = setup();
    let now = new Date('2026-10-06T12:00:00Z');
    const runner = new AutomationRunner({ getSnapshot: () => snapshot, sendPrompt, saveSnapshot, notifySnapshotUpdated: vi.fn(), now: () => now });
    await runner.runAutomation('auto');
    const chat = automation.executionLog[0]!.agentId!;
    expect(automation.executionLog[0]).toMatchObject({ status: 'working' });
    snapshot.agents = snapshot.agents.filter(agent => agent.id !== chat);
    now = new Date('2026-10-06T13:00:00Z');
    await runner.runAll();
    expect(automation.executionLog.map(run => run.status)).toStrictEqual(['working', 'failed']);
    expect(automation.executionLog[1]).toMatchObject({ error: 'The automation conversation was removed.', completedAt: '2026-10-06T13:00:00.000Z' });
    expect(sendPrompt).toHaveBeenCalledTimes(2);
  });

  it('waits a full interval after re-enabling rather than using an old last run', () => {
    const { automation } = setup();
    automation.createdAt = '2026-10-01T12:00:00Z';
    automation.lastRunAt = '2026-10-02T12:00:00Z';
    automation.scheduleAnchorAt = '2026-10-06T12:00:00Z';
    expect(automationIsDue(automation, new Date('2026-10-06T12:30:00Z'))).toBe(false);
    expect(automationIsDue(automation, new Date('2026-10-06T13:00:00Z'))).toBe(true);
  });

  it('honors fresh-chat model overrides without changing global settings or permission defaults', async () => {
    const { snapshot, runner, automation } = setup({ kind: 'newQuickChat', teamId: 'team', selection: { backend: 'codex', model: 'chosen', reasoningEffort: 'high', serviceTier: 'fast' } });
    const general = structuredClone(snapshot.general);
    await runner.runAutomation('auto');
    expect(snapshot.agents.find(agent => agent.id === automation.executionLog[0]!.agentId)?.backendDefaults)
      .toMatchObject({ model: 'chosen', reasoningEffort: 'high', serviceTier: 'fast' });
    expect(snapshot.general).toStrictEqual(general);
  });

  it('waits for busy existing chats and prevents two schedules using the same target concurrently', async () => {
    const { snapshot, runner, sendPrompt, automation } = setup({ kind: 'quickChat', agentId: 'existing' });
    snapshot.agents[0]!.sessionKind = 'quickChat';
    snapshot.agents[0]!.status = { type: 'working' };
    await runner.runAutomation('auto');
    expect(sendPrompt).not.toHaveBeenCalled();
    snapshot.agents[0]!.status = { type: 'idle' };
    snapshot.automations.push({ ...automation, id: 'second', executionLog: [] });
    await Promise.all([runner.runAutomation('auto'), runner.runAutomation('second')]);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('reports provider errors and interrupted turns as failures', async () => {
    const { runner, automation } = setup({ kind: 'agent', agentId: 'existing' });
    await runner.runAutomation('auto');
    runner.handleEvent({ type: 'turn.completed', agentId: 'existing', payload: { turn: { status: 'interrupted' } } } as never);
    expect(automation.executionLog[0]).toMatchObject({ status: 'failed', error: 'Turn interrupted.' });
    await runner.runAutomation('auto');
    runner.handleEvent({ type: 'agent.statusChanged', agentId: 'existing', payload: { type: 'error', message: 'Session expired' } } as never);
    expect(automation.executionLog[0]).toMatchObject({ status: 'failed', error: 'Session expired' });
  });
  it.each(['codex', 'claude', 'antigravity'] as const)('creates fresh %s quick chats without changing selection or provider, retaining run history', async backend => {
    const { snapshot, automation, runner, sendPrompt } = setup({ kind: 'newQuickChat', teamId: 'team', selection: { backend, model: null, reasoningEffort: null, serviceTier: null } });
    snapshot.providerConnections = [{ backend, installed: true, connected: true, enabled: true, checking: false }];
    const conversationRef = backend === 'codex' ? { backend, threadId: 'thread' } : { backend, sessionId: 'session', folder: null };
    sendPrompt.mockResolvedValue(conversationRef);
    await runner.runAutomation('auto');
    const run = automation.executionLog[0]!;
    const chat = snapshot.agents.find(agent => agent.id === run.agentId)!;
    expect(chat).toMatchObject({ backend, sessionKind: 'quickChat', folder: null, teamId: 'team' });
    expect(snapshot.activeAgentId).toBe('existing');
    expect(sendPrompt).toHaveBeenCalledWith(chat.id, 'Check my tasks');
    expect(run).toMatchObject({ status: 'working', conversationRef });
    runner.handleEvent({ type: 'turn.completed', agentId: chat.id, payload: {} } as never);
    expect(run.status).toBe('completed');
    await runner.runAutomation('auto');
    expect(automation.executionLog).toHaveLength(2);
    expect(automation.executionLog[0]!.agentId).not.toBe(chat.id);
    expect(snapshot.agents.find(agent => agent.id === automation.executionLog[0]!.agentId)?.backend).toBe(backend);
  });

  it('reuses the selected agent without changing its model or permissions and blocks overlapping runs', async () => {
    const { snapshot, automation, runner, sendPrompt } = setup({ kind: 'agent', agentId: 'existing' });
    createMission(snapshot, { outcome: 'Ship a feature', workflowType: 'shapeAndShipFeature', teamId: 'team', orchestratorMemberId: 'existing' });
    const originalDefaults = structuredClone(snapshot.agents[0]!.backendDefaults);
    await Promise.all([runner.runAutomation('auto'), runner.runAutomation('auto')]);
    await runner.runAutomation('auto');
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0]!.backendDefaults).toEqual(originalDefaults);
    runner.handleEvent({ type: 'agent.statusChanged', agentId: 'existing', payload: { type: 'awaitingInput' } } as never);
    expect(automation.executionLog[0]!.status).toBe('awaitingInput');
    runner.handleEvent({ type: 'agent.statusChanged', agentId: 'existing', payload: { type: 'idle' } } as never);
    expect(automation.executionLog[0]!.status).toBe('awaitingInput');
    runner.handleEvent({ type: 'turn.completed', agentId: 'existing', payload: {} } as never);
    expect(automation.executionLog[0]!.status).toBe('completed');
  });

  it('records dispatch failures and missing targets without launching replacement chats', async () => {
    const { automation, runner, sendPrompt } = setup({ kind: 'agent', agentId: 'missing' });
    await runner.runAutomation('auto');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(automation.executionLog[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('available') });
    automation.target = { kind: 'agent', agentId: 'existing' };
    sendPrompt.mockRejectedValueOnce(new Error('Signed out'));
    await runner.runAutomation('auto');
    expect(automation.executionLog[0]).toMatchObject({ status: 'failed', error: 'Signed out' });
  });
});
