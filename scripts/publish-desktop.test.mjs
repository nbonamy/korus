import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkReleaseRepositories, publishDesktop } from './publish-desktop.mjs';
import { createHash } from 'node:crypto';

const changelog = '# Changelog\n\n## [0.28.0] - 2026-10-07\n\n- Newer changes.\n\n## [0.27.0] - 2026-10-05\n\n### Fixes\n\n- Restored saved chats.\n';
const notes = '### Fixes\n\n- Restored saved chats.';

function fakeMirrorToken(t) {
  const original = process.env.DESKTOP_RELEASE_TOKEN;
  process.env.DESKTOP_RELEASE_TOKEN = 'test-mirror-token';
  t.after(() => { if (original === undefined) delete process.env.DESKTOP_RELEASE_TOKEN; else process.env.DESKTOP_RELEASE_TOKEN = original; });
}

test('source repository metadata may omit permissions for the workflow token', t => {
  fakeMirrorToken(t);
  const repositories = ['Korus-Dev/korus', 'nbonamy/korus'];
  const run = (_command, args) => JSON.stringify({ private: false, default_branch: 'main',
    ...(args[1].endsWith('Korus-Dev/korus') ? { permissions: { push: true } } : {}) });
  assert.equal(checkReleaseRepositories(repositories, run).size, 2);
});

test('destination preflight still rejects private repositories and an unwritable mirror', t => {
  fakeMirrorToken(t);
  assert.throws(() => checkReleaseRepositories(['nbonamy/korus'], () => JSON.stringify({ private: true })), /Public release write access/);
  assert.throws(() => checkReleaseRepositories(['Korus-Dev/korus'], () => JSON.stringify({ private: false, permissions: { push: false } })), /Public release write access/);
});

// Publication policy against a fake gh, not proof of GitHub Actions or network behavior.
function setup(t, release) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'publication-policy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [target, extensions] of Object.entries({ 'darwin-arm64': ['zip', 'dmg'], 'win32-x64': ['zip', 'exe', 'nupkg', 'RELEASES'],
    'linux-x64': ['zip', 'deb', 'rpm'], 'linux-arm64': ['zip', 'deb', 'rpm'] })) {
    fs.mkdirSync(path.join(directory, `desktop-${target}`), { recursive: true });
    for (const extension of extensions) fs.writeFileSync(path.join(directory, `desktop-${target}`, `${target}.${extension}`), extension);
  }
  const remote = { release, calls: [] };
  const run = (command, args) => {
    assert.equal(command, 'gh');
    remote.calls.push(args);
    if (args[1] === 'view') {
      if (!remote.release) throw Object.assign(new Error('failed'), { stderr: 'release not found' });
      return JSON.stringify(remote.release);
    }
    if (args[1] === 'create') remote.release = { isDraft: true, isPrerelease: true };
    if (args[1] === 'edit') remote.release = { isDraft: false, isPrerelease: args.includes('--prerelease') };
    return '';
  };
  return { directory, remote, run, verbs: () => remote.calls.map(call => call[1]) };
}

test('a new release is staged as a draft, filled with every installer, then published as a prerelease', async t => {
  const f = setup(t, null);
  await publishDesktop({ directory: f.directory, tag: 'v0.27.0', channel: 'prerelease', changelog, run: f.run });
  assert.deepEqual(f.verbs(), ['view', 'create', 'view', 'upload', 'edit', 'view']);
  assert.equal(f.remote.calls.find(call => call[1] === 'upload').filter(arg => arg.endsWith('.exe')).length, 1);
  assert.deepEqual(f.remote.release, { isDraft: false, isPrerelease: true });
  const create = f.remote.calls.find(call => call[1] === 'create');
  assert.equal(create[create.indexOf('--notes') + 1], notes);
});

test('source maps upload without matching the update service platform patterns', async t => {
  const f = setup(t, null);
  for (const target of ['darwin-arm64', 'win32-x64', 'linux-x64', 'linux-arm64']) fs.writeFileSync(path.join(f.directory, `desktop-${target}`, `korus_${target.replaceAll('-', '_')}-sourcemaps.zip`), 'maps');
  await publishDesktop({ directory: f.directory, tag: 'v0.27.0', channel: 'prerelease', changelog, run: f.run });
  const uploaded = f.remote.calls.find(call => call[1] === 'upload').filter(arg => arg.endsWith('-sourcemaps.zip')).map(arg => path.basename(arg)).sort();
  assert.deepEqual(uploaded, ['korus_darwin_arm64-sourcemaps.zip', 'korus_linux_arm64-sourcemaps.zip', 'korus_linux_x64-sourcemaps.zip', 'korus_win32_x64-sourcemaps.zip']);
  // update.electronjs.org classifies assets using these platform tokens.
  for (const name of uploaded) assert.doesNotMatch(name, /-(?:mac|darwin|osx)|-win32-(?:ia32|x64|arm64)/i);
});

test('an installer-looking source map archive stops publication before GitHub changes', async t => {
  for (const target of ['darwin-arm64', 'win32-x64']) {
    const f = setup(t, null);
    fs.writeFileSync(path.join(f.directory, `desktop-${target}`, `korus-${target}-sourcemaps.zip`), 'maps');
    await assert.rejects(publishDesktop({ directory: f.directory, tag: 'v0.27.0', channel: 'latest', changelog, run: f.run }), /Unsafe source-map artifact/);
    assert.deepEqual(f.remote.calls, []);
  }
});

test('latest publishes a leftover draft without recreating it', async t => {
  const f = setup(t, { isDraft: true, isPrerelease: true });
  await publishDesktop({ directory: f.directory, tag: 'v0.27.0', channel: 'latest', changelog, run: f.run });
  assert.ok(!f.verbs().includes('create'));
  assert.ok(f.remote.calls.find(call => call[1] === 'edit').includes('--latest'));
  assert.deepEqual(f.remote.release, { isDraft: false, isPrerelease: false });
  const edit = f.remote.calls.find(call => call[1] === 'edit');
  assert.equal(edit[edit.indexOf('--notes') + 1], notes);
});

test('an already published release is never modified', async t => {
  const f = setup(t, { isDraft: false, isPrerelease: false });
  await assert.rejects(publishDesktop({ directory: f.directory, tag: 'v0.27.0', channel: 'prerelease', changelog, run: f.run }), /already published/);
  assert.deepEqual(f.verbs(), ['view']);
});

test('nothing is staged when a platform is incomplete', async t => {
  const f = setup(t, null);
  fs.rmSync(path.join(f.directory, 'desktop-linux-x64', 'linux-x64.rpm'));
  await assert.rejects(publishDesktop({ directory: f.directory, tag: 'v0.27.0', channel: 'latest', changelog, run: f.run }), /Missing \.rpm artifact for linux-x64/);
  assert.deepEqual(f.remote.calls, []);
});

test('missing release notes stop publication before any GitHub change', async t => {
  const f = setup(t, null);
  await assert.rejects(publishDesktop({ directory: f.directory, tag: 'v0.29.0', channel: 'prerelease', changelog, run: f.run }), /Missing changelog notes/);
  assert.deepEqual(f.remote.calls, []);
});

function mirrored(t) {
  const f = setup(t, null);
  const originalToken = process.env.DESKTOP_RELEASE_TOKEN;
  if (!originalToken) process.env.DESKTOP_RELEASE_TOKEN = 'test-mirror-token';
  t.after(() => {
    if (originalToken === undefined) delete process.env.DESKTOP_RELEASE_TOKEN;
    else process.env.DESKTOP_RELEASE_TOKEN = originalToken;
  });
  const repositories = ['Korus-Dev/korus', 'nbonamy/korus'];
  const releases = new Map();
  const calls = [];
  let fail = '';
  const run = (_command, args, options) => {
    const repo = args[0] === 'api' ? args[1].replace(/^repos\//, '') : args[args.indexOf('--repo') + 1];
    calls.push({ repo, verb: args[1], args, token: options.env?.GH_TOKEN });
    if (args[0] === 'api') return JSON.stringify({ private: false, default_branch: 'main', permissions: { push: true } });
    if (args[1] === 'view') {
      if (!releases.has(repo)) throw Object.assign(new Error('missing'), { stderr: 'release not found' });
      return JSON.stringify(releases.get(repo));
    }
    if (args[1] === 'create') releases.set(repo, { isDraft: true, isPrerelease: true, body: notes, assets: [] });
    if (args[1] === 'upload') releases.get(repo).assets = args.filter(arg => fs.existsSync(arg)).map(file => ({
      name: path.basename(file), size: fs.statSync(file).size, digest: `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`,
    }));
    if (`${repo}:${args[1]}` === fail) { fail = ''; throw new Error('connection lost'); }
    if (args[1] === 'edit') Object.assign(releases.get(repo), { isDraft: false, isPrerelease: args.includes('--prerelease') });
    return '';
  };
  return { ...f, run, repositories, releases, calls, failOnce: value => { fail = value; },
    publish: () => publishDesktop({ directory: f.directory, tag: 'v0.27.0', channel: 'latest', changelog, repositories, run }) };
}

test('the same verified installers are staged in both repositories before either feed advances', async t => {
  const f = mirrored(t);
  await f.publish();
  assert.deepEqual(f.repositories.map(repo => f.releases.get(repo).isDraft), [false, false]);
  assert.deepEqual(f.releases.get(f.repositories[0]).assets, f.releases.get(f.repositories[1]).assets);
  const uploads = f.calls.filter(call => call.verb === 'upload');
  assert.deepEqual(uploads.map(call => call.repo), f.repositories);
  assert.ok(f.calls.findIndex(call => call.verb === 'edit') > f.calls.findLastIndex(call => call.verb === 'upload'));
  const creates = f.calls.filter(call => call.verb === 'create');
  assert.ok(creates.find(call => call.repo === 'nbonamy/korus').args.includes('--verify-tag'));
  assert.ok(creates.find(call => call.repo === 'Korus-Dev/korus').args.includes('--target'));
  assert.ok(!creates.find(call => call.repo === 'Korus-Dev/korus').args.includes('--verify-tag'));
});

test('a failed mirror upload leaves both releases as drafts', async t => {
  const f = mirrored(t); f.failOnce('nbonamy/korus:upload');
  await assert.rejects(f.publish(), /connection lost/);
  assert.ok([...f.releases.values()].every(release => release.isDraft));
  assert.ok(!f.calls.some(call => call.verb === 'edit'));
});

test('a partial publication resumes without replacing already published assets', async t => {
  const f = mirrored(t); f.failOnce('nbonamy/korus:edit');
  await assert.rejects(f.publish(), /connection lost/);
  assert.equal(f.releases.get('Korus-Dev/korus').isDraft, false);
  await f.publish();
  assert.ok([...f.releases.values()].every(release => !release.isDraft));
  assert.equal(f.calls.filter(call => call.repo === 'Korus-Dev/korus' && call.verb === 'upload').length, 1);
});

test('a published mirror with different bytes blocks recovery without modifying it', async t => {
  const f = mirrored(t); f.failOnce('nbonamy/korus:edit');
  await assert.rejects(f.publish(), /connection lost/);
  f.releases.get('Korus-Dev/korus').assets[0].digest = 'sha256:wrong';
  f.calls.length = 0;
  await assert.rejects(f.publish(), /do not match/);
  assert.ok(!f.calls.some(call => ['create', 'upload', 'edit'].includes(call.verb)));
});

test('a workflow without the mirror credential fails before creating releases', async t => {
  const originalActions = process.env.GITHUB_ACTIONS;
  const originalToken = process.env.DESKTOP_RELEASE_TOKEN;
  t.after(() => {
    if (originalActions === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = originalActions;
    if (originalToken === undefined) delete process.env.DESKTOP_RELEASE_TOKEN; else process.env.DESKTOP_RELEASE_TOKEN = originalToken;
  });
  process.env.GITHUB_ACTIONS = 'true';
  const f = mirrored(t);
  delete process.env.DESKTOP_RELEASE_TOKEN;
  await assert.rejects(f.publish(), /Set DESKTOP_RELEASE_TOKEN/);
  assert.ok(!f.calls.some(call => ['create', 'upload', 'edit'].includes(call.verb)));
});

test('each repository uses its own workflow credential', async t => {
  const saved = Object.fromEntries(['GITHUB_ACTIONS', 'GH_TOKEN', 'DESKTOP_RELEASE_TOKEN'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  process.env.GITHUB_ACTIONS = 'true'; process.env.GH_TOKEN = 'source-token'; process.env.DESKTOP_RELEASE_TOKEN = 'mirror-token';
  const f = mirrored(t);
  await f.publish();
  for (const call of f.calls) assert.equal(call.token, call.repo === 'nbonamy/korus' ? 'source-token' : 'mirror-token');
});
