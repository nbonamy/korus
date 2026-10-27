/** Preserve PostgreSQL's exact strings in labels/tables, even above 2^53 or
 * below one cent. Lossy conversion is confined to the bounded plot coordinates.
 */
export function count(value: string | null): string {
  if (value === null) return "Unavailable";
  const [integer, fraction] = value.split(".");
  return (
    BigInt(integer!).toLocaleString("en-US") + (fraction ? `.${fraction}` : "")
  );
}
export const money = (value: string | null) =>
  value === null ? "Unavailable" : `$${count(value)}`;
export const percent = (value: number | null) =>
  value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumSignificantDigits: 6,
      }).format(value);
export type Measure = "count" | "usd" | "ratio";
export const measurement = (value: string | null, measure: Measure) =>
  measure === "usd"
    ? money(value)
    : measure === "ratio"
      ? percent(value === null ? null : Number(value))
      : count(value);
export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
export const completedDay = () => utcDay(Date.now() - 86400000);
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
