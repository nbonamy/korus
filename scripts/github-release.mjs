import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import product from '../core/src/product.json' with { type: 'json' };
import { targets } from './release-artifacts.mjs';
import { createReleaseProgress, failureExcerpt } from './release-progress.mjs';

const workflow = 'desktop-build.yml';
const repo = ['--repo', product.repository];

// Redraws a live per-job panel (plain change snapshots when not a terminal, so an agent can follow along).
export async function watch(runId, { gh, wait = delay, log = console.log, output = process.stdout, jobNames, title = `run ${runId}` }) {
  const progress = createReleaseProgress(output, jobNames);
  const api = route => JSON.parse(gh(['api', `repos/${product.repository}/actions/${route}`]));
  const deadline = Date.now() + 2 * 3600_000;
  let failures = 0;
  while (Date.now() < deadline) {
    let run, jobs;
    try { run = api(`runs/${runId}`); jobs = api(`runs/${runId}/jobs?per_page=100`).jobs; failures = 0; }
    catch (error) {
      if (++failures >= 5) throw error;
      await wait(10_000);
      continue;
    }
    progress(title, run, jobs);
    if (run.status === 'completed') {
      if (run.conclusion === 'success') return run;
      for (const job of jobs.filter(job => job.status === 'completed' && !['success', 'skipped', 'neutral'].includes(job.conclusion))) {
        log(`\nFailure details: ${job.name}`);
        try { log(failureExcerpt(gh(['run', 'view', String(runId), ...repo, '--job', String(job.id), '--log-failed'])) || 'No failed-step logs available.'); }
        catch { log('Logs unavailable from GitHub.'); }
      }
      log(`\nRetry the failed jobs: gh run rerun ${runId} ${repo.join(' ')} --failed\nThen resume: npm run release:watch -- ${runId}`);
      throw new Error(`Release run ${run.conclusion}.`);
    }
    await wait(10_000);
  }
  throw new Error(`Timed out waiting for run ${runId}.`);
}

// prerelease/latest tag the pushed default-branch commit and publish it; build only validates the current branch.
export async function release(command, { gh, git, version, wait = delay, log = console.log, output }) {
  const publish = command !== 'build';
  const tag = `v${version}`;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A plain package.json release version is required.');
  // CI builds the remote commit, not this checkout. Independent work can remain
  // dirty, but desktop inputs (including shared build/dependency files) must ship.
  const changes = [...new Set([
    ...git(['diff', '--no-renames', '--name-only', '-z', 'HEAD']).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ])].filter(Boolean);
  const unrelated = file => ['server/', 'website/', 'mobile/', 'docs/'].some(prefix => file.startsWith(prefix))
    || file === 'core/src/telemetry-metrics.ts'; // Private console contract only.
  const blocking = changes.filter(file => !unrelated(file));
  if (blocking.length) throw new Error(`Commit desktop release changes before releasing: ${blocking.map(file => JSON.stringify(file)).join(', ')}`);
  if (changes.length) log(`Warning: uncommitted non-desktop changes are excluded from the released tag: ${changes.map(file => JSON.stringify(file)).join(', ')}`);
  const head = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const defaultBranch = JSON.parse(gh(['api', `repos/${product.repository}`])).default_branch;
  if (publish && branch !== defaultBranch) throw new Error(`Release from ${defaultBranch}, not ${branch}.`);
  if (git(['ls-remote', 'origin', `refs/heads/${branch}`]).split('\t')[0] !== head) throw new Error(`Push ${branch} before releasing.`);

  if (publish) {
    let published = false;
    try { published = !JSON.parse(gh(['release', 'view', tag, ...repo, '--json', 'isDraft'])).isDraft; }
    catch (error) { if (!/not found|HTTP 404/i.test(String(error.stderr ?? error.message))) throw error; }
    if (published) throw new Error(`${tag} is already published; bump the version to release again.`);
    const existing = git(['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).split('\n').pop().split('\t')[0];
    if (existing && existing !== head) throw new Error(`${tag} already exists at ${existing.slice(0, 8)}, not HEAD; bump the version.`);
    if (!existing) {
      gh(['api', `repos/${product.repository}/git/refs`, '--method', 'POST', '-f', `ref=refs/tags/${tag}`, '-f', `sha=${head}`]);
      log(`Created ${tag} at ${head.slice(0, 8)}.`);
    }
  }

  const started = Date.now() - 60_000;
  const ref = publish ? tag : branch;
  const dispatch = gh(['workflow', 'run', workflow, ...repo, '--ref', ref, '-f', `channel=${publish ? command : 'none'}`]);
  let runId = /actions\/runs\/(\d+)/.exec(dispatch)?.[1];
  // Older gh versions do not print the created run; find it by ref and creation time.
  for (let attempt = 0; !runId && attempt < 12; attempt++) {
    await wait(5_000);
    const runs = JSON.parse(gh(['run', 'list', ...repo, '--workflow', workflow, '--branch', ref, '--event', 'workflow_dispatch',
      '--limit', '5', '--json', 'databaseId,createdAt']));
    runId = runs.find(run => Date.parse(run.createdAt) >= started)?.databaseId;
  }
  if (!runId) throw new Error('Dispatched, but the workflow run was not found; inspect GitHub Actions.');
  log(`Dispatched ${ref} (${publish ? command : 'build only'}) as run ${runId}.`);
  const jobNames = ['quality', ...targets.map(target => `build (${target})`), ...(publish ? ['publish'] : [])];
  await watch(runId, { gh, wait, log, output, jobNames, title: `${ref} · ${publish ? command : 'build only'}` });
  log(publish ? `Published ${command}: ${product.repositoryUrl}/releases/tag/${tag}` : 'Build-only validation passed; nothing was published.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const sh = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }).trim();
  const deps = { gh: args => sh('gh', args), git: args => sh('git', args) };
  const [command, runId] = process.argv.slice(2);
  const task = command === 'watch' && runId ? watch(runId, deps)
    : ['prerelease', 'latest', 'build'].includes(command)
      ? release(command, { ...deps, version: JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')).version })
      : Promise.reject(new Error('Usage: npm run prerelease | npm run latest | npm run release:build | npm run release:watch -- <run-id>'));
  task.catch(error => { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; });
}
