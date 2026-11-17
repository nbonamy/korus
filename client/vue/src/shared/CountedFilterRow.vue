<template>
  <div class="counted-filter" :class="{ 'counted-filter--wrap': wrap }" role="group" :aria-label="label">
    <div class="counted-filter__items">
      <button class="agent-ui-interactive" type="button" :aria-label="`${allLabel} · ${total}`" :aria-pressed="modelValue.length === 0" @click="emit('update:modelValue', [])">
        <i class="counted-filter__all-dot" aria-hidden="true" /><span class="counted-filter__label">{{ allLabel }}</span><span class="counted-filter__count">{{ total }}</span>
      </button>
      <button class="agent-ui-interactive" v-for="option in options" :key="option.value" type="button"
        :aria-label="`${option.label} · ${option.count}`" :aria-pressed="modelValue.includes(option.value)"
        :disabled="option.count === 0 && !modelValue.includes(option.value)" @click="select(option.value, $event)">
        <i v-if="option.color" :style="{ background: option.color }" aria-hidden="true" />
        <span class="counted-filter__label">{{ option.shortLabel ?? option.label }}</span><span class="counted-filter__count">{{ option.count }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
const props = defineProps<{
  modelValue: readonly T[];
  options: readonly { value: T; label: string; shortLabel?: string; count: number; color?: string }[];
  label: string;
  allLabel: string;
  total: number;
  wrap?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [values: T[]] }>();
function select(value: T, event: MouseEvent): void {
  emit('update:modelValue', event.metaKey || event.ctrlKey
    ? props.modelValue.includes(value) ? props.modelValue.filter(item => item !== value) : [...props.modelValue, value]
    : [value]);
}
</script>

<style scoped>
.counted-filter { container: counted-filters / inline-size; }
.counted-filter__items { display: flex; flex-wrap: nowrap; gap: var(--space-3); }
.counted-filter--wrap .counted-filter__items { flex-wrap: wrap; }
.counted-filter button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 30px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  --agent-ui-state-rest-foreground: var(--color-text);
  font: inherit;
  white-space: nowrap;
}
.counted-filter button[aria-pressed="true"] { font-weight: var(--font-weight-semibold); }
.counted-filter__count { color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.counted-filter i { width: 9px; height: 9px; flex: 0 0 auto; border-radius: var(--radius-full); }
.counted-filter__all-dot { background: var(--color-primary); }
.counted-filter button[aria-pressed="true"] .counted-filter__count { color: inherit; }
@container counted-filters (max-width: 420px) {
  .counted-filter:not(.counted-filter--wrap) .counted-filter__count { display: none; }
}
@container counted-filters (max-width: 340px) {
  .counted-filter:not(.counted-filter--wrap) .counted-filter__label { display: none; }
}
</style>
