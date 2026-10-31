<template>
  <div ref="stage" class="design-canvas design-panel__stage" :class="{ 'design-canvas--pan': pan && !play, 'design-canvas--panning': !!gesture || !!boardDrag?.moved }" :aria-label="t('design.alternatives')" @pointerdown="startPan" @pointermove="movePointer" @pointerup="endPointer" @pointercancel="cancelPointer" @lostpointercapture="lostCapture" @wheel="wheel">
    <div v-if="!play" class="design-canvas__document"><h2>{{ content.title }}</h2><slot name="history" /></div>
    <div class="design-canvas__boards" :style="canvasStyle">
      <article v-for="board in boards" v-show="!play || board.id === activeArtboardId" :key="board.id" class="design-canvas__artboard" :data-artboard-id="board.id" :data-active="board.id === activeArtboardId" :style="boardStyle(board)">
        <header v-if="!play" class="design-canvas__caption" :style="{ height: `${captionHeight}px` }">
          <button type="button" :aria-label="t('design.editArtboard', { name: board.title })" :title="t('design.moveArtboardHint')" :disabled="locked" @pointerdown.stop="startBoardDrag($event, board.id)" @keydown="nudgeBoard($event, board.id)" @click="clickBoard($event, board.id)">{{ board.title }}</button>
          <CheckIcon v-if="board.id === content.chosenArtboardId" class="design-canvas__chosen" :aria-label="t('design.chosen')" />
          <button class="app-icon-button" type="button" :aria-label="t('design.focusArtboard', { name: board.title })" :title="t('design.focusArtboard', { name: board.title })" :disabled="locked" @click="emit('focus', board.id)"><ArrowsDiagonalIcon /></button>
        </header>
        <div class="design-canvas__surface" :style="{ height: `${board.height * zoom}px` }">
          <DesignArtboardFrame :board="board" :css="displayed.css" :document-id="documentId" :revision="revision" :play="play" :selected-node-id="board.id === selectedArtboardId ? selectedNodeId : null" :zoom="zoom" :locked="locked || pan" :frozen="interacting" @select="emit('select', board.id, $event)" @edit="emit('edit', $event)" @interaction="emit('interaction', board.id, $event)" @prototype="navigate(board.id, $event)" />
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { designArtboardPositions, type DesignArtboard, type DesignContent, type DesignInteraction } from '@workspace/core/design';
import { translate as t } from '../i18n';
import { CheckIcon, ArrowsDiagonalIcon } from '../shared/icons/app-icons';
import DesignArtboardFrame from './DesignArtboardFrame.vue';
import type { DesignCanvasChange } from './design-frame';

const props = defineProps<{ content: DesignContent; documentId: string; revision: number; selectedArtboardId: string | null; selectedNodeId: string | null; play: boolean; locked: boolean; interacting: boolean; pan: boolean; zoomChoice: number | 'fit' | 'selection'; pendingChange?: DesignCanvasChange | null }>();
const emit = defineEmits<{ focus: [artboardId: string]; select: [artboardId: string, nodeId: string]; edit: [change: DesignCanvasChange]; interaction: [artboardId: string, active: boolean]; zoom: [value: number] }>();
const stage = ref<HTMLElement>();
const stageWidth = ref(420);
const stageHeight = ref(600);
const displayed = shallowRef(props.content);
watch([() => props.content, () => props.interacting], () => { if (!props.interacting) displayed.value = props.content; });
const boards = computed(() => displayed.value.artboards);
type BoardDrag = { id: string; pointerId: number; startX: number; startY: number; start: { x: number; y: number }; position: { x: number; y: number }; origin: { x: number; y: number }; rows: Map<string, number>; scale: number; revision: number; moved: boolean; ending: boolean };
const boardDrag = ref<BoardDrag | null>(null);
const positions = computed(() => {
  const result = designArtboardPositions(boards.value);
  const pending = props.pendingChange?.edit;
  if (pending?.type === 'artboard-update' && pending.changes.position) result.set(pending.artboardId, pending.changes.position);
  if (boardDrag.value?.moved) result.set(boardDrag.value.id, boardDrag.value.position);
  return result;
});
const captionHeight = 36;
// Captions are editor chrome, not scaled screen content. Reserve a caption
// gutter for each preceding screen in a column without changing saved positions.
const captionRows = computed(() => {
  if (boardDrag.value) return boardDrag.value.rows;
  const rows = new Map<string, number>();
  const ordered = [...boards.value].sort((a, b) => positions.value.get(a.id)!.y - positions.value.get(b.id)!.y);
  for (const board of ordered) {
    const position = positions.value.get(board.id)!;
    let row = 0;
    for (const above of ordered) {
      const previous = positions.value.get(above.id)!;
      if (previous.y + above.height <= position.y && previous.x < position.x + board.width && previous.x + above.width > position.x) {
        row = Math.max(row, (rows.get(above.id) ?? 0) + 1);
      }
    }
    rows.set(board.id, row);
  }
  return rows;
});
const captionGutters = computed(() => props.play ? 0 : Math.max(0, ...captionRows.value.values()) * captionHeight);
const bounds = computed(() => ({
  x: Math.min(0, ...[...positions.value.values()].map(position => position.x)),
  y: Math.min(0, ...[...positions.value.values()].map(position => position.y)),
  right: Math.max(0, ...boards.value.map(board => positions.value.get(board.id)!.x + board.width)),
  bottom: Math.max(0, ...boards.value.map(board => positions.value.get(board.id)!.y + board.height)),
}));
const retainedOrigin = ref({ x: 0, y: 0 });
const origin = computed(() => boardDrag.value?.origin ?? retainedOrigin.value);
const playingId = ref<string | null>(null);
const history: string[] = [];
const activeArtboardId = computed(() => props.play ? playingId.value ?? props.selectedArtboardId : props.selectedArtboardId);
watch([() => props.play, () => props.selectedArtboardId, () => props.documentId], () => { playingId.value = props.selectedArtboardId; history.length = 0; });
watch(boards, () => { if (!boards.value.some(board => board.id === playingId.value)) { playingId.value = props.selectedArtboardId; history.length = 0; } });
async function navigate(sourceId: string, action: DesignInteraction) {
  if (!props.play || sourceId !== activeArtboardId.value) return;
  const id = action.type === 'navigate' ? action.artboardId : action.type === 'back' ? history.pop() : null;
  if (!id || id === sourceId || !boards.value.some(board => board.id === id)) return;
  if (action.type === 'navigate') history.push(sourceId);
  playingId.value = id;
  await nextTick();
  if (stage.value) { stage.value.scrollLeft = 0; stage.value.scrollTop = 0; }
}
const zoom = computed(() => {
  if (typeof props.zoomChoice === 'number') return props.zoomChoice;
  const selected = props.play || props.zoomChoice === 'selection' ? boards.value.find(board => board.id === activeArtboardId.value) : undefined;
  const width = selected?.width ?? bounds.value.right - bounds.value.x;
  const height = selected?.height ?? bounds.value.bottom - bounds.value.y;
  return Math.max(0.001, Math.min(1, (stageWidth.value - 64) / Math.max(1, width), (stageHeight.value - (props.play ? 108 : 164) - (selected ? 0 : captionGutters.value)) / Math.max(1, height)));
});
watch([bounds, () => !!boardDrag.value, () => props.zoomChoice, () => props.documentId], async () => {
  if (boardDrag.value) return;
  const previous = retainedOrigin.value;
  const next = props.zoomChoice === 'fit' ? { x: bounds.value.x, y: bounds.value.y } : { x: Math.min(previous.x, bounds.value.x), y: Math.min(previous.y, bounds.value.y) };
  retainedOrigin.value = next;
  await nextTick();
  if (stage.value && props.zoomChoice !== 'fit') { stage.value.scrollLeft += (previous.x - next.x) * zoom.value; stage.value.scrollTop += (previous.y - next.y) * zoom.value; }
}, { immediate: true });
const canvasStyle = computed(() => {
  const playing = props.play ? boards.value.find(board => board.id === activeArtboardId.value) : undefined;
  return { width: `${(playing?.width ?? bounds.value.right - origin.value.x) * zoom.value}px`, height: `${(playing?.height ?? bounds.value.bottom - origin.value.y) * zoom.value + (props.play ? 0 : 200) + captionGutters.value}px` };
});
function boardTop(id: string) {
  return props.play ? 0 : (positions.value.get(id)!.y - origin.value.y) * zoom.value + (captionRows.value.get(id) ?? 0) * captionHeight;
}
function boardStyle(board: DesignArtboard) {
  const position = positions.value.get(board.id)!;
  return { width: `${board.width * zoom.value}px`, left: `${props.play ? 0 : (position.x - origin.value.x) * zoom.value}px`, top: `${boardTop(board.id)}px`, zIndex: boardDrag.value?.id === board.id ? 2 : board.id === activeArtboardId.value ? 1 : 0 };
}
let suppressClickUntil = 0;
function startBoardDrag(event: PointerEvent, id: string) {
  if (props.locked || props.pan || props.play || event.button !== 0 || !stage.value) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).focus();
  const position = positions.value.get(id)!;
  boardDrag.value = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start: { ...position }, position: { ...position }, origin: { x: bounds.value.x, y: bounds.value.y }, rows: new Map(captionRows.value), scale: zoom.value, revision: props.revision, moved: false, ending: false };
  stage.value.setPointerCapture(event.pointerId);
}
function movePointer(event: PointerEvent) {
  const drag = boardDrag.value;
  if (!drag) { movePan(event); return; }
  if (event.pointerId !== drag.pointerId || drag.ending) return;
  const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) { drag.moved = true; emit('zoom', drag.scale); emit('interaction', drag.id, true); }
  drag.position = { x: Math.max(-100000, Math.min(100000, Math.round(drag.start.x + dx / drag.scale))), y: Math.max(-100000, Math.min(100000, Math.round(drag.start.y + dy / drag.scale))) };
}
function positionEdit(id: string, position: { x: number; y: number }, expectedRevision: number) {
  emit('edit', { artboardId: id, nodeId: null, expectedRevision, edit: { type: 'artboard-update', artboardId: id, changes: { position } } });
}
function endPointer() {
  const drag = boardDrag.value;
  if (!drag) { endPan(); return; }
  drag.ending = true;
  suppressClickUntil = performance.now() + 300;
  if (stage.value?.hasPointerCapture(drag.pointerId)) stage.value.releasePointerCapture(drag.pointerId);
  if (drag.moved) positionEdit(drag.id, drag.position, drag.revision);
  else { boardDrag.value = null; emit('focus', drag.id); }
}
function cancelPointer() {
  const drag = boardDrag.value;
  boardDrag.value = null;
  if (drag) {
    suppressClickUntil = performance.now() + 300;
    if (stage.value?.hasPointerCapture(drag.pointerId)) stage.value.releasePointerCapture(drag.pointerId);
    if (drag.moved) emit('interaction', drag.id, false);
  }
  endPan();
}
function lostCapture() { if (boardDrag.value && !boardDrag.value.ending) cancelPointer(); }
function cancelKey(event: KeyboardEvent) { if (event.key === 'Escape' && boardDrag.value && !boardDrag.value.ending) { event.preventDefault(); cancelPointer(); } }
function clickBoard(event: MouseEvent, id: string) { if (!event.detail || performance.now() > suppressClickUntil) emit('focus', id); }
function nudgeBoard(event: KeyboardEvent, id: string) {
  if (props.locked || props.pan || props.play || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const position = positions.value.get(id)!;
  const step = event.shiftKey ? 10 : 1;
  const x = position.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0);
  const y = position.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
  emit('zoom', zoom.value);
  positionEdit(id, { x: Math.max(-100000, Math.min(100000, x)), y: Math.max(-100000, Math.min(100000, y)) }, props.revision);
}
watch(() => props.interacting, active => { if (!active && boardDrag.value?.ending) boardDrag.value = null; });
let observer: ResizeObserver | undefined;
const gesture = ref<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
function startPan(event: PointerEvent) {
  if (props.play || props.locked || !stage.value || !(props.pan && event.button === 0 || event.button === 1)) return;
  if (event.target instanceof Element && event.target.closest('button')) return;
  event.preventDefault();
  gesture.value = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: stage.value.scrollLeft, top: stage.value.scrollTop };
  stage.value.setPointerCapture(event.pointerId);
}
function movePan(event: PointerEvent) {
  if (!gesture.value || !stage.value) return;
  stage.value.scrollLeft = gesture.value.left - event.clientX + gesture.value.x;
  stage.value.scrollTop = gesture.value.top - event.clientY + gesture.value.y;
}
function endPan() {
  if (gesture.value && stage.value?.hasPointerCapture(gesture.value.pointerId)) stage.value.releasePointerCapture(gesture.value.pointerId);
  gesture.value = null;
}
function wheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  if (props.interacting) return;
  emit('zoom', Math.max(0.001, Math.min(2, Math.round(zoom.value * Math.exp(-event.deltaY * 0.005) * 10000) / 10000)));
}
async function focus(artboardId: string) {
  await nextTick();
  const position = positions.value.get(artboardId);
  if (stage.value && position) {
    stage.value.scrollLeft = props.play ? 0 : (position.x - origin.value.x) * zoom.value;
    stage.value.scrollTop = boardTop(artboardId);
  }
}
watch(zoom, async (value, previous) => {
  const element = stage.value;
  if (!element) return;
  const x = (element.scrollLeft + element.clientWidth / 2) / previous;
  const y = (element.scrollTop + element.clientHeight / 2) / previous;
  await nextTick();
  if (props.zoomChoice === 'fit') { element.scrollLeft = 0; element.scrollTop = 0; }
  else if (props.zoomChoice === 'selection') await focus(props.selectedArtboardId ?? '');
  else { element.scrollLeft = x * value - element.clientWidth / 2; element.scrollTop = y * value - element.clientHeight / 2; }
});
watch(() => props.selectedArtboardId, () => { if (props.zoomChoice === 'selection') void focus(props.selectedArtboardId ?? ''); });
onMounted(() => {
  window.addEventListener('keydown', cancelKey);
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(entries => { stageWidth.value = entries[0]?.contentRect.width ?? 420; stageHeight.value = entries[0]?.contentRect.height ?? 600; });
    if (stage.value) observer.observe(stage.value);
  }
  if (props.zoomChoice === 'selection') void focus(props.selectedArtboardId ?? '');
});
onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('keydown', cancelKey); });
defineExpose({ focus, zoom, activeArtboardId });
</script>

<style scoped>
.design-canvas {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 76px 32px 32px;
  background: var(--color-surface-base);
}

.design-canvas__document {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.design-canvas__document h2 {
  margin: 0;
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-24);
}

.design-canvas__boards {
  position: relative;
  isolation: isolate;
}

.design-canvas__artboard {
  position: absolute;
}

.design-canvas__caption {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-muted);
}

.design-canvas__caption > button:first-child {
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 0;
  text-align: left;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--font-size-13);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}

.design-canvas__chosen {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--color-primary);
  flex: none;
}

.design-canvas__surface {
  position: relative;
  box-shadow: var(--shadow-sm);
}

.design-canvas--pan {
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.design-canvas--panning {
  cursor: grabbing;
}

.design-canvas--pan :deep(iframe) {
  pointer-events: none;
}
</style>
