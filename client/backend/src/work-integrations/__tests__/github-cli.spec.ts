import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { isAppSnapshot } from '@workspace/core/snapshot-guards';
import { GitHubWorkProviderDriver } from '../github-driver';
import { GitHubCliWorkProviderDriver } from '../github-cli-driver';
import { WorkIntegrationManager } from '../manager';
import { MemoryWorkIntegrationTokenStore } from '../memory-token-store';
import { HostedMcpGateway } from '../../mcp/hosted-mcp-gateway';
import { AppStateStore } from '../../persistence/store';

const host = vi.hoisted(() => ({ executable: '' }));
vi.mock('@workspace/core/runtime-discovery', async original => ({
  ...await original<typeof import('@workspace/core/runtime-discovery')>(),
  resolveRuntimeLaunch: (_command: string, env: NodeJS.ProcessEnv) => ({ command: host.executable, env: { ...process.env, ...env } }),
}));

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'korus-gh-'));
  host.executable = path.join(root, 'gh');
  // Scripted external process: exercise real command framing, stdin and errors.
  await writeFile(host.executable, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({ args, input, debug: process.env.GH_DEBUG ?? null }) + '\\n');
  if (state.fail) { process.stderr.write('private CLI diagnostic: secret'); process.exit(1); }
  if (args[0] === 'auth') {
    console.log(JSON.stringify({ hosts: { 'github.com': [{ host: 'github.com', active: true, login: state.login, state: state.authState ?? 'success' }] } }));
    return;
  }
  const endpoint = args[1];
  const value = endpoint === '/user' ? { login: state.login }
    : endpoint === '/repos/org/repo' ? { default_branch: 'main' }
    : endpoint.includes('/branches') ? [{ name: endpoint.includes('page=2') ? 'main' : 'feature' }]
    : endpoint.includes('/pulls') ? { number: 7, title: 'A change', html_url: 'https://github.com/org/repo/pull/7', head: { sha: 'abc' }, draft: true }
    : endpoint.startsWith('/user/repos') ? [{ full_name: 'org/repo', html_url: 'https://github.com/org/repo', private: true }]
    : [];
  process.stdout.write('HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n');
  if (endpoint.includes('/branches') && !endpoint.includes('page=2')) process.stdout.write('Link: <https://api.github.com/repos/org/repo/branches?per_page=100&page=2>; rel="next"\\r\\n');
  process.stdout.write('\\r\\n' + JSON.stringify(value));
});
`);
  await chmod(host.executable, 0o700);
  await writeFile(path.join(root, 'state.json'), JSON.stringify({ login: 'alice' }));
  vi.stubEnv('GH_DEBUG', 'api');
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

function fixture() {
  const snapshot = createInitialSnapshot();
  const tokenStore = new MemoryWorkIntegrationTokenStore();
  const persistence = new AppStateStore(path.join(root, 'app'));
  const saved = vi.fn(async () => { expect(isAppSnapshot(snapshot)).toBe(true); await persistence.save(snapshot); });
  const manager = new WorkIntegrationManager({
    drivers: [new GitHubWorkProviderDriver('')], githubCli: new GitHubCliWorkProviderDriver(),
    getSnapshot: () => snapshot, saveSnapshot: saved, tokenStore,
  });
  return { snapshot, tokenStore, manager };
}

it('automatically uses authenticated gh for repositories, branch pages and PR writes without storing tokens or enabling hosted MCP', async () => {
  const { snapshot, tokenStore, manager } = fixture();
  const setToken = vi.spyOn(tokenStore, 'set');
  await manager.hydrateConnections();
  expect(snapshot.workBacklog.connections).toStrictEqual([expect.objectContaining({ provider: 'github', status: 'connected', source: 'cli', accountLabel: 'alice' })]);
  expect(await manager.githubConnected()).toBe(true);
  expect(await manager.listSources('github')).toStrictEqual([{ provider: 'github', id: 'org/repo', owner: 'org', name: 'repo', fullName: 'org/repo', url: 'https://github.com/org/repo', isPrivate: true }]);
  expect(await manager.listBranches('github', 'org/repo')).toStrictEqual([{ name: 'main', isDefault: true }, { name: 'feature', isDefault: false }]);
  expect(await manager.createPullRequest('org/repo', { branch: 'feature', title: 'Title $(literal)', body: 'Line one\nLine two' })).toMatchObject({ number: 7, draft: true });
  expect(setToken).not.toHaveBeenCalled();
  expect(await tokenStore.get('github')).toBeNull();
  expect(new HostedMcpGateway({ credentials: manager }).enabledServerUrls('http://127.0.0.1/mcp?agentId=test')).toStrictEqual({});
  await expect(manager.authorizationHeader('github')).rejects.toThrow('not connected');
  expect(snapshot.workBacklog.connections[0]?.status).toBe('connected');
  const calls = (await readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(calls.every(call => call.debug === null && !call.args.includes('--show-token') && !call.args.includes('token'))).toBe(true);
  const write = calls.find(call => call.args.includes('POST'));
  expect(JSON.parse(write.input)).toStrictEqual({ title: 'Title $(literal)', body: 'Line one\nLine two', head: 'feature', base: 'main', draft: true });
  manager.close();
});

it('redetects authenticated gh after reloading a saved disconnected CLI state', async () => {
  const { snapshot, manager } = fixture();
  snapshot.workBacklog.connections = [{ provider: 'github', source: 'none', status: 'disconnected' }];
  await manager.hydrateConnections();
  expect(snapshot.workBacklog.connections[0]).toMatchObject({ source: 'cli', status: 'connected' });
  manager.close();
});

it.each(['cancel', 'disconnect'] as const)('falls back to authenticated gh after direct GitHub %s and across reloads', async action => {
  const { tokenStore, manager } = fixture();
  vi.spyOn(GitHubWorkProviderDriver.prototype, 'configured').mockReturnValue(true);
  vi.spyOn(GitHubWorkProviderDriver.prototype, 'startAuthorization').mockResolvedValue({
    provider: 'github', deviceCode: 'device', userCode: 'ABCD', verificationUri: 'https://github.com/login/device',
    expiresAt: '2026-12-01', intervalSeconds: 5,
  });
  await manager.hydrateConnections();
  const authorization = await manager.connect('github');
  expect(authorization.authorization?.userCode).toBe('ABCD');
  if (action === 'disconnect') {
    await tokenStore.set({ provider: 'github', accessToken: 'test-api-token', tokenType: 'bearer', connectedAt: 'now' });
    await manager.hydrateConnections();
    expect(manager.isHostedMcpConnected('github')).toBe(true);
  }
  let finishDelete!: () => void;
  const removeToken = tokenStore.delete.bind(tokenStore);
  vi.spyOn(tokenStore, 'delete').mockImplementationOnce(async provider => {
    await new Promise<void>(resolve => { finishDelete = resolve; });
    await removeToken(provider);
  });
  const disconnecting = manager.disconnect('github');
  await vi.waitFor(() => expect(finishDelete).toBeTypeOf('function'));
  try {
    await manager.hydrateConnections();
    expect(await manager.githubConnected()).toBe(false);
  } finally { finishDelete(); await disconnecting; }
  expect(await manager.githubConnected()).toBe(true);
  expect(manager.isHostedMcpConnected('github')).toBe(false);
  const reloaded = await new AppStateStore(path.join(root, 'app')).load();
  const restarted = new WorkIntegrationManager({ drivers: [new GitHubWorkProviderDriver('')], githubCli: new GitHubCliWorkProviderDriver(),
    getSnapshot: () => reloaded, saveSnapshot: async () => {}, tokenStore });
  await restarted.hydrateConnections();
  await restarted.hydrateConnections();
  expect(reloaded.workBacklog.connections[0]).toMatchObject({ source: 'cli', status: 'connected' });
  expect(await restarted.githubConnected()).toBe(true);
  expect(await tokenStore.get('github')).toBeNull();
  manager.close(); restarted.close();
});

it.each(['error', 'timeout', 'missing'] as const)('does not treat gh %s as an authenticated connection', async state => {
  if (state === 'missing') host.executable = path.join(root, 'missing-gh');
  else await writeFile(path.join(root, 'state.json'), JSON.stringify({ login: 'alice', authState: state }));
  const { snapshot, manager } = fixture();
  await manager.hydrateConnections();
  expect(snapshot.workBacklog.connections[0]?.status).not.toBe('connected');
  expect(await manager.githubConnected()).toBe(false);
  manager.close();
});

it('preserves a saved API account and refuses CLI fallback after that API login expires', async () => {
  const { snapshot, tokenStore, manager } = fixture();
  await tokenStore.set({ provider: 'github', accessToken: 'api-secret', tokenType: 'bearer', accountLabel: 'bob', connectedAt: 'now' });
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
  await manager.hydrateConnections();
  await manager.listAssignedItems('github');
  expect(fetch).toHaveBeenCalledWith('https://api.github.com/issues?filter=assigned&state=open&per_page=100', expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'bearer api-secret' }),
  }));
  expect(snapshot.workBacklog.connections[0]?.accountLabel).toBe('bob');
  await tokenStore.set({ provider: 'github', accessToken: 'expired', tokenType: 'bearer', expiresAt: '2000-01-01', connectedAt: 'now' });
  await manager.hydrateConnections();
  await manager.hydrateConnections();
  expect(await manager.githubConnected()).toBe(false);
  await expect(readFile(path.join(root, 'calls.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
  manager.close();
});

it('refuses an externally switched CLI account and keeps process diagnostics out of application errors', async () => {
  const { manager } = fixture();
  await manager.hydrateConnections();
  await writeFile(path.join(root, 'state.json'), JSON.stringify({ login: 'mallory' }));
  await expect(manager.createPullRequest('org/repo', { branch: 'feature', title: 'Change', body: '' })).rejects.toThrow('authentication changed');
  await writeFile(path.join(root, 'state.json'), JSON.stringify({ login: 'alice', fail: true }));
  await expect(manager.listSources('github')).rejects.toThrow('authentication changed');
  expect((await readFile(path.join(root, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)).every(call => call.args[0] === 'auth')).toBe(true);
  manager.close();
});
