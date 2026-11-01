<template>
  <ElSelect
    v-model="selected"
    multiple
    collapse-tags
    collapse-tags-tooltip
    :max-collapse-tags="1"
    filterable
    placeholder="Choose models"
    aria-label="Compare models"
    class="model-comparison-select"
    popper-class="console-options"
  >
    <ElOption
      v-for="row in choices"
      :key="modelKey(row)"
      :value="modelKey(row)"
      :label="comparisonLabel(row)"
    />
  </ElSelect>
</template>
<script setup lang="ts">
import { ElSelect, ElOption } from "element-plus";
import {
  modelKey,
  comparisonLabel,
  type ModelRow,
} from "./use-model-comparison";
defineProps<{ choices: ModelRow[] }>();
const selected = defineModel<string[]>({ required: true });
</script>
