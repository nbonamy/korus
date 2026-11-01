<template>
  <el-select :model-value="modelValue" :aria-label="label" @update:model-value="$emit('update:modelValue', $event)">
    <el-option v-for="strategy in choices" :key="strategy" :value="strategy" :label="strategyLabel(strategy)" />
  </el-select>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pullStrategies, updateStrategies } from '@workspace/core/git-preferences';
const props = defineProps<{ modelValue: string; kind: 'pull' | 'update'; label: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
const { t } = useI18n();
const choices = computed(() => props.kind === 'pull' ? pullStrategies : updateStrategies);
function strategyLabel(value: string): string { return t(`gitWorkflow.strategies.${value}`); }
</script>
