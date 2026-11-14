import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const names = ['codex-sdk', 'multi-agent-sdk', 'agent-ui-sdk'];
const url = name => `https://github.com/Korus-Dev/${name}.git`;
const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

if (process.argv[2] === 'resolve') {
  const revisions = Object.fromEntries(names.map(name => {
    const sha = execFileSync('git', ['ls-remote', '--exit-code', url(name), 'refs/heads/main'], { encoding: 'utf8' }).trim().split(/\s+/)[0];
    if (!validSha(sha)) throw new Error(`Could not resolve ${name} main.`);
    return [name, sha];
  }));
  console.log(JSON.stringify(revisions));
} else if (process.argv[2] === 'prepare') {
  const revisions = JSON.parse(process.env.SDK_REVISIONS ?? '{}');
  if (!names.every(name => validSha(revisions[name]))) throw new Error('Quality requires a resolved commit for every SDK.');
  if (!process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) throw new Error('Quality SDK setup requires the Actions runner environment.');
  const root = path.join(process.env.RUNNER_TEMP, 'korus-quality-sdks');
  const env = { ...process.env, SDK_LOCAL_SOURCE: '1', SDK_SOURCE_ROOT: root };
  const run = (command, args, cwd) => execFileSync(command, args, { cwd, env, stdio: 'inherit' });
  mkdirSync(root, { recursive: true });
  for (const name of names) {
    const folder = path.join(root, name);
    console.log(`${name}: ${revisions[name]}`);
    run('git', ['init', '--quiet', folder]);
    run('git', ['remote', 'add', 'origin', url(name)], folder);
    run('git', ['fetch', '--depth=1', 'origin', revisions[name]], folder);
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], folder);
  }
  for (const name of names) run('npm', ['ci', '--no-audit', '--no-fund'], path.join(root, name));
  run('npm', ['run', 'build:sdk']);
  appendFileSync(process.env.GITHUB_ENV, `SDK_LOCAL_SOURCE=1\nSDK_SOURCE_ROOT=${root}\n`);
} else {
  throw new Error('Usage: quality-sdk-sources.mjs resolve|prepare');
}
