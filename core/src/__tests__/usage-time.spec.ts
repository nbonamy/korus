import { describe, expect, it } from "vitest";
import { dayOf, dayStart, nextDay, validTimeZone } from "../usage-time";

const hour = 3_600_000;

describe("usage days in a timezone", () => {
  it("assigns a late-evening turn to the local day it happened on", () => {
    const at = Date.parse("2026-10-28T03:00:00Z");
    expect(dayOf(at, "America/Chicago")).toBe("2026-10-27");
    expect(dayOf(at, "UTC")).toBe("2026-10-28");
    expect(dayOf(at)).toBe("2026-10-28");
    expect(dayOf(Date.parse("2026-10-27T18:30:00Z"), "Asia/Kolkata")).toBe("2026-10-28");
  });

  it("starts a day at local midnight, whatever the offset", () => {
    expect(dayStart("2026-10-27", "America/Chicago")).toBe(Date.parse("2026-10-27T05:00:00Z"));
    expect(dayStart("2026-12-01", "America/Chicago")).toBe(Date.parse("2026-12-01T06:00:00Z"));
    expect(dayStart("2026-10-27", "Asia/Kolkata")).toBe(Date.parse("2026-10-26T18:30:00Z"));
    expect(dayStart("2026-10-27", "UTC")).toBe(Date.parse("2026-10-27T00:00:00Z"));
    expect(dayStart("2026-10-27")).toBe(Date.parse("2026-10-27T00:00:00Z"));
  });

  it("lets a day be 23 or 25 hours long when the clocks change", () => {
    const length = (day: string) => dayStart(nextDay(day), "America/Chicago") - dayStart(day, "America/Chicago");
    expect(length("2026-11-01")).toBe(25 * hour);
    expect(length("2026-03-08")).toBe(23 * hour);
    expect(length("2026-06-15")).toBe(24 * hour);
  });

  it("agrees with itself: the first instant of a day belongs to it and the instant before does not", () => {
    for (const zone of ["America/Chicago", "Asia/Kolkata", "Pacific/Auckland", "UTC"]) {
      for (const day of ["2026-03-08", "2026-11-01", "2026-10-27"]) {
        const start = dayStart(day, zone);
        expect(dayOf(start, zone)).toBe(day);
        expect(dayOf(start - 1, zone)).not.toBe(day);
      }
    }
  });

  it("steps calendar days and recognizes real timezones only", () => {
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(validTimeZone("America/Chicago")).toBe(true);
    expect(validTimeZone("Mars/Olympus")).toBe(false);
    expect(validTimeZone(5)).toBe(false);
    expect(validTimeZone("")).toBe(false);
  });
});
