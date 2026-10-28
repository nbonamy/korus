/**
 * Usage is stored with exact timestamps; "which day" is only decided when it is read, in the reader's
 * own timezone, so a turn at 10pm in Chicago counts for that evening rather than for tomorrow in UTC.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(timeZone, found);
  }
  return found;
}

/** The wall clock in `timeZone` at `at`, read as if it were UTC, so the difference to `at` is the zone's offset. */
function wallClock(at: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(at)) if (part.type !== "literal") parts[part.type] = Number(part.value);
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The calendar day (YYYY-MM-DD) that instant falls on in `timeZone`. */
export function dayOf(at: number, timeZone = "UTC"): string {
  const local = new Date(wallClock(at, timeZone));
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** The instant a calendar day begins in `timeZone`. */
export function dayStart(day: string, timeZone = "UTC"): number {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const midnight = Date.UTC(year, month - 1, date);
  // The offset can differ between midnight UTC and local midnight around a clock change, so settle it twice.
  const first = midnight - (wallClock(midnight, timeZone) - midnight);
  return midnight - (wallClock(first, timeZone) - first);
}

/** The calendar day after `day`; plain date arithmetic, unaffected by clock changes. */
export function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
