<template>
  <svg
    class="sparkline"
    viewBox="0 0 120 36"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="currentColor" stop-opacity="0.28" />
        <stop offset="1" stop-color="currentColor" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path v-if="area" :d="area" :fill="`url(#${uid})`" />
    <path v-if="line" :d="line" class="spark-line" />
  </svg>
</template>
<script setup lang="ts">
import { computed, useId } from "vue";
const props = defineProps<{ values: number[] }>();
const uid = useId();
const coordinates = computed(() => {
  const count = props.values.length;
  if (count < 2 || !props.values.some((value) => value > 0)) return [];
  const max = Math.max(...props.values);
  return props.values.map((value, index) => ({
    x: (index * 120) / (count - 1),
    y: 33 - (value / max) * 29,
  }));
});
const line = computed(() => {
  const points = coordinates.value;
  if (!points.length) return "";
  let path = `M${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mid = {
      x: (points[i]!.x + points[i + 1]!.x) / 2,
      y: (points[i]!.y + points[i + 1]!.y) / 2,
    };
    path += ` Q${points[i]!.x} ${points[i]!.y} ${mid.x} ${mid.y}`;
  }
  const last = points[points.length - 1]!;
  return path + ` L${last.x} ${last.y}`;
});
const area = computed(() =>
  line.value ? `${line.value} L120 36 L0 36 Z` : "",
);
</script>
<style scoped>
.sparkline {
  display: block;
  width: 100%;
  height: 36px;
  overflow: visible;
}
.spark-line {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
</style>
