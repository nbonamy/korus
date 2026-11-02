<template>
  <section class="diff-treemap" :aria-label="$t('surface.diffTreemap.changeMap')">
    <GitDiffTreemapFilters v-model="filter" :total="files.length" :counts="counts" />
    <div v-if="tiles.length" ref="canvas" class="diff-treemap__canvas" @keydown="navigate">
      <GitDiffTreemapChart :files="tiles" @layout="layout = $event" />
      <GitDiffTreemapTile v-for="({ file, rect }, index) in layout.tiles" :key="file.fullPath"
        :file="file" :rect="rect" :size="layout.size" :tabindex="index === focusIndex ? 0 : -1"
        @pointerenter="showTooltip(file, $event)" @pointerleave="leaveTooltip"
        @focus="focusIndex = index; showTooltip(file, $event)" @blur="clearTooltip"
        @select="emit('select', $event)" />
    </div>
    <div v-else class="diff-treemap__empty">{{ $t('surface.diffTreemap.noLineChanges') }}</div>
    <details v-if="withoutLines.length" class="diff-treemap__without-lines">
      <summary>{{ $t('surface.diffTreemap.filesWithoutLines', { count: withoutLines.length }) }}</summary>
      <button v-for="file in withoutLines" :key="file.fullPath" type="button" @click="emit('select', file.fullPath)">{{ file.fullPath }}</button>
    </details>
    <footer>{{ $t('surface.diffTreemap.areaLegend') }}</footer>
    <GitDiffTreemapTooltip :target="tooltipTarget" :file="hovered" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { fileKinds, type FileKind } from '@workspace/core/file-kind';
import GitDiffTreemapFilters from './GitDiffTreemapFilters.vue';
import GitDiffTreemapTile from './GitDiffTreemapTile.vue';
import GitDiffTreemapChart from './GitDiffTreemapChart.vue';
import GitDiffTreemapTooltip from './GitDiffTreemapTooltip.vue';
import { diffTreemapFiles, type FileStat, type MapFile } from './diff-treemap-files';
import type { TreemapLayout } from './diff-treemap-presentation';

const props = defineProps<{ files: readonly FileStat[] }>();
const emit = defineEmits<{ select: [path: string] }>();
const filter = defineModel<FileKind | null>('kind', { default: null });
const files = computed(() => diffTreemapFiles(props.files));
const counts = computed(() => Object.fromEntries(fileKinds.map(kind => [kind, files.value.filter(file => file.kind === kind).length])) as Record<FileKind, number>);
const visible = computed(() => files.value.filter(file => !filter.value || file.kind === filter.value));
const tiles = computed(() => visible.value.filter(file => file.weight > 0));
const withoutLines = computed(() => visible.value.filter(file => file.weight === 0));
const canvas = ref<HTMLElement>();
const layout = shallowRef<TreemapLayout>({ size: { width: 320, height: 400 }, tiles: [] });
const hovered = shallowRef<MapFile>();
const tooltipTarget = shallowRef<HTMLElement>();
const focusIndex = ref(0);
function showTooltip(file: MapFile, event: Event): void {
  hovered.value = file;
  tooltipTarget.value = event.currentTarget as HTMLElement;
}
function clearTooltip(): void { hovered.value = undefined; }
function leaveTooltip(event: PointerEvent): void {
  if (document.activeElement !== event.currentTarget) clearTooltip();
}
watch(visible, () => { focusIndex.value = 0; clearTooltip(); });
watch([() => layout.value.size.width, () => layout.value.size.height], () => {
  if (document.activeElement !== tooltipTarget.value) clearTooltip();
});
async function navigate(event: KeyboardEvent): Promise<void> {
  if (event.key === 'Escape') { clearTooltip(); return; }
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  focusIndex.value = event.key === 'Home' ? 0 : event.key === 'End' ? tiles.value.length - 1
    : (focusIndex.value + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + tiles.value.length) % tiles.value.length;
  await nextTick();
  canvas.value?.querySelectorAll<HTMLButtonElement>('button')[focusIndex.value]?.focus();
}
</script>

<style scoped>
.diff-treemap {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  min-height: 0;
  padding: var(--space-6);
  overflow: auto;
  font-family: var(--font-family-ui);
  font-size: var(--font-size-12);
}
.diff-treemap__canvas { position: relative; flex: 1 1 auto; min-height: 240px; overflow: hidden; }
.diff-treemap__without-lines { flex: 0 0 auto; color: var(--color-text-muted); }
.diff-treemap__without-lines summary { cursor: pointer; }
.diff-treemap__without-lines button { display: block; max-width: 100%; padding: var(--space-2) 0; overflow-wrap: anywhere; border: 0; color: var(--color-text); background: transparent; font: inherit; text-align: left; cursor: pointer; }
.diff-treemap__empty { flex: 1; padding: var(--space-6); color: var(--color-text-muted); }
.diff-treemap footer { flex: 0 0 auto; color: var(--color-text-muted); }
</style>
