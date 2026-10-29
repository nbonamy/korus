import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentBackend, RemoteConnection, AppSnapshot } from '@workspace/core/contracts';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { createFileRemoteSnapshotCache } from '../connections/remote-snapshot-cache';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import {
  createTestSnapshot,
  readyRemoteConnection,
  createRemoteAgent,
  createRemoteTeamSnapshot,
  createWorkItem,
} from './server-test-fixtures';

describe('AppBackendServer', () => {

  it('keeps remote projects across an offline restart, reports the failure, and refreshes them on reconnect', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'offline-remote-project-'));
    const file = path.join(directory, 'remote-snapshots.json');
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    snapshot.teams[0]!.remoteLinks = [{ connectionId: connection.id, remoteTeamId: 'team-remote' }];
    const agent = { ...createRemoteAgent(), status: { type: 'working' as const } };
    const remote = createRemoteTeamSnapshot([agent]);
    const remoteClients = {
      request: vi.fn().mockResolvedValue({ snapshot: remote, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } }),
      close: vi.fn(), closeConnection: vi.fn(),
    };
    const events: import('@workspace/core/backend-protocol/rpc').AppBackendEvent[] = [];
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    let server = new AppBackendServer({ version: 'test', snapshot, remoteClients: remoteClients as never,
      remoteSnapshotCache: createFileRemoteSnapshotCache(file) });
    const read = () => server.handleMessage({ jsonrpc: '2.0', id: 'snapshot', method: 'snapshot/get' });
    try {
      expect(await read()).toMatchObject({ result: { snapshot: { agents: [expect.objectContaining({ id: agent.id })] } } });
      await server.close();
      // close flushes the cache even if the debounce has not elapsed.
      expect(JSON.parse(await readFile(file, 'utf8')).snapshots[connection.id].agents[0].id).toBe(agent.id);
      remoteClients.request.mockRejectedValue(new Error('Cannot find module daemon.mjs'));
      server = new AppBackendServer({ version: 'test', snapshot, remoteClients: remoteClients as never,
        remoteSnapshotCache: createFileRemoteSnapshotCache(file), onEvent: event => events.push(event), saveSnapshot,
        sshConnections: { checkConnection: vi.fn().mockResolvedValue(connection) } as never });

      expect(await read()).toMatchObject({ result: { snapshot: { agents: [expect.objectContaining({
        id: agent.id, teamId: 'team-test', remoteConnectionId: connection.id, folder: agent.folder, status: { type: 'idle' },
      })] } } });
      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'snapshot.updated', payload: expect.objectContaining({
        remoteConnections: { connections: [expect.objectContaining({ status: 'error', detail: expect.stringContaining('daemon.mjs') })] },
        agents: [expect.objectContaining({ id: agent.id })],
      }) })));
      expect(saveSnapshot).toHaveBeenCalled();
      expect(snapshot.agents).toStrictEqual([]);
      const requestsAfterFailure = remoteClients.request.mock.calls.length;
      await read();
      expect(remoteClients.request).toHaveBeenCalledTimes(requestsAfterFailure);

      remoteClients.request.mockResolvedValue(createRemoteTeamSnapshot([{ ...agent, name: 'Reconnected', status: { type: 'idle' } }]));
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'reconnect', method: 'connections/runtime/sync', params: { connectionId: connection.id } }))
        .toMatchObject({ result: { agents: [expect.objectContaining({ id: agent.id, name: 'Reconnected' })],
          remoteConnections: { connections: [expect.objectContaining({ status: 'ready' })] } } });
      await server.handleMessage({ jsonrpc: '2.0', id: 'forget', method: 'connections/delete', params: { connectionId: connection.id } });
      await server.close();
      expect(createFileRemoteSnapshotCache(file).load().size).toBe(0);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['codex', 'claude'] as const)('installs %s over SSH and rechecks the owning host', async (backend) => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const install = vi.fn().mockResolvedValue('1.0.0');
    const remoteClients = { request: vi.fn().mockResolvedValue({ backend, installed: true }), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', snapshot,
      sshConnections: { ensureRemoteClaudeInstalled: install, ensureRemoteCodexInstalled: install } as never,
      remoteClients: remoteClients as never });
    try {
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'install', method: 'provider/install', params: { backend, remoteConnectionId: connection.id } })).toMatchObject({ result: { backend, installed: true } });
      expect(install).toHaveBeenCalledExactlyOnceWith(connection.host);
      expect(remoteClients.request).toHaveBeenCalledWith(connection, 'provider/refresh', { backend, _clientId: 'remote-controller' }, expect.any(Function));
    } finally { await server.close(); }
  });

  it('persists a failed remote activation and allows retry instead of leaving a ready connection', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const busySnapshot = createRemoteTeamSnapshot([{ ...createRemoteAgent(), status: { type: 'working' } }]);
    const remoteClients = { closeConnection: vi.fn(), close: vi.fn(), request: vi.fn()
      .mockRejectedValueOnce(new Error('Remote daemon could not start.'))
      .mockResolvedValue(busySnapshot) };
    const sshConnections = { checkConnection: vi.fn().mockResolvedValue(connection), createConnection: vi.fn() };
    const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot, remoteClients: remoteClients as never, sshConnections: sshConnections as never });
    try {
      const request = { jsonrpc: '2.0' as const, id: 'sync', method: 'connections/runtime/sync', params: { connectionId: connection.id } };
      const failed = await server.handleMessage(request);
      expect(failed).toMatchObject({ result: { remoteConnections: { connections: [expect.objectContaining({ status: 'error', detail: expect.stringContaining('could not start') })] } } });
      expect(saveSnapshot).toHaveBeenCalled();
      expect(snapshot.remoteConnections.connections[0]?.id).toBe(connection.id);
      expect(sshConnections.createConnection).not.toHaveBeenCalled();
      expect(await server.handleMessage(request)).toMatchObject({ result: { remoteConnections: { connections: [expect.objectContaining({ status: 'ready' })] } } });
      await expect(server.handleMessage(request)).rejects.toThrow('Finish active turns');
      expect(sshConnections.checkConnection).toHaveBeenCalledTimes(2);
    } finally { await server.close(); }
  });

  it.each(['current', 'independent'] as const)('returns the explicit reviewer identity for a remote %s review', async (threadMode) => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection(); snapshot.remoteConnections.connections = [connection];
    snapshot.teams.push({ id: 'pointer', name: 'Remote', agentIds: [], remoteLinks: [{ connectionId: connection.id, remoteTeamId: 'team-remote' }] });
    const target = createRemoteAgent();
    const reviewer = { ...target, id: 'reviewer' };
    const remoteSnapshot = createRemoteTeamSnapshot([target, reviewer]);
    remoteSnapshot.activeAgentId = reviewer.id;
    const remoteClients = { request: vi.fn(async (_connection, method: string) => method === 'snapshot/get'
      ? { snapshot: remoteSnapshot, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } }
      : remoteSnapshot), close: async () => {} };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: remoteClients as never });
    try {
      const result = await server.handleMessage({ jsonrpc: '2.0', id: 'review', method: 'agent/codeReview/start', params: {
        agentId: target.id, entityResult: true, input: { scope: { type: 'uncommitted' }, threadMode },
      } });
      expect(result).toMatchObject({ result: { agentId: threadMode === 'current' ? target.id : reviewer.id, snapshot: { agents: expect.any(Array) } } });
    } finally { await server.close(); }
  });

  it('routes branch browsing to the selected host and keeps token reads on that host', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection(); snapshot.remoteConnections.connections = [connection];
    const branches = [{ name: 'main', isDefault: true }];
    const listBranches = vi.fn().mockResolvedValue(branches);
    const remoteClients = { request: vi.fn().mockResolvedValue(branches) };
    const server = new AppBackendServer({ version: 'test', snapshot, workIntegrations: { listBranches } as never, remoteClients: remoteClients as never });
    const params = { provider: 'github', sourceId: 'org/repo' };
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'workProvider/branches/list', params })).toMatchObject({ result: branches });
    expect(listBranches).toHaveBeenCalledExactlyOnceWith('github', 'org/repo');
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'workProvider/branches/list', params: { ...params, location: { kind: 'remote', remoteConnectionId: connection.id } } })).toMatchObject({ result: branches });
    expect(listBranches).toHaveBeenCalledOnce();
    expect(remoteClients.request).toHaveBeenCalledExactlyOnceWith(connection, 'workProvider/branches/list', { ...params, _clientId: 'remote-controller' }, expect.any(Function));
  });

  it('lists a host model catalog without an agent by asking that host', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection(); snapshot.remoteConnections.connections = [connection];
    const models = [{ id: 'gpt-test', model: 'gpt-test', displayName: 'GPT Test' }];
    const remoteClients = { request: vi.fn().mockResolvedValue(models) };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: remoteClients as never });
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/models/list', params: { backend: 'codex', remoteConnectionId: connection.id } })).toMatchObject({ result: models });
    expect(remoteClients.request).toHaveBeenCalledExactlyOnceWith(connection, 'agent/models/list', { backend: 'codex', _clientId: 'remote-controller' }, expect.any(Function));
  });

  it('lists the local model catalog of a provider without an agent', async () => {
    const snapshot = createTestSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const listModels = vi.fn().mockResolvedValue([{ id: 'gpt-test', model: 'gpt-test', displayName: 'GPT Test' }]);
    const driver = { backend: 'codex', listModels, onEvent: () => () => undefined, close: async () => undefined } as unknown as ConstructorParameters<typeof BackendDriverRpc>[0] extends Map<string, infer D> ? D : never;
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])) });
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/models/list', params: { backend: 'codex' } })).toMatchObject({ result: [{ id: 'gpt-test' }] });
    expect(listModels).toHaveBeenCalledOnce();
  });

  it('rechecks provider installation on the owning remote host without running a local installer', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const setup = { backend: 'claude', installed: true, isolated: true, shareSkills: true, locked: false, homePath: '/remote/claude' };
    const remoteClients = { request: vi.fn().mockResolvedValue(setup) };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: remoteClients as never });
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/refresh', params: { backend: 'claude', remoteConnectionId: connection.id } })).toMatchObject({ result: setup });
    expect(remoteClients.request).toHaveBeenCalledExactlyOnceWith(connection, 'provider/refresh', { backend: 'claude', _clientId: 'remote-controller' }, expect.any(Function));
  });

  it('inspects remote versions without closing or upgrading the connection', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    const sshConnections = {
      inspectVersions: vi.fn().mockResolvedValue({ ...connection, daemonVersion: '0.19.1', codexVersion: '0.143.0', detail: 'versions' }),
      checkConnection: vi.fn(),
    };
    const engines = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const remoteClients = { request: vi.fn().mockResolvedValue(engines), closeConnection: vi.fn(), isConnected: vi.fn().mockReturnValue(false) };
    const server = new AppBackendServer({ version: '0.19.1', pid: 1, snapshot, sshConnections: sshConnections as never, remoteClients: remoteClients as never });
    const result = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'connections/runtime/inspect', params: { connectionId: connection.id } });
    expect(result).toMatchObject({ result: { remoteConnections: { connections: [expect.objectContaining({ codexVersion: '0.143.0' })] } } });
    expect(remoteClients.closeConnection).not.toHaveBeenCalled();
    expect(sshConnections.checkConnection).not.toHaveBeenCalled();
    expect(sshConnections.inspectVersions).toHaveBeenCalledWith(connection);
    expect(snapshot.remoteConnections.connections[0]?.providerConnections).toStrictEqual(engines);
    sshConnections.inspectVersions.mockRejectedValueOnce(new Error('SSH host is offline.'));
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'connections/runtime/inspect', params: { connectionId: connection.id } }))
      .toMatchObject({ result: { remoteConnections: { connections: [expect.objectContaining({ status: 'error', detail: 'SSH host is offline.' })] } } });
    snapshot.remoteConnections.connections = [connection];
    remoteClients.isConnected.mockReturnValue(true);
    sshConnections.inspectVersions.mockRejectedValueOnce(new Error('Version probe timed out.'));
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'connections/runtime/inspect', params: { connectionId: connection.id } }))
      .toMatchObject({ result: { remoteConnections: { connections: [expect.objectContaining({ status: 'ready' })] } } });
    remoteClients.isConnected.mockReturnValue(false);
    remoteClients.request.mockResolvedValueOnce({} as never);
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'connections/runtime/inspect', params: { connectionId: connection.id } }))
      .toMatchObject({ result: { remoteConnections: { connections: [expect.objectContaining({ status: 'error' })] } } });
  });

  it('routes SSH connection discovery and persistence through daemon', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const sshConnections = {
      listHostCandidates: vi.fn().mockResolvedValue([{
        host: 'devbox',
        hostName: 'devbox.internal',
        user: 'nicolas',
      }]),
      createConnection: vi.fn().mockResolvedValue({
        id: 'connection-devbox',
        kind: 'ssh',
        name: 'devbox',
        host: 'devbox',
        status: 'saved',
        transport: {
          type: 'ssh-stdio',
          command: 'ssh',
          args: ['devbox', `node ~/${product.homeDirectory}/daemon.mjs --stdio`],
        },
        createdAt: '2026-06-14T10:00:00.000Z',
        updatedAt: '2026-06-14T10:00:00.000Z',
      }),
      checkConnection: vi.fn(),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      remoteClients: { request: vi.fn().mockResolvedValue(createTestSnapshot()), close: vi.fn(), closeConnection: vi.fn() } as never,
      sshConnections: sshConnections as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'list-connections',
      method: 'connections/sshHosts/list',
    })).resolves.toMatchObject({
      result: [{
        host: 'devbox',
        hostName: 'devbox.internal',
        user: 'nicolas',
      }],
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'add-connection',
      method: 'connections/ssh/create',
      params: {
        input: {
          host: 'devbox',
          hostName: 'devbox.internal',
          user: 'nicolas',
        },
      },
    })).resolves.toMatchObject({
      result: {
        remoteConnections: {
          connections: [{
            id: 'connection-devbox',
            host: 'devbox',
            status: 'saved',
          }],
        },
      },
    });

    expect(sshConnections.createConnection).toHaveBeenCalledWith({
      host: 'devbox',
      hostName: 'devbox.internal',
      user: 'nicolas',
    });
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it.each(['claude', 'antigravity'] as const)('publishes inspection and selected %s setup progress', async backend => {
    const snapshot = createTestSnapshot();
    const connection = { ...readyRemoteConnection(), status: 'saved' as const, transport: undefined };
    snapshot.remoteConnections.connections = [connection];
    const phases: string[] = [];
    let inspect!: (value: RemoteConnection) => void;
    const sshConnections = {
      inspectVersions: vi.fn(() => new Promise<RemoteConnection>(resolve => { inspect = resolve; })),
      checkConnection: vi.fn(async (saved: RemoteConnection, backends: AgentBackend[], progress: (detail: string) => Promise<void>) => {
        expect(backends).toStrictEqual([backend]);
        if (backend === 'claude') await progress('Installing Claude Code…');
        return { ...readyRemoteConnection(), id: saved.id };
      }),
    };
    const server = new AppBackendServer({ version: 'test', snapshot,
      saveSnapshot: async value => { phases.push(value.remoteConnections.connections[0]?.detail ?? ''); },
      sshConnections: sshConnections as never,
      remoteClients: { request: vi.fn(async (_connection: RemoteConnection, method: string) => method === 'provider/install' ? { backend: 'antigravity', installed: true } : createTestSnapshot()), closeConnection: vi.fn(), close: vi.fn() } as never,
    });
    try {
      const inspecting = server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'connections/runtime/inspect', params: { connectionId: connection.id } });
      await vi.waitFor(() => expect(sshConnections.inspectVersions).toHaveBeenCalledOnce());
      expect(snapshot.remoteConnections.connections[0]?.status).toBe('checking');
      inspect(connection);
      await inspecting;
      expect(snapshot.remoteConnections.connections[0]?.status).toBe('saved');
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'connections/runtime/sync', params: { connectionId: connection.id, backends: [backend] } });
      expect(phases).toContain(backend === 'claude' ? 'Installing Claude Code…' : 'Installing Antigravity…');
      expect(snapshot.remoteConnections.connections[0]?.status).toBe('ready');
    } finally { await server.close(); }
  });

  it('checks and removes remote connections through daemon', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [{
      id: 'connection-devbox',
      kind: 'ssh',
      name: 'devbox',
      host: 'devbox',
      status: 'saved',
      createdAt: '2026-06-14T10:00:00.000Z',
      updatedAt: '2026-06-14T10:00:00.000Z',
    }];
    const sshConnections = {
      listHostCandidates: vi.fn(),
      createConnection: vi.fn(),
      checkConnection: vi.fn().mockResolvedValue({
        ...snapshot.remoteConnections.connections[0],
        status: 'ready',
        detail: 'Ready (daemon 0.1.0)',
        transport: {
          type: 'ssh-stdio',
          command: 'ssh',
          args: ['devbox', `node ~/${product.homeDirectory}/daemon.mjs connect || exec node ~/${product.homeDirectory}/daemon.mjs --stdio`],
        },
        updatedAt: '2026-06-14T10:01:00.000Z',
      }),
    };
    const remoteClients = {
      request: vi.fn().mockResolvedValue(createTestSnapshot()),
      close: vi.fn(),
      closeConnection: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      sshConnections: sshConnections as never,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'check-connection',
      method: 'connections/runtime/sync',
      params: { connectionId: 'connection-devbox' },
    })).resolves.toMatchObject({
      result: {
        remoteConnections: {
          connections: [{
            id: 'connection-devbox',
            status: 'ready',
            detail: 'Ready (daemon 0.1.0)',
          }],
        },
      },
    });
    expect(remoteClients.closeConnection).toHaveBeenCalledWith('connection-devbox');
    expect(remoteClients.request).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'connection-devbox',
        status: 'ready',
      }),
      'workProvider/connections/reload',
      { _clientId: 'remote-controller' },
      expect.any(Function),
    );

    snapshot.teams[0].remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }];
    remoteClients.closeConnection.mockClear();

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remove-connection',
      method: 'connections/delete',
      params: { connectionId: 'connection-devbox' },
    })).resolves.toMatchObject({
      result: {
        remoteConnections: {
          connections: [],
        },
        teams: [{
          name: 'Test Team',
          agentIds: [],
        }],
        agents: [],
      },
    });
    expect(snapshot.teams[0]).not.toHaveProperty('remoteLinks');
    expect(remoteClients.closeConnection).toHaveBeenCalledWith('connection-devbox');
  });

  it('updates remote connection source folder settings on the remote daemon', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const connection = snapshot.remoteConnections.connections[0]!;
    const remoteClients = {
      request: vi.fn().mockResolvedValue(createTestSnapshot()),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
      saveSnapshot,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'update-connection',
      method: 'connections/update',
      params: {
        connectionId: 'connection-devbox',
        input: {
          sourceFolderPath: '  ~/code  ',
        },
      },
    })).resolves.toMatchObject({
      result: {
        remoteConnections: {
          connections: [{
            id: 'connection-devbox',
            sourceFolderPath: '~/code',
          }],
        },
      },
    });

    expect(remoteClients.request).toHaveBeenCalledWith(
      connection,
      'settings/update',
      {
        input: {
          sourceFolder: {
            path: '~/code',
          },
        },
      },
    );
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('creates ordinary teams without contacting any host', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const remoteClients = { request: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    const server = new AppBackendServer({ version: 'test-version', pid: 123, snapshot, remoteClients: remoteClients as never });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'create-team',
      method: 'team/create',
      params: { input: { name: 'Remote Core', color: '#46A857' } },
    })).resolves.toMatchObject({ result: { teams: expect.arrayContaining([expect.objectContaining({ name: 'Remote Core', agentIds: [] })]) } });

    expect(remoteClients.request).not.toHaveBeenCalled();
    expect(snapshot.teams[1]).not.toHaveProperty('remoteLinks');
  });

  it('puts a remote agent in a local team through a hidden team on that host', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams[0]!.agentIds = ['agent-local'];
    snapshot.agents = [{ ...createRemoteAgent(), id: 'agent-local', teamId: 'team-test', name: 'Local', folder: '/Users/nbonamy/src/korus' }];
    const remoteSnapshot = createRemoteTeamSnapshot([createRemoteAgent()]);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const remoteClients = {
      request: vi.fn(async (_connection, method: string) => method === 'snapshot/get'
        ? { snapshot: remoteSnapshot, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } }
        : remoteSnapshot),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({ version: 'test-version', pid: 123, snapshot, saveSnapshot, remoteClients: remoteClients as never });

    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'create-remote-agent',
      method: 'agent/create',
      params: { input: { name: 'Dina', folder: '/home/mnmt/src/korus', teamId: 'team-test', remoteConnectionId: 'connection-devbox' } },
    });

    expect(remoteClients.request.mock.calls.map((call) => call[1])).toContain('team/create');
    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0], 'agent/create',
      { input: { name: 'Dina', folder: '/home/mnmt/src/korus', teamId: 'team-remote' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(response).toMatchObject({ result: {
      teams: [{ id: 'team-test', agentIds: ['agent-local', 'agent-remote'] }],
      agents: expect.arrayContaining([
        expect.objectContaining({ id: 'agent-local', teamId: 'team-test' }),
        expect.objectContaining({ id: 'agent-remote', teamId: 'team-test', remoteConnectionId: 'connection-devbox' }),
      ]),
    } });
    expect(snapshot.agents.map((agent) => agent.id)).toStrictEqual(['agent-local']);
    expect(snapshot.teams[0]).toMatchObject({ remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }], agentIds: ['agent-local'] });
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('creates agents in the remote team without saving local proxy agents', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      color: '#46A857',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    snapshot.activeTeamId = 'team-pointer';
    const remoteSnapshot = createRemoteTeamSnapshot([createRemoteAgent()]);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const remoteClients = {
      request: vi.fn().mockResolvedValue(remoteSnapshot),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'create-remote-agent',
      method: 'agent/create',
      params: {
        input: {
          name: 'Dina',
          folder: '/home/mnmt/src/agent-workspace',
          teamId: 'team-pointer',
          remoteConnectionId: 'connection-devbox',
        },
      },
    })).resolves.toMatchObject({
      result: {
        activeTeamId: 'team-pointer',
        activeAgentId: 'agent-remote',
        teams: [{
          id: 'team-pointer',
          agentIds: ['agent-remote'],
        }],
        agents: [{
          id: 'agent-remote',
          teamId: 'team-pointer',
        }],
      },
    });

    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      'agent/create',
      { ...{
        input: {
          name: 'Dina',
          folder: '/home/mnmt/src/agent-workspace',
          teamId: 'team-remote',
        },
      }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.agents).toStrictEqual([]);
    expect(snapshot.teams[0]?.agentIds).toStrictEqual([]);
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('lets the remote host admit Claude work without implicitly installing it', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    const remoteAgent = { ...createRemoteAgent(), backend: 'claude' as const, folder: null, sessionKind: 'quickChat' as const };
    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    remoteSnapshot.general.claudeCodeEnabled = true;
    const order: string[] = [];
    const sshConnections = {
      ensureRemoteClaudeInstalled: vi.fn(async () => { order.push('ensure Claude'); return '2.1.283'; }),
    };
    const remoteClients = {
      request: vi.fn(async (_connection, method: string) => {
        order.push(method);
        if (method === 'snapshot/get') return {
          snapshot: remoteSnapshot,
          lastEventSeq: 0,
          clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false },
        };
        if (method === 'collaboration/team/bind' || method === 'agent/quickChat/create') return remoteSnapshot;
        throw new Error(`Unexpected remote method: ${method}`);
      }),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      sshConnections: sshConnections as never,
      remoteClients: remoteClients as never,
    });

    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'create-remote-claude-chat',
      method: 'agent/quickChat/create',
      params: { input: { teamId: 'team-pointer', selection: { backend: 'claude' }, remoteConnectionId: 'connection-devbox' } },
    });

    expect(sshConnections.ensureRemoteClaudeInstalled).not.toHaveBeenCalled();
    expect(order).toStrictEqual(['snapshot/get', 'collaboration/team/bind', 'agent/quickChat/create']);
    expect(response).toMatchObject({ result: { agents: [expect.objectContaining({ backend: 'claude' })] } });
  });

  it('creates team-scoped quick chats without a workspace', async () => {
    const snapshot = createTestSnapshot();
    const driverRpc = new BackendDriverRpc(new Map());
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      driverRpc,
      saveSnapshot,
    });

    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'create-quick-chat',
      method: 'agent/quickChat/create',
      params: { input: { teamId: 'team-test' } },
    });

    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
    expect(response).toMatchObject({
      result: {
        activeTeamId: 'team-test',
        agents: [expect.objectContaining({
          teamId: 'team-test',
          sessionKind: 'quickChat',
          name: null,
          folder: null,
          backend: 'codex',
        })],
      },
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'list-quick-chat-files',
      method: 'agent/files/list',
      params: { agentId: snapshot.agents.at(-1)!.id },
    })).rejects.toThrow('This session does not have a project workspace.');
  });

  it.each([
    { method: 'agent/prompt/send', delivery: {} },
    { method: 'agent/prompt/send', delivery: { expectedSessionId: JSON.stringify({ kind: 'antigravity', sessionId: 'remote-acp' }) } },
    { method: 'agent/prompt/steer', delivery: { startIfIdle: true, expectedSessionId: JSON.stringify({ kind: 'antigravity', sessionId: 'remote-acp' }) } },
  ])('routes remote agent prompts to the owning remote daemon ($method)', async ({ method, delivery }) => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    snapshot.activeTeamId = 'team-pointer';
    snapshot.activeAgentId = 'agent-remote';
    const remoteAgent = createRemoteAgent();
    remoteAgent.backend = 'antigravity';
    remoteAgent.backendSession = { kind: 'antigravity', sessionId: 'remote-acp' };
    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    const remoteSnapshotAfterPrompt = structuredClone(remoteSnapshot);
    remoteSnapshotAfterPrompt.agents[0]!.status = { type: 'working' };
    const remoteClients = {
      request: vi.fn()
        .mockResolvedValueOnce({
          snapshot: remoteSnapshot,
          lastEventSeq: 0,
          clientState: {
            sourceFolderPath: '',
            shouldPreventDisplaySleep: false,
          },
        })
        .mockResolvedValueOnce(remoteSnapshotAfterPrompt),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'prompt',
      method,
      params: {
        agentId: 'agent-remote',
        prompt: 'hello',
        ...delivery,
      },
    });
    expect(response).toMatchObject({
      result: {
        activeAgentId: 'agent-remote',
        agents: [{
          id: 'agent-remote',
          teamId: 'team-pointer',
        }],
      },
    });
    expect((response as { result: Record<string, unknown> }).result).not.toHaveProperty('messages');

    expect(remoteClients.request).toHaveBeenNthCalledWith(
      1,
      snapshot.remoteConnections.connections[0],
      'snapshot/get',
      { _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      2,
      snapshot.remoteConnections.connections[0],
      method,
      { ...{
        agentId: 'agent-remote',
        prompt: 'hello',
        options: undefined,
        ...delivery,
      }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.agents).toStrictEqual([]);
    const dispatched = remoteClients.request.mock.calls.length;
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'remote-file', method: 'agent/prompt/send',
      params: { agentId: 'agent-remote', prompt: 'Inspect', options: { attachments: [{ type: 'file', path: '/local-only.pdf' }] } },
    })).rejects.toThrow('trusted file transfer');
    expect(remoteClients.request.mock.calls.length).toBe(dispatched);
  });

  it.each(['agent/queuedPrompt/steer', 'agent/queuedPrompt/delete'])('preserves the captured queue session when routing %s remotely', async method => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection(); snapshot.remoteConnections.connections = [connection];
    snapshot.teams = [{ id: 'team-pointer', name: 'Remote', remoteLinks: [{ connectionId: connection.id, remoteTeamId: 'team-remote' }], agentIds: [] }];
    const agent = createRemoteAgent();
    const remote = createRemoteTeamSnapshot([agent]);
    const remoteClients = { close: vi.fn(async () => {}), request: vi.fn().mockResolvedValueOnce({ snapshot: remote, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } }).mockResolvedValueOnce(remote) };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: remoteClients as never });
    try {
      const params = { agentId: agent.id, promptId: 'queued-on-host', expectedSessionId: 'captured-session' };
      await server.handleMessage({ jsonrpc: '2.0', id: 'queue', method, params });
      expect(remoteClients.request).toHaveBeenNthCalledWith(2, connection, method, { ...params, _clientId: 'remote-controller' }, expect.any(Function));
    } finally { await server.close(); }
  });

  it('rejects malformed remote snapshots without adopting them', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    snapshot.activeTeamId = 'team-pointer';
    const remoteAgent = createRemoteAgent();
    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    const malformedFullSnapshot = structuredClone(remoteSnapshot);
    malformedFullSnapshot.agents[0]!.name = 'Malformed full snapshot';
    (malformedFullSnapshot.general.appshots as unknown as Record<string, unknown>).hotkey = 42;
    const malformedResult = structuredClone(remoteSnapshot);
    malformedResult.agents[0]!.name = 'Malformed result snapshot';
    (malformedResult.general.plugins as unknown as Record<string, unknown>).computerUseEnabled = 'yes';
    const validUpdatedSnapshot = structuredClone(remoteSnapshot);
    validUpdatedSnapshot.agents[0]!.name = 'Remote event update';
    const validFullSnapshot = structuredClone(remoteSnapshot);
    validFullSnapshot.agents[0]!.status = { type: 'working' };
    const remoteClients = {
      request: vi.fn(async (_connection, method: string, _params, onEvent?: (event: unknown) => void) => {
        if (method === 'snapshot/get') {
          return {
            snapshot: remoteSnapshot,
            lastEventSeq: 0,
            clientState: {
              sourceFolderPath: '',
              shouldPreventDisplaySleep: false,
            },
          };
        }
        if (method === 'client/navigation/selectAgent') return malformedFullSnapshot;
        if (method === 'agent/prompt/send') {
          onEvent?.({
            seq: 1,
            type: 'snapshot.updated',
            payload: validFullSnapshot,
            occurredAt: '2026-06-13T00:00:00.000Z',
          });
          onEvent?.({
            seq: 2,
            type: 'snapshot.updated',
            payload: validUpdatedSnapshot,
            occurredAt: '2026-06-13T00:00:01.000Z',
          });
          onEvent?.({
            seq: 3,
            type: 'snapshot.updated',
            payload: malformedFullSnapshot,
            occurredAt: '2026-06-13T00:00:02.000Z',
          });
          return malformedResult;
        }
        throw new Error(`Unexpected remote method: ${method}`);
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'snapshot',
      method: 'snapshot/get',
    });
    const selection = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'select',
      method: 'client/navigation/selectAgent',
      params: { agentId: remoteAgent.id },
    });
    const prompt = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'prompt',
      method: 'agent/prompt/send',
      params: { agentId: remoteAgent.id, prompt: 'hello' },
    });

    expect(selection).toMatchObject({ result: { agents: [{ name: 'Dina' }] } });
    expect(prompt).toMatchObject({ result: { agents: [{ name: 'Remote event update' }] } });
    await server.close();
  });

  it('projects and removes remote work item assignments through the owning remote daemon', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    snapshot.activeTeamId = 'team-pointer';
    snapshot.activeAgentId = 'agent-remote';
    const item = createWorkItem();
    const sanitizedItem = {
      provider: item.provider,
      id: item.id,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      number: item.number,
      title: item.title,
      url: item.url,
    };
    const assignmentKey = workItemAssignmentKey(item);
    const remoteAgent = createRemoteAgent();
    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    const assignedRemoteSnapshot = {
      ...remoteSnapshot,
      workBacklog: {
        ...remoteSnapshot.workBacklog,
        assignments: {
          [assignmentKey]: {
            provider: 'github',
            itemId: item.id,
            agentId: remoteAgent.id,
            assignedAt: '2026-06-14T10:00:00.000Z',
            policy: 'review' as const,
            status: 'inProgress' as const,
          },
        },
      },
    };
    const unassignedRemoteSnapshot = {
      ...remoteSnapshot,
      workBacklog: {
        ...remoteSnapshot.workBacklog,
        assignments: {},
      },
    };
    const remoteClients = {
      request: vi.fn(async (_connection, method: string) => {
        if (method === 'snapshot/get') {
          return {
            snapshot: remoteSnapshot,
            lastEventSeq: 0,
            clientState: {
              sourceFolderPath: '',
              shouldPreventDisplaySleep: false,
            },
          };
        }
        if (method === 'agent/workItem/assign') {
          return assignedRemoteSnapshot;
        }
        if (method === 'agent/workItem/assignment/delete') {
          return unassignedRemoteSnapshot;
        }
        return remoteSnapshot;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'assign-remote-item',
      method: 'agent/workItem/assign',
      params: { agentId: remoteAgent.id, item },
    })).resolves.toMatchObject({
      result: {
        workBacklog: {
          assignments: {
            [assignmentKey]: {
              agentId: remoteAgent.id,
              policy: 'review',
              status: 'inProgress',
            },
          },
        },
      },
    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remove-remote-item',
      method: 'agent/workItem/assignment/delete',
      params: { item },
    })).resolves.toMatchObject({
      result: {
        workBacklog: { assignments: {} },
      },
    });

    expect(remoteClients.request).toHaveBeenNthCalledWith(
      1,
      snapshot.remoteConnections.connections[0],
      'snapshot/get',
      { _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      2,
      snapshot.remoteConnections.connections[0],
      'agent/workItem/assign',
      { ...{ agentId: remoteAgent.id, item: sanitizedItem }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      3,
      snapshot.remoteConnections.connections[0],
      'agent/workItem/assignment/delete',
      { ...{ item: sanitizedItem }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.workBacklog.assignments).toStrictEqual({});
  });

  it('routes remote message actions to the owning remote daemon', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    snapshot.activeTeamId = 'team-pointer';
    snapshot.activeAgentId = 'agent-remote';
    const remoteAgent = createRemoteAgent();
    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    const remoteSnapshotAfterAction = {
      ...remoteSnapshot,
      agents: [{ ...remoteAgent, status: { type: 'idle' as const } }],
    };
    const remoteClients = {
      request: vi.fn(async (_connection, method: string) => {
        if (method === 'snapshot/get') {
          return {
            snapshot: remoteSnapshot,
            lastEventSeq: 0,
            clientState: {
              sourceFolderPath: '',
              shouldPreventDisplaySleep: false,
            },
          };
        }
        return remoteSnapshotAfterAction;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'delete-turn',
      method: 'agent/turn/delete',
      params: { agentId: 'agent-remote', turnId: 'turn-1' },
    })).resolves.toMatchObject({ result: { agents: [{ id: remoteAgent.id }] } });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'edit',
      method: 'agent/turn/edit',
      params: { agentId: 'agent-remote', turnId: 'turn-1', content: 'edited prompt' },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'retry',
      method: 'agent/turn/retry',
      params: { agentId: 'agent-remote', turnId: 'turn-1' },
    });

    expect(remoteClients.request).toHaveBeenNthCalledWith(
      1,
      snapshot.remoteConnections.connections[0],
      'snapshot/get',
      { _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      2,
      snapshot.remoteConnections.connections[0],
      'agent/turn/delete',
      { ...{ agentId: 'agent-remote', turnId: 'turn-1' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      3,
      snapshot.remoteConnections.connections[0],
      'agent/turn/edit',
      { ...{ agentId: 'agent-remote', turnId: 'turn-1', content: 'edited prompt' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      4,
      snapshot.remoteConnections.connections[0],
      'agent/turn/retry',
      { ...{ agentId: 'agent-remote', turnId: 'turn-1' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
  });

  it('moves a local agent into a team that also holds remote agents', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [
      {
        id: 'team-local',
        name: 'Local',
        agentIds: ['agent-local'],
      },
      {
        id: 'team-pointer',
        name: 'Remote Core',
        remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
        agentIds: [],
      },
    ];
    snapshot.activeTeamId = 'team-local';
    snapshot.activeAgentId = 'agent-local';
    snapshot.agents = [{
      id: 'agent-local',
      teamId: 'team-local',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-14T10:00:00.000Z',
      updatedAt: '2026-06-14T10:00:00.000Z',
    }];
    const remoteClients = {
      request: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'move-local-to-remote',
      method: 'agent/team/move',
      params: { input: { agentId: 'agent-local', teamId: 'team-pointer' } },
    })).resolves.toMatchObject({ result: { agents: [expect.objectContaining({ id: 'agent-local', teamId: 'team-pointer' })] } });

    expect(snapshot.agents[0]).toMatchObject({ id: 'agent-local', teamId: 'team-pointer' });
    expect(snapshot.teams.find((team) => team.id === 'team-pointer')?.agentIds).toStrictEqual(['agent-local']);
    expect(remoteClients.request.mock.calls.map((call) => call[1])).not.toContain('agent/team/move');
  });

  it('projects only the selected remote team state into local snapshots', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    snapshot.activeTeamId = 'team-pointer';
    const remoteAgent = createRemoteAgent();
    const otherRemoteAgent = {
      ...createRemoteAgent(),
      id: 'agent-other-remote',
      teamId: 'team-other-remote',
      name: 'Other Remote',
    };
    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    remoteSnapshot.teams.push({
      id: 'team-other-remote',
      name: 'Other Remote Team',
      agentIds: [otherRemoteAgent.id],
      activeAgentId: otherRemoteAgent.id,
    });
    remoteSnapshot.agents.push(otherRemoteAgent);
    remoteSnapshot.agentGitStatuses = {
      [remoteAgent.id]: {
        folder: remoteAgent.folder!,
        branch: 'main',
        ahead: 0,
        behind: 0,
        changedFiles: 1,
        addedLines: 3,
        removedLines: 0,
        hasUntracked: false,
        state: 'dirty',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      [otherRemoteAgent.id]: {
        folder: otherRemoteAgent.folder!,
        branch: 'other',
        ahead: 0,
        behind: 0,
        changedFiles: 4,
        addedLines: 10,
        removedLines: 1,
        hasUntracked: false,
        state: 'dirty',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    };
    remoteSnapshot.turnGitDiffs = {
      'turn-selected': {
        agentId: remoteAgent.id,
        turnId: 'turn-selected',
        addedLines: 3,
        removedLines: 0,
        diff: 'selected diff',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      'turn-other': {
        agentId: otherRemoteAgent.id,
        turnId: 'turn-other',
        addedLines: 10,
        removedLines: 1,
        diff: 'other diff',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    };
    const remoteClients = {
      request: vi.fn().mockResolvedValue({
        snapshot: remoteSnapshot,
        lastEventSeq: 0,
        clientState: {
          sourceFolderPath: '',
          shouldPreventDisplaySleep: false,
        },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'snapshot',
      method: 'snapshot/get',
    })).resolves.toMatchObject({
      result: {
        snapshot: {
          agents: [expect.objectContaining({ id: remoteAgent.id, teamId: 'team-pointer' })],
          agentGitStatuses: {
            [remoteAgent.id]: expect.objectContaining({ branch: 'main' }),
          },
          turnGitDiffs: {
            'turn-selected': expect.objectContaining({ diff: 'selected diff' }),
          },
        },
      },
    });
    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'snapshot-assertions',
      method: 'snapshot/get',
    });
    expect(response).toHaveProperty('result');
    const projectedSnapshot = (response as { result: { snapshot: AppSnapshot } }).result.snapshot;
    expect(projectedSnapshot.agents.some((agent) => agent.id === otherRemoteAgent.id)).toBe(false);
    expect(projectedSnapshot.agentGitStatuses[otherRemoteAgent.id]).toBeUndefined();
    expect(projectedSnapshot.turnGitDiffs['turn-other']).toBeUndefined();
  });

  it('keeps remote agents in results that return the local snapshot', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-local',
      name: 'Local',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: ['agent-local'],
    }];
    snapshot.activeTeamId = 'team-local';
    snapshot.activeAgentId = 'agent-local';
    snapshot.agents = [{
      id: 'agent-local',
      teamId: 'team-local',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-14T10:00:00.000Z',
      updatedAt: '2026-06-14T10:00:00.000Z',
    }];
    const remoteAgent = createRemoteAgent();
    const remoteClients = {
      request: vi.fn().mockResolvedValue({
        snapshot: createRemoteTeamSnapshot([remoteAgent]),
        lastEventSeq: 0,
        clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });
    await server.handleMessage({ jsonrpc: '2.0', id: 'snapshot', method: 'snapshot/get' });

    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'load',
      method: 'agent/conversation/load',
      params: { agentId: 'agent-local' },
    });

    expect((response as { result: AppSnapshot }).result.agents.map((agent) => agent.id)).toContain(remoteAgent.id);
    expect(snapshot.agents.map((agent) => agent.id)).not.toContain(remoteAgent.id);
  });

  it('forwards remote events only for agents in connected remote team pointers', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams = [{
      id: 'team-pointer',
      name: 'Remote Core',
      remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
      agentIds: [],
    }];
    const remoteAgent = createRemoteAgent();
    const otherRemoteAgent = {
      ...createRemoteAgent(),
      id: 'agent-other-remote',
      teamId: 'team-other-remote',
      name: 'Other Remote',
    };
    const remoteSnapshot = createRemoteTeamSnapshot([remoteAgent]);
    remoteSnapshot.teams.push({
      id: 'team-other-remote',
      name: 'Other Remote Team',
      agentIds: [otherRemoteAgent.id],
      activeAgentId: otherRemoteAgent.id,
    });
    remoteSnapshot.agents.push(otherRemoteAgent);
    const events: unknown[] = [];
    const remoteClients = {
      request: vi.fn(async (_connection, _method: string, _params, onEvent?: (event: unknown) => void) => {
        onEvent?.({
          seq: 1,
          type: 'agent.statusChanged',
          agentId: otherRemoteAgent.id,
          payload: { type: 'working' },
          occurredAt: '2026-06-13T00:00:00.000Z',
          snapshot: remoteSnapshot,
        });
        onEvent?.({
          seq: 2,
          type: 'agent.statusChanged',
          agentId: remoteAgent.id,
          payload: { type: 'working' },
          occurredAt: '2026-06-13T00:00:01.000Z',
          snapshot: remoteSnapshot,
          clientState: {
            sourceFolderPath: '/remote/source',
            shouldPreventDisplaySleep: true,
            shouldPreventDisplaySleepForRemoteAccess: true,
          },
        });
        return {
          snapshot: remoteSnapshot,
          lastEventSeq: 0,
          clientState: {
            sourceFolderPath: '',
            shouldPreventDisplaySleep: false,
          },
        };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
      onEvent: (event) => events.push(event),
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'snapshot',
      method: 'snapshot/get',
    });

    expect(events).toHaveLength(1);
    expect(events).toStrictEqual([
      expect.objectContaining({
        type: 'agent.statusChanged',
        agentId: remoteAgent.id,
        payload: { type: 'working' },
        clientState: {
          sourceFolderPath: '',
          shouldPreventDisplaySleep: false,
          shouldPreventDisplaySleepForRemoteAccess: false,
        },
      }),
    ]);

    events.length = 0;
    const onRemoteEvent = remoteClients.request.mock.calls[0]?.[3];
    onRemoteEvent?.({
      seq: 3,
      type: 'models.changed',
      backend: remoteAgent.backend,
      payload: { models: [] },
      occurredAt: '2026-06-13T00:00:02.000Z',
      snapshot: remoteSnapshot,
    });
    expect(events).toEqual([
      expect.objectContaining({ type: 'models.changed', agentId: remoteAgent.id }),
    ]);
    events.length = 0;
    onRemoteEvent?.({
      seq: 4,
      type: 'skills.changed',
      backend: remoteAgent.backend,
      payload: { skills: [], cwd: remoteAgent.folder },
      occurredAt: '2026-06-13T00:00:03.000Z',
      snapshot: remoteSnapshot,
    });
    expect(events).toEqual([
      expect.objectContaining({ type: 'skills.changed', agentId: remoteAgent.id }),
    ]);
    events.length = 0;
    onRemoteEvent?.({
      seq: 5, type: 'account.rateLimitsUpdated', backend: 'claude', occurredAt: '2026-06-13T00:00:04.000Z',
      payload: { rateLimits: { limitId: 'claude', limitName: null, primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null }, secondary: null, credits: null, individualLimit: null, planType: null, rateLimitReachedType: null } },
    });
    expect(events).toEqual([]);
  });
});
