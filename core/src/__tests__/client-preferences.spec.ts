import { describe, expect, it } from 'vitest';
import { projectClientSnapshot, sanitizeClientPreferences, splitSettingsInput } from '../client-preferences';
import { createInitialSnapshot } from '../snapshot';

describe('client preference projection', () => {
  it('splits backend policy and presentation without inventing changes', () => {
    expect(splitSettingsInput({})).toStrictEqual({ policy: {}, preferences: {} });
    const input = { general: { agentListCompact: true, preventSleepWhenAgentsRun: false }, theme: { mode: 'dark' as const }, sourceFolder: { path: '/src' }, workProviders: { github: { oauthClientId: 'client-id' } } };
    expect(splitSettingsInput(input)).toStrictEqual({ policy: { general: { preventSleepWhenAgentsRun: false }, sourceFolder: input.sourceFolder, workProviders: input.workProviders }, preferences: { general: { agentListCompact: true }, theme: input.theme } });
    const draft = { id: 'draft', agentId: 'agent', text: 'Later', createdAt: 1000 };
    expect(splitSettingsInput({ general: { savedPromptDrafts: [draft] } })).toStrictEqual({
      policy: {}, preferences: { general: { savedPromptDrafts: [draft] } },
    });
    expect(splitSettingsInput({ general: { followUpBehavior: 'steer' } })).toStrictEqual({
      policy: {}, preferences: { general: { followUpBehavior: 'steer' } },
    });
    const browserBookmarks = [{ title: 'Preview', url: 'http://localhost:5173/' }];
    expect(splitSettingsInput({ general: { browserBookmarks } })).toStrictEqual({
      policy: {}, preferences: { general: { browserBookmarks } },
    });
  });

  it('projects ordering, per-team selection and appearance without mutating the shared snapshot', () => {
    const snapshot = createInitialSnapshot();
    expect(projectClientSnapshot(snapshot, 'new')).toBe(snapshot);
    const first = snapshot.agents[0]!, second = snapshot.agents[1]!;
    snapshot.teams.push({ id: 'team-other', name: 'Other', agentIds: [] });
    snapshot.clientPreferences = { phone: {
      activeTeamId: first.teamId, activeAgentId: second.id,
      activeAgentByTeam: { [first.teamId!]: second.id }, teamOrder: ['team-other'],
      agentOrderByTeam: { [first.teamId!]: [second.id, first.id] },
      externalApplications: { [second.id]: 'xcode' }, general: { agentListCompact: true }, theme: { mode: 'dark' },
    } };
    const original = structuredClone(snapshot);
    const projected = projectClientSnapshot(snapshot, 'phone');
    expect(projected.teams[0]?.id).toBe('team-other');
    expect(projected.teams[1]?.agentIds.slice(0, 2)).toStrictEqual([second.id, first.id]);
    expect(projected.teams[1]?.activeAgentId).toBe(second.id);
    expect(projected.activeAgentId).toBe(second.id);
    expect(projected.agents[1]?.openInApplication).toBe('xcode');
    expect(projected.general.agentListCompact).toBe(true);
    expect(projected.theme.mode).toBe('dark');
    expect(snapshot).toStrictEqual(original);
  });

  it('repairs deleted targets and follows a selected agent moved to another team', () => {
    const snapshot = createInitialSnapshot();
    const first = snapshot.agents[0]!;
    snapshot.clientPreferences = { phone: { activeAgentId: 'deleted', activeTeamId: 'deleted', activeAgentByTeam: { [first.teamId!]: 'deleted' } } };
    expect(projectClientSnapshot(snapshot, 'phone').activeAgentId).toBe(first.id);
    snapshot.clientPreferences.phone = { activeAgentId: null };
    expect(projectClientSnapshot(snapshot, 'phone').activeAgentId).toBeNull();
    snapshot.clientPreferences.phone = {};
    expect(projectClientSnapshot(snapshot, 'phone').activeAgentId).toBe(snapshot.activeAgentId);
    snapshot.clientPreferences.phone = { activeAgentId: first.id };
    first.teamId = 'moved';
    expect(projectClientSnapshot(snapshot, 'phone').activeTeamId).toBe('moved');
    delete first.teamId;
    expect(projectClientSnapshot(snapshot, 'phone').activeTeamId).toBe(snapshot.activeTeamId);
    snapshot.agents = []; snapshot.teams = [];
    expect(projectClientSnapshot(snapshot, 'phone').activeAgentId).toBeNull();
  });

  it('sanitizes persisted client profiles without importing backend policy', () => {
    expect(sanitizeClientPreferences(null)).toStrictEqual({});
    expect(sanitizeClientPreferences([])).toStrictEqual({});
    const sanitized = sanitizeClientPreferences({ phone: { activeAgentId: null, activeTeamId: 'team', activeAgentByTeam: { team: 'agent', invalid: 4 }, teamOrder: ['team', 4], agentOrderByTeam: { team: ['agent', null], invalid: null }, externalApplications: { agent: 'xcode', invalid: 'rm' }, general: { agentListCompact: true, preventSleepWhenAgentsRun: false }, theme: { mode: 'dark' } }, invalid: false });
    expect(sanitized.phone).toMatchObject({ activeAgentId: null, activeTeamId: 'team', activeAgentByTeam: { team: 'agent' }, teamOrder: ['team'], agentOrderByTeam: { team: ['agent'], invalid: [] }, externalApplications: { agent: 'xcode' }, general: { agentListCompact: true }, theme: { mode: 'dark' } });
    expect(sanitized.phone?.general).not.toHaveProperty('preventSleepWhenAgentsRun');
    expect(sanitized.invalid).not.toHaveProperty('activeAgentId');
  });
});
