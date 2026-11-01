import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pricingHistorySchema } from '../client/backend/src/pricing/schema.ts';
import { createPricingManifest, encodePricingHistory, pricingManifestSchema, pricingReleaseTag } from '../client/backend/src/pricing/release-format.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
async function atomicWrite(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
export async function preparePricing({ historyPath = path.join(root, 'client/backend/src/pricing/history.json'), manifestPath = path.join(root, 'client/backend/src/pricing/manifest.json'), outputDir = path.join(root, '.app-dev/pricing-release'), now = new Date() } = {}) {
  const history = pricingHistorySchema.parse(JSON.parse(await readFile(historyPath, 'utf8')));
  let manifest = createPricingManifest(history, now.toISOString());
  try {
    const previous = pricingManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    if (previous.version === manifest.version) manifest = previous;
    else if (Date.parse(manifest.publishedAt) <= Date.parse(previous.publishedAt)) throw new Error('Pricing publication time must increase');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(outputDir, { recursive: true });
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await atomicWrite(path.join(outputDir, manifest.asset), encodePricingHistory(history));
  await atomicWrite(path.join(outputDir, 'latest.json'), content);
  await atomicWrite(manifestPath, content);
  return manifest;
}
export async function publishPricing(options = {}) {
  const outputDir = options.outputDir ?? path.join(root, '.app-dev/pricing-release');
  const manifest = await preparePricing({ ...options, outputDir });
  const product = JSON.parse(await readFile(path.join(root, 'core/src/product.json'), 'utf8'));
  const repository = options.repository ?? product.repository;
  const run = options.run ?? ((args, input) => execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
  let release;
  try { release = JSON.parse(run(['api', `repos/${repository}/releases/tags/${pricingReleaseTag}`])); }
  catch (error) {
    if (!/HTTP 404/.test(String(error.stderr))) throw error;
    release = JSON.parse(run(['api', '--method', 'POST', `repos/${repository}/releases`, '--input', '-'], JSON.stringify({
      tag_name: pricingReleaseTag, name: 'Pricing data', body: 'Versioned model pricing catalogs.', prerelease: true, make_latest: 'false',
    })));
  }
  // Keep even an existing/repaired feed outside GitHub latest and stable app updates.
  if (!release.prerelease || release.draft) {
    run(['api', '--method', 'PATCH', `repos/${repository}/releases/${release.id}`, '--input', '-'], JSON.stringify({ prerelease: true, draft: false, make_latest: 'false' }));
  }
  if (!release.assets?.some(asset => asset.name === manifest.asset)) {
    run(['release', 'upload', pricingReleaseTag, path.join(outputDir, manifest.asset), '--repo', repository]);
  }
  // Publish the pointer only after the versioned asset is available; retries reuse it.
  run(['release', 'upload', pricingReleaseTag, path.join(outputDir, 'latest.json'), '--repo', repository, '--clobber']);
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const publish = process.argv[2] === '--publish';
    if (process.argv.length > (publish ? 3 : 2)) throw new Error('Usage: node scripts/pricing-release.mjs [--publish]');
    const manifest = await (publish ? publishPricing() : preparePricing());
    console.log(`[pricing] ${publish ? 'published' : 'prepared'} ${manifest.version}`);
  } catch (error) { console.error('[pricing] publication failed:', error); process.exitCode = 1; }
}
