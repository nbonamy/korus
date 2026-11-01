<template>
  <div class="app-form-dialog__control app-form-dialog__input-control" :class="{ 'clearable-text-input--subtle': subtle }">
    <input
      v-bind="$attrs"
      ref="input"
      class="app-form-dialog__text-input"
      type="text"
      :value="modelValue"
      :disabled="disabled"
      :readonly="readonly"
      :autofocus="autofocus"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span class="clearable-text-input__action">
      <button
        v-if="modelValue && !disabled && !readonly"
        class="clearable-text-input__clear"
        type="button"
        :aria-label="clearLabel ?? $t('common.clearText')"
        :title="clearLabel ?? $t('common.clearText')"
        @mousedown.prevent
        @click="clear"
      >
        <IconX :size="16" aria-hidden="true" />
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
import { IconX } from '@tabler/icons-vue';
import { nextTick, ref, watch } from 'vue';

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  autofocus?: boolean;
  subtle?: boolean;
  selectOnMount?: boolean;
  modelValue: string;
  clearLabel?: string;
  disabled?: boolean;
  readonly?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const input = ref<HTMLInputElement | null>(null);

watch(() => props.autofocus && !props.disabled, async (autofocus) => {
  if (!autofocus) return;
  await nextTick();
  if (props.disabled) return;
  input.value?.focus();
  if (props.selectOnMount) input.value?.select();
}, { immediate: true, flush: 'post' });

async function clear(): Promise<void> {
  emit('update:modelValue', '');
  await nextTick();
  input.value?.focus();
}
</script>

<style scoped>
.clearable-text-input--subtle,
.clearable-text-input--subtle:focus-within {
  min-height: 36px;
  border-color: color-mix(in srgb, var(--color-border) 50%, transparent);
  border-radius: var(--radius-md);
  background: transparent;
  box-shadow: none;
}

.clearable-text-input--subtle input {
  padding: var(--space-3) var(--space-6);
}

.clearable-text-input__action {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--space-16);
}

.clearable-text-input__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--space-12);
  height: var(--space-12);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.clearable-text-input__clear:hover,
.clearable-text-input__clear:focus-visible {
  color: var(--color-text);
  background: var(--color-surface-high);
}

.clearable-text-input__clear:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
</style>
