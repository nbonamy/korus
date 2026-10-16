import { describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { AppRpcRequest } from '@workspace/core/backend-protocol/rpc';
import { AppBackendServer } from '../server';
import { createTestSnapshot, createRemoteAgent, createRemoteTeamSnapshot, readyRemoteConnection } from './server-test-fixtures';

it.each([
  [backendMethods.agentGitLogGet, 'list', { search: 'fix', cursor: { head: 'head', offset: 50, search: 'fix' } }, { repository: 'remote', branch: 'feature', head: 'head', commits: [] }],
  [backendMethods.agentGitLogCommitGet, 'commit', { head: 'head', sha: 'sha' }, { message: 'Full remote message', files: [] }],
  [backendMethods.agentGitLogFileGet, 'file', { head: 'head', sha: 'sha', path: 'file.ts' }, { diff: 'remote patch' }],
] as const)('routes %s to the owning host without reading locally or updating navigation', async (method, operation, input, result) => {
  const agent = createRemoteAgent();
  const remoteSnapshot = createRemoteTeamSnapshot([agent]);
  const remoteRead = vi.fn().mockResolvedValue(result);
  const localRead = vi.fn().mockRejectedValue(new Error('Remote repository must not be read locally'));
  const daemon = new AppBackendServer({ version: 'test', snapshot: remoteSnapshot, agentGitService: { history: { [operation]: remoteRead } } as never });
  const snapshot = createTestSnapshot();
  const connection = readyRemoteConnection();
  snapshot.remoteConnections.connections = [connection];
  snapshot.teams.push({ id: 'pointer', name: 'Remote', agentIds: [], remoteConnectionId: connection.id, remoteTeamId: 'team-remote' });
  const request = vi.fn(async (_connection: unknown, method: string, params: unknown) => {
    const response = await daemon.handleMessage({ jsonrpc: '2.0', id: 'remote', method, params } as AppRpcRequest);
    if (response && 'result' in response) return response.result;
    throw new Error(JSON.stringify(response));
  });
  const controller = new AppBackendServer({ version: 'test', snapshot, agentGitService: { history: { [operation]: localRead } } as never, remoteClients: { request, close: vi.fn() } as never });
  try {
    const before = snapshot.activeAgentId;
    await expect(controller.handleMessage({ jsonrpc: '2.0', id: 'history', method, params: { agentId: agent.id, input } })).resolves.toStrictEqual({ jsonrpc: '2.0', id: 'history', result });
    expect(remoteRead).toHaveBeenCalledExactlyOnceWith(agent.folder, input);
    expect(localRead).not.toHaveBeenCalled();
    expect(snapshot.activeAgentId).toBe(before);
  } finally { await controller.close(); await daemon.close(); }
});
