import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { updatePricing } from './update-pricing.mjs';
import { pricingHistorySchema } from '../backend/src/pricing/schema.ts';

// HTTP-boundary failures: lost context/tier/cache rules; missing vs zero; mixed
// revisions; ordering/metadata churn; lost same-day updates; partial responses;
// corrupt history; replacement on failure. No provider API calls in these tests.
// TOML fixtures captured from anomalyco/models.dev at
// 47e3a36b1fe10442597bb90adb7cfa007c3e7348 (paths match provider/model IDs).
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pricing-'));
  const files = {};
  for (const provider of ['openai', 'anthropic', 'google']) {
    const base = new URL(`fixtures/pricing/${provider}/`, import.meta.url);
    for (const file of await readdir(base)) {
      files[`providers/${provider}/models/${file}`] = await readFile(new URL(file, base), 'utf8');
    }
  }
  const state = { files, revision: 'a'.repeat(40), reverse: false, failure: null, truncated: false, corruptRaw: false, requests: [] };
  const server = createServer((request, response) => {
    state.requests.push(request.url);
    const send = (value) => response.end(JSON.stringify(value));
    if (request.url === '/repos/anomalyco/models.dev/commits/dev') {
      return send({ sha: state.revision, commit: { tree: { sha: 'b'.repeat(40) } } });
    }
    if (request.url === `/repos/anomalyco/models.dev/git/trees/${'b'.repeat(40)}?recursive=1`) {
      let tree = Object.entries(state.files).map(([file, body]) => ({
        path: file, type: 'blob', mode: '100644',
        sha: createHash('sha1').update(`blob ${Buffer.byteLength(body)}\0${body}`).digest('hex'),
      }));
      if (state.reverse) tree.reverse();
      return send({ sha: 'b'.repeat(40), truncated: state.truncated, tree });
    }
    const prefix = `/anomalyco/models.dev/${state.revision}/`;
    const file = request.url.startsWith(prefix) ? request.url.slice(prefix.length) : '';
    if (state.failure === file) { response.writeHead(503); return response.end('unavailable'); }
    if (state.files[file] !== undefined) return response.end(state.corruptRaw ? state.files[file].slice(0, -5) : state.files[file]);
    response.writeHead(404); response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const outputPath = path.join(directory, 'history.json');
  const collect = (now = '2026-10-25T03:00:00.000Z') => updatePricing({
    outputPath, apiBase: base, rawBase: base, now: new Date(now),
  });
  const history = async () => JSON.parse(await readFile(outputPath, 'utf8'));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { state, collect, history, outputPath, directory };
}

test('collects a complete October baseline with real context, category, tier, mode and cache lifetime rules', async (t) => {
  const { state, collect, history } = await fixture(t);
  assert.equal((await collect()).changed, true);
  const catalog = await history();
  const openai = catalog.openai['gpt-6-sol'];
  const event = openai.cost[0];
  assert.equal(event.date, '2026-10-01T00:00:00.000Z');
  assert.equal(event.source.revision, state.revision);
  assert.equal(openai.metadata.canonicalId, 'openai/gpt-6-sol');
  assert.equal(event.rates.text.input.unit, 'token');
  assert.deepEqual(event.rates.text.input.overrides, [{ when: { context: { gt: 272000 } }, price: 4, cache: { read: 0.4, write: 5 } }]);
  assert.ok(event.rates.multipliers.some((rule) => rule.when.service_tier.equals === 'priority' && rule.factor.text === 2));
  assert.equal(event.modes.fast.service_tier, 'priority');
  assert.equal(catalog.openai['o4-mini'].cost[0].modes.fast.cost.text.input.price, 2);
  const anthropic = catalog.anthropic['claude-sonnet-4-6'].cost[0];
  assert.deepEqual(anthropic.rates.text.input.cache, { read: 0.3, write: { '5m': 3.75, '1h': 6 } });
  const google = catalog.google['gemini-2.5-pro'].cost[0];
  assert.deepEqual(google.rates.multipliers.find((rule) => rule.when.service_tier.equals === 'flex').factor, { text: { input: { price: 0.5 }, output: { price: 0.5 } } });
  assert.deepEqual(google.rates.text.input.overrides[0].when, { context: { gt: 200000 } });
  assert.equal(google.rates.text.input.cache.storage, 4.5);
  assert.equal(catalog.openai['gpt-image-1'].cost[0].availability, 'unpriced');
  assert.equal(catalog.openai['gpt-image-1'].cost[0].rates, undefined);
  assert.match(openai.metadata.source.path, /providers\/openai\/models\/gpt-6-sol.toml/);
  assert.ok(openai.metadata.source.urls.includes('https://developers.openai.com/api/docs/models/gpt-6-sol'));
  assert.ok(state.requests.filter((url) => url.endsWith('.toml')).every((url) => url.includes(state.revision)));
});

test('reordered content, comments, explicit default units and revision metadata leave bytes untouched', async (t) => {
  const { state, collect, outputPath } = await fixture(t);
  await collect();
  const original = await readFile(outputPath, 'utf8');
  state.revision = 'c'.repeat(40);
  state.reverse = true;
  const key = 'providers/openai/models/gpt-6-sol.toml';
  state.files[key] = '# changed description/provenance only\n' + state.files[key].replace('[cost.text.input]', '[cost.text.input]\nunit = "token"');
  state.files[key] = state.files[key].replace(
    /\[\[cost.multipliers\]\]\nwhen = \{ service_tier = \{ equals = "priority" \} \}\nfactor = \{ text = 2 \}\n\n(\[\[cost.multipliers\]\]\nwhen = \{ service_tier = \{ equals = "flex" \} \}\nfactor = \{ text = 0.5 \})/,
    '$1\n\n[[cost.multipliers]]\nwhen = { service_tier = { equals = "priority" } }\nfactor = { text = 2 }',
  );
  assert.equal((await collect('2026-10-26T01:00:00.000Z')).changed, false);
  assert.equal(await readFile(outputPath, 'utf8'), original);
});

test('pricing changes append dated cost events only to the affected model', async (t) => {
  const { state, collect, history } = await fixture(t);
  await collect();
  const baseline = await history();
  const changes = [
    () => { state.files['providers/openai/models/gpt-6-sol.toml'] = state.files['providers/openai/models/gpt-6-sol.toml'].replace('gt = 272_000', 'gte = 272_000'); },
    () => { state.files['providers/anthropic/models/claude-sonnet-4-6.toml'] = state.files['providers/anthropic/models/claude-sonnet-4-6.toml'].replace('"1h" = 6', '"1h" = 7'); },
    () => { state.files['providers/openai/models/gpt-6-sol.toml'] = state.files['providers/openai/models/gpt-6-sol.toml'].replace('read = 0.4, write = 5', 'read = 0.5, write = 6'); },
    () => { state.files['providers/google/models/gemini-2.5-pro.toml'] = state.files['providers/google/models/gemini-2.5-pro.toml'].replace('input = { price = 0.5 }', 'input = { price = 0.4 }'); },
    () => { state.files['providers/openai/models/o4-mini.toml'] = state.files['providers/openai/models/o4-mini.toml'].replace('price = 2\n', 'price = 2.5\n'); },
    () => { state.files['providers/openai/models/zero.toml'] = 'schema = 2\nname = "Explicit zero"\n[cost.text.input]\nprice = 0\n'; },
    () => { state.files['providers/openai/models/zero.toml'] += 'cache = { read = 0 }\n'; },
    () => { delete state.files['providers/openai/models/zero.toml']; },
  ];
  for (const [index, change] of changes.entries()) {
    change();
    const date = `2026-10-25T04:00:0${index}.000Z`;
    assert.equal((await collect(date)).changed, true);
    const catalog = pricingHistorySchema.parse(await history());
    assert.deepEqual(catalog.openai['gpt-image-1'], baseline.openai['gpt-image-1']);
    for (const provider of ['openai', 'anthropic', 'google']) {
      for (const [id, model] of Object.entries(baseline[provider])) {
        assert.deepEqual(catalog[provider][id].cost[0], model.cost[0]);
      }
    }
    assert.equal(Object.values(catalog).flatMap(models => Object.values(models))
      .flatMap(model => model.cost).filter(event => event.date === date).length, 1);
    assert.equal(catalog.openai.zero?.cost.at(-1).availability, index >= 5 ? (index === 7 ? 'removed' : 'priced') : undefined);
    assert.equal((await collect(date)).changed, false);
  }
  const catalog = await history();
  assert.equal(catalog.openai['gpt-6-sol'].cost.length, 3);
  assert.equal(catalog.openai['gpt-6-sol'].cost[1].rates.text.input.overrides[0].when.context.gte, 272000);
  assert.equal(catalog.anthropic['claude-sonnet-4-6'].cost[1].rates.text.input.cache.write['1h'], 7);
  assert.equal(catalog.openai['o4-mini'].cost.at(-1).modes.fast.cost.text.input.price, 2.5);
  assert.equal(catalog.openai.zero.cost[0].rates.text.input.price, 0);
  assert.equal(catalog.openai.zero.cost[1].rates.text.input.cache.read, 0);
});

test('network, TOML, rate, unknown-rule, partial tree and provider failures preserve history and clean temporary files', async (t) => {
  const { state, collect, outputPath, directory } = await fixture(t);
  await collect();
  const original = await readFile(outputPath, 'utf8');
  const files = structuredClone(state.files);
  const key = 'providers/google/models/gemini-2.5-pro.toml';
  const faults = [
    () => { state.failure = key; },
    () => { state.files[key] = 'schema = ['; },
    () => { state.files[key] = state.files[key].replace('price = 1.25', 'price = -1'); },
    () => { state.files[key] = state.files[key].replace('price = 1.25', 'price = "1.25"'); },
    () => { state.files[key] += '\n[cost.new_category]\nprice = 3\n'; },
    () => { state.files[key] = state.files[key].replace('gt = 200_000', 'unknown = 200_000'); },
    () => { state.corruptRaw = true; },
    () => { state.truncated = true; },
    () => { delete state.files[key]; },
    () => { state.files[key] = 'schema = 2\nname = "Unpriced"\n'; },
  ];
  for (const fault of faults) {
    state.files = structuredClone(files); state.failure = null; state.truncated = false; state.corruptRaw = false;
    fault();
    await assert.rejects(collect());
    assert.equal(await readFile(outputPath, 'utf8'), original);
    assert.deepEqual(await readdir(directory), ['history.json']);
  }
});

test('failed initial collection creates no catalog and a competing collector cannot overwrite history', async (t) => {
  const { state, collect, outputPath, directory } = await fixture(t);
  state.truncated = true;
  await assert.rejects(collect());
  assert.deepEqual(await readdir(directory), []);
  state.truncated = false;
  await collect();
  const original = await readFile(outputPath, 'utf8');
  await writeFile(`${outputPath}.lock`, 'another collector');
  await assert.rejects(collect(), { code: 'EEXIST' });
  assert.equal(await readFile(outputPath, 'utf8'), original);
  assert.equal(await readFile(`${outputPath}.lock`, 'utf8'), 'another collector');
});

test('invalid or non-monotonic history is never overwritten', async (t) => {
  const { collect, outputPath, history } = await fixture(t);
  await collect();
  const good = await history();
  const model = good.openai['gpt-6-sol'];
  const repeated = structuredClone(good);
  repeated.openai['gpt-6-sol'].cost.push(model.cost[0]);
  const beforeBaseline = structuredClone(good);
  beforeBaseline.openai['gpt-6-sol'].cost[0].date = '2026-09-30T00:00:00.000Z';
  const invalidPrice = structuredClone(good);
  invalidPrice.openai['gpt-6-sol'].cost[0].rates.text.input.price = -1;
  const emptyProvider = { ...good, google: {} };
  for (const invalid of ['{', '{}', ...[repeated, beforeBaseline, invalidPrice, emptyProvider].map(value => JSON.stringify(value))]) {
    await writeFile(outputPath, invalid);
    await assert.rejects(collect());
    assert.equal(await readFile(outputPath, 'utf8'), invalid);
  }
});
