import { it, expect, vi } from 'vitest';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';
import { AppBackendServer } from '../server';
import { createTestSnapshot, createRemoteAgent, createRemoteTeamSnapshot, readyRemoteConnection } from './server-test-fixtures';

it.each(['working', 'awaitingInput'] as const)('blocks a remote parent handoff while a local child is %s', async status => {
  const snapshot = createTestSnapshot();
  const connection = readyRemoteConnection();
  snapshot.remoteConnections.connections = [connection];
  snapshot.teams[0]!.remoteLinks = [{ connectionId: connection.id, remoteTeamId: 'team-remote' }];
  const parent = createRemoteAgent();
  const remote = createRemoteTeamSnapshot([parent]);
  snapshot.agents = [{ ...parent, id: 'local-child', teamId: snapshot.teams[0]!.id, delegatedByAgentId: parent.id, status: { type: status } }];
  snapshot.teams[0]!.agentIds = ['local-child'];
  const request = vi.fn(async (_connection: unknown, method: string) => method === 'collaboration/task/access' ? [] : method === 'snapshot/get'
    ? { snapshot: remote, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } } : remote);
  const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: { request, close: async () => {} } as never });
  try {
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'handoff', method: 'agent/handoff/start', params: {
      agentId: parent.id, input: { operationId: 'once', selection: { backend: 'claude', model: null, reasoningEffort: null, serviceTier: null } },
    } })).rejects.toThrow('delegated');
    expect(request.mock.calls.map(([, method]) => method)).not.toContain('agent/handoff/start');
  } finally { await server.close(); }
});

it('retains child creator authority after a lost handoff reply and controller reload', async () => {
  const snapshot = createTestSnapshot();
  const connection = readyRemoteConnection();
  snapshot.remoteConnections.connections = [connection];
  snapshot.teams[0]!.remoteLinks = [{ connectionId: connection.id, remoteTeamId: 'team-remote' }];
  const parent = createRemoteAgent();
  const remote = createRemoteTeamSnapshot([parent]);
  const replacement = { ...parent, id: 'replacement-parent', handoff: { operationId: 'once', sourceAgentId: parent.id, targetAgentId: 'replacement-parent', sourceTitle: 'Parent', sourceRef: { backend: 'codex' as const, threadId: 'original' }, phase: 'complete' as const, selection: { backend: 'claude' as const, model: null, reasoningEffort: null, serviceTier: null } } };
  const after = createRemoteTeamSnapshot([replacement]);
  const child = { ...parent, id: 'local-child', teamId: snapshot.teams[0]!.id, delegatedByAgentId: parent.id };
  snapshot.agents = [child]; snapshot.teams[0]!.agentIds = [child.id];
  let current = remote;
  let lose = true;
  const request = vi.fn(async (_connection: unknown, method: string) => {
    if (method === 'snapshot/get') return { snapshot: current, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } };
    if (method === 'collaboration/task/access') return [];
    if (method === 'agent/handoff/start') { current = after; if (lose) { lose = false; throw new Error('Lost reply'); } }
    return current;
  });
  const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: { request, close: async () => {} } as never });
  try {
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'handoff', method: 'agent/handoff/start', params: {
      agentId: parent.id, input: { operationId: 'once', selection: replacement.handoff.selection },
    } })).rejects.toThrow('Lost reply');
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'retry-handoff', method: 'agent/handoff/start', params: {
      agentId: parent.id, input: { operationId: 'once', selection: replacement.handoff.selection },
    } })).resolves.toHaveProperty('result');
    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));
    const reloaded = new AppBackendServer({ version: 'test', snapshot: restored, remoteClients: { request, close: async () => {} } as never });
    try {
      await reloaded.handleMessage({ jsonrpc: '2.0', id: 'refresh', method: 'snapshot/get' });
      await expect(reloaded.closeAgentFromMcp(child.id, replacement.id)).rejects.toThrow('creator');
      await expect(reloaded.closeAgentFromMcp(replacement.id, child.id)).resolves.toBeUndefined();
    } finally { await reloaded.close(); }
  } finally { await server.close(); }
});
