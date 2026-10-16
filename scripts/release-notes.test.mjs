import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { expectedReleaseNotes } from './release-notes.mjs';

test('release validation includes every declared workspace and its locked core dependency', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'release-workspaces-'));
  const writeJson = (file, value) => writeFileSync(path.join(root, file), JSON.stringify(value));
  const manifest = { version: '1.2.3', dependencies: { '@workspace/core': '1.2.3' } };
  const workspaces = ['core', 'backend', 'vue', 'electron', 'web', 'service'];
  const lockfile = {
    version: '1.2.3',
    packages: { '': { version: '1.2.3' }, ...Object.fromEntries(workspaces.map((workspace) => [workspace, manifest])) },
  };
  try {
    for (const workspace of workspaces) {
      mkdirSync(path.join(root, workspace));
      writeJson(`${workspace}/package.json`, manifest);
    }
    writeJson('package.json', { version: '1.2.3', workspaces });
    writeJson('package-lock.json', lockfile);
    writeFileSync(path.join(root, 'CHANGELOG.md'), '## [1.2.3] - 2026-10-15\n\n- Improved startup.\n');
    assert.equal(JSON.parse(expectedReleaseNotes(root)).currentVersion, '1.2.3');

    writeJson('service/package.json', { ...manifest, dependencies: { '@workspace/core': '1.2.2' } });
    assert.throws(() => expectedReleaseNotes(root), /service\/package.json depends on @workspace\/core 1.2.2/);

    writeJson('service/package.json', manifest);
    writeJson('package-lock.json', {
      ...lockfile,
      packages: { ...lockfile.packages, service: { ...manifest, dependencies: { '@workspace/core': '1.2.2' } } },
    });
    assert.throws(() => expectedReleaseNotes(root), /package-lock.json entry for service\/package.json depends on @workspace\/core 1.2.2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
