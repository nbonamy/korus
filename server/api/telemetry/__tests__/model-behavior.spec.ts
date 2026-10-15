import { expect, it } from "vitest";
import { summarizeModelBehavior } from "../model-behavior";
import type { OperatorRow } from "../aggregate-store";
const row = (
  metric: string,
  total: number,
  day = "2026-10-10",
): OperatorRow => ({
  day,
  metric: "behavior." + metric,
  total,
  dimension: "model",
  value: "claude-sonnet-4-6",
  reports: 10,
});
it("uses only paired model/day measurements, preserves observed zero, and weights rates by their actual denominators", () => {
  const rows = [
    row("responses", 60),
    row("responsesObserved", 20),
    row("toolCalls", 0),
    row("toolsObserved", 20),
    row("streamTokens", 1000),
    row("streamMs", 20000),
    row("streamResponses", 20),
    row("completed", 20),
    row("failed", 0),
    row("terminalObserved", 20),
    row("durationMs", 400000),
    row("durationObserved", 20),
    row("multiToolResponses", 30),
    row("reasoningTokens", 200),
    row("reasoningOutput", 1000),
    row("reasoningObserved", 20),
    row("streamTokens", 2000, "2026-10-11"),
    row("streamMs", 20000, "2026-10-11"),
    row("streamResponses", 10, "2026-10-11"),
    row("responses", 999, "2026-10-12"),
  ];
  const metrics = summarizeModelBehavior(rows)[0]!.metrics;
  expect(metrics.responsesPerTurn).toStrictEqual({
    value: 3,
    samples: 20,
    days: 1,
  });
  expect(metrics.toolsPerTurn).toStrictEqual({
    value: 0,
    samples: 20,
    days: 1,
  });
  expect(metrics.streamRate).toStrictEqual({ value: 75, samples: 30, days: 2 });
  expect(metrics.duration.value).toBe(20);
  expect(metrics.multiToolShare.value).toBe(50);
  expect(metrics.reasoningShare.value).toBe(20);
  expect(metrics.completedRate.value).toBe(100);
  expect(metrics.failedRate.value).toBe(0);
  expect(metrics.interruptedRate.value).toBeNull();
});
it("keeps unsupported, unmatched and non-model marginals out of model comparisons", () => {
  expect(
    summarizeModelBehavior([
      { ...row("responses", 10), dimension: "provider" },
    ]),
  ).toStrictEqual([]);
  expect(
    summarizeModelBehavior([row("responses", 10)])[0]!.metrics.responsesPerTurn,
  ).toStrictEqual({ value: null, samples: null, days: 0 });
  expect(
    summarizeModelBehavior([
      row("reasoningTokens", 20),
      row("reasoningOutput", 10),
      row("reasoningObserved", 10),
    ])[0]!.metrics.reasoningShare.value,
  ).toBeNull();
});
