<template>
  <label class="settings-textarea-field">
    <span class="settings-textarea-field__title">{{ title }}</span>
    <span v-if="description" class="settings-textarea-field__description">{{ description }}</span>
    <el-input
      :model-value="modelValue"
      type="textarea"
      :rows="rows"
      :disabled="disabled"
      :placeholder="placeholder"
      :aria-label="title"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </label>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  description?: string;
  disabled?: boolean;
  modelValue: string;
  placeholder?: string;
  rows?: number;
  title: string;
}>(), {
  description: '',
  disabled: false,
  placeholder: '',
  rows: 6,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<style scoped>
.settings-textarea-field {
  display: flex;
  flex-direction: column;
  gap: 0;
  color: var(--color-text);
}

.settings-textarea-field__title,
.settings-textarea-field__description {
  padding: 0 var(--space-2);
}

.settings-textarea-field__title {
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
}

.settings-textarea-field__description {
  margin-top: var(--space-2);
  margin-bottom: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.settings-textarea-field :deep(.el-textarea__inner) {
  border-radius: var(--radius-lg);
  padding: var(--space-8) var(--space-10);
  font-size: var(--font-size-13);
}
</style>
