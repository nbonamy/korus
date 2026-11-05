import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { publishDesktop } from './publish-desktop.mjs';

const changelog = '# Changelog\n\n## [0.28.0] - 2026-10-07\n\n- Newer changes.\n\n## [0.27.0] - 2026-10-05\n\n### Fixes\n\n- Restored saved chats.\n';
const notes = '### Fixes\n\n- Restored saved chats.';

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
