<template>
  <div class="git-log-details" :aria-busy="loading">
    <p v-if="loading">{{ $t('gitLog.loadingDetails') }}</p>
    <div v-else-if="error" role="alert"><p>{{ error }}</p><button class="app-button app-button--tertiary" type="button" @click="load">{{ $t('gitLog.retry') }}</button></div>
    <template v-else-if="details">
      <p v-if="messageBody" class="git-log-details__message">{{ messageBody }}</p>
      <h4>{{ $t('gitLog.files') }}</h4>
      <p v-if="!details.files.length">{{ $t('gitLog.noFiles') }}</p>
      <div class="git-log-details__files">
        <div v-for="file in details.files" :key="file.path">
          <button class="git-log-details__file" type="button" :aria-label="$t('gitLog.viewFile', { path: file.path })" :aria-expanded="selectedFile === file.path" @click="selectFile(file.path)">
            <span class="git-log-details__path" :title="file.path">{{ file.previousPath ? `${file.previousPath} → ` : '' }}{{ file.path }}</span>
            <span class="git-log-details__stats"><span v-if="file.binary">{{ $t('gitLog.binary') }}</span><template v-else><span class="git-log-details__added">+{{ file.addedLines }}</span><span class="git-log-details__removed">-{{ file.removedLines }}</span></template></span>
          </button>
          <div v-if="selectedFile === file.path" class="git-log-details__diff">
            <GitDiffPreviewPanel :diff="fileDiff" :state="fileState" :error="fileError" />
            <button v-if="fileState === 'error'" type="button" class="app-button app-button--tertiary" @click="readFile(file.path)">{{ $t('gitLog.retry') }}</button>
          </div>
        </div>
      </div>
      <p v-if="details.filesTruncated">{{ $t('gitLog.filesTruncated') }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { AgentGitLogDetails } from '@workspace/core/contracts';
import { appApi } from '../platform-api';
import { translate } from '../i18n';
import GitDiffPreviewPanel from './GitDiffPreviewPanel.vue';

const props = defineProps<{ agentId: string; head: string; sha: string }>();
const details = ref<AgentGitLogDetails | null>(null);
const messageBody = computed(() => {
  const message = details.value?.message ?? '';
  // Git's subject is the first paragraph, already shown in the commit row.
  const separator = /\r?\n[ \t]*\r?\n/u.exec(message);
  return separator ? message.slice(separator.index + separator[0].length).trim() : '';
});
const loading = ref(true);
const error = ref<string | null>(null);
const selectedFile = ref<string | null>(null);
const fileDiff = ref('');
const fileState = ref<'idle' | 'loading' | 'error'>('idle');
const fileError = ref<string | null>(null);
let generation = 0;
let fileGeneration = 0;
async function load(): Promise<void> {
  const id = ++generation;
  fileGeneration++;
  loading.value = true; error.value = null; details.value = null; selectedFile.value = null;
  try {
    if (!appApi) throw new Error('Git history unavailable');
    const result = await appApi.getAgentGitLogCommit(props.agentId, { head: props.head, sha: props.sha });
    if (id === generation) details.value = result;
  } catch { if (id === generation) error.value = translate('gitLog.detailsError'); }
  finally { if (id === generation) loading.value = false; }
}
function selectFile(path: string): void {
  fileGeneration++;
  selectedFile.value = selectedFile.value === path ? null : path;
  if (selectedFile.value) void readFile(path);
}
async function readFile(path: string): Promise<void> {
  const id = ++fileGeneration;
  fileDiff.value = ''; fileState.value = 'loading'; fileError.value = null;
  try {
    if (!appApi) throw new Error('Git history unavailable');
    const result = await appApi.getAgentGitLogFile(props.agentId, { head: props.head, sha: props.sha, path });
    if (id === fileGeneration) { fileDiff.value = result.diff; fileState.value = 'idle'; }
  } catch {
    if (id === fileGeneration) { fileState.value = 'error'; fileError.value = translate('gitLog.fileError'); }
  }
}
watch(() => [props.agentId, props.head, props.sha], load, { immediate: true });
onBeforeUnmount(() => { generation++; fileGeneration++; });
</script>

<style scoped>
.git-log-details {
  padding: var(--space-2) var(--space-6) var(--space-8) 33px;
  font-size: var(--font-size-13);
}

.git-log-details p {
  margin: var(--space-4) 0;
}

.git-log-details__message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.git-log-details h4 {
  margin: var(--space-8) 0 var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: 500;
  text-transform: uppercase;
}

.git-log-details__files {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.git-log-details__files > div + div {
  border-top: 1px solid var(--color-border);
}

.git-log-details__file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 0;
  color: var(--color-text);
  background: transparent;
  text-align: left;
  font-size: var(--font-size-13);
  cursor: pointer;
}

.git-log-details__file:hover {
  background: var(--color-surface-high);
}

.git-log-details__path {
  min-width: 0;
  overflow-wrap: anywhere;
}

.git-log-details__stats {
  display: flex;
  flex: none;
  gap: var(--space-6);
  font-size: var(--font-size-12);
}

.git-log-details__added {
  color: var(--color-success);
}

.git-log-details__removed {
  color: var(--color-error);
}

.git-log-details__diff {
  overflow: auto;
  max-height: 400px;
}

button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
</style>
