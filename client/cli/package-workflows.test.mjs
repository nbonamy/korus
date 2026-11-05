import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod, readdir, rm, rename } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { buildCli } from './build.mjs';
import product from '../../core/src/product.json' with { type: 'json' };

const exec = promisify(execFile);
function processOutput(child) {
  let stdout = '', stderr = '';
  const waiters = new Set();
  child.stdout.on('data', chunk => { stdout += chunk; for (const notify of waiters) notify(); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const deadline = setTimeout(() => child.kill('SIGTERM'), 15000);
  const force = setTimeout(() => child.kill('SIGKILL'), 17000);
  const done = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr })).finally(() => { clearTimeout(deadline); clearTimeout(force); });
  return { child, done, waitFor(text) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`Missing ${JSON.stringify(text)}: ${stdout}\n${stderr}`)); }, 5000);
      const check = () => { if (stdout.includes(text)) { clearTimeout(timer); waiters.delete(check); resolve(); } };
      waiters.add(check); check();
    });
  } };
}

test('installed package command and recovery workflows', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cli-workflows-'));
  const home = path.join(directory, 'state'), userHome = path.join(directory, 'user'), bin = path.join(directory, 'bin');
  const env = { ...process.env, HOME: userHome, USERPROFILE: userHome, APP_HOME: home, KORUS_HOME: '', APP_BACKEND_SOCKET: '',
    PATH: bin, CODEX_HOME: '', CLAUDE_CONFIG_DIR: '', GEMINI_HOME: '', KORUS_APP_PATH: path.join(directory, 'NoApp.app'), NO_COLOR: '1' };
  const children = new Set();
  let cli;
  const launch = (args, overrides = {}) => {
    const child = spawn(process.execPath, [cli, '--timeout', '2500', ...args], { cwd: directory, env: { ...env, ...overrides }, stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child); child.once('close', () => children.delete(child)); return processOutput(child);
  };
  const run = async (args, overrides) => { const child = launch(args, overrides); child.child.stdin.end(); return child.done; };
  const save = (file, data) => writeFile(path.join(home, file), JSON.stringify({ schemaVersion: file === 'roster.json' ? 4 : 1, data }));
  try {
    const target = await buildCli({ outdir: path.join(directory, 'package') });
    const npmCli = process.env.npm_execpath;
    const npm = args => exec(npmCli ? process.execPath : 'npm', [...(npmCli ? [npmCli] : []), ...args], { cwd: directory });
    const packed = JSON.parse((await npm(['pack', target, '--ignore-scripts', '--json'])).stdout)[0];
    await npm(['install', '--global', '--prefix', path.join(directory, 'installed'), '--ignore-scripts', '--no-audit', '--no-fund', path.join(directory, packed.filename)]);
    cli = path.join(directory, 'installed', ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', product.cliPackageName, 'cli.mjs');
    await mkdir(bin); await mkdir(userHome);

    await t.test('help, invalid invocations and fresh-install empty results', async () => {
      for (const args of [[], ['--help'], ['--version'], ...['doctor', 'triage', 'backend', 'logs', 'support', 'agents', 'missions'].map(command => [command, '--help'])]) assert.equal((await run(args)).code, 0, args.join(' '));
      for (const args of [['doctor', 'extra'], ['logs', 'extra'], ['agents', 'list', 'extra'], ['missions', 'show'], ['missions', 'list', 'extra'], ['backend', 'stop', 'extra'], ['support', 'bundle', 'extra'], ['doctor', '--follow'], ['logs', '--no-launch'], ['agents', 'list', '--yes'], ['triage', '--agent', 'unknown'], ['unknown']]) {
        const result = await run(args); assert.equal(result.code, 2, `${args.join(' ')}: ${result.stderr}`); assert.ok(result.stderr.trim());
      }
      for (const command of ['agents', 'missions']) { const result = await run([command, 'list']); assert.equal(result.code, 0); assert.match(result.stdout, /No (agents|missions) found\./); }
      assert.equal((await readdir(directory)).includes('state'), false);
    });

    await mkdir(home, { recursive: true });
    await save('roster.json', { agents: [], missions: [] }); await save('settings.json', { settings: {} });
    await t.test('a closed output pipe exits cleanly', async () => {
      const closed = launch(['--help']); closed.child.stdout.destroy();
      const result = await closed.done; assert.equal(result.code, 0); assert.doesNotMatch(result.stderr, /EPIPE|Unhandled|at Socket/);
    });

    await t.test('doctor, empty lists, missing Missions and corrupt-state exit codes', async () => {
      assert.equal((await run(['doctor'])).code, 0);
      for (const command of ['agents', 'missions']) { const result = await run([command, 'list']); assert.equal(result.code, 0); assert.match(result.stdout, /No (agents|missions) found\./); }
      assert.equal((await run(['missions', 'show', 'missing'])).code, 1);
      await save('roster.json', { agents: [{ id: 'one', name: 'Builder', engine: { kind: 'codex', session: { threadId: 'PRIVATE_THREAD' } }, status: { type: 'idle' } }],
        missions: [{ id: 'mission-one', outcome: 'Ship checkout', stage: 'implementation', artifacts: { tickets: [{ title: 'Checkout', done: true }] } }] });
      const agents = await run(['agents', 'list']); assert.match(agents.stdout, /Builder/); assert.doesNotMatch(agents.stdout, /PRIVATE_THREAD/);
      assert.match((await run(['missions', 'list'])).stdout, /Ship checkout.*1\/1/);
      const mission = await run(['missions', 'show', 'mission-one', '--json']); assert.equal(mission.code, 0); assert.equal(JSON.parse(mission.stdout).mission.outcome, 'Ship checkout');
      await save('roster.json', { agents: [], missions: [] });
      await writeFile(path.join(home, 'settings.json'), '{"secret":"PRIVATE_SETTINGS"');
      const failed = await run(['doctor', '--json']); assert.equal(failed.code, 1); assert.doesNotMatch(failed.stdout + failed.stderr, /PRIVATE_SETTINGS/);
      await save('settings.json', { settings: {} });
    });

    await t.test('rejects malformed saved roster data without pretending it is empty', async () => {
      await save('roster.json', { agents: [], missions: {} });
      assert.equal((await run(['missions', 'list', '--offline'])).code, 1);
      assert.equal((await run(['doctor', '--json'])).code, 1);
      await save('roster.json', { agents: [], missions: [] });
    });

    if (process.platform !== 'win32' && process.getuid?.() !== 0) await t.test('unreadable state and logs are errors, not empty results', async () => {
      const locked = path.join(directory, 'locked'); await mkdir(path.join(locked, 'state'), { recursive: true }); await chmod(locked, 0);
      try { for (const args of [['agents', 'list'], ['doctor']]) assert.equal((await run([...args, '--home', path.join(locked, 'state')])).code, 1); }
      finally { await chmod(locked, 0o700); }
      await mkdir(path.join(home, 'logs'), { recursive: true }); await chmod(path.join(home, 'logs'), 0);
      try { assert.equal((await run(['logs'])).code, 1); } finally { await chmod(path.join(home, 'logs'), 0o700); }
    });

    await t.test('socket, unreachable socket and desktop MCP modes', async () => {
      assert.equal(JSON.parse((await run(['backend', '--json'])).stdout).running, false);
      const server = net.createServer(socket => socket.on('data', data => { const request = JSON.parse(data.toString()); socket.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'snapshot/get' ? { snapshot: { agents: [], missions: [] } } : { ok: true, version: 'test' } }) + '\n'); }));
      const socket = path.join(directory, 'daemon.sock'); await new Promise(resolve => server.listen(socket, resolve));
      try {
        assert.equal(JSON.parse((await run(['backend', '--socket', socket, '--json'])).stdout).transport, 'socket');
        for (const command of ['agents', 'missions']) assert.equal(JSON.parse((await run([command, 'list', '--socket', socket, '--json'])).stdout).source, 'live');
      }
      finally { await new Promise(resolve => server.close(resolve)); }
      await mkdir(path.join(home, 'logs'), { recursive: true });
      const mcp = http.createServer((_req, res) => { res.writeHead(405); res.end(); }); await new Promise(resolve => mcp.listen(0, '127.0.0.1', resolve));
      try {
        await writeFile(path.join(home, 'logs', 'daemon.log'), JSON.stringify({ area: 'mcp-http', msg: 'listening', url: `http://127.0.0.1:${mcp.address().port}/mcp` }) + '\n');
        assert.equal(JSON.parse((await run(['backend', '--json'])).stdout).transport, 'mcp');
      } finally { await new Promise(resolve => mcp.close(resolve)); }
    });

    if (process.platform !== 'win32') await t.test('real provider auth, triage priority and provider exit codes', async () => {
      for (const [id, name] of [['claude', 'claude'], ['codex', 'codex'], ['antigravity', 'agy']]) {
        const code = `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); const signed=process.env['TEST_AUTH_${id}']!=='no';
if(process.env.TEST_HANG && ['auth','login','models'].includes(args[0])){setInterval(()=>{},1000);return;}
if(args[0]==='--version'){console.log('test 1.2.3');process.exit(0)}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:signed,email:'PRIVATE_ACCOUNT'}));process.exit(signed?0:1)}
if(args[0]==='login'){console.error(signed?'Logged in using ChatGPT':'Not logged in');process.exit(signed?0:1)}
if(args[0]==='models'){if(signed)console.log('gemini-test\\tTest');process.exit(signed?0:1)}
fs.writeFileSync(process.env.TEST_CAPTURE,JSON.stringify({id:'${id}',args,pid:process.pid,home:process.env.${id === 'claude' ? 'CLAUDE_CONFIG_DIR' : id === 'codex' ? 'CODEX_HOME' : 'GEMINI_HOME'}}));if(process.env.TEST_LONG){console.log('CLIENT_RUNNING');setInterval(()=>{},1000)}else process.exit(7);\n`;
        await writeFile(path.join(bin, name), code); await chmod(path.join(bin, name), 0o755);
      }
      const homes = Object.fromEntries(['claude', 'codex', 'antigravity'].map(id => [id, { homePath: path.join(home, `${id}-home`), isolated: true }]));
      await save('settings.json', { settings: { providerHomes: homes } });
      const doctor = await run(['doctor', '--json'], { TEST_AUTH_claude: 'no', TEST_AUTH_codex: 'no' });
      assert.equal(doctor.code, 0); assert.deepEqual(JSON.parse(doctor.stdout).providers.map(p => p.auth), ['signed-out', 'signed-out', 'authenticated'], doctor.stdout); assert.doesNotMatch(doctor.stdout, /PRIVATE_ACCOUNT/);
      const capture = path.join(directory, 'provider.json');
      for (const [selected, auth] of [['claude', {}], ['codex', { TEST_AUTH_claude: 'no' }], ['antigravity', { TEST_AUTH_claude: 'no', TEST_AUTH_codex: 'no' }]]) {
        assert.equal((await run(['triage', 'test problem', '--model', 'model with spaces'], { TEST_CAPTURE: capture, ...auth })).code, 7);
        const launched = JSON.parse(await readFile(capture, 'utf8')); assert.equal(launched.id, selected); assert.equal(launched.home, homes[selected].homePath); assert.ok(launched.args.includes('model with spaces'));
      }
      const hung = await run(['doctor', '--json', '--timeout', '50'], { TEST_HANG: '1' });
      assert.equal(hung.code, 0); assert.ok(JSON.parse(hung.stdout).providers.every(provider => provider.auth === 'unknown'));
      const active = launch(['triage'], { TEST_CAPTURE: capture, TEST_LONG: '1' });
      try {
        await active.waitFor('CLIENT_RUNNING'); const pid = JSON.parse(await readFile(capture, 'utf8')).pid;
        active.child.kill('SIGTERM'); assert.equal((await active.done).code, 143);
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      } finally { active.child.kill('SIGKILL'); }
      const rejected = await run(['triage', '--agent', 'codex'], { TEST_AUTH_codex: 'no' }); assert.equal(rejected.code, 1); assert.doesNotMatch(rejected.stdout + rejected.stderr, /PRIVATE_ACCOUNT/);
      const prepared = await run(['triage', '--no-launch', '--json']); assert.equal(prepared.code, 0); assert.match(await readFile(JSON.parse(prepared.stdout).promptPath, 'utf8'), /approval/);
    });

    await t.test('support bundles and finite log output preserve privacy', async () => {
      const log = path.join(home, 'logs', 'daemon.log');
      await writeFile(log, JSON.stringify({ time: new Date().toISOString(), msg: 'test diagnostic', token: 'PRIVATE_TOKEN', content: 'PRIVATE_CONVERSATION' }) + '\n');
      const logs = await run(['logs', '--json']); assert.equal(logs.code, 0); assert.doesNotMatch(logs.stdout, /PRIVATE_TOKEN|PRIVATE_CONVERSATION/);
      for (const args of [[], ['--include-logs']]) {
        const result = await run(['support', 'bundle', '--json', ...args]); assert.equal(result.code, 0);
        const bundle = JSON.parse(result.stdout).directory;
        for (const file of await readdir(bundle)) assert.doesNotMatch(await readFile(path.join(bundle, file), 'utf8'), /PRIVATE_TOKEN|PRIVATE_CONVERSATION/);
      }
    });

    await t.test('piped JSON following, complete records, rotation and SIGINT', async () => {
      const log = path.join(home, 'logs', 'daemon.log'); await writeFile(log, '');
      const following = launch(['logs', '--follow', '--json', '--since', '1m']);
      try {
        await following.waitFor('following');
        await writeFile(log, JSON.stringify({ time: '2000-01-01T00:00:00Z', msg: 'OLD_ROW' }) + '\n' + '{"time":"' + new Date().toISOString() + '","msg":"NEW_ROW","token":"PRIVATE_');
        await writeFile(log, 'TOKEN"}\n', { flag: 'a' });
        await following.waitFor('NEW_ROW');
        await rename(log, log + '.old'); await writeFile(log, JSON.stringify({ time: new Date().toISOString(), msg: 'ROTATED_ROW' }) + '\n');
        await following.waitFor('ROTATED_ROW'); following.child.kill('SIGINT');
        const result = await following.done; assert.equal(result.code, 130); assert.doesNotMatch(result.stdout, /OLD_ROW|PRIVATE_TOKEN/);
        for (const line of result.stdout.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
      } finally { following.child.kill('SIGKILL'); }
      const terminated = launch(['logs', '--follow', '--json']);
      try { await terminated.waitFor('following'); terminated.child.kill('SIGTERM'); assert.equal((await terminated.done).code, 143); }
      finally { terminated.child.kill('SIGKILL'); }
    });

    if (process.platform === 'darwin') await t.test('background control, declined confirmation and terminal cancellation', async () => {
      const launchAgents = path.join(userHome, 'Library', 'LaunchAgents'); await mkdir(launchAgents, { recursive: true });
      const file = path.join(launchAgents, `${product.appId}.daemon.plist`), capture = path.join(directory, 'launchctl.jsonl');
      const command = path.join(bin, 'launchctl');
      await writeFile(command, `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.TEST_CONTROL,JSON.stringify(process.argv.slice(2))+'\\n');if(process.argv[2]==='print'&&process.env.TEST_LOADED==='no')process.exit(1);\n`); await chmod(command, 0o755);
      for (const action of ['start', 'restart', 'stop']) assert.equal((await run(['backend', action])).code, 1);
      await writeFile(file, `<plist><key>APP_HOME</key><string>${home}</string></plist>`);
      assert.equal((await run(['backend', 'restart'])).code, 2);
      for (const action of ['start', 'restart', 'stop']) assert.equal((await run(['backend', action, '--yes'], { TEST_CONTROL: capture, TEST_LOADED: action === 'start' ? 'no' : 'yes' })).code, 0);
      const controls = await readFile(capture, 'utf8'); assert.match(controls, /kickstart/); assert.match(controls, /bootout/); assert.match(controls, /bootstrap/);
      await writeFile(file, '<plist><key>APP_HOME</key><string>/another-installation</string></plist>');
      assert.equal((await run(['backend', 'stop', '--yes'], { TEST_CONTROL: capture })).code, 1);
      assert.equal(await readFile(capture, 'utf8'), controls);
      await writeFile(file, `<plist><key>APP_HOME</key><string>${home}</string></plist>`);
      const python = (await exec('python3', ['-c', 'import sys; print(sys.executable)'])).stdout.trim();
      const pty = `import os, pty, sys, select, signal
pid, fd = pty.fork()
if pid == 0: os.execve(sys.argv[1], sys.argv[1:], os.environ)
signal.signal(signal.SIGTERM, lambda *_: os.kill(pid, signal.SIGTERM))
inputs = [fd, 0]
while True:
    ready, _, _ = select.select(inputs, [], [])
    if fd in ready:
        try: data = os.read(fd, 65536)
        except OSError: break
        if not data: break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if data: os.write(fd, data)
        else: inputs.remove(0)
_, status = os.waitpid(pid, 0)
code = os.waitstatus_to_exitcode(status)
sys.exit(code if code >= 0 else 128 - code)
`;
      const terminal = () => processOutput(spawn(python, ['-c', pty, process.execPath, cli, 'backend', 'stop'], { env: { ...env, TEST_CONTROL: capture, TERM: 'xterm' }, stdio: ['pipe', 'pipe', 'pipe'] }));
      for (const [input, expected] of [['no\n', 0], ['\u0003', 130], ['\u0004', 130]]) {
        const child = terminal(); children.add(child.child);
        try { await child.waitFor('[y/N]'); child.child.stdin.write(input); const result = await child.done; assert.equal(result.code, expected, result.stdout + result.stderr); assert.doesNotMatch(result.stdout, /AbortError|stack/); }
        finally { child.child.kill('SIGTERM'); await child.done; children.delete(child.child); }
      }
      assert.equal(await readFile(capture, 'utf8'), controls);
      const approved = terminal(); children.add(approved.child);
      try { await approved.waitFor('[y/N]'); approved.child.stdin.write('yes\n'); assert.equal((await approved.done).code, 0); }
      finally { approved.child.kill('SIGTERM'); await approved.done; children.delete(approved.child); }
      assert.equal((await readFile(capture, 'utf8')).trim().split('\n').length, controls.trim().split('\n').length + 1);
      const doctor = processOutput(spawn(python, ['-c', pty, process.execPath, cli, 'doctor'], { env: { ...env, TERM: 'xterm', TEST_HANG: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }));
      children.add(doctor.child);
      try {
        await doctor.waitFor('Checking Codex authentication'); doctor.child.stdin.write('\u0003');
        const result = await doctor.done; assert.equal(result.code, 130); assert.match(result.stdout, /Cancelled/); assert.doesNotMatch(result.stdout, /AbortError|at runCli/);
      } finally { doctor.child.kill('SIGTERM'); await doctor.done; children.delete(doctor.child); }

    });
  } finally { for (const child of children) child.kill('SIGKILL'); await rm(directory, { recursive: true, force: true }); }
});
