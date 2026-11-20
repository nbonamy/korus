<template>
  <section class="project-overview" :aria-label="t('projectOverview.open')" :aria-busy="!overview && !failed">
    <WorkspaceHeader class="project-overview__header" :sidebar-collapsed="sidebarCollapsed">
      <SidebarExpandButton v-if="sidebarCollapsed" :label="t('surface.agentHeader.showAgentSidebar')" @click="emit('expand-sidebar')" />
      <h1 class="workspace-header__title">{{ overview?.repository.name ?? t('projectOverview.open') }}</h1>
      <span v-if="overview" class="project-overview__subtitle">{{ t('projectOverview.open') }}</span>
      <span v-if="overview" class="project-overview__live">
        <span class="project-overview__live-dot" aria-hidden="true" />
        <span>{{ liveLabel }}</span>
      </span>
    </WorkspaceHeader>
    <div class="project-overview__body">
      <p v-if="failed" class="project-overview__state" role="alert">{{ t('projectOverview.failed') }}</p>
      <template v-else-if="!overview">
        <ProjectOverviewProgress :read="null" />
        <ProjectOverviewFlow :flow="reading" :narrative="null" :tool-links="{}" :sources="null" />
      </template>
      <p v-else-if="overview.sources.git === 'unavailable'" class="project-overview__state">{{ t('projectOverview.noRepository') }}</p>
      <template v-else>
        <ProjectOverviewNarrative :state="overview.narrative" :writing="writing" :repository-only="repositoryOnly" :lookback="overview.lookback" :sources="overview.sources" :project="overview.repository.name" :now="now" />
        <ProjectOverviewFlow :flow="overview.flow" :narrative="narrative" :tool-links="overview.toolLinks" :sources="overview.sources" @select-agent="emit('select-agent', $event)" />
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { projectFlowReading } from '@workspace/core/project-overview';
import { formatCompactAge } from '../shared/compact-age';
import SidebarExpandButton from '../shared/SidebarExpandButton.vue';
import WorkspaceHeader from '../shared/WorkspaceHeader.vue';
import ProjectOverviewFlow from './ProjectOverviewFlow.vue';
import ProjectOverviewNarrative from './ProjectOverviewNarrative.vue';
import ProjectOverviewProgress from './ProjectOverviewProgress.vue';
import { useProjectOverview, type ProjectOverviewReads } from './use-project-overview';
import './project-overview-marks.css';

const props = defineProps<{
  /** Any agent of the repository; the daemon that owns it reads the project. */
  agentId: string;
  /** Changes when agents of the workspace change status, to refresh the flow soon after. */
  activityKey: string;
  sidebarCollapsed?: boolean;
  /** Scripted reads for a debug preview; the project is read through the app otherwise. */
  reads?: ProjectOverviewReads;
}>();
const emit = defineEmits<{ 'expand-sidebar': []; 'select-agent': [agentId: string] }>();
const { t } = useI18n();
const { overview, failed, writing, now } = useProjectOverview(() => props.agentId, () => props.activityKey, props.reads);

const reading = projectFlowReading();
const narrative = computed(() => {
  const state = overview.value?.narrative;
  return state && (state.status === 'fresh' || state.status === 'stale') ? state.narrative : null;
});
const repositoryOnly = computed(() => overview.value?.sources.backlog !== 'available');
const liveLabel = computed(() => {
  const age = formatCompactAge(overview.value?.generatedAt, now.value, '');
  const live = age ? t('projectOverview.liveAgo', { age }) : t('projectOverview.live', { age: t('projectOverview.justNow') });
  const sources = overview.value?.sources;
  return sources && sources.backlog !== 'available' && sources.pullRequests !== 'available' ? `${live} · ${t('projectOverview.repositoryOnly')}` : live;
});
</script>

<style scoped>
.project-overview {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-shell-main);
  color: var(--color-text);
}

.project-overview__subtitle,
.project-overview__live {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.project-overview__live {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin-left: auto;
  padding-right: var(--space-12);
}

.project-overview__live-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--color-success);
}

.project-overview__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-32);
  box-sizing: border-box;
  width: 100%;
  max-width: 1120px;
  min-height: 0;
  margin: 0 auto;
  padding: var(--space-32);
  overflow-y: auto;
}

.project-overview__state {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
}
</style>
