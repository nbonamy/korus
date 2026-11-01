import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PricingHistory } from './schema';

export const pricingReleaseTag = 'pricing-data-v1';
export const pricingManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: z.iso.datetime(),
  asset: z.string().regex(/^catalog-[a-f0-9]{64}\.json$/),
}).refine(value => value.asset === `catalog-${value.version}.json`, { message: 'Pricing asset must match its content revision' });
export type PricingManifest = z.infer<typeof pricingManifestSchema>;

/** Hash the schema-normalized JSON, independent of file indentation. */
export function encodePricingHistory(history: PricingHistory): string {
  return JSON.stringify(history, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, (value as Record<string, unknown>)[key]]))
    : value);
}
export function pricingVersion(history: PricingHistory): string {
  return createHash('sha256').update(encodePricingHistory(history)).digest('hex');
}
export function createPricingManifest(history: PricingHistory, publishedAt: string): PricingManifest {
  const version = pricingVersion(history);
  return pricingManifestSchema.parse({ schemaVersion: 1, version, publishedAt, asset: `catalog-${version}.json` });
}
