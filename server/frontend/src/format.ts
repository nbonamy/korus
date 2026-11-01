import { dayOf } from "@workspace/core/usage-time";
/** Display formatting never changes the exact aggregate values received. */
export function count(value: string | null): string {
  if (value === null) return "Unavailable";
  const [integer, fraction] = value.split(".");
  return (
    BigInt(integer!).toLocaleString("en-US") + (fraction ? `.${fraction}` : "")
  );
}
export function tokens(value: string | null): string {
  if (value === null) return "Unavailable";
  const number = BigInt(value);
  const units = ["", "K", "M", "B", "T", "Q"];
  let unit = 0,
    divisor = 1n;
  while (number >= divisor * 1000n && unit < units.length - 1) {
    unit++;
    divisor *= 1000n;
  }
  if (!unit) return count(value);
  let tenths = (number * 10n + divisor / 2n) / divisor;
  if (tenths >= 10000n && unit < units.length - 1) {
    unit++;
    divisor *= 1000n;
    tenths = (number * 10n + divisor / 2n) / divisor;
  }
  return `${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ""}${units[unit]}`;
}
export function money(value: string | null): string {
  if (value === null) return "Unavailable";
  const [whole, fraction = ""] = value.split(".");
  const cents =
    BigInt(whole!) * 100n +
    BigInt((fraction + "00").slice(0, 2)) +
    (Number(fraction[2] ?? 0) >= 5 ? 1n : 0n);
  if (cents === 0n && /[1-9]/.test(value)) return "<$0.01";
  return `$${count(String(cents / 100n))}.${String(cents % 100n).padStart(2, "0")}`;
}
export const exactMoney = (value: string | null) =>
  value === null ? "Unavailable" : `$${count(value)}`;
export const percent = (value: number | null) =>
  value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value);
export const rate = (value: string | null) =>
  value === null ? "Unavailable" : `${Number(value).toFixed(1)} tok/s`;
export const duration = (value: string | null) =>
  value === null ? "Unavailable" : `${(Number(value) / 1000).toFixed(1)} s`;
export type Measure =
  | "count"
  | "tokens"
  | "usd"
  | "ratio"
  | "rate"
  | "milliseconds";
export const measurement = (value: string | null, measure: Measure) =>
  measure === "rate"
    ? rate(value)
    : measure === "milliseconds"
      ? duration(value)
      : measure === "usd"
        ? money(value)
        : measure === "ratio"
          ? percent(value === null ? null : Number(value))
          : measure === "tokens"
            ? tokens(value)
            : count(value);
export const exactMeasurement = (value: string | null, measure: Measure) =>
  measure === "usd"
    ? exactMoney(value)
    : measure === "ratio"
      ? value === null
        ? "Unavailable"
        : String(Number(value) * 100) + "%"
      : count(value);
export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
export const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const completedDay = (timeZone = viewerTimeZone()) =>
  utcDay(Date.parse(dayOf(Date.now(),timeZone)) - 86400000);
export function plotValue(value: string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) &&
    number >= 0 &&
    number <= Number.MAX_SAFE_INTEGER &&
    (number !== 0 || !/[1-9]/.test(value))
    ? number
    : null;
}
