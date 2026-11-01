import { chmod, mkdtemp, readdir, readFile, readlink, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acpEnvironment, resolveAcpRuntime } from '../runtime';
import { AcpRuntime, NativeLoginRequired } from '../acp-runtime';
import { createAntigravityLifecycle } from '../provider-lifecycle';
import { AntigravityHost } from '../antigravity-host';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';

let root: string;
const processes: AcpRuntime[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'korus-acp-runtime-'));
  vi.stubEnv('APP_HOME', path.join(root, 'app'));
  vi.stubEnv('GEMINI_HOME', path.join(root, 'external'));
  vi.stubEnv('APP_ANTIGRAVITY_COMMAND', path.join(root, 'runtime'));
  vi.stubEnv('ANTIGRAVITY_HARNESS_PATH', path.join(root, 'harness'));
  // Native fixtures use inherited PATH rather than the user's shell startup files.
  vi.stubEnv('SHELL', path.join(root, 'no-login-shell'));
});
afterEach(async () => {
  await Promise.all(processes.splice(0).map(runtime => runtime.close()));
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

async function fakeRuntime(authenticate: string, version = '1.3.0') {
  await writeFile(path.join(root, 'harness'), '', { mode: 0o700 });
  await writeFile(path.join(root, 'runtime'), `#!/usr/bin/env node
const rl = require('node:readline').createInterface({input:process.stdin});
rl.on('line', line => {
  const v=JSON.parse(line);
  const reply=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:v.id,result})+'\\n');
  if(v.method==='initialize') reply({protocolVersion:2,agentInfo:{name:'antigravity-acp',version:'${version}'}});
  else if(v.method==='authenticate') { ${authenticate} }
});
`, { mode: 0o700 });
  await chmod(path.join(root, 'runtime'), 0o700);
}

async function open() {
  const runtime = await AcpRuntime.open({ cwd: root, onRequest: async () => { throw new Error('Unexpected request'); }, onNotification: vi.fn(), onClose: vi.fn() });
  processes.push(runtime);
  return runtime;
}

describe('Antigravity native lifecycle', () => {
  it('cancels authentication during startup without publishing a late connected observation, then retries', async () => {
    await fakeRuntime('reply({})');
    const host = new AntigravityHost();
    const events: unknown[] = [];
    host.onEvent(event => events.push(event));
    try {
      const login = host.authenticate({ action: 'login' }).catch(error => error);
      await host.authenticate({ action: 'cancel' });
      await login;
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'provider.authenticationChanged', payload: expect.objectContaining({ connected: true }) }));
      expect(await readdir(path.join(root, 'external/korus-tmp')).catch(() => [])).toEqual([]);
      expect(await host.authenticate({ action: 'check' })).toMatchObject({ connected: true });
    } finally { await host.close(); }
  });
  it('lets an explicit sign-in supersede a background check that is still in flight', async () => {
    const marker = path.join(root, 'first-authenticate');
    // The first authenticate (the background check) never answers; later ones succeed.
    await fakeRuntime(`const fs=require('node:fs'); if(!fs.existsSync(${JSON.stringify(marker)})) fs.writeFileSync(${JSON.stringify(marker)},''); else reply({});`);
    const host = new AntigravityHost();
    try {
      const check = host.authenticate({ action: 'check' }).catch(error => error);
      await vi.waitFor(async () => { await readFile(marker); }, { timeout: 10_000 });
      await expect(host.authenticate({ action: 'login' })).resolves.toMatchObject({ connected: true });
      expect(await check).toBeInstanceOf(Error);
      await expect(host.authenticate({ action: 'check' })).resolves.toMatchObject({ connected: true });
    } finally { await host.close(); }
  });
  it('still rejects overlapping explicit authentication actions', async () => {
    await fakeRuntime('/* never answers */');
    const host = new AntigravityHost();
    try {
      const login = host.authenticate({ action: 'login' }).catch(error => error);
      await expect(host.authenticate({ action: 'login' })).rejects.toThrow('already in progress');
      await host.authenticate({ action: 'cancel' });
      await login;
    } finally { await host.close(); }
  });
  it('requires the paired runtime and excludes ambient API billing credentials from child processes', async () => {
    await writeFile(path.join(root, 'runtime'), '', { mode: 0o700 });
    expect(resolveAcpRuntime()).toBeNull();
    await writeFile(path.join(root, 'harness'), '', { mode: 0o700 });
    expect(resolveAcpRuntime()).toMatchObject({ command: path.join(root, 'runtime'), harness: path.join(root, 'harness') });
    for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_GENAI_USE_VERTEXAI', 'AGY_ACP_PRIVATE']) vi.stubEnv(name, 'must-not-leak');
    const env = acpEnvironment('/home/acp', '/runtime/harness', '/private/temp');
    expect(Object.values(env)).not.toContain('must-not-leak');
    expect(env).toMatchObject({ GEMINI_HOME: '/home/acp', ANTIGRAVITY_HARNESS_PATH: '/runtime/harness', TMPDIR: '/private/temp', AGY_ACP_FORCE_FILE_STORAGE: '1' });
  });

  it('authenticates through the native process and cleans its private temporary directory on close', async () => {
    await fakeRuntime("if(!process.env.BROWSER || !process.env.GEMINI_HOME) process.exit(1); reply({})");
    const runtime = await open();
    await expect(runtime.authenticate()).resolves.toBeUndefined();
    await runtime.close();
    expect(await readdir(path.join(root, 'external/korus-tmp'))).toEqual([]);
  });

  it('observes a missing native login without opening a browser or retaining its URL', async () => {
    await fakeRuntime("process.stderr.write('Open the following link to authenticate the ACP server: https://example.invalid/secret\\n')");
    const runtime = await open();
    await expect(runtime.authenticate()).rejects.toBeInstanceOf(NativeLoginRequired);
    await runtime.close();
    expect(await readdir(path.join(root, 'external/korus-tmp'))).toEqual([]);
  });

  it('rejects an unqualified runtime version and cleans the failed startup', async () => {
    await fakeRuntime('reply({})', '9.0.0');
    await expect(open()).rejects.toThrow('qualified ACP 1.3.0');
    expect(await readdir(path.join(root, 'external/korus-tmp'))).toEqual([]);
  });

  it('disconnects the provider observation when conversation startup requires native login', async () => {
    await fakeRuntime("process.stderr.write('Open the following link to authenticate the ACP server: https://example.invalid/secret\\n')");
    const host = new AntigravityHost();
    const events: unknown[] = [];
    host.onEvent(event => events.push(event));
    try {
      await expect(host.listModels({ id: 'lost-auth', name: 'Lost auth', folder: root, backend: 'antigravity', createdAt: '', updatedAt: '', status: { type: 'idle' } })).rejects.toBeInstanceOf(NativeLoginRequired);
      expect(events).toContainEqual({ type: 'provider.authenticationChanged', backend: 'antigravity', payload: {
        kind: 'antigravity', connected: false, state: { loggedIn: false, homePath: path.join(root, 'external') },
      } });
    } finally { await host.close(); }
  });

  it('observes an externally installed pair on PATH after setup leaves the runtime absent', async () => {
    vi.stubEnv('APP_ANTIGRAVITY_COMMAND', '');
    vi.stubEnv('ANTIGRAVITY_HARNESS_PATH', '');
    vi.stubEnv('PATH', root);
    const lifecycle = createAntigravityLifecycle();
    const home = lifecycle.home(createTestSnapshot());
    await lifecycle.prepareHome(home, false);
    await lifecycle.prepareHome(home, true);
    expect(resolveAcpRuntime()).toBeNull();
    await writeFile(path.join(root, 'agy_acp_server.par'), '', { mode: 0o700 });
    expect(lifecycle.installed(createTestSnapshot())).toBe(false);
    await writeFile(path.join(root, 'localharness_external'), '', { mode: 0o700 });
    expect(lifecycle.installed(createTestSnapshot())).toBe(true);
    expect(resolveAcpRuntime()).toMatchObject({ command: path.join(root, 'agy_acp_server.par'), harness: path.join(root, 'localharness_external') });
    await rm(path.join(root, 'localharness_external'));
    expect(lifecycle.installed(createTestSnapshot())).toBe(false);
  });

  it('shares only native skill directories, preserves private skills, and never copies authentication', async () => {
    for (const directory of ['config', 'antigravity-cli']) {
      await mkdir(path.join(root, 'external', directory, 'skills'), { recursive: true });
      await writeFile(path.join(root, 'external', directory, 'skills/example.md'), 'shared skill');
    }
    await writeFile(path.join(root, 'external/private-auth'), 'fake secret');
    const lifecycle = createAntigravityLifecycle();
    const home = lifecycle.home(createTestSnapshot(), { isolated: true, shareSkills: true });
    await lifecycle.prepareHome(home, true);
    expect(await readFile(path.join(home.homePath, 'config/skills/example.md'), 'utf8')).toBe('shared skill');
    await expect(readFile(path.join(home.homePath, 'private-auth'))).rejects.toMatchObject({ code: 'ENOENT' });
    home.shareSkills = false;
    await lifecycle.prepareHome(home, true);
    await mkdir(path.join(home.homePath, 'antigravity-cli/skills'), { recursive: true });
    await writeFile(path.join(home.homePath, 'antigravity-cli/skills/mine.md'), 'keep');
    home.shareSkills = true;
    await expect(lifecycle.prepareHome(home, true)).rejects.toThrow('Private Antigravity skills');
    await expect(readlink(path.join(home.homePath, 'config/skills'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(home.homePath, 'antigravity-cli/skills/mine.md'), 'utf8')).toBe('keep');
  });
});
