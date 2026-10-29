<template>
  <aside
    class="agent-sidebar"
    :class="{ 'agent-sidebar--compact': compact }"
    :style="sidebarStyle"
    :aria-label="t('sidebar.agents')"
  >
    <header class="agent-sidebar__header">
      <strong :title="allTeams ? t('sidebar.allTeams') : teamName">{{ allTeams ? t('sidebar.allTeams') : teamName }}</strong>
      <AppMenuButton
        v-if="!allTeams"
        :heading="t('sidebar.organizeBy')"
        :ariaLabel="t('sidebar.organizeBy')"
        :items="organizationMenuItems"
        :width="200"
        @select="organization.select($event)"
      >
        <template #trigger="{ attrs }">
          <button v-bind="attrs" class="agent-sidebar__header-action" type="button" :aria-label="t('sidebar.view')" :title="t('sidebar.view')">
            <ArrowsSortIcon aria-hidden="true" />
          </button>
        </template>
      </AppMenuButton>
      <button
        class="agent-sidebar__collapse"
        type="button"
        :aria-label="t('sidebar.hide')"
        @click="emit('collapse-sidebar')"
      >
        <PanelLeftCloseIcon class="agent-sidebar__collapse-icon" />
      </button>
    </header>

    <section v-if="!allTeams" class="agent-sidebar__workspace-group agent-sidebar__section agent-sidebar__creation-section" data-group-kind="create">
      <header class="agent-sidebar__workspace-header">
        <PlusIcon class="agent-sidebar__workspace-icon" aria-hidden="true" />
        <strong class="agent-sidebar__activity-heading">{{ t('sidebar.create') }}</strong>
      </header>
      <div class="agent-sidebar__start-work">
        <StartWorkMenu @select="emit('start-work', $event)" />
        <button class="agent-sidebar__quick-chat-action" type="button" @click="emit('create-quick-chat')">
          <MessageIcon data-icon="message" aria-hidden="true" />
          <span>{{ t('sidebar.quickChat') }}</span>
        </button>
      </div>
    </section>

    <nav ref="sessionList" class="agent-sidebar__list" :class="{ 'agent-sidebar__list--activity': organizationMode === 'activity' }" :aria-label="t('sidebar.workspaceSessions')">
      <section v-if="!phoneScope && (missions?.length || !allTeams)" class="agent-sidebar__workspace-group agent-sidebar__section" data-group-kind="missions">
        <header class="agent-sidebar__workspace-header">
          <TargetArrowIcon class="agent-sidebar__workspace-icon" data-icon="target-arrow" aria-hidden="true" />
          <button
            class="agent-sidebar__workspace-label"
            type="button"
            :aria-label="t('missions.title')"
            :aria-expanded="!missionsCollapsed"
            @click="missionsCollapsed = !missionsCollapsed"
          >
            <strong>{{ t('missions.title') }}</strong>
          </button>
          <span v-if="!allTeams" class="agent-sidebar__workspace-actions agent-sidebar__workspace-actions--persistent">
            <button
              type="button"
              :aria-label="t('missions.new')"
              :title="t('missions.new')"
              :disabled="missionCreationPending"
              :aria-busy="missionCreationPending"
              @click.stop="emit('create-mission')"
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </span>
        </header>
        <p v-if="missionCreationError" class="agent-sidebar__mission-error" role="alert">{{ missionCreationError }}</p>
        <template v-if="!missionsCollapsed">
          <div v-for="mission in missions" :key="mission.id" class="agent-sidebar__agent-row">
            <button
              class="agent-sidebar__agent"
              :class="{ 'agent-sidebar__agent--active': activeMissionId === mission.id, 'agent-sidebar__agent--awaiting-input': attentionOf(mission) === 'needsInput' }"
              type="button"
              :aria-pressed="activeMissionId === mission.id"
              @click="emit('select-mission', mission.id)"
              @contextmenu.prevent="openMissionMenu(mission.id, $event)"
            >
              <span class="agent-sidebar__meta">
                <strong
                  class="agent-sidebar__session-title"
                  :class="{ 'agent-sidebar__session-title--active': activeMissionId === mission.id }"
                >{{ mission.outcome }}</strong>
              </span>
              <span
                v-if="attentionOf(mission) === 'needsInput'"
                class="agent-sidebar__input-needed"
                :title="missionStatusLabel(mission)"
                :aria-label="missionStatusLabel(mission)"
              >{{ t('sidebar.input') }}</span>
              <span
                v-else
                class="agent-sidebar__status"
                :class="{ 'agent-sidebar__status--unread': attentionOf(mission) === 'unread' }"
                :data-status="missionDotStatus(mission)"
                :aria-label="missionStatusLabel(mission)"
              />
            </button>
          </div>
        </template>
      </section>
      <section
        v-for="group in activityGroups"
        :key="group.id"
        class="agent-sidebar__workspace-group agent-sidebar__section"
        :data-group-kind="group.kind"
        :data-activity-group="group.activity"
      >
        <header
          class="agent-sidebar__workspace-header"
          :data-motion-id="group.id"
        >
          <component :is="activityIcons[group.activity]" class="agent-sidebar__activity-icon" aria-hidden="true" />
          <strong class="agent-sidebar__activity-heading">{{ group.label }}</strong>
          <AppMenuButton
            v-if="group.activity === 'idle' && !allTeams"
            :heading="t('sidebar.sortIdleBy')"
            :ariaLabel="t('sidebar.sortIdle')"
            :items="idleSortMenuItems"
            :width="200"
            @select="organization.selectIdleSort($event)"
          >
            <template #trigger="{ attrs }">
              <button v-bind="attrs" class="agent-sidebar__activity-more agent-sidebar__activity-sort" type="button" :aria-label="t('sidebar.sortIdle')" :title="t('sidebar.sortIdle')">
                <ArrowsSortIcon aria-hidden="true" />
              </button>
            </template>
          </AppMenuButton>
          <el-tooltip
            v-if="moreRowsLabel(group.id)"
            :content="moreRowsLabel(group.id)"
            placement="top"
            :show-after="300"
          >
            <button
              class="agent-sidebar__activity-more"
              type="button"
              tabindex="-1"
              :aria-label="moreRowsLabel(group.id)"
              @click.stop="rowsRefs.get(group.id)?.scrollMore()"
            >
              <CarouselVerticalIcon aria-hidden="true" />
            </button>
          </el-tooltip>
        </header>

        <ScrollHintRows
          :ref="(rows: unknown) => setRowsRef(group.id, rows)"
          class="agent-sidebar__group-rows"
          @overflow="rowsOverflow[group.id] = $event"
        >
          <div
            v-for="session in group.sessions"
            :key="session.agentId"
            class="agent-sidebar__agent-row"
            :data-motion-id="session.agentId"
          >
            <ActivityAgentRow
              :session="session"
              :context="activityContext.get(session.agentId)"
              :repository="activityRepository.has(session.agentId)"
              :repository-icon="activityRepository.get(session.agentId)"
              :quick-chat="agentsById.get(session.agentId)?.sessionKind === 'quickChat'"
              :cleanup="isPullRequestFinished(session) && !showQuickSwitchShortcut(session, group.activity)"
              :shortcut-visible="showQuickSwitchShortcut(session, group.activity)"
              :unread-label="t('sidebar.unread')"
              v-bind="{ ...clientAgentOrderUpdate.dragItemAttributes(session.agentId), ...activityIndicator(session, group.activity) }"
              class="agent-sidebar__agent"
              :class="[
                { 'agent-sidebar__agent--active': session.isActive, 'agent-sidebar__agent--awaiting-input': session.status.type === 'awaitingInput' },
              ]"
              type="button"
              :data-session-kind="session.kind"
              :data-shared="session.shared || undefined"
              :title="group.activity ? activityContext.get(session.agentId) : undefined"
              :aria-pressed="session.isActive"
              @click="selectAgent(session.agentId)"
              @contextmenu.prevent="openAgentMenu(session.agentId, $event)"
            >
              <span
                v-if="!session.shared && backendChoices.length > 1 && agentsById.get(session.agentId) && !(group.activity && showQuickSwitchShortcut(session, group.activity))"
                class="agent-sidebar__engine"
                role="img"
                :aria-label="backendDisplayName(agentsById.get(session.agentId)!.backend)"
                :title="backendDisplayName(agentsById.get(session.agentId)!.backend)"
              >
                <BackendIcon :backend="agentsById.get(session.agentId)!.backend" monochrome />
              </span>

              <span
                v-if="showQuickSwitchShortcut(session, group.activity)"
                class="agent-sidebar__quick-switch-shortcut"
                :aria-label="t('sidebar.switchShortcut', { session: session.displayTitle, number: session.quickSwitchIndex + 1 })"
              ><span aria-hidden="true">⌘</span>{{ session.quickSwitchIndex + 1 }}</span>

            </ActivityAgentRow>
            <el-tooltip
              v-if="isPullRequestFinished(session) && !(group.activity && showQuickSwitchShortcut(session, group.activity))"
              :content="pullRequestAttentionLabel(session)"
              placement="right"
              :show-after="300"
            >
              <button
                class="agent-sidebar__pull-request-attention"
                type="button"
                :aria-label="pullRequestAttentionLabel(session)"
                @click.stop="emit('cleanup-pull-request', session.agentId)"
              >
                <AlertTriangleIcon aria-hidden="true" />
              </button>
            </el-tooltip>
          </div>
        </ScrollHintRows>
      </section>
    </nav>

    <AgentSidebarMenus :model="model" />

    <div
      class="agent-sidebar__resize-handle"
      role="separator"
      :aria-label="t('sidebar.resize')"
      aria-orientation="vertical"
      :aria-valuemin="minWidth"
      :aria-valuemax="maxWidth"
      :aria-valuenow="currentWidth"
      tabindex="0"
      @pointerdown="onResizePointerDown"
      @pointermove="onResizePointerMove"
      @pointerup="onResizePointerEnd"
      @pointercancel="onResizePointerEnd"
      @keydown.left.prevent="emitResizedWidth(currentWidth - resizeStep)"
      @keydown.right.prevent="emitResizedWidth(currentWidth + resizeStep)"
    />
  </aside>
</template>

<script setup lang="ts">
import { toRefs } from 'vue';
import AgentSidebarMenus from './AgentSidebarMenus.vue';
import type { AgentSidebarModel } from './use-agent-sidebar';
import { AlertTriangleIcon, ArrowsSortIcon, CarouselVerticalIcon, MessageIcon, PanelLeftCloseIcon, PlusIcon, TargetArrowIcon } from '../shared/icons/app-icons';
import BackendIcon from './BackendIcon.vue';
import StartWorkMenu from './StartWorkMenu.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import ActivityAgentRow from './ActivityAgentRow.vue';
import ScrollHintRows from './ScrollHintRows.vue';

const props = defineProps<{ model: AgentSidebarModel }>();
const {
  compact,
  sidebarStyle,
  t,
  allTeams,
  teamName,
  organizationMenuItems,
  organization,
  emit,
  organizationMode,
  phoneScope,
  missions,
  missionsCollapsed,
  missionCreationPending,
  missionCreationError,
  activeMissionId,
  attentionOf,
  openMissionMenu,
  missionStatusLabel,
  missionDotStatus,
  activityGroups,
  activityIcons,
  idleSortMenuItems,
  moreRowsLabel,
  rowsRefs,
  setRowsRef,
  rowsOverflow,
  activityContext,
  activityRepository,
  agentsById,
  isPullRequestFinished,
  showQuickSwitchShortcut,
  clientAgentOrderUpdate,
  activityIndicator,
  selectAgent,
  openAgentMenu,
  backendChoices,
  backendDisplayName,
  pullRequestAttentionLabel,
  minWidth,
  maxWidth,
  currentWidth,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerEnd,
  emitResizedWidth,
  resizeStep,
  sessionList,
} = toRefs(props.model);
</script>

<style scoped src="./agent-row.css"></style>
<style scoped src="./agent-sidebar-common.css"></style>
<style scoped>

/*
 * Activity sections take their natural height. When the list is too short they shrink, each down
 * to a floor of two rows and scrolling its own rows: Idle first, then Working, Done and Needs
 * input. Only when every floor is reached does the whole list scroll. Flex shrink is proportional,
 * so the widely spaced factors below make the order effectively strict.
 */
.agent-sidebar__list--activity {
  display: flex;
  flex-direction: column;
  overflow-anchor: none;
}

.agent-sidebar__workspace-group:not([data-activity-group]) > .agent-sidebar__group-rows {
  display: contents;
}

.agent-sidebar__workspace-group[data-activity-group] > .agent-sidebar__group-rows {
  min-height: 0;
}

.agent-sidebar__workspace-group[data-activity-group] > .agent-sidebar__workspace-header {
  flex: 0 0 auto;
}

.agent-sidebar__start-work {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) 0;
}

.agent-sidebar__start-work > :deep(.app-menu-button),
.agent-sidebar__start-work > button {
  flex: 1 1 0;
  min-width: 0;
}

.agent-sidebar__start-work :deep(.start-work-menu__trigger),
.agent-sidebar__start-work > button {
  justify-content: flex-start;
  gap: var(--space-4);
  padding: 0 var(--space-8);
  font-size: var(--font-size-13);
  white-space: nowrap;
}

.agent-sidebar__start-work :deep(svg) {
  flex-shrink: 0;
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.agent-sidebar__quick-chat-action {
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-medium);
  text-align: left;
  cursor: pointer;
}

.agent-sidebar__quick-chat-action:hover,
.agent-sidebar__quick-chat-action:focus-visible {
  color: var(--color-text);
  outline: 0;
}

.agent-sidebar__quick-chat-action svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

/* Sections have no frame: a colored rail plus the tinted header band mark where each one starts and ends. */
.agent-sidebar__workspace-group.agent-sidebar__section {
  display: flex;
  flex-direction: column;
  min-height: var(--section-floor, 0);
  margin-left: var(--space-2);
  padding-left: var(--space-6);
}

.agent-sidebar__workspace-group.agent-sidebar__creation-section {
  flex: 0 0 auto;
  margin: var(--space-6) var(--space-4) 0 calc(var(--space-4) + var(--space-2));
}

/* Activity rows and sections never reorder. Their drop indicators would stick out 2px past each row, which counts as scroll overflow, so the rail reuses the section's ::before instead. */
.agent-sidebar__workspace-group[data-activity-group] .agent-sidebar__agent::before,
.agent-sidebar__workspace-group[data-activity-group] .agent-sidebar__agent::after {
  display: none;
}

.agent-sidebar__workspace-group.agent-sidebar__section::before {
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  height: auto;
  background: color-mix(in srgb, var(--activity-color) 80%, transparent);
  box-shadow: none;
  opacity: 1;
  transform: none;
}

.agent-sidebar__workspace-group.agent-sidebar__section + .agent-sidebar__workspace-group.agent-sidebar__section {
  margin-top: var(--space-6);
}

.agent-sidebar__workspace-group {
  --activity-color: var(--color-outline);

  position: relative;
}

.agent-sidebar__activity-more {
  display: grid;
  width: var(--space-12);
  height: var(--space-12);
  margin-left: auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
  opacity: 0.7;
}

.agent-sidebar__activity-more:hover {
  color: var(--color-text);
  opacity: 1;
}

.agent-sidebar__activity-more svg {
  width: var(--space-8);
  height: var(--space-8);
}

.agent-sidebar__activity-sort {
  opacity: 0;
}

.agent-sidebar__workspace-header:hover .agent-sidebar__activity-sort,
.agent-sidebar__activity-sort:focus-visible,
.agent-sidebar__activity-sort[aria-expanded="true"] {
  opacity: 1;
}

.agent-sidebar__activity-heading {
  flex: 1;
  transform: translateY(-1px);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-bold);
}

.agent-sidebar__workspace-group.agent-sidebar__section .agent-sidebar__workspace-header {
  display: flex;
  gap: var(--space-4);
  margin: 0 0 var(--space-2);
  padding: calc(var(--space-4) + var(--space-2)) calc(var(--space-6) + var(--space-2));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-border) 35%, transparent);
}

.agent-sidebar__workspace-group[data-group-kind="missions"] {
  --activity-color: var(--color-primary);

  flex-shrink: 0;
}

.agent-sidebar__workspace-group[data-group-kind="quickChats"] {
  --activity-color: var(--color-secondary);
}

.agent-sidebar__section > .agent-sidebar__workspace-header > .agent-sidebar__workspace-icon,
.agent-sidebar__section > .agent-sidebar__workspace-header > .agent-sidebar__activity-icon {
  flex: 0 0 var(--agent-sidebar-repository-icon-column-width);
}

.agent-sidebar__section > .agent-sidebar__workspace-header > .agent-sidebar__workspace-label {
  flex: 1;
  min-height: var(--line-height-18);
}

.agent-sidebar__section .agent-sidebar__workspace-label strong {
  font-size: var(--font-size-13);
}

.agent-sidebar__workspace-group[data-activity-group="attention"] {
  --activity-color: var(--color-attention);

  flex-shrink: 1;
}

.agent-sidebar__workspace-group[data-activity-group="working"] {
  --activity-color: var(--color-warning);

  flex-shrink: 1000000;
}

.agent-sidebar__workspace-group[data-activity-group="recent"] {
  --activity-color: var(--color-success);

  flex-shrink: 1000;
}

.agent-sidebar__workspace-group[data-activity-group="idle"] {
  --activity-color: var(--color-outline);

  flex-shrink: 1000000000;
}

.agent-sidebar__activity-icon {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--activity-color);
}

@media (prefers-reduced-motion: no-preference) {
  [data-activity-group="attention"] .agent-sidebar__activity-icon {
    transform-origin: 50% 10%;
    animation: activity-attention-ring 6s ease-in-out infinite;
  }

  [data-activity-group="working"] .agent-sidebar__activity-icon {
    animation: activity-working-spin 1.2s linear infinite;
  }
}

@keyframes activity-attention-ring {
  0%, 14%, 100% { transform: rotate(0deg); }
  2%, 6% { transform: rotate(-16deg); }
  4%, 8% { transform: rotate(16deg); }
  10% { transform: rotate(-8deg); }
  12% { transform: rotate(8deg); }
}

@keyframes activity-working-spin {
  to {
    transform: rotate(360deg);
  }
}

.agent-sidebar__activity-moving {
  z-index: 1;
  border-radius: var(--radius-md);
  background: var(--color-surface-base);
}

.agent-sidebar__input-needed {
  grid-column: -2;
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  background: var(--color-primary-container);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-18);
  white-space: nowrap;
}

@container (max-width: 140px) {
  .agent-sidebar__header {
    justify-content: center;
    padding: 0;
  }

  .agent-sidebar__header strong {
    display: none;
  }

  .agent-sidebar__collapse {
    width: var(--space-16);
    height: var(--space-16);
  }

  .agent-sidebar__list {
    display: grid;
    align-content: start;
    align-items: start;
    justify-items: center;
    gap: var(--space-4);
  }

  .agent-sidebar__workspace-group {
    width: 100%;
  }

  .agent-sidebar__workspace-header {
    display: flex;
    justify-content: center;
    padding: var(--space-2);
  }

  .agent-sidebar__workspace-actions,
  .agent-sidebar__header-action {
    display: none;
  }

  .agent-sidebar__workspace-label {
    display: none;
  }

  .agent-sidebar__agent {
    position: relative;
    width: 100%;
    min-height: var(--space-20);
    grid-template-columns: var(--icon-sm);
    place-items: center;
    gap: 0;
    margin-bottom: 0;
    padding: var(--space-4) var(--space-2);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :deep(.agent-sidebar__meta) {
    display: none;
  }

  .agent-sidebar__status {
    position: absolute;
    left: calc(50% + 10px);
    bottom: var(--space-4);
    border: 1px solid var(--color-surface-low);
  }

  .agent-sidebar__start-work {
    padding-inline: var(--space-4);
  }

  .agent-sidebar__start-work :deep(.start-work-menu__trigger) {
    justify-content: center;
    padding-inline: 0;
  }

  .agent-sidebar__start-work :deep(.start-work-menu__trigger span) {
    display: none;
  }
}
</style>
