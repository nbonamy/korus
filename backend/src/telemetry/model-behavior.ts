import type { OperatorRow } from "./aggregate-store";
export const modelBehaviorMeasures = [
  "streamRate",
  "responsesPerTurn",
  "toolsPerTurn",
  "multiToolShare",
  "reasoningShare",
  "duration",
  "completedRate",
  "failedRate",
  "interruptedRate",
] as const;
type ModelBehaviorMeasure = (typeof modelBehaviorMeasures)[number];
type ModelBehaviorValue = {
  value: number | null;
  samples: number | null;
  days: number;
};
export type ModelBehavior = {
  model: string;
  metrics: Record<ModelBehaviorMeasure, ModelBehaviorValue>;
};
/** Pair numerator/denominator within each released model/day before combining days. Missing cells are never zero. */
export function summarizeModelBehavior(rows: OperatorRow[]): ModelBehavior[] {
  const models = new Map<string, Map<string, Map<string, number>>>();
  for (const row of rows) {
    if (row.dimension !== "model" || !row.metric.startsWith("behavior."))
      continue;
    let days = models.get(row.value);
    if (!days) models.set(row.value, (days = new Map()));
    let metrics = days.get(row.day);
    if (!metrics) days.set(row.day, (metrics = new Map()));
    metrics.set(row.metric, row.total);
  }
  const definitions: Record<
    ModelBehaviorMeasure,
    {
      numerator: string;
      denominator: string;
      samples: string;
      scale: number;
      percentage?: boolean;
    }
  > = {
    streamRate: {
      numerator: "streamTokens",
      denominator: "streamMs",
      samples: "streamResponses",
      scale: 1000,
    },
    responsesPerTurn: {
      numerator: "responses",
      denominator: "responsesObserved",
      samples: "responsesObserved",
      scale: 1,
    },
    toolsPerTurn: {
      numerator: "toolCalls",
      denominator: "toolsObserved",
      samples: "toolsObserved",
      scale: 1,
    },
    multiToolShare: {
      numerator: "multiToolResponses",
      denominator: "responses",
      samples: "responses",
      scale: 100,
      percentage: true,
    },
    reasoningShare: {
      numerator: "reasoningTokens",
      denominator: "reasoningOutput",
      samples: "reasoningObserved",
      scale: 100,
      percentage: true,
    },
    duration: {
      numerator: "durationMs",
      denominator: "durationObserved",
      samples: "durationObserved",
      scale: 0.001,
    },
    completedRate: {
      numerator: "completed",
      denominator: "terminalObserved",
      samples: "terminalObserved",
      scale: 100,
      percentage: true,
    },
    failedRate: {
      numerator: "failed",
      denominator: "terminalObserved",
      samples: "terminalObserved",
      scale: 100,
      percentage: true,
    },
    interruptedRate: {
      numerator: "interrupted",
      denominator: "terminalObserved",
      samples: "terminalObserved",
      scale: 100,
      percentage: true,
    },
  };
  return [...models]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, days]) => ({
      model,
      metrics: Object.fromEntries(
        modelBehaviorMeasures.map((id) => {
          const definition = definitions[id];
          let numerator = 0,
            denominator = 0,
            samples = 0,
            matchedDays = 0;
          for (const values of days.values()) {
            const n = values.get("behavior." + definition.numerator),
              d = values.get("behavior." + definition.denominator),
              s = values.get("behavior." + definition.samples);
            if (
              n === undefined ||
              d === undefined ||
              s === undefined ||
              d <= 0 ||
              s <= 0 ||
              (definition.percentage && n > d)
            )
              continue;
            numerator += n;
            denominator += d;
            samples += s;
            matchedDays++;
          }
          return [
            id,
            {
              value: denominator
                ? (numerator / denominator) * definition.scale
                : null,
              samples: matchedDays ? samples : null,
              days: matchedDays,
            },
          ];
        }),
      ) as ModelBehavior["metrics"],
    }));
}
