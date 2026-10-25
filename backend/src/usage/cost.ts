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
export function addCost(cost: UsageCost, price: RequestPrice | null): void {
  let reason: UsageCostReason | undefined;
  if (price === null) {
    cost.unknownRequestExecutions++;
    reason = "unknown-request-coverage";
  } else {
    cost.requests++;
    if ("usd" in price) {
      cost.pricedRequests++;
      cost.usd = Number(((cost.usd ?? 0) + price.usd).toPrecision(15));
    } else {
      cost.unpricedRequests++;
      reason = price.reason;
    }
  }
  if (reason) {
    const existing = cost.reasons.find((r) => r.reason === reason);
    if (existing) existing.count++;
    else cost.reasons.push({ reason, count: 1 });
    cost.reasons.sort((a, b) => a.reason.localeCompare(b.reason));
  }
  cost.coverage =
    cost.pricedRequests === 0
      ? "unavailable"
      : cost.unpricedRequests || cost.unknownRequestExecutions
        ? "partial"
        : "complete";
}
