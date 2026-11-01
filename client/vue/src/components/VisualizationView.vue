<template>
  <div class="visualization-view" :class="{ 'visualization-view--compact': compact }">
    <div
      class="visualization-view__viewport"
      :class="{ 'visualization-view__viewport--pannable': !compact && scale > 1, 'visualization-view__viewport--panning': panning }"
      :tabindex="compact ? undefined : 0"
      :aria-label="compact ? undefined : translate('visualize.canvasInteraction')"
      @wheel="handleWheel"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="stopPan"
      @pointercancel="stopPan"
      @keydown="handleKeydown"
    >
      <div v-if="error" class="visualization-view__error" role="alert"><slot name="error" :error="error">{{ error }}</slot></div>
      <div v-else-if="visualization.content.kind === 'image' && !imageSource" class="visualization-view__loading">{{ translate('common.loading') }}</div>
      <img
        v-else
        class="visualization-view__image"
        :src="source"
        :alt="visualization.content.kind === 'image' ? visualization.content.alt : visualization.title"
        :style="imageTransform"
        draggable="false"
      />
    </div>
    <div v-if="!compact" class="visualization-view__controls">
      <button type="button" :aria-label="translate('visualize.zoomOut')" :disabled="scale <= minScale" @click="zoomBy(-zoomStep)">−</button>
      <button type="button" :aria-label="translate('visualize.resetView')" @click="resetView">{{ Math.round(scale * 100) }}%</button>
      <button type="button" :aria-label="translate('visualize.zoomIn')" :disabled="scale >= maxScale" @click="zoomBy(zoomStep)">+</button>
      <span class="sr-only" aria-live="polite">{{ translate('visualize.zoomLevel', { percent: Math.round(scale * 100) }) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { sanitizeSvg } from './visualization-svg';
import { renderMermaidSVG } from 'beautiful-mermaid';
import type { Visualization } from '@workspace/core/visualize';
import { translate } from '../i18n';
import { visualizationRenderKey } from './visualization-render-key';

const props = withDefaults(defineProps<{
  compact?: boolean;
  visualization: Pick<Visualization, 'id' | 'title' | 'content' | 'canvas'>;
  imageSource?: string;
  loadError?: string;
}>(), {
  compact: false,
  imageSource: '',
  loadError: '',
});

const rendering = computed(() => {
  try {
    if (props.visualization.canvas?.preview) return { source: props.visualization.canvas.preview, error: '' };
    if (props.visualization.content.kind === 'image') return { source: props.imageSource, error: '' };
    const raw = props.visualization.content.kind === 'mermaid'
      ? renderMermaidSVG(props.visualization.content.source, { transparent: true })
      : props.visualization.content.source;
    const svg = sanitizeSvg(raw);
    return { source: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, error: '' };
  } catch (error) {
    return { source: '', error: error instanceof Error ? error.message : String(error) };
  }
});

const source = computed(() => rendering.value.source);
const error = computed(() => props.loadError || rendering.value.error);
const minScale = 0.5;
const maxScale = 4;
const zoomStep = 0.25;
const wheelZoomSensitivity = 0.001;
const scale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const panning = ref(false);
let panOrigin: { pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null = null;
const imageTransform = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`,
}));

watch(() => visualizationRenderKey(props.visualization), resetView);

function zoomBy(delta: number): void {
  if (props.compact) return;
  scale.value = Math.min(maxScale, Math.max(minScale, Number((scale.value + delta).toFixed(3))));
  if (scale.value <= 1) {
    offsetX.value = 0;
    offsetY.value = 0;
  }
}

function handleWheel(event: WheelEvent): void {
  if (props.compact) return;
  event.preventDefault();
  const modeMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? 100
      : 1;
  const delta = Math.max(-60, Math.min(60, event.deltaY * modeMultiplier));
  zoomBy(-delta * wheelZoomSensitivity);
}

function startPan(event: PointerEvent): void {
  if (props.compact || scale.value <= 1 || event.button !== 0) return;
  panning.value = true;
  panOrigin = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    offsetX: offsetX.value,
    offsetY: offsetY.value,
  };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function movePan(event: PointerEvent): void {
  if (!panning.value || !panOrigin) return;
  offsetX.value = panOrigin.offsetX + event.clientX - panOrigin.pointerX;
  offsetY.value = panOrigin.offsetY + event.clientY - panOrigin.pointerY;
}

function stopPan(): void {
  panning.value = false;
  panOrigin = null;
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.compact || scale.value <= 1) return;
  const movement = event.shiftKey ? 50 : 20;
  const offsets: Partial<Record<KeyboardEvent['key'], [number, number]>> = {
    ArrowLeft: [movement, 0],
    ArrowRight: [-movement, 0],
    ArrowUp: [0, movement],
    ArrowDown: [0, -movement],
  };
  const offset = offsets[event.key];
  if (!offset) return;
  event.preventDefault();
  offsetX.value += offset[0];
  offsetY.value += offset[1];
}

function resetView(): void {
  scale.value = 1;
  offsetX.value = 0;
  offsetY.value = 0;
  stopPan();
}

</script>

<style scoped>
.visualization-view {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.visualization-view__viewport {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
  outline: none;
  touch-action: none;
}

.visualization-view__viewport:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-primary);
}

.visualization-view__viewport--pannable {
  cursor: grab;
}

.visualization-view__viewport--panning {
  cursor: grabbing;
}

.visualization-view__image {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center;
  transition: transform 120ms ease-out;
  user-select: none;
}

.visualization-view__viewport--panning .visualization-view__image {
  transition: none;
}

.visualization-view--compact {
  overflow: hidden;
}

.visualization-view--compact .visualization-view__image {
  width: 100%;
  height: 100%;
}

.visualization-view__controls {
  position: absolute;
  right: var(--space-8);
  bottom: var(--space-8);
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--color-outline-variant);
  border-radius: var(--radius-lg);
  background: var(--color-overlay);
  box-shadow: var(--shadow-sm);
}

.visualization-view__controls button {
  min-width: 30px;
  height: 28px;
  padding: 0 var(--space-6);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.visualization-view__controls button:hover:not(:disabled) {
  background: var(--color-surface-high);
}

.visualization-view__controls button:disabled {
  opacity: 0.45;
  cursor: default;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.visualization-view__loading,
.visualization-view__error {
  padding: var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  text-align: center;
}

.visualization-view__error {
  color: var(--color-error);
}
</style>
