<template>
  <section class="project-narrative" :aria-label="t('projectOverview.narrative.heading')">
    <template v-if="narrative">
      <p class="project-narrative__lead">
        <template v-if="leadParts"><strong class="project-narrative__name">{{ leadParts.name }}</strong>{{ leadParts.rest }}</template>
        <template v-else>{{ narrative.lead }}</template>
      </p>
      <ul class="project-narrative__workstreams">
        <li v-for="workstream in narrative.workstreams" :key="workstream.id" class="project-narrative__workstream" :data-workstream="workstream.id">
          <h2 class="project-narrative__title">
            <span :class="projectMarkClass(workstream.id, narrative)" aria-hidden="true" />
            <span>{{ workstream.name }}</span>
            <span class="project-narrative__state">{{ t(stateKeys[workstream.state]) }}</span>
          </h2>
          <p class="project-narrative__analysis">{{ workstream.analysis }}</p>
          <p class="project-narrative__basis">{{ t('projectOverview.narrative.basis', { basis: workstream.basis.join(', ') }) }}</p>
        </li>
      </ul>
      <p class="project-narrative__provenance">
        <span class="project-narrative__period">{{ period }}</span>
        <span>{{ t(repositoryOnly ? 'projectOverview.narrative.writtenByCode' : 'projectOverview.narrative.writtenBy', { engine: narrative.writtenBy, age }) }}</span>
        <span v-if="writing" role="status" class="project-narrative__updating">{{ t('projectOverview.narrative.updating') }}</span>
      </p>
    </template>
    <ProjectOverviewProgress v-else-if="state.status !== 'unavailable'" :read="{ sources, lookback }" />
    <p v-else class="project-narrative__empty" role="status">{{ t(emptyKey) }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { projectNarrativeLeadParts, type ProjectNarrativeState, type ProjectOverviewLookback, type ProjectOverviewSources } from '@workspace/core/project-overview';
import { formatCompactAge } from '../shared/compact-age';
import { projectMarkClass } from './project-overview-presentation';
import ProjectOverviewProgress from './ProjectOverviewProgress.vue';

const props = defineProps<{
  state: ProjectNarrativeState;
  /** A rewrite is in flight; the previous text stays in place meanwhile. */
  writing: boolean;
  repositoryOnly: boolean;
  /** The period the narrative was written from, chosen by the daemon from the project's activity. */
  lookback: ProjectOverviewLookback;
  /** What was reached while reading, named while the narrative is first written. */
  sources: ProjectOverviewSources;
  /** The repository's name, which the lead opens with and shows in bold. */
  project: string;
  now: number;
}>();
const { t } = useI18n();

const stateKeys = {
  starting: 'projectOverview.states.starting', moving: 'projectOverview.states.moving', settling: 'projectOverview.states.settling',
  recurring: 'projectOverview.states.recurring', waiting: 'projectOverview.states.waiting', stalled: 'projectOverview.states.stalled',
} as const;
const narrative = computed(() => props.state.status === 'fresh' || props.state.status === 'stale' ? props.state.narrative : null);
const leadParts = computed(() => narrative.value ? projectNarrativeLeadParts(narrative.value.lead, props.project) : null);
const period = computed(() => props.lookback.days === null
  ? t('projectOverview.narrative.periodAll', { date: new Date(props.lookback.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) })
  : t('projectOverview.narrative.periodDays', { days: props.lookback.days }));
const age = computed(() => formatCompactAge(narrative.value?.writtenAt, props.now, t('projectOverview.justNow')));
const emptyKey = computed(() => {
  const reason = props.state.status === 'unavailable' ? props.state.reason : null;
  return reason === 'noEngine' ? 'projectOverview.narrative.noEngine' : reason === 'quiet' ? 'projectOverview.narrative.quiet' : 'projectOverview.narrative.failed';
});
</script>

<style scoped>
.project-narrative {
  display: flex;
  flex-direction: column;
  gap: var(--space-20);
}

.project-narrative__name {
  font-weight: var(--font-weight-bold);
}

.project-narrative__lead {
  max-width: 880px;
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-24);
  font-weight: var(--font-weight-medium);
  line-height: 1.35;
}

.project-narrative__workstreams {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-narrative__workstream {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 880px;
  min-width: 0;
}

.project-narrative__title {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin: 0;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
}

.project-narrative__state {
  padding: 0 var(--space-6);
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: var(--color-surface-base);
  font-size: var(--font-size-11);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-18);
}

.project-narrative__basis,
.project-narrative__provenance,
.project-narrative__empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-regular);
}

.project-narrative__analysis,
.project-narrative__basis,
.project-narrative__provenance,
.project-narrative__empty {
  margin: 0;
}

.project-narrative__analysis {
  font-size: var(--font-size-14);
  line-height: 1.5;
}

.project-narrative__provenance {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
}

.project-narrative__period::after {
  margin-left: var(--space-8);
  content: '·';
}

.project-narrative__empty {
  font-size: var(--font-size-14);
}
</style>
