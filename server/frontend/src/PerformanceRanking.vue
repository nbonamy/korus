<template>
  <section
    class="panel performance-ranking"
    :aria-label="
      kind === 'ttft' ? 'Time to first token ranking' : 'Output speed ranking'
    "
  >
    <header>
      <h2>
        {{ kind === "ttft" ? "Time to First Token (TTFT)" : "Output Speed" }}
      </h2>
    </header>
    <table>
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col" class="num">
            {{ kind === "ttft" ? "sec" : "tok/sec" }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in ranked" :key="row.key">
          <td class="model-cell">
            <i
              class="rank-dot"
              :style="{ background: row.color }"
              aria-hidden="true"
            />{{ row.label }}
          </td>
          <td>
            <div class="metric-cell">
              <span class="value-track" aria-hidden="true"
                ><span
                  class="value-fill"
                  :style="{
                    width: width(row.value),
                    backgroundColor: row.color,
                  }"
              /></span>
              <span
                class="num"
                :title="kind === 'ttft' ? duration(row.value) : rate(row.value)"
                >{{
                  performanceNumber(
                    row.value,
                    kind === "ttft" ? "milliseconds" : "rate",
                  )
                }}</span
              >
            </div>
          </td>
        </tr>
        <tr v-if="!ranked.length">
          <td colspan="2" class="muted">No model measurements</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { descending } from "./use-model-comparison";
import { duration, rate, performanceNumber } from "./format";
const props = defineProps<{
  kind: "ttft" | "speed";
  rows: { key: string; label: string; color: string; value: string | null }[];
}>();
const ranked = computed(() =>
  [...props.rows].sort((a, b) =>
    a.value === null
      ? b.value === null
        ? a.label.localeCompare(b.label)
        : 1
      : b.value === null
        ? -1
        : (props.kind === "ttft"
            ? descending(b.value, a.value)
            : descending(a.value, b.value)) || a.label.localeCompare(b.label),
  ),
);
const maximum = computed(() =>
  Math.max(0, ...props.rows.map((row) => Number(row.value ?? 0))),
);
const width = (value: string | null) =>
  value === null || !maximum.value
    ? "0%"
    : `${(Number(value) / maximum.value) * 100}%`;
</script>
<style scoped>
.performance-ranking {
  min-width: 0;
  overflow-x: auto;
  padding: var(--space-10);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-sm);
}
header {
  margin-bottom: var(--space-6);
}
h2 {
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-bold);
}
table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: var(--font-size-13);
}
th,
td {
  padding: var(--space-4);
  border-bottom: 1px solid
    color-mix(in srgb, var(--color-border) 60%, transparent);
  text-align: left;
}
th {
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-regular);
}
th:first-child,
td:first-child {
  padding-left: 0;
}
th:last-child,
td:last-child {
  padding-right: 0;
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr:hover {
  background: color-mix(in srgb, var(--color-text) 3%, transparent);
}
.metric-cell {
  display: grid;
  grid-template-columns: minmax(24px, 1fr) max-content;
  align-items: center;
  gap: var(--space-4);
}
.value-track {
  display: block;
  height: 10px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}
.value-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
}
.num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.model-cell {
  overflow-wrap: anywhere;
  white-space: normal;
  line-height: 1.5;
}
.rank-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: var(--space-4);
  border-radius: 3px;
}

@media (max-width: 560px) {
  .performance-ranking {
    padding: 16px 14px;
  }
  th:first-child,
  td:first-child {
    width: 56%;
  }
}
</style>
