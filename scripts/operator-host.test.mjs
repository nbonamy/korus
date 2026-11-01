import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPublishedManifest } from './publish-macos.mjs';

test('legacy release checks require an explicit operator host before SSH', () => {
  let contacted = false;
  assert.throws(() => readPublishedManifest({ host: '', execFileSyncImpl() { contacted = true; } }), /APP_UPDATE_PUBLISH_HOST/);
  assert.equal(contacted, false);
  assert.equal(readPublishedManifest({ host: 'operator-host', execFileSyncImpl(command, args) {
    assert.equal(command, 'ssh');
    assert.equal(args[0], 'operator-host');
    return '{"currentRelease":"1.0.0"}';
  } }).currentRelease, '1.0.0');
});

test('website deployment requires a private host before building or contacting a server', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'operator-host-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'node'), '#!/bin/sh\necho unexpected-command >&2\nexit 42\n');
  chmodSync(path.join(directory, 'node'), 0o755);
  const env = { ...process.env, PATH: `${directory}:/usr/bin:/bin` };
  delete env.APP_WEBSITE_HOST;
  const result = spawnSync('/bin/bash', ['website/deploy.sh'], { env, encoding: 'utf8', timeout: 5000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APP_WEBSITE_HOST/);
  assert.doesNotMatch(result.stderr, /unexpected-command/);
});
