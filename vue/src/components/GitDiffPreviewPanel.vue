<template>
  <article
    class="git-diff-preview-panel"
    :class="{ 'git-diff-preview-panel--wrap': wordWrap }"
    :aria-busy="state === 'loading'"
  >
    <div
      v-if="state === 'loading'"
      class="git-diff-preview-panel__empty codex-text-shimmer"
    > {{ $t('surface.gitDiffPreviewPanel.loadingDiff') }} </div>
    <div
      v-else-if="state === 'error'"
      class="git-diff-preview-panel__empty git-diff-preview-panel__empty--error"
    >
      {{ error ?? $t('surface.gitDiffPreviewPanel.unableToLoadDiff') }}
    </div>
    <div
      v-else-if="parseError"
      class="git-diff-preview-panel__empty git-diff-preview-panel__empty--error"
    >
      {{ parseError }}
    </div>
    <div
      v-else-if="files.length"
      class="git-diff-preview-panel__files"
    >
      <section
        v-for="file in files"
        :key="file.key"
        class="git-diff-preview-panel__file"
      >
        <div class="git-diff-preview-panel__file-header-row">
          <button
            class="git-diff-preview-panel__file-header"
            type="button"
            :aria-expanded="isFileExpanded(file.key)"
            @click="toggleFile(file.key)"
          >
            <span
              class="git-diff-preview-panel__file-icon"
              :class="`git-diff-preview-panel__file-icon--${file.iconKind}`"
              aria-hidden="true"
            >
              <component :is="fileIcon(file.iconKind)" />
            </span>
            <span
              class="git-diff-preview-panel__file-title"
              :title="file.fullPath"
            >
              <span
                v-if="file.directory"
                class="git-diff-preview-panel__file-directory"
              >{{ file.directory }}</span>
              <strong>{{ file.name }}</strong>
            </span>
            <span class="git-diff-preview-panel__file-meta">
              <span class="git-diff-preview-panel__file-added">+{{ file.addedLines }}</span>
              <span class="git-diff-preview-panel__file-removed">-{{ file.removedLines }}</span>
            </span>
          </button>
          <button
            v-if="openFileEnabled && file.openable"
            class="git-diff-preview-panel__open-file"
            type="button"
            :aria-label="$t('surface.gitDiffPreviewPanel.openFileInTab', { file: file.fullPath })"
            :title="$t('surface.gitDiffPreviewPanel.openFileInTab', { file: file.fullPath })"
            @click="emit('openFile', file.fullPath)"
          >
            <FileArrowRightIcon aria-hidden="true" />
          </button>
        </div>

        <div
          v-if="isFileExpanded(file.key) && file.chunks.length"
          class="git-diff-preview-panel__chunks"
        >
          <div
            v-for="chunk in file.chunks"
            :key="chunk.key"
            class="git-diff-preview-panel__chunk"
          >
            <div
              v-if="chunk.unmodifiedLinesBefore > 0"
              class="git-diff-preview-panel__hunk"
            >
              {{ chunk.unmodifiedLinesBefore }} {{ $t('surface.gitDiffPreviewPanel.unmodified') }} {{ chunk.unmodifiedLinesBefore === 1 ? 'line' : 'lines' }}
            </div>
            <div
              v-for="(line, index) in chunk.lines"
              :key="`${chunk.key}-${index}`"
              class="git-diff-preview-panel__line"
              :class="`git-diff-preview-panel__line--${line.kind}`"
            >
              <span class="git-diff-preview-panel__line-number">{{ line.oldNumber }}</span>
              <span class="git-diff-preview-panel__line-number">{{ line.newNumber }}</span>
              <span class="git-diff-preview-panel__line-marker">{{ line.marker }}</span>
              <code>{{ line.content }}</code>
            </div>
          </div>
        </div>
        <div
          v-else-if="isFileExpanded(file.key)"
          class="git-diff-preview-panel__empty git-diff-preview-panel__empty--file"
        > {{ $t('surface.gitDiffPreviewPanel.noTextualHunks') }} </div>
      </section>
    </div>
    <div
      v-else
      class="git-diff-preview-panel__empty"
    > {{ $t('surface.gitDiffPreviewPanel.noDiffContent') }} </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IconBrandJavascript, IconBrandTypescript, IconBrandVue, IconFileCode } from '@tabler/icons-vue';
import parseGitDiff, { type AnyChunk, type AnyFileChange, type Chunk } from 'parse-git-diff';
import { translate } from '../i18n';
import { FileArrowRightIcon } from '../shared/icons/app-icons';

const props = withDefaults(defineProps<{
  diff: string;
  collapseAllSignal?: number;
  error?: string | null;
  expandAllSignal?: number;
  openFileEnabled?: boolean;
  state?: 'idle' | 'loading' | 'error';
  wordWrap?: boolean;
}>(), {
  collapseAllSignal: 0,
  error: null,
  expandAllSignal: 0,
  openFileEnabled: false,
  state: 'idle',
  wordWrap: false,
});

const emit = defineEmits<{
  allExpandedChange: [isAllExpanded: boolean];
  openFile: [filePath: string];
}>();

type DiffLineKind = 'added' | 'deleted' | 'context' | 'message';

type DiffLineView = {
  kind: DiffLineKind;
  oldNumber: string;
  newNumber: string;
  marker: string;
  content: string;
};

type DiffChunkView = {
  key: string;
  fromStart: number;
  fromLines: number;
  toStart: number;
  toLines: number;
  unmodifiedLinesBefore: number;
  lines: DiffLineView[];
};

type DiffFileView = {
  key: string;
  directory: string;
  fullPath: string;
  name: string;
  iconKind: DiffFileIconKind;
  openable: boolean;
  addedLines: number;
  removedLines: number;
  chunks: DiffChunkView[];
};

type DiffFileIconKind = 'javascript' | 'typescript' | 'vue' | 'code';

const parsed = computed(() => {
  if (!props.diff.trim()) {
    return { files: [] as DiffFileView[], error: null as string | null };
  }

  try {
    const diff = parseGitDiff(props.diff);
    return {
      files: diff.files.map(mapFile),
      error: null,
    };
  } catch (error) {
    return {
      files: [] as DiffFileView[],
      error: error instanceof Error ? error.message : translate('surface.gitDiffPreviewPanel.unableToParseDiff'),
    };
  }
});

const files = computed(() => parsed.value.files);
const parseError = computed(() => parsed.value.error);
const collapsedFileKeys = ref(new Set<string>());
const isAllExpanded = computed(() => collapsedFileKeys.value.size === 0);

watch(files, (nextFiles) => {
  const nextFileKeys = new Set(nextFiles.map((file) => file.key));
  collapsedFileKeys.value = new Set([...collapsedFileKeys.value].filter((key) => nextFileKeys.has(key)));
});

watch(() => props.expandAllSignal, () => {
  collapsedFileKeys.value = new Set();
});

watch(() => props.collapseAllSignal, () => {
  collapsedFileKeys.value = new Set(files.value.map((file) => file.key));
});

watch(isAllExpanded, (nextIsAllExpanded) => {
  emit('allExpandedChange', nextIsAllExpanded);
}, { immediate: true });

function isFileExpanded(fileKey: string): boolean {
  return !collapsedFileKeys.value.has(fileKey);
}

function toggleFile(fileKey: string): void {
  const nextCollapsedKeys = new Set(collapsedFileKeys.value);
  if (nextCollapsedKeys.has(fileKey)) {
    nextCollapsedKeys.delete(fileKey);
  } else {
    nextCollapsedKeys.add(fileKey);
  }
  collapsedFileKeys.value = nextCollapsedKeys;
}

function mapFile(file: AnyFileChange, fileIndex: number): DiffFileView {
  const title = file.type === 'RenamedFile'
    ? `${file.pathBefore} -> ${file.pathAfter}`
    : file.path;
  const visiblePath = file.type === 'RenamedFile' ? file.pathAfter : file.path;
  const { directory, name } = splitFilePath(visiblePath);
  const chunks = file.chunks.reduce<DiffChunkView[]>((mappedChunks, chunk, index) => {
    const mappedChunk = mapChunk(chunk, `${title}:${index}`, mappedChunks.at(-1));
    if (mappedChunk) mappedChunks.push(mappedChunk);
    return mappedChunks;
  }, []);
  return {
    key: `${file.type}:${title}:${fileIndex}`,
    directory: compactDirectory(directory),
    fullPath: visiblePath,
    name,
    iconKind: fileIconKind(name),
    openable: file.type !== 'DeletedFile',
    addedLines: countLines(chunks, 'added'),
    removedLines: countLines(chunks, 'deleted'),
    chunks,
  };
}

function compactDirectory(directory: string): string {
  const segments = directory.split('/').filter(Boolean);
  if (segments.length <= 4) {
    return directory;
  }

  return `…/${segments.slice(-4).join('/')}/`;
}

function countLines(chunks: DiffChunkView[], kind: DiffLineKind): number {
  return chunks.reduce((total, chunk) => total + chunk.lines.filter((line) => line.kind === kind).length, 0);
}

function splitFilePath(path: string): { directory: string; name: string } {
  const separatorIndex = path.lastIndexOf('/');
  if (separatorIndex === -1) {
    return { directory: '', name: path };
  }

  return {
    directory: path.slice(0, separatorIndex + 1),
    name: path.slice(separatorIndex + 1),
  };
}

function fileIconKind(fileName: string): DiffFileIconKind {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') return 'javascript';
  if (extension === 'vue') return 'vue';
  return 'code';
}

function fileIcon(kind: DiffFileIconKind) {
  if (kind === 'typescript') return IconBrandTypescript;
  if (kind === 'javascript') return IconBrandJavascript;
  if (kind === 'vue') return IconBrandVue;
  return IconFileCode;
}

function mapChunk(chunk: AnyChunk, key: string, previousChunk?: DiffChunkView): DiffChunkView | null {
  if (chunk.type !== 'Chunk') {
    return null;
  }

  const fromStart = chunk.fromFileRange.start;
  const fromLines = chunk.fromFileRange.lines;
  const toStart = chunk.toFileRange.start;
  const toLines = chunk.toFileRange.lines;
  const unmodifiedLinesBefore = previousChunk
    ? Math.max(0, Math.min(
      fromStart - (previousChunk.fromStart + previousChunk.fromLines),
      toStart - (previousChunk.toStart + previousChunk.toLines),
    ))
    : Math.max(0, Math.min(fromStart, toStart) - 1);

  return {
    key,
    fromStart,
    fromLines,
    toStart,
    toLines,
    unmodifiedLinesBefore,
    lines: chunk.changes.map(mapLine),
  };
}

function mapLine(line: Chunk['changes'][number]): DiffLineView {
  switch (line.type) {
    case 'AddedLine':
      return {
        kind: 'added',
        oldNumber: '',
        newNumber: String(line.lineAfter),
        marker: '+',
        content: line.content,
      };
    case 'DeletedLine':
      return {
        kind: 'deleted',
        oldNumber: String(line.lineBefore),
        newNumber: '',
        marker: '-',
        content: line.content,
      };
    case 'UnchangedLine':
      return {
        kind: 'context',
        oldNumber: String(line.lineBefore),
        newNumber: String(line.lineAfter),
        marker: ' ',
        content: line.content,
      };
    case 'MessageLine':
      return {
        kind: 'message',
        oldNumber: '',
        newNumber: '',
        marker: '\\',
        content: line.content,
      };
  }
}
</script>

<style scoped>
.git-diff-preview-panel {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-x: auto;
  overflow-y: auto;
  background: var(--color-surface-lowest);
  font-family: var(--font-family-mono);
  font-size: var(--code-font-size, var(--font-size-13));
  line-height: var(--line-height-20);
  scrollbar-width: thin;
}

.git-diff-preview-panel__files {
  display: grid;
  min-width: 100%;
}

.git-diff-preview-panel--wrap .git-diff-preview-panel__files {
  min-width: 0;
}

.git-diff-preview-panel__file {
  min-width: 0;
  border-bottom: 1px solid var(--color-border);
}

.git-diff-preview-panel__file-header-row {
  position: sticky;
  top: 0;
  z-index: 1;
  width: 100%;
  display: flex;
  align-items: center;
  min-height: 36px;
  border-bottom: 1px solid var(--color-border);
  color: inherit;
  background: var(--color-surface-lowest);
}

.git-diff-preview-panel__file-header {
  min-width: 0;
  min-height: 36px;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-8);
  border: 0;
  color: inherit;
  background: transparent;
  font-family: var(--font-family-base);
  text-align: left;
  cursor: pointer;
}

.git-diff-preview-panel__file-header-row:hover {
  background: var(--color-surface-low);
}

.git-diff-preview-panel__file-header:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.git-diff-preview-panel__open-file {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  margin-right: var(--space-4);
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.git-diff-preview-panel__open-file:hover,
.git-diff-preview-panel__open-file:focus-visible {
  color: var(--color-text);
  background: var(--color-surface);
}

.git-diff-preview-panel__open-file:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.git-diff-preview-panel__open-file svg {
  width: var(--icon-md);
  height: var(--icon-md);
  stroke-width: 1.8;
}

.git-diff-preview-panel__file-icon {
  flex: 0 0 var(--space-12);
  width: var(--space-12);
  height: var(--space-12);
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: var(--color-surface-low);
}

.git-diff-preview-panel__file-icon svg {
  width: var(--icon-md);
  height: var(--icon-md);
  stroke-width: 1.8;
}

.git-diff-preview-panel__file-title {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  overflow: hidden;
  white-space: nowrap;
  font-size: var(--font-size-14);
}

.git-diff-preview-panel__file-directory {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-weight: var(--font-weight-regular);
}

.git-diff-preview-panel__file-title strong {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
}

.git-diff-preview-panel__file-meta {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-family-mono);
}

.git-diff-preview-panel__file-header .git-diff-preview-panel__file-added {
  color: var(--color-success);
  font-size: var(--font-size-13);
}

.git-diff-preview-panel__file-header .git-diff-preview-panel__file-removed {
  color: var(--color-error);
  font-size: var(--font-size-13);
}

.git-diff-preview-panel__hunk {
  padding: var(--space-1) var(--space-8);
  color: var(--color-text-muted);
  background: var(--color-surface-low);
  font-family: var(--font-family-base);
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}

.git-diff-preview-panel__chunks,
.git-diff-preview-panel__chunk {
  display: grid;
  width: max-content;
  min-width: 100%;
}

.git-diff-preview-panel__line {
  display: grid;
  grid-template-columns: 5ch 5ch 2ch max-content;
  width: 100%;
  min-width: 0;
  min-height: var(--line-height-20);
  color: var(--color-text);
  white-space: pre;
}

.git-diff-preview-panel__line--added {
  background: var(--color-success-container);
}

.git-diff-preview-panel__line--deleted {
  background: var(--color-error-container);
}

.git-diff-preview-panel__line--message {
  color: var(--color-text-muted);
}

.git-diff-preview-panel__line-number,
.git-diff-preview-panel__line-marker {
  user-select: none;
  color: var(--color-text-muted);
  text-align: right;
}

.git-diff-preview-panel__line-marker {
  text-align: center;
}

.git-diff-preview-panel__line--added .git-diff-preview-panel__line-marker {
  color: var(--color-success);
}

.git-diff-preview-panel__line--deleted .git-diff-preview-panel__line-marker {
  color: var(--color-error);
}

.git-diff-preview-panel__line code {
  padding-right: var(--space-8);
  overflow: visible;
  font-family: inherit;
  text-overflow: clip;
}

.git-diff-preview-panel--wrap .git-diff-preview-panel__chunks,
.git-diff-preview-panel--wrap .git-diff-preview-panel__chunk {
  width: 100%;
  min-width: 0;
}

.git-diff-preview-panel--wrap .git-diff-preview-panel__line {
  grid-template-columns: 5ch 5ch 2ch minmax(0, 1fr);
  width: auto;
  min-width: 0;
}

.git-diff-preview-panel--wrap .git-diff-preview-panel__hunk,
.git-diff-preview-panel--wrap .git-diff-preview-panel__line {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.git-diff-preview-panel--wrap .git-diff-preview-panel__line code {
  overflow: visible;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.git-diff-preview-panel__empty {
  padding: var(--space-8);
  color: var(--color-text-muted);
  font-family: var(--font-family-base);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.git-diff-preview-panel__empty--error {
  color: var(--color-error);
}

.git-diff-preview-panel__empty--file {
  font-family: var(--font-family-mono);
}
</style>
