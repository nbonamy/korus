<template>
  <div ref="root" class="chat-annotated-text" :data-chat-annotation-message="messageKey">
    <div ref="content" data-chat-annotation-content><slot /></div>
    <button
      v-for="marker in markers"
      :key="marker.annotation.id"
      :data-annotation-id="marker.annotation.id"
      class="conversation-pane__annotation-marker"
      type="button"
      :style="{ left: `${marker.x}px`, top: `${marker.y}px` }"
      :aria-label="t('chat.textAnnotations.edit', { number: marker.annotation.number })"
      :title="marker.annotation.comment"
      @pointerdown.prevent
      @click="emit('edit', marker.annotation.id)"
    >{{ marker.annotation.number }}</button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChatTextAnnotation } from './use-chat-text-annotations';
import { textRange, updateChatTextHighlights } from './chat-text-anchor';

const props = defineProps<{ messageKey: string; focusRequest?: { id: string } | null; annotations: readonly (ChatTextAnnotation & { number: number })[] }>();
const emit = defineEmits<{ edit: [id: string] }>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const markers = ref<{ annotation: ChatTextAnnotation & { number: number }; x: number; y: number }[]>([]);
const focusedAnnotationId = ref<string | null>(null);
let focusTimer: ReturnType<typeof setTimeout> | undefined;
const highlightOwner = Symbol('chat-annotation-highlight');
let resize: ResizeObserver | undefined;
let mutation: MutationObserver | undefined;
function measure(): void {
  if (!content.value || !root.value) return;
  if (!props.annotations.length) { markers.value = []; updateChatTextHighlights(highlightOwner, []); return; }
  const blocks = [...(root.value.closest('.conversation-pane')?.querySelectorAll<HTMLElement>('[data-chat-annotation-message]') ?? [])]
    .filter(candidate => candidate.dataset.chatAnnotationMessage === props.messageKey);
  const index = blocks.indexOf(root.value);
  const bounds = root.value.getBoundingClientRect();
  const ranges: Range[] = [];
  const focusedRanges: Range[] = [];
  markers.value = props.annotations.flatMap(annotation => {
    if ((annotation.textBlockIndex ?? 0) !== index) return [];
    const range = textRange(content.value!, annotation.text, annotation.textStart);
    if (range) (annotation.id === focusedAnnotationId.value ? focusedRanges : ranges).push(range);
    const rects = range?.getClientRects?.();
    const rect = rects?.[rects.length - 1];
    return rect ? [{ annotation, x: rect.right - bounds.left, y: rect.top - bounds.top }] : [];
  });
  updateChatTextHighlights(highlightOwner, ranges, focusedRanges);
}
function clearFocus(): void {
  if (focusTimer !== undefined) clearTimeout(focusTimer);
  focusTimer = undefined;
  focusedAnnotationId.value = null;
  measure();
}
function reveal(id: string): void {
  clearFocus();
  const marker = [...(root.value?.querySelectorAll<HTMLElement>('[data-annotation-id]') ?? [])]
    .find(element => element.dataset.annotationId === id);
  if (!marker) return;
  marker.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  focusedAnnotationId.value = id;
  measure();
  focusTimer = setTimeout(clearFocus, 2000);
}
watch(() => props.focusRequest, request => {
  void nextTick(() => { if (request) reveal(request.id); else clearFocus(); });
});
function observe(): void {
  resize?.disconnect();
  mutation?.disconnect();
  if (props.annotations.length && content.value) {
    if (typeof ResizeObserver !== 'undefined') {
      resize = new ResizeObserver(measure);
      resize.observe(content.value);
    }
    mutation = new MutationObserver(measure);
    mutation.observe(content.value, { subtree: true, childList: true, characterData: true });
  }
  measure();
}
watch(() => props.annotations, () => { void nextTick(observe); });
onMounted(observe);
onBeforeUnmount(() => { if (focusTimer !== undefined) clearTimeout(focusTimer); resize?.disconnect(); mutation?.disconnect(); updateChatTextHighlights(highlightOwner, []); });
</script>

<style scoped>
:global(::highlight(chat-annotations)) {
  background-color: var(--color-annotation-background);
}

:global(::highlight(chat-annotation-focus)) {
  background-color: var(--color-annotation-focus);
  color: var(--color-on-annotation-focus);
}

.chat-annotated-text {
  position: relative;
}

.conversation-pane__annotation-marker {
  position: absolute;
  z-index: 1;
  display: grid;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-full);
  place-items: center;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: 600 var(--font-size-10) / 1 var(--font-family-ui);
  transform: translate(2px, -45%);
  cursor: pointer;
}
</style>
