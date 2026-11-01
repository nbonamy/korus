import product from '../core/src/product.json' with { type: 'json' };
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const skipMacSigning = Boolean(process.env.TEST) || process.env.APP_SKIP_SIGNING === '1';

function run(command, args) {
  if (command === 'npm') {
    if (!process.env.npm_execpath) throw new Error('Run this build through npm run build.');
    args = [process.env.npm_execpath, ...args];
    command = process.execPath;
  }
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function requireReleaseSigningConfiguration() {
  if (process.platform !== 'darwin' || skipMacSigning) {
    return;
  }

  const required = ['IDENTITY_DARWIN_CODE', 'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`A signed macOS build requires: ${missing.join(', ')}. Set APP_SKIP_SIGNING=1 only for an unsigned local build.`);
  }
}

function findPackagedApp() {
  const outDirectory = path.resolve('client/electron/out');
  const appDirectory = fs.readdirSync(outDirectory, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.startsWith(`${product.name}-darwin-`));
  if (!appDirectory) {
    throw new Error(`Could not find a packaged macOS app in ${outDirectory}.`);
  }

  const appPath = path.join(outDirectory, appDirectory.name, `${product.name}.app`);
  if (!fs.existsSync(appPath)) {
    throw new Error(`Could not find the packaged app at ${appPath}.`);
  }
  return appPath;
}

function verifyMacBuild() {
  if (process.platform !== 'darwin' || skipMacSigning) {
    return;
  }

  const appPath = findPackagedApp();
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
}

requireReleaseSigningConfiguration();
run('npm', ['run', 'build:backend']);
run('npm', ['run', 'build', '-w', '@workspace/electron']);
verifyMacBuild();
