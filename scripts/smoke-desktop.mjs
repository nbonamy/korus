import mobileRelease from '../mobile-simulator-release.json' with { type: 'json' };
import { checkPackagedMobileSimulator } from './mobile-simulator-check.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import product from '../core/src/product.json' with { type: 'json' };
import nodeRelease from '../node-runtime-release.json' with { type: 'json' };
import { checkPackagedDaemon } from './packaged-daemon-check.mjs';

const root = path.resolve(import.meta.dirname, '..');
const app = path.join(root, 'electron/out', `${product.name}-${process.platform}-${process.arch}`);
const resources = process.platform === 'darwin' ? path.join(app, `${product.name}.app/Contents/Resources`) : path.join(app, 'resources');
const node = path.join(resources, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'app-smoke-'));
const env = { ...process.env, PATH: path.dirname(node), NODE_OPTIONS: '', HOME: home, USERPROFILE: home,
  APP_HOME: home, CODEX_HOME: path.join(home, 'codex'), CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
  APP_ASSETS_PATH: resources, APP_CLAUDE_COMMAND: '',
  ...(process.platform !== 'win32' ? { SHELL: '/usr/bin/false' } : {}) };
fs.mkdirSync(env.CODEX_HOME);
try {
  const nodeVersion = execFileSync(node, ['--version'], { env, encoding: 'utf8' }).trim();
  if (nodeVersion !== `v${nodeRelease.version}`) throw new Error('Incorrect bundled Node version.');
  const daemonVersion = execFileSync(node, [path.join(resources, 'daemon', product.daemonName), '--version'], { env, encoding: 'utf8', timeout: 30_000 }).trim();
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (!daemonVersion.includes(version)) throw new Error('Incorrect bundled daemon version.');
  if (fs.existsSync(path.join(resources, 'codex'))) throw new Error('Desktop package must not contain a bundled Codex runtime.');
  const claude = path.join(resources, 'claude', process.platform === 'win32' ? 'claude.exe' : 'claude');
  const claudeRelease = JSON.parse(fs.readFileSync(path.join(resources, 'claude/release.json'), 'utf8'));
  const claudeVersion = execFileSync(claude, ['--version'], { env, encoding: 'utf8', timeout: 30_000 }).trim();
  if (claudeVersion !== `${claudeRelease.version} (Claude Code)`) throw new Error('Incorrect bundled Claude runtime version.');
  await checkPackagedDaemon(node, path.join(resources, 'daemon', product.daemonName), env, version, { requireClaude: true });
  if (process.platform === 'darwin' && process.arch === mobileRelease.arch) checkPackagedMobileSimulator(resources, mobileRelease, env);
  if (process.platform === 'darwin' && process.env.APP_SKIP_SIGNING !== '1') {
    const bundle = path.join(app, `${product.name}.app`);
    execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
    execFileSync('spctl', ['--assess', '--type', 'execute', bundle], { stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'validate', bundle], { stdio: 'inherit' });
  }
  console.log(`Packaged Node, Claude runtime, daemon health and provider detection passed on ${process.platform}/${process.arch}.`);
} finally { fs.rmSync(home, { recursive: true, force: true }); }
