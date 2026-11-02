<template>
  <main :class="{ desktop: app === 'desktop' }">
    <div class="capture-frame">
      <UsageShare
        v-if="scene === 'share'"
        :series="desktopSeries"
        measure="total"
        subtitle="Total tokens"
      />
      <UsageTrend
        v-else-if="app === 'desktop'"
        :daily="daily"
        :series="desktopSeries"
        :measure="desktopMeasure"
        :from="days[0]!"
        :to="days.at(-1)!"
        :subtitle="unit"
      />
      <MetricChart
        v-else
        :title="title"
        :days="days"
        :series="serverSeries"
        :measure="serverMeasure"
        :variant="variant"
        :hide-legend="isRate"
        :subtitle="unit"
      />
    </div>
  </main>
</template>
<script setup lang="ts">
import { Chart as ChartJS } from "chart.js";
Object.assign(window, {
  captureChart: () => ChartJS.getChart(document.querySelector("canvas")!),
});
import UsageShare from "@analytics-desktop/components/UsageShare.vue";
import UsageTrend from "@analytics-desktop/components/UsageTrend.vue";
import { chartSeries } from "@analytics-desktop/components/usage-chart";
import MetricChart from "@analytics-server/MetricChart.vue";
import { computed } from "vue";
const query = new URLSearchParams(location.search);
const app = query.get("app") ?? "desktop",
  scene = query.get("scene") ?? "speed";
const desktopMeasure =
  (
    {
      activity: "turns",
      tokens: "total",
      input: "input",
      output: "output",
      spend: "cost",
      ratio: "ratio",
      speed: "speed",
      latency: "speed",
      stacked: "total",
      share: "total",
    } as const
  )[scene as "speed"] ?? "speed";
const serverMeasure =
  (
    {
      activity: "count",
      tokens: "tokens",
      input: "tokens",
      output: "tokens",
      spend: "usd",
      ratio: "ratio",
      speed: "rate",
      latency: "milliseconds",
      stacked: "tokens",
    } as const
  )[scene as "speed"] ?? "rate";
const variant =
  scene === "stacked" ? "stacked" : scene === "spend" ? "bar" : "line";
const isRate = ["speed", "ratio", "latency"].includes(scene);
const unit =
  scene === "speed" ? "tokens/s" : scene === "latency" ? "s" : undefined;
const title = (
  {
    activity: "Daily activity",
    tokens: "Tokens over time",
    input: "Input tokens",
    output: "Output tokens",
    spend: "Estimated spend",
    ratio: "Measured token share",
    speed: "Output speed",
    latency: "Time to first output",
    stacked: "Model usage over time",
  } as Record<string, string>
)[scene];
const days = Array.from(
  { length: 7 },
  (_, i) => `2026-${i < 6 ? "10" : "11"}-${i < 6 ? 26 + i : "01"}`,
);
const speeds = [
  [37, 39, 30, 63, 61.5, 70, 78],
  [55, 55, 45, 68, 59.9, 48, 52],
  [64, 213, 58, 78, 30.7, 78, 124],
  [185, 210, 200, 165, null, 275.6, 170],
];
const models = [
  ["gpt-6.1-sol", "fast"],
  ["gpt-6.1-sol", "standard"],
  ["gpt-6-astra", "standard"],
  ["claude-sonnet-5-5", "standard"],
];
const rows = models.map(([model, tier], index) => ({
  label: model!,
  key: JSON.stringify([model, tier]),
  modelVariant: { model: model!, serviceTier: tier! },
  started: 35 - index * 4,
  completed: 35 - index * 4,
  failed: 0,
  interrupted: 0,
  inProgress: 0,
  measuredTurns: 30 - index * 4,
  tokens: {
    input: 1000 + index * 100,
    output: 100 + index * 10,
    cacheRead: 500,
    cacheWrite: 0,
    total: 1100 + index * 110,
  },
  speed: {
    turns: 1,
    outputTokens: 400,
    generationMs: 1000,
    ttftMs: 500,
    ttftTurns: 1,
  },
  cost: { usd: 1 + index * 0.25 },
}));
const daily = days.map((day, dayIndex) => {
  const groups = rows.flatMap((row, index) => {
    const rate = speeds[index]![dayIndex];
    if (rate === null) return [];
    const input =
      scene === "ratio"
        ? 90 + dayIndex * 0.8 + index * 0.25
        : Math.round((1000 + index * 500) * (1 + dayIndex * 0.3));
    const output = scene === "ratio" ? 100 - input : Math.round(input * 0.12);
    const tokens = {
      input,
      output,
      cacheRead: input * 0.8,
      cacheWrite: 0,
      total: input + output,
    };
    return [
      {
        ...row,
        started: 4 + dayIndex + index,
        tokens,
        speed: {
          turns: 1,
          outputTokens: Math.round(rate! * 10),
          generationMs: 10000,
          ttftMs: 500 + index * 400 + dayIndex * 75,
          ttftTurns: 1,
        },
        cost: {
          usd: dayIndex === 2 ? 0 : 0.05 + dayIndex * 0.17 + index * 0.1,
        },
      },
    ];
  });
  return {
    day,
    started: groups.reduce((n, g) => n + g.started, 0),
    measuredTurns: groups.length,
    tokens: {
      input: groups.reduce((n, g) => n + g.tokens.input, 0),
      output: groups.reduce((n, g) => n + g.tokens.output, 0),
      cacheRead: 0,
      cacheWrite: 0,
      total: groups.reduce((n, g) => n + g.tokens.total, 0),
    },
    groups,
    cost: { usd: groups.reduce((n, g) => n + g.cost.usd, 0) },
  };
});
const summary = { rows, daily, recordedSince: 0, retainedSince: 0 };
const desktopSeries = computed(() =>
  chartSeries(summary, desktopMeasure, "model"),
);
const serverSeries = computed(() =>
  desktopSeries.value.map((series: any) => ({
    label: series.label,
    color: series.color,
    values: daily.map((row) => {
      const group = row.groups.find((group) => group.key === series.key);
      if (!group) return null;
      const value =
        scene === "speed"
          ? group.speed.outputTokens / (group.speed.generationMs / 1000)
          : scene === "latency"
            ? group.speed.ttftMs / group.speed.ttftTurns
            : scene === "spend"
              ? group.cost.usd
              : scene === "ratio"
                ? group.tokens.input / group.tokens.total
                : scene === "activity"
                  ? group.started
                  : scene === "input"
                    ? group.tokens.input
                    : scene === "output"
                      ? group.tokens.output
                      : group.tokens.total;
      return String(value);
    }),
  })),
);
</script>
<style>
html,
body {
  margin: 0;
  color: var(--color-text);
  background: var(--color-surface);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
main {
  padding: 24px;
}
.capture-frame {
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-surface-lowest);
}
.capture-frame > .chart {
  border: 0;
  padding: 0;
  margin: 0;
}
.desktop .capture-frame {
  padding: 20px;
}
</style>
