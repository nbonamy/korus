import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { metrics } from "./metrics-fixture";
export function reportFixture(
  from = "2026-10-19",
  to = "2026-11-01",
): TelemetryMetrics {
  const base = metrics() as TelemetryMetrics;
  const days = Array.from(
    { length: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 },
    (_, i) =>
      new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10),
  );
  const models: TelemetryMetrics["models"] = [
    {
      ...base.totals,
      provider: "codex",
      model: "gpt-6-sol",
      serviceTier: "fast",
      turns: "125",
      totalTokens: "2000000",
      estimatedCostUsd: "12.10000001",
    },
    {
      ...base.totals,
      provider: "codex",
      model: "gpt-6-astra",
      serviceTier: "standard",
      turns: "90",
      totalTokens: "1400000",
      estimatedCostUsd: "8.20000002",
    },
    {
      ...base.totals,
      provider: "claude",
      model: "claude-sonnet-5-5",
      serviceTier: "standard",
      turns: "40",
      totalTokens: "900000",
      estimatedCostUsd: "6.5",
    },
  ];
  return {
    ...base,
    range: { ...base.range, from, to },
    overview: {
      ...base.overview,
      participatingInstalls: "320",
      dau: "62",
      wau: "148",
      mau: "245",
    },
    totals: {
      ...base.totals,
      turns: "255",
      totalTokens: "4300000",
      inputTokens: "3500000",
      outputTokens: "800000",
      estimatedCostUsd: "26.80000003",
    },
    daily: days.map((day, i) => ({
      ...base.totals,
      day,
      turns: String(50 + (i % 7) * 8 + Math.floor(i / 7) * 12),
      totalTokens: String(100000 + (i % 7) * 20000),
      inputTokens: String(80000 + i * 4000),
      outputTokens: String(20000 + i * 1000),
      cacheReadShare: 0.4 + (i % 7) * 0.04,
      cacheReadTokens: String(40000 + i * 1000),
      nonCacheReadTokens: String(40000 + i * 3000),
      estimatedCostUsd: String(0.5 + (i % 7) * 0.3),
    })),
    activity: days.map((day, i) => ({
      day,
      activeInstalls: String(25 + (i % 7) * 6),
      firstReportedInstalls: String(2 + (i % 5)),
    })),
    models,
    modelDaily: days.flatMap((day, i) =>
      models.map((model, index) => ({
        ...model,
        day,
        performance: {
          speedTurns: "1",
          ttftTurns: "1",
          outputTokensPerSecond: String(30 + index * 20 + (i % 7) * 5),
          timeToFirstOutputMs: String(200 + index * 120 + (i % 7) * 25),
        },
      })),
    ),
  };
}
