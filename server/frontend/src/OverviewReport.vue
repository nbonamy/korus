<template>
  <section class="weekly-overview" aria-label="Weekly overview">
    <div class="weekly-cards">
      <RouterLink
        class="weekly-card weekly-hero"
        :aria-label="hero.description"
        :to="{ name: hero.page, query: { from: days[0], to: data.range.to } }"
      >
        <dl class="weekly-card-copy">
          <dt>{{ hero.label }}</dt>
          <dd :title="exactMeasurement(hero.value, hero.measure)">
            {{ measurement(hero.value, hero.measure) }}
          </dd>
        </dl>
        <WeeklyChange :change="hero.change" />
      </RouterLink>
      <div class="panel weekly-list">
        <RouterLink
          v-for="card in rows"
          :key="card.label"
          class="weekly-card weekly-row"
          :aria-label="card.description"
          :to="{ name: card.page, query: { from: days[0], to: data.range.to } }"
        >
          <dl class="weekly-card-copy">
            <dt>{{ card.label }}</dt>
            <dd :title="exactMeasurement(card.value, card.measure)">
              {{ measurement(card.value, card.measure) }}
            </dd>
          </dl>
          <WeeklyChange :change="card.change" />
        </RouterLink>
      </div>
    </div>
    <MetricChart
      title="Weekly turns"
      :days="days"
      :series="series"
      measure="count"
      variant="bar"
      :day-labels="dayLabels"
    />
  </section>
  <section
    v-if="data.weeklyTopUsers"
    class="panel top-users"
    aria-label="Top 10 users"
  >
    <header class="panel-heading"><h2>Top 10 users</h2></header>
    <div class="table-scroll" tabindex="0" aria-label="Top users by turns">
      <table role="table">
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
            <th scope="row">
              <span class="user-rank" aria-hidden="true">{{ row.rank }}</span
              >User {{ row.rank }}
            </th>
            <td data-label="Turns">{{ count(row.turns) }}</td>
            <td data-label="Tokens" :title="count(row.totalTokens)">
              {{ tokens(row.totalTokens) }}
            </td>
            <td data-label="Spend" :title="exactMoney(row.estimatedCostUsd)">
              {{ money(row.estimatedCostUsd) }}
            </td>
            <td data-label="Share of turns">
              <div class="share">
                <span class="share-bar" aria-hidden="true"
                  ><i :style="{ width: `${Number(row.turnShare) * 100}%` }"
                /></span>
                {{ percent(Number(row.turnShare)) }}
              </div>
            </td>
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
import { analyticsDay } from "@workspace/core/analytics-chart";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import MetricChart from "./MetricChart.vue";
import WeeklyChange from "./WeeklyChange.vue";
import {
  count,
  tokens,
  money,
  exactMoney,
  percent,
  measurement,
  exactMeasurement,
  currentDay,
  viewerTimeZone,
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
      label: "Tokens last 7 days",
      page: "tokens",
      measure: "tokens" as const,
      description: "Tokens last 7 days",
      value: weekly("totalTokens"),
      change: change(weekly("totalTokens"), weekly("totalTokens", -7)),
    },
    {
      label: "WAU",
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
      page: "activity",
      measure: "count" as const,
      description: "Weekly new installs",
      value: currentNew,
      change: change(currentNew, priorNew),
    },
    {
      label: "Spend last 7 days",
      page: "spend",
      measure: "usd" as const,
      description: "Spend last 7 days",
      value: weekly("estimatedCostUsd"),
      change: change(
        weekly("estimatedCostUsd"),
        weekly("estimatedCostUsd", -7),
      ),
    },
  ];
});
const hero = computed(() => cards.value[0]!);
const rows = computed(() => cards.value.slice(1));
// The newest day is still accumulating only when it is the viewer's today.
const live = computed(
  () => props.data.range.to === currentDay(viewerTimeZone()),
);
const dayLabels = computed(() =>
  live.value
    ? { [props.data.range.to]: `${analyticsDay(props.data.range.to)} · today` }
    : undefined,
);
const series = computed(() => {
  const byDay = new Map(props.data.daily.map((row) => [row.day, row.turns]));
  return [
    {
      label: "This week",
      color: "var(--chart-1)",
      values: days.value.map((day) => byDay.get(day) ?? null),
      partial: days.value.map(
        (day) => live.value && day === props.data.range.to,
      ),
    },
    {
      label: "Previous week",
      color: "var(--color-border-strong)",
      values: days.value.map((day) => byDay.get(shiftDay(day, -7)) ?? null),
    },
  ];
});
</script>
<style scoped>
.top-users {
  margin-top: 16px;
  border-radius: 12px;
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
.user-rank {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-right: 10px;
  border-radius: 50%;
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
  font-size: 11px;
  font-weight: 600;
}
.share {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
.share-bar {
  width: 120px;
  height: 6px;
  border-radius: 3px;
  background: var(--color-surface-base);
  overflow: hidden;
}
.share-bar i {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: 3px;
  background: var(--chart-1);
}

.weekly-overview {
  display: grid;
  grid-template-columns: minmax(360px, 440px) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}
.weekly-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.weekly-card {
  color: var(--color-text);
  text-decoration: none;
}
.weekly-card:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}
.weekly-card-copy {
  display: contents;
}
.weekly-card dt {
  color: inherit;
  font-size: 13px;
  font-weight: 500;
}
.weekly-card dd {
  margin: 0;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.045em;
  overflow-wrap: normal;
}
.weekly-hero {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  min-height: 190px;
  padding: 24px;
  border-radius: 16px;
  background: linear-gradient(
    155deg,
    var(--color-primary),
    var(--color-secondary)
  );
  color: var(--color-on-primary);
  transition: box-shadow 150ms ease;
}
.weekly-hero:hover {
  box-shadow: var(--shadow-md);
}
.weekly-hero dt {
  opacity: 0.9;
}
.weekly-hero dd {
  font-size: 60px;
  line-height: 1;
}
.weekly-hero :deep(.weekly-change) {
  background: rgb(255 255 255 / 20%);
  color: inherit;
}
.weekly-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  padding: 4px 20px;
  border-radius: 12px;
}
.weekly-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}
.weekly-row:last-child {
  border-bottom: 0;
}
.weekly-row dd {
  font-size: 22px;
  line-height: 1.2;
}
.weekly-row:hover dt {
  color: var(--color-primary);
}
.weekly-overview > .chart {
  margin: 0;
  border-radius: 12px;
}
@media (max-width: 1100px) {
  .weekly-overview {
    grid-template-columns: minmax(0, 1fr);
  }
  .weekly-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 820px) {
  .weekly-cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 560px) {
  .top-users .table-scroll {
    overflow: visible;
    max-height: none;
  }
  .top-users table,
  .top-users tbody {
    display: block;
  }
  .top-users thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .top-users tbody tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;
    padding: 14px 0;
    border-bottom: 1px solid var(--color-border);
  }
  .top-users tbody tr:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }
  .top-users tbody th {
    grid-column: 1 / -1;
    font-weight: 600;
  }
  .top-users tbody th,
  .top-users tbody td {
    padding: 0;
    border: 0;
    text-align: left;
  }
  .top-users tbody td::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 3px;
    color: var(--color-text-muted);
    font-size: 11px;
  }
  .share {
    justify-content: flex-start;
  }
  .share-bar {
    width: 72px;
  }
  .weekly-hero {
    min-height: 124px;
    padding: 16px 20px;
  }
  .weekly-hero dd {
    font-size: 40px;
  }
  .weekly-list {
    padding: 0 16px;
  }
  .weekly-row {
    padding: 9px 0;
  }
  .weekly-row dd {
    font-size: 20px;
  }
}
</style>
