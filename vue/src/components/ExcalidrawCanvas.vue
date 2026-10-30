<template>
  <div class="visualize-editor" :class="{ 'visualize-editor--annotating': annotating }">
    <div class="visualize-editor__navigation">
      <div class="visualize-editor__compact-zoom">
        <button type="button" class="visualize-editor__zoom-action" :disabled="zoomPercent <= 10" :aria-label="translate('visualize.zoomOut')" :title="translate('visualize.zoomOut')" @click="changeZoom(-0.1)">
          <MinusIcon :stroke-width="1" aria-hidden="true" />
        </button>
        <span class="visualize-editor__zoom-level" aria-live="polite">{{ zoomPercent }}%</span>
        <button type="button" class="visualize-editor__zoom-action" :disabled="zoomPercent >= 3000" :aria-label="translate('visualize.zoomIn')" :title="translate('visualize.zoomIn')" @click="changeZoom(0.1)">
          <PlusIcon :stroke-width="1" aria-hidden="true" />
        </button>
      </div>
      <button type="button" class="app-button app-button--tertiary visualize-editor__action visualize-editor__fit" :disabled="!ready" :aria-label="translate('visualize.fitCanvas')" :title="translate('visualize.fitCanvas')" @click="editor?.fit()">
        <ArrowsMinimizeIcon :stroke-width="1" aria-hidden="true" />
      </button>
    </div>
    <div class="visualize-editor__toolbar">
      <button type="button" class="app-button app-button--tertiary visualize-editor__action" :disabled="!ready" :aria-pressed="annotating" :aria-label="translate(annotating ? 'visualize.stopAnnotating' : 'visualize.annotateCanvas')" :title="translate(annotating ? 'visualize.stopAnnotating' : 'visualize.annotateCanvas')" @click="toggleAnnotation">
        <X v-if="annotating" :stroke-width="1" aria-hidden="true" />
        <PlusCircleIcon v-else :stroke-width="1" aria-hidden="true" />
      </button>
      <button type="button" class="app-button app-button--tertiary visualize-editor__action" :disabled="!ready || savingPng" :aria-label="translate('visualize.savePng')" :title="translate('visualize.savePng')" @click="savePng">
        <DownloadIcon :stroke-width="1" aria-hidden="true" />
      </button>
    </div>
    <div ref="host" class="visualize-editor__host" />
    <div v-if="annotating" class="visualize-editor__annotation-layer" :aria-label="translate('visualize.selectShapes')">
      <button
        v-for="target in annotationTargets"
        :key="target.id"
        type="button"
        class="visualize-editor__annotation-target"
        :class="{ 'visualize-editor__annotation-target--selected': local?.selectedElementIds.includes(target.id) }"
        :style="{ left: `${target.x}px`, top: `${target.y}px`, width: `${target.width}px`, height: `${target.height}px` }"
        :aria-label="translate('visualize.selectShape', { id: target.id })"
        :aria-pressed="local?.selectedElementIds.includes(target.id)"
        @click.stop="toggleAnnotationTarget(target)"
      />
    </div>
    <AnnotationPopup
      v-if="activeCommentTarget"
      :key="activeCommentTarget.id"
      :anchor="activeCommentTarget.anchor"
      :description="activeCommentTarget.description"
      :label="translate('visualize.annotationComment')"
      :placement="activeCommentTarget.placement"
      :placeholder="translate('visualize.annotationPlaceholder')"
      :submit-label="translate('visualize.addAnnotation')"
      strategy="fixed"
      @cancel="cancelAnnotationComment"
      @submit="attachSelection"
    />
    <div v-if="error || !ready" class="visualize-editor__status">
      <span role="status">{{ error || translate('common.loading') }}</span>
      <button v-if="error" type="button" class="app-button app-button--secondary" @click="retry">{{ translate(ready ? 'visualize.retrySave' : 'visualize.retryLoad') }}</button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, toRaw } from 'vue';
import { selectedCanvasElements, type CanvasDocument, type SaveCanvasInput } from '@workspace/core/visualize-canvas';
import type { Visualization } from '@workspace/core/visualize';
import type { CanvasAnnotationTarget, CanvasScene, mountCanvas } from './excalidraw-editor';
import { translate } from '../i18n';
import { ArrowsMinimizeIcon, DownloadIcon, MinusIcon, PlusCircleIcon, PlusIcon, X } from '../shared/icons/app-icons';
import AnnotationPopup, { type AnnotationPopupAnchor } from './AnnotationPopup.vue';
import type { VisualizationAnnotationInput } from './use-visualization-annotations';
const props = defineProps<{
  visualization: Visualization;
  sessionId: string;
  imageSource?: string;
  save: (input: SaveCanvasInput) => Promise<CanvasDocument>;
}>();
const emit = defineEmits<{
  annotate: [annotation: VisualizationAnnotationInput];
}>();
const host = ref<HTMLElement>();
const ready = ref(false);
const saving = ref(false);
const dirty = ref(false);
const annotating = ref(false);
const savingPng = ref(false);
const zoomPercent = ref(100);
const annotationTargets = ref<CanvasAnnotationTarget[]>([]);
const activeCommentTarget = ref<{
  id: string;
  anchor: AnnotationPopupAnchor;
  description: string;
  placement: 'above' | 'below';
} | null>(null);
const error = ref('');
let editor: ReturnType<typeof mountCanvas> | undefined;
let revision = props.visualization.canvas?.revision ?? 0;
let baseKey = '';
let needsPreview = false;
const local = shallowRef<CanvasScene>();
let incoming: CanvasDocument | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Promise<void> | undefined;
let disposed = false;
let initializing = false;
const key = (scene: CanvasScene) => JSON.stringify([scene.elements, scene.files, scene.selectedElementIds]);
function changed(scene: CanvasScene) {
  local.value = scene;
  dirty.value = key(scene) !== baseKey;
  if (key(scene) === baseKey || error.value) return;
  clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, 180);
}
function receive(document: CanvasDocument | undefined) {
  if (!document || document.revision <= revision) return;
  if (saving.value) { incoming = document; return; }
  if (local.value && key(local.value) !== baseKey) {
    incoming = document;
    error.value = translate('visualize.canvasConflict');
    return;
  }
  revision = document.revision;
  needsPreview = !document.preview;
  baseKey = key(document);
  local.value = structuredClone(toRaw(document));
  editor?.update(local.value, true);
  if (needsPreview) { clearTimeout(timer); timer = setTimeout(() => { void flush(); }, 180); }
}
watch(() => props.visualization.canvas, receive);
async function flush(): Promise<void> {
  clearTimeout(timer);
  if (pending) { await pending; if (local.value && key(local.value) !== baseKey && !error.value) await flush(); return; }
  if (!local.value || error.value || (key(local.value) === baseKey && !needsPreview)) return;
  const scene = structuredClone(toRaw(local.value));
  const sentKey = key(scene);
  saving.value = true;
  pending = (async () => {
    try {
      scene.preview = await editor!.preview(scene);
      const saved = await props.save({ sessionId: props.sessionId, expectedSource: JSON.stringify(props.visualization.content), visualizationId: props.visualization.id, expectedRevision: revision, document: scene });
      revision = saved.revision;
      needsPreview = false;
      baseKey = sentKey;
      dirty.value = !!local.value && key(local.value) !== baseKey;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving.value = false;
      pending = undefined;
      if (incoming) { const document = incoming; incoming = undefined; receive(document); }
    }
  })();
  await pending;
  if (local.value && key(local.value) !== baseKey && !error.value) await flush();
}
function toggleAnnotation() {
  if (annotating.value) {
    annotating.value = false;
    activeCommentTarget.value = null;
    setAnnotationSelection([]);
    return;
  }
  annotating.value = true;
  activeCommentTarget.value = null;
  setAnnotationSelection([]);
  refreshAnnotationTargets();
}
function refreshAnnotationTargets(): void {
  annotationTargets.value = editor?.getAnnotationTargets() ?? [];
}
function refreshCanvasUi(): void {
  refreshAnnotationTargets();
  const controls = editor?.getControlsState();
  if (!controls) return;
  zoomPercent.value = Math.round(controls.zoom * 100);
}
function changeZoom(delta: number): void {
  const zoom = editor?.zoomBy(delta);
  if (zoom !== undefined) zoomPercent.value = Math.round(zoom * 100);
}
function setAnnotationSelection(elementIds: string[]): void {
  if (!local.value) return;
  local.value = { ...local.value, selectedElementIds: elementIds, preview: '' };
  editor?.setSelection(elementIds);
  changed(local.value);
}
function toggleAnnotationTarget(target: CanvasAnnotationTarget): void {
  if (!local.value) return;
  if (local.value.selectedElementIds.includes(target.id)) {
    activeCommentTarget.value = null;
    setAnnotationSelection([]);
  } else {
    const bounds = host.value?.getBoundingClientRect();
    const anchor = {
      x: (bounds?.left ?? 0) + target.x,
      y: (bounds?.top ?? 0) + target.y,
      width: target.width,
      height: target.height,
    };
    activeCommentTarget.value = {
      id: target.id,
      anchor,
      description: translate('visualize.selectedShapeCount', { count: 1 }),
      placement: target.y > (host.value?.clientHeight ?? 0) * 0.6 ? 'above' : 'below',
    };
    setAnnotationSelection([target.id]);
  }
}
function cancelAnnotationComment(): void {
  activeCommentTarget.value = null;
}
async function attachSelection(comment: string): Promise<void> {
  if (!local.value?.selectedElementIds.length || !comment.trim()) return;
  await flush();
  if (!local.value?.selectedElementIds.length || error.value) return;
  const selected = selectedCanvasElements(local.value);
  const selectedIds = new Set(local.value.selectedElementIds);
  const labels = new Map(selected
    .filter(element => element.type === 'text' && typeof element.containerId === 'string')
    .map(element => [String(element.containerId), String(element.text ?? '')]));
  const elements = selected
    .filter(element => element.type !== 'text' || !element.containerId || selectedIds.has(element.id))
    .map(element => ({
      id: element.id,
      type: element.type,
      ...((element.type === 'text' ? String(element.text ?? '') : labels.get(element.id))?.trim()
        ? { text: (element.type === 'text' ? String(element.text ?? '') : labels.get(element.id))!.trim() }
        : {}),
    }));
  if (!elements.length) return;
  activeCommentTarget.value = null;
  setAnnotationSelection([]);
  await flush();
  if (error.value) return;
  emit('annotate', {
    visualizationId: props.visualization.id,
    title: props.visualization.title,
    revision,
    comment: comment.trim(),
    elements,
  });
}
async function savePng(): Promise<void> {
  if (!local.value || savingPng.value) return;
  savingPng.value = true;
  try {
    const link = document.createElement('a');
    link.href = await editor!.preview(structuredClone(toRaw(local.value)));
    link.download = `${props.visualization.title.trim().replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'visualization'}.png`;
    link.click();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    savingPng.value = false;
  }
}
function retry() {
  // Keep local work on failure. A stale revision requires an explicit reload rather than a blind overwrite.
  error.value = '';
  if (ready.value) void flush();
  else void initialize();
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = ''; }
}
async function initialize() {
  if (disposed || initializing) return;
  initializing = true;
  try {
    const module = await import('./excalidraw-editor');
    const scene = await module.importVisualization(toRaw(props.visualization), props.imageSource ?? '');
    if (disposed || !host.value) return;
    local.value = scene;
    baseKey = props.visualization.canvas ? key(scene) : '';
    editor = module.mountCanvas(host.value, scene, changed, cause => { error.value = cause.message; }, refreshCanvasUi);
    ready.value = true;
    refreshCanvasUi();
    if (!props.visualization.canvas) changed(scene);
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { initializing = false; }
}
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload);
  void initialize();
});
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener('beforeunload', beforeUnload);
  clearTimeout(timer);
  void flush();
  editor?.dispose();
});
</script>
<style scoped>
.visualize-editor {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.visualize-editor__navigation {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.visualize-editor__compact-zoom {
  display: flex;
  height: var(--visualize-control-size, 36px);
  align-items: center;
  overflow: hidden;
  border-radius: var(--visualize-control-radius, var(--radius-md));
  background: var(--visualize-control-background, var(--color-surface-low));
  color: var(--visualize-control-foreground, var(--color-text));
}
.visualize-editor__zoom-action {
  display: grid;
  width: 36px;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  place-items: center;
}
.visualize-editor__zoom-action:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.visualize-editor__zoom-action:disabled {
  opacity: .45;
  cursor: default;
}
.visualize-editor__zoom-action svg {
  width: 18px;
  height: 18px;
}
.visualize-editor__zoom-level {
  min-width: 52px;
  text-align: center;
  font-size: var(--font-size-14);
  font-variant-numeric: tabular-nums;
}
.visualize-editor__toolbar {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 0;
  max-width: calc(100% - 16px);
  padding: 0;
  border: 0;
  border-radius: var(--visualize-control-radius, var(--radius-md));
  overflow: hidden;
  background: var(--visualize-control-background, var(--color-surface-low));
  color: var(--visualize-control-foreground, var(--color-text));
  font-size: var(--font-size-12);
}
.visualize-editor__fit {
  border: 0;
  border-radius: var(--visualize-control-radius, var(--radius-md));
  background: var(--visualize-control-background, var(--color-surface-low));
  color: var(--visualize-control-foreground, var(--color-text));
}
.visualize-editor__action {
  width: var(--visualize-control-size, 36px);
  height: var(--visualize-control-size, 36px);
  min-width: 0;
  min-height: 0;
  border: 0;
  border-radius: 0;
  color: inherit;
  padding: 0;
}
.visualize-editor__action.visualize-editor__fit {
  border-radius: var(--visualize-control-radius, var(--radius-md));
}
.visualize-editor__action svg {
  width: 18px;
  height: 18px;
}
.visualize-editor__host {
  flex: 1;
  min-height: 240px;
}
.visualize-editor__annotation-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.visualize-editor__annotation-target {
  position: absolute;
  box-sizing: border-box;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  pointer-events: auto;
  cursor: pointer;
}
.visualize-editor__annotation-target:hover,
.visualize-editor__annotation-target:focus-visible,
.visualize-editor__annotation-target--selected {
  border-color: var(--color-error);
  background: color-mix(in srgb, var(--color-error) 8%, transparent);
  outline: none;
}
/* Keep unrelated editor menus out of the embedded canvas. */
.visualize-editor__host :deep(.main-menu-trigger),
.visualize-editor__host :deep(.help-icon),
.visualize-editor__host :deep(.sidebar-trigger__label-element:has(.default-sidebar-trigger)) {
  display: none;
}
.visualize-editor .visualize-editor__host :deep(.layer-ui__wrapper__footer),
.visualize-editor .visualize-editor__host :deep(.App-bottom-bar) {
  display: none;
}
.visualize-editor__status {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 4;
  max-width: calc(100% - 32px);
  padding: var(--space-8);
  border-radius: var(--radius-md);
  background: var(--color-shell-main);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
</style>
