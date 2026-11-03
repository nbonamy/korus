import { mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
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
fs.appendFileSync(root+'/calls',JSON.stringify({args,browser:process.env.NO_OPEN_BROWSER,home:process.env.CURSOR_CONFIG_DIR,apiKey:Boolean(process.env.CURSOR_API_KEY),authToken:Boolean(process.env.CURSOR_AUTH_TOKEN)})+'\\n');
if(args[0]==='--version')console.log(fs.readFileSync(root+'/version','utf8'));
else if(args[0]==='status')console.log(fs.readFileSync(root+'/status','utf8'));
else if(args[0]==='login'){
 if(process.env.NO_OPEN_BROWSER==='1')process.exit(99);
 if(fs.existsSync(root+'/hang')){process.stdin.resume();setInterval(()=>{},1000);}
 else {fs.writeFileSync(root+'/status',JSON.stringify({isAuthenticated:true}));}
}
else if(args[0]==='about')console.log(JSON.stringify({cliVersion:'2026.10.22-27dcf5f',latestStatus:'up_to_date',latestVersion:'2026.10.22-27dcf5f'}));
else if(args[0]==='update')console.log('updated');
else if(args[0]==='logout')fs.writeFileSync(root+'/status',JSON.stringify({isAuthenticated:false}));
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

  it('detects agent and the cursor-agent alias while exposing only the existing home', async () => {
    const lifecycle = createProviderLifecycles().get('cursor')!;
    const snapshot = createEmptySnapshot();
    expect(lifecycle.installed(snapshot)).toBe(true);
    await rename(path.join(root, 'agent'), path.join(root, 'cursor-agent'));
    expect(lifecycle.installed(snapshot)).toBe(true);
    const home = lifecycle.home(snapshot);
    expect(home).toStrictEqual({ homePath: path.join(root, '.cursor'), isolated: false, shareSkills: false });
    await expect(lifecycle.prepareHome(home, false)).resolves.toBeUndefined();
    expect(() => lifecycle.home(snapshot, { isolated: true, shareSkills: false })).toThrow('isolated');
    expect(lifecycle.install).toBeUndefined();
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

  it('detects logout and a login completed outside Korus on the next check', async () => {
    const current = connection();
    await state({ isAuthenticated: false });
    expect(await current.authenticate!({ action: 'check' })).toMatchObject({ connected: false, state: { loggedIn: false } });
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

  it('rejects malformed native status without exposing its output', async () => {
    await writeFile(path.join(root, 'status'), 'https://example.invalid/private-diagnostic');
    await expect(connection().authenticate!({ action: 'check' })).rejects.toThrow('Could not check Cursor authentication');
  });
});
