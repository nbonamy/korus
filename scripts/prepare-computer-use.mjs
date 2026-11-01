import product from '../core/src/product.json' with { type: 'json' };
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });
const configPath = path.join(rootDir, 'computer-use-release.json');
const electronDir = path.join(rootDir, 'client/electron');
const iconPath = path.join(electronDir, 'assets', 'icon.icns');
const outputDir = path.join(electronDir, '.computer-use');
const sourceBuildScript = path.resolve(rootDir, '..', 'computer-use', 'macos', 'scripts', 'build-app.sh');

if (process.platform !== 'darwin') {
  console.log(`[prepare-computer-use] skipping macOS-only helper on ${process.platform}/${process.arch}`);
  process.exit(0);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.arch !== 'arm64') {
  throw new Error('The published Computer Use helper supports macOS ARM64 only; Intel desktop releases are deferred.');
}

function localBuild() {
  run('bash', [
    sourceBuildScript,
    '--app-name', `${product.name} Computer Use`,
    '--bundle-identifier', `${product.appId}.computer-use`,
    '--icon', iconPath,
    '--output', outputDir,
  ]);
}

function releaseBuild() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const version = process.env.COMPUTER_USE_VERSION || config.version;
  const sha256 = (process.env.COMPUTER_USE_SHA256 || config.sha256).toLowerCase();
  const repository = process.env.COMPUTER_USE_REPOSITORY || config.repository;
  if (!/^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Invalid Computer Use release version.');
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error('Computer Use release checksum must be a SHA-256 digest.');
  }

  const archiveName = 'computer-use-pilot-macos-arm64-' + version + '.tar.gz';
  const cacheDir = path.join(electronDir, '.computer-use-artifacts', version);
  const archivePath = path.join(cacheDir, archiveName);
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(archivePath)) {
    const url = 'https://github.com/' + repository + '/releases/download/v' + version + '/' + archiveName;
    console.log('Downloading Computer Use ' + version + ' release artifact...');
    run('curl', ['--fail', '--location', '--retry', '3', '--output', archivePath, url]);
  }

  const actualSha256 = execFileSync('shasum', ['-a', '256', archivePath], { encoding: 'utf8' }).trim().split(/\s+/)[0];
  if (actualSha256 !== sha256) {
    throw new Error('Computer Use release checksum mismatch for ' + archiveName + '.');
  }
  const extractDir = fs.mkdtempSync(path.join(cacheDir, 'extract-'));
  try {
    run('tar', ['-xzf', archivePath, '-C', extractDir]);
    const extractedRoot = path.join(extractDir, 'computer-use-pilot-macos-arm64-' + version);
    run('bash', [
      path.join(extractedRoot, 'scripts', 'package-app.sh'),
      '--app-name', `${product.name} Computer Use`,
      '--bundle-identifier', `${product.appId}.computer-use`,
      '--icon', iconPath,
      '--binary', path.join(extractedRoot, 'bin', 'computer-use-pilot'),
      '--resource-dir', path.join(extractedRoot, 'Resources'),
      '--output', outputDir,
    ]);
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

if (process.argv.includes('--local') || process.env.COMPUTER_USE_LOCAL === '1') {
  localBuild();
} else if (process.argv.includes('--release')) {
  releaseBuild();
} else {
  releaseBuild();
}
