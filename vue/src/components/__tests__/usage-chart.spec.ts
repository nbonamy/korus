import { expect, it } from "vitest";
import {
  averageTtftSeconds,
  chartSeries,
  niceScale,
  smoothPath,
  sumSpeed,
  tokensPerSecond,
} from "../usage-chart";
const summary = (labels: string[]) => ({
  recordedSince: 1,
  retainedSince: 1,
  rows: labels.map((label) => ({
    label,
    started: 1,
    completed: 1,
    failed: 0,
    interrupted: 0,
    inProgress: 0,
    measuredTurns: 0,
    tokens: null,
  })),
});
it("rounds axis maximums up to clean steps", () => {
  expect(niceScale(0)).toStrictEqual({ max: 4, step: 1 });
  expect(niceScale(40)).toStrictEqual({ max: 40, step: 10 });
  expect(niceScale(47)).toStrictEqual({ max: 80, step: 20 });
  expect(niceScale(1234).max).toBeGreaterThanOrEqual(1234);
});
it("keeps an entity's colour across filters and groups models by provider hue", () => {
  const alone = chartSeries(summary(["claude"]), "turns", "provider");
  const together = chartSeries(
    summary(["codex", "claude", "antigravity"]),
    "turns",
    "provider",
  );
  expect(together.find((s) => s.key === "claude")!.color).toBe(alone[0]!.color);
  const models = chartSeries(
    summary(["claude-opus-4-6", "gpt-5.4", "Unknown"]),
    "turns",
    "model",
  );
  expect(models.find((s) => s.key === "claude-opus-4-6")!.color).toContain(
    "--chart-2",
  );
  expect(models.find((s) => s.key === "gpt-5.4")!.color).toContain("--chart-1");
  expect(models.find((s) => s.key === "Unknown")!.color).toContain(
    "--color-text-muted",
  );
});
it("draws a smooth path that never overshoots its points", () => {
  const path = smoothPath([
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 10 },
  ]);
  expect(path.startsWith("M0 10C")).toBe(true);
  const ys = [...path.matchAll(/C([\d. -]+)/g)].flatMap((m) =>
    m[1]!
      .trim()
      .split(" ")
      .map(Number)
      .filter((_, i) => i % 2 === 1),
  );
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  expect(smoothPath([])).toBe("");
});
it("weights speed and time to first token by the turns they were measured on", () => {
  const speed = sumSpeed([
    {
      turns: 1,
      outputTokens: 100,
      generationMs: 1000,
      ttftMs: 1000,
      ttftTurns: 1,
    },
    {
      turns: 1,
      outputTokens: 100,
      generationMs: 9000,
      ttftMs: 3000,
      ttftTurns: 1,
    },
    undefined,
  ]);
  // 200 tokens over 10 seconds, not the mean of 100 and 11 tokens/s.
  expect(tokensPerSecond(speed)).toBe(20);
  expect(averageTtftSeconds(speed)).toBe(2);
  expect(tokensPerSecond(undefined)).toBeNull();
  expect(averageTtftSeconds(sumSpeed([]))).toBeNull();
});
