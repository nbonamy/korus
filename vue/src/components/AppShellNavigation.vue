<template>
  <TeamRail
    :teams="snapshot.teams"
    :remote-connections="snapshot.remoteConnections.connections"
    :load-remote-teams="loadRemoteTeams"
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
    @disconnect-team="$emit('disconnect-team', $event)"
    @edit-team="openEditTeam"
    @new-team="openNewTeam"
    @open-settings="openSettings"
    @open-whats-new="openWhatsNew"
    @quit="quit"
    @reorder-teams="$emit('reorder-teams', $event)"
    @select-cockpit="openCockpit"
    @select-backlog="openBacklog"
    @select-automations="openAutomations"
    @select-team="selectTeamFromRail"
    @toggle-speech-mute="$emit('toggle-speech-mute')"
  />
  <Transition name="agent-sidebar">
    <AgentSidebar
      v-if="showAgentSidebar"
      :agents="sidebarAgents"
      :forkable-agent-ids="forkableAgentIds"
      :summary-replacement-agent-ids="summaryReplacementAgentIds"
      :active-agent-id="activeMissionId ? null : currentAgent?.id ?? null"
      :missions="teamMissions"
      :active-mission-id="activeMissionId"
      :mission-creation-error="missionCreationError"
      :mission-creation-pending="missionCreationPending"
      :phone-scope="phoneScope"
      @create-mission="$emit('create-mission')"
      @delete-mission="$emit('delete-mission', $event)"
      @select-mission="$emit('select-mission', $event)"
      :unread-agent-ids="unreadAgentIds"
      :teams="snapshot.teams"
      :team-id="activeTeam?.id ?? null"
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
      :list-repository-branches="listRepositorySessionBranches"
      @duplicate-agent="$emit('duplicate-agent', $event)"
      @fork-agent="$emit('fork-agent', $event)"
      @handoff-agent="$emit('handoff-agent', $event)"
      @edit-agent="openEditAgent"
      @move-agent-to-team="$emit('move-agent-to-team', $event)"
      @open-in="openAgentIn($event.agentId, $event.application)"
      @reorder-agents="$emit('reorder-agents', $event)"
      @reorder-repositories="$emit('reorder-repositories', $event)"
      @restart-agent="$emit('restart-agent', $event)"
      @resize-sidebar="setAgentSidebarWidth"
      @resume-session="openResumeSession"
      @select-agent="selectAgentFromShell"
      @start-work="handleStartWorkAction"
      @create-quick-chat="createQuickChat"
      @update-repository-icon="updateRepositoryIcon"
      @update-collapsed-repositories="updateCollapsedRepositories"
    />
  </Transition>
</template>

<script setup lang="ts">
import { enabledAgentBackends } from '@workspace/core/agent-backends';
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
import { computed, toRefs } from 'vue';
import AgentSidebar from './AgentSidebar.vue';
import TeamRail from './TeamRail.vue';

type RepositorySessionPayload = {
  agentId: string;
  repositoryName: string;
  repositoryRoot: string;
};

const props = defineProps<{
  activeMissionId?: string | null;
  missionCreationError?: string;
  missionCreationPending?: boolean;
  phoneScope?: boolean;
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
  listRepositorySessionBranches: (input: { agentId: string; repositoryRoot: string }) => Promise<SourceBranch[]>;
  loadRemoteTeams: (connectionId: string) => Promise<Team[]>;
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
  'create-quick-chat': [];
  'create-mission': [];
  'delete-mission': [id: string];
  'select-mission': [id: string];
  'disconnect-team': [teamId: string];
  'duplicate-agent': [agentId: string];
  'edit-agent': [agentId: string];
  'edit-team': [teamId: string];
  'fork-agent': [agentId: string];
  'handoff-agent': [agentId: string];
  'move-agent-to-team': [input: MoveAgentToTeamInput];
  'new-team': [];
  'open-automations': [];
  'open-backlog': [];
  'open-cockpit': [];
  'open-in': [payload: { agentId: string; application: OpenInApplication }];
  'open-settings': [];
  'open-whats-new': [];
  quit: [];
  'reorder-agents': [input: ReorderAgentsInput];
  'reorder-repositories': [input: ReorderRepositoriesInput];
  'reorder-teams': [input: ReorderTeamsInput];
  'resize-sidebar': [width: number];
  'restart-agent': [agentId: string];
  'resume-session': [agentId: string];
  'select-agent': [agentId: string];
  'select-team': [teamId: string];
  'start-work': [action: 'new' | 'github' | 'local' | 'url'];
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

const missionAgentIds = computed(() => new Set(
  (props.snapshot.missions ?? []).flatMap(mission => (
    mission.execution?.runs.flatMap(run => run.workerId ? [run.workerId] : []) ?? []
  )),
));
const sidebarAgents = computed(() => props.activeTeamAgents.filter(agent => !missionAgentIds.value.has(agent.id)));
const teamMissions = computed(() => (props.snapshot.missions ?? []).filter(mission => mission.teamId === props.activeTeam?.id));

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
  loadRemoteTeams,
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

function handleStartWorkAction(action: 'new' | 'github' | 'local' | 'url'): void {
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

<style scoped>
.agent-sidebar-enter-active,
.agent-sidebar-leave-active {
  overflow: hidden;
  transition:
    flex-basis 180ms ease,
    width 180ms ease,
    min-width 180ms ease,
    max-width 180ms ease,
    opacity 140ms ease,
    transform 180ms ease;
}

.agent-sidebar-enter-from,
.agent-sidebar-leave-to {
  flex-basis: 0;
  width: 0;
  min-width: 0;
  max-width: 0;
  opacity: 0;
  transform: translateX(-8px);
}

@media (prefers-reduced-motion: reduce) {
  .agent-sidebar-enter-active,
  .agent-sidebar-leave-active {
    transition-duration: 1ms;
  }
}
</style>
