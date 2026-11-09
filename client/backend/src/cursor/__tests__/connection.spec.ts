import { mkdir, mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { ProviderSetup } from '../../provider-setup';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import { BackendDriverRpc, createBackendDriver } from '../../driver-rpc';
import { ProviderUpdateRuntime } from '../../provider-update-runtime';
import { createProviderLifecycles } from '../../provider-lifecycle';

let root: string;
let driver: AgentBackendDriver | undefined;
const build = '2026.10.22-27dcf5f';
const fixture = { isAuthenticated: true, userInfo: { email: 'fixture@example.test', teamName: 'Fixture team', userId: 321, teamId: 456 }, authInfo: { accessToken: 'synthetic-must-not-escape' } };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cursor-connection-'));
  vi.stubEnv('HOME', root);
  vi.stubEnv('APP_HOME', path.join(root, 'app'));
  vi.stubEnv('KORUS_HOME', undefined);
  vi.stubEnv('PATH', root);
  vi.stubEnv('SHELL', path.join(root, 'no-shell'));
  vi.stubEnv('CURSOR_API_KEY', 'synthetic-api-key');
  vi.stubEnv('CURSOR_AUTH_TOKEN', 'synthetic-auth-token');
  vi.stubEnv('CURSOR_CONFIG_DIR', '/wrong-cursor-home');
  await state();
  await writeFile(path.join(root, 'version'), build);
  await writeFile(path.join(root, 'agent'), `#!${process.execPath}
const fs=require('node:fs');
const root=${JSON.stringify(root)};
const args=process.argv.slice(2);
const isolated=process.env.AGENT_CLI_CREDENTIAL_STORE==='file';
const statusFile=isolated?process.env.CURSOR_CONFIG_DIR+'/fixture-status':root+'/status';
fs.appendFileSync(root+'/calls',JSON.stringify({args,browser:process.env.NO_OPEN_BROWSER,home:process.env.CURSOR_CONFIG_DIR,apiKey:Boolean(process.env.CURSOR_API_KEY),authToken:Boolean(process.env.CURSOR_AUTH_TOKEN),...(isolated?{childHome:process.env.HOME,store:process.env.AGENT_CLI_CREDENTIAL_STORE}:{})})+'\\n');
if(args[0]==='--version')console.log(fs.readFileSync(root+'/version','utf8'));
else if(args[0]==='status'){
 if(fs.existsSync(root+'/hang-status'))setInterval(()=>{},1000);
 else console.log(fs.existsSync(statusFile)?fs.readFileSync(statusFile,'utf8'):JSON.stringify({isAuthenticated:false}));
}
else if(args[0]==='login'){
 if(process.env.NO_OPEN_BROWSER==='1')process.exit(99);
 if(fs.existsSync(root+'/hang')){process.stdin.resume();setInterval(()=>{},1000);}
 else {fs.rmSync(root+'/hang-status',{force:true});fs.writeFileSync(statusFile,JSON.stringify({isAuthenticated:true}));}
}
else if(args[0]==='about')console.log(JSON.stringify({cliVersion:'2026.10.22-27dcf5f',latestStatus:'up_to_date',latestVersion:'2026.10.22-27dcf5f'}));
else if(args[0]==='update')console.log('updated');
else if(args[0]==='logout')fs.writeFileSync(statusFile,JSON.stringify({isAuthenticated:false}));
else process.exit(98);
`, { mode: 0o700 });
});
afterEach(async () => { await driver?.close(); driver = undefined; vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
async function state(value: unknown = fixture) { await writeFile(path.join(root, 'status'), JSON.stringify(value)); }
async function calls() { return (await readFile(path.join(root, 'calls'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
function connection() { return driver = createBackendDriver('cursor'); }

describe('Cursor CLI connection boundary', () => {
  it('counts an in-flight native login as busy so upgrades cannot stop it', async () => {
    await writeFile(path.join(root, 'hang'), '');
    const current = connection();
    const rpc = new BackendDriverRpc(new Map([['cursor', current]]));
    const login = rpc.handle('driver/provider/authentication', { backend: 'cursor', action: 'login' }).catch(error => error);
    try {
      await vi.waitFor(async () => expect((await calls()).some(call => call.args[0] === 'login')).toBe(true));
      expect(rpc.isBusy('cursor')).toBe(true);
    } finally { await rpc.close(); await login; }
  });

  it('keeps native update inspection and execution free of ambient API credentials after PATH discovery', async () => {
    const runtime = new ProviderUpdateRuntime({ command: backend => backend, claudeHome: () => '/unused' });
    const installation = await runtime.inspect('cursor');
    await runtime.upgrade(installation);
    expect((await calls()).map(call => ({ args: call.args, apiKey: call.apiKey, authToken: call.authToken, browser: call.browser }))).toStrictEqual([
      { args: ['about', '--format', 'json'], apiKey: false, authToken: false, browser: '1' },
      { args: ['update'], apiKey: false, authToken: false, browser: '1' },
    ]);
  });

  it('inspects the selected private home and refuses an updater that would install a second CLI there', async () => {
    const lifecycle = createProviderLifecycles().get('cursor')!;
    let selected = { homePath: path.join(root, 'saved-private', '.cursor'), isolated: true, shareSkills: false };
    const runtime = new ProviderUpdateRuntime({ command: backend => backend, claudeHome: () => '/unused', cursorHome: () => selected });
    const installation = await runtime.inspect('cursor');
    expect(installation.command).toBeUndefined();
    await expect(runtime.upgrade(installation)).rejects.toThrow('Manual');
    expect((await calls()).map(call => ({ args: call.args, home: call.home, store: call.store }))).toStrictEqual([
      { args: ['about', '--format', 'json'], home: selected.homePath, store: 'file' },
    ]);
    selected = lifecycle.home(createEmptySnapshot());
    const existing = await runtime.inspect('cursor');
    expect(existing.identity).not.toBe(installation.identity);
    expect(existing.command).toBeDefined();
    // A stale existing-home installation cannot bypass the separate-home updater gate.
    selected = { homePath: path.join(root, 'saved-private', '.cursor'), isolated: true, shareSkills: false };
    await expect(runtime.upgrade(existing)).rejects.toThrow('Manual');
    expect((await calls()).some(call => call.args[0] === 'update')).toBe(false);
  });

  it('detects agent and the cursor-agent alias without offering a separate home', async () => {
    const lifecycle = createProviderLifecycles().get('cursor')!;
    const snapshot = createEmptySnapshot();
    expect(lifecycle.installed(snapshot)).toBe(true);
    await rename(path.join(root, 'agent'), path.join(root, 'cursor-agent'));
    expect(lifecycle.installed(snapshot)).toBe(true);
    const home = lifecycle.home(snapshot);
    expect(home).toStrictEqual({ homePath: path.join(root, '.cursor'), isolated: false, shareSkills: false });
    await expect(lifecycle.prepareHome(home, false)).resolves.toBeUndefined();
    expect(() => lifecycle.home(snapshot, { isolated: true, shareSkills: false })).toThrow('separate');
    expect(lifecycle.install).toBeUndefined();
  });

  it('preserves a saved private account without silently switching to the existing login', async () => {
    const snapshot = createEmptySnapshot();
    const lifecycle = createProviderLifecycles().get('cursor')!;
    const home = { homePath: path.join(root, 'saved-private', '.cursor'), isolated: true, shareSkills: false };
    await mkdir(home.homePath, { recursive: true });
    await lifecycle.prepareHome(home, false);
    snapshot.general.providerHomes = { cursor: home };
    const current = driver = createBackendDriver('cursor', { generalSettings: snapshot.general });
    expect(await current.authenticate!({ action: 'check' })).toMatchObject({ connected: false, state: { homePath: home.homePath } });
    expect(await current.authenticate!({ action: 'login' })).toMatchObject({ connected: true });
    // Later settings edits cannot redirect an already constructed host.
    snapshot.general.providerHomes.cursor = { homePath: '/wrong-home', isolated: false, shareSkills: false };
    expect(await current.authenticate!({ action: 'logout' })).toMatchObject({ connected: false });
    expect(JSON.parse(await readFile(path.join(root, 'status'), 'utf8'))).toStrictEqual(fixture);
    expect((await calls()).every(call => call.childHome === path.dirname(home.homePath) && call.store === 'file' && call.home === home.homePath)).toBe(true);
  });

  it('rejects new isolated setup at admission and preserves saved settings and credential files', async () => {
    const snapshot = createEmptySnapshot();
    const home = { homePath: path.join(root, 'saved-private', '.cursor'), isolated: true, shareSkills: false };
    await mkdir(home.homePath, { recursive: true });
    const credential = path.join(home.homePath, 'auth.json');
    await writeFile(credential, 'synthetic-retained-credential');
    snapshot.general.providerHomes = { cursor: home };
    const persist = vi.fn(async () => {}), reconnect = vi.fn(async () => {});
    const setup = new ProviderSetup(snapshot, persist, reconnect, new Map([['cursor', createProviderLifecycles().get('cursor')!]]));
    await setup.initialize();
    persist.mockClear();
    await expect(setup.configure('cursor', { isolated: true, shareSkills: false })).rejects.toThrow('separate');
    expect(snapshot.general.providerHomes.cursor).toStrictEqual(home);
    expect(await readFile(credential, 'utf8')).toBe('synthetic-retained-credential');
    expect(persist).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('checks native status without login, API credentials, account IDs or enablement side effects', async () => {
    const events: BackendEvent[] = [];
    const current = connection();
    current.onEvent(event => events.push(event));
    const result = await current.authenticate!({ action: 'check' });
    expect(result).toStrictEqual({ kind: 'cursor', connected: true, state: {
      loggedIn: true, homePath: path.join(root, '.cursor'), version: build, supported: true,
      account: { type: 'subscription', email: 'fixture@example.test' }, team: 'Fixture team',
    } });
    expect(await calls()).toStrictEqual([
      { args: ['--version'], browser: '1', home: path.join(root, '.cursor'), apiKey: false, authToken: false },
      { args: ['status', '--format', 'json'], browser: '1', home: path.join(root, '.cursor'), apiKey: false, authToken: false },
    ]);
    expect(events).toStrictEqual([{ type: 'provider.authenticationChanged', backend: 'cursor', payload: result }]);
  });

  it('refreshes team changes and clears expired account metadata before detecting an external login', async () => {
    const current = connection();
    expect(await current.authenticate!({ action: 'check' })).toMatchObject({ state: { team: 'Fixture team' } });
    await state({ ...fixture, userInfo: { email: 'switched@example.test', teamName: 'Other team' } });
    expect(await current.authenticate!({ action: 'check' })).toMatchObject({ state: { account: { email: 'switched@example.test' }, team: 'Other team' } });
    await state({ ...fixture, isAuthenticated: false });
    expect(await current.authenticate!({ action: 'check' })).toStrictEqual({ kind: 'cursor', connected: false, state: { loggedIn: false, homePath: path.join(root, '.cursor'), version: build, supported: true } });
    await state();
    expect(await current.authenticate!({ action: 'check' })).toMatchObject({ connected: true });
    expect(await current.authenticate!({ action: 'logout' })).toMatchObject({ connected: false, state: { loggedIn: false } });
    expect((await calls()).some(call => call.args[0] === 'login')).toBe(false);
  });

  it('keeps old builds detected but disconnected with an explicit update hint', async () => {
    await writeFile(path.join(root, 'version'), '2026.10.07-old');
    expect(createProviderLifecycles().get('cursor')!.installed(createEmptySnapshot())).toBe(true);
    expect(await connection().authenticate!({ action: 'check' })).toMatchObject({
      connected: false, state: { supported: false, version: '2026.10.07-old', error: expect.stringMatching(/2026\.10\.08.*update|update.*2026\.10\.08/i) },
    });
    expect((await calls()).map(call => call.args)).toStrictEqual([['--version']]);
  });

  it('cancels an explicit browser login, emits no late connected state and retries', async () => {
    await state({ isAuthenticated: false });
    await writeFile(path.join(root, 'hang'), '');
    const current = connection();
    const events: BackendEvent[] = [];
    current.onEvent(event => events.push(event));
    const login = current.authenticate!({ action: 'login' }).catch(error => error);
    await vi.waitFor(async () => expect((await calls()).some(call => call.args[0] === 'login')).toBe(true));
    await current.authenticate!({ action: 'cancel' });
    expect(await login).toBeInstanceOf(Error);
    expect(events).not.toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ connected: true }) }));
    await rm(path.join(root, 'hang'));
    expect(await current.authenticate!({ action: 'login' })).toMatchObject({ connected: true });
  });

  it('supersedes a slow status check with login without publishing its stale result', async () => {
    await state({ isAuthenticated: false });
    await writeFile(path.join(root, 'hang-status'), '');
    const current = connection();
    const events: BackendEvent[] = [];
    current.onEvent(event => events.push(event));
    const check = current.authenticate!({ action: 'check' }).catch(error => error);
    await vi.waitFor(async () => expect((await calls()).some(call => call.args[0] === 'status')).toBe(true));
    expect(await current.authenticate!({ action: 'login' })).toMatchObject({ connected: true });
    expect(await check).toBeInstanceOf(Error);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'provider.authenticationChanged', payload: { connected: true } });
  });

  it('rechecks retained credentials after cancelling a redundant login', async () => {
    const current = connection();
    expect((await current.authenticate!({ action: 'check' })).connected).toBe(true);
    await writeFile(path.join(root, 'hang'), '');
    const login = current.authenticate!({ action: 'login' }).catch(error => error);
    await vi.waitFor(async () => expect((await calls()).some(call => call.args[0] === 'login')).toBe(true));
    expect(await current.authenticate!({ action: 'cancel' })).toMatchObject({ connected: true });
    expect(await login).toBeInstanceOf(Error);
  });

  it('rejects malformed native status without exposing its output', async () => {
    await writeFile(path.join(root, 'status'), 'https://example.invalid/private-diagnostic');
    await expect(connection().authenticate!({ action: 'check' })).rejects.toThrow('Could not check Cursor authentication');
  });
});
