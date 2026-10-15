<template>
  <div class="usage-toggle" role="radiogroup" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      class="usage-toggle__option"
      :class="{ 'usage-toggle__option--active': option.value === modelValue }"
      :aria-checked="option.value === modelValue"
      @click="emit('update:modelValue', option.value)"
    >
      <i v-if="option.color" :style="{ background: option.color }" />{{
        option.label
      }}
    </button>
  </div>
</template>
<script setup lang="ts" generic="T extends string | number">
defineProps<{
  modelValue: T | null;
  options: { value: T; label: string; color?: string }[];
  label: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();
</script>
<style scoped>
.usage-toggle {
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}
.usage-toggle__option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-6);
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 140ms ease,
    color 140ms ease,
    box-shadow 140ms ease;
}
.usage-toggle__option:hover {
  color: var(--color-text);
}
.usage-toggle__option:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
.usage-toggle__option--active {
  background: var(--color-surface-lowest);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
}
.usage-toggle__option i {
  width: 8px;
  height: 8px;
  border-radius: 3px;
}
</style>
