import sql from "./metrics.sql?raw";
import { isUtcDay } from "@workspace/core/usage";
import { telemetryModels } from "@workspace/core/telemetry-models";
import type { TelemetryMetricsFilter } from "@workspace/core/telemetry-metrics";

export const metricsSql = sql;
/** Explicit ten-year bound. Wider requests fail; totals never silently truncate.
 * Historical ranges have no ingestion-age limit. Only completed UTC days count.
 */
export function metricsFilter(
  params: URLSearchParams,
  now: number,
): TelemetryMetricsFilter | null {
  const keys = ["from", "to", "provider", "model"];
  if (
    [...params.keys()].some((k) => !keys.includes(k)) ||
    keys.some((k) => params.getAll(k).length > 1)
  )
    return null;
  const from = params.get("from"),
    to = params.get("to");
  if (
    !isUtcDay(from) ||
    !isUtcDay(to) ||
    from > to ||
    to >= new Date(now).toISOString().slice(0, 10) ||
    Date.parse(to) - Date.parse(from) > 3659 * 86400000
  )
    return null;
  const provider = params.get("provider"),
    model = params.get("model");
  if (
    provider !== null &&
    !["codex", "claude", "antigravity"].includes(provider)
  )
    return null;
  if (
    model !== null &&
    model !== "unknown" &&
    !(telemetryModels as readonly string[]).includes(model)
  )
    return null;
  return { from, to, provider, model } as TelemetryMetricsFilter;
}
