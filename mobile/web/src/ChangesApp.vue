<template>
  <main class="mobile-changes">
    <div class="mobile-changes__heading">
      <span>{{ $t('mobileChanges.files') }}</span>
      <button v-if="diff.trim()" type="button" @click="toggleAll">
        {{ $t(allExpanded ? 'mobileChanges.collapseAll' : 'mobileChanges.expandAll') }}
      </button>
    </div>
    <GitDiffPreviewPanel
      :diff="diff" :word-wrap="true"
      :collapse-all-signal="collapseAll" :expand-all-signal="expandAll"
      @all-expanded-change="allExpanded = $event"
    />
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import GitDiffPreviewPanel from '@workspace/vue/components/GitDiffPreviewPanel.vue';

const diff = ref('');
const allExpanded = ref(true);
const collapseAll = ref(0);
const expandAll = ref(0);
function toggleAll() {
  if (allExpanded.value) collapseAll.value++;
  else expandAll.value++;
}
window.companionChanges = { setDiff(json: string) { diff.value = (JSON.parse(json) as { diff: string }).diff; } };
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
