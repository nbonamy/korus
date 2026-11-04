export const shiftDay = (day: string, offset: number) =>
  new Date(Date.parse(day) + offset * 86400000).toISOString().slice(0, 10);
export const weekDays = (end: string) =>
  Array.from({ length: 7 }, (_, index) => shiftDay(end, index - 6));
export function addAmounts(values: (string | null)[]): string | null {
  const known = values.filter((value): value is string => value !== null);
  if (!known.length) return null;
  const precision = Math.max(
    ...known.map((value) => value.split(".")[1]?.length ?? 0),
  );
  const total = known
    .reduce((sum, value) => {
      const [whole, fraction = ""] = value.split(".");
      return sum + BigInt(whole! + fraction.padEnd(precision, "0"));
    }, 0n)
    .toString()
    .padStart(precision + 1, "0");
  return precision
    ? `${total.slice(0, -precision)}.${total.slice(-precision)}`.replace(
        /\.?0+$/,
        "",
      )
    : total;
}
