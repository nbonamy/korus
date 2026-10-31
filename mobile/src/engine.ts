import type { CompanionCheckpoint, CompanionSync } from '@workspace/core/companion-journal';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import { computed, ref, watch } from 'vue';
import { promptContentText, trimPromptContent, type CodexPromptPart } from '@codex-app-sdk/core/surface';
import { hasUnreadActivity } from '@workspace/core/agent-read-state';
import { missionAgentsAttention, type MissionAttention } from '@workspace/core/mission-attention';
import { skillDescription, skillDisplayName, skillInsertText, pluginDescription, pluginDisplayName, pluginInsertText } from '@codex-app-sdk/vue';
import type { Agent, AgentBackend, BackendModelOption } from '@workspace/core/contracts';
import { canSelectAgentBackend } from '@workspace/core/agent-backends';
import { projectAgentMentionLabels } from '@workspace/core/workspace-sidebar';
import { agentDisplayName } from '@workspace/core/agent-display';
import { companionAgents, companionBackgroundGraceMs, companionTarget, type CompanionMission, type CompanionTarget, type CompanionBranch } from '@workspace/core/companion-protocol';
import { validPromptUploads } from './prompt-uploads';
import { connectionDiagnostic } from './connection-diagnostics';
import type { CompanionUpload, CompanionConnector, CompanionConversation, CompanionHistoryState, CompanionReviewInput } from './companion-port';
import { createCompanionState } from './companion-state';
import { composerCapabilitiesFor, type ComposerChange } from './composer-settings';
import { createLifecycle } from './engine-lifecycle';
import { activeSession, projectMobileActivityGroups, projectMobileGroups, type MobileActivityGroup, type MobileSidebarGroup } from './workspace-groups';
import type { SelectionStore } from './selection-store';
import { ConversationImageCache, type ImageCacheStore } from './image-cache';
import type { CompanionRequestReply, CompanionClosePreview } from '@workspace/core/companion-protocol';

/** Everything the native shell draws, as plain data: no framework, no protocol detail. */
/** A mission as the phone lists it: how far along it is, and each ticket with the worker that has it, if any. */
export type EngineMission = Omit<CompanionMission, 'tickets'> & { attention: MissionAttention; done: number; tickets: (CompanionMission['tickets'][number] & { activity?: string })[] };
export type EngineState = {
  missions: EngineMission[];
  missionAttention: MissionAttention;
  /** The mission whose ticket worker is open; its conversation is read-only except for what the worker asks. */
  mission: { id: string; outcome: string; lead?: true } | null;
  git: ReturnType<typeof createCompanionState>['git']['view']['value'];
  queuedPrompts: { id: string; text: string }[];
  queuedPromptPending: string | null;
  queuedPromptFailed: boolean;
  projectRepositories: ReturnType<typeof createCompanionState>['projectRepositories']['value'];
  projectBranches: ReturnType<typeof createCompanionState>['projectBranches']['value'];
  usage: ReturnType<typeof createCompanionState>['usage']['value'];
  pushRegistrationFailed: boolean;
  requests: ReturnType<typeof createCompanionState>['requests']['value'];
  respondingRequest: string | null;
  failedRequest: string | null;
  startup: 'loading' | 'ready' | 'error';
  connection: string;
  /** A `mobile.errors.*` key the shell words itself. */
  error: string;
  errorDetail: string;
  laptops: { id: string; name: string }[];
  pairing: 'idle' | 'working' | 'awaitingApproval';
  pairingError: string;
  teams: { id: string; name: string; avatar?: string; isUnread: boolean }[];
  teamId: string;
  allTeams: boolean;
  laptopId: string;
  groups: MobileSidebarGroup[];
  activityGroups: MobileActivityGroup[];
  agentId: string;
  reviewFindingsCount: number | null;
  header: { title: string; repository: string | null; status: string; statusText: string; icon: string | null } | null;
  loading: boolean;
  conversationReady: boolean;
  refreshing: boolean;
  conversationGeneration: number;
  canSend: boolean;
  composerTarget: CompanionTarget | null;
  goal: { objective: string; status: string } | null;
  goalBusy: boolean;
  goalError: boolean;
  review: ReturnType<typeof createCompanionState>['review']['value'];
  sessionAction: 'interrupt' | 'restart' | 'close' | 'previewClose' | 'rename' | null;
  sessionActionFailed: boolean;
  closePreview: CompanionClosePreview | null;
  chatCreation: 'idle' | 'creating' | 'failed';
  teamCreation: 'idle' | 'creating' | 'failed';
  /** Moving a mission on, or accepting one of its tickets, is a request to the laptop that can be refused. */
  missionAction: 'idle' | 'working' | 'failed';
  /** The engines the open team's laptop can start a chat with. */
  backends: string[];
  /** Engines on the selected conversation's host and on each sidebar repository's host. */
  conversationBackends: string[];
  repositoryBackends: Record<string, string[]>;
  branches: { repositoryId: string | null; status: 'idle' | 'loading' | 'loaded' | 'failed'; items: CompanionBranch[] };
  /** The engine of the open chat, and whether it may still be changed: only before the first prompt. */
  backend: string | null;
  canSelectBackend: boolean;
  draft: string;
  suggestedPrompt: string | null;
  mentions: { status: 'idle' | 'loading' | 'loaded' | 'failed'; items: { id: string; kind: 'agent' | 'plugin'; name: string; insertText: string; value: string; description: string }[] };
  skills: { status: 'idle' | 'loading' | 'loaded' | 'failed'; items: { id: string; name: string; insertText: string; value: string; description: string }[] };
  models: { id: string; name: string; efforts: string[]; tiers: { id: string; name: string }[] }[];
  composer: { modelId: string | null; effort: string | null; serviceTier: string | null; planMode: boolean };
  permissions: { approvalPreset: string | null; permissionMode: string | null; presets: string[]; modes: { id: string; label: string }[] };
  capabilities: { goals: boolean; models: boolean; reasoningEffort: boolean; serviceTier: boolean; planMode: boolean; interrupt: boolean; attachments: boolean };
  favorites: { modelId: string; reasoningEffort: string | null; serviceTier: string | null }[];
};

export type EngineEvent =
  | { type: 'liveActivityRegistered'; requestId: string; success: boolean }
  | { type: 'conversationFile'; requestId: string; agentId: string; preview?: import('@workspace/core/companion-files').CompanionFilePreview; error?: string }
  | { type: 'gitDiff'; diff: string }
  | { type: 'conversationImage'; requestId: string; agentId: string; dataUrl?: string; error?: string }
  | { type: 'notification'; notification: CompanionNotification }
  | { type: 'notificationOpenFailed' }
  | { type: 'sendResult'; requestId: string; status: 'accepted' | 'rejected' | 'unknown' }
  | { type: 'turnHistory'; requestId: string; agentId: string; error?: string }
  | { type: 'conversationContent'; requestId: string; agentId: string; sessionId: string; chunk?: import('@workspace/core/contracts/conversation').ConversationContentChunk; error?: string }
  | { type: 'state'; state: EngineState }
  /** The open conversation, for the transcript: the provider's own snapshot plus the agent it belongs to. */
  | ({ type: 'conversation'; agentId: string; frame: CompanionConversation | null } & TranscriptContext)
  /** Everything around the open conversation changed but the conversation itself did not: small, and never resends the transcript. */
  | ({ type: 'conversationTransfer'; agentId: string; identity: string } & CompanionSync & TranscriptContext)
  | ({ type: 'conversationContext'; agentId: string } & TranscriptContext);

/** What the transcript needs besides the conversation: the chat's own record, the names it can mention, and what an empty chat offers. */
export type TranscriptContext = {
  generation: number;
  ready: boolean; agent: Agent | null; peers: { id: string; label: string }[]; history: CompanionHistoryState;
  /** An empty chat's engine and the ones it may switch to. */
  engines: { current: string; choices: string[] } | null;
};

export type EngineCommand =
  | { type: 'createTeam'; name: string } | { type: 'dismissTeamCreation' }
  | { type: 'finishReview'; missionId: string } | { type: 'continueMission'; missionId: string } | { type: 'acceptTicket'; missionId: string; number: number } | { type: 'selectFinding'; missionId: string; findingId: string; selected: boolean } | { type: 'fixFindings'; missionId: string } | { type: 'rerunReview'; missionId: string } | { type: 'dismissMissionAction' }
  | { type: 'idleSort'; order: 'activity' | 'repository' }
  | { type: 'loadChanges'; scopeId?: string } | { type: 'dismissChanges' }
  | { type: 'readFilePreview'; requestId: string; agentId: string; input: import('@workspace/core/companion-files').CompanionFileInput }
  | { type: 'readConversationImage'; requestId: string; agentId: string; path: string }
  | { type: 'loadProjectBranches'; repositoryId: string; source?: 'github' | 'gitlab' | 'local' } | { type: 'dismissProjectBranches' }
  | { type: 'loadProjectRepositories'; source?: 'github' | 'gitlab' | 'local' } | { type: 'dismissProjectRepositories' }
  | { type: 'duplicateAgent'; target: CompanionTarget; backend: AgentBackend }
  | { type: 'renameAgent'; target: CompanionTarget; name: string }
  | ({ type: 'createProject' } & Omit<import('@workspace/core/companion-protocol').CompanionProjectInput, 'teamId'>)
  | { type: 'loadUsage' }
  | { type: 'pushRegistration'; registration: CompanionPushRegistration | null }
  | { type: 'liveActivityRegistration'; laptopId: string; requestId: string; registration: import('@workspace/core/companion-live-activity').LiveActivityRegistration | null }
  | { type: 'openNotification'; target: CompanionTarget }
  | { type: 'readConversationContent'; requestId: string; agentId: string; input: import('@workspace/core/contracts/conversation').ConversationContentInput }
  | { type: 'dismissRequest'; key: string }
  | { type: 'respondRequest'; reply: CompanionRequestReply }
  | { type: 'transcriptApplied'; identity: string; checkpoint: CompanionCheckpoint }
  | { type: 'transcriptReset'; identity: string }
  | { type: 'refreshConversation' }
  | { type: 'start' }
  | { type: 'pair'; code: string; deviceName: string }
  | { type: 'connect'; laptopId: string }
  | { type: 'disconnect' } | { type: 'chooseConnection' } | { type: 'reconnect' } | { type: 'forget'; laptopId?: string } | { type: 'renameLaptop'; laptopId: string; name: string }
  /** App visibility; background connections have the same grace period as the native lock. */
  | { type: 'activity'; active: boolean }
  | { type: 'read'; agentId: string; revision: number; generation: number }
  | { type: 'openActivityThread'; laptopId: string; agentId: string }
  | { type: 'selectAllTeams' } | { type: 'selectTeam'; id: string } | { type: 'selectAgent'; id: string }
  | { type: 'loadOlder'; agentId: string }
  | { type: 'loadTurnHistory'; requestId: string; agentId: string; turnId: string }
  | { type: 'draft'; text: string }
  | { type: 'loadSkills' }
  | { type: 'loadMentions' }
  | { type: 'clearGoal'; target: CompanionTarget }
  | { type: 'send'; followUpBehavior?: 'queue' | 'steer'; goalMode?: boolean; text: string; requestId?: string; target?: CompanionTarget; uploads?: CompanionUpload[]; options?: { content?: import('@codex-app-sdk/core/surface').CodexPromptPart[]; attachments?: { type?: string; reference: string }[] } }
  | { type: 'interrupt' }
  | { type: 'queuedPrompt'; target: CompanionTarget; promptId: string; action: 'steer' | 'delete' }
  | { type: 'restartSession' } | { type: 'closeSession' } | { type: 'dismissSessionError' }
  | { type: 'confirmCloseSession'; agentId: string; deleteWorktree: boolean; deleteRemoteBranch?: boolean; discardChanges?: boolean }
  | { type: 'cancelCloseSession' }
  | { type: 'loadBranches'; repositoryId: string } | { type: 'dismissBranches' }
  | { type: 'newChat'; repositoryId: string; backend: 'codex' | 'claude' | 'antigravity'; branchName?: string; existingBranch?: string } | { type: 'newQuickChat'; backend: 'codex' | 'claude' | 'antigravity' } | { type: 'dismissNewChat' } | { type: 'backend'; backend: 'codex' | 'claude' | 'antigravity' }
  | { type: 'composer'; change: ComposerChange }
  | { type: 'approvalPreset'; preset: string } | { type: 'permissionMode'; mode: string }
  | { type: 'delegate'; startingContext: 'conversation' | 'handoff'; instructions?: string }
  | { type: 'loadReview'; backend?: 'codex' | 'claude' | 'antigravity' } | { type: 'dismissReview' }
  | { type: 'loadReviewDetails' }
  | { type: 'reviewAction'; target: CompanionTarget; input: import('@workspace/core/companion-review').CompanionReviewAction }
  | { type: 'review'; target: CompanionTarget; input: CompanionReviewInput };

export type EnginePort = { connector: CompanionConnector; imageCache?: ImageCacheStore; selectionStore?: SelectionStore; chatsLabel?: string; initialActive?: boolean; incrementalTranscript?: boolean; post(event: EngineEvent): void };

const effortsOf = (model: BackendModelOption) => (model.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort);

export function createEngine(port: EnginePort) {
  const imageCache = port.imageCache ? new ConversationImageCache(port.imageCache) : undefined;
  const state = createCompanionState(port.connector, undefined, undefined, notification => { if (!disposed && (foreground || notification.kind === 'read')) port.post({ type: 'notification', notification }); });
  const startup = ref<EngineState['startup']>('loading');
  const pairing = ref<EngineState['pairing']>('idle');
  const pairingError = ref('');
  const laptops = ref([...port.connector.laptops]);
  let disposed = false;
  let startupWork: Promise<void> | null = null;
  let foreground = port.initialActive ?? true;
  const sidebarNow = ref(Date.now());
  const sidebarIdleSort = ref<'activity' | 'repository'>('activity');
  // Sidebar scope is independent of the team that owns the open conversation and new work.
  const allTeams = ref(false);
  const showingAllTeams = computed(() => allTeams.value && state.workspace.value.teams.length > 1);
  const sidebarAgents = computed(() => {
    if (!showingAllTeams.value) return state.agents.value;
    const order = new Map(state.workspace.value.teams.flatMap(team => team.agentIds).map((id, index) => [id, index]));
    return [...state.workspace.value.agents].sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size));
  });
  const sidebarGroups = computed(() => projectMobileGroups(sidebarAgents.value, state.agentId.value || null, port.chatsLabel ?? 'Chats', state.workspace.value.repositoryIcons));
  function repositoryTeam(repositoryId: string): string {
    if (!showingAllTeams.value) return state.teamId.value;
    const group = sidebarGroups.value.find(group => group.repositoryRoot === repositoryId);
    const members = new Set(group?.sessions.map(session => session.agentId));
    const owners = sidebarAgents.value.filter(agent => members.has(agent.id));
    return owners.find(agent => agent.teamId === state.teamId.value)?.teamId ?? owners[0]?.teamId ?? state.teamId.value;
  }
  const sidebarClock = setInterval(() => { if (foreground) sidebarNow.value = Date.now(); }, 1_000);
  let activityEpoch = 0;
  // The state starts out foreground; tell it when the app was launched in the background.
  if (!foreground) void state.setActive(false);
  const lifecycle = createLifecycle({ graceMs: companionBackgroundGraceMs, suspend: () => {
    // An unopened or revoked connection is still a pairing screen, even after a long background stay.
    if (state.status.value !== 'unpaired' && state.status.value !== 'revoked') state.disconnect();
    return port.connector.suspend?.();
  } });
  let pendingNotification: CompanionTarget | null = null;
  let notificationEpoch = 0;
  let restoringSelection = 0;
  let choosingConnection = false;
  const reading = new Set<string>();
  let scheduled = false;
  let lastState = '';
  // Bumped whenever the person navigates, so a connection still restoring the saved selection gives way.
  let restoreEpoch = 0;
  const backendChoices = (host = state.teamId.value) => state.workspace.value.backends?.[host] ?? [];
  const engines = () => { const agent = state.agent.value; const choices = backendChoices(agent?.remoteConnectionId ?? state.teamId.value); return agent && choices.length > 1 && canSelectAgentBackend(agent) ? { current: agent.backend, choices } : null; };

  async function rememberSelection() {
    if (!state.laptopId.value || !port.selectionStore) return;
    // Navigation remains usable if device storage is temporarily unavailable.
    await port.selectionStore.write(state.laptopId.value, { teamId: state.teamId.value, agentId: state.agentId.value,
      ...(showingAllTeams.value ? { allTeams: true } : {}) }).catch(() => {});
  }

  async function preferredLaptop() {
    const saved = await port.selectionStore?.readLastLaptop().catch(() => null);
    return laptops.value.find(laptop => laptop.id === saved)?.id
      ?? (laptops.value.length === 1 ? laptops.value[0]!.id : null);
  }

  async function connect(laptopId: string) {
    choosingConnection = false;
    if (laptopId !== state.laptopId.value) allTeams.value = false;
    ++restoringSelection;
    try {
      const epoch = ++restoreEpoch;
      await state.connect(laptopId);
      if (disposed || epoch !== restoreEpoch || state.status.value !== 'connected') return;
      await port.selectionStore?.writeLastLaptop(laptopId).catch(() => {});
      const saved = await port.selectionStore?.read(laptopId).catch(() => null);
      if (disposed || epoch !== restoreEpoch || state.laptopId.value !== laptopId || state.status.value !== 'connected') return;
      const teams = state.workspace.value.teams;
      const team = teams.find((candidate) => candidate.id === saved?.teamId)
        ?? teams.find((candidate) => candidate.id === state.teamId.value) ?? teams[0];
      await state.selectTeam(team?.id ?? '', team?.id === saved?.teamId ? saved?.agentId : undefined);
      if (disposed || epoch !== restoreEpoch) return;
      if (saved) allTeams.value = saved.allTeams === true;
      if (!disposed && epoch === restoreEpoch) await rememberSelection();
    } finally {
      --restoringSelection;
      if (!restoringSelection && state.status.value === 'connected') await openPendingNotification();
    }
  }

  // A push can arrive before iOS finishes activation/unlock or before saved pairings load.
  // Keep that navigation intent until a foreground connection has its authoritative workspace.
  async function openPendingNotification() {
    if (disposed || !foreground || startup.value !== 'ready' || restoringSelection || !pendingNotification) return;
    const target = pendingNotification;
    pendingNotification = null;
    await dispatch({ type: 'openNotification', target });
  }
  const stopGitDiff = watch(state.git.result, result => {
    if (!disposed) port.post({ type: 'gitDiff', diff: result?.diff ?? '' });
  }, { flush: 'post' });
  const stopNotificationReconnect = watch(state.status, status => {
    if (status === 'connected') void openPendingNotification();
  }, { flush: 'post' });

  // Only whether a conversation is open matters here: its content changing must not rebuild the state.
  const hasConversation = computed(() => Boolean(state.conversation.value));
  function snapshot(): EngineState {
    const agent = state.agent.value;
    const team = state.workspace.value.teams.find((team) => team.id === agent?.teamId);
    const groups = sidebarGroups.value;
    const active = activeSession(groups);
    const visibleMissions = state.missions.value.filter((mission) => showingAllTeams.value || mission.teamId === state.teamId.value);
    const allAgents = companionAgents(state.workspace.value);
    const unread = new Set(allAgents.filter(hasUnreadActivity).map(agent => agent.id));
    const attentionFor = (missions: CompanionMission[]) => {
      const leads = new Set(missions.flatMap(mission => mission.leadAgentId ? [mission.leadAgentId] : []));
      const members = new Set([...leads, ...missions.flatMap(mission => mission.tickets.flatMap(ticket => ticket.agentId ? [ticket.agentId] : []))]);
      return missionAgentsAttention(allAgents.filter(agent => members.has(agent.id)), leads, unread);
    };
    const missions = visibleMissions.map((mission): EngineMission => ({ ...mission, attention: attentionFor([mission]), done: mission.tickets.filter((ticket) => ticket.state === 'accepted').length,
        // What a working agent says it is doing is the ticket's live line.
        tickets: mission.tickets.map((ticket) => {
          const activity = ticket.agentId && (ticket.state === 'running' || ticket.state === 'preparing')
            ? state.workspace.value.missionAgents?.find((agent) => agent.id === ticket.agentId)?.statusText?.trim() : undefined;
          return activity ? { ...ticket, activity } : ticket;
        }) }));
    const owner = agent ? state.missions.value.find((mission) => mission.leadAgentId === agent.id || mission.tickets.some((ticket) => ticket.agentId === agent.id)) : undefined;
    // Repository workers take precedence over the lead label, including workspaces from older hosts.
    const ticketOf = owner && agent ? owner.tickets.find((ticket) => ticket.agentId === agent.id) : undefined;
    const missionTitle = owner && agent
      ? ticketOf ? { title: ticketOf.repository || (agent.workspace?.kind === 'git' ? agent.workspace.repositoryName : ticketOf.title), subtitle: null }
        : owner.leadAgentId === agent.id ? { title: 'Mission lead', subtitle: null } : null
      : null;
    const capabilities = composerCapabilitiesFor(agent?.backend ?? 'codex', state.models.value);
    const settings = state.composerSettings.value;
    const permissions = state.permissions.value;
    return {
      git: state.git.view.value,
      missions, missionAttention: attentionFor(visibleMissions), mission: owner ? { id: owner.id, outcome: owner.outcome, ...(!ticketOf && owner.leadAgentId === agent?.id ? { lead: true as const } : {}) } : null,
      laptopId: state.laptopId.value,
      activityGroups: projectMobileActivityGroups(sidebarAgents.value, groups, sidebarNow.value, sidebarIdleSort.value),
      queuedPrompts: (state.workspace.value.queuedPrompts ?? []).filter(prompt => prompt.agentId === agent?.id).map(({ id, text }) => ({ id, text })),
      queuedPromptPending: state.queuedPromptPending.value,
      queuedPromptFailed: state.queuedPromptFailed.value,
      projectRepositories: state.projectRepositories.value,
      projectBranches: state.projectBranches.value,
      pushRegistrationFailed: state.pushRegistrationFailed.value,
      requests: state.requests.value, respondingRequest: state.respondingRequest.value, failedRequest: state.failedRequest.value,
      usage: state.usage.value,
      startup: startup.value, connection: state.status.value, error: state.error.value, errorDetail: state.errorDetail.value, laptops: laptops.value, pairing: pairing.value, pairingError: pairingError.value,
      teams: state.workspace.value.teams.map(team => ({ ...team, isUnread: state.workspace.value.agents.some(agent => agent.teamId === team.id && hasUnreadActivity(agent)) })).map(({ id, name, avatar, isUnread }) => ({ id, name, isUnread, ...(avatar ? { avatar } : {}) })),
      teamId: state.teamId.value, allTeams: showingAllTeams.value, groups, agentId: state.agentId.value,
      header: owner && agent && missionTitle ? { title: missionTitle.title, repository: missionTitle.subtitle, status: agent.status.type, statusText: agent.statusText ?? agent.status.type, icon: null }
        : active && agent ? { title: active.session.displayTitle, repository: active.group.kind === 'repository' ? active.group.label : null,
        status: active.session.status.type, statusText: agent.statusText ?? active.session.status.type, icon: active.group.icon ?? null }
        : null,
      suggestedPrompt: agent?.suggestedPrompt?.trim() || null,
      composerTarget: agent && team ? companionTarget(state.laptopId.value, team, agent) : null,
      goal: agent?.goal ? { objective: agent.goal.objective, status: agent.goal.status } : null,
      goalBusy: state.goalBusy.value, goalError: state.goalError.value,
      review: state.review.value,
      reviewFindingsCount: agent ? state.workspace.value.reviewFindings?.[agent.id] ?? null : null,
      loading: state.loading.value && !hasConversation.value, canSend: state.canSend.value, draft: state.draft.value.text,
      conversationReady: state.conversationReady.value, refreshing: state.refreshing.value,
      conversationGeneration: state.conversationGeneration.value,
      mentions: { status: state.plugins.value.status, items: state.status.value !== 'connected' ? [] : [
        ...projectAgentMentionLabels(state.agents.value, port.chatsLabel ?? 'Chats').map(({ agentId, label }) => ({
          id: `agent:${agentId}`, kind: 'agent' as const, name: label, insertText: `agent:${agentId}`, value: `agent:${agentId}`, description: '',
        })),
        ...state.plugins.value.items.map(plugin => ({ id: `plugin:${plugin.id}`, kind: 'plugin' as const,
          name: pluginDisplayName(plugin), insertText: pluginInsertText(plugin), value: plugin.name || plugin.id, description: pluginDescription(plugin) })),
      ] },
      skills: { status: state.skills.value.status, items: state.skills.value.items.map((skill) => ({ id: skill.path, name: skillDisplayName(skill), insertText: skillInsertText(skill), value: skill.name, description: skillDescription(skill) })) },
      sessionAction: state.sessionAction.value, sessionActionFailed: state.sessionActionFailed.value,
      closePreview: state.closePreview.value, chatCreation: state.chatCreation.value, teamCreation: state.teamCreation.value, missionAction: state.missionAction.value, backends: backendChoices(),
      conversationBackends: backendChoices(agent?.remoteConnectionId ?? state.teamId.value),
      repositoryBackends: Object.fromEntries(sidebarGroups.value.flatMap(group => {
        if (!group.repositoryRoot) return [];
        return [[group.repositoryRoot, backendChoices(group.remoteConnectionId ?? repositoryTeam(group.repositoryRoot))]];
      })), branches: state.branches.value,
      backend: agent?.backend ?? null,
      canSelectBackend: engines() !== null,
      models: state.models.value.map((model) => ({ id: model.id, name: model.displayName, efforts: effortsOf(model), tiers: (model.serviceTiers ?? []).map(({ id, name }) => ({ id, name })) })),
      composer: { modelId: settings?.model?.id ?? null, effort: settings?.reasoningEffort ?? null, serviceTier: settings?.serviceTier ?? null, planMode: settings?.planMode ?? false },
      permissions: { approvalPreset: permissions?.approvalPreset ?? null, permissionMode: permissions?.permissionMode ?? null, presets: [...(capabilities.approvalPresets ?? [])],
        modes: (capabilities.permissionModes ?? []).map((mode) => ({ id: mode.id, label: typeof mode.label === 'string' ? mode.label : mode.label.key })) },
      capabilities: { goals: capabilities.goals, models: capabilities.models, reasoningEffort: capabilities.reasoningEffort, serviceTier: capabilities.serviceTier ?? false,
        planMode: capabilities.planMode !== 'unsupported', interrupt: capabilities.interrupt && state.status.value === 'connected' && state.conversationReady.value, attachments: capabilities.attachments && !agent?.remoteConnectionId },
      favorites: state.modelFavorites.value.filter((favorite) => favorite.backend === agent?.backend).map(({ modelId, reasoningEffort, serviceTier }) => ({ modelId, reasoningEffort, serviceTier })),
    };
  }
  // Derived once per change, shared by the watcher and by whoever asks, and only sent when it differs from what the shell has.
  const view = computed(snapshot);
  function publish() {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      const next = view.value; const json = JSON.stringify(next);
      if (json === lastState) return;
      lastState = json;
      port.post({ type: 'state', state: next });
    });
  }
  watch(view, publish, { flush: 'sync' });
  // Claude and Antigravity publish the sent prompt only after the next read; Codex's snapshot already carries it.
  // Until the real message arrives, the transcript shows the prompt as sent.
  const pending: { id: string; agentId: string; text: string; content?: readonly CodexPromptPart[]; baseline: number; expires: number; createdAt: string }[] = [];
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const userTexts = (frame: CompanionConversation, text: string) => frame.payload.snapshot.messages
    .filter((message) => message.role === 'user' && message.parts.map((part) => part.type === 'text' ? part.text : '').join('').trim() === text.trim()).length;
  /** The frame with the prompts still waiting for the laptop's confirmation, and which prompts those are. */
  function withPending(frame: CompanionConversation | null): { frame: CompanionConversation | null; key: string } {
    if (!frame || frame.backend === 'codex') return { frame, key: '' };
    const now = Date.now();
    const sent = new Map<string, number>();
    const shown = pending.filter((entry) => {
      const seen = (sent.get(entry.text) ?? 0) + 1;
      sent.set(entry.text, seen);
      return entry.agentId === frame.agentId && entry.expires > now && userTexts(frame, entry.text) < entry.baseline + seen;
    });
    if (!shown.length) return { frame, key: '' };
    const snapshot = frame.payload.snapshot;
    const messages = [...snapshot.messages, ...shown.map((entry): (typeof snapshot.messages)[number] => ({ id: entry.id, agentId: entry.agentId, role: 'user', status: 'complete', parts: [{ type: 'text', text: entry.text }], ...(entry.content === undefined ? {} : { metadata: { promptContent: entry.content } }), createdAt: entry.createdAt }))];
    return { frame: { ...frame, payload: { ...frame.payload, snapshot: { ...snapshot, messages } } } as CompanionConversation, key: shown.map((entry) => entry.id).join() };
  }
  const peers = computed(() => state.agents.value.map((agent) => ({ id: agent.id, label: agentDisplayName(agent) })));
  const contextNow = (): TranscriptContext => ({ generation: state.conversationGeneration.value, ready: state.conversationReady.value, agent: state.agent.value, peers: peers.value, history: state.history.value, engines: engines() });

  // Pace presentation work. Incremental hosts send every event since the last paint acknowledgment;
  // other hosts send the latest snapshot. Either payload subsumes older pending presentation work.
  const transcriptInterval = 100;
  const acknowledged = new Map<string, CompanionCheckpoint>();
  let sent: { agentId: string; frame: CompanionConversation | null; ready: boolean; overlay: string; context: string } | null = null;
  let sentAt = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  function postConversation() {
    if (disposed) return;
    const now = Date.now();
    for (let index = pending.length - 1; index >= 0; index--) if (pending[index]!.expires <= now) pending.splice(index, 1);
    clearTimeout(expiry);
    if (pending.length) expiry = setTimeout(postConversation, Math.max(0, Math.min(...pending.map((entry) => entry.expires)) - now) + 1);
    const agentId = state.agentId.value; const raw = state.conversation.value;
    const ready = state.conversationReady.value;
    const overlaid = withPending(raw);
    // An empty chat has no frame to change when loading finishes. Present readiness
    // through the acknowledged render path so the native loading overlay can clear.
    const changed = !sent || sent.agentId !== agentId || sent.frame !== raw || sent.ready !== ready || sent.overlay !== overlaid.key;
    if (changed) {
      // Opening another chat, or a conversation appearing or going, is shown at once; streaming within one is paced.
      const paced = Boolean(sent) && sent!.agentId === agentId && sent!.ready === ready && Boolean(sent!.frame) === Boolean(raw) && sent!.overlay === overlaid.key && now - sentAt < transcriptInterval;
      if (paced) { trailing ??= setTimeout(() => { trailing = undefined; postConversation(); }, transcriptInterval - (now - sentAt)); return; }
      clearTimeout(trailing); trailing = undefined;
      const context = contextNow();
      sent = { agentId, frame: raw, ready, overlay: overlaid.key, context: JSON.stringify(context) }; sentAt = now;
      const identity = JSON.stringify([state.laptopId.value, state.teamId.value, context.agent?.id, context.agent?.backend, context.agent?.backendSession]);
      const updates = port.incrementalTranscript && raw && !overlaid.key ? state.conversationUpdates(acknowledged.get(identity) ?? null) : null;
      if (updates) port.post({ type: 'conversationTransfer', identity, ...updates, agentId, ...context });
      else port.post({ type: 'conversation', agentId, frame: overlaid.frame, ...context });
      return;
    }
    const context = contextNow(); const json = JSON.stringify(context);
    if (json === sent!.context) return;
    sent!.context = json;
    port.post({ type: 'conversationContext', agentId, ...context });
  }
  // Selection changes identity, cached frame and readiness together. Never send an intermediate
  // pairing (new transcript / old agent) across the native bridge.
  watch(() => [state.conversation.value, state.agentId.value, state.agent.value, peers.value, state.history.value, state.conversationReady.value, state.conversationGeneration.value, state.workspace.value] as const, postConversation, { flush: 'post' });

  async function send(command: Extract<EngineCommand, { type: 'send' }>) {
    const onResolved = (status: 'accepted' | 'rejected') => { if (command.requestId && !disposed) port.post({ type: 'sendResult', requestId: command.requestId, status }); };
    const frame = state.conversation.value;
    const followUpBehavior = command.followUpBehavior;
    const content = command.options?.content === undefined ? undefined : trimPromptContent(command.options.content);
    const text = content === undefined ? command.text : promptContentText(content);
    const options = { ...command.options, ...(content === undefined ? {} : { content }), followUpBehavior, uploads: command.uploads, onResolved };
    if (followUpBehavior === 'queue' || !frame || frame.backend === 'codex' || !state.canSend.value || !text.trim()) return state.submit(text, options);
    const entry = { id: `pending-${crypto.randomUUID()}`, agentId: state.agentId.value, text, ...(content === undefined ? {} : { content }), baseline: userTexts(frame, text), expires: Date.now() + 30_000, createdAt: new Date().toISOString() };
    pending.push(entry);
    postConversation();
    const result = await state.submit(text, options);
    if (state.error.value || result !== 'accepted') { pending.splice(pending.indexOf(entry), 1); postConversation(); }
    return result;
  }

  async function pair(code: string, deviceName: string) {
    if (!port.connector.pair || pairing.value !== 'idle') return;
    pairing.value = 'working'; pairingError.value = ''; publish();
    try {
      const id = await port.connector.pair(code, deviceName, () => { pairing.value = 'awaitingApproval'; publish(); });
      laptops.value = [...port.connector.laptops];
      pairing.value = 'idle'; publish();
      await connect(id);
    } catch (error) {
      pairing.value = 'idle'; pairingError.value = error instanceof Error ? error.message : 'mobile.errors.pairing'; publish();
    }
  }

  async function dispatch(command: EngineCommand): Promise<void> {
    switch (command.type) {
      case 'liveActivityRegistration': {
        let success = false;
        try {
          if (!port.connector.registerLiveActivity) throw new Error('Live Activities are unavailable.');
          await port.connector.registerLiveActivity(command.laptopId, command.registration);
          success = true;
        } catch { /* Native retains the token and retries when the app returns. */ }
        port.post({ type: 'liveActivityRegistered', requestId: command.requestId, success });
        return;
      }
      case 'pushRegistration': return state.registerPush(command.registration);
      case 'queuedPrompt': return state.updateQueuedPrompt(command.target, command.promptId, command.action);
      case 'openNotification': {
        const target = command.target;
        const epoch = ++notificationEpoch;
        pendingNotification = null;
        if (!foreground || startup.value !== 'ready') { pendingNotification = target; return; }
        if (!port.connector.laptops.some(laptop => laptop.id === target.hostId)) { port.post({ type: 'notificationOpenFailed' }); return; }
        await port.connector.resume?.();
        if (epoch !== notificationEpoch || disposed) return;
        if (!foreground) { pendingNotification = target; return; }
        if (state.laptopId.value !== target.hostId || state.status.value !== 'connected') await connect(target.hostId);
        if (epoch !== notificationEpoch || disposed) return;
        if (!foreground || state.status.value !== 'connected') { pendingNotification = target; return; }
        const agent = state.workspace.value.agents.find(agent => agent.id === target.agentId);
        const team = state.workspace.value.teams.find(team => team.id === target.teamId);
        if (!agent || !team || (Object.entries(companionTarget(target.hostId, team, agent)) as [keyof CompanionTarget, unknown][]).some(([key, value]) => target[key] !== value)) {
          port.post({ type: 'notificationOpenFailed' }); return;
        }
        await state.selectTeam(target.teamId, target.agentId);
        if (epoch !== notificationEpoch || disposed) return;
        return rememberSelection();
      }
      case 'loadTurnHistory': {
        try {
          await state.loadTurnHistory(command.agentId, command.turnId);
          if (!disposed) port.post({ type: 'turnHistory', requestId: command.requestId, agentId: command.agentId });
        } catch {
          if (!disposed) port.post({ type: 'turnHistory', requestId: command.requestId, agentId: command.agentId, error: 'Couldn’t load turn details. Try again.' });
        }
        return;
      }
      case 'readConversationContent': {
        try {
          const chunk = await state.readConversationContent(command.agentId, command.input);
          if (!disposed) port.post({ type: 'conversationContent', requestId: command.requestId, agentId: command.agentId, sessionId: command.input.sessionId, chunk });
        } catch {
          if (!disposed) port.post({ type: 'conversationContent', requestId: command.requestId, agentId: command.agentId, sessionId: command.input.sessionId, error: 'Conversation content is unavailable.' });
        }
        return;
      }
      case 'readConversationImage': {
        try {
          const image = await state.readImage(command.agentId, command.path, imageCache);
          if (!disposed) port.post({ type: 'conversationImage', requestId: command.requestId, agentId: command.agentId, ...image });
        } catch {
          if (!disposed) port.post({ type: 'conversationImage', requestId: command.requestId, agentId: command.agentId, error: 'Image is unavailable.' });
        }
        return;
      }
      case 'readFilePreview': {
        try {
          const preview = await state.readFilePreview(command.agentId, command.input);
          if (!disposed) port.post({ type: 'conversationFile', requestId: command.requestId, agentId: command.agentId, preview });
        } catch {
          if (!disposed) port.post({ type: 'conversationFile', requestId: command.requestId, agentId: command.agentId, error: 'File is unavailable.' });
        }
        return;
      }
      case 'dismissRequest': return state.dismissRequest(command.key);
      case 'respondRequest': return state.respondRequest(command.reply);
      case 'start': return start();
      case 'pair': return pair(command.code, command.deviceName);
      case 'connect': ++notificationEpoch; pendingNotification = null; return connect(command.laptopId);
      case 'disconnect': ++notificationEpoch; pendingNotification = null; ++restoreEpoch; return state.disconnect();
      case 'chooseConnection': choosingConnection = true; ++notificationEpoch; pendingNotification = null; ++restoreEpoch; state.chooseConnection(); return publish();
      case 'loadUsage': return state.loadUsage();
      case 'idleSort': if (command.order === 'activity' || command.order === 'repository') sidebarIdleSort.value = command.order; return;
      case 'loadChanges': return state.git.load(command.scopeId);
      case 'dismissChanges': return state.git.clear();
      case 'read': {
        if (!foreground || command.agentId !== state.agentId.value || !state.conversationReady.value || command.generation !== state.conversationGeneration.value) return;
        const read = state.agent.value?.readState;
        if (!read || command.revision <= read.readRevision || command.revision > read.revision) return;
        const key = `${state.laptopId.value}/${command.agentId}/${command.revision}`;
        if (reading.has(key)) return;
        reading.add(key);
        try { await state.markRead(command.agentId, command.revision); }
        catch { /* A later render or reconnect retries the visible revision. */ }
        finally { reading.delete(key); }
        return;
      }
      case 'transcriptApplied':
        acknowledged.delete(command.identity); acknowledged.set(command.identity, command.checkpoint);
        while (acknowledged.size > 8) acknowledged.delete(acknowledged.keys().next().value!);
        return;
      case 'transcriptReset':
        acknowledged.delete(command.identity); sent = null; postConversation(); return;
      case 'refreshConversation': await state.selectAgent(state.agentId.value); return;
      case 'activity': {
        const activity = ++activityEpoch;
        connectionDiagnostic('app.activity', { stage: command.active ? 'foreground' : 'background' });
        foreground = command.active;
        if (!command.active) {
          void state.setActive(false);
          lifecycle.left(() => !disposed && !foreground);
          return;
        }
        // Each step may be overtaken by the app leaving again, or by a newer foreground.
        const superseded = () => disposed || activity !== activityEpoch || !foreground;
        sidebarNow.value = Date.now();
        await lifecycle.returned();
        if (superseded()) return;
        await port.connector.resume?.();
        lifecycle.resumed();
        if (superseded()) return;
        await state.setActive(true);
        if (superseded()) return;
        if (startupWork) {
          // Native activation cannot wait for a restore that may itself need the phone to unlock.
          void startupWork.then(() => { if (!superseded() && startup.value === 'error') void start(); });
          return;
        }
        if (startup.value === 'error') return start();
        if (!choosingConnection && !state.laptopId.value && startup.value === 'ready') {
          const preferred = await preferredLaptop();
          if (!superseded() && preferred) await connect(preferred);
        } else await state.reconnect();
        return openPendingNotification();
      }
      case 'reconnect': await state.reconnect(true); return openPendingNotification();
      case 'renameLaptop': {
        // The screen checks the name as it is typed; a laptop that refuses it is simply left as it was.
        await port.connector.rename?.(command.laptopId, command.name).catch(() => {});
        laptops.value = [...port.connector.laptops]; return publish();
      }
      case 'forget': {
        const laptopId = command.laptopId ?? state.laptopId.value;
        if (!laptops.value.some(laptop => laptop.id === laptopId)) return;
        await imageCache?.forget(laptopId).catch(() => {});
        if (laptopId === state.laptopId.value) {
          ++notificationEpoch; pendingNotification = null; ++restoreEpoch;
          await state.revoke();
        } else {
          // Local pairing removal succeeds even when the old computer is unavailable.
          await port.connector.revoke(laptopId).catch(() => {});
        }
        await port.selectionStore?.remove(laptopId).catch(() => {});
        laptops.value = [...port.connector.laptops]; return publish();
      }
      case 'createTeam': {
        const epoch = restoreEpoch;
        const id = await state.createTeam(command.name);
        if (id && epoch === restoreEpoch) {
          allTeams.value = false;
          await state.selectTeam(id);
          await rememberSelection();
        }
        return;
      }
      case 'dismissTeamCreation': return state.dismissTeamCreation();
      case 'finishReview': return state.finishReview(command.missionId);
      case 'continueMission': return state.continueMission(command.missionId);
      case 'acceptTicket': return state.acceptTicket(command.missionId, command.number);
      case 'selectFinding': return state.selectFinding(command.missionId, command.findingId, command.selected);
      case 'fixFindings': return state.fixFindings(command.missionId);
      case 'rerunReview': return state.rerunReview(command.missionId);
      case 'dismissMissionAction': return state.dismissMissionAction();
      case 'openActivityThread': {
        const epoch = ++notificationEpoch; pendingNotification = null; ++restoreEpoch;
        const agent = companionAgents(state.workspace.value).find(agent => agent.id === command.agentId);
        const team = state.workspace.value.teams.find(team => team.id === agent?.teamId);
        if (command.laptopId !== state.laptopId.value || state.status.value !== 'connected' || !agent || !team) {
          port.post({ type: 'notificationOpenFailed' }); return;
        }
        await port.connector.resume?.();
        if (epoch !== notificationEpoch || disposed) return;
        allTeams.value = false;
        await state.selectTeam(team.id, agent.id);
        return rememberSelection();
      }
      case 'selectAllTeams': ++notificationEpoch; pendingNotification = null; ++restoreEpoch; allTeams.value = state.workspace.value.teams.length > 1; return rememberSelection();
      case 'selectTeam': ++notificationEpoch; pendingNotification = null; ++restoreEpoch; allTeams.value = false; await state.selectTeam(command.id); return rememberSelection();
      case 'selectAgent': {
        // An agent the laptop no longer shows is not a reason to land on some other conversation.
        if (!companionAgents(state.workspace.value).some(agent => agent.id === command.id)) return;
        ++notificationEpoch; pendingNotification = null;
        ++restoreEpoch;
        const owner = showingAllTeams.value || state.missions.value.some(mission => mission.leadAgentId === command.id || mission.tickets.some(ticket => ticket.agentId === command.id))
          ? companionAgents(state.workspace.value).find(agent => agent.id === command.id) : undefined;
        const loading = owner?.teamId && owner.teamId !== state.teamId.value ? state.selectTeam(owner.teamId, owner.id) : state.selectAgent(command.id);
        await rememberSelection();
        return loading;
      }
      case 'loadOlder': return state.loadOlder(command.agentId);
      case 'draft': return state.updateDraft({ text: command.text, selectionStart: command.text.length, selectionEnd: command.text.length });
      case 'loadMentions': return state.loadPlugins();
      case 'loadSkills': return state.loadSkills();
      case 'clearGoal': await state.changeGoal(command.target, null); return;
      case 'send': {
        const current = snapshot().composerTarget;
        const targetMatches = command.target && current && (Object.keys(current) as (keyof CompanionTarget)[]).every((key) => current[key] === command.target![key]);
        const valid = (!command.requestId || targetMatches) && validPromptUploads(command.uploads ?? [])
          && (!command.uploads?.length || snapshot().capabilities.attachments);
        const status = !valid ? 'rejected' : command.goalMode
          ? targetMatches && !command.uploads?.length && !command.options?.attachments?.length
            ? await state.changeGoal(command.target!, command.text) : 'rejected'
          : await send(command);
        if (command.requestId && !disposed) port.post({ type: 'sendResult', requestId: command.requestId, status });
        return;
      }
      case 'interrupt': return state.interrupt();
      case 'restartSession': await state.restartSession(); return rememberSelection();
      case 'closeSession': await state.requestCloseSession(); return rememberSelection();
      case 'confirmCloseSession': await state.confirmCloseSession(command.agentId, command.deleteWorktree, command.deleteRemoteBranch, command.discardChanges); return rememberSelection();
      case 'loadBranches': return state.loadBranches(command.repositoryId, repositoryTeam(command.repositoryId));
      case 'loadProjectBranches': return state.loadProjectBranches(command.repositoryId, command.source);
      case 'dismissProjectBranches': return state.dismissProjectBranches();
      case 'loadProjectRepositories': return state.loadProjectRepositories(command.source);
      case 'dismissProjectRepositories': return state.dismissProjectRepositories();
      case 'duplicateAgent': return state.duplicateAgent(command.target, command.backend);
      case 'renameAgent': return state.renameAgent(command.target, command.name);
      case 'createProject': return state.createProject({ source: command.source, value: command.value, ...(command.branch ? { branch: command.branch } : {}), ...(command.worktree ? { worktree: command.worktree } : {}), selection: { ...command.selection } });
      case 'dismissBranches': return state.dismissBranches();
      case 'newChat': return state.createChat({ repositoryId: command.repositoryId, ...(command.existingBranch ? { existingBranch: command.existingBranch } : {}), ...(command.branchName ? { worktree: { branchName: command.branchName } } : {}), selection: { backend: command.backend } }, repositoryTeam(command.repositoryId));
      case 'backend': return state.selectBackend(command.backend);
      case 'newQuickChat': return state.createQuickChat(command.backend);
      case 'dismissNewChat': return state.dismissChatCreation();
      case 'cancelCloseSession': return state.cancelCloseSession();
      case 'dismissSessionError': return state.dismissSessionError();
      case 'composer': return state.updateComposerSettings(command.change);
      case 'approvalPreset': return state.setApprovalPreset(command.preset);
      case 'permissionMode': return state.setPermissionMode(command.mode);
      case 'delegate': return state.delegate({ startingContext: command.startingContext, ...(command.instructions ? { instructions: command.instructions } : {}) });
      case 'loadReviewDetails': return state.loadReviewDetails();
      case 'reviewAction': return state.actOnReview(command.target, command.input);
      case 'loadReview': return state.loadReview(command.backend);
      case 'dismissReview': return state.dismissReview();
      case 'review': await state.startReview(command.input, command.target); return rememberSelection();
    }
  }

  /** Reopens the last successful laptop, or the sole saved pairing. */
  function start(): Promise<void> {
    return startupWork ??= restoreStartup().finally(() => { startupWork = null; });
  }

  async function restoreStartup() {
    startup.value = 'loading'; publish();
    try {
      await port.connector.initialize?.();
      laptops.value = [...port.connector.laptops];
      publish();
      const epoch = restoreEpoch;
      const preferred = await preferredLaptop();
      if (!disposed && foreground && epoch === restoreEpoch && preferred) await connect(preferred);
      startup.value = 'ready';
    } catch { startup.value = 'error'; }
    publish();
    await openPendingNotification();
  }

  return { dispatch, start, snapshot: () => view.value, dispose() { disposed = true; ++notificationEpoch; pendingNotification = null; stopNotificationReconnect(); stopGitDiff(); clearInterval(sidebarClock); lifecycle.dispose(); clearTimeout(expiry); clearTimeout(trailing); state.dispose(); void port.connector.dispose?.(); } };
}
