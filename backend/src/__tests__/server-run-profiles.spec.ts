import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppBackendServer, type AppBackendServerOptions } from '../server';
import { RunProfileService } from '../run-profile-service';
import { createRemoteAgent, createRemoteTeamSnapshot, createTestSnapshot, readyRemoteConnection } from './server-test-fixtures';
import type { ProfileRun, RunProfileCatalog } from '@workspace/core/run-profiles';

const resources: Array<{ server: AppBackendServer; root?: string }> = [];
afterEach(async () => { for (const item of resources.splice(0)) { await item.server.close(); if (item.root) await rm(item.root, { recursive: true, force: true }); } });
const request = (server: AppBackendServer, method: string, params: object) => server.handleMessage({ jsonrpc: '2.0', id: 1, method, params });

async function local(options: Pick<AppBackendServerOptions, 'agentGitService'> = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'korus-profile-boundary-')));
  const snapshot = createTestSnapshot();
  const agent = { ...createRemoteAgent(), id: 'one', teamId: snapshot.teams[0].id, folder: root, backendSession: undefined };
  snapshot.agents = [agent]; snapshot.teams[0].agentIds = [agent.id];
  snapshot.teams.push({ id: 'other', name: 'Other', agentIds: [] });
  const runProfiles = new RunProfileService(path.join(root, 'home', 'profiles.json'));
  const server = new AppBackendServer({ version: 'test', snapshot, runProfiles, ...options });
  resources.push({ server, root });
  const saved = await request(server, 'agent/runProfile/save', { agentId: 'one', input: { name: 'Wait', command: 'node -e "setInterval(()=>{},1000)"', directory: '.' } });
  const catalog = (saved as { result: RunProfileCatalog }).result;
  const start = async () => {
    const p = catalog.profiles[0];
    const result = await request(server, 'agent/runProfile/start', { agentId: 'one', input: { profileId: p.id, command: p.command, cwd: root } });
    return (result as { result: ProfileRun }).result;
  };
  return { root, server, runProfiles, start };
}

describe('run profile app-owned boundary', () => {
  it('reads import candidates through the owning agent boundary without saving or starting them', async () => {
    const f = await local();
    await writeFile(path.join(f.root, 'package.json'), JSON.stringify({ scripts: { test: 'echo test' } }));
    expect(await request(f.server, 'agent/runProfileActions/get', { agentId: 'one', directory: '.' })).toMatchObject({ result: { actions: [{ name: 'test', command: 'npm run test', directory: '.', source: 'package.json' }], warnings: [] } });
    expect((await f.runProfiles.get('one', f.root)).runs).toStrictEqual([]);
  });
  it.each(['agent/delete', 'team/delete', 'team/disconnect', 'shutdown'])('stops owned commands when removing their owner via %s', async method => {
    const f = await local();
    const run = await f.start();
    if (method === 'shutdown') await f.server.close();
    else await request(f.server, method, method === 'agent/delete' ? { agentId: 'one' } : { teamId: 'team-test' });
    expect(await f.runProfiles.stop('one', run.id)).toMatchObject({ state: 'stopped' });
    if (method === 'agent/delete') await expect(f.runProfiles.start('one', f.root, { profileId: run.profileId, command: run.command, cwd: run.cwd })).rejects.toThrow(/removed/);
  });

  it('stops commands before worktree deletion and permits new runs after failed cleanup restores the agent', async () => {
    const deleteLinkedWorktree = vi.fn();
    const f = await local({ agentGitService: { validateLinkedWorktreeDeletion: vi.fn(), deleteLinkedWorktree } as unknown as AppBackendServerOptions['agentGitService'] });
    const run = await f.start();
    deleteLinkedWorktree.mockImplementation(async () => {
      expect((await f.runProfiles.get('one', f.root)).runs[0]).toMatchObject({ id: run.id, state: 'stopped' });
      expect(await request(f.server, 'snapshot/get', {})).toMatchObject({ result: { snapshot: { agents: [] } } });
      throw new Error('Worktree is locked');
    });

    await expect(request(f.server, 'agent/delete', { agentId: 'one', input: { deleteWorktree: true, confirmed: true } })).rejects.toThrow('Worktree is locked');
    expect(await request(f.server, 'snapshot/get', {})).toMatchObject({ result: { snapshot: { agents: [{ id: 'one', folder: f.root }] } } });
    expect(await f.start()).toMatchObject({ agentId: 'one', profileId: run.profileId, state: 'running' });
  });

  it('routes catalog/start/output/stop to the owning remote daemon, without local execution', async () => {
    const snapshot = createTestSnapshot();
    const connection = readyRemoteConnection();
    snapshot.remoteConnections.connections = [connection];
    snapshot.teams = [{ id: 'pointer', name: 'Remote', remoteConnectionId: connection.id, remoteTeamId: 'team-remote', agentIds: [] }];
    const remote = createRemoteTeamSnapshot([createRemoteAgent()]);
    const response = { repository: '/remote/repo', worktree: '/remote/worktree', profiles: [], targets: {}, runs: [] };
    const remoteClients = { request: vi.fn(async (_connection, method: string) => method === 'snapshot/get' ? { snapshot: remote, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } } : response), close: vi.fn() };
    const runProfiles = { get: vi.fn(), discover: vi.fn(), start: vi.fn(), stop: vi.fn(), retainAgents: vi.fn(), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: remoteClients as never, runProfiles: runProfiles as never });
    resources.push({ server });
    for (const [method, extra] of [['agent/runProfiles/get', {}], ['agent/runProfileActions/get', { directory: 'app' }], ['agent/runProfile/start', { input: { profileId: 'profile', command: 'npm run dev', cwd: '/remote/worktree' } }], ['agent/profileRun/stop', { runId: 'run' }]] as const) {
      expect(await request(server, method, { agentId: 'agent-remote', ...extra })).toMatchObject({ result: response });
      expect(remoteClients.request).toHaveBeenLastCalledWith(connection, method, { agentId: 'agent-remote', ...extra, _clientId: 'remote-controller' }, expect.any(Function));
    }
    await request(server, 'team/disconnect', { teamId: 'pointer' });
    expect(remoteClients.request).toHaveBeenCalledWith(connection, 'agent/profileRuns/stop', { agentId: 'agent-remote', _clientId: 'remote-controller' }, expect.any(Function));
    expect(runProfiles.get).not.toHaveBeenCalled(); expect(runProfiles.start).not.toHaveBeenCalled(); expect(runProfiles.stop).not.toHaveBeenCalled();
    expect(runProfiles.discover).not.toHaveBeenCalled();
  });
});
