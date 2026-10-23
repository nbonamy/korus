import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

function publish(file, sourceSha) {
  if (!file || !/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('Usage: coverage-badge.mjs publish <badge.json> <source SHA>');
  const content = readFileSync(file, 'utf8');
  const badge = JSON.parse(content);
  if (badge.schemaVersion !== 1 || badge.label !== 'statement coverage' || !/^\d+\.\d%$/.test(badge.message)
    || !['brightgreen', 'green', 'red'].includes(badge.color)) throw new Error('Invalid coverage badge.');
  if (git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0] !== sourceSha) {
    console.log('Skipping stale coverage result; main has advanced.');
    return;
  }
  // Run in the disposable CI checkout: only the badge belongs on this branch.
  if (git('ls-remote', 'origin', 'refs/heads/badges')) {
    git('fetch', '--depth=1', 'origin', 'refs/heads/badges');
    git('switch', '--detach', 'FETCH_HEAD');
  } else {
    git('switch', '--orphan', 'badges');
  }
  writeFileSync('coverage.json', content);
  git('add', 'coverage.json');
  if (!git('diff', '--cached', '--name-only')) {
    console.log('Coverage badge unchanged.');
    return;
  }
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    '-c', 'commit.gpgsign=false', 'commit', '-m', `chore: update coverage badge for ${sourceSha}`);
  git('push', 'origin', 'HEAD:refs/heads/badges');
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'generate') generate();
  else if (command === 'publish') publish(...args);
  else throw new Error('Usage: coverage-badge.mjs generate|publish');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
