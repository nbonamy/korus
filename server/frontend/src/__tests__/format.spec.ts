import { expect, it } from "vitest";
import { tokens, money, percent } from "../format";

it("compacts tokens at unit boundaries without losing precision above safe integers", () => {
  for (const [input, expected] of [
    [null, "Unavailable"],
    ["0", "0"],
    ["999", "999"],
    ["1250", "1.3K"],
    ["999950", "1M"],
    ["1250000", "1.3M"],
    ["1250000000", "1.3B"],
    ["1250000000000", "1.3T"],
    ["45035996273704955", "45Q"],
  ])
    expect(tokens(input)).toBe(expected);
});
it("rounds currency to cents while distinguishing tiny positive amounts from zero", () => {
  for (const [input, expected] of [
    [null, "Unavailable"],
    ["0", "$0.00"],
    ["0.000000000123", "<$0.01"],
    ["12.345", "$12.35"],
    ["999.995", "$1,000.00"],
    ["45035996273704955.995", "$45,035,996,273,704,956.00"],
  ])
    expect(money(input)).toBe(expected);
});
it("shows percentages with one decimal, including zero and whole percentages", () => {
  expect(percent(null)).toBe("Unavailable");
  expect(percent(0)).toBe("0.0%");
  expect(percent(0.55)).toBe("55.0%");
  expect(percent(0.502686)).toBe("50.3%");
});
