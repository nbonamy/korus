<template>
  <section class="weekly-overview" aria-label="Weekly overview">
    <div class="weekly-cards">
      <RouterLink
        v-for="card in cards"
        :key="card.label"
        class="panel weekly-card"
        :aria-label="card.description"
        :to="{ name: card.page, query: { from: days[0], to: data.range.to } }"
      >
        <span class="weekly-icon" aria-hidden="true">
          <img :src="card.icon" alt="" width="40" height="40" />
        </span>
        <dl class="weekly-card-copy">
          <dt>{{ card.label }}</dt>
          <dd :title="exactMeasurement(card.value, card.measure)">
            {{ measurement(card.value, card.measure) }}
          </dd>
        </dl>
        <p
          class="weekly-change"
          :data-trend="card.change.direction"
          :aria-label="card.change.description"
        >
          <svg
            v-if="card.change.direction !== 'flat'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              :d="
                card.change.direction === 'up'
                  ? 'M4 17l7-7 4 4 6-9M15 5h6v6'
                  : 'M4 7l7 7 4-4 6 9M15 19h6v-6'
              "
            />
          </svg>
          {{ card.change.label }}
        </p>
      </RouterLink>
      <p class="weekly-comparison">vs {{ comparisonPeriod }}</p>
    </div>
    <MetricChart
      title="Weekly turns"
      :days="days"
      :series="series"
      measure="count"
      area="none"
    />
  </section>
  <section
    v-if="data.weeklyTopUsers"
    class="panel top-users"
    aria-label="Top 10 users"
  >
    <header class="panel-heading"><h2>Top 10 users</h2></header>
    <div class="table-scroll" tabindex="0" aria-label="Top users by turns">
      <table>
        <thead>
          <tr>
            <th scope="col">User</th>
            <th scope="col">Turns</th>
            <th scope="col">Tokens</th>
            <th scope="col">Spend</th>
            <th scope="col">Share of turns</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in data.weeklyTopUsers" :key="row.rank">
            <th scope="row">User {{ row.rank }}</th>
            <td>{{ count(row.turns) }}</td>
            <td :title="count(row.totalTokens)">
              {{ tokens(row.totalTokens) }}
            </td>
            <td :title="exactMoney(row.estimatedCostUsd)">
              {{ money(row.estimatedCostUsd) }}
            </td>
            <td>{{ percent(Number(row.turnShare)) }}</td>
          </tr>
          <tr v-if="!data.weeklyTopUsers.length">
            <td colspan="5" class="muted">No turns this week</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import MetricChart from "./MetricChart.vue";
import activeUsersIcon from "./assets/metrics/active-users-v1.png";
import newInstallsIcon from "./assets/metrics/new-installs-v1.png";
import weeklyTokensIcon from "./assets/metrics/weekly-tokens-v1.png";
import weeklySpendIcon from "./assets/metrics/weekly-spend-v1.png";
import {
  count,
  tokens,
  money,
  exactMoney,
  percent,
  measurement,
  exactMeasurement,
} from "./format";
import { addAmounts, weekDays, shiftDay } from "./report-data";
const props = defineProps<{
  data: TelemetryMetrics;
  previous: TelemetryMetrics | null;
}>();
const days = computed(() => weekDays(props.data.range.to));
function installs(start: string, end: string) {
  return String(
    props.data.activity
      .filter((row) => row.day >= start && row.day <= end)
      .reduce((sum, row) => sum + BigInt(row.firstReportedInstalls), 0n),
  );
}
function change(current: string | null, previous: string | null) {
  if (current === null || previous === null)
    return {
      direction: "flat",
      label: "—",
      description: "Comparison unavailable",
    };
  const precision = Math.max(
    current.split(".")[1]?.length ?? 0,
    previous.split(".")[1]?.length ?? 0,
  );
  const exact = (amount: string) => {
    const [whole, fraction = ""] = amount.split(".");
    return BigInt(whole! + fraction.padEnd(precision, "0"));
  };
  const value = exact(current),
    prior = exact(previous);
  const direction = value > prior ? "up" : value < prior ? "down" : "flat";
  if (prior === 0n && value > 0n)
    return { direction, label: "New", description: "Increased from zero" };
  const difference = value > prior ? value - prior : prior - value;
  const tenths = prior === 0n ? 0n : (difference * 1000n + prior / 2n) / prior;
  const label = `${count(String(tenths / 10n))}${tenths % 10n ? `.${tenths % 10n}` : ""}%`;
  return {
    direction,
    label,
    description: `${direction === "up" ? "Up" : direction === "down" ? "Down" : "Unchanged"} ${label} from previous week`,
  };
}
const cards = computed(() => {
  const currentNew = installs(days.value[0]!, props.data.range.to);
  const priorNew = installs(
    shiftDay(days.value[0]!, -7),
    shiftDay(props.data.range.to, -7),
  );
  const weekly = (field: "totalTokens" | "estimatedCostUsd", offset = 0) =>
    addAmounts(
      props.data.daily
        .filter(
          (row) =>
            row.day >= shiftDay(days.value[0]!, offset) &&
            row.day <= shiftDay(props.data.range.to, offset),
        )
        .map((row) => row[field]),
    );
  return [
    {
      label: "WAU",
      icon: activeUsersIcon,
      page: "activity",
      measure: "count" as const,
      description: "Weekly active installs",
      value: props.data.overview.wau,
      change: change(
        props.data.overview.wau,
        props.previous?.overview.wau ?? null,
      ),
    },
    {
      label: "New installs",
      icon: newInstallsIcon,
      page: "activity",
      measure: "count" as const,
      description: "Weekly new installs",
      value: currentNew,
      change: change(currentNew, priorNew),
    },
    {
      label: "Tokens this week",
      icon: weeklyTokensIcon,
      page: "tokens",
      measure: "tokens" as const,
      description: "Tokens this week",
      value: weekly("totalTokens"),
      change: change(weekly("totalTokens"), weekly("totalTokens", -7)),
    },
    {
      label: "Spend this week",
      icon: weeklySpendIcon,
      page: "spend",
      measure: "usd" as const,
      description: "Spend this week",
      value: weekly("estimatedCostUsd"),
      change: change(
        weekly("estimatedCostUsd"),
        weekly("estimatedCostUsd", -7),
      ),
    },
  ];
});
const comparisonPeriod = computed(() => {
  const short = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const end = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const first = shiftDay(days.value[0]!, -7),
    last = shiftDay(props.data.range.to, -7);
  return `${short.format(new Date(first))} – ${end.format(new Date(last))}`;
});
const series = computed(() => {
  const byDay = new Map(props.data.daily.map((row) => [row.day, row.turns]));
  return [
    {
      label: "This week",
      color: "var(--chart-1)",
      values: days.value.map((day) => byDay.get(day) ?? null),
    },
    {
      label: "Previous week",
      color: "var(--color-text-muted)",
      values: days.value.map((day) => byDay.get(shiftDay(day, -7)) ?? null),
    },
  ];
});
</script>
<style scoped>
.top-users {
  margin-top: 20px;
}
.top-users .panel-heading {
  margin-bottom: 12px;
}
.top-users table {
  width: 100%;
}
.top-users tbody th {
  font-weight: 500;
  color: var(--color-text);
}

.weekly-overview {
  display: grid;
  grid-template-columns: minmax(400px, 0.65fr) minmax(0, 1fr);
  gap: 20px;
  align-items: stretch;
}
.weekly-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.weekly-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  align-content: center;
  align-items: center;
  gap: 6px 8px;
  padding: 16px;
  border-radius: 12px;
  min-height: 160px;
  color: var(--color-text);
  text-decoration: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}
.weekly-card:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-sm);
}
.weekly-card:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}
.weekly-icon {
  display: grid;
  place-items: center;
  grid-column: 2;
  grid-row: 1;
  width: 40px;
  height: 40px;
}
.weekly-icon img {
  display: block;
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.weekly-card-copy {
  display: contents;
}
.weekly-card dt {
  grid-column: 1;
  grid-row: 1;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 500;
}
.weekly-card dd {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 34px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.045em;
  line-height: 1.15;
}
.weekly-change {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-muted);
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.weekly-change[data-trend="up"] {
  color: var(--color-success);
}
.weekly-change[data-trend="down"] {
  color: var(--color-error);
}
.weekly-change svg {
  width: 17px;
  height: 17px;
}
.weekly-comparison {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: 1.5;
}
.weekly-overview > .chart {
  margin: 0;
}
@media (max-width: 1100px) {
  .weekly-overview {
    grid-template-columns: minmax(0, 1fr);
  }
  .weekly-cards {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 820px) {
  .weekly-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .weekly-card {
    padding: 14px;
  }
  .weekly-card dd {
    font-size: 28px;
  }
}
</style>
