<template>
  <ElSegmented
    v-model="grouping"
    :aria-label="label"
    :options="[
      { label: 'Provider', value: 'provider' },
      { label: 'Model', value: 'model' },
    ]"
  />
</template>
<script setup lang="ts">
import { ElSegmented } from "element-plus";
import type { ReportGrouping } from "./use-report-groups";
defineProps<{ label: string }>();
const grouping = defineModel<ReportGrouping>({ required: true });
</script>
