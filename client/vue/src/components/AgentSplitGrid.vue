<template>
  <div ref="root" class="agent-split-grid" :data-layout="layout" :class="{ 'agent-split-grid--resizing': drag }" :style="gridStyle">
    <section
      v-for="(pane, index) in panes"
      :key="pane.id"
      class="agent-split-grid__pane"
      :class="{ 'agent-split-grid__pane--focused': focusedPaneId === pane.id }"
      :data-pane-id="pane.id"
      :data-agent-id="pane.agentId ?? undefined"
      @pointerdown.capture="focusPane(pane.id, $event)"
      @focusin.capture="focusPane(pane.id, $event)"
    >
      <slot name="header" :agent-id="pane.agentId" :top-left="index === 0"
        :top-right="index === (layout === '2-horizontal' || layout === 'single' ? 0 : 1)" />
      <slot
        v-if="pane.agentId"
        :agent-id="pane.agentId"
        :focused="focusedPaneId === pane.id"
      />
      <button
        v-else
        class="agent-split-grid__empty"
        type="button"
        @click="emit('focus', pane.id)"
      >
        {{ t('split.selectAgent') }}
      </button>
    </section>
    <div
      v-for="axis in axes"
      :key="axis"
      class="agent-split-grid__divider"
      :class="`agent-split-grid__divider--${axis}`"
      :style="axis === 'columns' ? { left: `${effectiveRatios.columns * 100}%` } : { top: `${effectiveRatios.rows * 100}%` }"
      role="separator"
      :aria-label="t(`split.resize${axis === 'columns' ? 'Columns' : 'Rows'}`)"
      :aria-orientation="axis === 'columns' ? 'vertical' : 'horizontal'"
      :aria-valuemin="Math.round(limits(axis) * 100)"
      :aria-valuemax="Math.round((1 - limits(axis)) * 100)"
      :aria-valuenow="Math.round(effectiveRatios[axis] * 100)"
      tabindex="0"
      @pointerdown="startResize(axis, $event)"
      @pointermove="moveResize"
      @pointerup="endResize"
      @pointercancel="endResize"
      @lostpointercapture="drag = null"
      @keydown="resizeWithKeyboard(axis, $event)"
      @dblclick="resize(axis, 0.5)"
    />
  </div>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SplitLayout, SplitPane, SplitRatios } from './use-split-workspace';
const props = withDefaults(defineProps<{
  layout: SplitLayout;
  panes: SplitPane[];
  focusedPaneId: number;
  ratios?: SplitRatios;
}>(), { ratios: () => ({ columns: 0.5, rows: 0.5 }) });
const emit = defineEmits<{ focus: [paneId: number]; resize: [ratios: SplitRatios] }>();
const { t } = useI18n();
type Axis = keyof SplitRatios;
const root = ref<HTMLElement | null>(null);
const size = ref({ width: 0, height: 0 });
const drag = ref<{ axis: Axis; pointerId: number; target: HTMLElement; position: number; ratio: number; length: number } | null>(null);
const axes = computed<Axis[]>(() => props.layout === 'single' ? []
  : props.layout === '4-quadrant' ? ['columns', 'rows']
    : props.layout === '2-vertical' ? ['columns'] : ['rows']);
function measure(): void {
  const bounds = root.value?.getBoundingClientRect();
  if (bounds) size.value = { width: bounds.width, height: bounds.height };
}
function limits(axis: Axis): number {
  const length = axis === 'columns' ? size.value.width : size.value.height;
  const minimum = 280;
  return length > 0 ? Math.min(0.5, Math.max(0.15, minimum / length)) : 0.15;
}
function clamp(axis: Axis, value: number): number {
  return Math.min(1 - limits(axis), Math.max(limits(axis), value));
}
const effectiveRatios = computed<SplitRatios>(() => ({
  columns: clamp('columns', props.ratios.columns), rows: clamp('rows', props.ratios.rows),
}));
const tracks = (ratio: number) => `minmax(0, ${ratio}fr) minmax(0, ${1 - ratio}fr)`;
const gridStyle = computed(() => ({
  gridTemplateColumns: axes.value.includes('columns') ? tracks(effectiveRatios.value.columns) : 'minmax(0, 1fr)',
  gridTemplateRows: axes.value.includes('rows') ? tracks(effectiveRatios.value.rows) : 'minmax(0, 1fr)',
}));
function resize(axis: Axis, value: number): void {
  emit('resize', { ...props.ratios, [axis]: clamp(axis, value) });
}
function startResize(axis: Axis, event: PointerEvent): void {
  if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
  event.preventDefault();
  measure();
  const length = axis === 'columns' ? size.value.width : size.value.height;
  if (!length) return;
  drag.value = { axis, pointerId: event.pointerId, target: event.currentTarget,
    position: axis === 'columns' ? event.clientX : event.clientY, ratio: effectiveRatios.value[axis], length };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}
function moveResize(event: PointerEvent): void {
  const current = drag.value;
  if (!current || event.pointerId !== current.pointerId) return;
  const position = current.axis === 'columns' ? event.clientX : event.clientY;
  resize(current.axis, current.ratio + (position - current.position) / current.length);
}
function stopResize(): void {
  const current = drag.value;
  drag.value = null;
  if (current?.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
}
function endResize(event: PointerEvent): void {
  if (event.pointerId === drag.value?.pointerId) stopResize();
}
function resizeWithKeyboard(axis: Axis, event: KeyboardEvent): void {
  const decrease = axis === 'columns' ? 'ArrowLeft' : 'ArrowUp';
  const increase = axis === 'columns' ? 'ArrowRight' : 'ArrowDown';
  if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  measure();
  resize(axis, event.key === 'Home' ? 0 : event.key === 'End' ? 1
    : effectiveRatios.value[axis] + (event.key === decrease ? -0.02 : 0.02));
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  measure();
  if (typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(measure);
  if (root.value) observer.observe(root.value);
});
watch(() => [props.layout, props.panes], stopResize);
onBeforeUnmount(() => { stopResize(); observer?.disconnect(); });
function focusPane(id: number, event: Event): void {
  // The fixed top-right toggle belongs to the focused agent, not its host pane.
  if (event.target instanceof Element && event.target.closest('[data-global-workspace-toggle]')) return;
  emit('focus', id);
}
</script>
<style scoped>
.agent-split-grid {
  position: relative;
  display: grid;
  flex: 1;
  min-width: 0;
  min-height: 0;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
}
.agent-split-grid--resizing {
  user-select: none;
}
.agent-split-grid__divider {
  position: absolute;
  z-index: 20;
  outline: none;
  touch-action: none;
  -webkit-app-region: no-drag;
}
.agent-split-grid__divider--columns {
  top: 0;
  bottom: 0;
  width: 8px;
  transform: translateX(-50%);
  cursor: col-resize;
}
.agent-split-grid__divider--rows {
  right: 0;
  left: 0;
  height: 8px;
  transform: translateY(-50%);
  cursor: row-resize;
}
.agent-split-grid__divider::after {
  position: absolute;
  inset: 0;
  content: '';
}
.agent-split-grid__divider--columns::after {
  right: 3px;
  left: 3px;
}
.agent-split-grid__divider--rows::after {
  top: 3px;
  bottom: 3px;
}
.agent-split-grid__divider:hover::after,
.agent-split-grid__divider:focus-visible::after,
.agent-split-grid--resizing .agent-split-grid__divider::after {
  background: var(--color-resize-handle-hover);
}
.agent-split-grid__pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.agent-split-grid[data-layout='2-vertical'] .agent-split-grid__pane + .agent-split-grid__pane,
.agent-split-grid[data-layout='4-quadrant'] .agent-split-grid__pane:nth-child(even) {
  border-left: 1px solid var(--color-border);
}
.agent-split-grid[data-layout='2-horizontal'] .agent-split-grid__pane + .agent-split-grid__pane,
.agent-split-grid[data-layout='4-quadrant'] .agent-split-grid__pane:nth-child(n + 3) {
  border-top: 1px solid var(--color-border);
}
.agent-split-grid__pane > :deep(.conversation-pane) {
  position: relative;
  isolation: isolate;
  min-width: 0;
}
.agent-split-grid:not([data-layout='single']) .agent-split-grid__pane:not(.agent-split-grid__pane--focused) > :deep(.conversation-pane)::after {
  position: absolute;
  z-index: 10;
  inset: 0;
  background: var(--color-surface-lowest);
  opacity: 0.35;
  pointer-events: none;
  content: '';
}
.agent-split-grid__empty {
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
</style>
