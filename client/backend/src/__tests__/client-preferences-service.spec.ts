import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { projectClientSnapshot } from '@workspace/core/client-preferences';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { ClientPreferencesService } from '../client-preferences-service';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';

describe('client presentation preferences', () => {
  it('merges overlapping provider favorite patches and persists clearing only the selected provider', async () => {
    const snapshot = createInitialSnapshot();
    const service = new ClientPreferencesService({ snapshot: async () => snapshot, save: async (id, preferences) => {
      await Promise.resolve();
      snapshot.clientPreferences = { ...snapshot.clientPreferences, [id]: preferences };
    } });
    await Promise.all([
      service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { backlogRepositoryFavorites: { github: ['owner/repo'] } } } }),
      service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { backlogRepositoryFavorites: { linear: ['team-id', 'team-id'], unknown: ['invalid'] } } } }),
    ]);
    expect(projectClientSnapshot(snapshot, 'desktop').general.backlogRepositoryFavorites).toStrictEqual({ github: ['owner/repo'], linear: ['team-id'] });
    await service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { backlogRepositoryFavorites: { github: [] } } } });
    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));
    expect(projectClientSnapshot(restored, 'desktop').general.backlogRepositoryFavorites).toStrictEqual({ github: [], linear: ['team-id'] });
    expect(projectClientSnapshot(restored, 'other-client').general.backlogRepositoryFavorites).toStrictEqual({});
  });

  it('retains bookmarks after restart and agent deletion while preserving unrelated client settings', async () => {
    const snapshot = createInitialSnapshot();
    const service = new ClientPreferencesService({ snapshot: async () => snapshot, save: async (id, preferences) => {
      snapshot.clientPreferences = { ...snapshot.clientPreferences, [id]: preferences };
    } });
    await service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { theme: { mode: 'dark' }, general: { agentListCompact: true } } });
    const browserBookmarks = [{ title: 'Preview', url: 'http://localhost:5173/' }];
    await service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { browserBookmarks: [
      ...browserBookmarks,
      { title: 'Duplicate', url: 'http://LOCALHOST:5173/' },
      { title: 'Credentials', url: 'https://user:secret@example.com/' },
      { title: 'Unsafe', url: 'javascript:alert(1)' },
    ] } } });
    expect(snapshot.clientPreferences?.desktop?.general?.browserBookmarks).toStrictEqual(browserBookmarks);
    snapshot.agents = [];
    snapshot.teams = [];
    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));
    const client = projectClientSnapshot(restored, 'desktop');
    expect(client.general.browserBookmarks).toStrictEqual(browserBookmarks);
    expect(client.general.agentListCompact).toBe(true);
    expect(client.theme.mode).toBe('dark');
    expect(projectClientSnapshot(restored, 'other-client').general.browserBookmarks ?? []).toStrictEqual([]);
    await service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { browserBookmarks: [] } } });
    expect(projectClientSnapshot(snapshot, 'desktop').general.browserBookmarks).toStrictEqual([]);
  });
  it('isolates selection and appearance across clients without mutating runtime state', async () => {
    const snapshot = createInitialSnapshot();
    const original = structuredClone(snapshot);
    const save = vi.fn(async (id, preferences) => { snapshot.clientPreferences = { ...snapshot.clientPreferences, [id]: preferences }; });
    const service = new ClientPreferencesService({ snapshot: async () => snapshot, save });
    const secondAgent = snapshot.agents[1]!;
    await service.update('phone', backendMethods.clientNavigationSelectAgent, { agentId: secondAgent.id });
    await service.update('phone', backendMethods.clientPreferencesUpdate, { input: { general: { agentListCompact: true, followUpBehavior: 'steer' } } });
    await service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { agentListCompact: false } } });
    expect(snapshot.activeAgentId).toBe(original.activeAgentId);
    expect(snapshot.general).toStrictEqual(original.general);
    expect(projectClientSnapshot(snapshot, 'phone').activeAgentId).toBe(secondAgent.id);
    expect(projectClientSnapshot(snapshot, 'phone').general.agentListCompact).toBe(true);
    expect(projectClientSnapshot(snapshot, 'desktop').activeAgentId).toBe(original.activeAgentId);
    expect(projectClientSnapshot(snapshot, 'desktop').general.agentListCompact).toBe(false);
    expect(save).toHaveBeenCalledTimes(3);
    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));
    expect(projectClientSnapshot(restored, 'phone').activeAgentId).toBe(secondAgent.id);
    expect(projectClientSnapshot(restored, 'phone').general.agentListCompact).toBe(true);
    expect(projectClientSnapshot(restored, 'phone').general.followUpBehavior).toBe('steer');
    expect(projectClientSnapshot(restored, 'desktop').general.followUpBehavior).toBe('queue');
    await expect(service.update('phone', backendMethods.clientPreferencesUpdate, { input: { sourceFolder: { path: '/repo' } } })).rejects.toThrow('Backend policies');
  });

  it('serializes simultaneous updates for one client without losing unrelated preferences', async () => {
    const snapshot = createInitialSnapshot();
    const service = new ClientPreferencesService({ snapshot: async () => snapshot, save: async (id, preferences) => {
      await Promise.resolve();
      snapshot.clientPreferences = { ...snapshot.clientPreferences, [id]: preferences };
    } });
    await Promise.all([
      service.update('phone', backendMethods.clientNavigationSelectAgent, { agentId: snapshot.agents[1]!.id }),
      service.update('phone', backendMethods.clientPreferencesUpdate, { input: { general: { agentListCompact: true } } }),
    ]);
    const projected = projectClientSnapshot(snapshot, 'phone');
    expect(projected.activeAgentId).toBe(snapshot.agents[1]!.id);
    expect(projected.general.agentListCompact).toBe(true);
    snapshot.agents[1]!.teamId = 'moved';
    snapshot.teams.push({ id: 'moved', name: 'Moved', agentIds: [snapshot.agents[1]!.id] });
    expect(projectClientSnapshot(snapshot, 'phone').activeTeamId).toBe('moved');
  });
});
