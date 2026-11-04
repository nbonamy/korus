<template>
  <TeamRail
    v-if="!hideTeamRail"
    :teams="snapshot.teams"
    :unread-team-ids="unreadTeamIds"
    :working-team-ids="workingTeamIds"
    :active-team-id="backlogVisible || cockpitVisible || automationsVisible || settingsVisible ? null : (activeTeam?.id ?? null)"
    :backlog-active="backlogVisible"
    :cockpit-active="cockpitVisible"
    :automations-active="automationsVisible"
    :settings-active="settingsVisible"
    :spoken-announcements-enabled="snapshot.general.spokenAnnouncementsEnabled"
    :spoken-announcements-muted="snapshot.general.spokenAnnouncementsMuted"
    :agent-sidebar-expanded="showAgentSidebar"
    :rate-limits="snapshot.accountRateLimits"
    :enabled-backends="enabledAgentBackends(snapshot)"
    :backend-rate-limits="snapshot.backendAccountRateLimits"
    :account="authentication?.account ?? null"
    :phone-scope="phoneScope"
    class="app-shell__team-rail"
    @close-team="$emit('close-team', $event)"
    @edit-team="openEditTeam"
    @new-team="openNewTeam"
    @open-team-window="$emit('open-team-window', $event)"
    @open-settings="openSettings"
    @open-analytics="emit('open-settings', 'usage')"
    @open-whats-new="openWhatsNew"
    @quit="quit"
    @reorder-teams="$emit('reorder-teams', $event)"
    @select-cockpit="openCockpit"
    @select-backlog="openBacklog"
    @select-automations="openAutomations"
    @select-team="selectTeamFromRail"
    @toggle-speech-mute="$emit('toggle-speech-mute')"
  />
  <PaneTransition>
    <AgentSidebar
      ref="agentSidebar"
      v-if="showAgentSidebar"
      :agents="sidebarAgents"
      :all-teams="cockpitVisible"
      :mission-agents="snapshot.agents"
      :forkable-agent-ids="forkableAgentIds"
      :summary-replacement-agent-ids="summaryReplacementAgentIds"
      :active-agent-id="activeMissionId ? null : currentAgent?.id ?? null"
      :missions="teamMissions"
      :active-mission-id="activeMissionId"
      :mission-creation-error="missionCreationError"
      :mission-creation-pending="missionCreationPending"
      :phone-scope="phoneScope"
      :feature-only="featureAgentIds !== undefined"
      @create-mission="$emit('create-mission')"
      @open-feature="$emit('open-feature', $event)"
      @open-feature-window="$emit('open-feature-window', $event)"
      @rename-feature="$emit('rename-feature', $event)"
      @delete-feature="$emit('delete-feature', $event)"
      @delete-repository="$emit('delete-repository', $event)"
      @delete-mission="$emit('delete-mission', $event)"
      @open-mission-window="$emit('open-mission-window', $event)"
      @create-agent-in-mission-worktree="$emit('create-agent-in-mission-worktree', $event)"
      @select-mission="$emit('select-mission', $event)"
      :unread-agent-ids="unreadAgentIds"
      :teams="snapshot.teams"
      :team-id="cockpitVisible ? null : activeTeam?.id ?? null"
      :team-name="activeTeamName"
      :compact="agentListCompact"
      :collapsed-repository-keys="snapshot.general.collapsedRepositoryKeys"
      :width="agentSidebarWidth"
      :min-width="agentSidebarMinWidth"
      :max-width="agentSidebarMaxWidth"
      :open-in-catalog="openInApplications"
      :quick-switch-shortcuts-visible="quickAgentShortcutsVisible"
      :repository-icons="snapshot.general.repositoryIcons"
      @collapse-sidebar="$emit('collapse-sidebar')"
      @close-agent="$emit('close-agent', $event)"
      @compress-session="$emit('compress-session', $event)"
      @compact-session="$emit('compact-session', $event)"
      @cleanup-pull-request="$emit('cleanup-pull-request', $event)"
      @create-agent-from-repository="openRepositorySessionSource"
      @create-agent-on-branch="createRepositorySessionOnBranch"
      @create-agent-worktree-in-repository="openRepositorySessionWorktree"
      @create-feature-worktree="$emit('create-feature-worktree', $event)"
      @open-on-remote="$emit('open-on-remote', $event)"
      :remote-connections="snapshot.remoteConnections.connections"
      :list-repository-branches="listRepositorySessionBranches"
      @duplicate-agent="$emit('duplicate-agent', $event)"
      @open-agent-window="$emit('open-agent-window', $event)"
      @fork-agent="$emit('fork-agent', $event)"
      @share-agent="$emit('share-agent', $event)"
      @handoff-agent="$emit('handoff-agent', $event)"
      @edit-agent="openEditAgent"
      @move-agent-to-team="$emit('move-agent-to-team', $event)"
      @open-in="openAgentIn($event.agentId, $event.application)"
      @reorder-agents="$emit('reorder-agents', $event)"
      @reorder-repositories="$emit('reorder-repositories', $event)"
      @restart-agent="$emit('restart-agent', $event)"
      @resize-sidebar="setAgentSidebarWidth"
      @start-sidebar-resize="$emit('start-sidebar-resize', $event)"
      @resume-session="openResumeSession"
      @select-agent="selectAgentFromShell"
      @start-work="handleStartWorkAction"
      @create-quick-chat="createQuickChat"
      @update-repository-icon="updateRepositoryIcon"
      @update-collapsed-repositories="updateCollapsedRepositories"
    />
  </PaneTransition>
</template>

<script setup lang="ts">
import PaneTransition from '../shared/PaneTransition.vue';
import { missionAgentIds } from '@workspace/core/mission-attention';
import { enabledAgentBackends } from '@workspace/core/agent-backends';
import { orderAgentsLikeWorktreeSidebar } from '@workspace/core/workspace-sidebar';
import type {
  Agent,
  AppSnapshot,
  CodexAuthentication,
  MoveAgentToTeamInput,
  OpenInApplication,
  OpenInApplicationCatalog,
  ReorderAgentsInput,
  ReorderRepositoriesInput,
  ReorderTeamsInput,
  SourceBranch,
  Team,
} from '@workspace/core/contracts';
import { computed, ref, toRefs } from 'vue';
import AgentSidebar from './AgentSidebar.vue';
import TeamRail from './TeamRail.vue';
import type { SettingsTab } from './settings-tabs';

type RepositorySessionPayload = {
  agentId: string;
  repositoryName: string;
  repositoryRoot: string;
  remoteConnectionId?: string;
  originUrl?: string;
};

type OpenOnRemotePayload = { action: 'main' | 'new-worktree'; repositoryName: string; repositoryKey: string; originUrl?: string };

const props = defineProps<{
  activeMissionId?: string | null;
  missionCreationError?: string;
  missionCreationPending?: boolean;
  phoneScope?: boolean;
  hideTeamRail?: boolean;
  /** Set in a feature window: the only agents the sidebar lists. */
  featureAgentIds?: string[];
  activeTeam: Team | null;
  activeTeamAgents: Agent[];
  activeTeamName: string;
  agentListCompact: boolean;
  agentSidebarWidth: number;
  authentication: CodexAuthentication | null;
  automationsVisible: boolean;
  backlogVisible: boolean;
  cockpitVisible: boolean;
  currentAgent: Agent | null;
  forkableAgentIds: string[];
  summaryReplacementAgentIds?: string[];
  listRepositorySessionBranches: (input: { agentId: string; repositoryRoot: string; remoteConnectionId?: string }) => Promise<SourceBranch[]>;
  openInApplications: OpenInApplicationCatalog;
  quickAgentShortcutsVisible: boolean;
  settingsVisible: boolean;
  showAgentSidebar: boolean;
  snapshot: AppSnapshot;
  unreadAgentIds?: string[];
  unreadTeamIds: string[];
  workingTeamIds: string[];
}>();

const emit = defineEmits<{
  'close-agent': [agentId: string];
  'compress-session': [agentId: string];
  'compact-session': [agentId: string];
  'cleanup-pull-request': [agentId: string];
  'close-team': [teamId: string];
  'collapse-sidebar': [];
  'create-agent-from-repository': [payload: RepositorySessionPayload];
  'create-agent-on-branch': [payload: RepositorySessionPayload & { branch: SourceBranch }];
  'create-agent-worktree-in-repository': [payload: RepositorySessionPayload];
  'create-feature-worktree': [repositories: import('./agent-sidebar-contracts').SidebarRepositoryTarget[]];
  'open-on-remote': [payload: OpenOnRemotePayload];
  'create-quick-chat': [];
  'create-mission': [];
  'delete-mission': [id: string];
  'open-mission-window': [id: string];
  'create-agent-in-mission-worktree': [payload: { missionId: string; worktreePath: string }];
  'open-feature': [agentIds: string[]];
  'open-feature-window': [branch: string];
  'open-team-window': [teamId: string];
  'rename-feature': [feature: { branch: string; label: string }];
  'delete-feature': [feature: { branch: string; label: string }];
  'delete-repository': [agentId: string];
  'select-mission': [id: string];
  'duplicate-agent': [agentId: string];
  'open-agent-window': [agentId: string];
  'edit-agent': [agentId: string];
  'edit-team': [teamId: string];
  'fork-agent': [agentId: string];
  'share-agent': [agentId: string];
  'handoff-agent': [agentId: string];
  'move-agent-to-team': [input: MoveAgentToTeamInput];
  'new-team': [];
  'open-automations': [];
  'open-backlog': [];
  'open-cockpit': [];
  'open-in': [payload: { agentId: string; application: OpenInApplication }];
  'open-settings': [tab?: SettingsTab];
  'open-whats-new': [];
  quit: [];
  'reorder-agents': [input: ReorderAgentsInput];
  'reorder-repositories': [input: ReorderRepositoriesInput];
  'reorder-teams': [input: ReorderTeamsInput];
  'resize-sidebar': [width: number];
  'start-sidebar-resize': [event: PointerEvent];
  'restart-agent': [agentId: string];
  'resume-session': [agentId: string];
  'select-agent': [agentId: string];
  'select-team': [teamId: string];
  'start-work': [action: import('./start-work-actions').StartWorkAction];
  'toggle-speech-mute': [];
  'update-collapsed-repositories': [repositoryKeys: string[]];
  'update-repository-icon': [
    payload: {
      repositoryKey: string;
      repositoryRoot: string;
      icon: string | undefined;
    },
  ];
}>();

const missionOwnedAgentIds = computed(() => new Set((props.snapshot.missions ?? []).flatMap(missionAgentIds)));
const teamSidebarAgents = computed(() => (props.cockpitVisible ? props.snapshot.agents : props.activeTeamAgents)
  .filter(agent => !missionOwnedAgentIds.value.has(agent.id)));
// A feature window lists its agents in the order the team's own sidebar shows them.
const sidebarAgents = computed(() => props.featureAgentIds
  ? orderAgentsLikeWorktreeSidebar(teamSidebarAgents.value, props.featureAgentIds)
  : teamSidebarAgents.value);
const agentSidebar = ref<InstanceType<typeof AgentSidebar> | null>(null);
const quickSwitchAgentIds = computed(() => agentSidebar.value?.quickSwitchAgentIds ?? sidebarAgents.value.map(agent => agent.id));
defineExpose({ quickSwitchAgentIds });
const teamMissions = computed(() => props.featureAgentIds ? [] : (props.snapshot.missions ?? []).filter(mission => props.cockpitVisible || mission.teamId === props.activeTeam?.id));

const agentSidebarMinWidth = 200;
const agentSidebarMaxWidth = 420;
const {
  activeTeam,
  activeTeamAgents,
  activeTeamName,
  agentListCompact,
  agentSidebarWidth,
  authentication,
  automationsVisible,
  backlogVisible,
  cockpitVisible,
  currentAgent,
  forkableAgentIds,
  summaryReplacementAgentIds,
  listRepositorySessionBranches,
  openInApplications,
  quickAgentShortcutsVisible,
  settingsVisible,
  showAgentSidebar,
  snapshot,
  unreadAgentIds,
  unreadTeamIds,
  workingTeamIds,
} = toRefs(props);

function createQuickChat(): void {
  emit('create-quick-chat');
}

function createRepositorySessionOnBranch(payload: RepositorySessionPayload & { branch: SourceBranch }): void {
  emit('create-agent-on-branch', payload);
}

function handleStartWorkAction(action: import('./start-work-actions').StartWorkAction): void {
  emit('start-work', action);
}

function openAgentIn(agentId: string, application: OpenInApplication): void {
  emit('open-in', { agentId, application });
}

function openAutomations(): void {
  emit('open-automations');
}

function openBacklog(): void {
  emit('open-backlog');
}

function openCockpit(): void {
  emit('open-cockpit');
}

function openEditAgent(agentId: string): void {
  emit('edit-agent', agentId);
}

function openEditTeam(teamId: string): void {
  emit('edit-team', teamId);
}

function openNewTeam(): void {
  emit('new-team');
}

function openRepositorySessionSource(payload: RepositorySessionPayload): void {
  emit('create-agent-from-repository', payload);
}

function openRepositorySessionWorktree(payload: RepositorySessionPayload): void {
  emit('create-agent-worktree-in-repository', payload);
}

function openResumeSession(agentId: string): void {
  emit('resume-session', agentId);
}

function openSettings(): void {
  emit('open-settings');
}

function openWhatsNew(): void {
  emit('open-whats-new');
}

function quit(): void {
  emit('quit');
}

function selectAgentFromShell(agentId: string): void {
  emit('select-agent', agentId);
}

function selectTeamFromRail(teamId: string): void {
  emit('select-team', teamId);
}

function setAgentSidebarWidth(width: number): void {
  emit('resize-sidebar', width);
}

function updateCollapsedRepositories(repositoryKeys: string[]): void {
  emit('update-collapsed-repositories', repositoryKeys);
}

function updateRepositoryIcon(payload: {
  repositoryKey: string;
  repositoryRoot: string;
  icon: string | undefined;
}): void {
  emit('update-repository-icon', payload);
}
</script>
