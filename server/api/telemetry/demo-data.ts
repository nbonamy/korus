import {
  utcDay,
  type TelemetryMetric,
  type TelemetryFeature,
  type TelemetryRow,
} from "@workspace/core/telemetry";
import type { OperatorRow } from "./aggregate-store";

// Display fixtures only: these labels and invented measurements never expand
// the upload schema or claim live provider instrumentation.
type DemoModel = {
  provider: NonNullable<TelemetryRow["provider"]>;
  model: string;
  turns: number;
  growth: number;
  responses: number;
  tools: number;
  seconds: number;
  speed: number;
  reasoning: number;
};
const demoModels: DemoModel[] = [
  {
    provider: "claude",
    model: "claude-sonnet-4-6",
    turns: 32,
    growth: 7,
    responses: 3,
    tools: 6,
    seconds: 38,
    speed: 72,
    reasoning: 0.35,
  },
  {
    provider: "claude",
    model: "claude-opus-4-6",
    turns: 18,
    growth: 4,
    responses: 4,
    tools: 8,
    seconds: 52,
    speed: 54,
    reasoning: 0.48,
  },
  {
    provider: "codex",
    model: "gpt-5.4",
    turns: 30,
    growth: 6,
    responses: 3,
    tools: 5,
    seconds: 42,
    speed: 64,
    reasoning: 0.42,
  },
  {
    provider: "codex",
    model: "gpt-5.6",
    turns: 24,
    growth: 5,
    responses: 4,
    tools: 7,
    seconds: 46,
    speed: 58,
    reasoning: 0.51,
  },
  {
    provider: "codex",
    model: "gpt-6.1",
    turns: 16,
    growth: 4,
    responses: 2,
    tools: 4,
    seconds: 35,
    speed: 82,
    reasoning: 0.39,
  },
  {
    provider: "antigravity",
    model: "gemini-2.5-pro",
    turns: 20,
    growth: 5,
    responses: 3,
    tools: 5,
    seconds: 40,
    speed: 88,
    reasoning: 0.32,
  },
  {
    provider: "antigravity",
    model: "gemini-2.5-flash",
    turns: 27,
    growth: 6,
    responses: 2,
    tools: 3,
    seconds: 24,
    speed: 126,
    reasoning: 0.19,
  },
];

/** Finite synthetic samples only. They never enter ingestion, dedupe or live buckets. */
export function demoBuckets(now: number): OperatorRow[] {
  const cells = new Map<string, OperatorRow>();
  const add = (
    day: string,
    metric: TelemetryMetric,
    total: number,
    dimensions: Record<string, string>,
  ) => {
    for (const [dimension, value] of Object.entries({
      platform: "macos",
      version: "0.35.0",
      channel: "stable",
      ...dimensions,
    })) {
      const key = JSON.stringify([day, metric, dimension, value]);
      const cell = cells.get(key);
      if (cell) {
        cell.total += total;
        cell.reports++;
      } else
        cells.set(key, { day, metric, dimension, value, total, reports: 1 });
    }
  };
  for (let index = 0; index < 7; index++) {
    const day = utcDay(now - (6 - index) * 86400000);
    for (const profile of demoModels) {
      const { provider, model } = profile;
      const turns = profile.turns + index * profile.growth;
      const dimensions = { provider, model },
        completed = turns - 3;
      const metric = (name: TelemetryMetric, value: number) =>
        add(day, name, value, dimensions);
      metric("turn.started", turns);
      metric("turn.completed", completed);
      metric("turn.failed", 2);
      metric("turn.interrupted", 1);
      const output = turns * 900,
        responses = turns * profile.responses;
      metric("tokens.input", turns * 4200);
      metric("tokens.output", output);
      metric("tokens.total", turns * 5100);
      metric("tokens.observed", turns);
      metric("behavior.terminalObserved", turns);
      metric("behavior.completed", completed);
      metric("behavior.failed", 2);
      metric("behavior.interrupted", 1);
      metric("behavior.durationObserved", turns);
      metric("behavior.durationMs", turns * profile.seconds * 1000);
      metric("behavior.responses", responses);
      metric("behavior.responsesObserved", turns);
      metric("behavior.toolCalls", turns * profile.tools);
      metric("behavior.toolsObserved", turns);
      metric("behavior.multiToolResponses", turns);
      metric("behavior.streamTokens", output);
      metric("behavior.streamMs", Math.round((output * 1000) / profile.speed));
      metric("behavior.streamResponses", responses);
      metric(
        "behavior.reasoningTokens",
        Math.round(output * profile.reasoning),
      );
      metric("behavior.reasoningOutput", output);
      metric("behavior.reasoningObserved", turns);
    }
    for (const [feature, base] of [
      ["browser.open", 16],
      ["computer.use", 8],
      ["mission.start", 6],
      ["review.start.manual", 10],
    ] as [TelemetryFeature, number][]) {
      const count = base + index * 3;
      add(day, "feature.attempted", count, { feature });
      add(day, "feature.succeeded", count - 2, { feature });
      add(day, "feature.failed", 1, { feature });
      add(day, "feature.cancelled", 1, { feature });
    }
  }
  return [...cells.values()];
}
