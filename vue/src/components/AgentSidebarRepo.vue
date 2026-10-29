<template>
  <aside
    class="agent-sidebar"
    :class="{ 'agent-sidebar--compact': compact }"
    :style="sidebarStyle"
    :aria-label="t('sidebar.agents')"
  >
    <header class="agent-sidebar__header">
      <strong :title="teamName">{{ teamName }}</strong>
      <AppMenuButton
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

    <div class="agent-sidebar__start-work">
      <StartWorkMenu @select="emit('start-work', $event)" />
      <button
        v-if="!quickChatGroup"
        class="agent-sidebar__quick-chat-action"
        type="button"
        @click="emit('create-quick-chat')"
      >
        <MessageIcon data-icon="message" aria-hidden="true" />
        <span>{{ t('sidebar.quickChat') }}</span>
      </button>
      <button
        v-if="!phoneScope && !missions?.length"
        class="agent-sidebar__mission-action"
        type="button"
        :aria-busy="missionCreationPending"
        :disabled="missionCreationPending"
        @click="emit('create-mission')"
      >
        <TargetArrowIcon data-icon="target-arrow" aria-hidden="true" />
        <span>{{ t('missions.new') }}</span>
      </button>
      <p v-if="missionCreationError" class="agent-sidebar__mission-error" role="alert">
        {{ missionCreationError }}
      </p>
    </div>

    <nav ref="sessionList" class="agent-sidebar__list" :aria-label="t('sidebar.workspaceSessions')">
      <section v-if="!phoneScope && missions?.length" class="agent-sidebar__workspace-group" data-group-kind="missions">
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
          <span class="agent-sidebar__workspace-actions agent-sidebar__workspace-actions--persistent">
            <button
              type="button"
              :aria-label="t('missions.new')"
              :title="t('missions.new')"
              :disabled="missionCreationPending"
              @click.stop="emit('create-mission')"
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </span>
        </header>
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
              <MissionProgressIcon :mission="mission" />
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
        v-for="group in workspaceGroups"
        :key="group.id"
        class="agent-sidebar__workspace-group"
        :class="clientRepositoryOrderUpdate.dropTargetClass(group.id)"
        :data-group-kind="group.kind"
        @dragover="group.kind === 'repository' && clientRepositoryOrderUpdate.onDragOver(group.id, $event)"
        @dragleave="group.kind === 'repository' && clientRepositoryOrderUpdate.onDragLeave(group.id, $event)"
        @drop="group.kind === 'repository' && clientRepositoryOrderUpdate.onDrop(group.id, $event)"
      >
        <header
          class="agent-sidebar__workspace-header"
          :data-motion-id="group.id"
          v-bind="group.kind === 'repository' ? clientRepositoryOrderUpdate.dragItemAttributes(group.id) : {}"
          @dragstart="group.kind === 'repository' && clientRepositoryOrderUpdate.onDragStart(group.id, $event)"
          @dragend="clientRepositoryOrderUpdate.onDragEnd"
          @contextmenu="openRepositoryMenu(group, $event)"
        >
          <MessageIcon
            v-if="group.kind === 'quickChats'"
            class="agent-sidebar__workspace-icon"
            data-icon="message"
            aria-hidden="true"
          />
          <FolderIcon
            v-else-if="group.kind === 'folder'"
            class="agent-sidebar__workspace-icon"
            data-icon="folder"
            aria-hidden="true"
          />
          <RepositoryIconPicker
            v-else-if="group.kind === 'repository'"
            :label="group.label"
            :expanded="!isWorkspaceCollapsed(group)"
            :model-value="repositoryIcon(group.repositoryKey, group.repositoryRoot)"
            @update:model-value="updateRepositoryIcon(group.repositoryKey, group.repositoryRoot, $event)"
          />

          <button
            class="agent-sidebar__workspace-label"
            type="button"
            :aria-label="workspaceToggleLabel(group)"
            :aria-expanded="!isWorkspaceCollapsed(group)"
            @click="toggleWorkspace(group)"
          >
            <strong>{{ group.label }}</strong>
          </button>
          <span
            v-if="group.kind === 'quickChats'"
            class="agent-sidebar__workspace-actions agent-sidebar__workspace-actions--persistent"
          >
            <button
              type="button"
              :aria-label="t('sidebar.newQuickChat')"
              :title="t('sidebar.newQuickChat')"
              @click.stop="emit('create-quick-chat')"
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </span>
          <span v-else-if="group.kind === 'repository'" class="agent-sidebar__workspace-actions">
            <button
              type="button"
              :aria-label="t('sidebar.createFromRepository')"
              :title="t('sidebar.createFrom')"
              @click.stop="emit('create-agent-from-repository', { agentId: group.sessions[0]!.agentId, repositoryName: group.label, repositoryRoot: group.repositoryRoot! })"
            >
              <GitForkIcon aria-hidden="true" />
            </button>
            <AppMenuButton
              :open="repositorySessionMenuId === group.id"
              :ariaLabel="t('sidebar.newSessionIn', { repository: group.label })"
              :items="repositorySessionMenuItems(group)"
              :message="repositorySessionMenu.loading.value[group.id] ? t('sidebar.loadingDefaultBranch') : repositorySessionMenu.errors.value[group.id] ?? undefined"
              :message-tone="repositorySessionMenu.errors.value[group.id] ? 'error' : 'default'"
              @update:open="setRepositorySessionMenuVisible(group, $event)"
              @select="selectRepositorySessionMenuItem(group, $event)"
            >
              <template #trigger="{ attrs }">
                <button v-bind="attrs" type="button" :aria-label="t('sidebar.newSessionIn', { repository: group.label })" :title="t('sidebar.newSession')">
                  <PlusIcon aria-hidden="true" />
                </button>
              </template>
            </AppMenuButton>
          </span>
        </header>

        <div class="agent-sidebar__group-rows">
          <div
            v-for="session in group.sessions"
            :key="session.agentId"
            class="agent-sidebar__agent-row"
            :data-motion-id="session.agentId"
          >
            <RepositoryAgentRow
              v-bind="clientAgentOrderUpdate.dragItemAttributes(session.agentId)"
              :session="session"
              :group-kind="group.kind"
              v-show="!isWorkspaceCollapsed(group)"
              class="agent-sidebar__agent"
              :class="[
                { 'agent-sidebar__agent--active': session.isActive, 'agent-sidebar__agent--awaiting-input': session.status.type === 'awaitingInput' },
                clientAgentOrderUpdate.dropTargetClass(session.agentId),
              ]"
              type="button"
              :data-session-kind="session.kind"
              :data-shared="session.shared || undefined"
              :aria-pressed="session.isActive"
              @click="selectAgent(session.agentId)"
              @contextmenu.prevent="openAgentMenu(session.agentId, $event)"
              @dragstart="clientAgentOrderUpdate.onDragStart(session.agentId, $event)"
              @dragover="clientAgentOrderUpdate.onDragOver(session.agentId, $event)"
              @dragleave="clientAgentOrderUpdate.onDragLeave(session.agentId, $event)"
              @drop="clientAgentOrderUpdate.onDrop(session.agentId, $event)"
              @dragend="clientAgentOrderUpdate.onDragEnd"
            >
              <span
                v-if="!session.shared && backendChoices.length > 1 && agentsById.get(session.agentId)"
                class="agent-sidebar__engine"
                role="img"
                :aria-label="backendDisplayName(agentsById.get(session.agentId)!.backend)"
                :title="backendDisplayName(agentsById.get(session.agentId)!.backend)"
              >
                <BackendIcon :backend="agentsById.get(session.agentId)!.backend" monochrome />
              </span>
              <span
                v-if="session.status.type === 'awaitingInput'"
                class="agent-sidebar__input-needed"
                :class="{ 'agent-sidebar__input-needed--with-cleanup': isPullRequestFinished(session) }"
                :title="statusLabel(session.status.type)"
                :aria-label="statusLabel(session.status.type)"
              >{{ t('sidebar.input') }}</span>
              <span
                v-else-if="showQuickSwitchShortcut(session)"
                class="agent-sidebar__quick-switch-shortcut"
                :aria-label="t('sidebar.switchShortcut', { session: session.displayTitle, number: session.quickSwitchIndex + 1 })"
              ><span aria-hidden="true">⌘</span>{{ session.quickSwitchIndex + 1 }}</span>
              <span
                v-else-if="!isPullRequestFinished(session)"
                class="agent-sidebar__status"
                :class="{ 'agent-sidebar__status--unread': session.isUnread }"
                :data-status="session.status.type"
                :aria-label="session.isUnread ? t('sidebar.unread') : statusLabel(session.status.type)"
              />
            </RepositoryAgentRow>
            <el-tooltip
              v-if="isPullRequestFinished(session)"
              :content="pullRequestAttentionLabel(session)"
              placement="right"
              :show-after="300"
            >
              <button
                v-show="!isWorkspaceCollapsed(group)"
                class="agent-sidebar__pull-request-attention"
                type="button"
                :aria-label="pullRequestAttentionLabel(session)"
                @click.stop="emit('cleanup-pull-request', session.agentId)"
              >
                <AlertTriangleIcon aria-hidden="true" />
              </button>
            </el-tooltip>
          </div>
        </div>
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
import MissionProgressIcon from './MissionProgressIcon.vue';
import type { AgentSidebarModel } from './use-agent-sidebar';
import { AlertTriangleIcon, ArrowsSortIcon, FolderIcon, GitForkIcon, MessageIcon, PanelLeftCloseIcon, PlusIcon, TargetArrowIcon } from '../shared/icons/app-icons';
import BackendIcon from './BackendIcon.vue';
import RepositoryIconPicker from './RepositoryIconPicker.vue';
import StartWorkMenu from './StartWorkMenu.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import RepositoryAgentRow from './RepositoryAgentRow.vue';

const props = defineProps<{ model: AgentSidebarModel }>();
const {
  compact,
  sidebarStyle,
  t,
  teamName,
  organizationMenuItems,
  organization,
  emit,
  quickChatGroup,
  phoneScope,
  missions,
  missionCreationPending,
  missionCreationError,
  missionsCollapsed,
  activeMissionId,
  attentionOf,
  openMissionMenu,
  missionStatusLabel,
  missionDotStatus,
  workspaceGroups,
  clientRepositoryOrderUpdate,
  openRepositoryMenu,
  isWorkspaceCollapsed,
  repositoryIcon,
  updateRepositoryIcon,
  workspaceToggleLabel,
  toggleWorkspace,
  repositorySessionMenuId,
  repositorySessionMenuItems,
  repositorySessionMenu,
  setRepositorySessionMenuVisible,
  selectRepositorySessionMenuItem,
  clientAgentOrderUpdate,
  selectAgent,
  openAgentMenu,
  backendChoices,
  agentsById,
  backendDisplayName,
  isPullRequestFinished,
  statusLabel,
  showQuickSwitchShortcut,
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

.agent-sidebar__workspace-group > .agent-sidebar__group-rows {
  display: contents;
}

.agent-sidebar__start-work {
  flex: 0 0 auto;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-6) var(--space-8) var(--space-4);
}

.agent-sidebar__start-work:deep() button {
  padding-left: 0;
  padding-right: 0;
}

.agent-sidebar__mission-action,
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
.agent-sidebar__mission-action:hover,
.agent-sidebar__mission-action:focus-visible,
.agent-sidebar__quick-chat-action:focus-visible {
  color: var(--color-text);
  outline: 0;
}

.agent-sidebar__mission-action svg,
.agent-sidebar__quick-chat-action svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.agent-sidebar__mission-action:disabled {
  cursor: wait;
  opacity: 0.6;
}

.agent-sidebar__workspace-group {
  position: relative;
}

.agent-sidebar__workspace-group[data-group-kind="missions"] .agent-sidebar__agent {
  --agent-sidebar-quick-chat-icon-track: var(--agent-sidebar-repository-icon-column-width);

  padding-left: calc(var(--agent-sidebar-workspace-inline-padding) + var(--space-6));
}

.agent-sidebar__input-needed {
  grid-column: -2;
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  background: var(--color-primary-container);
  font-size: var(--font-size-13);
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
