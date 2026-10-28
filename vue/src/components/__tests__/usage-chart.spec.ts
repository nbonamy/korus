import { expect, it } from "vitest";
import {
  activityWindow,
  browserTimeZone,
  localDay,
  shiftDay,
  averageTtftSeconds,
  chartSeries,
  groupingOptions,
  niceScale,
  smoothPath,
  sumSpeed,
  tokensPerSecond,
  measureFormat,
  usdCompactFormat,
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

it("drops the cents from headline and axis figures once they reach $10, and keeps them below", () => {
  expect(usdCompactFormat(1041.24)).toBe("$1,041");
  expect(usdCompactFormat(400)).toBe("$400");
  expect(usdCompactFormat(9.99)).toBe("$9.99");
  expect(usdCompactFormat(0.04)).toBe("$0.04");
  expect(usdCompactFormat(null)).toBe("Unavailable");
  expect(measureFormat(1041.24, "cost")).toBe("$1,041");
  expect(measureFormat(1041.24, "cost", false)).toBe("$1,041.24");
});

it("names repositories by their folder, tells same-named ones apart, and names the two kinds of work that have none", () => {
  const series = chartSeries(
    summary(["/src/korus", "/work/api", "/home/api", "Unknown", "korus:missions"]),
    "turns",
    "repository",
  );
  expect(Object.fromEntries(series.map((entry) => [entry.key, entry.label]))).toStrictEqual({
    "/src/korus": "korus",
    "/work/api": "work/api",
    "/home/api": "home/api",
    Unknown: "Quick chats",
    "korus:missions": "Missions",
  });
  // Repositories never borrow a provider's colour: those hues mean Codex, Claude and Antigravity.
  expect(series.filter((entry) => entry.key !== "Unknown").every((entry) => !/--chart-[123]\)/.test(entry.color))).toBe(true);
  expect(groupingOptions().map((option) => option.value)).toStrictEqual(["provider", "model", "repository"]);
});

it("works out today and the activity window from the reader's own calendar, not UTC", () => {
  const lateEvening = Date.parse("2026-10-28T03:00:00Z"); // 10pm on the 27th in Chicago
  expect(localDay(lateEvening, "America/Chicago")).toBe("2026-10-27");
  expect(localDay(lateEvening, "UTC")).toBe("2026-10-28");
  expect(typeof browserTimeZone()).toBe("string");
  const window = activityWindow(lateEvening, "America/Chicago");
  expect(window.to).toBe("2026-10-27");
  // 2026-10-27 is a Tuesday: back to that Monday, then 52 more weeks.
  expect(window.from).toBe("2025-10-27");
  expect(activityWindow(lateEvening, "UTC").to).toBe("2026-10-28");
});

it("steps calendar days without being thrown by clock changes", () => {
  expect(shiftDay("2026-11-02", -1)).toBe("2026-11-01");
  expect(shiftDay("2026-03-09", -2)).toBe("2026-03-07");
  expect(shiftDay("2026-10-27", -6)).toBe("2026-10-21");
  expect(shiftDay("2026-12-30", 3)).toBe("2027-01-02");
});
