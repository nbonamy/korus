import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { collectDownloads } from './badges.mjs';

const script = path.join(import.meta.dirname, 'badges.mjs');
const badge = { schemaVersion: 1, label: 'statement coverage', message: '90.0%', color: 'brightgreen' };

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'coverage-badge-'));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), JSON.stringify(value));
  };
  return { root, run, git, write, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('generates a weighted statement badge from every declared workspace and rejects incomplete reports', () => {
  const f = fixture();
  try {
    f.write('package.json', { workspaces: ['large', 'small'] });
    f.write('large/coverage/coverage-final.json', { '/large.ts': { s: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index, 1])) } });
    f.write('small/coverage/coverage-final.json', { '/small.ts': { s: { 0: 0 } } });
    const result = f.run('coverage');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.root, 'coverage/badge.json'), 'utf8')), badge);

    for (const report of [{}, { '/small.ts': { s: { 0: -1 } } }, { '/small.ts': {} }]) {
      f.write('small/coverage/coverage-final.json', report);
      const invalid = f.run('coverage');
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr, /small/);
    }
    rmSync(path.join(f.root, 'small/coverage/coverage-final.json'));
    assert.notEqual(f.run('coverage').status, 0);
  } finally { f.close(); }
});

test('publishes badge data independently of main, advances existing badges and skips unchanged or stale runs', () => {
  const f = fixture();
  const source = path.join(f.root, 'badge.json');
  try {
    f.git('init', '--bare', 'remote.git');
    f.git('init', '-b', 'main', 'checkout');
    const checkout = path.join(f.root, 'checkout');
    const git = (...args) => f.git('-C', checkout, ...args);
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.test');
    git('config', 'commit.gpgsign', 'false');
    git('remote', 'add', 'origin', path.join(f.root, 'remote.git'));
    writeFileSync(path.join(checkout, 'source.txt'), 'Application source');
    git('add', 'source.txt');
    git('commit', '-m', 'initial');
    git('push', 'origin', 'main');
    const sha = git('rev-parse', 'HEAD');
    const publish = (revision = sha) => spawnSync(process.execPath, [script, 'publish', 'coverage', source, revision], { cwd: checkout, encoding: 'utf8' });
    f.write('badge.json', badge);
    let result = publish();
    assert.equal(result.status, 0, result.stderr);
    const first = git('rev-parse', 'HEAD');
    assert.equal(git('ls-tree', '--name-only', 'HEAD'), 'coverage.json');
    assert.equal(git('rev-list', '--count', 'HEAD'), '1');
    assert.equal(f.git('--git-dir=remote.git', 'rev-parse', 'main'), sha);
    assert.deepEqual(JSON.parse(f.git('--git-dir=remote.git', 'show', 'badges:coverage.json')), badge);

    result = publish();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git('rev-parse', 'HEAD'), first);
    f.write('badge.json', { ...badge, message: '91.0%' });
    result = publish();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git('rev-parse', 'HEAD^'), first);
    assert.equal(JSON.parse(f.git('--git-dir=remote.git', 'show', 'badges:coverage.json')).message, '91.0%');
    const packageBadge = { schemaVersion: 1, label: 'package downloads', message: '2379', color: 'orange' };
    f.write('downloads.json', packageBadge);
    const downloads = spawnSync(process.execPath, [script, 'publish', 'downloads', path.join(f.root, 'downloads.json'), sha], { cwd: checkout, encoding: 'utf8' });
    assert.equal(downloads.status, 0, downloads.stderr);
    assert.deepEqual(JSON.parse(f.git('--git-dir=remote.git', 'show', 'badges:downloads.json')), packageBadge);
    f.write('badge.json', { ...badge, message: '91.5%' });
    assert.equal(publish().status, 0);
    assert.deepEqual(JSON.parse(f.git('--git-dir=remote.git', 'show', 'badges:downloads.json')), packageBadge);
    const latest = git('rev-parse', 'HEAD');
    f.write('badge.json', { ...badge, message: '92.0%' });
    result = publish('0'.repeat(40));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /stale/);
    assert.equal(f.git('--git-dir=remote.git', 'rev-parse', 'badges'), latest);
    f.write('badge.json', { schemaVersion: 1, message: 'invalid' });
    assert.notEqual(publish().status, 0);
    assert.equal(f.git('--git-dir=remote.git', 'rev-parse', 'badges'), latest);
  } finally { f.close(); }
});

test('counts application packages across release pages, excludes metadata and drafts, and rejects incomplete counts', async () => {
  const asset = (name, download_count) => ({ name, download_count });
  const pages = [
    Array.from({ length: 100 }, (_, i) => ({ assets: [asset(i === 0 ? 'app.dmg' : 'RELEASES', 10)] })),
    [
      { prerelease: true, assets: ['exe', 'zip', 'deb', 'rpm', 'nupkg'].map(ext => asset(`app.${ext}`, 2)) },
      { assets: ['catalog.json', 'latest.yml', 'app.exe.blockmap', 'source.tar.gz'].map(name => asset(name, 500)) },
      { draft: true, assets: [asset('app.zip', 999)] },
    ],
  ];
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    return Response.json(pages[calls.length - 1]);
  };
  assert.deepEqual(await collectDownloads({ repository: 'example/app', fetchImpl }), {
    schemaVersion: 1, label: 'package downloads', message: '20', color: 'orange',
  });
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]).searchParams.get('page'), '2');
  assert.equal(new URL(calls[0]).searchParams.get('per_page'), '100');
  let partialPage = 0;
  await assert.rejects(collectDownloads({ repository: 'example/app', fetchImpl: async () =>
    ++partialPage === 1 ? Response.json(pages[0]) : new Response('unavailable', { status: 503 }),
  }));
  for (const response of [
    new Response('rate limited', { status: 403 }),
    Response.json({ message: 'Unexpected response' }),
    Response.json([{ assets: [asset('app.zip', -1)] }]),
    Response.json([{ assets: [asset('app.zip', null)] }]),
    Response.json([{ assets: [asset('app.zip', Number.MAX_SAFE_INTEGER + 1)] }]),
  ]) {
    await assert.rejects(collectDownloads({ repository: 'example/app', fetchImpl: async () => response }));
  }
});
