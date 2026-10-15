<template>
  <section class="usage-activity" :aria-label="$t('analytics.activity')">
    <div class="activity-layout">
      <div class="activity-summary">
        <dl class="activity-totals">
          <div>
            <dt>{{ $t("analytics.activityLifetime") }}</dt>
            <dd>{{ chartFormat(lifetime, true) }}</dd>
          </div>
          <div>
            <dt>{{ $t("analytics.activityPeak") }}</dt>
            <dd>{{ chartFormat(peak?.tokens ?? 0, true) }}</dd>
          </div>
        </dl>
      </div>
      <div ref="body" class="activity-body">
        <div ref="stage" class="activity-stage">
          <div class="activity-cells" role="img" :aria-label="summary">
            <div
              v-for="cell in visible"
              :key="cell.day"
              class="activity-cell"
              :class="{ 'activity-cell--future': cell.future }"
              :data-level="cell.level"
              @pointerenter="show(cell, $event)"
              @pointerleave="hovered = null"
            />
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
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { translate } from "../i18n";
import { ACTIVITY_WEEKS, activityWindow, chartFormat } from "./usage-chart";
const props = defineProps<{ days: { day: string; tokens: number }[] }>();
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
  const tokens = new Map(props.days.map((row) => [row.day, row.tokens]));
  const start = Date.parse(window.from),
    end = Date.parse(window.to);
  return Array.from({ length: ACTIVITY_WEEKS * 7 }, (_, i) => {
    const day = new Date(start + i * DAY).toISOString().slice(0, 10);
    return {
      day,
      tokens: tokens.get(day) ?? 0,
      future: start + i * DAY > end,
      week: Math.floor(i / 7),
    };
  });
});
const lifetime = computed(() =>
  grid.value.reduce((n, cell) => n + cell.tokens, 0),
);
const peak = computed(() =>
  grid.value.reduce<(typeof grid.value)[number] | null>(
    (best, cell) => (cell.tokens > (best?.tokens ?? 0) ? cell : best),
    null,
  ),
);
const cells = computed(() => {
  const positive = grid.value
    .map((cell) => cell.tokens)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const at = (q: number) =>
    positive[Math.floor(q * (positive.length - 1))] ?? 0;
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)];
  const max = positive.at(-1) ?? 0;
  return grid.value.map((cell) => {
    const value = cell.tokens;
    return {
      ...cell,
      // The busiest day is always the darkest, even with nothing to compare it with.
      level:
        cell.future || value <= 0
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
    };
  });
});
const hiddenWeeks = computed(() => ACTIVITY_WEEKS - fit.value);
const visible = computed(() => cells.value.slice(hiddenWeeks.value * 7));
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
  translate("analytics.activitySummary", {
    tokens: chartFormat(lifetime.value, true),
  }),
);
function show(cell: (typeof cells.value)[number], event: PointerEvent) {
  if (cell.future) return;
  const target = event.currentTarget as HTMLElement;
  hovered.value = {
    x: target.offsetLeft + target.offsetWidth / 2,
    y: target.offsetTop - 8,
    value: translate("analytics.tokensValue", {
      count: chartFormat(cell.tokens, true),
    }),
    label: new Date(cell.day + "T00:00:00Z").toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}
</script>
<style scoped>
.usage-activity {
  --activity-gap: 3px;
  container-type: inline-size;
}
.activity-layout {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-16);
  align-items: center;
}
.activity-summary {
  display: grid;
  gap: var(--space-6);
}
.activity-totals {
  display: grid;
  justify-items: end;
  gap: var(--space-6);
  margin: 0;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.activity-totals dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.activity-totals dd {
  margin: 0;
  font-size: 44px;
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.035em;
  line-height: 1.05;
}
.activity-body {
  min-width: 0;
}
/* Below this width the whole year no longer fits beside the figures, so the grid takes the full row. */
@container (max-width: 820px) {
  .activity-summary {
    display: none;
  }
  .activity-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
.activity-stage {
  position: relative;
}
.activity-cells {
  display: grid;
  grid-template-rows: repeat(7, auto);
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--activity-gap);
}
.activity-cell {
  aspect-ratio: 1;
  border-radius: 25%;
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}
.activity-cell--future {
  visibility: hidden;
}
.activity-cell[data-level="1"] {
  background: color-mix(
    in srgb,
    var(--chart-1) 28%,
    var(--color-surface-lowest)
  );
}
.activity-cell[data-level="2"] {
  background: color-mix(
    in srgb,
    var(--chart-1) 52%,
    var(--color-surface-lowest)
  );
}
.activity-cell[data-level="3"] {
  background: color-mix(
    in srgb,
    var(--chart-1) 78%,
    var(--color-surface-lowest)
  );
}
.activity-cell[data-level="4"] {
  background: color-mix(in srgb, var(--chart-1) 100%, black 22%);
}
.activity-cell:not(.activity-cell--future):hover {
  outline: 2px solid color-mix(in srgb, var(--color-text) 45%, transparent);
  outline-offset: 1px;
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
