<template>
  <section class="mission-review-changes" :aria-label="t('missions.changesTab')">
    <header class="mission-review-changes__header">
      <el-select
        v-if="repositories.length"
        v-model="selectedRepositoryPath"
        :aria-label="t('missions.reviewRepository')"
      >
        <el-option
          v-for="repository in repositories"
          :key="repository.repositoryPath"
          :value="repository.repositoryPath"
          :label="repositoryLabel(repository.repositoryPath)"
        />
      </el-select>
      <el-select v-model="target" :aria-label="t('missions.diffScope')">
        <el-option value="branch" :label="t('missions.branchDiff')" />
        <el-option value="uncommitted" :label="t('missions.uncommittedDiff')" />
      </el-select>
      <MissionWorkspaceOpenIn
        v-if="selectedRepository?.workspacePath && selectedRepository.agent"
        :agent="selectedRepository.agent"
        :available="openInAvailable"
        :catalog="openInApplications"
        show-unavailable
        :workspace-path="selectedRepository.workspacePath"
        @open="emit('open-worktree', $event)"
      />
      <button
        class="mission-review-changes__refresh mission-review-changes__group"
        type="button"
        :aria-label="t('missions.groupByFileType')"
        :title="t('missions.groupByFileType')"
        :aria-pressed="groupByKind"
        @click="groupByKind = !groupByKind"
      >
        <FolderIcon aria-hidden="true" />
      </button>
      <button
        class="mission-review-changes__refresh"
        type="button"
        :aria-label="t('missions.refreshDiff')"
        :title="t('missions.refreshDiff')"
        @click="refresh"
      >
        <RefreshIcon aria-hidden="true" />
      </button>
    </header>
    <GitDiffPreviewPanel :diff="diff" :state="state" :error="error" :group-by-kind="groupByKind" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, AgentGitDiff, AgentGitDiffTarget, AgentGitStatus, OpenInApplicationCatalog } from '@workspace/core/contracts';
import type { Mission } from '@workspace/core/missions';
import { FolderIcon, RefreshIcon } from '../shared/icons/app-icons';
import GitDiffPreviewPanel from './GitDiffPreviewPanel.vue';
import MissionWorkspaceOpenIn, { type MissionWorkspaceOpenRequest } from './MissionWorkspaceOpenIn.vue';

const props = withDefaults(defineProps<{
  active?: boolean;
  agent: Agent;
  agents?: Agent[];
  baseSha?: string;
  gitStatus?: AgentGitStatus | null;
  gitStatuses?: Record<string, AgentGitStatus>;
  getDiff: (agentId: string, target?: AgentGitDiffTarget) => Promise<AgentGitDiff>;
  mission?: Mission;
  openInAvailable?: boolean;
  openInApplications?: OpenInApplicationCatalog;
  workspacePath?: string;
}>(), {
  active: true,
  agents: () => [],
  gitStatuses: () => ({}),
  openInApplications: () => ({ defaultApplication: 'finder', applications: [] }),
});

const emit = defineEmits<{ 'open-worktree': [request: MissionWorkspaceOpenRequest] }>();
const { t } = useI18n();
const target = ref<'branch' | 'uncommitted'>('branch');
const groupByKind = ref(true);
const selectedRepositoryPath = ref('');
const diff = ref('');
const state = ref<'idle' | 'loading' | 'error'>('idle');
const error = ref<string | null>(null);
let request = 0;

const repositories = computed(() => {
  const workspaces = props.mission?.execution?.workspaces ?? [];
  if (!workspaces.length) {
    return [{
      repositoryPath: props.workspacePath ?? props.agent.folder ?? props.agent.name ?? props.agent.id,
      workspacePath: props.workspacePath ?? props.agent.folder ?? undefined,
      baseSha: props.baseSha,
      agent: props.agent,
      gitStatus: props.gitStatus,
    }];
  }
  return workspaces.map(workspace => {
    const run = props.mission?.execution?.runs.slice().reverse().find(candidate => (
      candidate.stage === 'implementation'
      && candidate.repositoryPath === workspace.repositoryPath
      && candidate.workerId
    ));
    const agent = props.agents.find(candidate => candidate.id === run?.workerId);
    return {
      repositoryPath: workspace.repositoryPath,
      workspacePath: workspace.path,
      baseSha: workspace.baseSha,
      agent,
      gitStatus: agent ? props.gitStatuses[agent.id] : undefined,
    };
  });
});
const selectedRepository = computed(() => (
  repositories.value.find(repository => repository.repositoryPath === selectedRepositoryPath.value)
  ?? repositories.value[0]
));

async function refresh(): Promise<void> {
  const current = ++request;
  const repository = selectedRepository.value;
  if (!repository?.agent) {
    diff.value = '';
    error.value = t('missions.reviewRepositoryAgentUnavailable');
    state.value = 'error';
    return;
  }
  state.value = 'loading';
  error.value = null;
  try {
    const result = await props.getDiff(
      repository.agent.id,
      target.value === 'branch'
        ? { type: 'branch', ...(repository.baseSha ? { baseRef: repository.baseSha } : {}) }
        : { type: 'uncommitted' },
    );
    if (current !== request) return;
    diff.value = result.diff;
    state.value = 'idle';
  } catch (cause) {
    if (current !== request) return;
    error.value = cause instanceof Error ? cause.message : String(cause);
    state.value = 'error';
  }
}

function repositoryLabel(repositoryPath: string): string {
  return repositoryPath.split('/').filter(Boolean).at(-1) ?? repositoryPath;
}

watch(repositories, available => {
  if (!available.some(repository => repository.repositoryPath === selectedRepositoryPath.value)) {
    selectedRepositoryPath.value = available[0]?.repositoryPath ?? '';
  }
}, { immediate: true });
watch(
  () => [
    props.active,
    selectedRepositoryPath.value,
    selectedRepository.value?.agent?.id,
    selectedRepository.value?.gitStatus?.updatedAt,
    target.value,
  ] as const,
  ([active]) => {
    if (active) void refresh();
  },
  { immediate: true },
);
</script>

<style scoped>
.mission-review-changes {
  display: grid;
  gap: var(--space-4);
}

.mission-review-changes__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.mission-review-changes__header .el-select {
  width: 200px;
}

.mission-review-changes__refresh {
  display: grid;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  place-items: center;
  color: var(--color-text);
  background: var(--color-surface);
  cursor: pointer;
}

.mission-review-changes__refresh:hover,
.mission-review-changes__refresh:focus-visible {
  background: var(--color-surface-low);
}

.mission-review-changes__group[aria-pressed='false'] {
  color: var(--color-text-muted);
  background: transparent;
}

.mission-review-changes__refresh svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
