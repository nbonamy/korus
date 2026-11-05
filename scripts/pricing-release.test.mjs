import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { preparePricing, publishPricing } from './pricing-release.mjs';

// Publication boundary: idempotent revisions, compatible bundles, immutable
// versioned assets, manifest last, and never promoting pricing to an app release.
test('prepares reproducible pricing assets and publishes them only to a non-latest prerelease', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pricing-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const historyPath = path.join(directory, 'history.json');
  const manifestPath = path.join(directory, 'manifest.json');
  const outputDir = path.join(directory, 'assets');
  await writeFile(historyPath, await readFile(new URL('../client/backend/src/pricing/history.json', import.meta.url)));
  const options = { historyPath, manifestPath, outputDir, now: new Date('2026-11-01T00:00:00Z') };
  const first = await preparePricing(options);
  assert.match(first.version, /^[a-f0-9]{64}$/);
  assert.equal(first.asset, `catalog-${first.version}.json`);
  assert.deepEqual(await preparePricing({ ...options, now: new Date('2026-11-02T00:00:00Z') }), first);
  const calls = [];
  const run = (args, input) => {
    calls.push({ args, ...(input ? { input: JSON.parse(input) } : {}) });
    if (args[0] === 'api' && args[1].includes('/tags/')) { const error = new Error('missing'); error.stderr = 'HTTP 404'; throw error; }
    if (args[0] === 'api') return JSON.stringify({ id: 42, prerelease: true, assets: [] });
    return '';
  };
  await publishPricing({ ...options, repository: 'example/app', run });
  const create = calls.find(call => call.input);
  assert.deepEqual(create.input, { tag_name: 'pricing-data-v1', name: 'Pricing data', body: 'Versioned model pricing catalogs.', prerelease: true, make_latest: 'false' });
  const uploads = calls.filter(call => call.args[0] === 'release' && call.args[1] === 'upload');
  assert.ok(uploads[0].args.includes(path.join(outputDir, first.asset)));
  assert.ok(!uploads[0].args.includes('--clobber'));
  assert.ok(uploads[1].args.includes(path.join(outputDir, 'latest.json')));
  assert.ok(uploads[1].args.includes('--clobber'));
  assert.equal(uploads.every(call => call.args.includes('pricing-data-v1')), true);
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDir, 'latest.json'))), first);
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDir, first.asset))), JSON.parse(await readFile(historyPath)));
  // Repair a mistakenly stable feed before publishing; reuse its existing catalog.
  const repair = [];
  await publishPricing({ ...options, repository: 'example/app', run: (args, input) => {
    repair.push({ args, ...(input ? { input: JSON.parse(input) } : {}) });
    return JSON.stringify({ id: 42, prerelease: false, assets: [{ name: first.asset }] });
  } });
  assert.deepEqual(repair.find(call => call.input).input, { prerelease: true, draft: false, make_latest: 'false' });
  assert.equal(repair.filter(call => call.args[0] === 'release').length, 1);
  // An upload error must not advance the pointer.
  const uploaded = [];
  await assert.rejects(publishPricing({ ...options, repository: 'example/app', run: args => {
    if (args[0] === 'api') return JSON.stringify({ id: 42, prerelease: true, assets: [] });
    uploaded.push(args); throw new Error('upload failed');
  } }), /upload failed/);
  assert.equal(uploaded.length, 1);
  const productionCalls = [];
  await publishPricing({ ...options, run: (args, input) => {
    productionCalls.push(args);
    if (args[0] === 'api') return JSON.stringify({ id: 42, prerelease: true, assets: [] });
    return '';
  } });
  assert.equal(productionCalls[0][1], 'repos/Korus-Dev/korus/releases/tags/pricing-data-v1');
});
