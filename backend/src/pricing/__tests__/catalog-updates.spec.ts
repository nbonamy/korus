import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { loadPricingHistory } from '../catalog';
import { createPricingManifest, encodePricingHistory } from '../release-format';
import { PricingCatalog } from '../catalog-updates';
import { UsageLedger } from '../../usage/usage-ledger';
import { UsageService } from '../../usage/usage-service';
import { AppBackendServer } from '../../server';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';

// Own HTTP/filesystem/usage boundary: stale installs, release lag, retroactive
// corrections, failed/partial downloads, incompatible schemas, cache corruption,
// downgrade after upgrade, restart polling, overlapping checks and shutdown.
const day = 86400000;
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pricing-updates-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const history = loadPricingHistory();
  const model = history.openai['gpt-6-sol'];
  model.cost = [model.cost[0]];
  model.cost[0].rates = { text: { input: { unit: 'token', price: 2 }, output: { unit: 'token', price: 10 } },
    multipliers: [{ when: { service_tier: { equals: 'priority' } }, factor: { text: 2 } }] };
  const bundled = { history, manifest: createPricingManifest(history, '2026-10-01T00:00:00.000Z') };
  const updated = structuredClone(history);
  const change = structuredClone(updated.openai['gpt-6-sol'].cost[0]);
  change.date = '2026-11-01T00:00:00.000Z';
  change.source.collectedAt = '2026-11-15T00:00:00.000Z';
  change.rates!.text!.input!.price = 4;
  updated.openai['gpt-6-sol'].cost.push(change);
  const manifest = createPricingManifest(updated, '2026-11-15T00:00:00.000Z');
  const state = { manifest: manifest as unknown, body: encodePricingHistory(updated), failure: false, hold: false, requests: [] as string[] };
  const server = createServer((request, response) => {
    state.requests.push(request.url!);
    if (state.failure) { response.writeHead(503); response.end(); return; }
    if (state.hold) { response.writeHead(200); response.write('{'); return; }
    response.end(request.url === '/latest.json' ? JSON.stringify(state.manifest) : state.body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  let now = Date.parse('2026-11-16T00:00:00.000Z');
  const cacheFile = path.join(directory, 'catalog.json');
  const open = (bundle = bundled) => {
    const catalog = new PricingCatalog({ cacheFile, bundled: bundle, baseUrl, now: () => now });
    cleanups.push(() => catalog.stop());
    return catalog;
  };
  return { directory, state, bundled, updated, manifest, open, cacheFile, advance: () => { now += day; } };
}

it('reprices saved usage through the released usage/get contract, then keeps prices offline across restart', async () => {
  const f = await fixture();
  const catalog = f.open();
  const ledger = new UsageLedger(path.join(f.directory, 'usage.sqlite'), () => Date.parse('2026-11-16T00:00:00Z'), () => catalog.history);
  await ledger.load();
  const usage = new UsageService(ledger, () => undefined);
  const server = new AppBackendServer({ version: 'test', snapshot: createTestSnapshot(), usage });
  cleanups.push(() => server.close());
  const at = Date.parse('2026-11-02T00:00:00Z');
  const parent = { provider: 'codex' as const, sessionId: 'saved-session', turnId: 'saved-turn', agentId: 'a', model: 'gpt-6-sol', at };
  await ledger.observe({ ...parent, phase: 'started', serviceTier: 'priority' }, { teamId: null, repository: null });
  await ledger.observe({ ...parent, phase: 'completed', serviceTier: 'priority', requestCoverage: 'complete',
    tokens: { input: 1000000, output: 0, cacheRead: 0, cacheWrite: null, reasoning: 0, total: 1000000 } }, { teamId: null, repository: null });
  const acceptedRequest = await ledger.observeRequest({ ...parent, requestId: 'r', revision: 0, status: 'final', apiProvider: 'openai', reportedServiceTier: 'priority', requestedServiceTier: 'priority',
    reportedMode: null, cacheMode: 'implicit', modality: 'text', pricingContext: { context: 1000, region: null },
    tokens: { input: 1000000, output: 0, cacheRead: 0, cacheWrite: {}, reasoning: 0, inputIncludesCacheRead: true, inputIncludesCacheWrite: true, outputIncludesReasoning: true } });
  expect(acceptedRequest).toBe(true);
  // Request and cost decoding expectations match the shipped client; no new fields or negotiation.
  const cost = async () => {
    const response = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'usage/get', params: {} });
    return (response as { result: { cost: unknown } }).result.cost;
  };
  const expected = (usd: number) => ({ usd, coverage: 'complete', requests: 1, pricedRequests: 1, unpricedRequests: 0, unknownRequestExecutions: 0, reasons: [] });
  const preview = () => usage.previewTelemetry({
    installId: 'd8b65ff5-179c-49b9-ac3a-f60a54a0f43f', day: '2026-11-02', eligibleFrom: at, eligibleUntil: null,
  }, '1.2.3', 'linux');
  const body = (usd: number) => `{"installId":"d8b65ff5-179c-49b9-ac3a-f60a54a0f43f","day":"2026-11-02","appVersion":"1.2.3","os":"linux","usage":[{"provider":"codex","model":"gpt-6-sol","serviceTier":"fast","turns":1,"inputTokens":1000000,"cachedInputTokens":0,"outputTokens":0,"estimatedCostUsd":${usd}}]}`;
  expect(await cost()).toStrictEqual(expected(4));
  const sealed = await preview();
  expect(Buffer.from(sealed.body, 'utf8')).toStrictEqual(Buffer.from(body(4), 'utf8'));
  await catalog.start(); await catalog.refresh();
  expect(await cost()).toStrictEqual(expected(8));
  expect((await preview()).body).toBe(body(8));
  expect(sealed.body).toBe(body(4)); // Existing sealed bytes retain their original estimate.
  expect(f.state.requests).toEqual(['/latest.json', `/${f.manifest.asset}`]);
  await catalog.refresh();
  expect(f.state.requests).toHaveLength(2);
  await catalog.stop();
  const restarted = f.open(); await restarted.start(); await restarted.refresh();
  expect(restarted.history).toStrictEqual(f.updated);
  expect(f.state.requests).toHaveLength(2);
  f.advance(); f.state.failure = true;
  await restarted.refresh();
  expect(restarted.history).toStrictEqual(f.updated);
  await restarted.stop();
  const offline = f.open(); await offline.start(); await offline.refresh();
  expect(offline.history).toStrictEqual(f.updated);
  // A newer bundled catalog wins over the downloaded cache on an app upgrade.
  const upgraded = f.open({ history: f.bundled.history, manifest: createPricingManifest(f.bundled.history, '2026-11-17T00:00:00.000Z') });
  await upgraded.start(); await upgraded.refresh();
  expect(upgraded.history).toStrictEqual(f.bundled.history);
});

it('retains the last valid cache on corrupt, incompatible, oversized or older remote data', async () => {
  const f = await fixture(); const catalog = f.open(); await catalog.start(); await catalog.refresh();
  const next = structuredClone(f.updated);
  next.openai['gpt-6-sol'].cost.at(-1)!.rates!.text!.input!.price = 5;
  const nextManifest = createPricingManifest(next, '2026-11-16T00:00:00Z');
  const failures = [
    () => { f.state.manifest = { ...f.manifest, schemaVersion: 2 }; },
    () => { f.state.manifest = { ...f.manifest, asset: 'https://other.example/catalog.json' }; },
    () => { f.state.manifest = createPricingManifest(f.bundled.history, '2026-10-02T00:00:00.000Z'); },
    () => { f.state.body = encodePricingHistory(f.bundled.history); },
    () => { f.state.body = '{}'; },
    () => { f.state.body = '{'; },
    () => { f.state.body = ' '.repeat(4 * 1024 * 1024 + 1); },
  ];
  for (const fail of failures) {
    f.advance(); f.state.manifest = nextManifest; f.state.body = encodePricingHistory(next);
    fail(); await catalog.refresh();
    expect(catalog.history).toStrictEqual(f.updated);
  }
  await catalog.stop();
  const saved = JSON.parse(await readFile(f.cacheFile, 'utf8'));
  expect(saved.catalog.history).toStrictEqual(f.updated);
  // An interrupted/corrupt local write never prevents startup or bundled estimates.
  await writeFile(f.cacheFile, '{'); f.state.failure = true;
  const restored = f.open(); await restored.start(); await restored.refresh();
  expect(restored.history).toStrictEqual(f.bundled.history);
});

it('refreshes on the daily timer, coalesces overlapping checks and cancels scheduling on shutdown', async () => {
  const f = await fixture();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const catalog = f.open();
  try {
    await catalog.start();
    await Promise.all([catalog.refresh(), catalog.refresh()]);
    expect(f.state.requests).toHaveLength(2);
    f.advance();
    await vi.advanceTimersByTimeAsync(day);
    await catalog.refresh();
    expect(f.state.requests).toHaveLength(3); // Same revision only downloads the manifest.
    await catalog.stop();
    f.advance(); await vi.advanceTimersByTimeAsync(day);
    expect(f.state.requests).toHaveLength(3);
  } finally { await catalog.stop(); vi.useRealTimers(); }
});

it('starts offline immediately and aborts an unfinished download on shutdown', async () => {
  const f = await fixture(); f.state.hold = true;
  const catalog = f.open();
  await catalog.start();
  expect(catalog.history).toStrictEqual(f.bundled.history);
  await vi.waitFor(() => expect(f.state.requests).toEqual(['/latest.json']));
  await catalog.stop();
  await catalog.refresh();
  expect(f.state.requests).toHaveLength(1);
  expect(catalog.history).toStrictEqual(f.bundled.history);
});
