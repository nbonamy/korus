<template>
  <section class="form-field" :class="compact ? 'form-field--compact' : 'app-form-dialog__field'">
    <div v-if="!compact" class="app-form-dialog__field-heading">
      <label v-if="labelFor" class="app-form-dialog__label" :for="labelFor">{{ label }}</label>
      <span v-else class="app-form-dialog__label">{{ label }}</span>
      <p v-if="help" class="app-form-dialog__help">{{ help }}</p>
    </div>
    <template v-else>
      <label v-if="labelFor" class="form-field__label" :for="labelFor">{{ label }}</label>
      <span v-else class="form-field__label">{{ label }}</span>
    </template>
    <slot />
    <p v-if="compact && help" class="form-field__help">{{ help }}</p>
    <slot name="feedback" />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

// `default` is the dialog layout (bold label, help under the label); `compact` is the
// grid-form layout (muted label above the control, help under the control).
const props = withDefaults(defineProps<{
  density?: 'default' | 'compact';
  help?: string;
  label: string;
  labelFor?: string;
}>(), {
  density: 'default',
  help: '',
  labelFor: '',
});
const compact = computed(() => props.density === 'compact');
</script>

<style scoped>
.form-field--compact {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-field__label {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-18);
}

.form-field__help {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.form-field--compact :deep(.el-select),
.form-field--compact :deep(.el-input),
.form-field--compact :deep(.el-input-number),
.form-field--compact :deep(.el-textarea) {
  width: 100%;
}
</style>
