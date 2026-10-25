import type {
  RequestObservation,
  UsageCostReason,
} from "@workspace/core/usage";
import type { PricingHistory } from "./schema";

type ObjectValue = { [key: string]: unknown };
type Match = boolean | null;
export type RequestPrice =
  | { usd: number; snapshot: string }
  | { reason: UsageCostReason };
const object = (v: unknown): v is ObjectValue =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const all = (values: Match[]): Match =>
  values.includes(false) ? false : values.includes(null) ? null : true;
const any = (values: Match[]): Match =>
  values.includes(true) ? true : values.includes(null) ? null : false;

function matches(predicate: ObjectValue, evidence: ObjectValue): Match {
  return all(
    Object.entries(predicate).map(([field, condition]): Match => {
      if (field === "all")
        return all(
          (condition as ObjectValue[]).map((p) => matches(p, evidence)),
        );
      if (field === "any")
        return any(
          (condition as ObjectValue[]).map((p) => matches(p, evidence)),
        );
      if (field === "not") {
        const m = matches(condition as ObjectValue, evidence);
        return m === null ? null : !m;
      }
      const value = evidence[field];
      if (value === undefined || value === null) return null;
      return all(
        Object.entries(condition as ObjectValue).map(([op, expected]) => {
          if (op === "equals") return value === expected;
          if (op === "in") return (expected as unknown[]).includes(value);
          if (
            typeof value !== typeof expected ||
            !["string", "number"].includes(typeof value)
          )
            return null;
          // Dates use ISO UTC strings; numeric context comparisons remain numeric.
          if (op === "gt") return (value as number) > (expected as number);
          if (op === "gte") return (value as number) >= (expected as number);
          if (op === "lt") return (value as number) < (expected as number);
          if (op === "lte") return (value as number) <= (expected as number);
          return null;
        }),
      );
    }),
  );
}
function merge(base: ObjectValue, patch: ObjectValue): ObjectValue {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "when") continue;
    result[key] =
      object(value) && object(result[key]) ? merge(result[key], value) : value;
  }
  return result;
}
function factorAt(factor: unknown, path: string[]): number {
  if (typeof factor === "number") return factor;
  if (!path.length || !object(factor)) return 1;
  return factorAt(factor[path[0]], path.slice(1));
}

/** Evaluate one request before aggregation. Missing evidence never selects a default branch. */
export function priceRequest(
  request: RequestObservation,
  history: PricingHistory,
): RequestPrice {
  const fail = (reason: UsageCostReason): RequestPrice => ({ reason });
  if (request.unavailableReason) return fail(request.unavailableReason);
  if (request.status !== "final") return fail("provisional-usage");
  const snapshot = [...history]
    .reverse()
    .find((s) => Date.parse(s.date) <= request.at);
  if (!snapshot) return fail("before-pricing-history");
  if (!request.apiProvider) return fail("unknown-provider");
  const model = snapshot[request.apiProvider].find(
    (m) => m.id === request.model,
  );
  if (!model) return fail("unknown-model");
  if (!model.cost) return fail("unpriced-model");
  if (request.modality !== "text") return fail("unsupported-token-modality");
  const t = request.tokens;
  if (
    t.input === null ||
    t.output === null ||
    (t.reasoning === null && t.outputIncludesReasoning !== true)
  )
    return fail("missing-token-usage");
  if (t.cacheRead === null || t.cacheWrite === null)
    return fail("missing-cache-usage");
  if (
    t.inputIncludesCacheRead === null ||
    t.inputIncludesCacheWrite === null ||
    t.outputIncludesReasoning === null
  )
    return fail("missing-token-semantics");
  const writes = Object.values(t.cacheWrite).reduce((a, b) => a + b, 0);
  const input =
    t.input -
    (t.inputIncludesCacheRead ? t.cacheRead : 0) -
    (t.inputIncludesCacheWrite ? writes : 0);
  // An unknown subset needs no allocation when all inclusive output has the same rate.
  // Retain null in the observation; require the split if rates/adjustments differ.
  const reasoning = t.reasoning ?? 0;
  const output = t.output - (t.outputIncludesReasoning ? reasoning : 0);
  if (input < 0 || output < 0) return fail("inconsistent-token-usage");
  // Anthropic reports capacity tier and inference speed separately. The source
  // catalog calls fast speed a pricing service_tier; preserve both reported values.
  const anthropicSpeed =
    request.apiProvider === "anthropic" &&
    ["standard", "fast"].includes(request.reportedMode ?? "");
  if (anthropicSpeed && request.reportedServiceTier !== "standard")
    return fail(
      request.reportedServiceTier
        ? "unsupported-service-tier"
        : "missing-service-tier",
    );
  const pricingMode =
    anthropicSpeed && request.reportedMode === "standard"
      ? null
      : request.reportedMode;
  let mode = pricingMode ? model.modes?.[pricingMode] : undefined;
  if (pricingMode && !mode) return fail("unsupported-mode");
  const tier =
    (anthropicSpeed
      ? request.reportedMode === "fast"
        ? "fast"
        : "standard"
      : null) ??
    request.reportedServiceTier ??
    mode?.service_tier ??
    request.defaultServiceTier?.tier ??
    null;
  const tierRules =
    (model.serviceTiers?.length ?? 0) > 0 ||
    Object.values(model.modes ?? {}).some((m) => m.service_tier);
  if (tierRules && !tier) return fail("missing-service-tier");
  const knownTiers = new Set([
    "standard",
    "default",
    ...(model.serviceTiers ?? []),
    ...Object.values(model.modes ?? {}).flatMap((m) =>
      m.service_tier ? [m.service_tier] : [],
    ),
  ]);
  if (tier && !knownTiers.has(tier)) return fail("unsupported-service-tier");
  let cost: ObjectValue = model.cost;
  if (mode?.service_tier && mode.service_tier !== tier)
    return fail("unsupported-service-tier");
  if (!mode) {
    const options = Object.values(model.modes ?? {}).filter(
      (m) => m.cost && m.service_tier === tier,
    );
    if (options.length > 1) return fail("unsupported-mode");
    mode = options[0];
    if (Object.values(model.modes ?? {}).some((m) => m.cost && !m.service_tier))
      return fail("unsupported-mode");
  }
  if (mode?.cost) cost = merge(cost, mode.cost);
  const evidence = {
    ...request.pricingContext,
    service_tier: tier,
    date: new Date(request.at).toISOString().slice(0, 10),
  };
  const text = object(cost.text) ? cost.text : {};
  let reasoningCategory = false;
  const totals: { count: number; path: string[]; rate: unknown }[] = [];
  for (const direction of ["input", "output"] as const) {
    const count =
      direction === "input" ? input + t.cacheRead + writes : output + reasoning;
    if (count === 0) continue;
    const base = text[direction];
    if (!object(base) || base.unit !== "token")
      return fail("missing-token-rate");
    let prices = { ...base };
    for (const override of (base.overrides ?? []) as ObjectValue[]) {
      const applies = matches(override.when as ObjectValue, evidence);
      if (applies === null)
        return fail(
          tier === null ? "missing-service-tier" : "missing-pricing-context",
        );
      if (applies) prices = merge(prices, override);
    }
    if (direction === "output") {
      reasoningCategory = prices.reasoning !== undefined;
      if (
        t.reasoning === null &&
        t.output > 0 &&
        prices.reasoning !== undefined &&
        prices.reasoning !== prices.price
      )
        return fail("missing-token-usage");
      totals.push({
        count: output,
        path: ["text", "output", "price"],
        rate: prices.price,
      });
      totals.push({
        count: reasoning,
        path: [
          "text",
          "output",
          prices.reasoning === undefined ? "price" : "reasoning",
        ],
        rate: prices.reasoning ?? prices.price,
      });
    } else {
      totals.push({
        count: input,
        path: ["text", "input", "price"],
        rate: prices.price,
      });
      const cache = object(prices.cache) ? prices.cache : {};
      if ((t.cacheRead > 0 || writes > 0) && request.cacheMode === null)
        return fail("missing-cache-usage");
      const cachePrices =
        request.cacheMode === "explicit" && object(cache.explicit)
          ? merge(cache, cache.explicit)
          : cache;
      const cachePath =
        request.cacheMode === "explicit" && object(cache.explicit)
          ? ["text", "input", "cache", "explicit"]
          : ["text", "input", "cache"];
      totals.push({
        count: t.cacheRead,
        path: [...cachePath, "read"],
        rate: cachePrices.read,
      });
      for (const [lifetime, count] of Object.entries(t.cacheWrite)) {
        const rate = object(cachePrices.write)
          ? cachePrices.write[lifetime]
          : cachePrices.write;
        totals.push({
          count,
          path: [
            ...cachePath,
            "write",
            ...(object(cachePrices.write) ? [lifetime] : []),
          ],
          rate,
        });
      }
    }
  }
  const multipliers: unknown[] = [];
  for (const multiplier of (cost.multipliers ?? []) as ObjectValue[]) {
    // Unknown reasoning may still be affected even though it has no allocated count.
    const affectsUnknownReasoning =
      reasoningCategory &&
      t.reasoning === null &&
      t.output > 0 &&
      factorAt(multiplier.factor, ["text", "output", "reasoning"]) !== 1;
    // A rule on a different modality cannot affect these token categories.
    if (
      !totals.some(
        (t) => t.count > 0 && factorAt(multiplier.factor, t.path) !== 1,
      ) &&
      !affectsUnknownReasoning
    )
      continue;
    const applies = matches(multiplier.when as ObjectValue, evidence);
    if (applies === null)
      return fail(
        tier === null &&
          JSON.stringify(multiplier.when).includes("service_tier")
          ? "missing-service-tier"
          : "missing-pricing-context",
      );
    if (applies) {
      if (
        reasoningCategory &&
        t.reasoning === null &&
        t.output > 0 &&
        factorAt(multiplier.factor, ["text", "output", "reasoning"]) !==
          factorAt(multiplier.factor, ["text", "output", "price"])
      )
        return fail("missing-token-usage");
      multipliers.push(multiplier.factor);
    }
  }
  let usd = 0;
  for (const item of totals) {
    if (item.count === 0) continue;
    if (typeof item.rate !== "number")
      return fail(
        item.path.includes("cache")
          ? "missing-cache-rate"
          : "missing-token-rate",
      );
    usd +=
      (item.count *
        item.rate *
        multipliers.reduce<number>((n, f) => n * factorAt(f, item.path), 1)) /
      1e6;
  }
  return { usd: Number(usd.toPrecision(15)), snapshot: snapshot.date };
}
