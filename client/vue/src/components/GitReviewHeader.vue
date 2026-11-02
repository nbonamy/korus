<template>
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
        <span class="git-review-panel__added">+{{ summary.addedLines }}</span>
        <span class="git-review-panel__removed">-{{ summary.removedLines }}</span>
      </div>

      <div class="git-review-panel__controls">
        <GitDiffViewToggle :model-value="view" @update:model-value="emit('update:view', $event)" />
      <div class="git-review-panel__actions">
        <button type="button" :aria-label="$t('surface.gitReviewPanel.refreshRepositoryDiff')" :title="$t('surface.gitReviewPanel.refresh')" @click="emit('refresh')">
          <RefreshIcon aria-hidden="true" />
        </button>
        <AppMenuButton :ariaLabel="$t('surface.gitReviewPanel.reviewOptions')" :items="menuItems" @select="emit('selectMenuItem', $event)">
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
      </div>
    </header>
</template>

<script setup lang="ts">
import type { AgentGitStatus } from '@workspace/core/contracts';
import { DotsVerticalIcon, GitHubIcon, GitLabIcon, RefreshIcon } from '../shared/icons/app-icons';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import GitDiffViewToggle from './GitDiffViewToggle.vue';
defineProps<{ repositoryName: string; gitStatus?: AgentGitStatus | null; summary: { addedLines: number; removedLines: number }; menuItems: AppMenuItem[]; view: 'diff' | 'map' }>();
const emit = defineEmits<{ refresh: []; selectMenuItem: [id: string]; 'update:view': [view: 'diff' | 'map'] }>();
</script>

<style scoped>
.git-review-panel__toolbar {
  display: flex;
  flex-wrap: wrap;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-4) var(--space-6);
  min-height: 56px;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border);
}
.git-review-panel__controls { display: flex; align-items: center; gap: var(--space-4); margin-left: auto; }

.git-review-panel__summary {
  flex: 1 1 100px;
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
  font-size: var(--font-size-12);
  line-height: var(--line-height-16);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
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
