<template>
  <div class="project-progress" role="status" :aria-label="t('projectOverview.progress.label')">
    <div class="project-progress__conveyor" aria-hidden="true">
      <span v-for="index in 5" :key="index" class="project-progress__stop" />
      <span v-for="index in 3" :key="`token-${index}`" class="project-progress__token" :style="{ animationDelay: `${(index - 1) * -1.2}s` }" />
    </div>
    <ol class="project-progress__steps">
      <li v-for="step in steps" :key="step.id" class="project-progress__step" :class="`project-progress__step--${step.state}`" :data-state="step.state">
        <CircleCheckIcon v-if="step.state === 'done'" class="project-progress__icon" :size="16" aria-hidden="true" />
        <LoaderIcon v-else-if="step.state === 'active'" class="project-progress__icon project-progress__icon--spin" :size="16" aria-hidden="true" />
        <span v-else class="project-progress__icon project-progress__icon--pending" aria-hidden="true" />
        <span>{{ step.text }}</span>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { projectOverviewSourcesReading, type ProjectOverviewLookback, type ProjectOverviewSources } from '@workspace/core/project-overview';
import { CircleCheckIcon, LoaderIcon } from '../shared/icons/app-icons';

const props = defineProps<{
  /** What the read found; null while the project is still being read. */
  read: { sources: ProjectOverviewSources; lookback: ProjectOverviewLookback } | null;
}>();
const { t } = useI18n();

type StepState = 'pending' | 'active' | 'done';

const connected = computed(() => {
  const sources = props.read?.sources;
  if (!sources) return '';
  const names = (['backlog', 'pullRequests', 'pipelines'] as const)
    .filter(source => sources[source] === 'available')
    .map(source => t(`projectOverview.progress.sources.${source}`));
  const [a, b, c] = names;
  return c ? t('projectOverview.progress.connectedThree', { a, b, c })
    : b ? t('projectOverview.progress.connectedTwo', { a, b })
      : a ? t('projectOverview.progress.connectedOne', { a }) : t('projectOverview.progress.repositoryOnly');
});

const steps = computed<{ id: string; state: StepState; text: string }[]>(() => {
  const read = props.read;
  // The repository is read first; it sets the period the tools are asked about. The narrative waits for every tool.
  if (!read) {
    return [
      { id: 'history', state: 'active', text: t('projectOverview.progress.history') },
      { id: 'sources', state: 'pending', text: t('projectOverview.progress.sourcesActive') },
      { id: 'flow', state: 'pending', text: t('projectOverview.progress.flow') },
      { id: 'narrative', state: 'pending', text: t('projectOverview.progress.narrative') },
    ];
  }
  const asking = projectOverviewSourcesReading(read.sources) > 0;
  return [
    { id: 'history', state: 'done', text: read.lookback.days === null ? t('projectOverview.progress.historyAll') : t('projectOverview.progress.historyDays', { days: read.lookback.days }) },
    asking ? { id: 'sources', state: 'active', text: t('projectOverview.progress.sourcesActive') } : { id: 'sources', state: 'done', text: connected.value },
    { id: 'flow', state: asking ? 'active' : 'done', text: t(asking ? 'projectOverview.progress.flow' : 'projectOverview.progress.flowDone') },
    { id: 'narrative', state: asking ? 'pending' : 'active', text: t('projectOverview.progress.narrative') },
  ];
});
</script>

<style scoped>
.project-progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-20);
  max-width: 420px;
}

/* Five stops with work moving between them: the flow being assembled. */
.project-progress__conveyor {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 14px;
}

.project-progress__conveyor::before {
  position: absolute;
  inset: 50% 0 auto;
  height: 1px;
  background: var(--color-border);
  content: '';
}

.project-progress__stop {
  position: relative;
  width: 10px;
  height: 10px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-full);
  background: var(--color-shell-main);
}

.project-progress__token {
  position: absolute;
  top: 50%;
  left: 0;
  width: 6px;
  height: 6px;
  margin-top: -3px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  animation: project-progress-travel 3.6s linear infinite;
}

@keyframes project-progress-travel {
  0% { left: 0; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { left: calc(100% - 6px); opacity: 0; }
}

.project-progress__steps {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-progress__step {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  transition: color 200ms ease;
}

.project-progress__step--active {
  color: var(--color-text);
}

.project-progress__step--done .project-progress__icon {
  color: var(--color-success);
}

.project-progress__icon {
  flex: none;
  width: 16px;
  height: 16px;
}

.project-progress__icon--spin {
  color: var(--color-primary);
  animation: app-spin 800ms linear infinite;
}

.project-progress__icon--pending {
  box-sizing: border-box;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-full);
}

@media (prefers-reduced-motion: reduce) {
  .project-progress__token,
  .project-progress__icon--spin {
    animation: none;
  }

  .project-progress__token {
    display: none;
  }
}
</style>
