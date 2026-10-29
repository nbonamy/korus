import { describe, expect, it, vi } from 'vitest';
import type { BackendEvent } from '@workspace/core/backend-driver';
import type { AppRpcRequest } from '@workspace/core/backend-protocol/rpc';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { createTestSnapshot, createRemoteAgent, createRemoteTeamSnapshot, readyRemoteConnection } from './server-test-fixtures';

describe('client isolation regressions', () => {
  it.each(['agent/quickChat/create', 'agent/create'])('resolves omitted teams from each client before routing %s locally or remotely', async (method) => {
    const remoteSnapshot = createRemoteTeamSnapshot();
    const daemon = new AppBackendServer({ version: 'test', snapshot: remoteSnapshot, driverRpc: new BackendDriverRpc(new Map()) });
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    snapshot.teams.push(
      { id: 'local-other', name: 'Other', agentIds: [] },
      { id: 'pointer', name: 'Devbox', agentIds: [], remoteLinks: [{ connectionId: connection.id, remoteTeamId: 'team-remote' }] },
    );
    const request = vi.fn(async (_connection: unknown, method: string, params: unknown) => {
      const result = await daemon.handleMessage({ jsonrpc: '2.0', id: 1, method, params } as AppRpcRequest);
      if (result && 'result' in result) return result.result;
      throw new Error(JSON.stringify(result));
    });
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map()), remoteClients: { request, close: vi.fn() } as never });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'client/navigation/selectTeam', params: { _clientId: 'remote-client', teamId: 'pointer' } });
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'client/navigation/selectTeam', params: { _clientId: 'local-client', teamId: 'local-other' } });
      const input = method === 'agent/create' ? { name: 'New', folder: '/tmp', selection: { backend: 'codex' } } : {};
      const results = await Promise.all(['remote-client', 'local-client'].map((_clientId) => server.handleMessage({ jsonrpc: '2.0', id: _clientId, method, params: { _clientId, input: _clientId === 'remote-client' ? { ...input, remoteConnectionId: connection.id } : input } })));
      expect(results[0]).toMatchObject({ result: { activeTeamId: 'pointer' } });
      expect(results[1]).toMatchObject({ result: { activeTeamId: 'local-other' } });
      expect(remoteSnapshot.agents).toHaveLength(1);
      expect(remoteSnapshot.agents[0]?.teamId).toBe('team-remote');
      expect(snapshot.agents).toHaveLength(1);
      expect(snapshot.agents[0]?.teamId).toBe('local-other');
      expect(snapshot.teams[0]?.agentIds).toEqual([]);
      expect(snapshot.activeTeamId).toBe('team-test');
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 3, method, params: { _clientId: 'remote-client', input: { ...input, teamId: 'missing', remoteConnectionId: connection.id } } })).resolves.toHaveProperty('error');
      expect(snapshot.agents).toHaveLength(1);
      expect(remoteSnapshot.agents).toHaveLength(1);
    } finally { await server.close(); await daemon.close(); }
  });

  it.each(['agent/quickChat/create', 'team/create'])('selects the exact result of overlapping %s requests', async (method) => {
    const snapshot = createTestSnapshot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: () => gate });
    try {
      const calls = ['A', 'B'].map((client) => server.handleMessage({
        jsonrpc: '2.0', id: client, method,
        params: { _clientId: client, input: method === 'team/create' ? { name: client, color: '#1B4FB2' } : { teamId: 'team-test' } },
      }));
      await vi.waitFor(() => expect(method === 'team/create' ? snapshot.teams.length : snapshot.agents.length).toBe(method === 'team/create' ? 3 : 2));
      const ids = method === 'team/create' ? snapshot.teams.slice(1).map((team) => team.id) : snapshot.agents.map((agent) => agent.id);
      release();
      const results = await Promise.all(calls);
      results.forEach((result, index) => expect(result).toMatchObject({ result: {
        [method === 'team/create' ? 'activeTeamId' : 'activeAgentId']: ids[index],
      } }));
      expect(snapshot.activeTeamId).toBe('team-test');
      expect(snapshot.activeAgentId).toBeNull();
    } finally { release(); await server.close(); }
  });

  it('answers an already pending remote request without replay and never changes shared navigation', async () => {
    const agent = createRemoteAgent();
    const remoteSnapshot = createRemoteTeamSnapshot([agent]);
    let emit!: (event: BackendEvent) => void;
    const handle = vi.fn(async () => {
      emit({ type: 'agentRequest.resolved', agentId: agent.id, backend: 'codex', conversationId: 'conversation', payload: { id: '0', outcome: { kind: 'cancelled' } } });
    });
    const daemon = new AppBackendServer({ version: 'test', snapshot: remoteSnapshot, driverRpc: {
      onEvent: (listener: typeof emit) => { emit = listener; return () => undefined; }, handle, close: vi.fn(),
    } as never });
    emit({ type: 'agentRequest.created', agentId: agent.id, backend: 'codex', payload: { request: {
      id: '0', conversationId: 'conversation', kind: 'question', question: { itemId: 'item', delivery: 'async', blocking: false, questions: [] },
    } } });
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    snapshot.teams.push({ id: 'pointer', name: 'Devbox', agentIds: [], remoteLinks: [{ connectionId: connection.id, remoteTeamId: 'team-remote' }] });
    const request = vi.fn(async (_connection: unknown, method: string, params: unknown) => {
      const response = await daemon.handleMessage({ jsonrpc: '2.0', id: 1, method, params } as AppRpcRequest);
      if (response && 'result' in response) return response.result;
      throw new Error(JSON.stringify(response));
    });
    const controller = new AppBackendServer({ version: 'test', snapshot, remoteClients: { request, close: vi.fn() } as never });
    try {
      await controller.handleMessage({ jsonrpc: '2.0', id: 1, method: 'client/navigation/selectTeam', params: { _clientId: 'B', teamId: 'team-test' } });
      const before = structuredClone(snapshot.clientPreferences);
      const result = await controller.handleMessage({ jsonrpc: '2.0', id: 2, method: 'agent/request/respond', params: {
        _clientId: 'A', response: { agentId: agent.id, id: '0', outcome: { kind: 'cancelled' } },
      } });
      expect(result).toHaveProperty('result');
      expect(handle).toHaveBeenCalledWith('driver/agentRequest/respond', { backend: 'codex', response: { agentId: agent.id, id: '0', outcome: { kind: 'cancelled' } } });
      expect(remoteSnapshot.agentRequests?.[agent.id]).toEqual([]);
      expect(snapshot.activeTeamId).toBe('team-test');
      expect(snapshot.activeAgentId).toBeNull();
      expect(snapshot.clientPreferences).toEqual(before);
    } finally { await controller.close(); await daemon.close(); }
  });
});
