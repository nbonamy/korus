import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot } from '@workspace/core/contracts';
import type { Visualization } from '@workspace/core/visualize';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../../state-persistence';
import { AppStateStore } from '../store';
import { StoreFormatError, parseStoreFile } from '../store-format';
import { projectClientSnapshot } from '@workspace/core/client-preferences';

const visualization = (id: string): Visualization => ({ id, title: id, content: { kind: 'mermaid', source: 'flowchart LR; A --> B' }, createdAt: '2026-09-21T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z' });

let home = '';
beforeEach(async () => { home = await mkdtemp(path.join(os.tmpdir(), 'app-store-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

const file = (...segments: string[]) => path.join(home, ...segments);
const exists = (...segments: string[]) => stat(file(...segments)).then(() => true, () => false);
const readJson = async (...segments: string[]) => JSON.parse(await readFile(file(...segments), 'utf8')) as { schemaVersion: number; data: Record<string, unknown> };

function snapshotWithVisualizations(): AppSnapshot {
  const snapshot = createInitialSnapshot();
  snapshot.repositoryVisualizations = { '/projects/app': [visualization('visualization-a'), visualization('visualization-b')] };
  return snapshot;
}

function snapshotWithCalendar(): AppSnapshot {
  const snapshot = createInitialSnapshot();
  snapshot.automations = [{ id: 'calendar', name: 'Daily refresh', enabled: true, prompt: 'Refresh calendar',
    target: { kind: 'agent', agentId: snapshot.agents[0]!.id },
    schedule: { rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0;BYSECOND=0', timeZone: 'America/Chicago' },
    createdAt: '2026-10-07T01:19:04.000Z', updatedAt: '2026-10-07T01:19:04.000Z', executionLog: [] }];
  return snapshot;
}

describe('AppStateStore', () => {
  it('persists bookmarks by owning client through restart, agent deletion and removal', async () => {
    const snapshot = createInitialSnapshot();
    const desktopBookmarks = [{ title: 'Desktop preview', url: 'http://localhost:5173/' }];
    const otherBookmarks = [{ title: 'Other preview', url: 'https://example.com/' }];
    snapshot.clientPreferences = {
      desktop: { general: { browserBookmarks: desktopBookmarks, agentListCompact: true }, theme: { mode: 'dark' } },
      other: { general: { browserBookmarks: otherBookmarks } },
    };
    await new AppStateStore(home).save(snapshot);
    const restored = await new AppStateStore(home).load();
    expect(projectClientSnapshot(restored, 'desktop').general.browserBookmarks).toStrictEqual(desktopBookmarks);
    expect(projectClientSnapshot(restored, 'other').general.browserBookmarks).toStrictEqual(otherBookmarks);
    expect(projectClientSnapshot(restored, 'new-client').general.browserBookmarks ?? []).toStrictEqual([]);
    expect(restored.general.agentListCompact).toBe(true);
    expect(restored.theme.mode).toBe('dark');
    restored.agents = [];
    restored.teams = [];
    restored.clientPreferences!.desktop!.general!.browserBookmarks = [];
    await new AppStateStore(home).save(restored);
    const afterRemoval = await new AppStateStore(home).load();
    expect(projectClientSnapshot(afterRemoval, 'desktop').general.browserBookmarks).toStrictEqual([]);
    expect(projectClientSnapshot(afterRemoval, 'other').general.browserBookmarks).toStrictEqual(otherBookmarks);
  });
  it.each(['codex', 'claude', 'antigravity'] as const)('loads additive store fields without blocking existing %s agents', async backend => {
    const snapshot = snapshotWithVisualizations();
    const agent = snapshot.agents[0]!;
    agent.backend = backend;
    agent.backendSession = backend === 'codex' ? { kind: backend, threadId: 'thread' }
      : backend === 'claude' ? { kind: backend, sessionId: 'session', transport: 'stdio' }
        : { kind: backend, sessionId: 'session' };
    delete agent.backendDefaults;
    snapshot.subagentTrees[agent.id] = { rootConversationId: 'root', nodes: {}, operations: {}, activities: {} };
    await new AppStateStore(home).save(snapshot);
    const expected = await new AppStateStore(home).load();
    const roster = await readJson('roster.json');
    roster.data.futureRosterField = { enabled: true };
    const engine = (roster.data.agents as Array<{ engine: Record<string, unknown> }>)[0]!.engine;
    engine.futureEngineField = true;
    (engine.session as Record<string, unknown>).futureSessionField = 'extra';
    (roster.data.subagents as Record<string, Record<string, unknown>>)[agent.id]!.futureTreeField = true;
    await writeFile(file('roster.json'), JSON.stringify(roster));
    const settings = await readJson('settings.json');
    settings.data.futureSettingsField = true;
    (settings.data.workIntegrations as Record<string, unknown>).futureIntegrationField = true;
    await writeFile(file('settings.json'), JSON.stringify(settings));
    const [directory] = await readdir(file('visualizations'));
    for (const name of await readdir(file('visualizations', directory!))) {
      const document = await readJson('visualizations', directory!, name);
      document.data.futureDocumentField = true;
      await writeFile(file('visualizations', directory!, name), JSON.stringify(document));
    }

    const store = new AppStateStore(home);
    const restored = await store.load();
    expect(restored).toStrictEqual(expected);
    restored.agents[0]!.name = 'Still usable';
    await store.save(restored);
    const restarted = await new AppStateStore(home).load();
    expect(restarted.agents[0]!.name).toBe('Still usable');
    expect(restarted.repositoryVisualizations).toStrictEqual(expected.repositoryVisualizations);
  });

  it.each([1, 2])('loads supported agents and preserves unknown providers across schema-%i saves and restarts', async (schemaVersion) => {
    const snapshot = createInitialSnapshot();
    await new AppStateStore(home).save(snapshot);
    const roster = await readJson('roster.json');
    roster.schemaVersion = schemaVersion;
    const unknown = { id: 'future-agent', name: null, folder: '/future', createdAt: '2026-10-09',
      engine: { kind: 'future-provider', session: { opaque: ['future-session'] },
        settings: { model: 'gemini-3.6-flash-low', permissionMode: 'auto_edit' }, extra: true },
      futureField: { untouched: true } };
    (roster.data.agents as unknown[]).splice(1, 0, unknown);
    const teams = roster.data.teams as Array<{ id: string; agentIds: string[]; activeAgentId?: string }>;
    teams[0]!.agentIds.splice(1, 0, unknown.id);
    teams[0]!.activeAgentId = unknown.id;
    const membership = [...teams[0]!.agentIds];
    const subagents = { rootConversationId: 'future-root', nodes: { child: { opaque: true } } };
    (roster.data.subagents as Record<string, unknown>)[unknown.id] = subagents;
    const assignment = { agentId: unknown.id, opaque: 'future-assignment' };
    (roster.data.workAssignments as Record<string, unknown>).future = assignment;
    await writeFile(file('roster.json'), JSON.stringify(roster));
    const original = await readFile(file('roster.json'), 'utf8');
    const logs: string[] = [];
    const store = new AppStateStore(home, { log: message => logs.push(message) });

    const restored = await store.load();
    expect(restored.agents.map(agent => agent.id)).toStrictEqual(snapshot.agents.map(agent => agent.id));
    expect(restored.teams[0]!.agentIds).toStrictEqual(snapshot.teams[0]!.agentIds);
    expect(restored.activeAgentId).toBe(snapshot.agents[0]!.id);
    expect(restored.subagentTrees[unknown.id]).toBeUndefined();
    expect(restored.workBacklog.assignments.future).toBeUndefined();
    expect(logs.join('\n')).toContain(unknown.id);
    if (schemaVersion === 2) expect(await readFile(file('roster.json'), 'utf8')).toBe(original);
    restored.agents[0]!.name = 'Changed while future provider is unavailable';
    await store.save(restored);

    const saved = await readJson('roster.json');
    expect((saved.data.agents as unknown[])[1]).toStrictEqual(unknown);
    expect((saved.data.teams as typeof teams)[0]!.agentIds).toStrictEqual(membership);
    expect((saved.data.subagents as Record<string, unknown>)[unknown.id]).toStrictEqual(subagents);
    expect((saved.data.workAssignments as Record<string, unknown>).future).toStrictEqual(assignment);
    const restarted = new AppStateStore(home);
    const reloaded = await restarted.load();
    expect(reloaded.agents[0]!.name).toBe('Changed while future provider is unavailable');
    await restarted.save(reloaded);
    expect((await readJson('roster.json')).data).toStrictEqual(saved.data);
  });

  it('preserves unknown agents when supported teammates or their teams are removed', async () => {
    const snapshot = createInitialSnapshot();
    await new AppStateStore(home).save(snapshot);
    const roster = await readJson('roster.json');
    const agents = roster.data.agents as Array<{ id: string; engine: unknown }>;
    const unknownA = { ...agents[0]!, id: 'unknown-a', engine: { kind: 'future-alpha' } };
    const unknownB = { ...unknownA, id: 'unknown-b', engine: { kind: 'future-provider' } };
    agents.push(unknownA, unknownB);
    const teams = roster.data.teams as Array<{ id: string; agentIds: string[] }>;
    teams[0]!.agentIds.push(unknownA.id);
    teams.push({ ...teams[0]!, id: 'future-team', agentIds: [unknownB.id] });
    await writeFile(file('roster.json'), JSON.stringify(roster));

    const store = new AppStateStore(home);
    const restored = await store.load();
    const removed = snapshot.agents[0]!.id;
    restored.agents = restored.agents.filter(agent => agent.id !== removed);
    restored.teams = restored.teams.filter(team => team.id !== 'future-team');
    restored.teams[0]!.agentIds = restored.teams[0]!.agentIds.filter(id => id !== removed);
    await store.save(restored);

    const saved = await readJson('roster.json');
    const savedAgents = saved.data.agents as typeof agents;
    expect(savedAgents.find(agent => agent.id === unknownA.id)).toStrictEqual(unknownA);
    expect(savedAgents.find(agent => agent.id === unknownB.id)).toStrictEqual(unknownB);
    expect(savedAgents.some(agent => agent.id === removed)).toBe(false);
    expect((saved.data.teams as typeof teams).map(team => [team.id, team.agentIds]))
      .toStrictEqual([[snapshot.teams[0]!.id, [snapshot.agents[1]!.id, unknownA.id]], ['future-team', [unknownB.id]]]);
    expect((await new AppStateStore(home).load()).agents.map(agent => agent.id)).toStrictEqual([snapshot.agents[1]!.id]);
  });

  it.each([
    { kind: 'codex', session: { threadId: 123 } },
    { kind: 'claude', session: { sessionId: 'session', transport: 'invalid' } },
    { kind: 'antigravity', session: { sessionId: 123 } },
    {},
  ])('still refuses corrupt engine data: %j', async engine => {
    await new AppStateStore(home).save(createInitialSnapshot());
    const roster = await readJson('roster.json');
    (roster.data.agents as Array<{ engine: unknown }>)[0]!.engine = engine;
    const original = JSON.stringify(roster);
    await writeFile(file('roster.json'), original);
    await expect(new AppStateStore(home).load()).rejects.toThrowError(StoreFormatError);
    expect(await readFile(file('roster.json'), 'utf8')).toBe(original);
  });

  it('protects calendar automations from schema-1 readers and retains them across restart', async () => {
    const snapshot = snapshotWithCalendar();
    await new AppStateStore(home).save(snapshot);
    const roster = await readFile(file('roster.json'), 'utf8');

    // Released schema-1 builds must fail before their old entity sanitizer drops the schedule.
    expect(() => parseStoreFile('roster.json', roster, 1)).toThrowError(/supports up to schema 1/);
    const restarted = new AppStateStore(home);
    const restored = await restarted.load();
    expect(restored.automations).toStrictEqual(snapshot.automations);
    restored.agents[0]!.name = 'Renamed after restart';
    await restarted.save(restored);
    expect((await new AppStateStore(home).load()).automations).toStrictEqual(snapshot.automations);
  });

  it('backs up and protects an existing v1 roster on load without losing prompt schedules or converting old loops', async () => {
    const snapshot = snapshotWithCalendar();
    await new AppStateStore(home).save(snapshot);
    const roster = await readJson('roster.json');
    roster.schemaVersion = 1;
    (roster.data.automations as unknown[]).push({ id: 'old-loop', name: 'Old loop', enabled: true,
      teamId: snapshot.teams[0]!.id, backend: 'codex', repositories: [{ provider: 'github', id: 'org/repo' }],
      schedule: { intervalMinutes: 60 }, createdAt: '', updatedAt: '', executionLog: [] });
    const original = JSON.stringify(roster);
    await writeFile(file('roster.json'), original);
    const settings = await readFile(file('settings.json'), 'utf8');

    const store = new AppStateStore(home);
    const restored = await store.load();
    expect(restored.automations).toStrictEqual(snapshot.automations);
    expect(restored.agents.map(agent => agent.id)).toStrictEqual(snapshot.agents.map(agent => agent.id));
    expect(() => parseStoreFile('roster.json', original, 1)).not.toThrow();
    const protectedRoster = await readFile(file('roster.json'), 'utf8');
    expect(() => parseStoreFile('roster.json', protectedRoster, 1)).toThrowError(StoreFormatError);
    const backups = await readdir(file('backups'));
    expect(backups).toHaveLength(1);
    expect(await readFile(file('backups', backups[0]!), 'utf8')).toBe(original);
    expect(await readFile(file('settings.json'), 'utf8')).toBe(settings);

    await store.save(restored);
    expect((await new AppStateStore(home).load()).automations).toStrictEqual(snapshot.automations);
    expect(await readdir(file('backups'))).toStrictEqual(backups);
  });

  it('does not rewrite an old roster when its upgrade backup fails', async () => {
    await new AppStateStore(home).save(snapshotWithCalendar());
    const roster = await readJson('roster.json');
    roster.schemaVersion = 1;
    const original = JSON.stringify(roster);
    await writeFile(file('roster.json'), original);
    await writeFile(file('backups'), 'not a directory');

    await expect(new AppStateStore(home).load()).rejects.toThrow();
    expect(await readFile(file('roster.json'), 'utf8')).toBe(original);
  });

  it('starts empty without creating files, then writes the versioned layout on the first save', async () => {
    const store = new AppStateStore(home);
    expect(await store.load()).toStrictEqual(createEmptySnapshot());
    expect(await readdir(home)).toStrictEqual([]);

    await store.save(snapshotWithVisualizations());

    expect((await readdir(home)).sort()).toStrictEqual(['roster.json', 'settings.json', 'visualizations']);
    expect((await readJson('roster.json')).schemaVersion).toBe(2);
    expect((await readJson('settings.json')).schemaVersion).toBe(1);
    const [directory] = await readdir(file('visualizations'));
    expect(directory).toMatch(/^app-[0-9a-f]{8}$/);
    expect((await readdir(file('visualizations', directory!))).sort()).toStrictEqual(['visualization-a.json', 'visualization-b.json']);
  });

  it('restores the saved snapshot in a fresh process', async () => {
    const snapshot = snapshotWithVisualizations();
    snapshot.general.providerApprovalDefaults = { codex: 'ask-for-approval', claude: 'acceptEdits' };
    snapshot.general.codeReviewDefaults = { backend: 'codex', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3, autoCommit: true }, providers: { codex: { model: 'review-model', reasoningEffort: 'high' }, claude: { model: 'sonnet' } } };
    await new AppStateStore(home).save(snapshot);

    const restored = await new AppStateStore(home).load();

    const expected = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));
    // The selection is stored once, on the active team.
    expected.teams[0]!.activeAgentId = expected.activeAgentId ?? undefined;
    expect(restored).toStrictEqual(expected);
    expect(restored.general.providerApprovalDefaults).toStrictEqual({ codex: 'ask-for-approval', claude: 'acceptEdits' });
    expect(restored.general.codeReviewDefaults).toStrictEqual({ backend: 'codex', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3, autoCommit: true }, providers: { codex: { model: 'review-model', reasoningEffort: 'high' }, claude: { model: 'sonnet' } } });
    expect((await readJson('settings.json')).schemaVersion).toBe(1);
    expect(restored.repositoryVisualizations?.['/projects/app']?.map((item) => item.id)).toStrictEqual(['visualization-a', 'visualization-b']);
  });

  it('rewrites only the files whose content changed', async () => {
    const snapshot = snapshotWithVisualizations();
    const store = new AppStateStore(home);
    await store.save(snapshot);
    const [directory] = await readdir(file('visualizations'));
    const visualizationFile = file('visualizations', directory!, 'visualization-a.json');
    const past = new Date('2020-01-01T00:00:00.000Z');
    await utimes(visualizationFile, past, past);

    snapshot.agents[0]!.name = 'Renamed';
    await store.save(snapshot);

    expect((await stat(visualizationFile)).mtime).toStrictEqual(past);
    expect(JSON.stringify(await readJson('roster.json'))).toContain('Renamed');
  });

  it('removes a deleted visualization and its empty repository folder as part of the save', async () => {
    const snapshot = snapshotWithVisualizations();
    const store = new AppStateStore(home);
    await store.save(snapshot);
    const [directory] = await readdir(file('visualizations'));

    snapshot.repositoryVisualizations = { '/projects/app': [visualization('visualization-b')] };
    await store.save(snapshot);
    expect(await readdir(file('visualizations', directory!))).toStrictEqual(['visualization-b.json']);

    snapshot.repositoryVisualizations = {};
    await store.save(snapshot);
    expect(await exists('visualizations', directory!)).toBe(false);
  });

  it('keeps the latest of overlapping saves', async () => {
    const store = new AppStateStore(home);
    const first = createInitialSnapshot();
    first.agents[0]!.name = 'First';
    const second = createInitialSnapshot();
    second.agents[0]!.name = 'Second';

    await Promise.all([store.save(first), store.save(second)]);

    expect((await new AppStateStore(home).load()).agents[0]!.name).toBe('Second');
  });

  it('refuses a roster written by a newer build and leaves it untouched', async () => {
    await new AppStateStore(home).save(createInitialSnapshot());
    const newer = JSON.stringify({ schemaVersion: 3, writtenBy: 'daemon 9.9.9', data: {} });
    await writeFile(file('roster.json'), newer);

    await expect(new AppStateStore(home).load()).rejects.toThrowError(/daemon 9\.9\.9/);
    expect(await readFile(file('roster.json'), 'utf8')).toBe(newer);
  });

  it('stops on a corrupt roster instead of starting empty', async () => {
    await new AppStateStore(home).save(createInitialSnapshot());
    await writeFile(file('roster.json'), '{"schemaVersion": 1, "data": {"teams": "nope"}}');

    await expect(new AppStateStore(home).load()).rejects.toThrowError(StoreFormatError);
    await writeFile(file('roster.json'), '{ truncated');
    await expect(new AppStateStore(home).load()).rejects.toThrowError(/not valid JSON/);
  });

  it('refuses a layout with a missing file rather than guessing', async () => {
    await new AppStateStore(home).save(createInitialSnapshot());
    await rm(file('settings.json'));
    await expect(new AppStateStore(home).load()).rejects.toThrowError(/settings\.json is missing/);
    await new AppStateStore(home).save(createInitialSnapshot()).catch(() => undefined);
    await rm(file('roster.json'));
    await expect(new AppStateStore(home).load()).rejects.toThrowError(/roster\.json/);
  });

  it('skips an unreadable visualization without deleting it', async () => {
    const snapshot = snapshotWithVisualizations();
    const logs: string[] = [];
    await new AppStateStore(home).save(snapshot);
    const [directory] = await readdir(file('visualizations'));
    const damaged = file('visualizations', directory!, 'visualization-a.json');
    await writeFile(damaged, 'half a file');

    const store = new AppStateStore(home, { log: (message) => logs.push(message) });
    const restored = await store.load();
    await store.save(restored);

    expect(restored.repositoryVisualizations?.['/projects/app']?.map((item) => item.id)).toStrictEqual(['visualization-b']);
    expect(logs.join('\n')).toContain('visualization-a.json');
    expect(await readFile(damaged, 'utf8')).toBe('half a file');
  });
});

describe('migrating the legacy state.json', () => {
  function legacyState() {
    const snapshot = snapshotWithVisualizations();
    snapshot.agents[0]!.statusText = 'Done';
    snapshot.agents[0]!.plan = { threadId: 't', turnId: 'turn', kind: 'execution', status: 'completed', explanation: '', steps: [], markdown: '- [x] done', updatedAt: '2026-10-01T00:00:00.000Z' };
    const desktopOrder = [...snapshot.teams[0]!.agentIds].reverse();
    return {
      snapshot,
      text: JSON.stringify({
        ...persistedStateFromSnapshot(snapshot),
        clientPreferences: { desktop: { activeAgentId: desktopOrder[0], activeTeamId: snapshot.teams[0]!.id, agentOrderByTeam: { [snapshot.teams[0]!.id]: desktopOrder }, theme: { mode: 'dark' } } },
      }),
      desktopOrder,
    };
  }

  it('backs up the original, writes the new layout, and replaces state.json with a marker old builds cannot parse', async () => {
    const { text, desktopOrder } = legacyState();
    await writeFile(file('state.json'), text);
    const logs: string[] = [];

    const migrated = await new AppStateStore(home, { log: (message) => logs.push(message) }).load();

    const [backup] = await readdir(file('backups'));
    expect(backup).toMatch(/^state-v0-.*\.json$/);
    expect(await readFile(file('backups', backup!), 'utf8')).toBe(text);
    expect((await readdir(home)).sort()).toStrictEqual(['backups', 'roster.json', 'settings.json', 'state.json', 'visualizations']);
    const marker = await readFile(file('state.json'), 'utf8');
    expect(() => JSON.parse(marker)).toThrow();
    expect(logs.join('\n')).toContain(backup);
    expect(migrated.teams[0]!.agentIds).toStrictEqual(desktopOrder);
    expect(migrated.activeAgentId).toBe(desktopOrder[0]);
    expect(migrated.theme.mode).toBe('dark');
    expect(migrated.agents[0]!.statusText).toBe('Done');
    expect(migrated.agents[0]).not.toHaveProperty('plan');
    expect(migrated.clientPreferences).toBeUndefined();
    expect(migrated.repositoryVisualizations?.['/projects/app']).toHaveLength(2);
    expect(await new AppStateStore(home).load()).toStrictEqual(migrated);
  });

  it('does not migrate twice, and a retired state.json without a roster is an error', async () => {
    await writeFile(file('state.json'), legacyState().text);
    await new AppStateStore(home).load();
    const backups = await readdir(file('backups'));

    await new AppStateStore(home).load();
    expect(await readdir(file('backups'))).toStrictEqual(backups);

    await rm(file('roster.json'));
    await expect(new AppStateStore(home).load()).rejects.toThrowError(/retired but roster\.json is missing/);
  });

  it('aborts before touching anything when the backup cannot be verified or written', async () => {
    const { text } = legacyState();
    await writeFile(file('state.json'), text);
    await writeFile(file('backups'), 'a file where the backups folder should be');

    await expect(new AppStateStore(home).load()).rejects.toThrowError();

    expect(await readFile(file('state.json'), 'utf8')).toBe(text);
    expect(await exists('roster.json')).toBe(false);
    expect(await exists('settings.json')).toBe(false);
  });

  it('redoes an interrupted migration from state.json and keeps the previous layout in backups', async () => {
    const { text } = legacyState();
    await writeFile(file('state.json'), text);
    await writeFile(file('roster.json'), '{"schemaVersion": 1, "data": "partial"}');
    await mkdir(file('visualizations', 'stale-00000000'), { recursive: true });
    await writeFile(file('visualizations', 'stale-00000000', 'visualization-stale.json'), '{}');

    const migrated = await new AppStateStore(home).load();

    expect(migrated.repositoryVisualizations?.['/projects/app']).toHaveLength(2);
    const archived = (await readdir(file('backups'))).find((name) => name.startsWith('layout-before-migration-'));
    expect(archived).toBeDefined();
    expect(await readFile(file('backups', archived!, 'roster.json'), 'utf8')).toContain('partial');
    expect(await exists('visualizations', 'stale-00000000')).toBe(false);
  });

  it('refuses a legacy file that is not JSON', async () => {
    await writeFile(file('state.json'), '{ "teams": ');
    await expect(new AppStateStore(home).load()).rejects.toThrowError(/not valid JSON/);
    expect(await exists('roster.json')).toBe(false);
  });
});
