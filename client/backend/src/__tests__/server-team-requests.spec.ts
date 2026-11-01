import { describe, expect, it, vi } from 'vitest';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { createMission } from '@workspace/core/missions';
import {
  createTestSnapshot,
  readyRemoteConnection,
  createRemoteAgent,
  createRemoteTeamSnapshot,
} from './server-test-fixtures';

describe('AppBackendServer', () => {

  it('owns team mutations', async () => {
    const snapshot = createTestSnapshot();
    const events: unknown[] = [];
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      onEvent: (event) => events.push(event),
    });
    const createInput = { name: 'Backend Team', color: '#7158D4' };

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'create-team',
      method: 'team/create',
      params: { input: createInput },
    })).resolves.toMatchObject({
      result: {
        activeTeamId: expect.stringContaining('team-backend-team'),
        teams: [{ id: 'team-test' }, { name: 'Backend Team', color: '#7158D4' }],
      },
    });
    const teamId = snapshot.teams[1]?.id ?? '';

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'update-team',
      method: 'team/update',
      params: { input: { id: teamId, name: 'Backend Runtime', color: '#AA4AB8' } },
    })).resolves.toMatchObject({
      result: {
        teams: [{ id: 'team-test' }, { id: teamId, name: 'Backend Runtime', color: '#AA4AB8' }],
      },
    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'reorder-team',
      method: 'client/teamOrder/update',
      params: { input: { teamId, beforeTeamId: 'team-test' } },
    })).resolves.toMatchObject({
      result: {
        teams: [{ id: teamId }, { id: 'team-test' }],
      },
    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'select-team',
      method: 'client/navigation/selectTeam',
      params: { teamId: 'team-test' },
    })).resolves.toMatchObject({
      result: {
        activeTeamId: 'team-test',
      },
    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'close-team',
      method: 'team/delete',
      params: { teamId },
    })).resolves.toMatchObject({
      result: {
        teams: [{ id: 'team-test' }],
      },
    });

    expect(saveSnapshot).toHaveBeenCalledTimes(6);
    expect(events).toHaveLength(3);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'snapshot.updated' }),
    ]));
  });

  it('archives every attached session before deleting a local team', async () => {
    const snapshot = createTestSnapshot();
    const agent = {
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/repo',
      backend: 'codex' as const,
      backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
      status: { type: 'idle' as const },
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    };
    snapshot.teams[0]!.agentIds = [agent.id];
    snapshot.agents = [agent];
    snapshot.activeAgentId = agent.id;
    snapshot.teams.push({
      id: 'team-keep',
      name: 'Keep',
      color: '#7158D4',
      agentIds: [],
    });
    const archiveAgentConversation = vi.fn().mockResolvedValue(undefined);
    const releaseConversation = vi.fn();
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: agent.backendSession }),
      interrupt: async () => ({ backendSession: agent.backendSession }),
      respondToAgentRequest: async () => undefined,
      archiveAgentConversation,
      releaseConversation,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'delete-local-team',
      method: backendMethods.teamDelete,
      params: { teamId: 'team-test' },
    })).resolves.toMatchObject({
      result: {
        teams: [{ id: 'team-keep' }],
        agents: [],
      },
    });

    expect(archiveAgentConversation).toHaveBeenCalledWith(agent);
    expect(releaseConversation).toHaveBeenCalledWith(agent.id);
    await server.close();
  });

  it('deletes a local team’s missions and private homes while retaining other teams’ missions', async () => {
    const snapshot = createTestSnapshot();
    const agent = {
      id: 'agent-mission', teamId: 'team-test', name: 'Mission lead', folder: '/repo', backend: 'codex' as const,
      status: { type: 'idle' as const }, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    };
    snapshot.agents.push(agent);
    snapshot.teams[0]!.agentIds.push(agent.id);
    const mission = createMission(snapshot, { outcome: 'Scoped work', workflowType: 'shapeAndShipFeature', teamId: 'team-test', orchestratorMemberId: agent.id });
    mission.execution!.workspaces = [{ repositoryPath: '/repo', path: '/repo-worktree', branch: 'mission/scoped' }];
    const retainedAgent = { ...agent, id: 'agent-keep', teamId: 'team-keep' };
    snapshot.agents.push(retainedAgent);
    snapshot.teams.push({ id: 'team-keep', name: 'Keep', color: '#7158D4', agentIds: [retainedAgent.id] });
    const retainedMission = createMission(snapshot, { outcome: 'Retained', workflowType: 'shapeAndShipFeature', teamId: 'team-keep', orchestratorMemberId: retainedAgent.id });
    const deleteMissionHome = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({ version: 'test-version', snapshot, deleteMissionHome });

    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'delete-mission-team', method: backendMethods.teamDelete, params: { teamId: 'team-test' },
    })).resolves.toMatchObject({ result: { teams: [{ id: 'team-keep' }], missions: [{ id: retainedMission.id }] } });

    expect(deleteMissionHome).toHaveBeenCalledExactlyOnceWith(mission.id);
    expect(snapshot.missions?.map(candidate => candidate.id)).toStrictEqual([retainedMission.id]);
    await server.close();
  });

  it('rejects deleting the last local team without touching its missions', async () => {
    const snapshot = createTestSnapshot();
    const agent = {
      id: 'agent-mission', teamId: 'team-test', name: 'Mission lead', folder: '/repo', backend: 'codex' as const,
      status: { type: 'idle' as const }, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    };
    snapshot.agents.push(agent);
    snapshot.teams[0]!.agentIds.push(agent.id);
    const mission = createMission(snapshot, { outcome: 'Keep work', workflowType: 'shapeAndShipFeature', teamId: 'team-test', orchestratorMemberId: agent.id });
    const deleteMissionHome = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({ version: 'test-version', snapshot, deleteMissionHome });

    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'delete-last-team', method: backendMethods.teamDelete, params: { teamId: 'team-test' },
    })).rejects.toThrow('At least one team must remain open.');

    expect(snapshot.teams.map(team => team.id)).toStrictEqual(['team-test']);
    expect(snapshot.missions?.map(candidate => candidate.id)).toStrictEqual([mission.id]);
    expect(deleteMissionHome).not.toHaveBeenCalled();
    await server.close();
  });

  it('publishes the remaining missions when team cleanup stops partway through', async () => {
    const snapshot = createTestSnapshot();
    const agent = {
      id: 'agent-mission', teamId: 'team-test', name: 'Mission lead', folder: '/repo', backend: 'codex' as const,
      status: { type: 'idle' as const }, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    };
    snapshot.agents.push(agent);
    snapshot.teams[0]!.agentIds.push(agent.id);
    snapshot.teams.push({ id: 'team-keep', name: 'Keep', color: '#7158D4', agentIds: [] });
    const first = createMission(snapshot, { outcome: 'First', workflowType: 'shapeAndShipFeature', teamId: 'team-test', orchestratorMemberId: agent.id });
    const second = createMission(snapshot, { outcome: 'Second', workflowType: 'shapeAndShipFeature', teamId: 'team-test', orchestratorMemberId: agent.id });
    const events: Array<{ type: string; payload?: unknown }> = [];
    const deleteMissionHome = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disk unavailable'));
    const server = new AppBackendServer({ version: 'test-version', snapshot, deleteMissionHome, onEvent: event => events.push(event) });

    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'delete-team-partial', method: backendMethods.teamDelete, params: { teamId: 'team-test' },
    })).rejects.toThrow('Team deletion stopped after removing 1 of 2 Missions. The team remains');

    expect(snapshot.teams.map(team => team.id)).toStrictEqual(['team-test', 'team-keep']);
    expect(snapshot.missions?.map(mission => mission.id)).toStrictEqual([second.id]);
    expect(deleteMissionHome).toHaveBeenCalledTimes(2);
    expect(deleteMissionHome).toHaveBeenNthCalledWith(1, first.id);
    expect(events).toEqual([expect.objectContaining({
      type: 'snapshot.updated',
      payload: expect.objectContaining({ missions: [expect.objectContaining({ id: second.id })] }),
    })]);
    await server.close();
  });

  it('renames the hidden teams on every host together with the local team', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams[0].remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }];
    const remoteClients = { request: vi.fn().mockResolvedValue(createRemoteTeamSnapshot()), close: vi.fn().mockResolvedValue(undefined) };
    const server = new AppBackendServer({ version: 'test-version', pid: 123, snapshot, remoteClients: remoteClients as never });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'rename-team',
      method: 'team/update',
      params: { input: { id: 'team-test', name: 'Platform', color: '#46A857' } },
    })).resolves.toMatchObject({ result: { teams: [expect.objectContaining({ name: 'Platform' })] } });

    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      'team/update',
      { input: { id: 'team-remote', name: 'Platform', color: '#46A857' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.teams[0]).toMatchObject({ name: 'Platform', remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }] });
  });

  it('removes the hidden team on each host when a team is deleted', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams.push({ id: 'team-mixed', name: 'Mixed', agentIds: [], remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }] });
    const remoteClients = { request: vi.fn().mockResolvedValue(createRemoteTeamSnapshot()), close: vi.fn().mockResolvedValue(undefined) };
    const server = new AppBackendServer({ version: 'test-version', pid: 123, snapshot, remoteClients: remoteClients as never });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'delete-team', method: 'team/delete', params: { teamId: 'team-mixed' } }))
      .resolves.toMatchObject({ result: { teams: [expect.objectContaining({ id: 'team-test' })] } });

    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      'team/delete',
      { teamId: 'team-remote', missingOk: true, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.teams.map((team) => team.id)).toStrictEqual(['team-test']);
  });

  it('keeps the last team and leaves its hosts untouched when deletion is refused', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams[0].remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }];
    const remoteClients = { request: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    const server = new AppBackendServer({ version: 'test-version', pid: 123, snapshot, remoteClients: remoteClients as never });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'delete-last', method: 'team/delete', params: { teamId: 'team-test' } })).rejects.toThrow('At least one team');

    expect(remoteClients.request).not.toHaveBeenCalled();
    expect(snapshot.teams).toHaveLength(1);
  });
});
