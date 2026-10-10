import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import type { DelegatedTask } from '@workspace/core/delegated-task';
import { AppStateStore } from '../store';
import { serializeStoreFile } from '../store-format';

let home: string;
beforeEach(async () => { home = await mkdtemp(path.join(os.tmpdir(), 'app-tasks-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });
const task = (): DelegatedTask => ({
  id: 'task-1', requestId: 'request-1', requestFingerprint: 'fingerprint', parentAgentId: 'parent', workerAgentId: 'worker',
  backend: 'codex', assignment: { title: 'Repair', doneWhen: 'Test passes' }, prompt: 'Repair the issue', attemptId: 'attempt-1',
  state: 'completed', createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z', parentWakeBlocked: false,
  acceptance: { backendSession: { kind: 'codex', threadId: 'thread' }, turnId: 'turn' },
  submission: { id: 'result-1', attemptId: 'attempt-1', turnId: 'turn', backendSession: { kind: 'codex', threadId: 'thread' }, summary: 'Repaired', evidence: ['Test passes'], artifacts: ['src/fix.ts'], caveats: [] },
  delivery: { id: 'delivery-1', state: 'pending' },
});

describe('tasks.json persistence', () => {
  it('retains a Claude worker native store reference in acceptance and result after restart', async () => {
    const value = task();
    value.backend = 'claude';
    const backendSession = { kind: 'claude' as const, sessionId: 'native-child', transport: 'stdio' as const, transcriptFolder: '/parent-provider-store' };
    value.acceptance!.backendSession = backendSession;
    value.submission!.backendSession = backendSession;
    await new AppStateStore(home).saveTasks([value]);
    expect(await new AppStateStore(home).loadTasks()).toStrictEqual([value]);
  });
  it('adds tasks to an older layout without putting them in the roster or discarding them on roster save', async () => {
    const store = new AppStateStore(home);
    await store.save(createEmptySnapshot());
    expect(await store.loadTasks()).toEqual([]);
    await Promise.all([store.saveTasks([task()]), store.save(createEmptySnapshot())]);
    const restored = await new AppStateStore(home).loadTasks();
    expect(restored).toStrictEqual([task()]);
    expect(JSON.parse(await readFile(path.join(home, 'roster.json'), 'utf8')).data.tasks).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(home, 'tasks.json'), 'utf8')).schemaVersion).toBe(1);
    await new AppStateStore(home).save(createEmptySnapshot());
    expect(await new AppStateStore(home).loadTasks()).toStrictEqual([task()]);
  });

  it.each(['preparing', 'running', 'needs-input', 'interrupted', 'failed', 'completed', 'cancelled'] as const)('round-trips %s, including retained provisional results and delivery identity', async state => {
    const value = { ...task(), state, ...(state === 'completed' ? {} : { delivery: undefined }) };
    const store = new AppStateStore(home);
    await store.saveTasks([value]);
    expect(await new AppStateStore(home).loadTasks()).toStrictEqual(JSON.parse(JSON.stringify([value])));
  });

  it.each([
    '{broken',
    serializeStoreFile({ tasks: [{ ...task(), unexpected: true }] }),
    serializeStoreFile({ tasks: [{ ...task(), submission: undefined }] }),
    serializeStoreFile({ tasks: [task(), task()] }),
    serializeStoreFile({ tasks: [{ ...task(), state: 'invented' }] }),
    serializeStoreFile({ tasks: [{ ...task(), state: 'running' }] }),
    serializeStoreFile({ tasks: [{ ...task(), delivery: { id: 'delivery-1', state: 'accepted' } }] }),
    serializeStoreFile({ tasks: [{ ...task(), acceptance: { backendSession: { kind: 'claude', sessionId: 'session', transport: 'stdio', unknown: true } } }] }),
    JSON.stringify({ schemaVersion: 999, data: { tasks: [] } }),
  ])('refuses corrupt or unsupported task data instead of treating it as empty', async content => {
    await writeFile(path.join(home, 'tasks.json'), content);
    await expect(new AppStateStore(home).loadTasks()).rejects.toThrow();
    expect(await readFile(path.join(home, 'tasks.json'), 'utf8')).toBe(content);
  });

  it('serializes task writes and rejects invalid writes without replacing the last good file', async () => {
    const store = new AppStateStore(home);
    await Promise.all([store.saveTasks([task()]), store.saveTasks([{ ...task(), state: 'cancelled', delivery: undefined }])]);
    expect((await store.loadTasks())[0]!.state).toBe('cancelled');
    expect(() => store.saveTasks([{ ...task(), state: 'completed', submission: undefined }])).toThrow();
    expect((await store.loadTasks())[0]!.state).toBe('cancelled');
  });
});
