<template>
  <ElSegmented
    :model-value="modelValue ?? undefined"
    :options="options"
    :aria-label="label"
    @update:model-value="emit('update:modelValue', $event as T)"
  >
    <template #default="{ item }">
      <span class="usage-option"
        ><i v-if="item.color" :style="{ background: item.color }" />{{
          item.label
        }}</span
      >
    </template>
  </ElSegmented>
</template>
<script setup lang="ts" generic="T extends string | number">
import { ElSegmented } from "element-plus";
defineProps<{
  modelValue: T | null;
  options: { value: T; label: string; color?: string }[];
  label: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();
</script>
<style scoped>
.usage-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}
.usage-option i {
  width: 8px;
  height: 8px;
  border-radius: 3px;
}
</style>
