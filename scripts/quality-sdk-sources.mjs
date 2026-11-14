import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { installedCopies, installPacked } from './install-packed-sdks.mjs';

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
  if (!process.env.RUNNER_TEMP) throw new Error('Quality SDK setup requires the Actions runner environment.');
  const root = path.join(process.env.RUNNER_TEMP, 'korus-quality-sdks');
  const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });
  mkdirSync(root, { recursive: true });
  for (const name of names) {
    const folder = path.join(root, name);
    console.log(`${name}: ${revisions[name]}`);
    run('git', ['init', '--quiet', folder]);
    run('git', ['remote', 'add', 'origin', url(name)], folder);
    run('git', ['fetch', '--depth=1', 'origin', revisions[name]], folder);
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], folder);
  }
  // Each SDK is built and packed as it would be published, then installed over the pinned package. Validation then
  // loads prebuilt files, the way a release does, instead of transforming SDK sources on every test file.
  const packs = path.join(root, 'packs');
  mkdirSync(packs, { recursive: true });
  const workspaces = JSON.parse(readFileSync('package.json', 'utf8')).workspaces;
  for (const name of names) {
    const folder = path.join(root, name);
    run('npm', ['ci', '--no-audit', '--no-fund'], folder);
    run('npm', ['run', 'build'], folder);
    const tarball = path.join(packs, execFileSync('npm', ['pack', '--silent', '--pack-destination', packs], { cwd: folder, encoding: 'utf8' }).trim().split('\n').pop());
    const copies = installedCopies(process.cwd(), `@korus-dev/${name}`, workspaces);
    if (!copies.length) throw new Error(`@korus-dev/${name} is not installed; run npm ci first.`);
    for (const copy of copies) installPacked(tarball, copy);
    console.log(`${name}: installed ${tarball} over ${copies.length} copy(ies)`);
  }
} else {
  throw new Error('Usage: quality-sdk-sources.mjs resolve|prepare');
}
