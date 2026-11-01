import history from './history.json';
import manifest from './manifest.json';
import { pricingHistorySchema, type PricingHistory } from './schema';
import { pricingManifestSchema, pricingVersion } from './release-format';

// A static JSON import embeds the checked-in history in daemon.mjs. Both the
// standalone launcher and desktop resource copy use that self-contained bundle.
export function loadPricingHistory(): PricingHistory {
  return pricingHistorySchema.parse(history);
}

export function loadBundledPricing() {
  const bundled = { manifest: pricingManifestSchema.parse(manifest), history: loadPricingHistory() };
  if (pricingVersion(bundled.history) !== bundled.manifest.version) throw new Error('Bundled pricing manifest does not match history');
  return bundled;
}
