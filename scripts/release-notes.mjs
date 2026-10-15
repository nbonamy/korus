import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const RELEASE_NOTES_PATH = 'vue/src/generated/release-notes.json';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function extractReleaseSections(changelog) {
  changelog = changelog.replaceAll('\r\n', '\n');
  const headingPattern = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm;
  const matches = [...changelog.matchAll(headingPattern)];

  return matches.map((match, index) => {
    const version = match[1];
    const releasedAt = match[2];
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? changelog.length;
    const markdown = changelog.slice(bodyStart, bodyEnd).trim();
    if (!markdown) {
      throw new Error(`CHANGELOG.md release ${version} has no release notes.`);
    }

    return {
      version,
      releasedAt,
      sourceSha256: createHash('sha256').update(markdown).digest('hex'),
      markdown,
    };
  });
}

export function assertVersionConsistency({ rootPackage, workspaces, lockfile }) {
  const version = rootPackage.version;
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error('The root package.json must declare a version.');
  }

  for (const workspace of workspaces) {
    if (workspace.manifest.version !== version) {
      throw new Error(`${workspace.path} version ${workspace.manifest.version ?? '(missing)'} does not match root version ${version}.`);
    }
    const sharedVersion = workspace.manifest.dependencies?.['@workspace/core'];
    if (sharedVersion !== undefined && sharedVersion !== version) {
      throw new Error(`${workspace.path} depends on @workspace/core ${sharedVersion}, expected ${version}.`);
    }
  }

  if (lockfile.version !== version || lockfile.packages?.['']?.version !== version) {
    throw new Error(`package-lock.json root version does not match ${version}. Run npm install after bumping versions.`);
  }
  for (const workspace of workspaces) {
    const lockManifest = lockfile.packages?.[workspace.path.replace('/package.json', '')];
    if (lockManifest?.version !== version) {
      throw new Error(`package-lock.json entry for ${workspace.path} does not match ${version}. Run npm install after bumping versions.`);
    }
    const sharedVersion = lockManifest?.dependencies?.['@workspace/core'];
    if (sharedVersion !== undefined && sharedVersion !== version) {
      throw new Error(`package-lock.json entry for ${workspace.path} depends on @workspace/core ${sharedVersion}, expected ${version}.`);
    }
  }

  return version;
}

export function createReleaseNotes({ version, changelog }) {
  const releases = extractReleaseSections(changelog);
  if (!releases.some((release) => release.version === version)) {
    throw new Error(`CHANGELOG.md must contain a release heading for ${version}: ## [${version}] - YYYY-MM-DD`);
  }

  return {
    schemaVersion: 2,
    currentVersion: version,
    releases,
  };
}

export function serializeReleaseNotes(releaseNotes) {
  return `${JSON.stringify(releaseNotes, null, 2)}\n`;
}

export function expectedReleaseNotes(rootDir = ROOT) {
  const rootPackage = readJson(path.join(rootDir, 'package.json'));
  const workspaces = rootPackage.workspaces.map((workspace) => `${workspace}/package.json`).map((relativePath) => ({
    path: relativePath,
    manifest: readJson(path.join(rootDir, relativePath)),
  }));
  const version = assertVersionConsistency({
    rootPackage,
    workspaces,
    lockfile: readJson(path.join(rootDir, 'package-lock.json')),
  });
  const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
  return serializeReleaseNotes(createReleaseNotes({ version, changelog }));
}

export function generateReleaseNotes(rootDir = ROOT) {
  const outputPath = path.join(rootDir, RELEASE_NOTES_PATH);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, expectedReleaseNotes(rootDir));
  return outputPath;
}

export function assertReleaseNotesCurrent(actual, expected) {
  if (actual.replaceAll('\r\n', '\n') !== expected.replaceAll('\r\n', '\n')) {
    throw new Error(`${RELEASE_NOTES_PATH} is stale. Run npm run release-notes:generate and review the result.`);
  }
}

export function checkReleaseNotes(rootDir = ROOT) {
  const outputPath = path.join(rootDir, RELEASE_NOTES_PATH);
  if (!fs.existsSync(outputPath)) {
    throw new Error(`Missing ${RELEASE_NOTES_PATH}. Run npm run release-notes:generate.`);
  }
  const expected = expectedReleaseNotes(rootDir);
  const actual = fs.readFileSync(outputPath, 'utf8');
  assertReleaseNotesCurrent(actual, expected);
  return outputPath;
}

function isMainModule() {
  return process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;
}

if (isMainModule()) {
  const mode = process.argv[2] ?? 'check';
  if (mode === 'generate') {
    const outputPath = generateReleaseNotes();
    console.log(`Generated ${path.relative(ROOT, outputPath)}.`);
  } else if (mode === 'check') {
    const outputPath = checkReleaseNotes();
    console.log(`Verified ${path.relative(ROOT, outputPath)} against package version and CHANGELOG.md.`);
  } else {
    throw new Error(`Unknown release-notes mode: ${mode}. Use generate or check.`);
  }
}
