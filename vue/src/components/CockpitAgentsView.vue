<template>
  <main class="cockpit-agents">
    <section
      v-for="section in agentSections"
      :key="section.id"
      class="cockpit-agents__team"
    >
      <header v-if="section.team" class="cockpit-agents__team-header">
        <span
          class="cockpit-agents__team-marker"
          :style="{ backgroundColor: section.team.color ?? defaultTeamColor }"
          aria-hidden="true"
        />
        <button
          class="cockpit-agents__team-title"
          type="button"
          @click="emit('select-team', section.team.id)"
        >
          {{ section.team.name }}
        </button>
        <div class="cockpit-agents__team-summary">
          <span
            v-for="item in section.statusSummary"
            :key="item.status"
          >
            <i :data-status="item.status" aria-hidden="true" />
            {{ item.count }} {{ item.label }}
          </span>
        </div>
        <NewAgentButton
          v-if="section.showHeaderAdd"
          class="cockpit-agents__header-add"
          :label="$t('surface.cockpitAgentsView.addAgent')"
          size="small"
          tone="ghost"
          @new-agent="emit('add-agent', section.team.id)"
        />
      </header>

      <p v-if="section.agents.length === 0" class="cockpit-agents__empty">{{ $t('surface.cockpitAgentsView.noAgents') }}</p>

      <div
        :ref="(element) => setGridRef(section.id, element)"
        class="cockpit-agents__grid"
      >
        <CockpitAgentCard
          v-for="agent in section.agents"
          :key="agent.id"
          :agent="agent"
          :remote-connections="remoteConnections"
          :repository-icon="repositoryIconForAgent(agent, repositoryIcons)"
          :dragged-work-item="null"
          :drop-target="false"
          :show-last-activity="mode === 'recent'"
          :response-preview="responsePreviews?.[agent.id]"
          @open-agent-menu="openAgentMenu"
          @prompt="emit('prompt-agent', $event)"
          @select="selectAgent(agent)"
        />

        <CockpitAddAgentTile
          v-if="section.team && section.showGridAdd"
          :dragged-work-item="null"
          :team-id="section.team.id"
          @new-agent="emit('add-agent', $event)"
        />
      </div>
    </section>

    <AgentContextMenu
      :shared="Boolean(contextMenuAgent?.sharedConversation)"
      v-if="contextMenuAgent"
      :share-available="Boolean(supportsConversationSharing(contextMenuAgent) && !contextMenuAgent?.remoteConnectionId)"
      :fork-disabled="!canForkContextMenuAgent"
      :compact-disabled="true"
      :resume-disabled="true"
      :move-targets="contextMenuMoveTargets"
      :x="contextMenuPosition.x"
      :y="contextMenuPosition.y"
      @action="emitContextAgentAction"
      @move-agent-to-team="emitContextAgentMove"
      @close="closeAgentMenu"
    />
  </main>
</template>

<script setup lang="ts">
import { supportsConversationSharing } from '@workspace/core/conversation-sharing';
import { translate } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import type { Agent, AgentStatus, CockpitAgentViewMode, Team } from '@workspace/core/contracts';
import { defaultTeamColor } from '@workspace/core/team-colors';
import { repositoryIconForAgent } from '@workspace/core/workspace-sidebar';
import AgentContextMenu from './AgentContextMenu.vue';
import type { AgentContextMenuAction } from './AgentContextMenu.vue';
import CockpitAddAgentTile from './CockpitAddAgentTile.vue';
import CockpitAgentCard from './CockpitAgentCard.vue';
import NewAgentButton from './NewAgentButton.vue';
import { projectCockpitAgentSections } from './cockpit-agent-layout';

type StatusSummaryItem = { count: number; label: string; status: AgentStatus['type'] };
type AgentSectionLayout = {
  agents: Agent[];
  id: string;
  showGridAdd: boolean;
  showHeaderAdd: boolean;
  statusSummary: StatusSummaryItem[];
  team: Team | null;
};

const DEFAULT_GRID_COLUMNS = 3;

const props = withDefaults(defineProps<{
  agents: Agent[];
  remoteConnections?: import('@workspace/core/contracts').RemoteConnection[];
  forkableAgentIds?: string[];
  mode?: CockpitAgentViewMode;
  repositoryIcons?: Record<string, string>;
  responsePreviews?: Record<string, string>;
  teams: Team[];
}>(), {
  mode: 'teams',
});

const repositoryIcons = computed(() => props.repositoryIcons ?? {});

const emit = defineEmits<{
  'add-agent': [teamId: string];
  'close-agent': [agentId: string];
  'duplicate-agent': [agentId: string];
  'edit-agent': [agentId: string];
  'fork-agent': [agentId: string];
  'share-agent': [agentId: string];
  'handoff-agent': [agentId: string];
  'move-agent-to-team': [payload: { agentId: string; teamId: string }];
  'prompt-agent': [payload: { agentId: string; prompt: string }];
  'restart-agent': [agentId: string];
  'select-agent': [payload: { agentId: string; teamId: string }];
  'select-team': [teamId: string];
}>();

const agentsById = computed(() => new Map(props.agents.map((agent) => [agent.id, agent])));
const columnsBySection = ref<Record<string, number>>({});
const contextMenuAgentId = ref<string | null>(null);
const contextMenuPosition = ref({ x: 0, y: 0 });
const gridElements = new Map<string, HTMLElement>();
let resizeObserver: ResizeObserver | null = null;

const contextMenuAgent = computed(() => contextMenuAgentId.value ? agentsById.value.get(contextMenuAgentId.value) ?? null : null);
const canForkContextMenuAgent = computed(() => (
  contextMenuAgent.value?.status.type === 'idle'
  && Boolean(contextMenuAgent.value.backendSession)
  && (props.forkableAgentIds ?? []).includes(contextMenuAgent.value.id)
));
const contextMenuMoveTargets = computed(() => {
  const agent = contextMenuAgent.value;
  return agent ? props.teams.filter((team) => team.id !== agent.teamId) : [];
});
const mode = computed(() => props.mode);
const agentSections = computed<AgentSectionLayout[]>(() => projectCockpitAgentSections({
  agents: props.agents,
  mode: props.mode,
  teams: props.teams,
}).map((section) => {
  const columns = columnsBySection.value[section.id] ?? DEFAULT_GRID_COLUMNS;
  return {
    ...section,
    showGridAdd: Boolean(section.team) && (section.agents.length === 0 || section.agents.length % columns !== 0),
    showHeaderAdd: Boolean(section.team) && section.agents.length > 0 && section.agents.length % columns === 0,
    statusSummary: statusCounts(section.agents),
  };
}));

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const sectionId = entry.target instanceof HTMLElement ? entry.target.dataset.sectionId : undefined;
        if (sectionId) measureGridColumns(sectionId, entry.target as HTMLElement);
      }
    });
    for (const element of gridElements.values()) resizeObserver.observe(element);
  }
  void nextTick(measureAllGrids);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  gridElements.clear();
});

watch(() => `${props.mode}\0${props.teams.map((team) => team.id).join('\0')}`, () => void nextTick(measureAllGrids));

function setGridRef(sectionId: string, element: Element | ComponentPublicInstance | null): void {
  const htmlElement = element instanceof HTMLElement
    ? element
    : (element as ComponentPublicInstance | null)?.$el instanceof HTMLElement
      ? (element as ComponentPublicInstance).$el as HTMLElement
      : null;
  const previous = gridElements.get(sectionId);
  if (previous && previous !== htmlElement) resizeObserver?.unobserve(previous);
  if (!htmlElement) {
    gridElements.delete(sectionId);
    return;
  }
  htmlElement.dataset.sectionId = sectionId;
  gridElements.set(sectionId, htmlElement);
  resizeObserver?.observe(htmlElement);
  measureGridColumns(sectionId, htmlElement);
}

function measureAllGrids(): void {
  for (const [sectionId, element] of gridElements) measureGridColumns(sectionId, element);
}

function measureGridColumns(sectionId: string, element: HTMLElement): void {
  const styles = getComputedStyle(element);
  const tileWidth = Number.parseFloat(styles.getPropertyValue('--cockpit-tile-width')) || 320;
  const gap = Number.parseFloat(styles.columnGap) || 12;
  const width = element.clientWidth || element.getBoundingClientRect().width;
  const columns = width > 0 ? Math.max(1, Math.floor((width + gap) / (tileWidth + gap))) : DEFAULT_GRID_COLUMNS;
  if (columnsBySection.value[sectionId] !== columns) {
    columnsBySection.value = { ...columnsBySection.value, [sectionId]: columns };
  }
}

function openAgentMenu(payload: { agentId: string; x: number; y: number }): void {
  contextMenuAgentId.value = payload.agentId;
  contextMenuPosition.value = { x: payload.x, y: payload.y };
}

function selectAgent(agent: Agent): void {
  const teamId = agent.teamId ?? props.teams.find((team) => team.agentIds.includes(agent.id))?.id;
  if (teamId) emit('select-agent', { agentId: agent.id, teamId });
}

function emitContextAgentAction(action: AgentContextMenuAction): void {
  const agentId = contextMenuAgentId.value;
  if (!agentId) return;
  if (action === 'share-agent') emit('share-agent', agentId);
  else if (action === 'close-agent') emit('close-agent', agentId);
  else if (action === 'duplicate-agent') emit('duplicate-agent', agentId);
  else if (action === 'edit-agent') emit('edit-agent', agentId);
  else if (action === 'fork-agent') emit('fork-agent', agentId);
  else if (action === 'handoff-agent') emit('handoff-agent', agentId);
  else if (action === 'restart-agent') emit('restart-agent', agentId);
  closeAgentMenu();
}

function emitContextAgentMove(teamId: string): void {
  const agentId = contextMenuAgentId.value;
  if (agentId) emit('move-agent-to-team', { agentId, teamId });
  closeAgentMenu();
}

function closeAgentMenu(): void {
  contextMenuAgentId.value = null;
}

function statusCounts(agents: Agent[]): StatusSummaryItem[] {
  const order: AgentStatus['type'][] = ['awaitingInput', 'working', 'idle', 'error'];
  const counts = new Map<AgentStatus['type'], number>();
  for (const agent of agents) counts.set(agent.status.type, (counts.get(agent.status.type) ?? 0) + 1);
  return order.flatMap((status) => {
    const count = counts.get(status) ?? 0;
    return count > 0 ? [{ status, count, label: summaryLabel(status, count) }] : [];
  });
}

function summaryLabel(status: AgentStatus['type'], count: number): string {
  if (status === 'awaitingInput') return translate('surface.cockpitAgentsView.awaitingInput');
  if (status === 'error') return count === 1 ? translate('surface.cockpitAgentsView.error') : translate('surface.cockpitAgentsView.errors');
  return status.charAt(0).toUpperCase() + status.slice(1);
}
</script>

<style scoped>
.cockpit-agents {
  width: min(100%, 1220px);
  min-width: 0;
  flex: 1 1 auto;
  display: grid;
  align-content: start;
  gap: var(--space-20);
  margin: 0 auto;
  padding: var(--space-16) var(--space-20) var(--space-24);
  overflow: auto;
}

.cockpit-agents__team {
  display: grid;
  gap: var(--space-10);
}

.cockpit-agents__team-header,
.cockpit-agents__team-summary,
.cockpit-agents__team-summary span {
  display: flex;
  align-items: center;
}

.cockpit-agents__team-header {
  min-width: 0;
  gap: var(--space-8);
}

.cockpit-agents__team-marker {
  width: 4px;
  height: 28px;
  border-radius: var(--radius-full);
}

.cockpit-agents__team-title {
  min-width: 0;
  overflow: hidden;
  border: 0;
  padding: 0;
  color: var(--color-text);
  background: transparent;
  font-size: var(--font-size-20);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-28);
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.cockpit-agents__team-title:hover {
  color: var(--color-primary);
}

.cockpit-agents__team-summary {
  gap: var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.cockpit-agents__team-summary span {
  gap: var(--space-3);
}

.cockpit-agents__team-summary i {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-success);
}

.cockpit-agents__team-summary i[data-status="working"],
.cockpit-agents__team-summary i[data-status="awaitingInput"] {
  background: var(--color-warning);
}

.cockpit-agents__team-summary i[data-status="error"] {
  background: var(--color-error);
}

.cockpit-agents__header-add {
  margin-left: auto;
}

.cockpit-agents__empty {
  margin: 0;
  padding-left: var(--space-12);
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
}

.cockpit-agents__grid {
  --cockpit-tile-width: 320px;
  display: grid;
  grid-template-columns: repeat(
    auto-fill,
    minmax(min(100%, var(--cockpit-tile-width)), var(--cockpit-tile-width))
  );
  gap: var(--space-12);
}
</style>
