import { supportsConversationSharing } from '@workspace/core/conversation-sharing';
import type { Mission } from '@workspace/core/missions';
import { missionWorkflow } from '@workspace/core/mission-workflows';
import { missionAttention } from '@workspace/core/mission-attention';
import { missionCreatedWorkspaces } from '@workspace/core/mission-execution';
import { computed, reactive, ref, toRefs, markRaw } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, OpenInApplication, OpenInApplicationCatalog } from '@workspace/core/contracts';
import { projectWorkspaceSidebar, type SidebarActivity, type WorkspaceSidebarGroup, type WorkspaceSidebarSession } from '@workspace/core/workspace-sidebar';
import { formatCompactAge, formatElapsed } from '../shared/compact-age';
import { BellIcon, CircleCheckIcon, ClockHour8Icon, LoaderIcon, MoonIcon, FolderIcon, GitBranchIcon, GitForkIcon, Trash2Icon } from '../shared/icons/app-icons';
import { useBackendChoices } from './backend-selection';
import { backendDisplayName } from '@workspace/core/backend-driver';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { defaultBackendCommands } from '@workspace/core/backend-commands';
import type { AgentContextMenuAction } from './AgentContextMenu.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { useListReorderDrag } from '../shared/use-list-reorder-drag';
import { useRepositorySessionMenu } from './use-repository-session-menu';
import { useAgentSidebarOrganization } from './use-agent-sidebar-organization';
import { useAgentSidebarMotion } from './use-agent-sidebar-motion';
import ScrollHintRows from './ScrollHintRows.vue';
import type { AgentSidebarProps, AgentSidebarEmit } from './agent-sidebar-contracts';

export function useAgentSidebar(props: AgentSidebarProps, emit: AgentSidebarEmit) {
  const { t } = useI18n();

  const missionsCollapsed = ref(false);
  const activityIcons = markRaw({ attention: BellIcon, recent: CircleCheckIcon, working: LoaderIcon, idle: MoonIcon });
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
    activityOnly: () => props.allTeams ?? false,
    teamId: () => props.teamId, agents: () => props.agents, repositoryGroups: () => repositoryGroups.value,
    label: activity => t(`sidebar.activityGroups.${activity}`),
  });
  const organizationMode = organization.mode;
  const activityGroups = computed(() => workspaceGroups.value.filter((group): group is typeof group & { activity: SidebarActivity } => !!group.activity));
  const quickChatGroup = computed(() => repositoryGroups.value.find(group => group.kind === 'quickChats') ?? null);
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
  const contextMenuAgentId = ref<string | null>(null);
  const contextMenuMissionId = ref<string | null>(null);
  const contextMissionWorkspaces = computed(() => missionCreatedWorkspaces(props.missions?.find(mission => mission.id === contextMenuMissionId.value)));
  const contextMenuRepositoryAgentId = ref<string | null>(null);
  const repositoryMenuItems = computed<AppMenuItem[]>(() => [{ id: 'delete', type: 'action', label: t('repositoryDeletion.action'), icon: Trash2Icon, danger: true }]);
  const repositorySessionMenu = markRaw(useRepositorySessionMenu(() => props.listRepositoryBranches, t));
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

  const unreadAgentIdSet = computed(() => new Set(props.unreadAgentIds ?? []));
  const attentionOf = (mission: Mission) => missionAttention(mission, props.missionAgents ?? props.agents, unreadAgentIdSet.value);
  function missionDotStatus(mission: Mission): 'awaitingInput' | 'working' | 'idle' {
    const attention = attentionOf(mission);
    return attention === 'needsInput' ? 'awaitingInput' : attention === 'working' ? 'working' : 'idle';
  }
  function missionStatusLabel(mission: Mission): string {
    const attention = attentionOf(mission);
    if (attention === 'needsInput') return statusLabel('awaitingInput');
    if (attention === 'unread') return t('sidebar.unread');
    return missionProgressLabel(mission);
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
      pullRequest.provider === 'gitlab'
        ? (pullRequest.state === 'closed' ? 'sidebar.mergeRequestClosedCleanup' : 'sidebar.mergeRequestMergedCleanup')
        : (pullRequest.state === 'closed' ? 'sidebar.pullRequestClosedCleanup' : 'sidebar.pullRequestMergedCleanup'),
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

  function openRepositoryMenu(group: WorkspaceSidebarGroup, event: MouseEvent): void {
    if (group.kind !== 'repository' || props.phoneScope) return;
    event.preventDefault();
    contextMenuAgentId.value = null;
    contextMenuMissionId.value = null;
    contextMenuRepositoryAgentId.value = group.sessions[0]?.agentId ?? null;
    contextMenuPosition.value = { x: event.clientX, y: event.clientY };
  }

  function deleteContextRepository(): void {
    const agentId = contextMenuRepositoryAgentId.value;
    contextMenuRepositoryAgentId.value = null;
    if (agentId) emit('delete-repository', agentId);
  }

  function openAgentMenu(agentId: string, event: MouseEvent): void {
    contextMenuRepositoryAgentId.value = null;
    contextMenuMissionId.value = null;
    contextMenuAgentId.value = agentId;
    contextMenuPosition.value = {
      x: event.clientX,
      y: event.clientY,
    };
  }

  function openMissionMenu(missionId: string, event: MouseEvent): void {
    contextMenuRepositoryAgentId.value = null;
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

  function createAgentInContextMissionWorktree(worktreePath: string): void {
    const missionId = contextMenuMissionId.value;
    if (!missionId) return;
    emit('create-agent-in-mission-worktree', { missionId, worktreePath });
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
      case 'share-agent':
        emit('share-agent', agentId);
        break;
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

  return reactive({
    ...toRefs(props),
    sidebarStyle,
    t,
    organizationMenuItems,
    organization,
    emit,
    quickChatGroup,
    missionsCollapsed,
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
    contextMenuAgentId,
    contextMenuAgent,
    contextMenuAgentIsLocal,
    supportsConversationSharing,
    canForkContextMenuAgent,
    canReplaceContextMenuConversation,
    canCompressContextMenuAgent,
    canCompactContextMenuAgent,
    resolvedOpenInCatalog,
    contextMenuMoveTargets,
    contextMenuPosition,
    emitContextAgentAction,
    emitContextAgentMove,
    emitContextAgentOpenIn,
    closeContextMenu,
    contextMenuRepositoryAgentId,
    repositoryMenuItems,
    deleteContextRepository,
    contextMenuMissionId,
    deleteContextMission,
    contextMissionWorkspaces,
    createAgentInContextMissionWorktree,
    closeMissionContextMenu,
    minWidth,
    maxWidth,
    currentWidth,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerEnd,
    emitResizedWidth,
    resizeStep,
    organizationMode,
    activityGroups,
    activityIcons,
    idleSortMenuItems,
    moreRowsLabel,
    rowsRefs,
    setRowsRef,
    rowsOverflow,
    activityContext,
    activityRepository,
    activityIndicator,
    sessionList,
    quickSwitchAgentIds,
  });
}

export type AgentSidebarModel = ReturnType<typeof useAgentSidebar>;
