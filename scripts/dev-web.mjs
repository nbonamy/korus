import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendBundle = path.join(rootDir, 'backend/dist/daemon.mjs');
const serverBundle = path.join(rootDir, 'web/dist/server/index.js');
const children = new Set();
let shuttingDown = false;

// Same contract as `npm run dev`: published SDK packages by default, sibling
// source (with HMR) when CODEX_APP_SDK_SOURCE=1.

if (process.argv.includes('--help')) {
  console.log('Usage: npm run dev:web');
  console.log('Builds daemon once, watches the web server bundle (restarting it on change) and serves the client from Vite with HMR.');
  console.log('Env: WEB_DEV_PORT (client, default 5175), CODEX_APP_SDK_SOURCE=1 (link ../codex-app-sdk sources), APP_HOME (state directory).');
  process.exit(0);
}

const clientPort = Number(process.env.WEB_DEV_PORT ?? 5175);
const serverPort = await freePort();

await run('npm', ['run', 'build:sdk']);
await run('npm', ['run', 'build', '-w', '@workspace/backend']);

start('npm', ['run', 'dev:backend'], { name: 'backend-watch' });
start('npm', ['exec', '-w', '@workspace/web', '--', 'vite', 'build', '--watch', '--config', 'vite.server.config.ts'], { name: 'server-watch' });
await waitForFile(backendBundle);
await waitForFile(serverBundle);

// The server owns the daemon, so it restarts when either bundle changes. Watching
// the daemon bundle also recovers from spawning it while the watcher rewrites it.
const server = start(process.execPath, [
  '--watch-path', serverBundle,
  '--watch-path', backendBundle,
  '--watch-preserve-output',
  serverBundle,
], {
  name: 'server',
  env: { NODE_ENV: 'development', PORT: String(serverPort), HOST: '127.0.0.1' },
});
const client = start('npm', ['exec', '-w', '@workspace/web', '--', 'vite', '--host', '127.0.0.1', '--port', String(clientPort), '--strictPort'], {
  name: 'client',
  env: { NODE_ENV: 'development', WEB_DEV_SERVER_PORT: String(serverPort) },
});

for (const [name, child] of [['server', server], ['client', client]]) {
  child.on('exit', (code) => {
    if (!shuttingDown) shutdown(`${name} exited with code ${code ?? 'null'}`, code || 1);
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(signal));

function start(command, args, options) {
  // Use the npm CLI selected by the parent invocation so Windows needs no shell.
  const npmCli = command === 'npm' ? process.env.npm_execpath : undefined;
  const child = spawn(npmCli ? process.execPath : command, npmCli ? [npmCli, ...args] : args, {
    cwd: rootDir,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', (error) => {
    console.error(`[dev:web:${options.name}] ${error.message}`);
    shutdown(`${options.name} failed`, 1);
  });
  return child;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = start(command, args, { name: command });
    child.once('error', reject);
    child.once('exit', (code) => {
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  console.log(`[dev:web] stopping: ${reason}`);
  for (const child of children) child.kill();
  setTimeout(() => process.exit(exitCode), 250).unref();
}
