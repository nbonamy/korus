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

    <div class="agent-sidebar__start-work" :class="{ 'agent-sidebar__start-work--activity': organizationMode === 'activity' }">
      <StartWorkMenu @select="emit('start-work', $event)" />
      <button
        v-if="organizationMode === 'activity' || !quickChatGroup"
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

    <nav ref="sessionList" class="agent-sidebar__list" :class="{ 'agent-sidebar__list--activity': organizationMode === 'activity' }" :aria-label="t('sidebar.workspaceSessions')">
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
              :class="{ 'agent-sidebar__agent--active': activeMissionId === mission.id }"
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
                class="agent-sidebar__status"
                :data-status="mission.status === 'completed' ? 'idle' : 'working'"
                :aria-label="missionProgressLabel(mission)"
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
        :data-activity-group="group.activity"
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
        >
          <MessageIcon
            v-if="group.kind === 'quickChats'"
            class="agent-sidebar__workspace-icon"
            data-icon="message"
            aria-hidden="true"
          />
          <FolderIcon
            v-else-if="group.kind === 'folder' && !group.activity"
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
          <template v-if="group.activity">
            <component :is="activityIcons[group.activity]" class="agent-sidebar__activity-icon" aria-hidden="true" />
            <strong class="agent-sidebar__activity-heading">{{ group.label }}</strong>
            <AppMenuButton
              v-if="group.activity === 'idle'"
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
          </template>
          <button
            v-else
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

        <component
          :is="group.activity ? ScrollHintRows : 'div'"
          :ref="group.activity ? (rows: unknown) => setRowsRef(group.id, rows) : undefined"
          class="agent-sidebar__group-rows"
          @overflow="rowsOverflow[group.id] = $event"
        >
          <div
            v-for="session in group.sessions"
            :key="session.agentId"
            class="agent-sidebar__agent-row"
            :data-motion-id="session.agentId"
          >
            <component
              :is="group.activity ? ActivityAgentRow : RepositoryAgentRow"
              v-bind="{ ...clientAgentOrderUpdate.dragItemAttributes(session.agentId), ...(group.activity
                ? { session, context: activityContext.get(session.agentId), repository: activityRepository.has(session.agentId), repositoryIcon: activityRepository.get(session.agentId), quickChat: agentsById.get(session.agentId)?.sessionKind === 'quickChat', cleanup: isPullRequestFinished(session) && !showQuickSwitchShortcut(session, group.activity), shortcutVisible: showQuickSwitchShortcut(session, group.activity), unreadLabel: t('sidebar.unread'), ...activityIndicator(session, group.activity) }
                : { session, groupKind: group.kind }) }"
              v-show="!isWorkspaceCollapsed(group)"
              class="agent-sidebar__agent"
              :class="[
                { 'agent-sidebar__agent--active': session.isActive, 'agent-sidebar__agent--awaiting-input': session.status.type === 'awaitingInput' },
                clientAgentOrderUpdate.dropTargetClass(session.agentId),
              ]"
              type="button"
              :data-session-kind="session.kind"
              :title="group.activity ? activityContext.get(session.agentId) : undefined"
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
                v-if="backendChoices.length > 1 && agentsById.get(session.agentId) && !(group.activity && showQuickSwitchShortcut(session, group.activity))"
                class="agent-sidebar__engine"
                role="img"
                :aria-label="backendDisplayName(agentsById.get(session.agentId)!.backend)"
                :title="backendDisplayName(agentsById.get(session.agentId)!.backend)"
              >
                <BackendIcon :backend="agentsById.get(session.agentId)!.backend" monochrome />
              </span>
              <span
                v-if="!group.activity && session.status.type === 'awaitingInput'"
                class="agent-sidebar__input-needed"
                :class="{ 'agent-sidebar__input-needed--with-cleanup': isPullRequestFinished(session) }"
                :title="statusLabel(session.status.type)"
                :aria-label="statusLabel(session.status.type)"
              >{{ t('sidebar.input') }}</span>
              <span
                v-else-if="showQuickSwitchShortcut(session, group.activity)"
                class="agent-sidebar__quick-switch-shortcut"
                :aria-label="t('sidebar.switchShortcut', { session: session.displayTitle, number: session.quickSwitchIndex + 1 })"
              ><span aria-hidden="true">⌘</span>{{ session.quickSwitchIndex + 1 }}</span>
              <span
                v-else-if="!group.activity && !isPullRequestFinished(session)"
                class="agent-sidebar__status"
                :class="{ 'agent-sidebar__status--unread': session.isUnread }"
                :data-status="session.status.type"
                :aria-label="session.isUnread ? t('sidebar.unread') : statusLabel(session.status.type)"
              />
            </component>
            <el-tooltip
              v-if="isPullRequestFinished(session) && !(group.activity && showQuickSwitchShortcut(session, group.activity))"
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
        </component>
      </section>
    </nav>

    <AgentContextMenu
      v-if="contextMenuAgentId"
      :fork-disabled="!canForkContextMenuAgent"
      :compress-visible="canReplaceContextMenuConversation"
      :compress-disabled="!canCompressContextMenuAgent"
      :compact-disabled="!canCompactContextMenuAgent"
      :open-in-catalog="resolvedOpenInCatalog"
      :open-in-disabled="!contextMenuAgentIsLocal"
      :move-targets="contextMenuMoveTargets"
      :x="contextMenuPosition.x"
      :y="contextMenuPosition.y"
      @action="emitContextAgentAction"
      @move-agent-to-team="emitContextAgentMove"
      @open-in="emitContextAgentOpenIn"
      @close="closeContextMenu"
    />

    <MissionContextMenu
      v-if="contextMenuMissionId"
      :x="contextMenuPosition.x"
      :y="contextMenuPosition.y"
      @delete="deleteContextMission"
      @close="closeMissionContextMenu"
    />

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
import type { Mission } from '@workspace/core/missions';
import { missionWorkflow } from '@workspace/core/mission-workflows';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, OpenInApplication, OpenInApplicationCatalog, ReorderAgentsInput, ReorderRepositoriesInput, SourceBranch, Team } from '@workspace/core/contracts';
import { projectWorkspaceSidebar, type SidebarActivity, type WorkspaceSidebarGroup, type WorkspaceSidebarSession } from '@workspace/core/workspace-sidebar';
import { formatCompactAge, formatElapsed } from '../shared/compact-age';
import {
  AlertTriangleIcon,
  ArrowsSortIcon,
  BellIcon,
  CarouselVerticalIcon,
  CircleCheckIcon,
  ClockHour8Icon,
  LoaderIcon,
  MoonIcon,
  FolderIcon,
  GitBranchIcon,
  GitForkIcon,
  MessageIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  TargetArrowIcon,
} from '../shared/icons/app-icons';
import AgentContextMenu from './AgentContextMenu.vue';
import BackendIcon from './BackendIcon.vue';
import { useBackendChoices } from './backend-selection';
import { backendDisplayName } from '@workspace/core/backend-driver';
import MissionContextMenu from './MissionContextMenu.vue';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { defaultBackendCommands } from '@workspace/core/backend-commands';
import type { AgentContextMenuAction } from './AgentContextMenu.vue';
import RepositoryIconPicker from './RepositoryIconPicker.vue';
import StartWorkMenu from './StartWorkMenu.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { useListReorderDrag } from '../shared/use-list-reorder-drag';
import { useRepositorySessionMenu } from './use-repository-session-menu';
import { useAgentSidebarOrganization } from './use-agent-sidebar-organization';
import { useAgentSidebarMotion } from './use-agent-sidebar-motion';
import ActivityAgentRow from './ActivityAgentRow.vue';
import ScrollHintRows from './ScrollHintRows.vue';
import RepositoryAgentRow from './RepositoryAgentRow.vue';

const props = defineProps<{
  agents: Agent[];
  missions?: Mission[];
  activeMissionId?: string | null;
  activeAgentId: string | null;
  unreadAgentIds?: string[];
  forkableAgentIds?: string[];
  summaryReplacementAgentIds?: string[];
  compact?: boolean;
  collapsedRepositoryKeys?: string[];
  teams?: Team[];
  teamId?: string | null;
  teamName: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  missionCreationError?: string;
  missionCreationPending?: boolean;
  /** Phones expose conversations and the cockpit only. */
  phoneScope?: boolean;
  quickSwitchShortcutsVisible?: boolean;
  repositoryIcons?: Record<string, string>;
  listRepositoryBranches?: (input: { agentId: string; repositoryRoot: string }) => Promise<SourceBranch[]>;
  openInCatalog?: OpenInApplicationCatalog;
}>();

const { t } = useI18n();

const emit = defineEmits<{
  'collapse-sidebar': [];
  'close-agent': [agentId: string];
  'compress-session': [agentId: string];
  'compact-session': [agentId: string];
  'cleanup-pull-request': [agentId: string];
  'update-collapsed-repositories': [repositoryKeys: string[]];
  'create-agent-from-repository': [payload: { agentId: string; repositoryName: string; repositoryRoot: string }];
  'create-agent-on-branch': [payload: { agentId: string; repositoryName: string; repositoryRoot: string; branch: SourceBranch }];
  'create-agent-worktree-in-repository': [payload: { agentId: string; repositoryName: string; repositoryRoot: string }];
  'duplicate-agent': [agentId: string];
  'fork-agent': [agentId: string];
  'handoff-agent': [agentId: string];
  'edit-agent': [agentId: string];
  'move-agent-to-team': [payload: { agentId: string; teamId: string }];
  'open-in': [payload: { agentId: string; application: OpenInApplication }];
  'reorder-agents': [payload: ReorderAgentsInput];
  'reorder-repositories': [payload: ReorderRepositoriesInput];
  'resize-sidebar': [width: number];
  'resume-session': [agentId: string];
  'restart-agent': [agentId: string];
  'select-agent': [agentId: string];
  'start-work': [action: 'new' | 'github' | 'local' | 'url'];
  'create-quick-chat': [];
  'create-mission': [];
  'delete-mission': [id: string];
  'select-mission': [id: string];
  'update-repository-icon': [payload: { repositoryKey: string; repositoryRoot: string; icon: string | undefined }];
}>();

const missionsCollapsed = ref(false);
const activityIcons = { attention: BellIcon, recent: CircleCheckIcon, working: LoaderIcon, idle: MoonIcon };
const organizationMenuItems = computed<AppMenuItem[]>(() => [
  { id: 'repository', type: 'radio', checked: organizationMode.value === 'repository', label: t('sidebar.repository'), icon: FolderIcon },
  { id: 'activity', type: 'radio', checked: organizationMode.value === 'activity', label: t('sidebar.activity'), icon: BellIcon },
]);
const minWidth = computed(() => props.minWidth ?? 200);
const maxWidth = computed(() => props.maxWidth ?? 420);
const resizeStep = 16;
const currentWidth = computed(() => clampWidth(props.width ?? 260));
const resolvedOpenInCatalog = computed<OpenInApplicationCatalog>(() => props.openInCatalog ?? ({
  defaultApplication: 'finder',
  applications: [],
}));
const repositoryGroups = computed(() => projectWorkspaceSidebar({
  agents: props.agents,
  activeAgentId: props.activeAgentId,
  quickChatsLabel: t('sidebar.chats'),
  unreadAgentIds: props.unreadAgentIds,
}).sort((left, right) => Number(right.kind === 'quickChats') - Number(left.kind === 'quickChats')));
const organization = useAgentSidebarOrganization({
  teamId: () => props.teamId, agents: () => props.agents, repositoryGroups: () => repositoryGroups.value,
  label: activity => t(`sidebar.activityGroups.${activity}`),
});
const organizationMode = organization.mode;
const idleSortMenuItems = computed<AppMenuItem[]>(() => [
  { id: 'repository', type: 'radio', checked: organization.idleSort.value === 'repository', label: t('sidebar.repository'), icon: FolderIcon },
  { id: 'activity', type: 'radio', checked: organization.idleSort.value === 'activity', label: t('sidebar.recentActivity'), icon: ClockHour8Icon },
]);
const workspaceGroups = computed(() => {
  let index = 0;
  return organization.groups.value.map(group => group.activity
    ? { ...group, sessions: group.sessions.map(session => ({ ...session, quickSwitchIndex: index++ })) }
    : group);
});
const quickSwitchAgentIds = computed(() => workspaceGroups.value.flatMap(group => group.sessions)
  .sort((a, b) => a.quickSwitchIndex - b.quickSwitchIndex).map(session => session.agentId));
defineExpose({ quickSwitchAgentIds });
function showQuickSwitchShortcut(session: WorkspaceSidebarSession, activity?: SidebarActivity): boolean {
  return Boolean(props.quickSwitchShortcutsVisible && session.quickSwitchIndex < 9
    && (activity || (!isPullRequestFinished(session) && !session.isUnread)));
}
function activityAge(agentId: string, activity: SidebarActivity | undefined): string | undefined {
  const agent = agentsById.value.get(agentId);
  if (!agent) return undefined;
  const last = agent.hasSubmittedPrompt && agent.lastActivityAt ? agent.lastActivityAt : agent.createdAt;
  return activity === 'working' ? formatElapsed(last, organization.now.value)
    : formatCompactAge(last, organization.now.value, t('sidebar.justNow'));
}

/**
 * The single trailing indicator of an activity row: Done and Idle show an unread dot or else an
 * age; Needs input and Working always show one (how long it has waited or been working).
 */
function activityIndicator(session: WorkspaceSidebarSession, activity: SidebarActivity | undefined): { unread?: boolean; age?: string } {
  if (!activity) return {};
  return (activity === 'recent' || activity === 'idle') && session.isUnread ? { unread: true } : { age: activityAge(session.agentId, activity) };
}
const activityContext = computed(() => new Map(repositoryGroups.value.flatMap(group => group.sessions.map(session => [session.agentId, group.label]))));
/** Repository sessions only; the value is that repository's custom icon, when it has one. */
const activityRepository = computed(() => new Map(repositoryGroups.value.flatMap(group => group.kind !== 'repository' ? []
  : group.sessions.map(session => [session.agentId, repositoryIcon(group.repositoryKey, group.repositoryRoot)] as const))));
const rowsRefs = new Map<string, InstanceType<typeof ScrollHintRows>>();
const rowsOverflow = ref<Record<string, { up: boolean; down: boolean }>>({});
function setRowsRef(groupId: string, rows: unknown): void {
  if (rows) rowsRefs.set(groupId, rows as InstanceType<typeof ScrollHintRows>);
  else rowsRefs.delete(groupId);
}
function moreRowsLabel(groupId: string): string | undefined {
  const state = rowsOverflow.value[groupId];
  return state?.down ? t('sidebar.showMoreRows') : state?.up ? t('sidebar.backToTop') : undefined;
}
const sessionList = ref<HTMLElement | null>(null);
useAgentSidebarMotion(sessionList,
  () => organizationMode.value === 'activity' ? props.teamId ?? '' : null,
  () => workspaceGroups.value.map(group => `${group.id}:${group.sessions.map(session => session.agentId).join(',')}`).join('|'));
const agentsById = computed(() => new Map(props.agents.map(agent => [agent.id, agent])));
const backendChoices = useBackendChoices(() => props.teamId);
const quickChatGroup = computed(() => repositoryGroups.value.find((group) => group.kind === 'quickChats') ?? null);
const contextMenuAgentId = ref<string | null>(null);
const contextMenuMissionId = ref<string | null>(null);
const repositorySessionMenu = useRepositorySessionMenu(() => props.listRepositoryBranches, t);
const repositorySessionMenuId = repositorySessionMenu.visibleGroupId;
const collapsedRepositoryKeys = computed(() => new Set(props.collapsedRepositoryKeys ?? []));
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuAgent = computed(() => (
  contextMenuAgentId.value ? props.agents.find((agent) => agent.id === contextMenuAgentId.value) ?? null : null
));
const canForkContextMenuAgent = computed(() => (
  contextMenuAgent.value?.status.type === 'idle' &&
  Boolean(contextMenuAgent.value.backendSession) &&
  (props.forkableAgentIds ?? []).includes(contextMenuAgent.value.id)
));
const canCompressContextMenuAgent = computed(() => (
  canReplaceContextMenuConversation.value &&
  contextMenuAgent.value?.status.type === 'idle' &&
  Boolean(contextMenuAgent.value.backendSession)
));
const canCompactContextMenuAgent = computed(() => (
  contextMenuAgent.value?.status.type === 'idle' &&
  Boolean(contextMenuAgent.value.backendSession) &&
  defaultBackendCommands(contextMenuAgent.value.backend).some(command => command.slashName === 'compact')
));
const canReplaceContextMenuConversation = computed(() => {
  const agent = contextMenuAgent.value;
  return Boolean(agent && (props.summaryReplacementAgentIds
    ? props.summaryReplacementAgentIds.includes(agent.id)
    : defaultBackendCapabilities(agent.backend).conversationReplaceWithSummary));
});
const contextMenuAgentIsLocal = computed(() => {
  const agent = contextMenuAgent.value;
  if (!agent) return false;
  const team = (props.teams ?? []).find((candidate) => candidate.id === agent.teamId);
  return !team?.remoteConnectionId;
});
const contextMenuMoveTargets = computed(() => {
  const agent = contextMenuAgent.value;
  if (!agent) {
    return [];
  }
  const sourceTeam = (props.teams ?? []).find((team) => team.id === agent.teamId) ?? null;
  if (sourceTeam?.remoteConnectionId) {
    return [];
  }

  return (props.teams ?? []).filter((team) => team.id !== agent.teamId && !team.remoteConnectionId);
});
const clientAgentOrderUpdate = useListReorderDrag<string>({
  itemIds: () => props.agents.map((agent) => agent.id),
  scopeForId: (agentId) => organizationMode.value === 'activity' ? agentId : agentWorkspaceGroupIds.value.get(agentId) ?? agentId,
  onDrop: ({ draggedId, beforeId }) => {
    if (!props.teamId) {
      return;
    }

    emit('reorder-agents', {
      teamId: props.teamId,
      agentId: draggedId,
      beforeAgentId: beforeId,
    });
  },
});
const agentWorkspaceGroupIds = computed(() => new Map(
  workspaceGroups.value.flatMap((group) => group.sessions.map((session) => [session.agentId, group.id] as const)),
));
const clientRepositoryOrderUpdate = useListReorderDrag<string>({
  itemIds: () => workspaceGroups.value
    .filter((group) => group.kind === 'repository')
    .map((group) => group.id),
  onDrop: ({ draggedId, beforeId }) => {
    if (!props.teamId) return;
    const repository = workspaceGroups.value.find((group) => group.id === draggedId);
    const beforeRepository = beforeId === null
      ? null
      : workspaceGroups.value.find((group) => group.id === beforeId) ?? null;
    if (repository?.kind !== 'repository' || !repository.repositoryRoot) return;

    emit('reorder-repositories', {
      teamId: props.teamId,
      repositoryRoot: repository.repositoryRoot,
      beforeRepositoryRoot: beforeRepository?.repositoryRoot ?? null,
    });
  },
});
const sidebarStyle = computed<Record<string, string>>(() => ({
  '--agent-sidebar-width': `${currentWidth.value}px`,
  '--agent-sidebar-min-width': `${minWidth.value}px`,
  '--agent-sidebar-max-width': `${maxWidth.value}px`,
}));
let resizeStart: { pointerId: number; clientX: number; width: number } | null = null;

function clampWidth(width: number): number {
  return Math.min(Math.max(Math.round(width), minWidth.value), maxWidth.value);
}

function emitResizedWidth(width: number): void {
  emit('resize-sidebar', clampWidth(width));
}

function selectAgent(agentId: string): void {
  emit('select-agent', agentId);
}

function workspaceCollapseKey(group: WorkspaceSidebarGroup): string {
  return group.repositoryKey ?? group.id;
}

function isWorkspaceCollapsed(group: WorkspaceSidebarGroup): boolean {
  if (group.id.startsWith('activity:')) return false;
  return collapsedRepositoryKeys.value.has(workspaceCollapseKey(group));
}

function workspaceToggleLabel(group: WorkspaceSidebarGroup): string {
  if (group.kind === 'quickChats') {
    return t(isWorkspaceCollapsed(group) ? 'sidebar.expandChats' : 'sidebar.collapseChats');
  }
  if (group.kind === 'folder') {
    return t(isWorkspaceCollapsed(group) ? 'sidebar.expandFolder' : 'sidebar.collapseFolder', { folder: group.label });
  }
  return t(isWorkspaceCollapsed(group) ? 'sidebar.expandRepository' : 'sidebar.collapseRepository', { repository: group.label });
}

function toggleWorkspace(group: WorkspaceSidebarGroup): void {
  const key = workspaceCollapseKey(group);
  const next = new Set(collapsedRepositoryKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  emit('update-collapsed-repositories', [...next]);
}

function repositoryIcon(repositoryKey: string | undefined, repositoryRoot: string | undefined): string | undefined {
  if (!repositoryRoot) return undefined;
  return props.repositoryIcons?.[repositoryKey ?? repositoryRoot] ?? props.repositoryIcons?.[repositoryRoot];
}

function updateRepositoryIcon(repositoryKey: string | undefined, repositoryRoot: string | undefined, icon: string | undefined): void {
  if (!repositoryRoot) return;
  emit('update-repository-icon', { repositoryKey: repositoryKey ?? repositoryRoot, repositoryRoot, icon });
}

async function setRepositorySessionMenuVisible(
  group: WorkspaceSidebarGroup,
  visible: boolean,
): Promise<void> {
  await repositorySessionMenu.setVisible(group, visible);
}

function repositorySessionMenuItems(
  group: WorkspaceSidebarGroup,
): AppMenuItem[] {
  const defaultBranch = repositorySessionMenu.defaultBranches.value[group.id];
  return [
    {
      id: 'default-branch',
      type: 'action',
      label: defaultBranch?.name ?? t('sidebar.defaultBranchUnavailable'),
      icon: GitBranchIcon,
      disabled: !defaultBranch,
    },
    { id: 'new-worktree', type: 'action', label: t('sidebar.newWorktree'), icon: GitForkIcon },
  ];
}

function statusLabel(status: Agent['status']['type']): string {
  return t(`status.${status}`);
}

function missionProgressLabel(mission: Mission): string {
  if (mission.status === 'completed') return t('missions.completed');
  const stages = missionWorkflow(mission.workflow.type).stages;
  return `${stages.indexOf(mission.stage) + 1}/${stages.length} · ${t(`missions.${mission.stage}`)}`;
}

function isPullRequestFinished(session: WorkspaceSidebarSession): boolean {
  return session.pullRequest?.state === 'merged' || session.pullRequest?.state === 'closed';
}

function pullRequestAttentionLabel(session: WorkspaceSidebarSession): string {
  const pullRequest = session.pullRequest;
  if (!pullRequest) return '';
  return t(
    pullRequest.state === 'closed' ? 'sidebar.pullRequestClosedCleanup' : 'sidebar.pullRequestMergedCleanup',
    { number: pullRequest.number },
  );
}

function selectRepositorySessionMenuItem(
  group: WorkspaceSidebarGroup,
  itemId: string,
): void {
  if (group.kind !== 'repository' || !group.repositoryRoot) return;
  const payload = {
    agentId: group.sessions[0]!.agentId,
    repositoryName: group.label,
    repositoryRoot: group.repositoryRoot!,
  };
  if (itemId === 'default-branch') {
    const branch = repositorySessionMenu.defaultBranches.value[group.id];
    if (branch) {
      emit('create-agent-on-branch', { ...payload, branch });
    }
  } else if (itemId === 'new-worktree') {
    emit('create-agent-worktree-in-repository', payload);
  }
  repositorySessionMenuId.value = null;
}

function openAgentMenu(agentId: string, event: MouseEvent): void {
  contextMenuMissionId.value = null;
  contextMenuAgentId.value = agentId;
  contextMenuPosition.value = {
    x: event.clientX,
    y: event.clientY,
  };
}

function openMissionMenu(missionId: string, event: MouseEvent): void {
  contextMenuAgentId.value = null;
  contextMenuMissionId.value = missionId;
  contextMenuPosition.value = {
    x: event.clientX,
    y: event.clientY,
  };
}

function deleteContextMission(): void {
  const missionId = contextMenuMissionId.value;
  if (!missionId) return;
  emit('delete-mission', missionId);
  closeMissionContextMenu();
}

function closeMissionContextMenu(): void {
  contextMenuMissionId.value = null;
}

function emitContextAgentAction(action: AgentContextMenuAction): void {
  const agentId = contextMenuAgentId.value;
  if (!agentId) {
    return;
  }

  switch (action) {
    case 'close-agent':
      emit('close-agent', agentId);
      break;
    case 'duplicate-agent':
      emit('duplicate-agent', agentId);
      break;
    case 'compress-session':
      emit('compress-session', agentId);
      break;
    case 'compact-session':
      emit('compact-session', agentId);
      break;
    case 'fork-agent':
      emit('fork-agent', agentId);
      break;
    case 'handoff-agent':
      emit('handoff-agent', agentId);
      break;
    case 'edit-agent':
      emit('edit-agent', agentId);
      break;
    case 'resume-session':
      emit('resume-session', agentId);
      break;
    case 'restart-agent':
      emit('restart-agent', agentId);
      break;
  }
  closeContextMenu();
}

function emitContextAgentMove(teamId: string): void {
  const agentId = contextMenuAgentId.value;
  if (!agentId) {
    return;
  }

  emit('move-agent-to-team', { agentId, teamId });
  closeContextMenu();
}

function emitContextAgentOpenIn(application: OpenInApplication): void {
  const agentId = contextMenuAgentId.value;
  if (!agentId) return;
  emit('open-in', { agentId, application });
  closeContextMenu();
}

function closeContextMenu(): void {
  contextMenuAgentId.value = null;
}

function resizeHandle(event: PointerEvent): HTMLElement | null {
  return event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
}

function onResizePointerDown(event: PointerEvent): void {
  event.preventDefault();
  resizeStart = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    width: currentWidth.value,
  };
  resizeHandle(event)?.setPointerCapture?.(event.pointerId);
}

function onResizePointerMove(event: PointerEvent): void {
  if (!resizeStart || event.pointerId !== resizeStart.pointerId) {
    return;
  }

  emitResizedWidth(resizeStart.width + event.clientX - resizeStart.clientX);
}

function onResizePointerEnd(event: PointerEvent): void {
  if (!resizeStart || event.pointerId !== resizeStart.pointerId) {
    return;
  }

  resizeHandle(event)?.releasePointerCapture?.(event.pointerId);
  resizeStart = null;
}
</script>

<style scoped src="./agent-row.css"></style>
<style scoped>
.agent-sidebar {
  --agent-sidebar-width: 260px;
  --agent-sidebar-min-width: 200px;
  --agent-sidebar-max-width: 420px;
  --agent-sidebar-row-min-height: 30px;
  --agent-sidebar-workspace-icon-size: 16px;
  --agent-sidebar-repository-icon-size: 20px;
  --agent-sidebar-repository-icon-column-width: 24px;
  --agent-sidebar-workspace-column-gap: 4px;
  --agent-sidebar-workspace-inline-padding: 4px;
  --agent-sidebar-status-column-width: 12px;
  --agent-status-dot-size: 8px;
  position: relative;
  container-type: inline-size;
  flex: 0 0
    clamp(
      var(--agent-sidebar-min-width),
      var(--agent-sidebar-width),
      var(--agent-sidebar-max-width)
    );
  width: clamp(
    var(--agent-sidebar-min-width),
    var(--agent-sidebar-width),
    var(--agent-sidebar-max-width)
  );
  min-width: var(--agent-sidebar-min-width);
  max-width: var(--agent-sidebar-max-width);
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* Paint the header and body in one layer so their translucent tints never stack. */
  background: linear-gradient(
    to bottom,
    var(--color-shell-rail) 0 var(--workbench-appbar-height),
    var(--color-shell-sidebar) var(--workbench-appbar-height) 100%
  );
  user-select: none;
}

.agent-sidebar__header {
  height: var(--workbench-appbar-height);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-6);
  min-width: 0;
  padding-left: var(--space-16);
  padding-right: var(--space-8);
  color: var(--color-text);
  border-bottom: 1px solid var(--color-shell-appbar-divider);
  -webkit-app-region: drag;
}

.agent-sidebar__header-action {
  width: var(--space-12);
  height: var(--space-12);
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.agent-sidebar__header-action:hover {
  color: var(--color-text);
  background: var(--color-surface-base);
}

.agent-sidebar__header-action svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.agent-sidebar__header strong {
  margin-right: auto;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-16);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-sidebar__collapse {
  width: var(--space-12);
  height: var(--space-12);
  display: grid;
  place-items: center;
  margin-left: 0;
  padding: 0;
  border: none;
  background: transparent;
  -webkit-app-region: no-drag;
}

.agent-sidebar__collapse:hover {
  background: var(--color-surface-base);
}

.agent-sidebar__collapse:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.agent-sidebar__collapse-icon {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

.agent-sidebar__list {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: var(--space-3) var(--space-4);
}

.agent-sidebar__list::-webkit-scrollbar {
  width: 3px;
  height: 3px;
}

.agent-sidebar__list::-webkit-scrollbar-thumb {
  border-radius: var(--radius-full);
  background: transparent;
}

.agent-sidebar__list:hover::-webkit-scrollbar-thumb,
.agent-sidebar__list:has(:focus-visible)::-webkit-scrollbar-thumb {
  background: var(--color-outline);
}

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
  flex: 0 0 auto;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-6) var(--space-8) var(--space-4);
}

/* Activity mode lays the actions out as a row of icon-over-label tiles. */
.agent-sidebar__start-work--activity {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-inline: var(--space-4);
}

.agent-sidebar__start-work--activity > button,
.agent-sidebar__start-work--activity :deep(.start-work-menu__trigger) {
  flex: 1 1 0;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-2);
  font-size: var(--font-size-12);
  text-align: center;
}

/* min-content stacks each word on its own line, so two-word labels always take two lines. */
.agent-sidebar__start-work--activity > button > span,
.agent-sidebar__start-work--activity :deep(.start-work-menu__trigger > span) {
  display: -webkit-box;
  width: min-content;
  max-width: 100%;
  min-height: calc(2 * var(--line-height-16));
  overflow: hidden;
  line-height: var(--line-height-16);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.agent-sidebar__start-work--activity > .agent-sidebar__mission-error {
  flex-basis: 100%;
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

.agent-sidebar__mission-error {
  margin: 0;
  color: var(--color-error);
  font-size: var(--font-size-12);
}

.agent-sidebar__workspace-group + .agent-sidebar__workspace-group {
  margin-top: var(--space-2);
}

/* Sections have no frame: a colored rail plus the tinted header band mark where each one starts and ends. */
.agent-sidebar__workspace-group[data-activity-group] {
  display: flex;
  flex-direction: column;
  min-height: var(--section-floor, 0);
  margin-left: var(--space-2);
  padding-left: var(--space-6);
}

/* Activity rows and sections never reorder. Their drop indicators would stick out 2px past each row, which counts as scroll overflow, so the rail reuses the section's ::before instead. */
.agent-sidebar__workspace-group[data-activity-group] .agent-sidebar__agent::before,
.agent-sidebar__workspace-group[data-activity-group] .agent-sidebar__agent::after {
  display: none;
}

.agent-sidebar__workspace-group[data-activity-group]::before {
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

.agent-sidebar__workspace-group[data-activity-group] + .agent-sidebar__workspace-group[data-activity-group] {
  margin-top: var(--space-6);
}

.agent-sidebar__workspace-group {
  position: relative;
}

.agent-sidebar__workspace-header {
  box-sizing: border-box;
  min-width: 0;
  display: grid;
  grid-template-columns:
    var(--agent-sidebar-repository-icon-column-width)
    minmax(0, 1fr)
    auto;
  align-items: center;
  gap: var(--agent-sidebar-workspace-column-gap);
  min-height: 30px;
  padding: 2px var(--agent-sidebar-workspace-inline-padding);
  color: var(--color-text);
}

.agent-sidebar__workspace-label,
.agent-sidebar__workspace-actions button {
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.agent-sidebar__workspace-label {
  display: flex;
  min-width: 0;
  min-height: var(--agent-sidebar-row-min-height);
  overflow: hidden;
  justify-content: flex-start;
  border-radius: var(--radius-sm);
  text-align: left;
}

.agent-sidebar__workspace-label:hover,
.agent-sidebar__workspace-label:focus-visible {
  color: var(--color-text);
}

.agent-sidebar__workspace-label:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.agent-sidebar__workspace-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 100ms ease;
}

.agent-sidebar__workspace-header:hover .agent-sidebar__workspace-actions {
  opacity: 1;
}

.agent-sidebar__workspace-actions--persistent {
  opacity: 1;
}

.agent-sidebar__workspace-actions button {
  width: var(--space-12);
  height: var(--space-12);
  border-radius: var(--radius-sm);
}

.agent-sidebar__workspace-actions svg {
  width: calc(var(--icon-sm) + 2px);
  height: calc(var(--icon-sm) + 2px);
}

.agent-sidebar__workspace-actions button:hover {
  color: var(--color-text);
  background: var(--color-surface-base);
}

.agent-sidebar__workspace-icon {
  width: var(--agent-sidebar-repository-icon-size);
  height: var(--agent-sidebar-repository-icon-size);
  color: var(--color-text-muted);
  stroke-width: 1.8;
  justify-self: center;
}

.agent-sidebar__workspace-label strong {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-18);
  text-overflow: ellipsis;
  white-space: nowrap;
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

.agent-sidebar__workspace-group[data-activity-group] .agent-sidebar__workspace-header {
  display: flex;
  gap: var(--space-4);
  margin: 0 0 var(--space-2);
  padding: calc(var(--space-4) + var(--space-2)) calc(var(--space-6) + var(--space-2));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-border) 35%, transparent);
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

.agent-sidebar__agent {
  position: relative;
  width: 100%;
  min-height: var(--agent-sidebar-row-min-height);
  display: grid;
  grid-template-columns:
    var(--agent-sidebar-repository-icon-column-width) minmax(0, 1fr)
    var(--agent-sidebar-engine-track,)
    var(--agent-sidebar-trailing-column-width, var(--agent-sidebar-status-column-width));
  align-items: center;
  gap: var(--agent-sidebar-workspace-column-gap);
  margin: 0;
  padding: 1px var(--space-6) 1px
    calc(var(--agent-sidebar-workspace-inline-padding) + var(--space-6));
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.agent-sidebar__agent-row {
  position: relative;
}

.agent-sidebar__agent--awaiting-input {
  --agent-sidebar-trailing-column-width: max-content;
}

.agent-sidebar__agent:has(.agent-sidebar__quick-switch-shortcut) {
  --agent-sidebar-trailing-column-width: 28px;
}

.agent-sidebar__agent-row:hover .agent-sidebar__agent:has(.agent-sidebar__engine) {
  --agent-sidebar-engine-track: 18px;
}

.agent-sidebar__pull-request-attention {
  position: absolute;
  top: 50%;
  right: calc(
    var(--space-6) +
      (var(--agent-sidebar-status-column-width) - var(--agent-status-dot-size)) / 2 +
      1px
  );
  display: grid;
  place-items: center;
  width: var(--agent-sidebar-status-column-width);
  height: var(--line-height-18);
  padding: 0;
  border: 0;
  color: var(--color-warning);
  background: transparent;
  transform: translateY(-50%);
  cursor: pointer;
}

.agent-sidebar__pull-request-attention svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  stroke-width: 2;
}

.agent-sidebar__pull-request-attention:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.agent-sidebar__workspace-group[data-group-kind="quickChats"]
  .agent-sidebar__repository-agent,
.agent-sidebar__workspace-group[data-group-kind="folder"]
  .agent-sidebar__repository-agent,
.agent-sidebar__workspace-group[data-group-kind="missions"]
  .agent-sidebar__agent {
  grid-template-columns: 0 minmax(0, 1fr)
    var(--agent-sidebar-engine-track,)
    var(--agent-sidebar-trailing-column-width, var(--agent-sidebar-status-column-width));
  padding-left: calc(
    var(--agent-sidebar-workspace-inline-padding) + var(--space-10)
  );
}

.agent-sidebar__workspace-group::before,
.agent-sidebar__workspace-group::after,
.agent-sidebar__agent::before,
.agent-sidebar__agent::after {
  content: "";
  position: absolute;
  left: var(--space-6);
  right: var(--space-6);
  height: 3px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-shell-sidebar);
  opacity: 0;
  transform: scaleX(0.92);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
  pointer-events: none;
}

.agent-sidebar__workspace-group::before,
.agent-sidebar__agent::before {
  top: -2px;
}

.agent-sidebar__workspace-group::after,
.agent-sidebar__agent::after {
  bottom: -2px;
}

.agent-sidebar__workspace-group.list-reorder-drag--drop-before::before,
.agent-sidebar__workspace-group.list-reorder-drag--drop-after::after,
.agent-sidebar__agent.list-reorder-drag--drop-before::before,
.agent-sidebar__agent.list-reorder-drag--drop-after::after {
  opacity: 1;
  transform: scaleX(1);
}

.agent-sidebar__workspace-group.list-reorder-drag--dragging,
.agent-sidebar__agent.list-reorder-drag--dragging {
  opacity: 0.48;
}

.agent-sidebar__agent--active {
  background: color-mix(in srgb, var(--color-surface-base) 72%, transparent);
}


.agent-sidebar__status {
  grid-column: -2;
  width: var(--agent-status-dot-size);
  height: var(--agent-status-dot-size);
  border-radius: var(--radius-full);
  background: var(--color-success);
}

.agent-sidebar__agent-row:not(:hover)
  .agent-sidebar__status[data-status="idle"]:not(.agent-sidebar__status--unread) {
  visibility: hidden;
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

.agent-sidebar__input-needed--with-cleanup {
  margin-right: calc(var(--agent-sidebar-status-column-width) + var(--space-4));
}

.agent-sidebar__engine {
  grid-column: 3;
  display: none;
  place-items: center;
  color: var(--color-text-muted);
}

.agent-sidebar__agent-row:hover .agent-sidebar__engine {
  display: grid;
}

.agent-sidebar__status[data-status="working"],
.agent-sidebar__status[data-status="awaitingInput"] {
  background: var(--color-warning);
}

.agent-sidebar__status[data-status="error"] {
  background: var(--color-error);
}

.agent-sidebar__status.agent-sidebar__status--unread {
  background: var(--color-error);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-error) 20%, transparent);
}

.agent-sidebar__quick-switch-shortcut {
  grid-column: -2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 28px;
  height: var(--line-height-18);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: var(--color-surface-base);
  font-size: var(--font-size-11);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-18);
  white-space: nowrap;
}

.agent-sidebar--compact {
  --agent-sidebar-row-min-height: 28px;
  --agent-sidebar-workspace-icon-size: 16px;
  --agent-sidebar-repository-icon-size: 20px;
  --agent-sidebar-status-column-width: var(--space-4);
  --agent-status-dot-size: var(--space-4);
}

.agent-sidebar--compact .agent-sidebar__agent {
  padding-top: 1px;
  padding-bottom: 1px;
}

.agent-sidebar--compact :deep(.agent-sidebar__meta) {
  display: block;
}

.agent-sidebar--compact :deep(.agent-sidebar__session-title) {
  display: block;
  font-size: var(--font-size-14);
  line-height: var(--line-height-18);
}

.agent-sidebar__resize-handle {
  position: absolute;
  z-index: 2;
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  outline: none;
  -webkit-app-region: no-drag;
}

.agent-sidebar__resize-handle::after {
  content: "";
  position: absolute;
  top: 0;
  right: 3px;
  width: 1px;
  height: 100%;
  background: transparent;
}

.agent-sidebar__resize-handle:hover::after,
.agent-sidebar__resize-handle:focus-visible::after {
  background: var(--color-resize-handle-hover);
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
