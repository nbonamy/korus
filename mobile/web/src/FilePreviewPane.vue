<template>
  <aside class="transcript-file" aria-label="File preview" @keydown.esc="emit('close')">
    <header class="transcript-file__header">
      <strong :title="path">{{ path.split(/[\\/]/).at(-1) }}</strong>
      <button type="button" aria-label="Refresh file preview" @click="emit('refresh')"><RefreshIcon :size="20" /></button>
      <button ref="closeButton" type="button" aria-label="Close file preview" @click="emit('close')"><X :size="22" /></button>
    </header>
    <div class="transcript-file__tabs" role="group" aria-label="File view">
      <button v-for="mode in ['diff', 'source'] as const" :key="mode" type="button" :aria-pressed="state.mode === mode" @click="emit('mode', mode)">{{ mode === 'diff' ? 'Diff' : 'Source' }}</button>
    </div>
    <div class="transcript-file__scope">{{ state.mode === 'source' ? 'Current file' : state.preview?.diffScope === 'turn' ? 'Changes in this turn' : 'Uncommitted changes' }}</div>
    <div ref="content" class="transcript-file__content" :aria-busy="state.status === 'loading'">
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
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { RefreshIcon, X } from '@workspace/vue/shared/icons/app-icons';
import { languageForFilePath } from '@codex-app-sdk/vue';
import GitDiffPreviewPanel from '@workspace/vue/components/GitDiffPreviewPanel.vue';
import SourcePreviewPanel from '@workspace/vue/components/SourcePreviewPanel.vue';
import type { TranscriptFileState } from './transcript-files';
const props = defineProps<{ state: TranscriptFileState }>();
const emit = defineEmits<{ close: []; refresh: []; mode: [mode: 'diff' | 'source'] }>();
const path = computed(() => props.state.preview?.path ?? props.state.input.path);
const content = ref<HTMLElement>();
const closeButton = ref<HTMLButtonElement>();
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
.transcript-file__header { display: flex; align-items: center; gap: 4px; padding: 4px 8px 4px 16px; }
.transcript-file__header strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.transcript-file button { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.transcript-file button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.transcript-file__tabs { display: flex; gap: 4px; margin: 0 16px; padding: 3px; background: var(--color-surface); border-radius: var(--radius-lg); }
.transcript-file__tabs button { flex: 1; border-radius: var(--radius-md); font-size: 15px; }
.transcript-file__tabs button[aria-pressed="true"] { background: var(--color-surface-lowest); color: var(--color-primary); box-shadow: 0 1px 3px var(--color-border); }
.transcript-file__scope { padding: 10px 16px; font-size: 12px; color: var(--color-text-muted); }
.transcript-file__content { flex: 1; min-height: 0; overflow: auto; padding: 0 12px 20px; overscroll-behavior: contain; }
.transcript-file__notice { padding: 32px 16px; color: var(--color-text-muted); text-align: center; }
.transcript-file__notice button { display: flex; margin: 12px auto 0; color: var(--color-primary); }
</style>
