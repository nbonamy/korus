import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import product from '../core/src/product.json' with { type: 'json' };
import { listTarget, targets } from './release-artifacts.mjs';
import { extractReleaseSections } from './release-notes.mjs';

export function checkReleaseRepositories(repositories, run = execFileSync) {
  const info = new Map();
  for (const repo of new Set(repositories)) {
    const metadata = JSON.parse(run('gh', ['api', `repos/${repo}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000, env: releaseEnvironment(repo) }));
    if (metadata.private || !metadata.permissions?.push) throw new Error(`Public release write access required for ${repo}.`);
    info.set(repo, metadata);
  }
  return info;
}

function releaseEnvironment(repo) {
  const { DESKTOP_RELEASE_TOKEN: mirrorToken, ...environment } = process.env;
  if (repo === product.repository) return environment;
  if (!mirrorToken && process.env.GITHUB_ACTIONS === 'true') throw new Error('Set DESKTOP_RELEASE_TOKEN with Contents write access to the release repository.');
  return { ...environment, GH_TOKEN: mirrorToken || process.env.GH_TOKEN };
}

// The final job of the build workflow: stage installers on a draft, then flip it to the requested channel.
export async function publishDesktop({ directory, tag, channel, changelog, repositories = [product.repository], run = execFileSync }) {
  if (!['prerelease', 'latest'].includes(channel)) throw new Error('Publication requires the prerelease or latest channel.');
  const notes = extractReleaseSections(changelog).find(release => release.version === tag.slice(1))?.markdown;
  if (!notes) throw new Error(`Missing changelog notes for ${tag}.`);
  const gh = (repo, args) => run('gh', [...args, '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000, env: releaseEnvironment(repo) });
  const view = repo => JSON.parse(gh(repo, ['release', 'view', tag, '--json', repositories.length > 1 ? 'isDraft,isPrerelease,assets,body' : 'isDraft,isPrerelease']));
  const files = (await Promise.all(targets.map(target => listTarget(path.join(directory, `desktop-${target}`), target)))).flat();
  const destinations = [...new Set(repositories)];
  const info = destinations.length > 1 ? checkReleaseRepositories(destinations, run) : new Map();
  let expected;
  async function verify(release, repo, checkChannel = true) {
    expected ??= await Promise.all(files.map(async file => {
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      return { name: path.basename(file), size: fs.statSync(file).size, digest: `sha256:${hash.digest('hex')}` };
    }));
    const actual = release.assets ?? [];
    if ((checkChannel && release.isPrerelease !== (channel === 'prerelease')) || release.body !== notes || actual.length !== expected.length ||
      expected.some(item => !actual.some(asset => asset.name === item.name && asset.size === item.size && asset.digest === item.digest))) {
      throw new Error(`Published release assets or metadata do not match in ${repo}.`);
    }
  }
  const releases = new Map();
  for (const repo of destinations) {
    try { releases.set(repo, view(repo)); }
    catch (error) { if (!/not found|HTTP 404/i.test(String(error.stderr ?? error.message))) throw error; }
  }
  for (const [repo, release] of releases) if (!release.isDraft) {
    if (destinations.length === 1) throw new Error(`${tag} is already published; bump the version to release again.`);
    await verify(release, repo);
  }
  for (const repo of destinations) {
    let release = releases.get(repo);
    if (release && !release.isDraft) continue;
    if (!release) {
      const target = repo === product.repository ? ['--verify-tag'] : ['--target', info.get(repo).default_branch];
      gh(repo, ['release', 'create', tag, ...target, '--draft', '--prerelease', '--latest=false', '--title', `${product.name} ${tag.slice(1)}`, '--notes', notes]);
      release = view(repo);
    }
    gh(repo, ['release', 'upload', tag, ...files, '--clobber']);
    if (destinations.length > 1) await verify(view(repo), repo, false);
  }
  for (const repo of destinations) {
    if (releases.get(repo) && !releases.get(repo).isDraft) continue;
    gh(repo, ['release', 'edit', tag, '--notes', notes, '--draft=false', ...(channel === 'latest' ? ['--prerelease=false', '--latest'] : ['--prerelease', '--latest=false'])]);
    const published = view(repo);
    if (published.isDraft || published.isPrerelease !== (channel === 'prerelease')) throw new Error('Release visibility does not match the requested channel.');
    if (destinations.length > 1) await verify(published, repo);
    console.log(`Published ${channel}: https://github.com/${repo}/releases/tag/${tag}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const task = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === product.repository
    ? process.argv[2] === '--check-destinations'
      ? Promise.resolve().then(() => checkReleaseRepositories([product.releaseRepository]))
      : publishDesktop({ directory: path.resolve(process.argv[2] ?? 'out/downloaded'), tag: process.env.GITHUB_REF_NAME,
        channel: process.env.RELEASE_CHANNEL, repositories: [product.releaseRepository, product.repository], changelog: fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8') })
    : Promise.reject(new Error('Publication runs in the build workflow. Use npm run prerelease or npm run latest.'));
  task.catch(error => { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; });
}
