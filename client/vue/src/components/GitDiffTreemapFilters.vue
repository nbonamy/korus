<template>
    <div class="diff-treemap__filters" :aria-label="$t('surface.diffTreemap.filterByType')">
      <div class="diff-treemap__filter-items">
        <el-tooltip :content="`${$t('surface.diffTreemap.all')} · ${total}`" placement="top">
          <span class="diff-treemap__filter-target">
            <button type="button" :aria-label="`${$t('surface.diffTreemap.all')} · ${total}`" :aria-pressed="modelValue.length === 0" @click="emit('update:modelValue', [])">
              <i class="diff-treemap__all-dot" aria-hidden="true" /><span class="diff-treemap__filter-label">{{ $t('surface.diffTreemap.all') }}</span><span class="diff-treemap__filter-count">{{ total }}</span>
            </button>
          </span>
        </el-tooltip>
        <el-tooltip v-for="kind in fileKinds" :key="kind" :content="`${fileKindLabel(kind)} · ${counts[kind]} — ${$t('surface.diffTreemap.multiSelectHint')}`" placement="top">
          <span class="diff-treemap__filter-target">
            <button type="button" :aria-label="`${fileKindLabel(kind)} · ${counts[kind]}`" :aria-pressed="modelValue.includes(kind)"
              :disabled="counts[kind] === 0" @click="select(kind, $event)">
              <i :style="{ background: fileKindColor[kind] }" aria-hidden="true" />
              <span class="diff-treemap__filter-label">{{ kind === 'docs' ? $t('surface.diffTreemap.docs') : fileKindLabel(kind) }}</span><span class="diff-treemap__filter-count">{{ counts[kind] }}</span>
            </button>
          </span>
        </el-tooltip>
      </div>
    </div>
</template>

<script setup lang="ts">
import { fileKinds, type FileKind } from '@workspace/core/file-kind';
import { fileKindColor, fileKindLabel } from './file-kind-presentation';
const props = defineProps<{ modelValue: readonly FileKind[]; total: number; counts: Record<FileKind, number> }>();
const emit = defineEmits<{ 'update:modelValue': [kinds: FileKind[]] }>();
function select(kind: FileKind, event: MouseEvent): void {
  const kinds = event.metaKey || event.ctrlKey
    ? props.modelValue.includes(kind) ? props.modelValue.filter(value => value !== kind) : [...props.modelValue, kind]
    : [kind];
  emit('update:modelValue', kinds);
}
</script>

<style scoped>
.diff-treemap__filters { container: diff-map-filters / inline-size; }
.diff-treemap__filter-items { display: flex; flex-wrap: nowrap; gap: var(--space-3); }
.diff-treemap__filter-target { display: inline-flex; }
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
  white-space: nowrap;
  cursor: pointer;
}
.diff-treemap__filters button[aria-pressed="true"] { border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border)); background: var(--color-primary-container); color: var(--color-primary); font-weight: var(--font-weight-semibold); }
.diff-treemap__filters button:disabled { opacity: 0.45; cursor: default; }
.diff-treemap__filter-count { color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.diff-treemap__filters i { width: 9px; height: 9px; flex: 0 0 auto; border-radius: var(--radius-full); }
.diff-treemap__all-dot { background: var(--color-primary); }
.diff-treemap__filters button:hover:not(:disabled) { border-color: var(--color-primary); }
.diff-treemap__filters button[aria-pressed="true"] .diff-treemap__filter-count { color: inherit; }
@container diff-map-filters (max-width: 420px) {
  .diff-treemap__filter-count { display: none; }
}
@container diff-map-filters (max-width: 340px) {
  .diff-treemap__filter-label { display: none; }
}
</style>
