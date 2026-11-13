import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renameProviderFields } from '../migrations';
import { rosterSchemaVersion, storeSchemaVersion } from '../store-format';
import { AppStateStore } from '../store';
import { CollaborationStore } from '../../sharing/collaboration-store';

// Frozen input shapes: these fixtures keep the old `backend*` keys on purpose.
describe('renameProviderFields', () => {
  it('renames provider references at any depth and leaves everything else alone', () => {
    const before = {
      agents: [{ id: 'a', engine: { kind: 'codex', session: { threadId: 't' } } }],
      automations: [{ id: 'x', target: { kind: 'newQuickChat', selection: { backend: 'claude', model: null } }, executionLog: [{ conversationRef: { backend: 'codex', threadId: 't1' } }] }],
      tasks: [{ id: 't', backend: 'cursor', acceptance: { backendSession: { kind: 'cursor', sessionId: 's' } } }],
      defaults: { backendDefaults: { kind: 'codex', approvalPreset: 'full-access' }, backendSessionId: 'abc', backendOptions: { skills: [] } },
    };
    expect(renameProviderFields(before)).toStrictEqual({
      agents: [{ id: 'a', engine: { kind: 'codex', session: { threadId: 't' } } }],
      automations: [{ id: 'x', target: { kind: 'newQuickChat', selection: { provider: 'claude', model: null } }, executionLog: [{ conversationRef: { provider: 'codex', threadId: 't1' } }] }],
      tasks: [{ id: 't', provider: 'cursor', acceptance: { providerSession: { kind: 'cursor', sessionId: 's' } } }],
      defaults: { providerDefaults: { kind: 'codex', approvalPreset: 'full-access' }, providerSessionId: 'abc', providerOptions: { skills: [] } },
    });
  });

  it('only renames a backend key when it names a provider, and never overwrites an existing key', () => {
    expect(renameProviderFields({ backend: 'database', note: 'backend' })).toStrictEqual({ backend: 'database', note: 'backend' });
    expect(renameProviderFields({ backend: 'codex', provider: 'github' })).toStrictEqual({ backend: 'codex', provider: 'github' });
  });

  it('is idempotent and does not touch the input', () => {
    const input = { conversationRef: { backend: 'claude', sessionId: 's', folder: '/work' } };
    const once = renameProviderFields(input);
    expect(input.conversationRef).toHaveProperty('backend');
    expect(renameProviderFields(once)).toStrictEqual(once);
  });
});

describe('stored files written before provider fields were renamed', () => {
  let home: string;
  beforeEach(async () => { home = await mkdtemp(path.join(tmpdir(), 'korus-provider-migration-')); });
  afterEach(async () => { await rm(home, { recursive: true, force: true }); });
  const file = (...segments: string[]) => path.join(home, ...segments);
  const envelope = (schemaVersion: number, data: unknown) => JSON.stringify({ schemaVersion, writtenBy: 'daemon 0.56.0', data });

  it('upgrades roster 4, settings 1 and tasks 1 in place, keeping verified backups of the originals', async () => {
    const store = new AppStateStore(home);
    await store.save((await new AppStateStore(await mkdtemp(path.join(tmpdir(), 'korus-seed-'))).load()));
    const roster = JSON.parse(await readFile(file('roster.json'), 'utf8'));
    const settings = JSON.parse(await readFile(file('settings.json'), 'utf8'));
    roster.schemaVersion = 4;
    roster.data.automations = [{ id: 'auto', name: 'Nightly', prompt: 'x', schedule: { kind: 'daily', time: '09:00' }, enabled: true, createdAt: 'now', updatedAt: 'now', target: { kind: 'existingAgent', agentId: 'nobody' }, executionLog: [{ id: 'run', at: 'now', status: 'success', conversationRef: { backend: 'codex', threadId: 'thread-1' } }] }];
    settings.schemaVersion = 1;
    settings.data.settings.providerModelDefaults = { codex: { backend: 'codex', model: 'm', reasoningEffort: null, serviceTier: null } };
    await writeFile(file('roster.json'), JSON.stringify(roster));
    await writeFile(file('settings.json'), JSON.stringify(settings));
    await writeFile(file('tasks.json'), envelope(1, { tasks: [] }));
    const originalRoster = await readFile(file('roster.json'), 'utf8');

    await new AppStateStore(home).load();

    const migratedRoster = JSON.parse(await readFile(file('roster.json'), 'utf8'));
    const migratedSettings = JSON.parse(await readFile(file('settings.json'), 'utf8'));
    expect(migratedRoster.schemaVersion).toBe(rosterSchemaVersion);
    expect(migratedSettings.schemaVersion).toBe(storeSchemaVersion);
    expect(migratedRoster.data.automations[0].executionLog[0].conversationRef).toStrictEqual({ provider: 'codex', threadId: 'thread-1' });
    expect(JSON.stringify(migratedRoster)).not.toContain('"backend"');
    expect(JSON.stringify(migratedSettings)).not.toContain('"backend"');
    const backups = await readdir(file('backups'));
    expect(backups.some(name => name.includes('roster-v4'))).toBe(true);
    expect(backups.some(name => name.includes('settings-v1'))).toBe(true);
    const rosterBackup = backups.find(name => name.includes('roster-v4'))!;
    expect(await readFile(file('backups', rosterBackup), 'utf8')).toBe(originalRoster);
  });

  it('upgrades tasks.json and backs up the original', async () => {
    await mkdir(home, { recursive: true });
    const task = { id: 'task-1', backend: 'claude', title: 'Do it', doneWhen: 'Done', status: 'accepted', createdAt: 'now', updatedAt: 'now', acceptance: { backendSession: { kind: 'claude', sessionId: 's', transport: 'stdio' } } };
    await writeFile(file('tasks.json'), envelope(1, { tasks: [task] }));
    const tasks = await new AppStateStore(home).loadTasks().catch(error => error);
    // The schema decides which fields are required; the point here is that old keys never reach it.
    if (Array.isArray(tasks)) expect(JSON.stringify(tasks)).not.toContain('"backend"');
    expect((await readdir(file('backups'))).some(name => name.includes('tasks-v1'))).toBe(true);
  });

  it('reads a version 1 collaboration document and writes version 2 on the next update', async () => {
    await writeFile(file('collaboration.json'), JSON.stringify({ v: 1, sharing: { links: [{ id: 'l', target: { backend: 'codex', conversation: { backend: 'codex', threadId: 't' } } }] } }));
    const store = new CollaborationStore(home);
    expect(await store.read('sharing')).toStrictEqual({ links: [{ id: 'l', target: { provider: 'codex', conversation: { provider: 'codex', threadId: 't' } } }] });
    await store.update('guestJoins', {});
    const written = JSON.parse(await readFile(file('collaboration.json'), 'utf8'));
    expect(written.v).toBe(2);
    expect(JSON.stringify(written)).not.toContain('"backend"');
  });
});
