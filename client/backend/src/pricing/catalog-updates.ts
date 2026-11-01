import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { product } from '@workspace/core/product';
import { loadBundledPricing } from './catalog';
import { pricingHistorySchema, type PricingHistory } from './schema';
import { pricingManifestSchema, pricingReleaseTag, pricingVersion, type PricingManifest } from './release-format';

const day = 24 * 60 * 60 * 1000;
const maxCatalogBytes = 4 * 1024 * 1024;
type Catalog = { manifest: PricingManifest; history: PricingHistory };
type Options = { cacheFile: string; bundled?: Catalog; baseUrl?: string; now?: () => number };

/** Daemon-owned offline-first catalog. Only validated, newer snapshots replace prices. */
export class PricingCatalog {
  private active: Catalog;
  private checkedAt = 0;
  private pending: Promise<void> | undefined;
  private stopped = false;
  private readonly abort = new AbortController();
  private readonly now: () => number;
  private readonly baseUrl: string;
  constructor(private readonly options: Options) {
    this.active = options.bundled ?? loadBundledPricing();
    this.now = options.now ?? Date.now;
    this.baseUrl = options.baseUrl ?? `${product.repositoryUrl}/releases/download/${pricingReleaseTag}/`;
  }
  get history(): PricingHistory { return this.active.history; }

  async start(): Promise<void> {
    try {
      if ((await stat(this.options.cacheFile)).size > maxCatalogBytes * 2) throw new Error('Pricing cache too large');
      const saved = JSON.parse(await readFile(this.options.cacheFile, 'utf8'));
      if (saved.schemaVersion !== 1) throw new Error('Incompatible pricing cache');
      const cached = this.decode(saved.catalog);
      if (Date.parse(cached.manifest.publishedAt) > Date.parse(this.active.manifest.publishedAt)) this.active = cached;
      if (Number.isFinite(saved.checkedAt) && saved.checkedAt > 0 && saved.checkedAt <= this.now()) this.checkedAt = saved.checkedAt;
    } catch { /* Missing, corrupt or incompatible cache leaves bundled pricing usable. */ }
  }

  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.stopped) return Promise.resolve();
    if (this.checkedAt > this.now()) this.checkedAt = 0;
    if (this.checkedAt && this.now() - this.checkedAt < day) return Promise.resolve();
    this.checkedAt = this.now();
    this.pending = this.check().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async check(): Promise<void> {
    try {
      const manifest = pricingManifestSchema.parse(await this.download('latest.json', 4096));
      if (Date.parse(manifest.publishedAt) > Date.parse(this.active.manifest.publishedAt) && manifest.version !== this.active.manifest.version) {
        const history = pricingHistorySchema.parse(await this.download(manifest.asset, maxCatalogBytes));
        const candidate = this.decode({ manifest, history });
        if (this.stopped) return;
        await this.save(candidate);
        if (!this.stopped) this.active = candidate;
        return;
      }
    } catch { /* Retain the last valid prices on network, validation or persistence failure. */ }
    if (!this.stopped) await this.save(this.active).catch(() => undefined);
  }

  private decode(value: unknown): Catalog {
    const candidate = value as Catalog | undefined;
    const manifest = pricingManifestSchema.parse(candidate?.manifest);
    const history = pricingHistorySchema.parse(candidate?.history);
    if (pricingVersion(history) !== manifest.version) throw new Error('Pricing catalog digest mismatch');
    return { manifest, history };
  }

  private async download(asset: string, limit: number): Promise<unknown> {
    const response = await fetch(new URL(asset, this.baseUrl), {
      headers: { Accept: 'application/json', 'User-Agent': `${product.slug}-pricing-updater` },
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw new Error('Pricing download unavailable');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('Pricing download too large');
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => undefined); }
  }

  private async save(catalog: Catalog): Promise<void> {
    await mkdir(path.dirname(this.options.cacheFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.options.cacheFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, checkedAt: this.checkedAt, catalog }), { mode: 0o600 });
      await rename(temporary, this.options.cacheFile);
    } finally { await rm(temporary, { force: true }); }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    await this.pending;
  }
}
