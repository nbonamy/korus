<template>
  <div class="usage-activity">
    <div class="activity-layout">
      <div class="activity-stats">
        <UsageStatTile
          v-for="stat in stats"
          :key="stat.label"
          :label="stat.label"
          :value="stat.value"
        />
      </div>
      <UsageCard as="section" :aria-label="$t('analytics.activity')">
        <header class="activity-header">
          <h3>{{ $t("analytics.activity") }}</h3>
          <div class="activity-tabs" role="tablist">
            <button
              v-for="tab in tabs"
              :key="tab.value"
              class="activity-tab"
              :class="{ 'activity-tab--active': mode === tab.value }"
              type="button"
              role="tab"
              :aria-selected="mode === tab.value"
              @click="mode = tab.value"
            >
              {{ tab.label }}
            </button>
          </div>
        </header>
        <div ref="body" class="activity-body">
          <div ref="stage" class="activity-stage">
            <div
              v-if="mode === 'daily'"
              class="activity-cells"
              role="img"
              :aria-label="summary"
            >
              <div
                v-for="cell in visible"
                :key="cell.day"
                class="activity-cell"
                :class="{ 'activity-cell--future': cell.future }"
                :data-level="cell.level"
                @pointerenter="showDay(cell, $event)"
                @pointerleave="hovered = null"
              />
            </div>
            <div
              v-else
              class="activity-weeks"
              role="img"
              :aria-label="summary"
              :style="{ gridTemplateColumns: `repeat(${fit}, minmax(0, 1fr))` }"
            >
              <div
                v-for="week in visibleWeeks"
                :key="week.start"
                class="activity-week"
                :data-level="week.level"
                @pointerenter="showWeek(week, $event)"
                @pointerleave="hovered = null"
              >
                <span
                  v-for="n in 7"
                  :key="n"
                  class="activity-square"
                  :data-filled="n > 7 - week.squares ? '' : undefined"
                />
              </div>
            </div>
            <div
              class="activity-months"
              :style="{ gridTemplateColumns: `repeat(${fit}, minmax(0, 1fr))` }"
              aria-hidden="true"
            >
              <span
                v-for="month in months"
                :key="month.week"
                :style="{ gridColumn: month.week + 1 }"
                >{{ month.label }}</span
              >
            </div>
            <div
              v-if="hovered"
              class="activity-tooltip"
              :style="{ left: hovered.x + 'px', top: hovered.y + 'px' }"
              aria-hidden="true"
            >
              <strong>{{ hovered.value }}</strong>
              <span>{{ hovered.label }}</span>
            </div>
          </div>
        </div>
      </UsageCard>
    </div>
  </div>
</template>
<script setup lang="ts">
import UsageCard from "./UsageCard.vue";
import UsageStatTile from "./UsageStatTile.vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { translate } from "../i18n";
import {
  ACTIVITY_WEEKS,
  activityWindow,
  chartFormat,
  durationFormat,
} from "./usage-chart";
const props = defineProps<{
  days: { day: string; tokens: number | null }[] | null;
  longestTurnMs?: number | null;
}>();
const activityFormat = (value: number | null) =>
  value === null
    ? translate("analytics.activityNoData")
    : chartFormat(value, true);
const mode = ref<"daily" | "weekly">("daily");
const tabs = computed(() => [
  { value: "daily" as const, label: translate("analytics.activityDaily") },
  { value: "weekly" as const, label: translate("analytics.activityWeekly") },
]);
const MIN_CELL = 6,
  GAP = 3;
const body = ref<HTMLElement | null>(null);
// Narrow layouts show the most recent weeks that fit rather than shrinking cells to dots.
const fit = ref(ACTIVITY_WEEKS);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(([entry]) => {
    const width = entry?.contentRect.width ?? 0;
    if (width > 0)
      fit.value = Math.max(
        12,
        Math.min(ACTIVITY_WEEKS, Math.floor((width + GAP) / (MIN_CELL + GAP))),
      );
  });
  if (body.value) observer.observe(body.value);
});
onBeforeUnmount(() => observer?.disconnect());
const hovered = ref<{
  x: number;
  y: number;
  value: string;
  label: string;
} | null>(null);
const DAY = 86400000;
const grid = computed(() => {
  const window = activityWindow();
  const tokens = new Map(props.days?.map((row) => [row.day, row.tokens]));
  const start = Date.parse(window.from),
    end = Date.parse(window.to);
  return Array.from({ length: ACTIVITY_WEEKS * 7 }, (_, i) => {
    const day = new Date(start + i * DAY).toISOString().slice(0, 10);
    return {
      day,
      tokens:
        props.days === null ? null : tokens.has(day) ? tokens.get(day)! : 0,
      future: start + i * DAY > end,
      week: Math.floor(i / 7),
    };
  });
});
const lifetime = computed(() =>
  grid.value.some((cell) => !cell.future && cell.tokens === null)
    ? null
    : grid.value.reduce((n, cell) => n + (cell.tokens ?? 0), 0),
);
const peak = computed(() =>
  lifetime.value === null
    ? null
    : Math.max(0, ...grid.value.map((cell) => cell.tokens ?? 0)),
);
const streak = computed(() => {
  if (lifetime.value === null) return null;
  let best = 0,
    run = 0;
  for (const cell of grid.value) {
    run = (cell.tokens ?? 0) > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
});
const stats = computed(() => [
  {
    label: translate("analytics.activityLifetime"),
    value: activityFormat(lifetime.value),
  },
  {
    label: translate("analytics.activityPeak"),
    value: activityFormat(peak.value),
  },
  {
    label: translate("analytics.activityLongest"),
    value:
      props.longestTurnMs == null
        ? translate("analytics.activityNoData")
        : durationFormat(props.longestTurnMs),
  },
  {
    label: translate("analytics.activityStreak"),
    value:
      streak.value === null
        ? translate("analytics.activityNoData")
        : translate(
            streak.value === 1
              ? "analytics.activityStreakDay"
              : "analytics.activityStreakDays",
            { count: streak.value },
          ),
  },
]);
/** Shades values 1-4 by quartile of the positive ones; the busiest is always the darkest. */
function levelsOf(values: (number | null)[]): (number | null)[] {
  const positive = values
    .filter((value): value is number => value !== null && value > 0)
    .sort((a, b) => a - b);
  const at = (q: number) =>
    positive[Math.floor(q * (positive.length - 1))] ?? 0;
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)];
  const max = positive.at(-1) ?? 0;
  return values.map((value) =>
    value === null
      ? null
      : value <= 0
        ? 0
        : value >= max
          ? 4
          : value <= q1
            ? 1
            : value <= q2
              ? 2
              : value <= q3
                ? 3
                : 4,
  );
}
const cells = computed(() => {
  const levels = levelsOf(grid.value.map((cell) => cell.tokens));
  return grid.value.map((cell, i) => ({
    ...cell,
    level: cell.future && levels[i] !== null ? 0 : levels[i],
  }));
});
const weeks = computed(() => {
  const totals = Array.from({ length: ACTIVITY_WEEKS }, (_, w) => {
    const days = grid.value.slice(w * 7, w * 7 + 7);
    return days.every((cell) => cell.tokens === null)
      ? null
      : days.reduce((n, cell) => n + (cell.tokens ?? 0), 0);
  });
  const levels = levelsOf(totals);
  const max = Math.max(0, ...totals.map((total) => total ?? 0));
  return totals.map((total, w) => ({
    start: grid.value[w * 7].day,
    week: w,
    tokens: total,
    level: levels[w],
    // Stacks scale with the busiest week; any activity keeps at least one square.
    squares: total && max ? Math.max(1, Math.round((total / max) * 7)) : 0,
  }));
});
const hiddenWeeks = computed(() => ACTIVITY_WEEKS - fit.value);
const visible = computed(() => cells.value.slice(hiddenWeeks.value * 7));
const visibleWeeks = computed(() => weeks.value.slice(hiddenWeeks.value));
const months = computed(() => {
  const labels: { week: number; label: string }[] = [];
  let previous = "";
  for (const cell of visible.value.filter((_, i) => i % 7 === 0)) {
    const month = cell.day.slice(0, 7);
    if (
      month !== previous &&
      cell.week > hiddenWeeks.value &&
      cell.day.slice(8) <= "07"
    )
      labels.push({
        week: cell.week - hiddenWeeks.value,
        label: new Date(cell.day + "T00:00:00Z").toLocaleDateString(undefined, {
          month: "short",
          timeZone: "UTC",
        }),
      });
    previous = month;
  }
  return labels;
});
const summary = computed(() =>
  lifetime.value === null
    ? translate("analytics.activityNoData")
    : translate("analytics.activitySummary", {
        tokens: chartFormat(lifetime.value, true),
      }),
);
const tokensLabel = (tokens: number | null) =>
  tokens === null
    ? translate("analytics.activityNoData")
    : translate("analytics.tokensValue", { count: chartFormat(tokens, true) });
const dateLabel = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Date(day + "T00:00:00Z").toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
function place(event: PointerEvent, value: string, label: string) {
  const target = event.currentTarget as HTMLElement;
  hovered.value = {
    x: target.offsetLeft + target.offsetWidth / 2,
    y: target.offsetTop - 8,
    value,
    label,
  };
}
function showDay(cell: (typeof cells.value)[number], event: PointerEvent) {
  if (cell.future) return;
  place(
    event,
    tokensLabel(cell.tokens),
    dateLabel(cell.day, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  );
}
function showWeek(week: (typeof weeks.value)[number], event: PointerEvent) {
  place(
    event,
    tokensLabel(week.tokens),
    translate("analytics.activityWeekOf", {
      date: dateLabel(week.start, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }),
  );
}
</script>
<style scoped>
.usage-activity {
  container-type: inline-size;
}
.activity-layout {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: var(--space-8);
}
.activity-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-8);
}
/* Too narrow for tiles beside the chart: stack them above it. */
@container (max-width: 760px) {
  .activity-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .activity-stats {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    grid-auto-rows: auto;
  }
}
.activity-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-8);
}
.activity-header h3 {
  margin: 0;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
}
.activity-tabs {
  display: flex;
  gap: var(--space-6);
}
.activity-tab {
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--font-size-13);
}
.activity-tab--active {
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
}
.activity-body {
  min-width: 0;
}
.activity-stage {
  --activity-gap: 3px;
  --activity-ramp: var(--chart-3);
  position: relative;
}
.activity-cells {
  display: grid;
  grid-template-rows: repeat(7, auto);
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--activity-gap);
}
.activity-cell,
.activity-square {
  aspect-ratio: 1;
  border-radius: 25%;
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}
.activity-cell--future {
  visibility: hidden;
}
.activity-weeks {
  display: grid;
  gap: var(--activity-gap);
}
.activity-week {
  display: grid;
  gap: var(--activity-gap);
}
/* Weekly columns repeat the daily ramp so both views read the same. */
.activity-cell[data-level="1"],
.activity-week[data-level="1"] .activity-square[data-filled] {
  background: color-mix(
    in srgb,
    var(--activity-ramp) 30%,
    var(--color-surface-lowest)
  );
}
.activity-cell[data-level="2"],
.activity-week[data-level="2"] .activity-square[data-filled] {
  background: color-mix(
    in srgb,
    var(--activity-ramp) 55%,
    var(--color-surface-lowest)
  );
}
.activity-cell[data-level="3"],
.activity-week[data-level="3"] .activity-square[data-filled] {
  background: color-mix(
    in srgb,
    var(--activity-ramp) 78%,
    var(--color-surface-lowest)
  );
}
.activity-cell[data-level="4"],
.activity-week[data-level="4"] .activity-square[data-filled] {
  background: var(--activity-ramp);
}
.activity-cell:not(.activity-cell--future):hover {
  outline: 2px solid color-mix(in srgb, var(--color-text) 45%, transparent);
  outline-offset: 1px;
}
.activity-week:hover {
  outline: 2px solid color-mix(in srgb, var(--color-text) 25%, transparent);
  outline-offset: 1px;
  border-radius: 4px;
}
.activity-months {
  display: grid;
  gap: var(--activity-gap);
  margin-top: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.activity-months span {
  overflow: visible;
  white-space: nowrap;
}
.activity-tooltip {
  position: absolute;
  z-index: 2;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-lg);
  font-size: var(--font-size-12);
  pointer-events: none;
  transform: translate(-50%, -100%);
  white-space: nowrap;
}
.activity-tooltip span {
  color: var(--color-text-muted);
}
</style>
