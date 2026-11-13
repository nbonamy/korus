import { expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { AppRpcRequest } from '@workspace/core/backend-protocol/rpc';
import type { Agent } from '@workspace/core/contracts';
import { AppBackendServer } from '../server';
import { createRemoteAgent, createRemoteTeamSnapshot, createTestSnapshot, gitWorkspace, readyRemoteConnection } from './server-test-fixtures';

const overview = { generatedAt: '2026-11-11T12:00:00.000Z', repository: { name: 'korus', branch: 'main', baseBranch: 'main' } };

function localAgent(): Agent {
  return { id: 'agent-local', teamId: 'team-test', name: 'Local', backend: 'codex', folder: '/work/korus', status: { type: 'idle' }, workspace: gitWorkspace('/work/korus', 'korus', 'main') } as Agent;
}

it('answers a project overview from the local service for the requesting agent without changing navigation', async () => {
  const snapshot = createTestSnapshot();
  const agent = localAgent();
  snapshot.agents.push(agent);
  snapshot.teams[0]!.agentIds.push(agent.id);
  const get = vi.fn().mockResolvedValue(overview);
  const refreshNarrative = vi.fn().mockResolvedValue(overview);
  const server = new AppBackendServer({ version: 'test', snapshot, projectOverview: { get, refreshNarrative } });
  try {
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'overview', method: backendMethods.projectOverviewGet, params: { agentId: agent.id } }))
      .resolves.toStrictEqual({ jsonrpc: '2.0', id: 'overview', result: overview });
    expect(get).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: agent.id, folder: '/work/korus' }), {});
    expect(snapshot.activeAgentId).toBeNull();

    // A caller can ask for the repository first and for each source as it lands; unknown sources are refused.
    await server.handleMessage({ jsonrpc: '2.0', id: 'staged', method: backendMethods.projectOverviewGet, params: { agentId: agent.id, wait: ['pipelines'] } });
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ id: agent.id }), { wait: ['pipelines'] });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'bad', method: backendMethods.projectOverviewGet, params: { agentId: agent.id, wait: ['git'] } } as AppRpcRequest))
      .rejects.toThrow('wait must list backlog, pullRequests or pipelines.');
    get.mockClear();

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'rewrite', method: backendMethods.projectNarrativeRefresh, params: { agentId: agent.id } }))
      .resolves.toStrictEqual({ jsonrpc: '2.0', id: 'rewrite', result: overview });
    expect(refreshNarrative).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: agent.id }), expect.any(Function));
    expect(get).not.toHaveBeenCalled();

    const unknown = await server.handleMessage({ jsonrpc: '2.0', id: 'missing', method: backendMethods.projectOverviewGet, params: { agentId: 'nobody' } });
    expect(unknown).toMatchObject({ id: 'missing', error: { message: 'Agent not found: nobody' } });
    expect(get).not.toHaveBeenCalled();
  } finally { await server.close(); }
});

it('routes a project overview to the host that owns a remote agent and never reads its repository locally', async () => {
  const agent = createRemoteAgent();
  const remoteGet = vi.fn().mockResolvedValue(overview);
  const localGet = vi.fn().mockRejectedValue(new Error('A remote repository must not be read locally'));
  const daemon = new AppBackendServer({ version: 'test', snapshot: createRemoteTeamSnapshot([agent]), projectOverview: { get: remoteGet, refreshNarrative: vi.fn() } });
  const snapshot = createTestSnapshot();
  const connection = readyRemoteConnection();
  snapshot.remoteConnections.connections = [connection];
  snapshot.teams.push({ id: 'pointer', name: 'Remote', agentIds: [], remoteLinks: [{ connectionId: connection.id, remoteTeamId: 'team-remote' }] });
  const request = vi.fn(async (_connection: unknown, method: string, params: unknown) => {
    const response = await daemon.handleMessage({ jsonrpc: '2.0', id: 'remote', method, params } as AppRpcRequest);
    if (response && 'result' in response) return response.result;
    throw new Error(JSON.stringify(response));
  });
  const controller = new AppBackendServer({ version: 'test', snapshot, projectOverview: { get: localGet, refreshNarrative: localGet }, remoteClients: { request, close: vi.fn() } as never });
  try {
    await expect(controller.handleMessage({ jsonrpc: '2.0', id: 'overview', method: backendMethods.projectOverviewGet, params: { agentId: agent.id, wait: ['backlog'] } }))
      .resolves.toStrictEqual({ jsonrpc: '2.0', id: 'overview', result: overview });
    // The owning host decides what to wait for, so a staged read keeps its sources across the hop.
    expect(remoteGet).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: agent.id }), { wait: ['backlog'] });
    expect(localGet).not.toHaveBeenCalled();
  } finally { await controller.close(); await daemon.close(); }
});

it('says so when this host has no project overview service', async () => {
  const snapshot = createTestSnapshot();
  const agent = localAgent();
  snapshot.agents.push(agent);
  const server = new AppBackendServer({ version: 'test', snapshot });
  try {
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'overview', method: backendMethods.projectOverviewGet, params: { agentId: agent.id } }))
      .rejects.toThrow('The project overview is unavailable on this host.');
  } finally { await server.close(); }
});
