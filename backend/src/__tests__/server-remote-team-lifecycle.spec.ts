import { describe, it, expect, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createTestSnapshot, readyRemoteConnection, createRemoteAgent, createRemoteTeamSnapshot, createWorkItem } from './server-test-fixtures';
import { defaultTeamColor } from '@workspace/core/team-colors';
import { RemoteTeamService } from '../connections/remote-team-service';
import { workItemAssignmentKey, workBacklogAssignmentFromWorkItem } from '@workspace/core/work-assignments';
import type { AppSnapshot } from '@workspace/core/contracts';

// Owning boundary: first remote creation must not outlive deletion of its local team.
// Failure modes: orphan hidden team, binding a removed local team, creating an invisible worker.
describe('remote team lifecycle commands', () => {
  it('cleans up a hidden team whose local team is deleted while first creation is pending', async () => {
    const local = createTestSnapshot();
    local.teams[0]!.color = defaultTeamColor;
    local.teams.push({ id: 'fallback-local', name: 'Fallback', agentIds: [] });
    local.remoteConnections.connections = [readyRemoteConnection()];
    const remote = createTestSnapshot();
    remote.teams[0]!.id = 'fallback-remote';
    remote.activeTeamId = 'fallback-remote';
    const remoteServer = new AppBackendServer({ version: 'test', snapshot: remote });
    let reachedResolve!: () => void;
    let resumeResolve!: () => void;
    const reached = { promise: new Promise<void>(resolve => { reachedResolve = resolve; }), resolve: () => reachedResolve() };
    const resume = { promise: new Promise<void>(resolve => { resumeResolve = resolve; }), resolve: () => resumeResolve() };
    const clients = { close: vi.fn(), request: vi.fn(async (_connection, method, params) => {
      const result = await remoteServer.handleMessage({ jsonrpc: '2.0', id: 'remote', method, params });
      if (!result || 'error' in result) throw new Error(JSON.stringify(result));
      if (method === backendMethods.teamCreate) { reached.resolve(); await resume.promise; }
      return result.result;
    }) };
    const controller = new AppBackendServer({ version: 'test', snapshot: local, remoteClients: clients as never });
    try {
      const creating = controller.handleMessage({ jsonrpc: '2.0', id: 'create', method: backendMethods.agentQuickChatCreate,
        params: { input: { teamId: 'team-test', remoteConnectionId: 'connection-devbox', selection: { backend: 'codex' } } } })
        .then(result => ({ result }), error => ({ error }));
      await Promise.race([reached.promise, creating.then(outcome => { throw new Error(`Creation returned before probe gate: ${JSON.stringify(outcome, (_key, value) => value instanceof Error ? value.message : value)}`); })]);
      await expect(controller.handleMessage({ jsonrpc: '2.0', id: 'delete', method: backendMethods.teamDelete, params: { teamId: 'team-test' } })).rejects.toThrow('creation in progress');
      resume.resolve();
      const outcome = await creating;
      expect(outcome).toHaveProperty('result');
      expect(await controller.handleMessage({ jsonrpc: '2.0', id: 'retry-delete', method: backendMethods.teamDelete, params: { teamId: 'team-test' } })).toHaveProperty('result');
      expect(remote.teams.map(team => team.id)).toStrictEqual(['fallback-remote']);
    } finally { resume.resolve(); await controller.close(); await remoteServer.close(); }
  });

  it('rejects a first-use creation after team deletion has begun on another host', async () => {
    const local = createTestSnapshot();
    local.teams[0]!.color = defaultTeamColor;
    local.teams.push({ id: 'fallback', name: 'Fallback', agentIds: [] });
    local.remoteConnections.connections = [readyRemoteConnection(), { ...readyRemoteConnection(), id: 'second-host', host: 'second' }];
    local.teams[0]!.remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }];
    const first = createRemoteTeamSnapshot([]); first.teams.push({ id: 'fallback-remote', name: 'Fallback', agentIds: [] });
    const second = createTestSnapshot();
    const firstServer = new AppBackendServer({ version: 'test', snapshot: first });
    const secondServer = new AppBackendServer({ version: 'test', snapshot: second });
    let release!: () => void; let reached!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const deleting = new Promise<void>(resolve => { reached = resolve; });
    const clients = { close: vi.fn(), request: vi.fn(async (connection, method, params) => {
      const server = connection.id === 'second-host' ? secondServer : firstServer;
      const response = await server.handleMessage({ jsonrpc: '2.0', id: 'remote', method, params });
      if (!response || 'error' in response) throw new Error('Remote request failed');
      if (method === backendMethods.teamDelete) { reached(); await gate; }
      return response.result;
    }) };
    const controller = new AppBackendServer({ version: 'test', snapshot: local, remoteClients: clients as never });
    const deletion = controller.handleMessage({ jsonrpc: '2.0', id: 'delete', method: backendMethods.teamDelete, params: { teamId: 'team-test' } });
    try {
      await deleting;
      await expect(controller.handleMessage({ jsonrpc: '2.0', id: 'create', method: backendMethods.agentQuickChatCreate,
        params: { input: { teamId: 'team-test', remoteConnectionId: 'second-host', selection: { backend: 'codex' } } } })).rejects.toThrow('deletion in progress');
      release(); await deletion;
      expect(second.teams).toHaveLength(1);
    } finally { release(); await deletion.catch(() => undefined); await controller.close(); await firstServer.close(); await secondServer.close(); }
  });

  // Failure mode: a metadata-only cache is mistaken for an authoritative negative assignment lookup.
  it.each([false, true])('deletes a remote assignment (restored metadata-only cache: %s)', async restoreCache => {
    const local = createTestSnapshot();
    local.remoteConnections.connections = [readyRemoteConnection()];
    local.teams[0]!.remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }];
    const remote = createRemoteTeamSnapshot([createRemoteAgent()]);
    const item = createWorkItem();
    const key = workItemAssignmentKey(item);
    remote.workBacklog.assignments[key] = workBacklogAssignmentFromWorkItem(item, remote.agents[0]!.id, '2026-10-29T00:00:00Z');
    let cached!: AppSnapshot;
    const source = new RemoteTeamService({ getSnapshot: () => local, clients: {} as never,
      onForwardedEvent: vi.fn(), onProjectedSnapshotChanged: vi.fn(),
      cache: { load: () => new Map(), save: (_id, snapshot) => { cached = structuredClone(snapshot!); } } });
    source.rememberSnapshot('connection-devbox', remote);
    expect(cached.workBacklog.assignments).toStrictEqual({});
    const remoteServer = new AppBackendServer({ version: 'test', snapshot: remote });
    const clients = { close: vi.fn(), request: vi.fn(async (_connection, method, params) => {
      const result = await remoteServer.handleMessage({ jsonrpc: '2.0', id: 'remote', method, params });
      if (!result || 'error' in result) throw new Error(JSON.stringify(result));
      return result.result;
    }) };
    const controller = new AppBackendServer({ version: 'test', snapshot: local, remoteClients: clients as never,
      ...(restoreCache ? { remoteSnapshotCache: { load: () => new Map([['connection-devbox', cached]]), save: vi.fn() } } : {}) });
    try {
      const response = await controller.handleMessage({ jsonrpc: '2.0', id: 'delete-assignment', method: backendMethods.agentWorkItemAssignmentDelete, params: { item } });
      expect(response).toHaveProperty('result');
      expect(remote.workBacklog.assignments[key]).toBeUndefined();
    } finally { await controller.close(); await remoteServer.close(); }
  });
});
