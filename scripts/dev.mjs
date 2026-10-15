import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendBundle = path.join(rootDir, 'backend/dist/daemon.mjs');
const children = new Set();
let shuttingDown = false;

// Published SDK packages are the default. Opt in to sibling source development
// explicitly with CODEX_APP_SDK_SOURCE=1.

if (process.argv.includes('--help')) {
  console.log('Usage: npm run dev');
  console.log('Builds daemon once, watches backend output, then starts Electron without restarting daemon on bundle changes.');
  process.exit(0);
}

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });
const sdkAssets = sdkAssetsPath();

await run('npm', ['run', 'build:computer-use']);
await run('npm', ['run', 'build:tts']);
await run('npm', ['run', 'prepare:mobile-simulator', '--', '--optional']);
await run('npm', ['run', 'build', '-w', '@workspace/backend']);

const backendWatch = start('npm', ['run', 'dev:backend'], {
  cwd: rootDir,
  name: 'backend-watch',
});

await waitForFile(backendBundle);

const electronDev = start('npm', ['run', 'start:electron'], {
  cwd: rootDir,
  name: 'electron',
  env: {
    NODE_ENV: 'development',
    APP_BACKEND_MODE: 'bundled',
    APP_BACKEND_COMMAND: process.execPath,
    APP_BACKEND_ARGS: `${backendBundle},--stdio`,
    APP_BACKEND_WATCH_FILE: '',
    APP_ASSETS_PATH: path.join(rootDir, 'electron', 'assets'),
    CODEX_APP_SDK_ASSETS_PATH: sdkAssets,
  },
});

function sdkAssetsPath() {
  if (process.env.CODEX_APP_SDK_SOURCE === '1') {
    // Match the selected checkout used by vite.sdk-aliases.ts.
    return path.resolve(rootDir, process.env.CODEX_APP_SDK_SOURCE_ROOT || '../codex-app-sdk', 'packages/backend/assets');
  }
  // SDK exports do not expose assets/package.json. Follow the backend
  // workspace's Node search order, supporting both nested and hoisted installs.
  const require = createRequire(path.join(rootDir, 'backend/package.json'));
  const packageName = '@codex-app-sdk/backend';
  const packageRoot = (require.resolve.paths(packageName) ?? [])
    .map((directory) => path.join(directory, packageName))
    .find((directory) => existsSync(path.join(directory, 'package.json')));
  if (!packageRoot) throw new Error(`Required dependency is missing: ${packageName}`);
  return path.join(packageRoot, 'assets');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

electronDev.on('exit', (code) => {
  if (!shuttingDown) {
    shutdown(`electron exited with code ${code ?? 'null'}`, code ?? 1);
  }
});

backendWatch.on('exit', (code) => {
  if (!shuttingDown) {
    shutdown(`backend watch exited with code ${code ?? 'null'}`, code || 1);
  }
});

function start(command, args, options) {
  // npm.cmd requires a shell on Windows. Use the CLI selected by the parent
  // npm invocation through Node, preserving arguments and paths with spaces.
  const npmCli = command === 'npm' ? process.env.npm_execpath : undefined;
  const child = spawn(npmCli ? process.execPath : command, npmCli ? [npmCli, ...args] : args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: 'inherit',
  });
  children.add(child);
  child.once('exit', () => {
    children.delete(child);
  });
  child.once('error', (error) => {
    console.error(`[dev:${options.name}] ${error.message}`);
    shutdown(`${options.name} failed`, 1);
  });
  return child;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = start(command, args, { cwd: rootDir, name: command });
    child.once('error', reject);
    child.once('exit', (code) => {
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function shutdown(reason, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  process.exitCode = exitCode;
  console.log(`[dev] stopping: ${reason}`);
  for (const child of children) {
    child.kill();
  }
  setTimeout(() => process.exit(exitCode), 250).unref();
}
