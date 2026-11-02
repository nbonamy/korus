import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import product from '../core/src/product.json' with { type: 'json' };

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  return result.stdout.trim();
}

function generate() {
  const { workspaces } = JSON.parse(readFileSync('package.json', 'utf8'));
  if (!Array.isArray(workspaces) || !workspaces.length) throw new Error('No declared workspaces.');
  let total = 0;
  let covered = 0;
  for (const workspace of workspaces) {
    const file = path.join(workspace, 'coverage/coverage-final.json');
    const report = JSON.parse(readFileSync(file, 'utf8'));
    let statements = 0;
    for (const entry of Object.values(report)) {
      if (!entry?.s || typeof entry.s !== 'object') throw new Error(`Invalid statement coverage: ${file}`);
      for (const count of Object.values(entry.s)) {
        if (!Number.isFinite(count) || count < 0) throw new Error(`Invalid statement count: ${file}`);
        statements++;
        if (count > 0) covered++;
      }
    }
    if (!statements) throw new Error(`Empty statement coverage: ${file}`);
    total += statements;
  }
  const percent = covered / total * 100;
  const badge = { schemaVersion: 1, label: 'statement coverage', message: `${percent.toFixed(1)}%`,
    color: percent >= 90 ? 'brightgreen' : percent >= 85 ? 'green' : 'red' };
  mkdirSync('coverage', { recursive: true });
  writeFileSync('coverage/badge.json', `${JSON.stringify(badge, null, 2)}\n`);
  console.log(`Statement coverage: ${covered}/${total} (${badge.message})`);
}

export async function collectDownloads({ repository = product.repository, fetchImpl = fetch } = {}) {
  let total = 0;
  for (let page = 1; ; page++) {
    const url = new URL(`https://api.github.com/repos/${repository}/releases`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const token = process.env.GH_TOKEN;
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Release downloads request failed (HTTP ${response.status}).`);
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('Invalid releases response.');
    for (const release of releases) {
      if (release.draft) continue;
      if (!Array.isArray(release.assets)) throw new Error('Missing release assets.');
      for (const asset of release.assets) {
        if (typeof asset.name !== 'string') throw new Error('Missing asset name.');
        if (!/\.(dmg|exe|zip|deb|rpm|nupkg)$/i.test(asset.name)) continue;
        if (!Number.isSafeInteger(asset.download_count) || asset.download_count < 0)
          throw new Error('Invalid package download count.');
        total += asset.download_count;
        if (!Number.isSafeInteger(total)) throw new Error('Package download total exceeds safe integer range.');
      }
    }
    if (releases.length < 100) break;
  }
  return { schemaVersion: 1, label: 'package downloads', message: new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(total), color: 'orange' };
}

function publish(kind, file, sourceSha) {
  if (!['coverage', 'downloads'].includes(kind) || !file || !/^[a-f0-9]{40}$/.test(sourceSha ?? ''))
    throw new Error('Usage: badges.mjs publish <coverage|downloads> <badge.json> <source SHA>');
  const content = readFileSync(file, 'utf8');
  const badge = JSON.parse(content);
  const valid = kind === 'coverage'
    ? badge.label === 'statement coverage' && /^\d+\.\d%$/.test(badge.message) && ['brightgreen', 'green', 'red'].includes(badge.color)
    : badge.label === 'package downloads' && /^(?:\d+|\d+(?:\.\d)?[KMBT])$/.test(badge.message) && badge.color === 'orange';
  if (badge.schemaVersion !== 1 || !valid) throw new Error(`Invalid ${kind} badge.`);
  if (git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0] !== sourceSha) {
    console.log('Skipping stale badge result; main has advanced.');
    return;
  }
  // Run in the disposable CI checkout: preserve the other badge files on this branch.
  if (git('ls-remote', 'origin', 'refs/heads/badges')) {
    git('fetch', '--depth=1', 'origin', 'refs/heads/badges');
    git('switch', '--detach', 'FETCH_HEAD');
  } else {
    git('switch', '--orphan', 'badges');
  }
  const target = `${kind}.json`;
  writeFileSync(target, content);
  git('add', target);
  if (!git('diff', '--cached', '--name-only')) {
    console.log(`${kind} badge unchanged.`);
    return;
  }
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    '-c', 'commit.gpgsign=false', 'commit', '-m', `chore: update ${kind} badge for ${sourceSha}`);
  git('push', 'origin', 'HEAD:refs/heads/badges');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'coverage') generate();
    else if (command === 'downloads') {
      if (!args[0]) throw new Error('Usage: badges.mjs downloads <output.json>');
      const badge = await collectDownloads();
      writeFileSync(args[0], `${JSON.stringify(badge, null, 2)}\n`);
      console.log(`Package downloads: ${badge.message}`);
    } else if (command === 'publish') publish(...args);
    else throw new Error('Usage: badges.mjs coverage|downloads|publish');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
