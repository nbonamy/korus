import { product } from '@workspace/core/product';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendCodexHomeDir, backendHomeDir, backendLegacyStateFilePath, backendProviderTokensFilePath, backendSettingsFilePath, deleteBackendMissionHome, ensureBackendCodexHome, ensureBackendMissionHome, loadBackendSnapshot, saveBackendSnapshot } from '../state';
import { persistedStateFromSnapshot } from '../state-persistence';

describe('backend state loading', () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'daemon-state-'));
    homeDir = path.join(tempDir, 'home');
    vi.stubEnv('HOME', tempDir);
    vi.stubEnv('USERPROFILE', tempDir);
    expect(os.homedir()).toBe(tempDir);
    vi.stubEnv('APP_HOME', homeDir);
    vi.stubEnv('KORUS_HOME', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tempDir, { recursive: true, force: true });
  });

  it(`defaults the backend home to ~/${product.homeDirectory}`, () => {
    vi.stubEnv('APP_HOME', '');

    expect(backendHomeDir()).toBe(path.join(os.homedir(), product.homeDirectory));
  });

  it.each(['primary', 'alias', 'blank primary'] as const)('resolves the backend home and derived paths using %s', mode => {
    vi.stubEnv('APP_HOME', mode === 'primary' ? homeDir : mode === 'alias' ? undefined : '   ');
    vi.stubEnv('KORUS_HOME', mode === 'primary' ? '/unused-alias' : ` ${homeDir} `);
    expect(backendHomeDir()).toBe(homeDir);
    expect(backendCodexHomeDir()).toBe(path.join(homeDir, 'codex-home'));
    expect(backendLegacyStateFilePath()).toBe(path.join(homeDir, 'state.json'));
    expect(backendSettingsFilePath()).toBe(path.join(homeDir, 'settings.json'));
    expect(backendProviderTokensFilePath()).toBe(path.join(homeDir, 'provider-tokens.json'));
  });

  it(`creates an isolated Codex home under the ${product.name} backend home`, async () => {
    await expect(ensureBackendCodexHome()).resolves.toBe(path.join(homeDir, 'codex-home'));
    const directory = await stat(path.join(homeDir, 'codex-home'));
    expect(directory.isDirectory()).toBe(true);
  });

  it(`creates a mission-owned artifact directory under the ${product.name} backend home`, async () => {
    await expect(ensureBackendMissionHome('mission-billing')).resolves.toBe(path.join(homeDir, 'missions', 'mission-billing'));
    expect((await stat(path.join(homeDir, 'missions', 'mission-billing', 'artifacts'))).isDirectory()).toBe(true);
    await expect(ensureBackendMissionHome('../outside')).rejects.toThrow('Invalid mission ID');
  });

  it('deletes only the validated mission-owned directory', async () => {
    const missionHome = await ensureBackendMissionHome('mission-billing');
    await writeFile(path.join(missionHome, 'artifacts', 'requirements.md'), '# Billing');

    await deleteBackendMissionHome('mission-billing');

    await expect(stat(missionHome)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(deleteBackendMissionHome('../outside')).rejects.toThrow('Invalid mission ID');
  });

  it('creates a default snapshot when no state file exists', async () => {
    const snapshot = await loadBackendSnapshot();

    expect(snapshot.activeTeamId).toBe('team-app');
    await expect(readFile(path.join(homeDir, 'state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a monolithic desktop home without changing it and still imports it on SSH hosts', async () => {
    const snapshot = await loadBackendSnapshot();
    const persisted = {
      ...persistedStateFromSnapshot(snapshot),
      teams: [{ id: 'team-loaded', name: 'Loaded', agentIds: [] }],
      activeTeamId: 'team-loaded',
    };
    const original = JSON.stringify(persisted);
    const stateFile = path.join(homeDir, 'state.json');
    await writeFile(stateFile, original, 'utf8');

    await expect(loadBackendSnapshot()).rejects.toThrow(/state\.json.*0\.57\.0/);
    expect(await readdir(homeDir)).toStrictEqual(['state.json']);
    expect(await readFile(stateFile, 'utf8')).toBe(original);

    await expect(loadBackendSnapshot({ allowLegacyStartup: true })).resolves.toMatchObject({
      activeTeamId: 'team-loaded',
      teams: [{ id: 'team-loaded' }],
    });
    await expect(loadBackendSnapshot()).resolves.toMatchObject({ activeTeamId: 'team-loaded' });
  });

  it('requires a roster at the desktop upgrade floor before rewriting any files', async () => {
    await saveBackendSnapshot(await loadBackendSnapshot());
    const rosterFile = path.join(homeDir, 'roster.json');
    const settingsFile = path.join(homeDir, 'settings.json');
    const original = JSON.stringify({ ...JSON.parse(await readFile(rosterFile, 'utf8')), schemaVersion: 4 });
    const settings = JSON.stringify({ ...JSON.parse(await readFile(settingsFile, 'utf8')), schemaVersion: 1 });
    await writeFile(rosterFile, original);
    await writeFile(settingsFile, settings);

    await expect(loadBackendSnapshot()).rejects.toThrow(/roster\.json.*0\.57\.0/);
    expect(await readFile(rosterFile, 'utf8')).toBe(original);
    expect(await readFile(settingsFile, 'utf8')).toBe(settings);
    await expect(stat(path.join(homeDir, 'backups'))).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(loadBackendSnapshot({ allowLegacyStartup: true })).resolves.toMatchObject({ activeTeamId: 'team-app' });
    await expect(loadBackendSnapshot()).resolves.toMatchObject({ activeTeamId: 'team-app' });
  });

  it('saves backend snapshots into the alias home’s versioned roster and settings files', async () => {
    vi.stubEnv('APP_HOME', '');
    vi.stubEnv('KORUS_HOME', homeDir);
    const snapshot = await loadBackendSnapshot();
    await saveBackendSnapshot(snapshot);

    const persisted = JSON.parse(await readFile(path.join(homeDir, 'roster.json'), 'utf8')) as { schemaVersion: number; data: Record<string, unknown> };
    expect(persisted.schemaVersion).toBe(6);
    expect(persisted.data).not.toHaveProperty('messages');
    await expect(readFile(path.join(homeDir, 'state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(loadBackendSnapshot()).resolves.toMatchObject({ activeTeamId: 'team-app' });
  });

  it('falls back to a default snapshot for malformed state shape', async () => {
    await loadBackendSnapshot();
    await writeFile(path.join(homeDir, 'state.json'), JSON.stringify({ teams: [] }), 'utf8');

    await expect(loadBackendSnapshot({ allowLegacyStartup: true })).resolves.toMatchObject({
      activeTeamId: 'team-app',
    });
  });
});
