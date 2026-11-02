<template>
  <section class="git-review-panel" :aria-label="$t('surface.rightWorkspacePanel.changes')">
    <GitReviewHeader v-model:view="view" :repository-name="repositoryName" :git-status="gitStatus"
      :summary="displayedSummary" :menu-items="menuItems" @refresh="emit('refresh')" @select-menu-item="selectMenuItem" />

    <GitDiffPreviewPanel
      v-model:view="view"
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
import { FileDiffIcon, FolderIcon, FileTextIcon, GitCommitIcon, ListDetailsIcon, TextWrapDisabledIcon, TextWrapIcon } from '../shared/icons/app-icons';
import GitReviewHeader from './GitReviewHeader.vue';
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

const view = ref<'diff' | 'map'>('diff');
const wordWrap = ref(false);
const groupByKind = ref(true);
// A file type request only makes sense with the groups showing.
watch(() => props.panel.focusSequence, (sequence) => { if (sequence) { groupByKind.value = true; view.value = 'diff'; } }, { immediate: true });
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

</style>
