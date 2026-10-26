<template>
  <div
    class="git-diff-control"
  >
    <button
      v-if="hasSelectedChanges"
      class="git-diff-control__open"
      type="button"
      :aria-label="$t('surface.agentHeader.openRepositoryDiff')"
      :title="selectedLabel"
      @click="emit('open', selectedTarget)"
    >
      <CodexAnimatedDiffStat
        v-if="selectedSummary.addedLines"
        kind="added"
        :label="$t('surface.agentHeader.addedLines')"
        :value="selectedSummary.addedLines"
      />
      <CodexAnimatedDiffStat
        v-if="selectedSummary.removedLines"
        kind="deleted"
        :label="$t('surface.agentHeader.removedLines')"
        :value="selectedSummary.removedLines"
      />
    </button>
    <span v-else class="git-diff-control__empty">{{ $t('surface.agentHeader.noChanges') }}</span>
    <AppMenuButton v-model:open="menuOpen" :ariaLabel="$t('surface.agentHeader.chooseRepositoryDiff')" :items="menuItems" :width="260" @select="selectTarget">
      <template #trigger="{ attrs }">
        <button
          v-bind="attrs"
          class="git-diff-control__menu-trigger"
          type="button"
          :aria-label="$t('surface.agentHeader.chooseRepositoryDiff')"
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </template>
    </AppMenuButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { AgentGitDiffSummary, AgentGitDiffTarget, AgentGitStatus, TurnGitDiff } from '@workspace/core/contracts';
import { CodexAnimatedDiffStat } from '@codex-app-sdk/vue';
import { ChevronDown, FileDiffIcon, GitBranchIcon, GitCommitIcon } from '../shared/icons/app-icons';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { translate } from '../i18n';
import { fileKinds, type FileKind } from '@workspace/core/file-kind';
import { summarizeUnifiedDiff } from '@workspace/core/unified-diff-stats';
import { fileKindColor, fileKindCount, fileKindLabel } from './file-kind-presentation';

const props = defineProps<{
  agentId: string;
  gitStatus: AgentGitStatus;
  lastTurnGitDiff?: TurnGitDiff | null;
  selectedTarget?: AgentGitDiffTarget | null;
}>();

const emit = defineEmits<{
  open: [target: AgentGitDiffTarget, focusKind?: FileKind];
  select: [target: AgentGitDiffTarget];
}>();

const menuOpen = ref(false);
const hasUserSelection = ref(Boolean(props.selectedTarget));
const selectedTarget = shallowRef<AgentGitDiffTarget>(selectedTargetForAgent());
const fallbackSummary = computed<AgentGitDiffSummary>(() => ({
  addedLines: props.gitStatus.addedLines,
  removedLines: props.gitStatus.removedLines,
  changedFiles: props.gitStatus.changedFiles,
}));
const selectedSummary = computed(() => summaryFor(selectedTarget.value));
const hasSelectedChanges = computed(() => selectedSummary.value.addedLines > 0 || selectedSummary.value.removedLines > 0);
const selectedLabel = computed(() => selectedLabelFor(selectedTarget.value));
const menuItems = computed<AppMenuItem[]>(() => {
  const catalog = props.gitStatus.diffCatalog;
  const targets: AgentGitDiffTarget[] = [
    ...(catalog?.branch ? [{ type: 'branch' as const, baseRef: catalog.branch.baseRef }] : []),
    { type: 'uncommitted' },
    { type: 'unstaged' },
    { type: 'staged' },
    ...(props.lastTurnGitDiff?.diff ? [{ type: 'turn' as const, turnId: props.lastTurnGitDiff.turnId }] : []),
  ];
  const items: AppMenuItem[] = targets.map((target) => {
    const checked = targetId(selectedTarget.value) === targetId(target);
    return {
      id: targetId(target),
      type: 'radio',
      label: labelFor(target),
      ...(target.type === 'branch' && target.baseRef ? { description: target.baseRef } : {}),
      icon: target.type === 'branch' ? GitBranchIcon : target.type === 'turn' ? GitCommitIcon : FileDiffIcon,
      checked,
      value: summaryFor(target),
    };
  });
  const commits = catalog?.commits ?? [];
  if (commits.length > 0) {
    items.push({ id: 'separator-commits', type: 'separator' });
    items.push({
      id: 'commits',
      type: 'submenu',
      label: translate('surface.agentHeader.commits'),
      icon: GitCommitIcon,
      submenuWidth: 'wide',
      items: commits.map((commit) => {
        const checked = selectedTarget.value.type === 'commit' && selectedTarget.value.sha === commit.sha;
        return {
          id: `commit:${commit.sha}`,
          type: 'radio',
          label: commit.subject,
          description: commit.shortSha,
          icon: GitCommitIcon,
          checked,
          value: commit,
        };
      }),
    });
  }
  const kinds = kindMenuItems(summaryFor(selectedTarget.value));
  if (kinds.length > 0) items.push({ id: 'separator-kinds', type: 'separator' }, ...kinds);
  return items;
});

/** What the selected diff is made of, from the file types the daemon worked out. */
function kindMenuItems(summary: AgentGitDiffSummary): AppMenuItem[] {
  const rows = fileKinds
    .map(kind => ({ kind, stats: summary.byKind?.[kind] }))
    .filter(({ stats }) => stats && stats.changedFiles > 0);
  if (rows.length === 0) return [];
  return [
    { id: 'kinds-heading', type: 'info', label: translate('surface.agentHeader.changesByType') },
    ...rows.map(({ kind, stats }) => ({
      id: `kind:${kind}`,
      type: 'action' as const,
      label: fileKindLabel(kind),
      description: fileKindCount(stats!.changedFiles),
      value: { addedLines: stats!.addedLines, removedLines: stats!.removedLines },
      leadingColor: fileKindColor[kind],
    })),
  ];
}

watch([() => props.agentId, () => props.selectedTarget], ([, target]) => {
  hasUserSelection.value = Boolean(target);
  selectedTarget.value = target ? { ...target } : defaultTarget();
  menuOpen.value = false;
}, { deep: true });

watch(() => props.gitStatus.diffCatalog, (catalog) => {
  if (!catalog) return;
  const selected = selectedTarget.value;
  const selectionUnavailable = selected.type === 'branch'
    ? !catalog.branch
    : selected.type === 'commit'
      ? !catalog.commits.some((commit) => commit.sha === selected.sha)
      : false;
  if (!hasUserSelection.value || selectionUnavailable) {
    hasUserSelection.value = false;
    selectedTarget.value = defaultTarget();
  }
});

function defaultTarget(): AgentGitDiffTarget {
  return { type: 'uncommitted' };
}

function selectedTargetForAgent(): AgentGitDiffTarget {
  return props.selectedTarget ? { ...props.selectedTarget } : defaultTarget();
}

function selectTarget(itemId: string): void {
  if (itemId.startsWith('kind:')) {
    menuOpen.value = false;
    emit('open', { ...selectedTarget.value }, itemId.slice('kind:'.length) as FileKind);
    return;
  }
  const target = targetFromId(itemId);
  if (!target) return;
  hasUserSelection.value = true;
  selectedTarget.value = target;
  emit('select', { ...target });
}

function targetFromId(id: string): AgentGitDiffTarget | null {
  if (id === 'branch') return props.gitStatus.diffCatalog?.branch
    ? { type: 'branch', baseRef: props.gitStatus.diffCatalog.branch.baseRef }
    : null;
  if (id === 'uncommitted' || id === 'unstaged' || id === 'staged') return { type: id };
  if (id === 'turn' && props.lastTurnGitDiff) return { type: 'turn', turnId: props.lastTurnGitDiff.turnId };
  if (id.startsWith('commit:')) return { type: 'commit', sha: id.slice('commit:'.length) };
  return null;
}

function targetId(target: AgentGitDiffTarget): string {
  return target.type === 'commit' ? `commit:${target.sha}` : target.type;
}

function labelFor(target: AgentGitDiffTarget): string {
  switch (target.type) {
    case 'branch': return translate('surface.agentHeader.branchChanges');
    case 'uncommitted': return translate('surface.agentHeader.uncommittedChanges');
    case 'unstaged': return translate('surface.agentHeader.unstagedChanges');
    case 'staged': return translate('surface.agentHeader.stagedChanges');
    case 'turn': return translate('surface.agentHeader.lastTurnChanges');
    case 'commit': return props.gitStatus.diffCatalog?.commits.find((commit) => commit.sha === target.sha)?.shortSha ?? target.sha.slice(0, 8);
  }
}

function selectedLabelFor(target: AgentGitDiffTarget): string {
  if (target.type !== 'branch' || !target.baseRef) return labelFor(target);
  const branch = target.baseRef
    .replace(/^refs\/remotes\/[^/]+\//u, '')
    .replace(/^(?:origin|upstream)\//u, '');
  return translate('surface.agentHeader.changesVsBranch', { branch });
}

/** The turn records its diff text; the file count and file types come from that text. */
function turnSummary(turn: TurnGitDiff): AgentGitDiffSummary {
  const { changedFiles, byKind } = summarizeUnifiedDiff(turn.diff ?? '');
  return { addedLines: turn.addedLines, removedLines: turn.removedLines, changedFiles, byKind };
}

function summaryFor(target: AgentGitDiffTarget): AgentGitDiffSummary {
  const catalog = props.gitStatus.diffCatalog;
  if (target.type === 'branch') return catalog?.branch ?? fallbackSummary.value;
  if (target.type === 'uncommitted') return catalog?.uncommitted ?? fallbackSummary.value;
  if (target.type === 'unstaged') return catalog?.unstaged ?? fallbackSummary.value;
  if (target.type === 'staged') return catalog?.staged ?? fallbackSummary.value;
  if (target.type === 'turn') return props.lastTurnGitDiff ? turnSummary(props.lastTurnGitDiff) : fallbackSummary.value;
  return catalog?.commits.find((commit) => commit.sha === target.sha) ?? fallbackSummary.value;
}
</script>

<style scoped>
.git-diff-control {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
  -webkit-app-region: no-drag;
}

.git-diff-control button {
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.git-diff-control button:hover {
  background: var(--color-surface-high);
  color: var(--color-text);
}

.git-diff-control__open,
.git-diff-control__empty {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-6);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
}

.git-diff-control__empty {
  color: var(--color-text-muted);
  white-space: nowrap;
}

.git-diff-control__menu-trigger {
  display: grid;
  place-items: center;
  width: 24px;
  padding: 0;
  border-left: 1px solid var(--color-border) !important;
  border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
}

.git-diff-control__menu-trigger svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

</style>
