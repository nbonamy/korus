import type { OperatorRow } from "./aggregate-store";
export type OperatorSummary = {
  day: string;
  category: string;
  started: number | null;
  completed: number | null;
  failed: number | null;
  interrupted: number | null;
  input: number | null;
  output: number | null;
  measured: number | null;
  terminal: number | null;
  modelShare: number | null;
  featureSuccess: number | null;
  featureResolved: number | null;
};
/** Ratios describe released cells only. Withheld/missing cells never become zero. */
export function summarizeOperatorRows(
  rows: OperatorRow[],
  dimension: string,
  filtered: boolean,
): OperatorSummary[] {
  const groups = new Map<
    string,
    { day: string; category: string; metrics: Map<string, number> }
  >();
  for (const row of rows) {
    const key = JSON.stringify([row.day, row.value]);
    const group = groups.get(key) ?? {
      day: row.day,
      category: row.value,
      metrics: new Map<string, number>(),
    };
    group.metrics.set(row.metric, row.total);
    groups.set(key, group);
  }
  const completedByDay = new Map<string, number>();
  for (const group of groups.values())
    completedByDay.set(
      group.day,
      (completedByDay.get(group.day) ?? 0) +
        (group.metrics.get("turn.completed") ?? 0),
    );
  return [...groups.values()].map(({ day, category, metrics }) => {
    const value = (metric: string) => metrics.get(metric) ?? null;
    const completed = value("turn.completed"),
      failed = value("turn.failed"),
      interrupted = value("turn.interrupted");
    const success = value("feature.succeeded"),
      failure = value("feature.failed");
    const featureResolved =
      success !== null && failure !== null ? success + failure : null;
    return {
      day,
      category,
      started: value("turn.started"),
      completed,
      failed,
      interrupted,
      input: value("tokens.input"),
      output: value("tokens.output"),
      measured: value("tokens.observed"),
      terminal:
        completed !== null && failed !== null && interrupted !== null
          ? completed + failed + interrupted
          : null,
      modelShare:
        dimension === "model" &&
        !filtered &&
        completed !== null &&
        completedByDay.get(day)! > 0
          ? Math.round((100 * completed) / completedByDay.get(day)!)
          : null,
      featureSuccess: featureResolved
        ? Math.round((100 * success!) / featureResolved)
        : null,
      featureResolved,
    };
  });
}
