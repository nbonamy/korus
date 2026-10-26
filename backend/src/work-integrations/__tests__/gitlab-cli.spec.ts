import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { decodeAppSnapshot } from '@workspace/core/snapshot-guards';
import { GitHubCliWorkProviderDriver } from '../github-cli-driver';
import { GitHubWorkProviderDriver } from '../github-driver';
import { GitLabWorkProviderDriver } from '../gitlab-driver';
import { GitLabCliWorkProviderDriver } from '../gitlab-cli-driver';
import { WorkIntegrationManager } from '../manager';
import { MemoryWorkIntegrationTokenStore } from '../memory-token-store';

// Process-boundary failure modes: wrong host/account, token extraction, lost pages,
// stdin corruption, credential precedence/fallback, missing/expired CLI and leaked diagnostics.
const host = vi.hoisted(() => ({ executable: '' }));
vi.mock('@workspace/core/runtime-discovery', async original => ({
  ...await original<typeof import('@workspace/core/runtime-discovery')>(),
  resolveRuntimeLaunch: (_command: string, env: NodeJS.ProcessEnv) => ({ command: host.executable, env: { ...process.env, ...env } }),
}));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'korus-glab-'));
  host.executable = path.join(root, 'glab');
  await writeFile(host.executable, `#!${process.execPath}
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(__dirname + '/state.json', 'utf8'));
const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  fs.appendFileSync(__dirname + '/calls.jsonl', JSON.stringify({ args, input, debug: process.env.GLAB_DEBUG_HTTP ?? null, apiHost: process.env.GITLAB_API_HOST, protocol: process.env.GLAB_API_PROTOCOL, autoLogin: process.env.GLAB_ENABLE_CI_AUTOLOGIN }) + '\\n');
  if (state.hang) { setTimeout(() => {}, 60000); return; }
  if (state.fail) { process.stderr.write('secret-process-diagnostic'); process.exit(1); }
  if (args[0] === 'auth') { console.log(JSON.stringify({ hosts: { 'github.com': [{ host: 'github.com', active: true, login: 'gh-alice', state: 'success' }] } })); return; }
  const endpoint = args[1];
  if (state.malformed) { console.log('invalid'); return; }
  const status = endpoint === 'user' ? 200 : state.status || 200;
  const second = endpoint.includes('page=2');
  const value = endpoint === 'user' ? { username: state.login }
    : (endpoint.includes('/issues?') || endpoint.includes('/merge_requests?')) ? [{ id: second ? 2 : 1, iid: second ? 8 : 7, title: 'Work', state: 'opened', description: 'CLI body', labels: ['bug'], assignees: [{ username: state.login }], source_branch: 'topic', created_at: '2026-01-01', updated_at: '2026-02-01', web_url: 'https://gitlab.com/group/subgroup/repo/-/' + (endpoint.includes('/issues?') ? 'issues/' : 'merge_requests/') + (second ? 8 : 7) }]
    : endpoint.includes('/branches') ? [{ name: second ? 'main' : 'topic', default: second }]
    : endpoint.startsWith('projects?') ? [{ path: 'repo', path_with_namespace: (second ? 'other/nested' : 'group/subgroup') + '/repo', web_url: 'https://gitlab.com/' + (second ? 'other/nested' : 'group/subgroup') + '/repo', visibility: 'private' }]
    : status === 204 ? null : { accepted: JSON.parse(input || '{}') };
  process.stdout.write('HTTP/2.0 ' + status + ' OK\\r\\nContent-Type: application/json\\r\\nX-Next-Page: ' + (second ? '' : '2') + '\\r\\n\\r\\n' + (value === null ? '' : JSON.stringify(value)));
  if (status >= 400) { process.stderr.write('secret-process-diagnostic'); process.exitCode = 1; }
});
`);
  await chmod(host.executable, 0o700);
  await state({ login: 'alice' });
  vi.stubEnv('GLAB_DEBUG_HTTP', '1');
  vi.stubEnv('GITLAB_API_HOST', 'other.example');
  vi.stubEnv('GLAB_API_PROTOCOL', 'http');
  vi.stubEnv('GLAB_ENABLE_CI_AUTOLOGIN', 'true');
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const state = (value: object) => writeFile(path.join(root, 'state.json'), JSON.stringify(value));
async function calls() { return (await readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); }
function fixture() {
  const snapshot = createInitialSnapshot();
  const tokenStore = new MemoryWorkIntegrationTokenStore();
  const driver = new GitLabWorkProviderDriver('client');
  const cli = new GitLabCliWorkProviderDriver();
  const options = { drivers: [new GitHubWorkProviderDriver(''), driver], gitlabCli: cli, getSnapshot: () => snapshot, saveSnapshot: async () => {}, tokenStore };
  const manager = new WorkIntegrationManager(options);
  return { snapshot, tokenStore, driver, cli, options, manager };
}
it('uses CLI-only private subgroup catalogs and branch pages, restores metadata and never exposes CLI tokens or hosted MCP', async () => {
  const { snapshot, manager, tokenStore, options } = fixture();
  await tokenStore.set({ provider: 'github', accessToken: 'github-secret', tokenType: 'Bearer', accountLabel: 'github-user', connectedAt: 'then' });
  await manager.hydrateConnections();
  expect(snapshot.workBacklog.connections).toContainEqual({ provider: 'gitlab', source: 'cli', status: 'connected', accountLabel: 'alice', connectedAt: expect.any(String) });
  expect((await manager.listSources('gitlab')).map(source => [source.id, source.isPrivate])).toStrictEqual([['gitlab.com/group/subgroup/repo', true], ['gitlab.com/other/nested/repo', true]]);
  expect(await manager.listBranches('gitlab', 'gitlab.com/group/subgroup/repo')).toStrictEqual([{ name: 'main', isDefault: true }, { name: 'topic', isDefault: false }]);
  expect(manager.isHostedMcpConnected('gitlab')).toBe(false);
  await expect(manager.authorizationHeader('gitlab')).rejects.toThrow('not connected');
  expect(await tokenStore.get('gitlab')).toBeNull();
  expect(decodeAppSnapshot(JSON.parse(JSON.stringify(snapshot)))?.value).toStrictEqual(snapshot);
  const restarted = new WorkIntegrationManager(options);
  await restarted.hydrateConnections();
  expect(await restarted.listSources('gitlab')).toHaveLength(2);
  expect(await manager.authorizationHeader('github')).toBe('Bearer github-secret');
  expect((await calls()).every(call => call.args[0] === 'api' && call.args.includes('--hostname') && call.args.includes('gitlab.com') && call.debug === 'false' && call.apiHost === 'gitlab.com' && call.protocol === 'https' && call.autoLogin === 'false')).toBe(true);
  manager.close(); restarted.close();
});
it.each(['cancel', 'denied', 'expired', 'start failure', 'missing configuration', 'disconnect'] as const)('keeps glab available after direct %s without affecting GitHub', async action => {
  const { manager, driver, snapshot, tokenStore } = fixture();
  await manager.hydrateConnections();
  vi.spyOn(driver, 'startAuthorization').mockImplementation(async () => {
    if (action === 'start failure') throw new Error('Unavailable');
    return { provider: 'gitlab', deviceCode: 'device', userCode: 'CODE', verificationUri: 'https://gitlab.com/oauth/device', expiresAt: new Date(Date.now() + (action === 'expired' ? -1000 : 300000)).toISOString(), intervalSeconds: 1 };
  });
  vi.spyOn(driver, 'pollAuthorization').mockResolvedValue({ status: 'error', code: 'access_denied', message: 'denied' });
  if (action === 'missing configuration') vi.spyOn(driver, 'configured').mockReturnValue(false);
  await manager.connect('gitlab');
  // A pending direct login must preserve usable CLI catalog access.
  if (action === 'cancel') expect(await manager.listSources('gitlab')).toHaveLength(2);
  if (action === 'denied' || action === 'expired') await manager.pollAuthorization('gitlab');
  if (action === 'disconnect') {
    await tokenStore.set({ provider: 'gitlab', accessToken: 'direct-secret', tokenType: 'Bearer', accountLabel: 'bob', connectedAt: 'then' });
    await manager.hydrateConnections();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]));
    expect(await manager.listSources('gitlab')).toStrictEqual([]);
    expect(fetch).toHaveBeenCalled();
  }
  if (action === 'cancel' || action === 'disconnect') await manager.disconnect('gitlab');
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')).toMatchObject({ source: 'cli', status: 'connected', accountLabel: 'alice' });
  expect(await manager.listSources('gitlab')).toHaveLength(2);
  expect(await tokenStore.get('gitlab')).toBeNull();
  manager.close();
});
it('refuses changed CLI identity before catalog or writes, including hydration, and permits explicit reconnection', async () => {
  const { manager, snapshot } = fixture();
  await manager.hydrateConnections();
  await state({ login: 'mallory' });
  await expect(manager.listSources('gitlab')).rejects.toThrow('authentication changed');
  await manager.hydrateConnections();
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')).toMatchObject({ status: 'error', accountLabel: 'alice' });
  expect((await calls()).every(call => call.args[1] === 'user')).toBe(true);
  await manager.disconnect('gitlab');
  expect(await manager.listSources('gitlab')).toHaveLength(2);
  manager.close();
});
it.each(['missing', 'failed', 'malformed'] as const)('recovers from %s CLI discovery without propagating subprocess secrets', async failure => {
  const { manager, snapshot } = fixture();
  if (failure === 'missing') host.executable = path.join(root, 'missing');
  else await state({ login: 'alice', fail: failure === 'failed', malformed: failure === 'malformed' });
  await manager.hydrateConnections();
  expect(manager.isConnected('gitlab')).toBe(false);
  expect(JSON.stringify(snapshot)).not.toContain('secret-process');
  host.executable = path.join(root, 'glab'); await state({ login: 'alice' });
  await manager.hydrateConnections();
  expect(manager.isConnected('gitlab')).toBe(true);
  manager.close();
});
it.each([401, 403, 429, 500])('normalizes CLI HTTP %s without leaking raw process errors or a partial catalog', async status => {
  const { manager } = fixture();
  await manager.hydrateConnections(); await state({ login: 'alice', status });
  await expect(manager.listSources('gitlab')).rejects.toThrow(/GitLab/);
  await expect(manager.listSources('gitlab')).rejects.not.toThrow(/secret-process/);
  manager.close();
});
// A transport-level probe protects future issue/MR writes without adding those product capabilities.
class RequestProbe extends GitLabCliWorkProviderDriver { send(...args: Parameters<GitLabCliWorkProviderDriver['apiResponse']>) { return this.apiResponse(...args); } }
it('preserves literal JSON writes, methods, headers, no-content responses and cancellation at the CLI boundary', async () => {
  const cli = new RequestProbe();
  const credential = (await cli.detectConnection())!;
  const body = JSON.stringify({ title: 'Literal $(text)', description: 'line1\nline2', labels: ['a', 'b'] });
  const response = await cli.send(credential, 'https://gitlab.com/api/v4/projects/123/issues', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  expect(await response.json()).toStrictEqual({ accepted: JSON.parse(body) });
  expect((await calls()).at(-1)).toMatchObject({ args: expect.arrayContaining(['POST', '--input', '-', expect.stringMatching(/^content-type: application\/json$/i)]), input: body });
  await state({ login: 'alice', status: 204 });
  expect((await cli.send(credential, 'https://gitlab.com/api/v4/projects/123/issues/1', { method: 'DELETE' })).status).toBe(204);
  await expect(cli.send(credential, 'https://evil.test/api/v4/user')).rejects.toThrow('Invalid GitLab');
  await expect(cli.send(credential, 'https://gitlab.com/api/v4/projects', { signal: AbortSignal.abort() })).rejects.toThrow(/GitLab CLI/);
  await state({ login: 'mallory' });
  await expect(cli.send(credential, 'https://gitlab.com/api/v4/projects/123/issues', { method: 'POST', body })).rejects.toThrow('authentication changed');
});

it('bounds hung authentication discovery and permits retry', async () => {
  const { manager } = fixture();
  await state({ login: 'alice', hang: true });
  await manager.hydrateConnections();
  expect(manager.isConnected('gitlab')).toBe(false);
  await state({ login: 'alice' });
  await manager.hydrateConnections();
  expect(manager.isConnected('gitlab')).toBe(true);
  manager.close();
}, 15000);
it('does not replace a working CLI account when a login is canceled after an external switch', async () => {
  const { manager, driver, snapshot } = fixture();
  await manager.hydrateConnections();
  vi.spyOn(driver, 'startAuthorization').mockResolvedValue({ provider: 'gitlab', deviceCode: 'device', userCode: 'CODE', verificationUri: 'https://gitlab.com/oauth/device', expiresAt: new Date(Date.now() + 300000).toISOString(), intervalSeconds: 1 });
  await manager.connect('gitlab');
  await state({ login: 'mallory' });
  await manager.disconnect('gitlab');
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'gitlab')).toMatchObject({ source: 'cli', status: 'error', accountLabel: 'alice' });
  expect((await calls()).every(call => call.args[1] === 'user')).toBe(true);
  manager.close();
});

it('resolves gh and glab independently when both CLIs are authenticated', async () => {
  const { options, snapshot } = fixture();
  const manager = new WorkIntegrationManager({ ...options, githubCli: new GitHubCliWorkProviderDriver() });
  await manager.hydrateConnections();
  expect(snapshot.workBacklog.connections).toEqual(expect.arrayContaining([
    expect.objectContaining({ provider: 'github', source: 'cli', status: 'connected', accountLabel: 'gh-alice' }),
    expect.objectContaining({ provider: 'gitlab', source: 'cli', status: 'connected', accountLabel: 'alice' }),
  ]));
  await manager.disconnect('gitlab');
  expect(await manager.githubConnected()).toBe(true);
  expect(snapshot.workBacklog.connections.find(c => c.provider === 'github')?.accountLabel).toBe('gh-alice');
  expect(await manager.listSources('gitlab')).toHaveLength(2);
  manager.close();
});
it('restores the CLI fallback after a restart interrupts direct authorization', async () => {
  const { manager, driver, options, snapshot } = fixture();
  await manager.hydrateConnections();
  vi.spyOn(driver, 'startAuthorization').mockResolvedValue({ provider: 'gitlab', deviceCode: 'device', userCode: 'CODE', verificationUri: 'https://gitlab.com/oauth/device', expiresAt: new Date(Date.now() + 300000).toISOString(), intervalSeconds: 1 });
  await manager.connect('gitlab');
  const restored = JSON.parse(JSON.stringify(snapshot));
  manager.close();
  const restarted = new WorkIntegrationManager({ ...options, getSnapshot: () => restored });
  await restarted.hydrateConnections();
  expect(restored.workBacklog.connections.find((c: { provider: string }) => c.provider === 'gitlab')).toMatchObject({ source: 'cli', status: 'connected', accountLabel: 'alice' });
  expect(await restarted.listSources('gitlab')).toHaveLength(2);
  restarted.close();
});

it('uses the shared normalization for paginated GitLab CLI issue and MR reads', async () => {
  const { manager } = fixture();
  await manager.hydrateConnections();
  try {
    const items = await manager.listItems('gitlab', 'gitlab.com/group/subgroup/repo', { state: 'all' });
    expect(items.map(item => [item.identifier, item.kind, item.body, item.assignedToViewer])).toStrictEqual([
      ['#7', 'issue', 'CLI body', true], ['#8', 'issue', 'CLI body', true],
      ['!7', 'pullRequest', 'CLI body', true], ['!8', 'pullRequest', 'CLI body', true],
    ]);
    expect((await calls()).filter(call => call.args[1] !== 'user').every(call => call.args.includes('gitlab.com') && call.args.includes('GET'))).toBe(true);
  } finally { manager.close(); }
});
