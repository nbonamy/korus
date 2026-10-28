<template>
  <aside class="transcript-file" aria-label="File preview" @keydown.esc="emit('close')">
    <header class="transcript-file__header">
      <strong :title="path">{{ path.split(/[\\/]/).at(-1) }}</strong>
      <button type="button" aria-label="Refresh file preview" @click="emit('refresh')"><RefreshIcon :size="20" /></button>
      <button type="button" :aria-label="state.mode === 'source' ? 'Show diff' : 'Show source'" :title="state.mode === 'source' ? 'Show diff' : 'Show source'" @click="emit('mode', state.mode === 'source' ? 'diff' : 'source')"><component :is="state.mode === 'source' ? FileDiffIcon : CodeIcon" :size="20" /></button>
      <button ref="closeButton" type="button" aria-label="Close file preview" @click="emit('close')"><X :size="22" /></button>
    </header>
    <div v-if="showDiffNavigation" class="transcript-file__navigation" role="group" aria-label="Diff navigation">
      <template v-if="changeCount > 1">
        <button type="button" class="transcript-file__previous" aria-label="Previous change" :disabled="activeChange === 0" @click="navigateChange(-1)"><ChevronRightIcon :size="20" /></button>
        <span class="transcript-file__position" aria-live="polite">Change {{ activeChange + 1 }} of {{ changeCount }}</span>
        <button type="button" aria-label="Next change" :disabled="activeChange === changeCount - 1" @click="navigateChange(1)"><ChevronRightIcon :size="20" /></button>
      </template>
      <div class="transcript-file__stats"><span class="transcript-file__added">+{{ diffStats.addedLines }}</span><span class="transcript-file__removed">−{{ diffStats.removedLines }}</span></div>
    </div>
    <div ref="content" class="transcript-file__content" :class="{ 'transcript-file__content--source': state.mode === 'source' }" :style="{ '--transcript-source-gutter': sourceGutter }" :aria-busy="state.status === 'loading'" @scroll.passive="updateActiveChange">
      <div v-if="state.status === 'loading'" class="transcript-file__notice" role="status">Loading file…</div>
      <div v-else-if="state.status === 'error'" class="transcript-file__notice" role="alert">Couldn’t load this file. Reconnect or update your desktop and try again.<button type="button" @click="emit('refresh')">Retry</button></div>
      <template v-else-if="state.mode === 'diff'">
        <GitDiffPreviewPanel v-if="state.preview?.diff" :diff="state.preview.diff" :word-wrap="true" />
        <div v-else class="transcript-file__notice">{{ state.preview?.diffUnavailable ? 'This diff is unavailable or too large to preview.' : 'No changes for this file in this scope.' }}</div>
      </template>
      <SourcePreviewPanel v-else-if="state.preview?.source?.kind === 'text'" :content="state.preview.source.content ?? ''" :language="languageForFilePath(path)" :word-wrap="true" />
      <div v-else class="transcript-file__notice">{{ state.preview?.source?.kind === 'tooLarge' ? 'This file is too large to preview.' : state.preview?.source?.kind === 'binary' || state.preview?.source?.kind === 'image' ? 'Source preview is unavailable for this file type.' : 'The file is no longer available on your computer.' }}</div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ChevronRightIcon, CodeIcon, FileDiffIcon, RefreshIcon, X } from '@workspace/vue/shared/icons/app-icons';
import { summarizeUnifiedDiff } from '@workspace/core/unified-diff-stats';
import { languageForFilePath } from '@codex-app-sdk/vue';
import GitDiffPreviewPanel from '@workspace/vue/components/GitDiffPreviewPanel.vue';
import SourcePreviewPanel from '@workspace/vue/components/SourcePreviewPanel.vue';
import type { TranscriptFileState } from './transcript-files';
const props = defineProps<{ state: TranscriptFileState }>();
const emit = defineEmits<{ close: []; refresh: []; mode: [mode: 'diff' | 'source'] }>();
const path = computed(() => props.state.preview?.path ?? props.state.input.path);
const sourceGutter = computed(() => `${Math.max(2, String((props.state.preview?.source?.content ?? '').split('\n').length).length) + 1.25}ch`);
const content = ref<HTMLElement>();
const closeButton = ref<HTMLButtonElement>();
const diffStats = computed(() => summarizeUnifiedDiff(props.state.preview?.diff ?? ''));
const showDiffNavigation = computed(() => props.state.status === 'ready' && props.state.mode === 'diff' && diffStats.value.changedFiles > 0);
const activeChange = ref(0);
const changeCount = ref(0);
let changePositions: number[] = [];
let resizeObserver: ResizeObserver | undefined;

// Measure on content/layout changes; scrolling only searches cached section positions.
function measureChanges() {
  const scroller = content.value;
  if (!scroller || props.state.mode !== 'diff') return;
  const top = scroller.getBoundingClientRect().top;
  changePositions = [...scroller.querySelectorAll<HTMLElement>('.git-diff-preview-panel__chunk')]
    .map(chunk => chunk.querySelector<HTMLElement>('.git-diff-preview-panel__line--added, .git-diff-preview-panel__line--deleted'))
    .filter((line): line is HTMLElement => line !== null)
    .map(line => line.getBoundingClientRect().top - top + scroller.scrollTop);
  changeCount.value = changePositions.length;
  updateActiveChange();
}

function updateActiveChange() {
  const scroller = content.value;
  if (!scroller || props.state.mode !== 'diff' || !changePositions.length) return;
  if (scroller.scrollTop > 0 && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1) {
    activeChange.value = changePositions.length - 1;
    return;
  }
  let low = 0, high = changePositions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (changePositions[middle]! <= scroller.scrollTop + 2) low = middle + 1;
    else high = middle;
  }
  activeChange.value = Math.max(0, low - 1);
}

function navigateChange(step: number) {
  const index = Math.max(0, Math.min(changePositions.length - 1, activeChange.value + step));
  if (!content.value || !changePositions.length) return;
  activeChange.value = index;
  content.value.scrollTop = changePositions[index]!;
}

watch(() => [props.state.preview?.diff, props.state.status, props.state.mode, path.value], async (_value, _old, onCleanup) => {
  let cancelled = false;
  onCleanup(() => { cancelled = true; resizeObserver?.disconnect(); });
  changePositions = []; changeCount.value = 0; activeChange.value = 0;
  if (props.state.status !== 'ready' || props.state.mode !== 'diff') return;
  await nextTick();
  if (cancelled || !content.value) return;
  content.value.scrollTop = 0;
  measureChanges();
  const panel = content.value.querySelector('.git-diff-preview-panel');
  if (panel) { resizeObserver = new ResizeObserver(measureChanges); resizeObserver.observe(panel); }
}, { immediate: true, flush: 'post' });
onUnmounted(() => resizeObserver?.disconnect());
onMounted(() => closeButton.value?.focus());
watch(() => [props.state.status, props.state.mode, props.state.input.line], async () => {
  if (props.state.status !== 'ready' || props.state.mode !== 'source' || !props.state.input.line) return;
  await nextTick();
  const lines = content.value?.querySelectorAll<HTMLElement>('.source-preview-panel__content .line');
  const line = lines?.[props.state.input.line - 1];
  if (line && content.value) content.value.scrollTop = line.offsetTop - content.value.offsetTop - 28;
}, { immediate: true, flush: 'post' });
</script>

<style scoped>
.transcript-file { display: flex; flex-direction: column; min-width: 0; height: 100%; background: var(--color-surface-lowest); color: var(--color-text); border-left: 1px solid var(--color-border); }
.transcript-file__header { display: flex; flex-shrink: 0; align-items: center; gap: 4px; padding: 4px 8px 4px 16px; }
.transcript-file__header strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.transcript-file button { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.transcript-file button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.transcript-file button:disabled { opacity: .35; cursor: default; }
.transcript-file__navigation { display: flex; flex-shrink: 0; align-items: center; min-height: 44px; padding: 0 16px 0 4px; border-bottom: 1px solid var(--color-border); }
.transcript-file__previous svg { transform: rotate(180deg); }
.transcript-file__position { font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.transcript-file__stats { display: flex; gap: 8px; margin-left: auto; padding-left: 8px; font-family: var(--font-family-mono); font-size: 14px; }
.transcript-file__added { color: var(--color-success); }
.transcript-file__removed { color: var(--color-error); }
.transcript-file__content { flex: 1; min-height: 0; overflow: auto; padding: 0 12px 20px; overscroll-behavior: contain; }
.transcript-file__content :deep(.git-diff-preview-panel) { overflow: visible; }
.transcript-file__content :deep(.git-diff-preview-panel__file-header-row) { display: none; }
.transcript-file__content--source { padding-left: 4px; padding-right: 4px; }
.transcript-file__content :deep(.source-preview-panel__content pre) { --source-preview-gutter-width: var(--transcript-source-gutter); --source-preview-code-gap: .75ch; }
.transcript-file__content :deep(.source-preview-panel__content .line::before) { box-sizing: border-box; }
.transcript-file__notice { padding: 32px 16px; color: var(--color-text-muted); text-align: center; }
.transcript-file__notice button { display: flex; margin: 12px auto 0; color: var(--color-primary); }
</style>
