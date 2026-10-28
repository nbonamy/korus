<template>
  <section class="git-review-panel" :aria-label="$t('surface.rightWorkspacePanel.changes')">
    <header class="git-review-panel__toolbar">
      <div class="git-review-panel__summary">
        <div class="git-review-panel__repository">
          <component :is="gitStatus?.repositoryProvider === 'gitlab' ? GitLabIcon : GitHubIcon" aria-hidden="true" />
          <strong>{{ repositoryName }}</strong>
        </div>
        <div class="git-review-panel__branch">
          <span>{{ gitStatus?.branch ?? $t('surface.gitReviewPanel.workingTree') }}</span>
          <span v-if="gitStatus?.upstream" aria-hidden="true">→</span>
          <span v-if="gitStatus?.upstream" class="git-review-panel__upstream">{{ gitStatus.upstream }}</span>
        </div>
      </div>

      <div class="git-review-panel__stats" :aria-label="$t('surface.gitReviewPanel.diffStatistics')">
        <span class="git-review-panel__added">+{{ displayedSummary.addedLines }}</span>
        <span class="git-review-panel__removed">-{{ displayedSummary.removedLines }}</span>
      </div>

      <div class="git-review-panel__actions">
        <button type="button" :aria-label="$t('surface.gitReviewPanel.refreshRepositoryDiff')" :title="$t('surface.gitReviewPanel.refresh')" @click="emit('refresh')">
          <RefreshIcon aria-hidden="true" />
        </button>
        <AppMenuButton :ariaLabel="$t('surface.gitReviewPanel.reviewOptions')" :items="menuItems" @select="selectMenuItem">
          <template #trigger="{ attrs }">
            <button
              v-bind="attrs"
              type="button"
              :aria-label="$t('surface.gitReviewPanel.reviewOptions')"
              :title="$t('surface.gitReviewPanel.reviewOptions')"
            >
              <DotsVerticalIcon aria-hidden="true" />
            </button>
          </template>
        </AppMenuButton>
      </div>
    </header>

    <GitDiffPreviewPanel
      :collapse-all-signal="collapseAllSignal"
      :diff="visibleDiff"
      :error="panel.error"
      :expand-all-signal="expandAllSignal"
      :focus-kind="panel.focusKind"
      :focus-sequence="panel.focusSequence"
      :group-by-kind="groupByKind"
      annotatable
      open-file-enabled
      :state="panel.state"
      :word-wrap="wordWrap"
      @all-expanded-change="allExpanded = $event"
      @open-file="emit('openFile', $event)"
      @annotate="emit('annotate', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, ref, watch } from 'vue';
import type { Agent, AgentGitDiffScope, AgentGitStatus } from '@workspace/core/contracts';
import { DotsVerticalIcon, FileDiffIcon, FolderIcon, FileTextIcon, GitCommitIcon, GitHubIcon, GitLabIcon, ListDetailsIcon, RefreshIcon, TextWrapDisabledIcon, TextWrapIcon } from '../shared/icons/app-icons';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { CodeAnnotationInput } from './use-code-annotations';
import type { AppMenuItem } from '../shared/menu/app-menu';
import GitDiffPreviewPanel from './GitDiffPreviewPanel.vue';
import type { SidePanelGitDiffState } from './side-panel';

const props = defineProps<{
  agent: Agent;
  gitStatus?: AgentGitStatus | null;
  panel: SidePanelGitDiffState;
}>();

const emit = defineEmits<{
  openFile: [filePath: string];
  refresh: [];
  annotate: [annotation: CodeAnnotationInput];
}>();

const wordWrap = ref(false);
const groupByKind = ref(true);
// A file type request only makes sense with the groups showing.
watch(() => props.panel.focusSequence, (sequence) => { if (sequence) groupByKind.value = true; }, { immediate: true });
const allExpanded = ref(true);
const expandAllSignal = ref(0);
const collapseAllSignal = ref(0);
const visibleScopes = ref<Record<AgentGitDiffScope, boolean>>({
  staged: true,
  unstaged: true,
  untracked: true,
});
const repositoryName = computed(() => fileBasename(props.gitStatus?.folder ?? props.agent.folder ?? ''));
const displayedSummary = computed(() => props.panel.summary ?? {
  addedLines: props.gitStatus?.addedLines ?? 0,
  removedLines: props.gitStatus?.removedLines ?? 0,
  changedFiles: props.gitStatus?.changedFiles ?? 0,
});
const visibleDiff = computed(() => {
  if (!props.panel.sections?.length) return props.panel.diff;
  return props.panel.sections
    .filter((section) => visibleScopes.value[section.scope] && section.diff.trim())
    .map((section) => section.diff.trimEnd())
    .join('\n');
});
const sectionMenuItems = computed<AppMenuItem[]>(() => {
  if (!props.panel.sections) return [];
  const labels: Record<AgentGitDiffScope, string> = {
    staged: translate('dynamic.misc.stagedChanges'),
    unstaged: translate('dynamic.misc.unstagedChanges'),
    untracked: translate('dynamic.misc.untrackedFiles'),
  };
  const icons = {
    staged: GitCommitIcon,
    unstaged: FileDiffIcon,
    untracked: FileTextIcon,
  };
  return props.panel.sections.map((section) => ({
    id: `scope-${section.scope}`,
    type: 'checkbox' as const,
    label: labels[section.scope],
    icon: icons[section.scope],
    checked: visibleScopes.value[section.scope],
    disabled: !section.diff.trim(),
  }));
});
const menuItems = computed<AppMenuItem[]>(() => [
  ...sectionMenuItems.value,
  ...(sectionMenuItems.value.length ? [{ id: 'scope-separator', type: 'separator' as const }] : []),
  {
    id: 'group-by-kind',
    type: 'checkbox',
    label: translate('surface.gitReviewPanel.groupByFileType'),
    icon: FolderIcon,
    checked: groupByKind.value,
  },
  {
    id: 'word-wrap',
    type: 'checkbox',
    label: translate('surface.gitReviewPanel.wordWrap'),
    icon: wordWrap.value ? TextWrapIcon : TextWrapDisabledIcon,
    checked: wordWrap.value,
  },
  {
    id: allExpanded.value ? 'collapse-all' : 'expand-all',
    type: 'action',
    label: allExpanded.value ? translate('surface.gitReviewPanel.collapseAll') : translate('surface.gitReviewPanel.expandAll'),
    icon: ListDetailsIcon,
  },
]);

function selectMenuItem(itemId: string): void {
  if (itemId.startsWith('scope-')) {
    const scope = itemId.slice('scope-'.length) as AgentGitDiffScope;
    if (scope === 'staged' || scope === 'unstaged' || scope === 'untracked') {
      visibleScopes.value[scope] = !visibleScopes.value[scope];
    }
  } else if (itemId === 'group-by-kind') {
    groupByKind.value = !groupByKind.value;
  } else if (itemId === 'word-wrap') {
    wordWrap.value = !wordWrap.value;
  } else if (itemId === 'expand-all') {
    expandAllSignal.value += 1;
  } else if (itemId === 'collapse-all') {
    collapseAllSignal.value += 1;
  }
}

function fileBasename(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.at(-1) ?? path;
}

</script>

<style scoped>
.git-review-panel {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-lowest);
}

.git-review-panel__toolbar {
  min-height: 56px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-4) var(--space-8);
  border-bottom: 1px solid var(--color-border);
}

.git-review-panel__summary {
  min-width: 0;
  display: grid;
  gap: var(--space-1);
}

.git-review-panel__repository,
.git-review-panel__branch,
.git-review-panel__stats,
.git-review-panel__actions {
  display: flex;
  align-items: center;
}

.git-review-panel__repository {
  gap: var(--space-3);
  min-width: 0;
}

.git-review-panel__repository svg {
  flex: 0 0 auto;
  width: var(--icon-md);
  height: var(--icon-md);
}

.git-review-panel__repository strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
}

.git-review-panel__branch {
  gap: var(--space-2);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: var(--line-height-16);
  white-space: nowrap;
}

.git-review-panel__upstream {
  overflow: hidden;
  text-overflow: ellipsis;
}

.git-review-panel__stats {
  gap: var(--space-2);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-13);
}

.git-review-panel__added {
  color: var(--color-success);
}

.git-review-panel__removed {
  color: var(--color-error);
}

.git-review-panel__actions {
  position: relative;
  gap: var(--space-1);
}

.git-review-panel__actions button {
  display: grid;
  place-items: center;
  width: var(--space-12);
  height: var(--space-12);
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.git-review-panel__actions button:hover,
.git-review-panel__actions button[aria-expanded="true"] {
  color: var(--color-text);
  background: var(--color-surface-low);
}

.git-review-panel__actions svg {
  width: var(--icon-md);
  height: var(--icon-md);
}
</style>
