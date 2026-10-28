<template>
  <article
    ref="surface"
    class="source-preview-panel"
    :class="{
      'source-preview-panel--annotatable': canAnnotate,
      'source-preview-panel--hide-line-numbers': !showLineNumbers,
      'source-preview-panel--wrap': wordWrap,
    }"
    :aria-busy="state === 'loading'"
  >
    <div
      v-if="state === 'loading'"
      class="source-preview-panel__empty codex-text-shimmer"
    > {{ $t('surface.sourcePreviewPanel.loadingSource') }} </div>
    <div
      v-else-if="state === 'error'"
      class="source-preview-panel__empty source-preview-panel__empty--error"
    >
      {{ error ?? $t('surface.sourcePreviewPanel.unableToLoadSource') }}
    </div>
    <div
      v-else-if="content.trim()"
      class="source-preview-panel__content codex-markdown"
      :data-code-path="canAnnotate ? path : undefined"
      @mousedown="plusPressed"
      @click="plusClicked"
      v-html="renderCodeBlock(content, language ?? undefined)"
    />
    <div
      v-else
      class="source-preview-panel__empty"
    > {{ $t('surface.sourcePreviewPanel.noSourceContent') }} </div>
    <CodeSelectionAnnotation
      v-if="canAnnotate"
      :selection="code.selection.value"
      :commenting="code.commenting.value"
      @dismiss="code.clear"
      @save="saveAnnotation"
    />
  </article>
</template>

<script setup lang="ts">
import { renderCodeBlock } from '@codex-app-sdk/vue';
import { computed, nextTick, onUpdated, ref, watch } from 'vue';
import { translate } from '../i18n';
import CodeSelectionAnnotation from './CodeSelectionAnnotation.vue';
import type { CodeAnnotationInput } from './use-code-annotations';
import { useCodeSelection, type CodeSelection } from './use-code-selection';

const props = withDefaults(defineProps<{
  content: string;
  error?: string | null;
  language?: string | null;
  /** The file shown; annotating needs it to say where a comment belongs. */
  path?: string;
  /** Annotate from a line's plus button, or select code text. */
  annotatable?: boolean;
  showLineNumbers?: boolean;
  state?: 'idle' | 'loading' | 'error';
  wordWrap?: boolean;
}>(), {
  error: null,
  language: null,
  path: undefined,
  annotatable: false,
  showLineNumbers: true,
  state: 'idle',
  wordWrap: false,
});

const emit = defineEmits<{ annotate: [annotation: CodeAnnotationInput] }>();

const surface = ref<HTMLElement | null>(null);
const code = useCodeSelection(surface);
const canAnnotate = computed(() => props.annotatable && Boolean(props.path));

/** The highlighter draws the lines without numbers (a counter does); give each one its number to point at. */
function numberLines(): void {
  const lines = surface.value?.querySelectorAll<HTMLElement>('.source-preview-panel__content .line') ?? [];
  lines.forEach((line, index) => {
    if (canAnnotate.value) line.setAttribute('data-code-line', String(index + 1));
    else line.removeAttribute('data-code-line');
    const existing = line.querySelector('button[data-code-annotation-trigger]');
    if (!canAnnotate.value || !props.showLineNumbers) { existing?.remove(); return; }
    if (existing) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-preview-panel__annotate';
    button.setAttribute('data-code-annotation-trigger', '');
    button.setAttribute('aria-label', translate('chat.codeAnnotations.annotateLine'));
    button.title = translate('chat.codeAnnotations.annotateLine');
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    line.prepend(button);
  });
}
watch([() => props.content, () => props.language, () => props.state, () => props.showLineNumbers, canAnnotate], () => {
  code.clear();
  void nextTick(numberLines);
}, { immediate: true, flush: 'post' });
watch(surface, () => void nextTick(numberLines));
onUpdated(numberLines);

function plusLine(event: MouseEvent): HTMLElement | null {
  if (!canAnnotate.value || !props.showLineNumbers || event.button !== 0 || !(event.target instanceof Element)) return null;
  return event.target.closest('[data-code-annotation-trigger]')?.closest<HTMLElement>('.line') ?? null;
}

function plusPressed(event: MouseEvent): void {
  const line = plusLine(event);
  if (!line) return;
  event.preventDefault();
  code.lineDragStart(line, event);
}

function plusClicked(event: MouseEvent): void {
  if (event.detail !== 0) return;
  const line = plusLine(event);
  if (line) code.commentLine(line, event);
}

function saveAnnotation({ selection, comment }: { selection: CodeSelection; comment: string }): void {
  emit('annotate', { path: selection.path, startLine: selection.startLine, endLine: selection.endLine, text: selection.text, comment });
}
</script>

<style scoped>
.source-preview-panel {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-x: auto;
  overflow-y: auto;
  padding: 0;
  background: var(--color-surface-lowest);
  scrollbar-width: thin;
}

.source-preview-panel__content {
  min-width: max-content;
}

.source-preview-panel--wrap .source-preview-panel__content {
  min-width: 0;
}

.source-preview-panel__content :deep(.shiki),
.source-preview-panel__content :deep(pre) {
  --source-preview-line-height: 20px;
  --source-preview-font-size: var(--code-font-size, var(--font-size-13));
  --source-preview-gutter-width: 5.5ch;
  --source-preview-code-gap: 2ch;
  min-width: max-content;
  margin: 0;
  padding: var(--space-8) 0;
  background: transparent !important;
  font-family: var(--font-family-mono);
  font-size: var(--source-preview-font-size);
  line-height: 0;
}

.source-preview-panel__content :deep(code) {
  display: block;
  counter-reset: source-line;
  line-height: 0;
}

.source-preview-panel__content :deep(.line) {
  position: relative;
  display: block;
  min-height: var(--source-preview-line-height);
  padding-left: calc(
    var(--source-preview-gutter-width) + var(--source-preview-code-gap)
  );
  padding-right: var(--space-8);
  line-height: var(--source-preview-line-height);
  white-space: pre;
}

.source-preview-panel--wrap .source-preview-panel__content :deep(.shiki),
.source-preview-panel--wrap .source-preview-panel__content :deep(pre) {
  min-width: 0;
}

.source-preview-panel--wrap .source-preview-panel__content :deep(.line) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.source-preview-panel--hide-line-numbers
  .source-preview-panel__content
  :deep(.line) {
  padding-left: var(--space-8);
}

.source-preview-panel--hide-line-numbers
  .source-preview-panel__content
  :deep(.line::before) {
  content: none;
}

.source-preview-panel__content :deep(.line.code-annotation-line--selected) {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  box-shadow: inset 3px 0 0 var(--color-primary);
}

/* The affordance for pointing at a line: a small square plus over the margin, shown while the line is hovered. */
.source-preview-panel__content :deep(.source-preview-panel__annotate) {
  position: absolute;
  top: calc((var(--source-preview-line-height) - 16px) / 2);
  left: 2px;
  display: none;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: var(--color-on-primary);
  cursor: pointer;
}

.source-preview-panel__content :deep(.line:hover .source-preview-panel__annotate),
.source-preview-panel__content :deep(.source-preview-panel__annotate:focus-visible) {
  display: grid;
}

.source-preview-panel__content :deep(.source-preview-panel__annotate svg) {
  width: 12px;
  height: 12px;
}

.source-preview-panel__content :deep(.line::before) {
  content: counter(source-line);
  counter-increment: source-line;
  position: absolute;
  top: 0;
  left: 0;
  width: var(--source-preview-gutter-width);
  padding-right: 1ch;
  border-right: 1px solid var(--color-border);
  color: var(--color-border);
  line-height: var(--source-preview-line-height);
  text-align: right;
  user-select: none;
}

.source-preview-panel__empty {
  padding: var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.source-preview-panel__empty--error {
  color: var(--color-error);
}
</style>
