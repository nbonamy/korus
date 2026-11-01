import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";

export function modelLabel(row: TelemetryMetrics["models"][number]): string {
  const tier = row.serviceTier;
  if (tier === null || tier === "standard") return row.model;
  const labels = {
    fast: "Fast",
    ultrafast: "Ultrafast",
    flex: "Flex",
    batch: "Batch",
    scale: "Scale",
    unknown: "Unknown tier",
  };
  return `${row.model} · ${labels[tier ?? "unknown"]}`;
}
