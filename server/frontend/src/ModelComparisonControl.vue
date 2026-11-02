<template>
  <ElSelect
    v-model="selected"
    multiple
    collapse-tags
    collapse-tags-tooltip
    :max-collapse-tags="1"
    filterable
    :placeholder="
      label === 'Compare providers' ? 'Choose providers' : 'Choose models'
    "
    :aria-label="label"
    class="model-comparison-select"
    popper-class="console-options"
  >
    <ElOption
      v-for="row in choices"
      :key="row.key"
      :value="row.key"
      :label="row.label"
    />
  </ElSelect>
</template>
<script setup lang="ts">
import { ElSelect, ElOption } from "element-plus";
withDefaults(
  defineProps<{ choices: { key: string; label: string }[]; label?: string }>(),
  { label: "Compare models" },
);
const selected = defineModel<string[]>({ required: true });
</script>
