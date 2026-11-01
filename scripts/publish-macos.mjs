import product from '../core/src/product.json' with { type: 'json' };
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const HOST = process.env.APP_UPDATE_PUBLISH_HOST;
const REMOTE_ROOT = process.env.APP_UPDATE_REMOTE_ROOT ?? product.deploymentRoot;
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const desktopVersion = packageJson.version;
const REMOTE_RELEASE_MANIFEST = `${REMOTE_ROOT}/releases/darwin/arm64/RELEASES.json`;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function parsePublishedManifest(rawManifest) {
  const trimmed = String(rawManifest ?? '').trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

export function assertVersionNotAlreadyPublished({ currentVersion, publishedManifest }) {
  if (publishedManifest?.currentRelease === currentVersion) {
    throw new Error(`${product.name} version ${currentVersion} is already published. Bump the root package version before publishing.`);
  }
}

export function readPublishedManifest({
  execFileSyncImpl = execFileSync,
  host = HOST,
  remoteManifest = REMOTE_RELEASE_MANIFEST,
} = {}) {
  if (!host) throw new Error('Set APP_UPDATE_PUBLISH_HOST to the operator SSH host.');
  const remoteCommand = `test -f ${shellQuote(remoteManifest)} && cat ${shellQuote(remoteManifest)} || true`;
  return parsePublishedManifest(execFileSyncImpl('ssh', [host, remoteCommand], { encoding: 'utf8' }));
}

export function checkPublishedVersion({
  currentVersion = desktopVersion,
  execFileSyncImpl = execFileSync,
  host = HOST,
  remoteManifest = REMOTE_RELEASE_MANIFEST,
} = {}) {
  const publishedManifest = readPublishedManifest({ execFileSyncImpl, host, remoteManifest });
  assertVersionNotAlreadyPublished({ currentVersion, publishedManifest });
  if (publishedManifest?.currentRelease) {
    console.log(`Latest published ${product.name} version is ${publishedManifest.currentRelease}; local version is ${currentVersion}.`);
  } else {
    console.log(`No published ${product.name} version found at ${host}:${remoteManifest}; local version is ${currentVersion}.`);
  }
}

function isMainModule() {
  return process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;
}

if (isMainModule()) {
  if (process.argv.includes('--check-only')) checkPublishedVersion();
  else throw new Error('Local publication is retired. Use npm run prerelease or npm run latest.');
}
