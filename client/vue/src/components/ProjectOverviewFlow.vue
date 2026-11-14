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
    <!-- One row of stations when there is room, a column when there is not: never a horizontal scroll. -->
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
            :style="{ animationDelay: `${-position * 0.9}s` }"
          />
        </span>
        <div class="project-flow__stop">
          <div
            class="project-flow__station"
            :class="{
              'project-flow__station--stuck': station.stuck.length,
              'project-flow__station--loading': station.status === 'loading',
              'project-flow__station--absent': station.status !== 'available' && station.status !== 'loading',
            }"
            :aria-busy="station.status === 'loading'"
            :data-station="station.kind"
          >
            <template v-if="station.stuck.length">
              <a
                v-if="station.stuck.length === 1 && station.stuck[0]!.target?.kind === 'url'"
                class="project-flow__stuck"
                :href="station.stuck[0]!.target.url"
                target="_blank"
                rel="noopener noreferrer"
                :title="stuckLabel(station.stuck[0]!)"
                :aria-label="stuckLabel(station.stuck[0]!)"
              ><AlertTriangleIcon class="project-flow__icon" aria-hidden="true" /></a>
              <button
                v-else
                class="project-flow__stuck"
                type="button"
                :title="stuckSummary(station)"
                :aria-label="stuckSummary(station)"
                :aria-expanded="station.stuck.length > 1 || !station.stuck[0]!.target ? openStation === station.kind : undefined"
                @click="openStuck(station)"
              ><AlertTriangleIcon class="project-flow__icon" aria-hidden="true" /></button>
            </template>
            <a
              v-if="toolLinks[station.kind]"
              class="project-flow__tool"
              :href="toolLinks[station.kind]!.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="toolLinks[station.kind]!.label"
              :aria-label="t('projectOverview.flow.openTool', { tool: toolLinks[station.kind]!.label })"
            >
              <component :is="toolIcons[toolLinks[station.kind]!.tool]" class="project-flow__icon" aria-hidden="true" />
            </a>
            <LoaderIcon v-if="station.status === 'loading'" class="project-flow__icon project-flow__loader" aria-hidden="true" />
            <span class="project-flow__name">{{ t(stationKeys[station.kind]) }}</span>
            <strong v-if="station.status === 'loading'" class="project-flow__count project-flow__count--loading" aria-hidden="true" />
            <strong v-else class="project-flow__count">{{ station.count ?? t('projectOverview.flow.noCount') }}</strong>
            <span class="project-flow__marks" aria-hidden="true">
              <template v-for="mark in station.marks" :key="mark.workstreamId ?? 'other'">
                <span v-for="unit in Math.min(mark.units, maxMarks)" :key="unit" :class="projectMarkClass(mark.workstreamId, narrative)" />
              </template>
            </span>
          </div>
          <span class="project-flow__note">{{ note(station) }}</span>
          <ul v-if="openStation === station.kind" class="project-flow__stuck-list" :aria-label="stuckSummary(station)">
            <li v-for="item in station.stuck" :key="item.branch">
              <a v-if="item.target?.kind === 'url'" :href="item.target.url" target="_blank" rel="noopener noreferrer">{{ item.branch }}</a>
              <button v-else-if="item.target?.kind === 'agent'" type="button" @click="emit('select-agent', item.target.agentId)">{{ item.branch }}</button>
              <span v-else>{{ item.branch }}</span>
              <span class="project-flow__stuck-reason">{{ reasonText(item) }}</span>
            </li>
          </ul>
        </div>
      </li>
    </ol>
    <p v-if="disconnected" class="project-flow__hint">{{ t('projectOverview.flow.connectHint') }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProjectFlow, ProjectFlowStation, ProjectFlowStuck, ProjectNarrative, ProjectOverviewSources, ProjectToolKind, ProjectToolLinks } from '@workspace/core/project-overview';
import { AlertTriangleIcon, BrandJiraIcon, ExternalLinkIcon, GitHubIcon, GitLabIcon, LinearIcon, LoaderIcon } from '../shared/icons/app-icons';
import { flowLegend, projectMarkClass, compactDuration } from './project-overview-presentation';

const props = defineProps<{
  flow: ProjectFlow;
  narrative: ProjectNarrative | null;
  toolLinks: ProjectToolLinks;
  /** What each source has answered; null while the repository itself is still being read. */
  sources: ProjectOverviewSources | null;
}>();
const emit = defineEmits<{ 'select-agent': [agentId: string] }>();
const toolIcons: Record<ProjectToolKind, unknown> = { github: GitHubIcon, gitlab: GitLabIcon, jira: BrandJiraIcon, linear: LinearIcon, link: ExternalLinkIcon };
const toolNames: Partial<Record<ProjectToolKind, string>> = { github: 'GitHub', gitlab: 'GitLab', jira: 'Jira', linear: 'Linear' };
const { t } = useI18n();
const maxMarks = 8;
const openStation = ref<ProjectFlowStation['kind'] | null>(null);

const stationKeys = {
  backlog: 'projectOverview.flow.stations.backlog', building: 'projectOverview.flow.stations.building', review: 'projectOverview.flow.stations.review',
  ci: 'projectOverview.flow.stations.ci', shipped: 'projectOverview.flow.stations.shipped',
} as const;
const reasonKeys = {
  conflicts: 'projectOverview.flow.stuck.conflicts', failing: 'projectOverview.flow.stuck.failing',
  needsInput: 'projectOverview.flow.stuck.needsInput', overdue: 'projectOverview.flow.stuck.overdue',
} as const;
const legend = computed(() => flowLegend(props.flow));
const disconnected = computed(() => props.flow.stations.some(station => station.status === 'notConnected'));
const workstreamName = (id: string) => props.narrative?.workstreams.find(workstream => workstream.id === id)?.name ?? t('projectOverview.flow.otherWork');
const reasonText = (item: ProjectFlowStuck) => t(reasonKeys[item.reason]);
const stuckLabel = (item: ProjectFlowStuck) => `${item.branch}: ${reasonText(item)}`;
const stuckSummary = (station: ProjectFlowStation) => station.stuck.length === 1 ? stuckLabel(station.stuck[0]!) : t('projectOverview.flow.stuck.summary', { count: station.stuck.length });

/** One item goes straight to its request or thread; several open a list to choose from. */
function openStuck(station: ProjectFlowStation): void {
  const [only] = station.stuck;
  if (station.stuck.length === 1 && only?.target?.kind === 'agent') {
    emit('select-agent', only.target.agentId);
    return;
  }
  openStation.value = openStation.value === station.kind ? null : station.kind;
}

/** The tool a station's work is asked of, by name, when the project's links say which it is. */
function toolName(kinds: readonly ProjectFlowStation['kind'][], codeHost: boolean): string | null {
  for (const kind of kinds) {
    const link = props.toolLinks[kind];
    if (!link || (codeHost && link.tool !== 'github' && link.tool !== 'gitlab')) continue;
    return toolNames[link.tool] ?? link.label;
  }
  return null;
}

/** Says which tool a loading station is waiting on: the repository first, then issues, reviews or pipelines. */
function loadingNote(station: ProjectFlowStation): string {
  const sources = props.sources;
  if (!sources || sources.git === 'loading') return t('projectOverview.flow.loading.git');
  const what = station.kind === 'backlog' ? 'issues' : sources.pullRequests === 'loading' ? 'reviews' : 'pipelines';
  const tool = station.kind === 'backlog'
    ? toolName(['backlog'], false)
    : toolName([station.kind, 'building', 'review', 'ci', 'shipped'], true);
  return tool ? t(`projectOverview.flow.loading.asking.${what}`, { tool }) : t(`projectOverview.flow.loading.reading.${what}`);
}

function note(station: ProjectFlowStation): string {
  if (station.status === 'loading') return loadingNote(station);
  if (station.status === 'notConnected') return t('projectOverview.flow.notConnected');
  if (station.status !== 'available') return t('projectOverview.flow.unavailable');
  if (station.kind === 'backlog') return t('projectOverview.flow.arrived', { count: station.note ?? 0 });
  if (station.kind === 'building') return t('projectOverview.flow.agentsWorking', { count: station.note ?? 0 });
  if (station.kind === 'review') return station.note === null ? t('projectOverview.flow.nothingWaiting') : t('projectOverview.flow.oldestWaiting', { age: compactDuration(station.note) });
  if (station.kind === 'ci') return t('projectOverview.flow.failing', { count: station.note ?? 0 });
  return t('projectOverview.flow.mergedThisWeek');
}
</script>

<style scoped>
.project-flow {
  container: project-flow / inline-size;
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

/* Five equal cards with the arrows between them taking what is left, so the row always fits its width. */
.project-flow__line {
  display: grid;
  grid-template-columns: minmax(80px, 160px) repeat(4, minmax(16px, 1fr) minmax(80px, 160px));
  align-items: start;
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-flow__step {
  display: contents;
}

.project-flow__stop {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-6);
  min-width: 0;
}

.project-flow__link {
  position: relative;
  align-self: start;
  height: 2px;
  margin: 58px var(--space-4) 0;
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
  left: 0;
}

.project-flow__station {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  min-height: 116px;
  padding: var(--space-32) var(--space-6) var(--space-10);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-shell-main);
  text-align: center;
}

.project-flow__station--stuck {
  border-color: var(--color-warning);
}

.project-flow__station--absent {
  border-style: dashed;
  background: var(--color-surface);
}

.project-flow__station--loading {
  border-color: var(--color-outline-subtle);
}

/* Where the stuck icon sits once the station has answered. */
.project-flow__loader {
  position: absolute;
  top: var(--space-8);
  left: var(--space-8);
  color: var(--color-primary);
}

/* Holds the count's place while it is read, so the card does not jump when it lands. */
.project-flow__count--loading {
  width: 36px;
  height: 35px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-base);
}

.project-flow__tool,
.project-flow__stuck {
  position: absolute;
  top: var(--space-4);
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.project-flow__tool {
  right: var(--space-4);
}

.project-flow__stuck {
  left: var(--space-4);
  color: var(--color-warning);
}

.project-flow__tool:hover,
.project-flow__tool:focus-visible,
.project-flow__stuck:hover,
.project-flow__stuck:focus-visible {
  background: var(--color-surface-base);
}

.project-flow__icon {
  width: 16px;
  height: 16px;
}

.project-flow__name,
.project-flow__note {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.project-flow__note {
  text-align: center;
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
  min-height: 10px;
}

.project-flow__stuck-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin: 0;
  padding: var(--space-6) var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-shell-main);
  font-size: var(--font-size-12);
  list-style: none;
}

.project-flow__stuck-list li {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.project-flow__stuck-list a,
.project-flow__stuck-list button {
  overflow: hidden;
  padding: 0;
  border: 0;
  color: var(--color-primary);
  background: none;
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.project-flow__stuck-reason {
  color: var(--color-text-muted);
}

.project-flow__hint {
  max-width: 880px;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

/* Too narrow for five stations in a row: stack them, with the arrows pointing down. */
@container project-flow (max-width: 600px) {
  .project-flow__line,
  .project-flow__step {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .project-flow__step {
    width: 100%;
  }

  .project-flow__stop {
    width: min(100%, 320px);
  }

  .project-flow__station {
    min-height: 0;
  }

  .project-flow__link {
    align-self: center;
    width: 2px;
    height: var(--space-24);
    margin: var(--space-4) 0;
  }

  .project-flow__link::after {
    top: auto;
    right: -4px;
    bottom: -1px;
    border-top: 7px solid var(--color-outline);
    border-right: 5px solid transparent;
    border-bottom: 0;
    border-left: 5px solid transparent;
  }

  .project-flow__token {
    top: 0;
    left: -4px;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .project-flow__token {
    animation: project-flow-token 2.8s linear infinite;
  }

  .project-flow__loader {
    animation: app-spin 800ms linear infinite;
  }

  .project-flow__count--loading {
    animation: project-flow-pulse 1.4s ease-in-out infinite;
  }

  @container project-flow (max-width: 600px) {
    .project-flow__token {
      animation-name: project-flow-token-down;
    }
  }
}

@keyframes project-flow-pulse {
  50% {
    opacity: 0.4;
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

@keyframes project-flow-token-down {
  0% {
    top: 0;
    opacity: 0;
  }

  15%,
  85% {
    opacity: 1;
  }

  100% {
    top: calc(100% - var(--space-10));
    opacity: 0;
  }
}
</style>
