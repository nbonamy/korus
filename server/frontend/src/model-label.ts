import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";

export function modelLabel(row: TelemetryMetrics["models"][number]): string {
  const tier = row.serviceTier;
  if (tier === null || tier === "standard") return row.model;
  const labels = {
    fast: "fast",
    ultrafast: "Ultrafast",
    flex: "Flex",
    batch: "Batch",
    scale: "Scale",
    unknown: "Unknown tier",
  };
  return `${row.model} · ${labels[tier ?? "unknown"]}`;
}

export function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    codex: "Codex", claude: "Claude", antigravity: "Antigravity", cursor: "Cursor",
  };
  return Object.hasOwn(labels, provider) ? labels[provider]! : provider;
}
