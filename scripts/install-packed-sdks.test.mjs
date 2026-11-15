import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { installedCopies, installPacked, missingDependencies } from './install-packed-sdks.mjs';

test('a packed SDK replaces every installed copy, hoisted or nested in a workspace, with its built files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'packed-sdks-'));
  try {
    const name = '@korus-dev/agent-ui-sdk';
    const installed = workspace => path.join(root, workspace, 'node_modules', name);
    for (const workspace of ['.', 'client/vue']) {
      mkdirSync(installed(workspace), { recursive: true });
      writeFileSync(path.join(installed(workspace), 'package.json'), '{"version":"0.27.2"}');
      writeFileSync(path.join(installed(workspace), 'stale.js'), 'published');
    }
    // `npm pack` wraps the package in a `package/` folder.
    mkdirSync(path.join(root, 'pack/package/dist'), { recursive: true });
    writeFileSync(path.join(root, 'pack/package/package.json'), '{"version":"0.27.3-main"}');
    writeFileSync(path.join(root, 'pack/package/dist/index.js'), 'built');
    execFileSync('tar', ['-czf', path.join(root, 'sdk.tgz'), '-C', path.join(root, 'pack'), 'package']);

    const copies = installedCopies(root, name, ['client/vue', 'client/backend']);
    assert.deepEqual(copies, [installed('.'), installed('client/vue')]);
    for (const copy of copies) installPacked(path.join(root, 'sdk.tgz'), copy);

    for (const workspace of ['.', 'client/vue']) {
      assert.equal(JSON.parse(readFileSync(path.join(installed(workspace), 'package.json'), 'utf8')).version, '0.27.3-main');
      assert.equal(readFileSync(path.join(installed(workspace), 'dist/index.js'), 'utf8'), 'built');
      assert.equal(existsSync(path.join(installed(workspace), 'stale.js')), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('only dependencies the project does not have are installed, and sibling SDKs never are', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'missing-deps-'));
  try {
    mkdirSync(path.join(root, 'node_modules/zod'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules/zod/package.json'), '{}');

    assert.deepEqual(missingDependencies(root, { zod: '^4.0.0', 'image-size': '^2.0.2', '@korus-dev/codex-sdk': '0.167.1' }), ['image-size@^2.0.2']);
    assert.deepEqual(missingDependencies(root, undefined), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
