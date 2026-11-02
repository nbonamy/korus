<template>
      <button type="button"
        class="diff-treemap__tile" :data-diff-map-path="file.fullPath"
        :style="style"
        :aria-label="`${file.fullPath}: +${file.addedLines} -${file.removedLines}`"
        @click="emit('select', file.fullPath)">
        <span v-if="canLabel" class="diff-treemap__label">
          <strong class="diff-treemap__name">{{ file.name }}</strong>
          <GitDiffLineStats v-if="canShowStats" :added-lines="file.addedLines" :removed-lines="file.removedLines" />
        </span>
        <span v-if="canLabel && canShowStats" class="diff-treemap__ratio" aria-hidden="true">
          <span :style="{ width: `${file.addedLines / file.weight * 100}%` }" />
        </span>
      </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MapFile } from './diff-treemap-files';
import type { TreemapRect } from './diff-treemap-presentation';
import { fileKindColor } from './file-kind-presentation';
import GitDiffLineStats from './GitDiffLineStats.vue';
const props = defineProps<{ file: MapFile; rect: TreemapRect; size: { width: number; height: number } }>();
const emit = defineEmits<{ select: [path: string] }>();
const style = computed(() => {
  const { file, rect, size } = props;
  return { left: `${rect.x / size.width * 100}%`, top: `${rect.y / size.height * 100}%`, width: `${rect.width / size.width * 100}%`, height: `${rect.height / size.height * 100}%`, '--diff-treemap-file-color': fileKindColor[file.kind] };
});
const canLabel = computed(() => props.rect.width >= 64 && props.rect.height >= 36);
const canShowStats = computed(() => {
  const { file, rect } = props;
  const statsWidth = (String(file.addedLines).length + String(file.removedLines).length + 2) * 7.5 + 24;
  return rect.width >= statsWidth && rect.height >= 60;
});
</script>

<style scoped>
.diff-treemap__tile {
  --diff-treemap-file-color: var(--color-primary);
  position: absolute;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  cursor: pointer;
  overflow: hidden;
}
.diff-treemap__tile:hover, .diff-treemap__tile:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; z-index: 1; background: color-mix(in srgb, var(--diff-treemap-file-color) 12%, transparent); }
.diff-treemap__label { display: flex; flex-direction: column; gap: var(--space-2); position: absolute; inset: 0; padding: var(--space-4); overflow: hidden; }
.diff-treemap__name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--font-weight-semibold); }
.diff-treemap__ratio { position: absolute; inset: auto 2px 2px; height: 4px; overflow: hidden; border-radius: 0; background: var(--color-error); }
.diff-treemap__ratio > span { display: block; height: 100%; background: var(--color-success); }
</style>
