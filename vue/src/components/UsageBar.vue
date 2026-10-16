<template>
  <span class="usage-bar" :class="{ 'usage-bar--thick': thick }">
    <span
      v-if="value !== null"
      :style="{
        width: value + '%',
        background: `linear-gradient(90deg, color-mix(in srgb, ${color} 50%, transparent), ${color})`,
      }"
    />
  </span>
</template>
<script setup lang="ts">
withDefaults(
  defineProps<{ value: number | null; color: string; thick?: boolean }>(),
  { thick: false },
);
</script>
<style scoped>
.usage-bar {
  display: block;
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}
.usage-bar--thick {
  height: 10px;
}
.usage-bar > span {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  transition: width 240ms ease;
}
</style>
