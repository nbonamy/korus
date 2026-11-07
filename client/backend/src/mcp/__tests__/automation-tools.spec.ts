import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppStateStore } from '../../persistence/store';
import { AppMcpService } from '../service';
import { workItemComposerPrompt } from '@workspace/core/work-item-prompts';
import { AutomationRunner } from '../../automations/runner';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function harness(failSave = false) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'automation-tool-'));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const store = new AppStateStore(home);
  const snapshot = createInitialSnapshot();
  snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
  snapshot.agents[0]!.sessionKind = 'quickChat';
  snapshot.agents[0]!.folder = null;
  const onEvent = vi.fn();
  const service = new AppMcpService({ snapshot, onEvent, persistSnapshot: async () => {
    if (failSave) throw new Error('Disk full');
    await store.save(snapshot);
  } });
  const url = await service.start();
  cleanups.push(() => service.stop());
  const call = async (args: unknown, name = 'create-automation') => {
    const response = await fetch(`${url}?agentId=agent-dina`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return (await response.json() as { result: CallToolResult }).result;
  };
  return { snapshot, store, onEvent, call };
}

const input = { requestId: 'daily-check', name: 'Daily check', prompt: 'Check my tasks', schedule: { intervalMinutes: 60 }, enabled: false };

it('restores and dispatches scheduled GitLab backlog context independently of GitHub and Linear', async () => {
  const { call, store } = await harness();
  const prompts: string[] = [];
  for (const provider of ['github', 'gitlab', 'linear'] as const) {
    const prompt = workItemComposerPrompt({ provider, id: `${provider}:item`, sourceId: `${provider}:source`, sourceName: 'Backlog scope', kind: provider === 'gitlab' ? 'pullRequest' : 'issue', identifier: provider === 'gitlab' ? '!7' : '#7', title: 'Inspect work', url: `https://${provider}.com/item`, body: 'Review only', state: 'open', labels: [], createdAt: '', updatedAt: '' });
    prompts.push(prompt.trim());
    expect((await call({ ...input, requestId: provider, name: provider, prompt, enabled: true, target: { kind: 'current' } })).isError).toBe(false);
  }
  const restored = await store.load();
  expect(restored.automations.map(automation => automation.prompt)).toStrictEqual(prompts);
  const sendPrompt = vi.fn().mockResolvedValue({ backend: 'codex', threadId: 'scheduled' });
  const runner = new AutomationRunner({ getSnapshot: () => restored, saveSnapshot: async () => {}, notifySnapshotUpdated: vi.fn(), sendPrompt });
  await runner.runAutomation(restored.automations[1]!.id);
  expect(sendPrompt).toHaveBeenCalledWith('agent-dina', expect.stringContaining('GitLab merge request !7'));
  expect(restored.workBacklog.assignments).toStrictEqual({});
  expect(restored.automations[0]!.executionLog).toStrictEqual([]);
  expect(restored.automations[2]!.executionLog).toStrictEqual([]);
});

it('creates durable UI-visible automations from a Quick Chat and makes retried creation idempotent', async () => {
  const { call, snapshot, store, onEvent } = await harness();
  const settings = structuredClone(snapshot.general);
  const result = await call(input);
  expect(result.isError).toBe(false);
  expect(result.structuredContent).toMatchObject({ success: true, automationId: expect.any(String), enabled: false });
  expect((await store.load()).automations).toEqual(snapshot.automations);
  expect(snapshot.automations[0]).toMatchObject({ prompt: input.prompt, target: { kind: 'newQuickChat', teamId: 'team-app', selection: { backend: 'codex' } } });
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'snapshot.updated' }));
  expect((await call(input)).structuredContent).toEqual(result.structuredContent);
  expect(snapshot.automations).toHaveLength(1);
  expect((await call({ ...input, prompt: 'Something different' })).isError).toBe(true);
  expect((await call({ ...input, requestId: 'current', target: { kind: 'current' } })).isError).toBe(false);
  expect(snapshot.automations[1]?.target).toEqual({ kind: 'quickChat', agentId: 'agent-dina' });
  expect((await call({ ...input, requestId: 'custom-model', enabled: undefined, selection: { model: 'chosen', reasoningEffort: 'high' } })).isError).toBe(false);
  expect(snapshot.automations[2]).toMatchObject({ enabled: true, target: { kind: 'newQuickChat', selection: { backend: 'codex', model: 'chosen', reasoningEffort: 'high' } } });
  expect(snapshot.general).toEqual(settings);
});

it('rejects invalid schedules, foreign targets, and model overrides on existing conversations', async () => {
  const { call, snapshot } = await harness();
  snapshot.agents[1]!.teamId = 'another-team';
  for (const args of [
    { ...input, schedule: { intervalMinutes: 0 } }, { ...input, prompt: '' },
    { ...input, target: { kind: 'agent', agentId: 'agent-jesse' } },
    { ...input, target: { kind: 'current' }, model: 'override' },
    { ...input, target: { kind: 'current' }, backend: 'claude' },
    { ...input, target: { kind: 'current' }, reasoningEffort: 'high' },
  ]) expect((await call(args)).isError).toBe(true);
  expect(JSON.stringify(await call({ ...input, target: { kind: 'current' }, selection: { model: 'override' } }))).toContain('Existing conversations retain their backend, model and effort');
  expect(snapshot.automations).toEqual([]);
});

it('persists a timezone-aware daily calendar request and returns its future first occurrence', async () => {
  const { call, store } = await harness();
  const schedule = { rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0;BYSECOND=0', timeZone: 'America/Chicago' };
  const before = Date.now();
  const result = await call({ ...input, schedule });
  expect(result.isError).toBe(false);
  expect((await store.load()).automations[0]?.schedule).toEqual(schedule);
  const next = new Date(result.structuredContent!.nextRunAt as string);
  expect(next.getTime()).toBeGreaterThan(before);
  expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' }).format(next)).toBe('08:00');
  expect((await call({ ...input, requestId: 'bad-zone', schedule: { ...schedule, timeZone: 'invalid' } })).isError).toBe(true);
});

it('does not claim success or leave a runnable automation when persistence fails', async () => {
  const { call, snapshot, onEvent } = await harness(true);
  const result = await call({ ...input, enabled: true });
  expect(result.isError).toBe(true);
  expect(snapshot.automations).toEqual([]);
  expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'snapshot.updated' }));
});

it('lists exact targets and edits a saved automation without losing history or silently retargeting it', async () => {
 const {call,snapshot,store}=await harness();
 await call({...input,target:{kind:'current'}});
 const list=await call({},'list-automations');
 expect(list.isError).not.toBe(true);
 const listed=(list.structuredContent!.automations as Array<{id:string;updatedAt:string;target:unknown;targetInfo:unknown}>)[0]!;
 expect(listed.target).toStrictEqual({kind:'quickChat',agentId:'agent-dina'});
 expect(listed.targetInfo).toMatchObject({agentId:'agent-dina',isCurrentConversation:true});
 const saved=snapshot.automations[0]!;saved.executionLog=[{id:'past',automationId:saved.id,status:'completed',startedAt:'2026-01-01T00:00:00Z'}];
 const result=await call({id:saved.id,expectedUpdatedAt:listed.updatedAt,name:'Renamed'},'update-automation');
 expect(result.isError).not.toBe(true);
 expect(saved.target).toStrictEqual({kind:'quickChat',agentId:'agent-dina'});
 expect(saved.executionLog).toHaveLength(1);
 expect((await store.load()).automations[0]).toStrictEqual(saved);
 expect((await call({id:saved.id,expectedUpdatedAt:listed.updatedAt,enabled:true},'update-automation')).isError).toBe(true);
 expect((await call({id:saved.id,expectedUpdatedAt:saved.updatedAt,target:{kind:'newQuickChat'}},'update-automation')).isError).not.toBe(true);
 expect(saved.target).toMatchObject({kind:'newQuickChat',teamId:'team-app',selection:{backend:'codex'}});
});

it('limits listing and editing to the caller team and rolls back failed saves', async () => {
 const {call,snapshot}=await harness(true);
 const {createAutomationInSnapshot}=await import('@workspace/core/automation-manager');
 const saved=createAutomationInSnapshot(snapshot,{name:'Existing',prompt:'Check',enabled:false,target:{kind:'agent',agentId:'agent-jesse'},schedule:{intervalMinutes:60}})!;
 const before=structuredClone(saved);
 expect((await call({id:saved.id,expectedUpdatedAt:saved.updatedAt,name:'Changed'},'update-automation')).isError).toBe(true);
 expect(snapshot.automations[0]).toStrictEqual(before);
 snapshot.agents[1]!.teamId='different-team';
 expect((await call({},'list-automations')).structuredContent!.automations).toStrictEqual([]);
 expect((await call({id:saved.id,expectedUpdatedAt:saved.updatedAt,name:'Changed'},'update-automation')).isError).toBe(true);
});
