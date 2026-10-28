import { describe, expect, it, vi } from 'vitest';
import { RemoteTeamService } from '../connections/remote-team-service';
import {
  createRemoteAgent,
  createRemoteTeamSnapshot,
  createTestSnapshot,
  readyRemoteConnection,
} from './server-test-fixtures';

describe('RemoteTeamService', () => {
  it('includes remote engine availability in the first projected snapshot', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{ id: 'pointer', name: 'Remote', remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }], agentIds: [] }];
    const remote = createRemoteTeamSnapshot([createRemoteAgent()]);
    remote.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    const service = new RemoteTeamService({
      clients: { request: vi.fn().mockResolvedValue({ snapshot: remote, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } }) } as never,
      getSnapshot: () => snapshot,
      onForwardedEvent: vi.fn(),
      onProjectedSnapshotChanged: vi.fn(),
    });

    const projected = await service.clientSnapshot();

    expect(projected.remoteConnections.connections[0]?.providerConnections).toEqual(remote.providerConnections);
    expect(projected.agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: remote.agents[0]!.id })]));
    expect(projected.providerConnections).toEqual(snapshot.providerConnections);
  });

  it('requires an explicit valid team instead of consulting shared navigation', async () => {
    const service = new RemoteTeamService({ clients: {} as never, getSnapshot: createTestSnapshot, onForwardedEvent: vi.fn(), onProjectedSnapshotChanged: vi.fn() });
    await expect(service.pointerForAgentInput({})).rejects.toThrow('target team');
    await expect(service.pointerForAgentInput({ teamId: 'missing' })).rejects.toThrow('Team not found');
    await expect(service.pointerForAgentInput({ teamId: 'team-test' })).resolves.toBeNull();
  });

  it('creates one hidden team per host on first use and reuses it afterwards', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const remote = createRemoteTeamSnapshot([]);
    const request = vi.fn(async () => structuredClone(remote));
    const service = new RemoteTeamService({ clients: { request } as never, getSnapshot: () => snapshot, onForwardedEvent: vi.fn(), onProjectedSnapshotChanged: vi.fn() });

    const first = await service.pointerForAgentInput({ teamId: 'team-test', remoteConnectionId: 'connection-devbox' });
    const second = await service.pointerForAgentInput({ teamId: 'team-test', remoteConnectionId: 'connection-devbox' });

    expect(first).toStrictEqual({ connectionId: 'connection-devbox', localTeamId: 'team-test', remoteTeamId: remote.activeTeamId });
    expect(second).toStrictEqual(first);
    expect(snapshot.teams[0]!.remoteLinks).toStrictEqual([{ connectionId: 'connection-devbox', remoteTeamId: remote.activeTeamId }]);
    expect(request).toHaveBeenCalledOnce();
    await expect(service.pointerForAgentInput({ teamId: 'team-test', remoteConnectionId: 'unknown' })).rejects.toThrow('Remote connection not found');
  });

  it('projects remote agents next to local ones in the same team and tags their host', () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const localAgent = { ...createRemoteAgent(), id: 'agent-local', teamId: 'team-test', name: 'Local' };
    snapshot.agents = [localAgent];
    snapshot.teams = [{ id: 'team-test', name: 'Mixed', agentIds: [localAgent.id], remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }] }];
    const remoteAgent = createRemoteAgent();
    const service = new RemoteTeamService({ clients: {} as never, getSnapshot: () => snapshot, onForwardedEvent: vi.fn(), onProjectedSnapshotChanged: vi.fn() });
    service.rememberSnapshot('connection-devbox', createRemoteTeamSnapshot([remoteAgent]));

    const projected = service.clientSnapshotFromKnownRemotes();

    expect(projected.teams[0]).toMatchObject({ name: 'Mixed', agentIds: [localAgent.id, remoteAgent.id] });
    expect(projected.agents.find((agent) => agent.id === remoteAgent.id)).toMatchObject({ teamId: 'team-test', remoteConnectionId: 'connection-devbox' });
    expect(projected.agents.find((agent) => agent.id === localAgent.id)?.remoteConnectionId).toBeUndefined();
    expect(snapshot.teams[0]!.agentIds).toStrictEqual([localAgent.id]);
    expect(service.connectionIdForAgent(projected.agents.find((agent) => agent.id === remoteAgent.id)!)).toBe('connection-devbox');
  });

  it('adopts valid remote snapshots while rejecting malformed snapshot payloads', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    const remoteAgent = createRemoteAgent();
    const initialRemoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    const fullSnapshot = structuredClone(initialRemoteSnapshot);
    const updatedSnapshot = structuredClone(initialRemoteSnapshot);
    updatedSnapshot.agents[0]!.name = 'Remote event update';
    const malformedFullSnapshot = structuredClone(initialRemoteSnapshot);
    malformedFullSnapshot.agents[0]!.name = 'Malformed event update';
    (malformedFullSnapshot as unknown as Record<string, unknown>).activeTeamId = 42;
    const onProjectedSnapshotChanged = vi.fn();
    const clients = {
      request: vi.fn(async (_connection, _method, _params, onEvent?: (event: unknown) => void) => {
        onEvent?.({
          seq: 1,
          type: 'snapshot.updated',
          payload: fullSnapshot,
          occurredAt: '2026-06-13T00:00:00.000Z',
        });
        onEvent?.({
          seq: 2,
          type: 'snapshot.updated',
          payload: updatedSnapshot,
          occurredAt: '2026-06-13T00:00:01.000Z',
        });
        onEvent?.({
          seq: 3,
          type: 'snapshot.updated',
          payload: malformedFullSnapshot,
          occurredAt: '2026-06-13T00:00:02.000Z',
        });
        return null;
      }),
    };
    const service = new RemoteTeamService({
      clients: clients as never,
      getSnapshot: () => snapshot,
      onForwardedEvent: vi.fn(),
      onProjectedSnapshotChanged,
    });
    service.rememberSnapshot('connection-devbox', initialRemoteSnapshot);

    await service.request('connection-devbox', 'test');

    const rememberedSnapshot = service.knownSnapshot('connection-devbox');
    expect(rememberedSnapshot).toBe(updatedSnapshot);
    expect(rememberedSnapshot?.agents[0]?.name).toBe('Remote event update');
    expect(onProjectedSnapshotChanged).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed snapshots returned by provider synchronization', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const service = new RemoteTeamService({
      clients: { request: vi.fn().mockResolvedValue({ snapshot: { agents: 'invalid' } }) } as never,
      getSnapshot: () => snapshot,
      onForwardedEvent: vi.fn(),
      onProjectedSnapshotChanged: vi.fn(),
    });

    await expect(service.snapshot('connection-devbox')).rejects.toThrow('Remote snapshot is invalid.');
    expect(service.knownSnapshot('connection-devbox')).toBeUndefined();
  });

  it('leaves remote engine policy independent from the local legacy flags', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const remoteSnapshot = createRemoteTeamSnapshot([]);
    remoteSnapshot.general.claudeCodeEnabled = false;
    const requests: string[] = [];
    const clients = {
      request: vi.fn(async (_connection, method: string, params?: { input?: { general?: { claudeCodeEnabled?: boolean } } }) => {
        requests.push(method);
        if (method === 'snapshot/get') return {
          snapshot: structuredClone(remoteSnapshot),
          lastEventSeq: 0,
          clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false },
        };
        if (method === 'settings/update') {
          remoteSnapshot.general.claudeCodeEnabled = params?.input?.general?.claudeCodeEnabled === true;
          return structuredClone(remoteSnapshot);
        }
        if (method === 'agent/quickChat/create') {
          return structuredClone(remoteSnapshot);
        }
        throw new Error(`Unexpected remote method: ${method}`);
      }),
    };
    const service = new RemoteTeamService({
      clients: clients as never,
      getSnapshot: () => snapshot,
      onForwardedEvent: vi.fn(),
      onProjectedSnapshotChanged: vi.fn(),
    });

    await expect(service.request('connection-devbox', 'agent/quickChat/create', {
      input: { backend: 'claude', teamId: 'team-remote' },
    })).resolves.toMatchObject({ general: { claudeCodeEnabled: false } });
    expect(requests).toStrictEqual(['agent/quickChat/create']);

    snapshot.general.claudeCodeEnabled = false;
    await expect(service.snapshot('connection-devbox')).resolves.toMatchObject({
      general: { claudeCodeEnabled: false },
    });
    expect(requests).toStrictEqual(['agent/quickChat/create', 'snapshot/get']);
  });

  it('adopts and forwards provider frames without restoring a global transcript', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    const remoteAgent = createRemoteAgent();
    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    const providerFrame = {
      seq: 1,
      occurredAt: '2026-06-13T00:00:01.000Z',
      agentId: remoteAgent.id,
      backend: 'codex',
      threadId: 'thread-remote',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 1,
        event: {
          seq: 1,
          occurredAt: '2026-06-13T00:00:01.000Z',
          origin: 'notification',
          conversationId: 'thread-remote',
          turnId: 'turn-1',
          type: 'turn.completed',
          payload: { status: 'completed' },
        },
      },
      snapshot: remoteSnapshot,
    } as const;
    const onForwardedEvent = vi.fn();
    const clients = {
      request: vi.fn(async (_connection, _method, _params, onEvent?: (event: unknown) => void) => {
        onEvent?.(providerFrame);
        onEvent?.({ ...providerFrame, seq: 2, snapshot: undefined });
        onEvent?.({ ...providerFrame, seq: 3, agentId: 'agent-outside-team', snapshot: undefined });
        onEvent?.({
          seq: 4,
          occurredAt: '2026-06-13T00:00:04.000Z',
          backend: 'codex',
          type: 'backend.statusChanged',
          payload: { backend: 'codex', status: 'running' },
        });
        return null;
      }),
    };
    const service = new RemoteTeamService({
      clients: clients as never,
      getSnapshot: () => snapshot,
      onForwardedEvent,
      onProjectedSnapshotChanged: vi.fn(),
    });

    await service.request('connection-devbox', 'agent/turn/delete');

    expect(service.knownSnapshot('connection-devbox')).toBe(remoteSnapshot);
    expect(service.knownSnapshot('connection-devbox')).not.toHaveProperty('messages');
    expect(onForwardedEvent).toHaveBeenCalledWith('connection-devbox', providerFrame);
    expect(onForwardedEvent).toHaveBeenCalledTimes(3);

    const coldForward = vi.fn();
    const coldService = new RemoteTeamService({
      clients: {
        request: vi.fn(async (_connection, _method, _params, onEvent?: (event: unknown) => void) => {
          onEvent?.({ ...providerFrame, snapshot: undefined });
          return null;
        }),
      } as never,
      getSnapshot: () => snapshot,
      onForwardedEvent: coldForward,
      onProjectedSnapshotChanged: vi.fn(),
    });
    await coldService.request('connection-devbox', 'agent/turn/delete');
    expect(coldForward).not.toHaveBeenCalled();
  });

  it('retains client navigation when adopting remote operation snapshots', () => {
    const snapshot = createTestSnapshot();
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    const service = new RemoteTeamService({
      clients: {} as never,
      getSnapshot: () => snapshot,
      onForwardedEvent: vi.fn(),
      onProjectedSnapshotChanged: vi.fn(),
    });
    const pointer = { connectionId: 'connection-devbox', localTeamId: 'team-pointer', remoteTeamId: 'team-remote' };
    const remoteAgent = createRemoteAgent();
    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    remoteSnapshot.activeAgentId = null;

    service.adoptCreatedAgentSnapshot(pointer, remoteSnapshot);
    expect(snapshot.activeAgentId).toBeNull();

    delete remoteSnapshot.teams[0]!.activeAgentId;
    service.adoptCreatedAgentSnapshot(pointer, remoteSnapshot);
    expect(snapshot.activeAgentId).toBeNull();

    remoteSnapshot.teams[0]!.agentIds = [];
    service.adoptCreatedAgentSnapshot(pointer, remoteSnapshot);
    expect(snapshot.activeAgentId).toBeNull();
  });

  it('projects transcript-free provider snapshots while preserving unrelated local metadata', () => {
    const snapshot = createTestSnapshot();
    const remoteAgent = createRemoteAgent();
    const unrelatedAgent = { ...createRemoteAgent(), id: 'agent-local', teamId: 'team-local', name: 'Local' };
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Stale name',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    snapshot.activeTeamId = 'team-pointer';
    snapshot.agents = [remoteAgent, unrelatedAgent];
    snapshot.agentGitStatuses = {
      [remoteAgent.id]: gitStatus(remoteAgent.id, 'stale'),
      [unrelatedAgent.id]: gitStatus(unrelatedAgent.id, 'local'),
    };
    snapshot.turnGitDiffs = {
      'turn-stale': turnDiff(remoteAgent.id, 'turn-stale'),
      'turn-local': turnDiff(unrelatedAgent.id, 'turn-local'),
    };
    snapshot.subagentTrees = {
      [remoteAgent.id]: subagentTree('thread-stale'),
      [unrelatedAgent.id]: subagentTree('thread-local'),
    };
    snapshot.workBacklog.assignments = {
      remote: assignment(remoteAgent.id),
      local: assignment(unrelatedAgent.id),
    };

    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    remoteSnapshot.agentGitStatuses = { [remoteAgent.id]: gitStatus(remoteAgent.id, 'remote') };
    remoteSnapshot.turnGitDiffs = { 'turn-remote': turnDiff(remoteAgent.id, 'turn-remote') };
    remoteSnapshot.subagentTrees = { [remoteAgent.id]: subagentTree('thread-remote') };
    remoteSnapshot.workBacklog.assignments = { remote: assignment(remoteAgent.id) };
    const service = new RemoteTeamService({
      clients: {} as never,
      getSnapshot: () => snapshot,
      onForwardedEvent: vi.fn(),
      onProjectedSnapshotChanged: vi.fn(),
    });
    service.rememberSnapshot('connection-devbox', remoteSnapshot);

    const projected = service.clientSnapshotFromKnownRemotes();

    expect(projected).not.toHaveProperty('messages');
    expect(projected.agents.map((agent) => agent.id)).toStrictEqual([unrelatedAgent.id, remoteAgent.id]);
    expect(projected.agentGitStatuses).toMatchObject({
      [unrelatedAgent.id]: { branch: 'local' },
      [remoteAgent.id]: { branch: 'remote' },
    });
    expect(projected.turnGitDiffs).toHaveProperty('turn-local');
    expect(projected.turnGitDiffs).toHaveProperty('turn-remote');
    expect(projected.turnGitDiffs).not.toHaveProperty('turn-stale');
    expect(projected.subagentTrees[remoteAgent.id]?.rootConversationId).toBe('thread-remote');
    expect(projected.workBacklog.assignments).toHaveProperty('local');
    expect(projected.workBacklog.assignments).toHaveProperty('remote');
    expect(projected.activeAgentId).toBe(remoteAgent.id);

    remoteSnapshot.teams = [];
    service.rememberSnapshot('connection-devbox', remoteSnapshot);
    const withoutRemoteTeam = service.clientSnapshotFromKnownRemotes();
    expect(withoutRemoteTeam.teams[0]).toMatchObject({ agentIds: [] });
    expect(withoutRemoteTeam.teams[0]).not.toHaveProperty('activeAgentId');
  });
});

function gitStatus(agentId: string, branch: string) {
  return {
    agentId,
    folder: '/repo',
    branch,
    ahead: 0,
    behind: 0,
    changedFiles: 0,
    addedLines: 0,
    removedLines: 0,
    hasUntracked: false,
    state: 'clean' as const,
    updatedAt: '2026-06-13T00:00:00.000Z',
  };
}

function turnDiff(agentId: string, turnId: string) {
  return {
    agentId,
    turnId,
    addedLines: 1,
    removedLines: 0,
    diff: `${turnId} diff`,
    updatedAt: '2026-06-13T00:00:00.000Z',
  };
}

function subagentTree(rootConversationId: string) {
  return { rootConversationId, nodes: {}, operations: {}, activities: {} };
}

function assignment(agentId: string) {
  return {
    provider: 'github' as const,
    itemId: `item-${agentId}`,
    agentId,
    assignedAt: '2026-06-13T00:00:00.000Z',
    policy: 'review' as const,
    status: 'inProgress' as const,
  };
}
