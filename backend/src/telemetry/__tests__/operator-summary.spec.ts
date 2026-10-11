import { expect, it } from "vitest";
import { summarizeOperatorRows } from "../operator-summary";
it("shows shares and resolved-success denominators only from released cells; missing coverage is unknown", () => {
  const row = (value: string, metric: string, total: number) => ({
    day: "2026-10-10",
    metric,
    dimension: "model",
    value,
    total,
    reports: 10,
  });
  const rows = [
    row("gpt-5", "turn.completed", 30),
    row("claude-sonnet-4-6", "turn.completed", 70),
    row("gpt-5", "tokens.observed", 20),
  ];
  const result = summarizeOperatorRows(rows, "model", false);
  expect(result[0]).toMatchObject({
    modelShare: 30,
    failed: null,
    terminal: null,
    measured: 20,
    input: null,
  });
  expect(summarizeOperatorRows(rows, "model", true)[0].modelShare).toBeNull();
  expect(
    summarizeOperatorRows(
      [
        row("git.merge", "feature.succeeded", 30),
        row("git.merge", "feature.failed", 10),
      ],
      "feature",
      false,
    )[0],
  ).toMatchObject({ featureSuccess: 75, featureResolved: 40 });
  expect(
    summarizeOperatorRows(
      [row("git.merge", "feature.succeeded", 30)],
      "feature",
      false,
    )[0].featureSuccess,
  ).toBeNull();
  expect(summarizeOperatorRows([], "provider", false)).toStrictEqual([]);
});
