<template>
  <div class="diff-viz-canvas">
    <div class="diff-viz-canvas__viewport">
      <div ref="host" class="diff-viz-canvas__host" />
      <div class="diff-viz-canvas__targets">
        <div v-for="target in targets" :key="target.id" class="diff-viz-canvas__node" :data-status="target.status"
          :style="{ left: `${target.x}px`, top: `${target.y}px`, width: `${target.width}px`, height: `${target.height}px` }">
          <button v-if="target.paths.length" type="button" class="diff-viz-canvas__target"
            :aria-label="translate('surface.diffViz.openChanges', { label: target.label })" :title="diffVizTooltip(target)" @click="emit('select', target.paths, target.locations?.[0])" />
          <span v-else role="img" :aria-label="`${target.label} · ${translate('surface.diffViz.unchanged')}`" />
        </div>
      </div>
      <div class="diff-viz-canvas__controls">
        <button type="button" class="app-button app-button--tertiary" :disabled="!ready" :aria-label="translate('visualize.zoomOut')" @click="editor?.zoomBy(-0.1)"><MinusIcon aria-hidden="true" /></button>
        <button type="button" class="app-button app-button--tertiary" :disabled="!ready" :aria-label="translate('visualize.zoomIn')" @click="editor?.zoomBy(0.1)"><PlusIcon aria-hidden="true" /></button>
        <button type="button" class="app-button app-button--tertiary" :disabled="!ready" :aria-label="translate('visualize.fitCanvas')" @click="editor?.fit()"><ArrowsMinimizeIcon aria-hidden="true" /></button>
      </div>
      <div v-if="error || !ready" class="diff-viz-canvas__status" role="status">
        {{ error || translate('common.loading') }}
        <button v-if="error" type="button" class="app-button app-button--secondary" @click="load">{{ translate('visualize.retryLoad') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { type NativeDiffVizDiagram, type DiffVizLocation } from '@workspace/core/git-diff-viz';
import { diffVizTooltip } from './diff-viz-tooltip';
import type { CanvasAnnotationTarget, mountCanvas } from './excalidraw-editor';
import { translate } from '../i18n';
import { ArrowsMinimizeIcon, MinusIcon, PlusIcon } from '../shared/icons/app-icons';

const props = defineProps<{ diagram: NativeDiffVizDiagram }>();
const emit = defineEmits<{ select: [paths: string[], location?: DiffVizLocation] }>();
const host = ref<HTMLElement>();
const ready = ref(false);
const error = ref('');
const targets = ref<Array<CanvasAnnotationTarget & NativeDiffVizDiagram['nodes'][number]>>([]);
let editor: ReturnType<typeof mountCanvas> | undefined;
let disposed = false;
let epoch = 0;
let recolor: (() => void) | undefined;
let colorEpoch = 0;
const themeObserver = new MutationObserver(() => recolor?.());
function refreshTargets() {
  const metadata = new Map(props.diagram.nodes.map(target => [target.id, target]));
  targets.value = (editor?.getAnnotationTargets() ?? []).flatMap(target => metadata.has(target.id) ? [{ ...target, ...metadata.get(target.id)! }] : []);
}
async function load() {
  const request = ++epoch;
  const diagram = props.diagram;
  error.value = '';
  ready.value = false;
  editor?.dispose();
  editor = undefined;
  targets.value = [];
  try {
    const [{ mountCanvas }, { diffVizScene }] = await Promise.all([import('./excalidraw-editor'), import('./diff-viz-scene')]);
    const scene = await diffVizScene(diagram);
    if (disposed || request !== epoch || !host.value) return;
    editor = mountCanvas(host.value, scene, () => { void nextTick(refreshTargets); }, cause => { if (request === epoch) error.value = cause.message; }, refreshTargets, { nativeColors: true });
    recolor = () => {
      const colorRequest = ++colorEpoch;
      void diffVizScene(props.diagram).then(scene => {
        if (!disposed && request === epoch && colorRequest === colorEpoch) editor?.update(scene, false);
      }).catch(cause => { if (!disposed && request === epoch && colorRequest === colorEpoch) error.value = cause instanceof Error ? cause.message : String(cause); });
    };
    ready.value = true;
  } catch (cause) { if (!disposed && request === epoch) error.value = cause instanceof Error ? cause.message : String(cause); }
}
onMounted(() => { themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] }); void load(); });
watch(() => props.diagram, load);
onBeforeUnmount(() => { disposed = true; epoch++; recolor = undefined; themeObserver.disconnect(); editor?.dispose(); });
</script>

<style scoped>
.diff-viz-canvas { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.diff-viz-canvas__viewport { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.diff-viz-canvas__host, .diff-viz-canvas__targets { position: absolute; inset: 0; }
.diff-viz-canvas__targets { z-index: 2; pointer-events: none; overflow: hidden; }
.diff-viz-canvas__node { position: absolute; }
.diff-viz-canvas__target { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; border-radius: inherit; background: transparent; cursor: pointer; pointer-events: auto; }
.diff-viz-canvas__target:hover, .diff-viz-canvas__target:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.diff-viz-canvas__controls { position: absolute; z-index: 3; right: var(--space-6); bottom: var(--space-6); display: flex; gap: var(--space-2); padding: var(--space-1); border-radius: var(--radius-lg); background: var(--color-surface-lowest); }
.diff-viz-canvas__status { position: absolute; z-index: 4; inset: 0; display: flex; align-items: center; justify-content: center; gap: var(--space-4); color: var(--color-text-muted); background: var(--color-surface-lowest); }
.diff-viz-canvas__host :deep(.excalidraw) { background: transparent; }
.diff-viz-canvas__host :deep(.App-menu_top), .diff-viz-canvas__host :deep(.App-bottom-bar), .diff-viz-canvas__host :deep(.layer-ui__wrapper__footer) { display: none !important; }
</style>
