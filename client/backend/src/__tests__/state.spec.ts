import { product } from '@workspace/core/product';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
    vi.stubEnv('APP_HOME', homeDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tempDir, { recursive: true, force: true });
  });

  it(`defaults the backend home to ~/${product.homeDirectory}`, () => {
    vi.stubEnv('APP_HOME', '');

    expect(backendHomeDir()).toBe(path.join(os.homedir(), product.homeDirectory));
  });

  it('uses APP_HOME as the only backend home override', () => {
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

  it('migrates an existing state.json on first load', async () => {
    const snapshot = await loadBackendSnapshot();
    const persisted = {
      ...persistedStateFromSnapshot(snapshot),
      teams: [{ id: 'team-loaded', name: 'Loaded', agentIds: [] }],
      activeTeamId: 'team-loaded',
    };
    await writeFile(path.join(homeDir, 'state.json'), JSON.stringify(persisted), 'utf8');

    await expect(loadBackendSnapshot()).resolves.toMatchObject({
      activeTeamId: 'team-loaded',
      teams: [{ id: 'team-loaded' }],
    });
  });

  it('saves backend snapshots into the versioned roster and settings files', async () => {
    const snapshot = await loadBackendSnapshot();
    await saveBackendSnapshot(snapshot);

    const persisted = JSON.parse(await readFile(path.join(homeDir, 'roster.json'), 'utf8')) as { schemaVersion: number; data: Record<string, unknown> };
    expect(persisted.schemaVersion).toBe(4);
    expect(persisted.data).not.toHaveProperty('messages');
    await expect(readFile(path.join(homeDir, 'state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(loadBackendSnapshot()).resolves.toMatchObject({ activeTeamId: 'team-app' });
  });

  it('falls back to a default snapshot for malformed state shape', async () => {
    await loadBackendSnapshot();
    await writeFile(path.join(homeDir, 'state.json'), JSON.stringify({ teams: [] }), 'utf8');

    await expect(loadBackendSnapshot()).resolves.toMatchObject({
      activeTeamId: 'team-app',
    });
  });
});
