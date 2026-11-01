<template>
  <span class="status-pill" :class="`status-pill--${tone}`">
    <span class="status-pill__dot" aria-hidden="true" />
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' }>(), { tone: 'neutral' });
</script>

<style scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  background: var(--color-surface-low);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-16);
  white-space: nowrap;
}

.status-pill__dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: var(--radius-full);
  background: currentColor;
}

.status-pill--success {
  background: var(--color-success-container);
  color: var(--color-on-success-container);
}

.status-pill--success .status-pill__dot {
  background: var(--color-success);
}

.status-pill--warning {
  background: var(--color-warning-container);
  color: var(--color-on-warning-container);
}

.status-pill--warning .status-pill__dot {
  background: var(--color-warning);
}

.status-pill--danger {
  background: var(--color-error-container);
  color: var(--color-on-error-container);
}

.status-pill--danger .status-pill__dot {
  background: var(--color-error);
}
</style>
