import type { UsageCost, UsageCostReason } from "@workspace/core/usage";
import type { RequestPrice } from "../pricing/evaluate";
export function emptyCost(): UsageCost {
  return {
    usd: null,
    coverage: "unavailable",
    requests: 0,
    pricedRequests: 0,
    unpricedRequests: 0,
    unknownRequestExecutions: 0,
    reasons: [],
  };
}
export function addCost(
  cost: UsageCost,
  price: RequestPrice | null,
  unknownReason?: UsageCostReason,
  execution = false,
): void {
  let reason: UsageCostReason | undefined;
  if (!execution && price !== null) cost.requests++;
  if (price && "usd" in price) {
    if (execution) cost.pricedExecutions = (cost.pricedExecutions ?? 0) + 1;
    else cost.pricedRequests++;
    cost.usd = Number(((cost.usd ?? 0) + price.usd).toPrecision(15));
    const regions = cost.pricingRegions ??= [];
    if (!regions.includes(price.region)) {
      regions.push(price.region);
      regions.sort((a, b) => (a ?? "").localeCompare(b ?? ""));
    }
  } else if (price === null || execution) {
    cost.unknownRequestExecutions++;
    reason =
      price && "reason" in price
        ? price.reason
        : (unknownReason ?? "unknown-request-coverage");
  } else {
    cost.unpricedRequests++;
    reason = price.reason;
  }
  if (reason) {
    const existing = cost.reasons.find((r) => r.reason === reason);
    if (existing) existing.count++;
    else cost.reasons.push({ reason, count: 1 });
    cost.reasons.sort((a, b) => a.reason.localeCompare(b.reason));
  }
  cost.coverage =
    cost.pricedRequests + (cost.pricedExecutions ?? 0) === 0
      ? "unavailable"
      : cost.unpricedRequests || cost.unknownRequestExecutions
        ? "partial"
        : "complete";
}
