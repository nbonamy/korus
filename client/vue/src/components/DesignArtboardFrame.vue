<template>
  <iframe ref="frame" :title="board.title" sandbox="allow-scripts" :srcdoc="source" @load="highlight" :style="{ width: `${board.width}px`, height: `${board.height}px`, transform: `scale(${zoom})` }" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { designNodes, type DesignArtboard, type DesignEdit, type DesignInteraction } from '@workspace/core/design';
import { translate as t } from '../i18n';
import { designFrame, type DesignCanvasChange } from './design-frame';

const props = defineProps<{ board: DesignArtboard; css: string; documentId: string; revision: number; play: boolean; selectedNodeId: string | null; zoom: number; locked: boolean; frozen: boolean }>();
const emit = defineEmits<{ select: [nodeId: string]; edit: [change: DesignCanvasChange]; interaction: [active: boolean]; prototype: [action: DesignInteraction] }>();
const frame = ref<HTMLIFrameElement>();
const source = ref('');
const token = crypto.randomUUID().replaceAll('-', '');
let frameRevision = 0;
let frameNodeIds = new Set<string>();
// Keep the authored frame stable during a gesture or direct text edit. A newer
// snapshot remains authoritative, and its revision rejects the old gesture.
watch([() => props.revision, () => props.documentId, () => JSON.stringify(props.board), () => props.css, () => props.play, () => props.frozen], () => {
  if (!props.frozen) {
    frameRevision = props.revision;
    frameNodeIds = new Set(designNodes({ title: '', css: '', comments: [], artboards: [props.board] }).map(node => node.id));
    source.value = designFrame(props.board, props.board.css ?? props.css, token, props.revision, props.play, props.selectedNodeId, { width: t('design.resizeWidth'), height: t('design.resizeHeight'), size: t('design.resizeSize') });
  }
}, { immediate: true });
function highlight() { frame.value?.contentWindow?.postMessage({ token, kind: 'highlight', nodeId: props.selectedNodeId, locked: props.locked, zoom: props.zoom }, '*'); }
watch([() => props.selectedNodeId, () => props.locked, () => props.zoom], highlight);
function receive(event: MessageEvent) {
  const data = event.data;
  if (event.source !== frame.value?.contentWindow || !data || data.token !== token || data.revision !== frameRevision) return;
  if (props.play) {
    if (data.kind !== 'prototype') return;
    const action = designNodes({ title: '', css: '', comments: [], artboards: [props.board] }).find(node => node.id === data.nodeId)?.interaction;
    if (action?.type === 'navigate' || action?.type === 'back') emit('prototype', action);
    return;
  }
  if (data.kind === 'interaction-end') { emit('interaction', false); return; }
  if (props.locked && !props.frozen) return;
  if (typeof data.nodeId !== 'string' || !frameNodeIds.has(data.nodeId)) return;
  if (data.kind === 'interaction-start') { emit('interaction', true); return; }
  if (data.kind === 'select') { if (!props.frozen) emit('select', data.nodeId); return; }
  let edit: DesignEdit | null = null;
  if (data.kind === 'text' && typeof data.text === 'string' && data.text.length <= 20_000) edit = { type: 'text', nodeId: data.nodeId, text: data.text };
  if (data.kind === 'edit' && data.edit?.nodeId === data.nodeId) {
    const candidate = data.edit;
    if (candidate.type === 'move' && typeof candidate.parentId === 'string' && Number.isInteger(candidate.index) && candidate.index >= 0 && frameNodeIds.has(candidate.parentId)) edit = { type: 'move', nodeId: data.nodeId, parentId: candidate.parentId, index: candidate.index };
    if (candidate.type === 'style' && candidate.styles && typeof candidate.styles === 'object' && !Array.isArray(candidate.styles)
      && Object.entries(candidate.styles).every(([key, value]) => ['width', 'height', 'left', 'top', 'right', 'bottom', 'box-sizing'].includes(key) && typeof value === 'string' && value.length <= 100)) edit = { type: 'style', nodeId: data.nodeId, styles: candidate.styles };
  }
  if (edit && Number.isInteger(data.revision) && data.revision > 0) emit('edit', { artboardId: props.board.id, nodeId: data.nodeId, edit, expectedRevision: data.revision });
  else emit('interaction', false);
}
onMounted(() => window.addEventListener('message', receive));
onBeforeUnmount(() => window.removeEventListener('message', receive));
</script>

<style scoped>
iframe {
  display: block;
  position: absolute;
  inset: 0;
  border: 0;
  transform-origin: top left;
  background: var(--color-surface);
}
</style>
