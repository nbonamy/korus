<template>
  <main class="mobile-changes">
    <div v-if="kinds.length" class="mobile-changes__kinds" role="group" :aria-label="$t('mobileChanges.files')">
      <button
        v-for="kind in kinds" :key="kind" type="button"
        :aria-pressed="selectedKind === kind"
        :aria-label="`${fileKindLabel(kind)}: ${fileKindCount(byKind[kind].changedFiles)}, +${byKind[kind].addedLines}, -${byKind[kind].removedLines}`"
        :style="{ '--kind-color': fileKindColor[kind] }"
        @click="selectedKind = selectedKind === kind ? null : kind"
      >
        <span class="mobile-changes__kind-title"><i aria-hidden="true" />{{ fileKindLabel(kind) }}</span>
        <span class="mobile-changes__kind-stats">
          <span>{{ fileKindCount(byKind[kind].changedFiles) }}</span>
          <span class="mobile-changes__added">+{{ byKind[kind].addedLines }}</span>
          <span class="mobile-changes__removed">-{{ byKind[kind].removedLines }}</span>
        </span>
      </button>
    </div>
    <div class="mobile-changes__heading">
      <span>{{ $t('mobileChanges.files') }}</span>
      <button v-if="diff.trim()" type="button" @click="toggleAll">
        {{ $t(allExpanded ? 'mobileChanges.collapseAll' : 'mobileChanges.expandAll') }}
      </button>
    </div>
    <GitDiffPreviewPanel
      :diff="diff" :word-wrap="true" :file-kind-filter="selectedKind"
      :collapse-all-signal="collapseAll" :expand-all-signal="expandAll"
      @all-expanded-change="allExpanded = $event"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import GitDiffPreviewPanel from '@workspace/vue/components/GitDiffPreviewPanel.vue';
import { fileKinds, type FileKind } from '@workspace/core/file-kind';
import { summarizeUnifiedDiff } from '@workspace/core/unified-diff-stats';
import { fileKindColor, fileKindCount, fileKindLabel } from '@workspace/vue/components/file-kind-presentation';

const diff = ref('');
const selectedKind = ref<FileKind | null>(null);
const byKind = computed(() => summarizeUnifiedDiff(diff.value).byKind);
const kinds = computed(() => fileKinds.filter(kind => byKind.value[kind].changedFiles > 0));
const allExpanded = ref(true);
const collapseAll = ref(0);
const expandAll = ref(0);
function toggleAll() {
  if (allExpanded.value) collapseAll.value++;
  else expandAll.value++;
}
window.companionChanges = { setDiff(json: string) {
  const next = (JSON.parse(json) as { diff: string }).diff;
  if (next !== diff.value) selectedKind.value = null;
  diff.value = next;
} };
onBeforeUnmount(() => { delete window.companionChanges; });
</script>

<style>
html,
body,
#app {
  margin: 0;
  min-height: 100%;
  background: transparent;
}

.mobile-changes {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  height: 100%;
  padding: 0 20px 20px;
}

.mobile-changes__kinds {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0 8px;
}

.mobile-changes__kinds button {
  flex: 0 0 auto;
  min-height: 52px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mobile-changes__kinds button[aria-pressed="true"] {
  border-color: var(--kind-color);
  background: color-mix(in srgb, var(--kind-color) 12%, var(--color-surface-lowest));
}

.mobile-changes__kinds button:focus-visible {
  outline: 2px solid var(--color-primary);
}

.mobile-changes__kind-title,
.mobile-changes__kind-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.mobile-changes__kind-title {
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
}

.mobile-changes__kind-title i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--kind-color);
}

.mobile-changes__kind-stats {
  margin-top: 3px;
  font-size: var(--font-size-13);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.mobile-changes__added { color: var(--color-success); }
.mobile-changes__removed { color: var(--color-error); }

.mobile-changes__heading {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 0 16px;
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
}

.mobile-changes__heading button {
  min-height: 44px;
  padding: 0;
  border: 0;
  color: var(--color-primary);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.mobile-changes .git-diff-preview-panel {
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: var(--radius-2xl);
}

.mobile-changes .git-diff-preview-panel__file-header {
  min-height: 48px;
}
</style>
