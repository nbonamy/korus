<template>
  <section class="panel popularity" :aria-label="title">
    <header class="panel-heading">
      <h2>{{ title }}</h2>
    </header>
    <ol class="model-ranking" :aria-label="title">
      <li v-for="row in ranked" :key="row.label">
        <span class="rank-label">{{ row.label }}</span
        ><span class="rank-track" aria-hidden="true"
          ><span
            :style="{ width: width(row.value), background: row.color }" /></span
        ><strong :title="exactMeasurement(row.value, measure)">{{
          measurement(row.value, measure)
        }}</strong>
      </li>
    </ol>
    <p v-if="!ranked.length" class="muted">No data for this selection.</p>
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue";
import {
  measurement,
  exactMeasurement,
  plotValue,
  type Measure,
} from "./format";
const props = defineProps<{
  title: string;
  measure: Measure;
  rows: { label: string; value: string | null; color: string }[];
}>();
const ranked = computed(() =>
  [...props.rows].sort((a, b) =>
    a.value === null
      ? 1
      : b.value === null
        ? -1
        : Number(b.value) - Number(a.value) || a.label.localeCompare(b.label),
  ),
);
const width = (value: string | null) => {
  const n = plotValue(value),
    max = plotValue(ranked.value[0]?.value ?? null);
  return `${n !== null && max ? (n / max) * 100 : 0}%`;
};
</script>
<style scoped>
.model-ranking li {
  grid-template-columns: minmax(140px, 1fr) minmax(60px, 2fr) 100px;
}
@media (max-width: 768px) {
  .model-ranking li {
    grid-template-columns: minmax(0, 1fr) 100px;
  }
  .rank-label {
    grid-column: 1/-1;
  }
}
</style>
