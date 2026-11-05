import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, mkdir, writeFile, appendFile, chmod, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { product } from '@workspace/core/product';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { runCli } from '../run-cli';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'standalone-cli-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const home = path.join(directory, 'state');
  const out: string[] = [], err: string[] = [];
  const exec = vi.fn().mockImplementation(async (_file: string, args: string[]) => ({ stdout: args[0] === 'auth' ? '{"loggedIn":true}' : args[0] === 'login' ? 'Logged in using ChatGPT' : args[0] === 'models' ? 'gemini-test\tGemini Test' : 'provider 1.2.3\n', stderr: '' }));
  const launch = vi.fn().mockResolvedValue(0);
  const ask = vi.fn().mockResolvedValue('no');
  const context = { env: { APP_HOME: home, PATH: '', KORUS_APP_PATH: path.join(directory, 'NoApp.app') } as NodeJS.ProcessEnv, userHome: directory, cwd: directory, platform: 'darwin' as const,
    write: vi.fn(), out: (text: string) => out.push(text), err: (text: string) => err.push(text), exec, launch, ask, interactive: false, signal: undefined as AbortSignal | undefined, now: () => new Date('2026-11-04T12:00:00Z') };
  const command = (args: string[]) => runCli(args, context);
  const seed = async () => {
    await mkdir(home, { recursive: true });
    const agents = [{ id: 'agent-one', name: 'Builder', folder: '/repo', engine: { kind: 'codex', session: { threadId: 'private-thread' } }, status: { type: 'working' } }];
    const missions = [{ id: 'mission-one', outcome: 'Ship checkout', stage: 'implementation', status: 'active', artifacts: { tickets: [{ title: 'Checkout', done: false }] } }];
    await writeFile(path.join(home, 'roster.json'), JSON.stringify({ schemaVersion: 3, writtenBy: '0.50.6', data: { agents, teams: [], missions } }));
    await writeFile(path.join(home, 'settings.json'), JSON.stringify({ schemaVersion: 1, data: { settings: { apiKey: 'PRIVATE_SETTINGS' } } }));
    return { agents, missions };
  };
  return { directory, home, context, command, out, err, exec, launch, ask, seed };
}
async function daemon(socket: string, handle: (method: string, params: unknown) => unknown) {
  const requests: { method: string; params: unknown }[] = [];
  const connections = new Set<net.Socket>();
  const server = net.createServer(client => {
    connections.add(client); client.on('close', () => connections.delete(client));
    let data = '';
    client.on('data', chunk => { data += chunk.toString(); let index: number;
      while ((index = data.indexOf('\n')) >= 0) {
        const line = data.slice(0, index); data = data.slice(index + 1);
        const request = JSON.parse(line); requests.push(request);
        const result = handle(request.method, request.params);
        if (result !== undefined) client.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
      }
    });
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  cleanups.push(async () => { for (const client of connections) client.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return requests;
}

describe('standalone CLI', () => {
  it('prints help and version without inspecting or creating application state', async () => {
    const f = await fixture();
    expect(await f.command(['--help'])).toBe(0);
    expect(f.out.join('')).toContain('triage');
    expect(f.out.join('')).toContain('doctor');
    expect(await f.command(['--version'])).toBe(0);
    expect(await readdir(f.directory)).toStrictEqual([]);
    expect(f.exec).not.toHaveBeenCalled();
    expect(f.launch).not.toHaveBeenCalled();
  });
  it('runs read-only doctor when both the daemon and application state are absent', async () => {
    const f = await fixture();
    expect(await f.command(['doctor', '--json', '--timeout', '30'])).toBe(0);
    const report = JSON.parse(f.out.join(''));
    expect(report).toMatchObject({ home: f.home, daemon: { running: false }, providers: [{ id: 'codex', installed: false }, { id: 'claude', installed: false }, { id: 'antigravity', installed: false }] });
    expect(report.daemon.detail).not.toMatch(/stdio|Enable the background backend|terminal control/);
    expect(await readdir(f.directory)).toStrictEqual([]);
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.exec).not.toHaveBeenCalled();
  });
  it('groups diagnostics into coloured sections only for terminals and keeps JSON clean', async () => {
    const f = await fixture(); await f.seed();
    expect(await f.command(['doctor', '--timeout', '20'])).toBe(0);
    const plain = f.out.pop()!;
    expect(plain).toMatch(/^Korus doctor/m);
    for (const section of ['Installation', 'Codex', 'Claude Code', 'Antigravity', 'Integrations', 'Checks']) expect(plain).toContain(`\n${section}\n\n`);
    expect(plain).toMatch(/^ {2}Desktop\s/m);
    expect(plain).toMatch(/^ {2}Version\s/m);
    expect(plain).not.toContain('\u001b[');
    expect(plain).not.toMatch(/WARNING daemon|Daemon socket unavailable/);
    expect(f.err).toStrictEqual([]);
    f.context.interactive = true; f.context.env.TERM = 'xterm-256color';
    expect(await f.command(['doctor', '--timeout', '20'])).toBe(0);
    const coloured = f.out.splice(0).join('\n');
    for (const section of ['Installation', 'Codex', 'Claude Code', 'Antigravity', 'Checks']) expect(coloured).toContain(`\u001b[1;36m${section}\u001b[0m`);
    f.context.env.NO_COLOR = '';
    expect(await f.command(['doctor', '--timeout', '20'])).toBe(0);
    expect(f.out.splice(0).join('\n')).not.toContain('\u001b[');
    delete f.context.env.NO_COLOR;
    expect(await f.command(['doctor', '--json', '--timeout', '20'])).toBe(0);
    expect(JSON.parse(f.out.pop()!)).toMatchObject({ healthy: true, daemon: { running: false } });
  });
  it('reports each client home and safe auth status without exposing account data', async () => {
    const f = await fixture(); await f.seed();
    const bin = path.join(f.directory, 'bin'); await mkdir(bin); f.context.env.PATH = bin;
    for (const id of ['codex', 'claude', 'agy']) { await writeFile(path.join(bin, id), '#!/bin/sh\n'); await chmod(path.join(bin, id), 0o755); }
    f.context.env.CODEX_HOME = path.join(f.directory, 'custom-codex');
    f.context.env.CLAUDE_CONFIG_DIR = path.join(f.directory, 'custom-claude');
    f.context.env.GEMINI_HOME = path.join(f.directory, 'custom-gemini');
    f.exec.mockImplementation(async (_file: string, args: string[]) => ({ stdout: args[0] === 'auth' ? '{"loggedIn":false,"email":"PRIVATE_ACCOUNT"}' : args[0] === 'models' ? 'gemini-test\tGemini Test' : args[0] === 'login' ? '' : 'provider 1.2.3', stderr: args[0] === 'login' ? 'Logged in using ChatGPT' : '' }));
    expect(await f.command(['doctor', '--json', '--timeout', '20'])).toBe(0);
    const json = f.out.pop()!;
    expect(JSON.parse(json).providers).toMatchObject([
      { id: 'codex', home: f.context.env.CODEX_HOME, auth: 'authenticated' },
      { id: 'claude', home: f.context.env.CLAUDE_CONFIG_DIR, auth: 'signed-out' },
      { id: 'antigravity', home: f.context.env.GEMINI_HOME, auth: 'authenticated' },
    ]);
    expect(json).not.toContain('PRIVATE_ACCOUNT');
    const homes = Object.fromEntries(['codex', 'claude', 'antigravity'].map(id => [id, { homePath: path.join(f.home, `${id}-home`), isolated: true, shareSkills: false }]));
    await writeFile(path.join(f.home, 'settings.json'), JSON.stringify({ schemaVersion: 1, data: { settings: { providerHomes: homes, apiKey: 'PRIVATE_SETTINGS' } } }));
    f.exec.mockClear();
    expect(await f.command(['doctor', '--json', '--timeout', '20'])).toBe(0);
    const configured = f.out.pop()!;
    expect(JSON.parse(configured).providers.map((provider: { home: string }) => provider.home)).toStrictEqual(['codex', 'claude', 'antigravity'].map(id => homes[id]!.homePath));
    expect(f.exec).toHaveBeenCalledWith(path.join(bin, 'codex'), ['login', 'status'], expect.objectContaining({ env: expect.objectContaining({ CODEX_HOME: homes.codex!.homePath }) }));
    expect(f.exec).toHaveBeenCalledWith(path.join(bin, 'claude'), ['auth', 'status', '--json'], expect.objectContaining({ env: expect.objectContaining({ CLAUDE_CONFIG_DIR: homes.claude!.homePath }) }));
    expect(f.exec).toHaveBeenCalledWith(path.join(bin, 'agy'), ['models'], expect.objectContaining({ env: expect.objectContaining({ GEMINI_HOME: homes.antigravity!.homePath }) }));
    expect(configured).not.toMatch(/PRIVATE_ACCOUNT|PRIVATE_SETTINGS/);

    f.exec.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'auth') throw Object.assign(new Error('PRIVATE_AUTH_ERROR'), { stdout: '{"loggedIn":false,"email":"PRIVATE_ACCOUNT"}' });
      if (args[0] === 'login') throw Object.assign(new Error('PRIVATE_AUTH_ERROR'), { stderr: 'Not logged in' });
      return { stdout: 'provider 1.2.3', stderr: '' };
    });
    expect(await f.command(['doctor', '--json', '--timeout', '20'])).toBe(0);
    expect(JSON.parse(f.out.pop()!).providers).toMatchObject([{ auth: 'signed-out' }, { auth: 'signed-out' }, { auth: 'unknown' }]);
    f.exec.mockRejectedValue(new Error('PRIVATE_AUTH_ERROR'));
    expect(await f.command(['doctor', '--timeout', '20'])).toBe(0);
    const plain = f.out.pop()!;
    expect(plain).toContain('Unable to verify');
    expect(plain).not.toContain('PRIVATE_AUTH_ERROR');
    expect(f.launch).not.toHaveBeenCalled();
    expect((await readdir(f.home)).sort()).toStrictEqual(['roster.json', 'settings.json']);
  });
  it('prints installation details while auth is pending and clears its temporary terminal spinner', async () => {
    const f = await fixture(); await f.seed(); f.context.interactive = true; f.context.env.TERM = 'xterm';
    const bin = path.join(f.directory, 'bin'); await mkdir(bin); f.context.env.PATH = bin;
    await writeFile(path.join(bin, 'codex'), '#!/bin/sh\n'); await chmod(path.join(bin, 'codex'), 0o755);
    let resolveAuth!: (result: { stdout: string; stderr: string }) => void;
    const auth = new Promise<{ stdout: string; stderr: string }>(resolve => { resolveAuth = resolve; });
    f.exec.mockImplementation(async (_file: string, args: string[]) => args[0] === 'login' ? auth : { stdout: 'provider 1.2.3', stderr: '' });
    const running = f.command(['doctor', '--timeout', '1000']);
    try {
      await vi.waitFor(() => expect(f.exec).toHaveBeenCalledWith(expect.any(String), ['login', 'status'], expect.any(Object)));
      expect(f.out.join('')).toContain('Installation');
      expect(f.out.join('')).toContain('\u001b[1;36mCodex\u001b[0m\n\n');
      expect(f.out.join('')).not.toContain('All checks passed');
      expect(f.context.write).toHaveBeenCalledWith(expect.stringContaining('Checking Codex'));
    } finally { resolveAuth({ stdout: 'Logged in using ChatGPT', stderr: '' }); }
    expect(await running).toBe(0);
    expect(f.out.join('')).toContain('Signed in');
    expect(f.context.write).toHaveBeenLastCalledWith('\r\u001b[2K');
    f.context.write.mockClear(); f.out.length = 0;
    expect(await f.command(['doctor', '--json'])).toBe(0);
    expect(JSON.parse(f.out.pop()!).healthy).toBe(true);
    expect(f.context.write).not.toHaveBeenCalled();
  });
  it('shows the source folder and saved integration connection modes before checks without account details', async () => {
    const f = await fixture(); await f.seed();
    await writeFile(path.join(f.home, 'settings.json'), JSON.stringify({ schemaVersion: 1, data: {
      settings: {}, sourceFolder: { path: '~/src' }, workIntegrations: { connections: [
        { provider: 'github', status: 'connected', source: 'cli', accountLabel: 'PRIVATE_ACCOUNT' },
        { provider: 'gitlab', status: 'disconnected', source: 'none' },
        { provider: 'linear', status: 'connected', source: 'api', detail: 'PRIVATE_DETAIL' },
      ] },
    } }));
    expect(await f.command(['doctor', '--timeout', '20'])).toBe(0);
    const text = f.out.pop()!;
    expect(text).toMatch(/Source folder\s+~\/src/);
    expect(text).toMatch(/GitHub\s+Using CLI/);
    expect(text).toMatch(/GitLab\s+Not connected/);
    expect(text).toMatch(/Linear\s+Connected/);
    expect(text.indexOf('Integrations')).toBeLessThan(text.indexOf('Checks'));
    expect(text).not.toMatch(/PRIVATE_ACCOUNT|PRIVATE_DETAIL/);
    expect(await f.command(['doctor', '--json', '--timeout', '20'])).toBe(0);
    expect(f.out.pop()).not.toMatch(/PRIVATE_ACCOUNT|PRIVATE_DETAIL/);
  });
  it('reports corrupt state without migrating, rewriting, or leaking its contents', async () => {
    const f = await fixture(); await f.seed();
    await writeFile(path.join(f.home, 'settings.json'), '{"secret":"DO_NOT_PRINT"');
    expect(await f.command(['doctor', '--json', '--timeout', '30'])).toBe(1);
    expect(f.out.join('')).not.toContain('DO_NOT_PRINT');
    expect(f.out.join('')).toContain('invalid JSON');
    expect(await readFile(path.join(f.home, 'settings.json'), 'utf8')).toBe('{"secret":"DO_NOT_PRINT"');
    expect((await readdir(f.home)).sort()).toStrictEqual(['roster.json', 'settings.json']);
  });
  it('labels offline agent and Mission inspection and never exposes provider sessions or settings', async () => {
    const f = await fixture(); await f.seed();
    expect(await f.command(['agents', 'list', '--offline', '--json'])).toBe(0);
    expect(JSON.parse(f.out.pop()!)).toMatchObject({ source: 'saved', agents: [{ id: 'agent-one', backend: 'codex' }] });
    expect(await f.command(['missions', 'show', 'mission-one', '--offline', '--json'])).toBe(0);
    expect(JSON.parse(f.out.pop()!)).toMatchObject({ source: 'saved', mission: { id: 'mission-one', tickets: [{ title: 'Checkout', done: false }] } });
    expect(f.out.join('')).not.toMatch(/private-thread|PRIVATE_SETTINGS/);
    expect(f.launch).not.toHaveBeenCalled();
  });
  it('rejects removed agent send and stop commands without contacting the daemon', async () => {
    const f = await fixture(); const seeded = await f.seed();
    const requests = await daemon(path.join(f.home, 'daemon.sock'), method => method === backendMethods.backendHealthGet
      ? { ok: true, version: '0.50.6', pid: 123, name: product.daemonName }
      : method === backendMethods.snapshotGet ? { snapshot: { agents: seeded.agents.map(({ engine, ...agent }) => ({ ...agent, backend: engine.kind })), missions: seeded.missions } } : {});
    expect(await f.command(['agents', 'send', 'agent:agent-one', 'Continue carefully', '--json'])).toBe(2);
    expect(await f.command(['agents', 'stop', 'id:agent-one', '--json'])).toBe(2);
    expect(requests).toStrictEqual([]);
    expect(await f.command(['--help'])).toBe(0);
    expect(f.out.join('')).not.toMatch(/agents (send|stop)/);
  });
  it('falls back to saved inspection state after a bounded unresponsive daemon check', async () => {
    const f = await fixture(); await f.seed(); await daemon(path.join(f.home, 'daemon.sock'), () => undefined);
    expect(await f.command(['agents', 'list', '--json', '--timeout', '20'])).toBe(0);
    expect(JSON.parse(f.out.join(''))).toMatchObject({ source: 'saved', agents: [{ id: 'agent-one' }] });
    expect(f.launch).not.toHaveBeenCalled();
  });
  it('prepares triage without a working daemon or provider and keeps the prompt private', async () => {
    const f = await fixture(); await f.seed();
    expect(await f.command(['triage', 'Messages fail with ECONNRESET', '--no-launch', '--json', '--timeout', '20'])).toBe(0);
    const result = JSON.parse(f.out.join(''));
    const prompt = await readFile(result.promptPath, 'utf8');
    const context = await readFile(result.contextPath, 'utf8');
    expect(prompt).toContain('Messages fail with ECONNRESET');
    expect(prompt).toContain(product.repositoryUrl);
    expect(prompt).toMatch(/approval|permission/i);
    expect(context).not.toMatch(/PRIVATE_SETTINGS|private-thread/);
    expect((await stat(result.promptPath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(result.promptPath))).mode & 0o777).toBe(0o700);
    expect(f.launch).not.toHaveBeenCalled();
  });
  it('launches the requested terminal provider with an on-disk prompt and forwards its exit code', async () => {
    const f = await fixture(); const bin = path.join(f.directory, 'bin'); await mkdir(bin);
    await writeFile(path.join(bin, 'codex'), '#!/bin/sh\n'); await chmod(path.join(bin, 'codex'), 0o755);
    f.context.env.PATH = bin; f.launch.mockResolvedValue(7);
    expect(await f.command(['triage', '--agent', 'codex', '--model', 'test-model', '--timeout', '20'])).toBe(7);
    expect(f.launch).toHaveBeenCalledWith(path.join(bin, 'codex'), ['--model', 'test-model', expect.stringMatching(/Read.*prompt\.md/)], expect.objectContaining({ cwd: expect.any(String) }));
  });
  it('finds private provider executables in the explicitly selected installation', async () => {
    const f = await fixture(); const home = path.join(f.directory, 'other-state');
    const bin = path.join(home, 'bin'); await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, 'codex'), '#!/bin/sh\n'); await chmod(path.join(bin, 'codex'), 0o755);
    expect(await f.command(['triage', '--home', home, '--agent', 'codex', '--timeout', '20'])).toBe(0);
    expect(f.launch).toHaveBeenCalledWith(path.join(bin, 'codex'), expect.any(Array), expect.any(Object));
    expect(f.exec).toHaveBeenCalledWith(path.join(bin, 'codex'), ['--version'], expect.any(Object));
  });
  it('exports only diagnostic metadata by default and redacts optional log excerpts', async () => {
    const f = await fixture(); await f.seed(); await mkdir(path.join(f.home, 'logs'));
    await writeFile(path.join(f.home, 'logs', 'daemon.log'), JSON.stringify({ time: '2026-11-04T11:59:00Z', area: 'mcp-http', level: 'error', msg: 'ECONNRESET', content: 'PRIVATE_CONVERSATION', token: 'sk-secret-token', path: f.home }) + '\n');
    await writeFile(path.join(f.home, 'settings.json'), JSON.stringify({ schemaVersion: 1, writtenBy: 'build token: DO_NOT_EXPORT', data: { settings: { apiKey: 'PRIVATE_SETTINGS' } } }));
    expect(await f.command(['support', 'bundle', '--json', '--timeout', '20'])).toBe(0);
    const result = JSON.parse(f.out.pop()!);
    const report = await readFile(path.join(result.directory, 'diagnostics.json'), 'utf8');
    expect(report).not.toMatch(/PRIVATE_SETTINGS|PRIVATE_CONVERSATION|sk-secret-token|private-thread/);
    expect(JSON.parse(report).files).toContainEqual(expect.objectContaining({ name: 'settings.json', writtenBy: expect.stringContaining('[REDACTED]') }));
    expect(report).not.toContain('DO_NOT_EXPORT');
    expect(report).not.toContain(f.directory);
    expect((await readdir(result.directory)).sort()).toStrictEqual(['README.md', 'diagnostics.json']);
    await appendFile(path.join(f.home, 'logs', 'daemon.log'), '[native log] {"apiKey":"PRIVATE_INLINE"}\n');
    expect(await f.command(['logs', '--json', '--lines', '10'])).toBe(0);
    expect(f.out.join('')).not.toMatch(/PRIVATE_CONVERSATION|sk-secret-token|PRIVATE_INLINE/);
    expect(f.out.join('')).toContain('ECONNRESET');
    expect(await f.command(['support', 'bundle', '--include-logs', '--json', '--timeout', '20'])).toBe(0);
    const extra = JSON.parse(f.out.pop()!);
    const logs = await readFile(path.join(extra.directory, 'logs.json'), 'utf8');
    expect(logs).toContain('ECONNRESET');
    expect(logs).not.toMatch(/PRIVATE_CONVERSATION|PRIVATE_INLINE|sk-secret-token/);
  });
  it('refuses service restart without confirmation and never touches another home', async () => {
    const f = await fixture(); const launchAgents = path.join(f.directory, 'Library', 'LaunchAgents'); await mkdir(launchAgents, { recursive: true });
    await writeFile(path.join(launchAgents, `${product.appId}.daemon.plist`), '<plist/>');
    expect(await f.command(['backend', 'restart'])).toBe(1);
    expect(f.exec).not.toHaveBeenCalled();
    expect(await f.command(['backend', 'restart', '--yes'])).toBe(1);
    expect(f.err.join('')).toMatch(/home|APP_HOME/i);
  });
  it('uses the canonical socket override and reports a healthy installed setup without writing state', async () => {
    const f = await fixture(); await f.seed();
    const bin = path.join(f.directory, 'bin'); await mkdir(bin); await writeFile(path.join(bin, 'codex'), '#!/bin/sh\n'); await chmod(path.join(bin, 'codex'), 0o755); f.context.env.PATH = bin;
    const socket = path.join(f.directory, 'custom.sock'); f.context.env.APP_BACKEND_SOCKET = socket;
    await daemon(socket, () => ({ ok: true, name: product.daemonName, version: '0.50.6', pid: 456 }));
    expect(await f.command(['doctor', '--json'])).toBe(0);
    expect(JSON.parse(f.out.join(''))).toMatchObject({ healthy: true, socket, daemon: { running: true, pid: 456 }, providers: [{ id: 'codex', installed: true, version: 'provider 1.2.3' }, { id: 'claude', installed: false }, { id: 'antigravity', installed: false }] });
    expect((await readdir(f.home)).sort()).toStrictEqual(['roster.json', 'settings.json']);
  });
  it('checks the last advertised loopback MCP endpoint without registering an agent or following redirects', async () => {
    const f = await fixture(); await f.seed(); await mkdir(path.join(f.home, 'logs'));
    const received: string[] = [];
    const server = http.createServer((req, res) => { received.push(req.url!); res.writeHead(405); res.end(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const port = (server.address() as net.AddressInfo).port;
    const url = `http://127.0.0.1:${port}/mcp`;
    await writeFile(path.join(f.home, 'logs', 'daemon.log'), JSON.stringify({ area: 'mcp-http', msg: 'listening', url }) + '\n');
    expect(await f.command(['doctor', '--json', '--timeout', '100'])).toBe(0);
    expect(JSON.parse(f.out.pop()!)).toMatchObject({ mcp: { reachable: true, endpoint: url } });
    expect(received).toStrictEqual(['/mcp']);
    expect(await f.command(['doctor', '--mcp-url', 'https://example.com/mcp', '--timeout', '20', '--json'])).toBe(1);
    expect(JSON.parse(f.out.pop()!)).toMatchObject({ mcp: { reachable: false } });
    expect(received).toStrictEqual(['/mcp']);
  });
  it('controls only the matching macOS service and requires an explicit affirmative response', async () => {
    const f = await fixture(); const directory = path.join(f.directory, 'Library', 'LaunchAgents'); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${product.appId}.daemon.plist`), `<plist><key>APP_HOME</key><string>${f.home}</string></plist>`);
    f.context.interactive = true; f.ask.mockResolvedValue('yes');
    for (const action of ['start', 'restart', 'stop']) expect(await f.command(['backend', action, '--json'])).toBe(0);
    expect(f.exec.mock.calls.map(([file, args]) => [file, args[0]])).toStrictEqual([['launchctl', 'print'], ['launchctl', 'kickstart'], ['launchctl', 'kickstart'], ['launchctl', 'bootout']]);
    const before = f.exec.mock.calls.length; f.context.platform = 'linux' as 'darwin';
    expect(await f.command(['backend', 'restart', '--yes'])).toBe(1); expect(f.exec).toHaveBeenCalledTimes(before);
  });
  it('tails new redacted rows until cancelled and filters existing logs by time and agent', async () => {
    const f = await fixture(); await f.seed(); await mkdir(path.join(f.home, 'logs'));
    const file = path.join(f.home, 'logs', 'daemon.log');
    const row = (agentId: string, time: string, msg: string) => JSON.stringify({ agentId, time, msg, apiKey: 'PRIVATE_TOKEN' }) + '\n';
    await writeFile(file, row('agent-one', '2026-11-04T11:00:00Z', 'old') + row('other', '2026-11-04T11:59:00Z', 'other') + row('agent-one', '2026-11-04T11:59:00Z', 'current'));
    expect(await f.command(['logs', '--agent', 'agent-one', '--since', '15m', '--json'])).toBe(0);
    const entries = JSON.parse(f.out.pop()!).entries; expect(entries).toHaveLength(1); expect(entries[0].text).toContain('current');
    f.context.interactive = true; const abort = new AbortController(); f.context.signal = abort.signal;
    const following = f.command(['logs', '--follow', '--json']);
    try {
      await vi.waitFor(() => expect(f.out.join('')).toContain('following'));
      await appendFile(file, row('agent-one', '2026-11-04T12:00:01Z', 'arrived'));
      await vi.waitFor(() => expect(f.out.join('')).toContain('arrived'));
      await appendFile(file, row('agent-one', '2026-11-04T12:00:02Z', 'checkpoint') + '{"msg":"pending","apiKey":"PRIVATE_');
      await vi.waitFor(() => expect(f.out.join('')).toContain('checkpoint'));
      expect(f.out.join('')).not.toContain('PRIVATE_');
      await appendFile(file, 'TOKEN"}\n');
      await vi.waitFor(() => expect(f.out.join('')).toContain('pending'));
      expect(f.out.join('')).not.toContain('PRIVATE_TOKEN');
    } finally { abort.abort(); }
    expect(await following).toBe(0);
  });
  it('invokes a real provider process from the terminal adapter without a shell or application runtime', async () => {
    if (process.platform === 'win32') return;
    const f = await fixture(); const bin = path.join(f.directory, 'bin'); await mkdir(bin);
    const capture = path.join(f.directory, 'capture'); f.context.env.TRIAGE_CAPTURE = capture; f.context.env.PATH = bin;
    await writeFile(path.join(bin, 'codex'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo provider-version; exit 0; fi\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT" >&2; exit 0; fi\nprintf "%s\\n" "$@" > "$TRIAGE_CAPTURE"\nexit 7\n');
    await chmod(path.join(bin, 'codex'), 0o755);
    const { exec: _exec, launch: _launch, ...context } = f.context;
    const exitCode = await runCli(['triage', '--agent', 'codex', '--model', 'model with spaces', '--timeout', '1000'], context);
    expect(exitCode, f.err.join('\n')).toBe(7);
    expect(await readFile(capture, 'utf8')).toMatch(/--model\nmodel with spaces\nRead the file/);
  });

  it('shows reachable and unavailable backend status without invoking service control', async () => {
    const f = await fixture(); await f.seed();
    expect(await f.command(['backend', 'status', '--json'])).toBe(1);
    expect(JSON.parse(f.out.pop()!)).toMatchObject({ running: false });
    await daemon(path.join(f.home, 'daemon.sock'), () => ({ ok: true, version: '0.50.6', name: product.daemonName }));
    expect(await f.command(['backend', 'status', '--json'])).toBe(0);
    expect(JSON.parse(f.out.pop()!)).toMatchObject({ running: true });
    expect(f.exec).not.toHaveBeenCalled();
  });
  it.each([
    { claude: 'authenticated', codex: true, selected: 'claude', executable: 'claude' },
    { claude: 'signed-out', codex: true, selected: 'codex', executable: 'codex' },
    { claude: 'timeout', codex: false, selected: 'antigravity', executable: 'agy' },
  ])('automatically chooses $selected from installed authenticated clients in priority order', async ({ claude, codex, selected, executable }) => {
    const f = await fixture(); const bin = path.join(f.directory, 'bin'); await mkdir(bin); f.context.env.PATH = bin;
    for (const id of ['codex', 'claude', 'agy']) { await writeFile(path.join(bin, id), '#!/bin/sh\n'); await chmod(path.join(bin, id), 0o755); }
    f.exec.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'auth') {
        if (claude === 'timeout') throw new Error('PRIVATE_AUTH_FAILURE');
        return { stdout: JSON.stringify({ loggedIn: claude === 'authenticated', email: 'PRIVATE_ACCOUNT' }), stderr: '' };
      }
      if (args[0] === 'login') return { stdout: codex ? 'Logged in using ChatGPT' : 'Not logged in PRIVATE_ACCOUNT', stderr: '' };
      return { stdout: args[0] === 'models' ? 'gemini-test\tGemini Test' : 'provider 1.2.3', stderr: '' };
    });
    expect(await f.command(['triage', '--timeout', '20'])).toBe(0);
    expect(f.launch).toHaveBeenCalledWith(path.join(bin, executable), selected === 'antigravity' ? ['--prompt-interactive', expect.stringContaining('prompt.md')] : [expect.stringContaining('prompt.md')], expect.any(Object));
    expect(f.ask).not.toHaveBeenCalled();
    expect([...f.out, ...f.err].join('')).not.toMatch(/PRIVATE_ACCOUNT|PRIVATE_AUTH_FAILURE/);
    if (selected === 'claude') expect(f.exec.mock.calls.filter(([, args]) => args[0] === 'login' || args[0] === 'models')).toHaveLength(0);
  });
  it('preserves explicit client overrides and refuses to launch an unauthenticated client', async () => {
    const f = await fixture(); const bin = path.join(f.directory, 'bin'); await mkdir(bin); f.context.env.PATH = bin;
    for (const id of ['codex', 'claude']) { await writeFile(path.join(bin, id), '#!/bin/sh\n'); await chmod(path.join(bin, id), 0o755); }
    expect(await f.command(['triage', '--agent', 'codex', '--timeout', '20'])).toBe(0);
    expect(f.launch).toHaveBeenCalledWith(path.join(bin, 'codex'), expect.any(Array), expect.any(Object));
    f.launch.mockClear();
    f.exec.mockImplementation(async (_file: string, args: string[]) => ({ stdout: args[0] === 'auth' ? '{"loggedIn":false}' : args[0] === 'login' ? 'Usage: codex login status' : 'provider 1.2.3', stderr: '' }));
    expect(await f.command(['triage', '--agent', 'claude', '--timeout', '20'])).toBe(1);
    expect(await f.command(['triage', '--timeout', '20'])).toBe(1);
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.err.join('')).toMatch(/authenticat|sign.in/i);
    expect((await readdir(path.join(f.home, 'triage')))).toHaveLength(3);
  });
  it('lists live agent and Mission metadata without changing backend state', async () => {
    const f = await fixture(); await f.seed();
    const agent = { name: 'Builder', backend: 'codex', status: { type: 'idle' } };
    await daemon(path.join(f.home, 'daemon.sock'), () => ({ snapshot: { agents: [{ ...agent, id: 'one' }, { ...agent, id: 'two' }], missions: [] } }));
    expect(await f.command(['agents', 'list', '--json'])).toBe(0);
    expect(JSON.parse(f.out.pop()!)).toStrictEqual({ source: 'live', agents: ['one', 'two'].map(id => ({ id, name: 'Builder', backend: 'codex', status: 'idle' })) });
    expect(await f.command(['missions', 'list', '--json'])).toBe(0);
    expect(JSON.parse(f.out.pop()!)).toStrictEqual({ source: 'live', missions: [] });
  });

  it('rejects unknown commands and invalid limits without mutating state', async () => {
    const f = await fixture();
    expect(await f.command(['oops'])).toBe(2);
    expect(await f.command(['doctor', '--timeout', '-1'])).toBe(2);
    expect(await f.command(['logs', '--lines', '0'])).toBe(2);
    expect(await readdir(f.directory)).toStrictEqual([]);
  });
});
