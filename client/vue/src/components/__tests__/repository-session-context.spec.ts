import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { resolveRepositorySessionContext } from '../repository-session-context';

describe('repository session context', () => {
  it('prefers an explicit team and resolves the remote location of the source', () => {
    const snapshot = createInitialSnapshot();
    snapshot.teams.push({ id: 'team-mixed', name: 'Mixed', agentIds: [] });

    expect(resolveRepositorySessionContext(snapshot, { teamId: 'team-mixed', remoteConnectionId: ' connection-one ' }, 'team-app')).toStrictEqual({
      teamId: 'team-mixed',
      remoteConnectionId: 'connection-one',
      location: { kind: 'remote', remoteConnectionId: 'connection-one' },
    });
  });

  it('takes the location of the source agent when the source names none', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.remoteConnectionId = 'connection-two';

    expect(resolveRepositorySessionContext(snapshot, { agentId: snapshot.agents[0]!.id })).toMatchObject({
      remoteConnectionId: 'connection-two',
      location: { kind: 'remote', remoteConnectionId: 'connection-two' },
    });
  });

  it('falls back from the source agent to the active team', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.teamId = 'team-app';

    expect(resolveRepositorySessionContext(snapshot, { agentId: snapshot.agents[0]!.id })).toMatchObject({
      teamId: 'team-app',
      remoteConnectionId: undefined,
      location: undefined,
    });
    expect(resolveRepositorySessionContext(snapshot, null, 'team-app').teamId).toBe('team-app');
  });
});
