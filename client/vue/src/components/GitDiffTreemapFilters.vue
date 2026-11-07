<template>
  <CountedFilterRow class="diff-treemap__filters" :model-value="modelValue" :options="options" :total="total"
    :label="$t('surface.diffTreemap.filterByType')" :all-label="$t('surface.diffTreemap.all')"
    @update:model-value="emit('update:modelValue', $event)" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { fileKinds, type FileKind } from '@workspace/core/file-kind';
import { fileKindColor, fileKindLabel } from './file-kind-presentation';
import CountedFilterRow from '../shared/CountedFilterRow.vue';
const props = defineProps<{ modelValue: readonly FileKind[]; total: number; counts: Record<FileKind, number> }>();
const emit = defineEmits<{ 'update:modelValue': [kinds: FileKind[]] }>();
const { t } = useI18n();
const options = computed(() => fileKinds.map(kind => ({ value: kind, count: props.counts[kind], color: fileKindColor[kind],
  label: fileKindLabel(kind), shortLabel: kind === 'docs' ? t('surface.diffTreemap.docs') : undefined })));
</script>
