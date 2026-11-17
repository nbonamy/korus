<template>
  <ElSegmented
    class="app-segmented"
    :class="props.size && props.size !== 'default' ? `app-segmented--${props.size}` : undefined"
    :model-value="modelValue ?? undefined"
    :options="options"
    :aria-label="label"
    @update:model-value="emit('update:modelValue', $event as T)"
  >
    <template #default="{ item }">
      <span v-if="item.icon || item.color" class="app-segmented__option">
        <component :is="item.icon" v-if="item.icon" aria-hidden="true" />
        <i v-if="item.color" :style="{ background: item.color }" />
        <span>{{ item.label }}</span>
      </span>
      <template v-else>{{ item.label }}</template>
    </template>
  </ElSegmented>
</template>

<script setup lang="ts" generic="T extends string | number">
import { ElSegmented } from 'element-plus';
import type { Component } from 'vue';
import type { AppSegmentedSize } from './app-segmented';

/** The app's segmented control: the one place that decides how it looks, so no caller styles Element Plus internals. */
const props = defineProps<{
  modelValue: T | null;
  options: { value: T; label: string; icon?: Component; color?: string; disabled?: boolean }[];
  /** The group's accessible name. */
  label: string;
  size?: AppSegmentedSize;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: T] }>();
</script>

<style scoped>
.app-segmented {
  --agent-ui-state-selected: var(--color-surface-lowest);
  --el-segmented-padding: var(--space-2);
  --el-segmented-bg-color: var(--color-control-fill);
  --el-segmented-color: var(--color-text-muted);
  --el-segmented-item-selected-color: var(--color-text);
  --el-segmented-item-selected-bg-color: var(--agent-ui-state-selected);
  --el-segmented-item-selected-disabled-bg-color: var(--color-surface-low);
  --el-segmented-item-hover-color: var(--color-text);
  --el-segmented-item-hover-bg-color: var(--agent-ui-state-hover);
  --el-segmented-item-active-bg-color: var(--agent-ui-state-pressed);
  border-radius: var(--radius-full);
  font-size: var(--font-size-13);
}

.app-segmented :deep(.el-segmented__item),
.app-segmented :deep(.el-segmented__item-selected) {
  border-radius: var(--radius-full);
}

.app-segmented :deep(.el-segmented__item-selected) {
  box-shadow: none;
}

.app-segmented :deep(.el-segmented__item) {
  padding: 0 var(--space-8);
}

.app-segmented--small {
  --el-segmented-padding: var(--space-1);
  min-height: 24px;
  font-size: var(--font-size-11);
}

.app-segmented--small :deep(.el-segmented__item) {
  padding: 0 var(--space-6);
}

.app-segmented--compact {
  --el-segmented-padding: var(--space-1);
  font-weight: var(--font-weight-semibold);
}

.app-segmented--compact :deep(.el-segmented__item) {
  padding: var(--space-2) var(--space-6);
}

.app-segmented__option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}

.app-segmented__option svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.app-segmented__option i {
  width: 8px;
  height: 8px;
  border-radius: 3px;
}
</style>
