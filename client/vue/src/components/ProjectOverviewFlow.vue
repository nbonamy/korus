<template>
  <section class="project-flow" :aria-label="t('projectOverview.flow.heading')">
    <header class="project-flow__header">
      <h2 class="project-flow__heading">{{ t('projectOverview.flow.heading') }}</h2>
      <ul v-if="legend.workstreamIds.length || legend.other" class="project-flow__legend">
        <li v-for="id in legend.workstreamIds" :key="id">
          <span :class="projectMarkClass(id, narrative)" aria-hidden="true" />{{ workstreamName(id) }}
        </li>
        <li v-if="legend.other"><span class="project-mark project-mark--other" aria-hidden="true" />{{ t('projectOverview.flow.otherWork') }}</li>
      </ul>
    </header>
    <div class="project-flow__scroll">
      <ol class="project-flow__line">
        <li
          v-for="(station, index) in flow.stations"
          :key="station.kind"
          class="project-flow__step"
          :class="{ 'project-flow__step--first': index === 0 }"
        >
          <span v-if="index > 0" class="project-flow__link" aria-hidden="true">
            <span
              v-for="(token, position) in flow.links[index - 1]?.tokens ?? []"
              :key="position"
              class="project-flow__token"
              :class="projectMarkClass(token, narrative)"
              :style="{ left: `${20 + position * 25}%`, animationDelay: `${-position * 0.9}s` }"
            />
          </span>
          <div
            class="project-flow__station"
            :class="{ 'project-flow__station--constraint': flow.constraint?.station === station.kind, 'project-flow__station--absent': station.status !== 'available' }"
            :data-station="station.kind"
          >
            <a
              v-if="toolLinks[station.kind]"
              class="project-flow__tool"
              :href="toolLinks[station.kind]!.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="toolLinks[station.kind]!.label"
              :aria-label="t('projectOverview.flow.openTool', { tool: toolLinks[station.kind]!.label })"
            >
              <component :is="toolIcons[toolLinks[station.kind]!.tool]" class="project-flow__tool-icon" aria-hidden="true" />
            </a>
            <span v-if="flow.constraint?.station === station.kind" class="project-flow__constraint">{{ t('projectOverview.flow.constraint') }}</span>
            <span class="project-flow__name">{{ t(stationKeys[station.kind]) }}</span>
            <strong class="project-flow__count">{{ station.count ?? t('projectOverview.flow.noCount') }}</strong>
            <span v-if="station.marks.length" class="project-flow__marks" aria-hidden="true">
              <template v-for="mark in station.marks" :key="mark.workstreamId ?? 'other'">
                <span v-for="unit in Math.min(mark.units, maxMarks)" :key="unit" :class="projectMarkClass(mark.workstreamId, narrative)" />
              </template>
            </span>
            <span class="project-flow__note">{{ note(station) }}</span>
          </div>
        </li>
      </ol>
    </div>
    <p class="project-flow__sentence">{{ sentence }}</p>
    <p v-if="disconnected" class="project-flow__hint">{{ t('projectOverview.flow.connectHint') }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProjectFlow, ProjectFlowStation, ProjectNarrative, ProjectToolKind, ProjectToolLinks } from '@workspace/core/project-overview';
import { BrandJiraIcon, ExternalLinkIcon, GitHubIcon, GitLabIcon, LinearIcon } from '../shared/icons/app-icons';
import { compactDuration, flowLegend, projectMarkClass } from './project-overview-presentation';

const props = defineProps<{ flow: ProjectFlow; narrative: ProjectNarrative | null; toolLinks: ProjectToolLinks }>();
const toolIcons: Record<ProjectToolKind, unknown> = { github: GitHubIcon, gitlab: GitLabIcon, jira: BrandJiraIcon, linear: LinearIcon, link: ExternalLinkIcon };
const { t } = useI18n();
const maxMarks = 8;

const stationKeys = {
  backlog: 'projectOverview.flow.stations.backlog', building: 'projectOverview.flow.stations.building', review: 'projectOverview.flow.stations.review',
  ci: 'projectOverview.flow.stations.ci', shipped: 'projectOverview.flow.stations.shipped',
} as const;
const legend = computed(() => flowLegend(props.flow));
const disconnected = computed(() => props.flow.stations.some(station => station.status === 'notConnected'));
const workstreamName = (id: string) => props.narrative?.workstreams.find(workstream => workstream.id === id)?.name ?? t('projectOverview.flow.otherWork');

function note(station: ProjectFlowStation): string {
  if (station.status === 'notConnected') return t('projectOverview.flow.notConnected');
  if (station.status !== 'available') return t('projectOverview.flow.unavailable');
  if (station.kind === 'backlog') return t('projectOverview.flow.arrived', { count: station.note ?? 0 });
  if (station.kind === 'building') return t('projectOverview.flow.agentsWorking', { count: station.note ?? 0 });
  if (station.kind === 'review') return station.note === null ? t('projectOverview.flow.nothingWaiting') : t('projectOverview.flow.oldestWaiting', { age: compactDuration(station.note) });
  if (station.kind === 'ci') return t('projectOverview.flow.failing', { count: station.note ?? 0 });
  return t('projectOverview.flow.mergedThisWeek');
}

const sentence = computed(() => {
  const constraint = props.flow.constraint;
  if (!constraint) return t('projectOverview.flow.nothingStuck');
  const stated = t('projectOverview.flow.constraintSentence', { station: t(stationKeys[constraint.station]), count: constraint.units, age: compactDuration(constraint.oldestWaitMs) });
  return constraint.workstreamIds.length ? `${stated} ${t('projectOverview.flow.involved', { names: constraint.workstreamIds.map(workstreamName).join(', ') })}` : stated;
});
</script>

<style scoped>
.project-flow {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  padding-top: var(--space-24);
  border-top: 1px solid var(--color-outline-subtle);
}

.project-flow__header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-12);
}

.project-flow__heading {
  margin: 0;
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-semibold);
}

.project-flow__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-16);
  margin: 0;
  padding: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  list-style: none;
}

.project-flow__legend li {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.project-flow__scroll {
  overflow-x: auto;
}

.project-flow__line {
  display: flex;
  align-items: flex-end;
  min-width: 760px;
  margin: 0;
  padding: var(--space-24) 0 0;
  list-style: none;
}

.project-flow__step {
  display: flex;
  flex: 1 1 0;
  align-items: flex-end;
  min-width: 0;
}

.project-flow__step--first {
  flex: 0 0 auto;
}

.project-flow__link {
  position: relative;
  flex: 1 1 0;
  min-width: var(--space-32);
  height: 2px;
  margin: 0 var(--space-4) 62px;
  background: var(--color-outline);
}

.project-flow__link::after {
  position: absolute;
  top: -4px;
  right: -1px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 7px solid var(--color-outline);
  content: '';
}

.project-flow__token {
  position: absolute;
  top: -4px;
}

.project-flow__station {
  position: relative;
  display: flex;
  flex: 0 0 136px;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  width: 136px;
  min-height: 124px;
  padding: var(--space-10) var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-shell-main);
  text-align: center;
}

.project-flow__station--constraint {
  border: 2px solid var(--color-warning);
  background: var(--color-warning-container);
}

.project-flow__station--absent {
  border-style: dashed;
  background: var(--color-surface);
}

.project-flow__tool {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
}

.project-flow__tool:hover,
.project-flow__tool:focus-visible {
  color: var(--color-text);
  background: var(--color-surface-base);
}

.project-flow__tool-icon {
  width: 16px;
  height: 16px;
}

.project-flow__constraint {
  position: absolute;
  top: calc(-1 * var(--space-24));
  right: 0;
  left: 0;
  color: var(--color-on-warning-container);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
}

.project-flow__name,
.project-flow__note {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.project-flow__count {
  font-size: var(--font-size-28);
  font-weight: var(--font-weight-semibold);
  line-height: 1.25;
}

.project-flow__marks {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-4);
  min-height: var(--space-8);
}

.project-flow__sentence,
.project-flow__hint {
  max-width: 880px;
  margin: 0;
  font-size: var(--font-size-14);
}

.project-flow__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

@media (prefers-reduced-motion: no-preference) {
  .project-flow__token {
    animation: project-flow-token 2.8s linear infinite;
  }
}

@keyframes project-flow-token {
  0% {
    left: 0;
    opacity: 0;
  }

  15%,
  85% {
    opacity: 1;
  }

  100% {
    left: calc(100% - var(--space-10));
    opacity: 0;
  }
}
</style>
