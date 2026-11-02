<template>
    <div class="diff-treemap__filters" :aria-label="$t('surface.diffTreemap.filterByType')">
      <button type="button" :aria-pressed="modelValue === null" @click="emit('update:modelValue', null)">
        <i class="diff-treemap__all-dot" aria-hidden="true" />{{ $t('surface.diffTreemap.all') }} <span>{{ total }}</span>
      </button>
      <button v-for="kind in fileKinds" :key="kind" type="button" :aria-pressed="modelValue === kind"
        :disabled="counts[kind] === 0" @click="emit('update:modelValue', kind)">
        <i :style="{ background: diffTreemapColor[kind] }" aria-hidden="true" />
        {{ kind === 'docs' ? $t('surface.diffTreemap.docs') : fileKindLabel(kind) }} <span>{{ counts[kind] }}</span>
      </button>
    </div>
</template>

<script setup lang="ts">
import { fileKinds, type FileKind } from '@workspace/core/file-kind';
import { fileKindLabel } from './file-kind-presentation';
import { diffTreemapColor } from './diff-treemap-presentation';
defineProps<{ modelValue: FileKind | null; total: number; counts: Record<FileKind, number> }>();
const emit = defineEmits<{ 'update:modelValue': [kind: FileKind | null] }>();
</script>

<style scoped>
.diff-treemap__filters { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.diff-treemap__filters button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 30px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-lowest);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
.diff-treemap__filters button[aria-pressed="true"] { border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border)); background: var(--color-primary-container); color: var(--color-primary); font-weight: var(--font-weight-semibold); }
.diff-treemap__filters button:disabled { opacity: 0.45; cursor: default; }
.diff-treemap__filters button span { color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.diff-treemap__filters i { width: 9px; height: 9px; flex: 0 0 auto; border-radius: var(--radius-full); }
.diff-treemap__all-dot { background: var(--chart-1); }
.diff-treemap__filters button:hover:not(:disabled) { border-color: var(--color-primary); }
.diff-treemap__filters button[aria-pressed="true"] span { color: inherit; }
</style>
