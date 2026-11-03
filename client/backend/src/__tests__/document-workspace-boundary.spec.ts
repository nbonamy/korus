import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppBackendServer } from '../server';
import { DocumentWorkspaceService } from '../document-workspace-service';
import { createRemoteAgent, createTestSnapshot } from './server-test-fixtures';

it('removes all client tabs and transient bytes only after agent closure succeeds, retaining saved files and other agents', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'document-close-test-'));
  const filename = path.join(home, 'documents.json');
  const snapshot = createTestSnapshot();
  const agent = { ...createRemoteAgent(), id: 'closing', teamId: snapshot.teams[0]!.id, folder: home };
  snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = [agent.id];
  const documents = new DocumentWorkspaceService(filename);
  await documents.get('desktop'); await documents.get('web');
  const temporary = await documents.display(agent.id, { kind: 'markdown', content: 'Unsaved' });
  const saved = await documents.display(agent.id, { kind: 'markdown', content: 'Saved' });
  const kept = await documents.display('disconnected-remote', { kind: 'markdown', content: 'Keep remote' });
  const savedPath = path.join(home, 'saved.md');
  await documents.save('desktop', agent.id, { tabId: `file:markdown:${saved.documentId}`, path: savedPath }, async (file, content) => {
    await writeFile(file, content); return file;
  });
  const deleteLinkedWorktree = vi.fn(async () => {
    expect((await documents.get('desktop'))[agent.id]).toBeDefined();
    throw new Error('Worktree cleanup failed');
  });
  const server = new AppBackendServer({ version: 'test', snapshot, documents,
    agentGitService: { validateLinkedWorktreeDeletion: vi.fn(), deleteLinkedWorktree } as never });
  const close = (deleteWorktree = false) => server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/delete', params: { agentId: agent.id, input: { confirmed: true, deleteWorktree } } });
  try {
    await expect(close(true)).rejects.toThrow('Worktree cleanup failed');
    expect(deleteLinkedWorktree).toHaveBeenCalledOnce();
    expect((await documents.get('web'))[agent.id]).toBeDefined();
    expect(await close()).toHaveProperty('result');
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'client/workspace/apply', params: {
      agentId: agent.id, change: { open: true },
    } })).toHaveProperty('error');
    const restarted = new DocumentWorkspaceService(filename);
    for (const client of ['desktop', 'web']) {
      expect(Object.keys(await restarted.get(client))).toEqual(['disconnected-remote']);
    }
    expect(Object.keys(JSON.parse(await readFile(filename, 'utf8')).data.documents)).toEqual([kept.documentId]);
    expect(await readFile(savedPath, 'utf8')).toBe('Saved');
    await expect(restarted.read('web', agent.id, `file:markdown:${temporary.documentId}`, async () => '')).rejects.toThrow('closed');
  } finally { await server.close(); await rm(home, { recursive: true, force: true }); }
});

it('restores and saves through the client-scoped protocol after a fresh backend instance', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'document-boundary-test-'));
  const filename = path.join(home, 'documents.json');
  const snapshot = createInitialSnapshot(); snapshot.agents[0]!.folder = home;
  const documents = new DocumentWorkspaceService(filename);
  const displayed = await documents.display('agent-dina', { kind: 'markdown', title: 'Proposal', content: '# Retained' });
  const server = new AppBackendServer({ version: 'test', snapshot, documents: new DocumentWorkspaceService(filename) });
  const call = (method: string, params = {}) => server.handleMessage({ jsonrpc: '2.0', id: 1, method, params });
  const tabId = `file:markdown:${displayed.documentId}`;
  try {
    expect(await call('client/workspace/get')).toMatchObject({ result: { 'agent-dina': { tabs: [{ id: tabId, title: 'Proposal' }] } } });
    expect(await call('client/document/read', { agentId: 'agent-dina', tabId })).toMatchObject({ result: { content: '# Retained' } });
    expect(await call('client/document/read', { agentId: 'agent-dina', tabId, _clientId: 'other' })).toHaveProperty('error');
    expect(await call('client/document/save', { agentId: 'agent-dina', input: { tabId, path: 'saved.md' } })).toMatchObject({ result: { tabs: [{ id: tabId, savedPath: path.join(await realpath(home), 'saved.md') }] } });
    expect(await call('client/workspace/apply', { agentId: 'agent-dina', change: { close: [tabId] } })).toMatchObject({ result: { tabs: [] } });
    expect(await readFile(path.join(home, 'saved.md'), 'utf8')).toBe('# Retained');
    expect((await new DocumentWorkspaceService(filename).get('desktop'))['agent-dina']!.tabs).toEqual([]);
  } finally { await server.close(); await rm(home, { recursive: true, force: true }); }
});

it('routes Save As to the remote agent host rather than a local folder', async () => {
  const { createTestSnapshot, createRemoteAgent, createRemoteTeamSnapshot, readyRemoteConnection } = await import('./server-test-fixtures');
  const home = await mkdtemp(path.join(os.tmpdir(), 'remote-document-test-'));
  const remoteAgent = createRemoteAgent(); remoteAgent.folder = home;
  const remote = new AppBackendServer({ version: 'test', snapshot: createRemoteTeamSnapshot([remoteAgent]),
    agentGitService: { validateLinkedWorktreeDeletion: vi.fn(), deleteLinkedWorktree: vi.fn(async () => { throw new Error('Remote cleanup failed'); }) } as never });
  const snapshot = createTestSnapshot();
  const connection = readyRemoteConnection(); snapshot.remoteConnections.connections = [connection];
  snapshot.teams.push({ id: 'remote-pointer', name: 'Remote', agentIds: [], remoteLinks: [{ connectionId: connection.id, remoteTeamId: 'team-remote' }] });
  const documents = new DocumentWorkspaceService(path.join(home, 'client-documents.json'));
  const displayed = await documents.display(remoteAgent.id, { kind: 'markdown', content: 'Remote bytes' });
  const local = new AppBackendServer({ version: 'test', snapshot, documents, remoteClients: {
    request: async (_connection: unknown, method: string, params: unknown) => {
      const response = await remote.handleMessage({ jsonrpc: '2.0', id: 1, method, params } as import('@workspace/core/backend-protocol/rpc').AppRpcRequest);
      if (response && 'result' in response) return response.result;
      throw Error(JSON.stringify(response));
    }, close: async () => {},
  } as never });
  try {
    const result = await local.handleMessage({ jsonrpc: '2.0', id: 1, method: 'client/document/save', params: { agentId: remoteAgent.id, input: { tabId: `file:markdown:${displayed.documentId}`, path: 'remote.md' } } });
    expect(result).toHaveProperty('result');
    expect(await readFile(path.join(home, 'remote.md'), 'utf8')).toBe('Remote bytes');
    await expect(local.handleMessage({ jsonrpc: '2.0', id: 2, method: 'agent/delete', params: {
      agentId: remoteAgent.id, input: { confirmed: true, deleteWorktree: true },
    } })).rejects.toThrow('Remote cleanup failed');
    expect((await documents.get('desktop'))[remoteAgent.id]).toBeDefined();
    expect(await local.handleMessage({ jsonrpc: '2.0', id: 2, method: 'agent/delete', params: { agentId: remoteAgent.id } })).toHaveProperty('result');
    expect(await new DocumentWorkspaceService(path.join(home, 'client-documents.json')).get('desktop')).toEqual({});
    expect(await readFile(path.join(home, 'remote.md'), 'utf8')).toBe('Remote bytes');
  } finally { await local.close(); await remote.close(); await rm(home, { recursive: true, force: true }); }
});
