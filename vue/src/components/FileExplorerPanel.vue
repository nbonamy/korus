<template>
  <section class="file-explorer" :aria-label="$t('surface.fileExplorerPanel.workspaceFiles')">
    <header class="file-explorer__toolbar">
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        :aria-label="$t('surface.fileExplorerPanel.searchWorkspaceFiles')"
        :placeholder="$t('surface.fileExplorerPanel.searchFiles')"
        @keydown.escape="query = ''"
      />
      <button class="file-explorer__refresh" type="button" :aria-label="$t('surface.fileExplorerPanel.refreshFiles')" @click="refresh">
        <RefreshIcon aria-hidden="true" />
      </button>
    </header>

    <p v-if="error" class="file-explorer__status file-explorer__status--error">{{ error }}</p>
    <p v-if="loading && visibleRows.length === 0" class="file-explorer__status">{{ $t('surface.fileExplorerPanel.loadingFiles') }}</p>
    <p v-else-if="!error && visibleRows.length === 0" class="file-explorer__status">{{ query.trim() ? $t('surface.fileExplorerPanel.noMatchingFiles') : $t('surface.fileExplorerPanel.noFilesInThisWorkspace') }}</p>

    <div v-if="visibleRows.length" class="file-explorer__tree" role="tree" :aria-label="$t('surface.fileExplorerPanel.workspaceFileTree')">
      <div
        v-for="row in visibleRows"
        :key="`${row.kind}:${row.path}`"
        class="file-explorer__row"
        :style="{ paddingInlineStart: `${8 + row.depth * 16}px` }"
        role="treeitem"
        :aria-expanded="row.kind === 'folder' ? expanded.has(row.path) : undefined"
      >
        <button
          v-if="row.kind === 'more'"
          class="file-explorer__item"
          type="button"
          :disabled="Boolean(query.trim() ? searchPage?.loading : pages.get(row.path)?.loading)"
          :aria-label="$t('surface.fileExplorerPanel.loadMoreFiles')"
          @click="loadMore(row.path)"
        >{{ $t('surface.fileExplorerPanel.loadMoreFiles') }}</button>
        <button
          v-else-if="row.kind === 'folder'"
          class="file-explorer__item file-explorer__folder"
          type="button"
          @click="toggleFolder(row.path)"
        >
          <ChevronRightIcon :class="{ 'file-explorer__chevron--open': expanded.has(row.path) }" aria-hidden="true" />
          <FolderIcon aria-hidden="true" />
          <span>{{ row.name }}</span>
        </button>
        <button
          v-else
          class="file-explorer__item file-explorer__file"
          type="button"
          :title="$t('dynamic.files.preview', { path: row.path })"
          @click="emit('preview', row.path)"
        >
          <FileTextIcon aria-hidden="true" />
          <span>{{ row.name }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AgentDirectoryEntry, AgentDirectoryInput, AgentDirectoryPage } from '@workspace/core/contracts/workspace';
import { ChevronRightIcon, FileTextIcon, FolderIcon, RefreshIcon } from '../shared/icons/app-icons';

type Page = AgentDirectoryPage & { loading: boolean; error?: string };
type Row = { kind: 'folder' | 'file' | 'more'; name: string; path: string; depth: number };
const props = defineProps<{ loadDirectory: (input: AgentDirectoryInput) => Promise<AgentDirectoryPage> }>();
const emit = defineEmits<{ preview: [path: string] }>();
const query = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const expanded = ref(new Set<string>());
const pages = ref(new Map<string, Page>());
const searchPage = ref<Page>();
let epoch = 0;
let searchVersion = 0;
let disposed = false;
const loading = computed(() => query.value.trim() ? searchPage.value?.loading : !pages.value.has('') || [...pages.value.values()].some(page => page.loading));
const error = computed(() => query.value.trim() ? searchPage.value?.error : [...pages.value.values()].find(page => page.error)?.error);
const visibleRows = computed<Row[]>(() => {
  if (query.value.trim()) return [
    ...(searchPage.value?.entries ?? []).map(entry => ({ ...entry, name: entry.path, depth: 0 })),
    ...(searchPage.value?.nextCursor != null ? [{ kind: 'more' as const, name: '', path: '', depth: 0 }] : []),
  ];
  const rows: Row[] = [];
  const flatten = (path: string, depth: number) => {
    const page = pages.value.get(path);
    for (const entry of page?.entries ?? []) {
      rows.push({ ...entry, depth });
      if (entry.kind === 'folder' && expanded.value.has(entry.path)) flatten(entry.path, depth + 1);
    }
    if (page?.nextCursor != null) rows.push({ kind: 'more', name: '', path, depth });
  };
  flatten('', 0);
  return rows;
});

async function loadPage(path: string, append = false): Promise<void> {
  if (disposed) return;
  const previous = pages.value.get(path);
  if (previous?.loading) return;
  const token = epoch;
  pages.value.set(path, { entries: previous?.entries ?? [], nextCursor: previous?.nextCursor ?? null, loading: true });
  try {
    const page = await props.loadDirectory({ path, ...(append ? { cursor: previous!.nextCursor! } : {}) });
    if (disposed || token !== epoch) return;
    pages.value.set(path, { ...page, entries: mergeEntries(append ? previous?.entries ?? [] : [], page.entries), loading: false });
  } catch (cause) {
    if (!disposed && token === epoch) pages.value.set(path, { entries: previous?.entries ?? [], nextCursor: previous?.nextCursor ?? null, loading: false, error: String(cause instanceof Error ? cause.message : cause) });
  }
}

async function searchFiles(append = false): Promise<void> {
  const needle = query.value.trim();
  const token = ++searchVersion;
  const previous = searchPage.value;
  searchPage.value = { entries: append ? previous?.entries ?? [] : [], nextCursor: previous?.nextCursor ?? null, loading: true };
  try {
    const page = await props.loadDirectory({ query: needle, ...(append ? { cursor: previous!.nextCursor! } : {}) });
    if (disposed || token !== searchVersion) return;
    searchPage.value = { ...page, entries: mergeEntries(append ? previous?.entries ?? [] : [], page.entries), loading: false };
  } catch (cause) {
    if (!disposed && token === searchVersion) searchPage.value = { entries: previous?.entries ?? [], nextCursor: previous?.nextCursor ?? null, loading: false, error: String(cause instanceof Error ? cause.message : cause) };
  }
}

function mergeEntries(previous: AgentDirectoryEntry[], entries: AgentDirectoryEntry[]): AgentDirectoryEntry[] {
  return [...new Map([...previous, ...entries].map(entry => [entry.path, entry])).values()];
}
function toggleFolder(path: string): void {
  if (expanded.value.has(path)) expanded.value.delete(path);
  else {
    expanded.value.add(path);
    if (!pages.value.has(path) || pages.value.get(path)?.error) void loadPage(path);
  }
}
function loadMore(path: string): void {
  if (query.value.trim()) void searchFiles(true); else void loadPage(path, true);
}
async function refresh(): Promise<void> {
  epoch += 1;
  pages.value.clear();
  if (query.value.trim()) void searchFiles();
  await loadPage('');
  for (const path of [...expanded.value].sort((a, b) => a.split('/').length - b.split('/').length)) {
    if ([...pages.value.values()].some(page => page.entries.some(entry => entry.kind === 'folder' && entry.path === path))) await loadPage(path);
  }
}
watch(query, (value, _old, cleanup) => {
  searchVersion += 1;
  searchPage.value = value.trim() ? { entries: [], nextCursor: null, loading: true } : undefined;
  if (!value.trim()) return;
  const timer = setTimeout(() => void searchFiles(), 180);
  cleanup(() => clearTimeout(timer));
});
onMounted(() => { void loadPage(''); void nextTick(() => searchInput.value?.focus()); });
onBeforeUnmount(() => { disposed = true; epoch += 1; searchVersion += 1; });
</script>

<style scoped>
.file-explorer {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--color-shell-main);
}

.file-explorer__toolbar {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.file-explorer__toolbar input {
  min-width: 0;
  flex: 1;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: var(--color-surface-low);
}

.file-explorer__refresh {
  display: flex;
  align-items: center;
  padding: var(--space-2);
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
}

.file-explorer__refresh svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.file-explorer__tree {
  min-height: 0;
  overflow: auto;
  padding-block: var(--space-2);
}

.file-explorer__row {
  min-width: 0;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline-end: var(--space-2);
}

.file-explorer__row:hover {
  background: var(--color-surface-low);
}

.file-explorer__item {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 0;
  color: var(--color-text);
  background: transparent;
  text-align: left;
}

.file-explorer__item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-explorer__item svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.file-explorer__folder svg:first-child {
  transition: transform 120ms ease;
}

.file-explorer__folder .file-explorer__chevron--open {
  transform: rotate(90deg);
}

.file-explorer__status {
  margin: auto;
  padding: var(--space-8);
  color: var(--color-text-muted);
  text-align: center;
}

.file-explorer__status--error {
  color: var(--color-error);
}
</style>
