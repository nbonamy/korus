import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { createTestSnapshot, createRemoteTeamSnapshot, readyRemoteConnection } from './server-test-fixtures';

const exec = promisify(execFile);
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

// The public daemon operation owns branch/worktree selection. Real Git and filesystem
// catch wrong-checkout creation and accidental modification of the primary checkout.
describe('repository-backed agent creation', () => {
  it('resolves repository intents through existing remote operations without requiring new remote input fields', async () => {
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'remote-repository-agent-')));
    cleanup.push(() => rm(parent, { recursive: true, force: true }));
    const root = path.join(parent, 'repo'); await mkdir(root);
    const git = (...args: string[]) => exec('git', ['-C', root, ...args]);
    await git('init', '-b', 'main');
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'init');
    await git('branch', 'feature'); await git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
    await git('checkout', '-b', 'feature-primary');
    const remoteSnapshot = createRemoteTeamSnapshot(); remoteSnapshot.sourceFolder = { path: parent, initialized: true, recentRepoNames: [] };
    const remote = new AppBackendServer({ version: 'test', snapshot: remoteSnapshot, driverRpc: new BackendDriverRpc(new Map()) });
    const connection = readyRemoteConnection();
    const request = vi.fn(async (_connection: unknown, method: string, params: unknown) => {
      const result = await remote.handleMessage({ jsonrpc: '2.0', id: 'remote', method, params });
      if (!result || 'error' in result) throw new Error('Remote operation failed.');
      return result.result;
    });
    const snapshot = createTestSnapshot(); snapshot.remoteConnections.connections = [connection];
    snapshot.teams.push({ id: 'pointer', name: 'Remote', agentIds: [], remoteLinks: [{ connectionId: connection.id, remoteTeamId: remoteSnapshot.teams[0]!.id }] });
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: { request, close: async () => {} } as never });
    cleanup.push(() => server.close()); cleanup.push(() => remote.close());
    const acquired = await server.handleMessage({ jsonrpc: '2.0', id: 'acquire', method: 'source/repository/clone', params: { input: { url: 'git@github.com:example/repo.git', reuseExisting: true, remoteConnectionId: connection.id } } });
    expect(acquired).toMatchObject({ result: { path: root } });
    expect(request.mock.calls.some(([, method]) => method === 'source/repository/clone')).toBe(false);
    const created = await server.handleMessage({ jsonrpc: '2.0', id: 'create', method: 'agent/create', params: { entityResult: true,
      input: { name: null, folder: root, teamId: 'pointer', remoteConnectionId: connection.id, repositorySession: { existingBranch: 'feature' }, selection: { backend: 'codex' } } } });
    expect(created).not.toHaveProperty('error');
    const agent = remoteSnapshot.agents.find(candidate => candidate.folder === `${root}-feature`)!;
    expect(agent).toBeDefined();
    expect(request.mock.calls.find(([, method]) => method === 'agent/create')?.[2]).toMatchObject({ input: { folder: `${root}-feature` } });
    expect(request.mock.calls.find(([, method]) => method === 'agent/create')?.[2]).not.toHaveProperty('input.repositorySession');
    const preview = await server.handleMessage({ jsonrpc: '2.0', id: 'preview', method: 'agent/close/preview', params: { agentId: agent.id } });
    expect(preview).toHaveProperty('result');
    expect(request.mock.calls.some(([, method]) => method === 'agent/close/preview')).toBe(false);
    const defaultSession = await server.handleMessage({ jsonrpc: '2.0', id: 'default', method: 'agent/create', params: { entityResult: true,
      input: { name: null, folder: root, teamId: 'pointer', remoteConnectionId: connection.id, repositorySession: {}, selection: { backend: 'codex' } } } });
    expect(defaultSession).not.toHaveProperty('error');
    expect(remoteSnapshot.agents.at(-1)?.folder).toBe(`${root}-main`);
    expect((await exec('git', ['-C', `${root}-main`, 'branch', '--show-current'])).stdout.trim()).toBe('main');
    expect((await git('branch', '--show-current')).stdout.trim()).toBe('feature-primary');
  });

  it('reuses the configured checkout for an equivalent remote without attempting another clone', async () => {
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'repository-acquire-')));
    cleanup.push(() => rm(parent, { recursive: true, force: true }));
    const folder = path.join(parent, 'repo'); await mkdir(folder);
    await exec('git', ['-C', folder, 'init', '-b', 'main']);
    await exec('git', ['-C', folder, 'remote', 'add', 'origin', 'git@github.com:example/repo.git']);
    const snapshot = createTestSnapshot(); snapshot.sourceFolder.path = parent; snapshot.sourceFolder.initialized = true;
    const driver = new BackendDriverRpc(new Map()); const original = driver.handle.bind(driver);
    const clone = vi.fn(() => { throw new Error('A known checkout must not be cloned.'); });
    vi.spyOn(driver, 'handle').mockImplementation((method, params) => method === 'source/repository/clone' ? clone() : original(method, params));
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: driver, saveSnapshot: async () => {} });
    cleanup.push(() => server.close());
    const reply = await server.handleMessage({ jsonrpc: '2.0', id: 'acquire', method: 'source/repository/clone', params: {
      input: { url: 'https://github.com/example/repo.git', reuseExisting: true },
    } });
    expect(reply).toMatchObject({ result: { name: 'repo', path: folder } });
    expect(clone).not.toHaveBeenCalled();
  });

  it('opens an existing branch in a separate checkout and reuses it for another client', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'repository-agent-')));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const git = (...args: string[]) => exec('git', ['-C', root, ...args]);
    await git('init', '-b', 'main');
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'init');
    await git('branch', 'feature');
    await git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
    await git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await git('branch', '--set-upstream-to', 'origin/main', 'feature');
    await writeFile(path.join(root, 'keep.txt'), 'uncommitted work');
    const snapshot = createTestSnapshot();
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map()), saveSnapshot: async () => {} });
    cleanup.push(() => server.close());
    const destination = `${root}-feature`;
    cleanup.unshift(() => rm(destination, { recursive: true, force: true }));
    for (const client of ['desktop', 'companion-write']) {
      const reply = await server.handleMessage({ jsonrpc: '2.0', id: client, method: 'agent/create', params: {
        _clientId: client, entityResult: true, input: { name: null, folder: root, teamId: 'team-test', repositorySession: { existingBranch: 'feature' }, selection: { ...{ backend: 'codex' } } },
      } });
      expect(reply).not.toHaveProperty('error');
      expect(snapshot.agents.at(-1)?.folder).toBe(destination);
      expect(reply).toMatchObject({ result: { agentId: snapshot.agents.at(-1)!.id, snapshot: { activeAgentId: snapshot.agents.at(-1)!.id } } });
      const preview = await server.handleMessage({ jsonrpc: '2.0', id: `preview-${client}`, method: 'agent/close/preview', params: { agentId: snapshot.agents.at(-1)!.id } });
      expect(preview).toMatchObject({ result: { isLinkedWorktree: client === 'desktop', hasChanges: false } });
      if (client === 'desktop') {
        expect(preview).toMatchObject({ result: { upstream: null } });
        await git('update-ref', 'refs/remotes/origin/feature', 'HEAD');
        await git('branch', '--set-upstream-to', 'origin/feature', 'feature');
        const published = await server.handleMessage({ jsonrpc: '2.0', id: 'published-preview', method: 'agent/close/preview', params: { agentId: snapshot.agents.at(-1)!.id } });
        expect(published).toMatchObject({ result: { upstream: 'origin/feature' } });
      }
    }
    expect(snapshot.agents).toHaveLength(2);
    expect((await git('branch', '--show-current')).stdout.trim()).toBe('main');
    expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('uncommitted work');
    expect((await git('worktree', 'list', '--porcelain')).stdout.match(/branch refs\/heads\/feature/g)).toHaveLength(1);
    const persisted = await server.handleMessage({ jsonrpc: '2.0', id: 'read', method: 'snapshot/get' });
    expect(persisted).toMatchObject({ result: { snapshot: { agents: snapshot.agents.map(agent => ({ id: agent.id, folder: destination })) } } });
  });
});
