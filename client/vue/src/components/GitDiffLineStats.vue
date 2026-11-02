<template>
  <span class="diff-treemap__stats"><span class="diff-treemap__added">+{{ addedLines }}</span><span class="diff-treemap__removed">-{{ removedLines }}</span></span>
</template>

<script setup lang="ts">
defineProps<{ addedLines: number; removedLines: number }>();
</script>

<style scoped>
.diff-treemap__stats { display: flex; gap: var(--space-4); font-family: var(--font-family-mono); font-size: var(--font-size-12); line-height: var(--line-height-16); font-weight: var(--font-weight-semibold); font-variant-numeric: tabular-nums; white-space: nowrap; }
.diff-treemap__added { color: var(--color-success); }
.diff-treemap__removed { color: var(--color-error); }
</style>
