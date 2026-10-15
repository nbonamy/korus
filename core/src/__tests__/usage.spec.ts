import { expect, it } from "vitest";
import { isUtcDay, utcDay, validExecutionTiming } from "../usage";

it("groups timestamps by UTC day and rejects normalized or invalid calendar filters", () => {
  expect(utcDay(Date.parse("2026-10-15T23:30:00-05:00"))).toBe("2026-10-16");
  expect(isUtcDay("2024-02-29")).toBe(true);
  for (const day of [
    "2026-02-29",
    "2026-13-01",
    "2026-10-15T00:00:00Z",
    " 2026-10-15",
    "2026-1-1",
    null,
  ])
    expect(isUtcDay(day)).toBe(false);
});
it("accepts bounded timing and rejects empty spans, a first output after the end, unsafe numbers and extra properties", () => {
  expect(validExecutionTiming({ activeMs: 1000, ttftMs: 200 })).toBe(true);
  expect(validExecutionTiming({ activeMs: 1000, ttftMs: null })).toBe(true);
  for (const value of [
    null,
    [],
    { activeMs: 0, ttftMs: null },
    { activeMs: 1000, ttftMs: 1001 },
    { activeMs: 1000, ttftMs: -1 },
    { activeMs: 1.5, ttftMs: null },
    { activeMs: 1000 },
    { activeMs: 1000, ttftMs: null, content: "private" },
  ])
    expect(validExecutionTiming(value)).toBe(false);
});
