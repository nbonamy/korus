import { dayOf } from "@workspace/core/usage-time";
import sql from "./metrics.sql?raw";
import { isUtcDay } from "@workspace/core/usage";
import type { TelemetryMetricsFilter } from "@workspace/core/telemetry-metrics";

export const metricsSql = sql;
/** Explicit ten-year bound. Wider requests fail; totals never silently truncate.
 * Historical ranges have no ingestion-age limit. The current viewer day includes reports received so far.
 */
export function metricsFilter(
  params: URLSearchParams,
  now: number,
): TelemetryMetricsFilter | null {
  const keys = ["from", "to", "provider", "model", "groupServiceTiers", "timeZone"];
  if (
    [...params.keys()].some((k) => !keys.includes(k)) ||
    keys.some((k) => params.getAll(k).length > 1)
  )
    return null;
  const timeZone = params.get("timeZone") ?? "UTC";
  // Reject offset/POSIX forms whose semantics differ between ICU and PostgreSQL.
  if (timeZone.length > 100 || (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(timeZone) && timeZone !== "UTC")) return null;
  let today: string;
  try { today = dayOf(now,timeZone); } catch { return null; }
  const from = params.get("from"),
    to = params.get("to");
  if (
    !isUtcDay(from) ||
    !isUtcDay(to) ||
    from > to ||
    to > today ||
    Date.parse(to) - Date.parse(from) > 3659 * 86400000
  )
    return null;
  const provider = params.get("provider"),
    model = params.get("model");
  if (
    provider !== null &&
    provider.length === 0
  )
    return null;
  if (model !== null && model.length === 0) return null;
  const grouping = params.get("groupServiceTiers");
  if (grouping !== null && grouping !== "true" && grouping !== "false")
    return null;
  return {
    from,
    to,
    timeZone,
    provider,
    model,
    groupServiceTiers: grouping === "true",
  } as TelemetryMetricsFilter;
}
