<template>
  <p
    class="weekly-change"
    :data-trend="change.direction"
    :aria-label="change.description"
  >
    <svg
      v-if="change.direction !== 'flat'"
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
          change.direction === 'up'
            ? 'M4 17l7-7 4 4 6-9M15 5h6v6'
            : 'M4 7l7 7 4-4 6 9M15 19h6v-6'
        "
      />
    </svg>
    {{ change.label }}
  </p>
</template>
<script setup lang="ts">
defineProps<{
  change: { direction: string; label: string; description: string };
}>();
</script>
<style scoped>
.weekly-change {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  padding: 3px 9px;
  border-radius: 100px;
  background: var(--color-surface-low);
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.weekly-change[data-trend="up"] {
  background: var(--color-success-container);
  color: var(--color-success);
}
.weekly-change[data-trend="down"] {
  background: var(--color-error-container);
  color: var(--color-error);
}
.weekly-change svg {
  width: 14px;
  height: 14px;
}
</style>
