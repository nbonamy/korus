<template>
  <component :is="as" class="usage-card"><slot /></component>
</template>
<script setup lang="ts">
withDefaults(defineProps<{ as?: string }>(), { as: "div" });
</script>
<style scoped>
.usage-card {
  min-width: 0;
  padding: var(--space-10);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}
</style>
