import history from './history.json';
import { pricingHistorySchema, type PricingHistory } from './schema';

// A static JSON import embeds the checked-in history in daemon.mjs. Both the
// standalone launcher and desktop resource copy use that self-contained bundle.
export function loadPricingHistory(): PricingHistory {
  return pricingHistorySchema.parse(history);
}
