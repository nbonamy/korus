import type { CompanionCheckpoint, CompanionSync } from '@workspace/core/companion-journal';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import { computed, ref, watch } from 'vue';
import { hasUnreadActivity } from '@workspace/core/agent-read-state';
import { skillDescription, skillDisplayName, skillInsertText, pluginDescription, pluginDisplayName, pluginInsertText } from '@codex-app-sdk/vue';
import type { Agent, AgentBackend, BackendModelOption } from '@workspace/core/contracts';
import { canSelectAgentBackend } from '@workspace/core/agent-backends';
import { projectAgentMentionLabels } from '@workspace/core/workspace-sidebar';
import { agentDisplayName } from '@workspace/core/agent-display';
import { companionBackgroundGraceMs, companionTarget, type CompanionTarget, type CompanionBranch } from '@workspace/core/companion-protocol';
import { validPromptUploads } from './prompt-uploads';
import { connectionDiagnostic } from './connection-diagnostics';
import type { CompanionUpload, CompanionConnector, CompanionConversation, CompanionHistoryState, CompanionReviewInput } from './companion-port';
import { createCompanionState } from './companion-state';
import { composerCapabilitiesFor, type ComposerChange } from './composer-settings';
import { activeSession, projectMobileActivityGroups, projectMobileGroups, type MobileActivityGroup, type MobileSidebarGroup } from './workspace-groups';
import type { SelectionStore } from './selection-store';
import type { CompanionRequestReply, CompanionClosePreview } from '@workspace/core/companion-protocol';

/** Everything the native shell draws, as plain data: no framework, no protocol detail. */
export type EngineState = {
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
  laptops: { id: string; name: string }[];
  pairing: 'idle' | 'working' | 'awaitingApproval';
  pairingError: string;
  teams: { id: string; name: string; avatar?: string; isUnread: boolean }[];
  teamId: string;
  laptopId: string;
  groups: MobileSidebarGroup[];
  activityGroups: MobileActivityGroup[];
  agentId: string;
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
  sessionAction: 'interrupt' | 'restart' | 'close' | 'previewClose' | null;
  sessionActionFailed: boolean;
  closePreview: CompanionClosePreview | null;
  chatCreation: 'idle' | 'creating' | 'failed';
  /** The engines the open team's laptop can start a chat with. */
  backends: string[];
  branches: { repositoryId: string | null; status: 'idle' | 'loading' | 'loaded' | 'failed'; items: CompanionBranch[] };
  /** The engine of the open chat, and whether it may still be changed: only before the first prompt. */
  backend: string | null;
  canSelectBackend: boolean;
  draft: string;
  mentions: { status: 'idle' | 'loading' | 'loaded' | 'failed'; items: { id: string; kind: 'agent' | 'plugin'; name: string; insertText: string; description: string }[] };
  skills: { status: 'idle' | 'loading' | 'loaded' | 'failed'; items: { id: string; name: string; insertText: string; description: string }[] };
  models: { id: string; name: string; efforts: string[]; tiers: { id: string; name: string }[] }[];
  composer: { modelId: string | null; effort: string | null; serviceTier: string | null; planMode: boolean };
  permissions: { approvalPreset: string | null; permissionMode: string | null; presets: string[]; modes: { id: string; label: string }[] };
  capabilities: { goals: boolean; models: boolean; reasoningEffort: boolean; serviceTier: boolean; planMode: boolean; interrupt: boolean; attachments: boolean };
  favorites: { modelId: string; reasoningEffort: string | null; serviceTier: string | null }[];
};

export type EngineEvent =
  | { type: 'gitDiff'; diff: string }
  | { type: 'conversationImage'; requestId: string; agentId: string; dataUrl?: string; error?: string }
  | { type: 'notification'; notification: CompanionNotification }
  | { type: 'notificationOpenFailed' }
  | { type: 'sendResult'; requestId: string; status: 'accepted' | 'rejected' | 'unknown' }
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
  | { type: 'idleSort'; order: 'activity' | 'repository' }
  | { type: 'loadChanges'; scopeId?: string } | { type: 'dismissChanges' }
  | { type: 'readConversationImage'; requestId: string; agentId: string; path: string }
  | { type: 'loadProjectBranches'; repositoryId: string; source?: 'github' | 'local' } | { type: 'dismissProjectBranches' }
  | { type: 'loadProjectRepositories'; source?: 'github' | 'local' } | { type: 'dismissProjectRepositories' }
  | { type: 'duplicateAgent'; target: CompanionTarget; backend: AgentBackend }
  | ({ type: 'createProject' } & Omit<import('@workspace/core/companion-protocol').CompanionProjectInput, 'teamId'>)
  | { type: 'loadUsage' }
  | { type: 'pushRegistration'; registration: CompanionPushRegistration | null }
  | { type: 'openNotification'; target: CompanionTarget }
  | { type: 'readConversationContent'; requestId: string; agentId: string; input: import('@workspace/core/contracts/conversation').ConversationContentInput }
  | { type: 'respondRequest'; reply: CompanionRequestReply }
  | { type: 'transcriptApplied'; identity: string; checkpoint: CompanionCheckpoint }
  | { type: 'transcriptReset'; identity: string }
  | { type: 'refreshConversation' }
  | { type: 'start' }
  | { type: 'pair'; code: string; deviceName: string }
  | { type: 'connect'; laptopId: string }
  | { type: 'disconnect' } | { type: 'reconnect' } | { type: 'forget' }
  /** App visibility; background connections have the same grace period as the native lock. */
  | { type: 'activity'; active: boolean }
  | { type: 'read'; agentId: string; revision: number; generation: number }
  | { type: 'selectTeam'; id: string } | { type: 'selectAgent'; id: string }
  | { type: 'loadOlder'; agentId: string }
  | { type: 'draft'; text: string }
  | { type: 'loadSkills' }
  | { type: 'loadMentions' }
  | { type: 'clearGoal'; target: CompanionTarget }
  | { type: 'send'; followUpBehavior?: 'queue' | 'steer'; goalMode?: boolean; text: string; requestId?: string; target?: CompanionTarget; uploads?: CompanionUpload[]; options?: { attachments?: { type?: string; reference: string }[] } }
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
  | { type: 'review'; target: CompanionTarget; input: CompanionReviewInput };

export type EnginePort = { connector: CompanionConnector; selectionStore?: SelectionStore; chatsLabel?: string; initialActive?: boolean; incrementalTranscript?: boolean; post(event: EngineEvent): void };

const effortsOf = (model: BackendModelOption) => (model.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort);

export function createEngine(port: EnginePort) {
  const state = createCompanionState(port.connector, undefined, undefined, notification => { if (!disposed && foreground) port.post({ type: 'notification', notification }); });
  const startup = ref<EngineState['startup']>('loading');
  const pairing = ref<EngineState['pairing']>('idle');
  const pairingError = ref('');
  const laptops = ref([...port.connector.laptops]);
  let disposed = false;
  let foreground = port.initialActive ?? true;
  const sidebarNow = ref(Date.now());
  const sidebarIdleSort = ref<'activity' | 'repository'>('activity');
  const sidebarClock = setInterval(() => { if (foreground) sidebarNow.value = Date.now(); }, 1_000);
  let activityEpoch = 0;
  let backgroundedAt: number | undefined;
  let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
  let backgroundSuspended = false;

  let suspension: Promise<void> | undefined;
  function suspendAfterGrace() {
    if (backgroundSuspended) return suspension;
    backgroundSuspended = true;
    connectionDiagnostic('app.background-grace-expired');
    state.disconnect();
    suspension = Promise.resolve(port.connector.suspend?.());
    return suspension;
  }
  let pendingNotification: CompanionTarget | null = null;
  let notificationEpoch = 0;
  let restoringSelection = 0;
  const reading = new Set<string>();
  let scheduled = false;
  let lastState = '';
  let selectionEpoch = 0;
  const backendChoices = () => state.workspace.value.backends?.[state.teamId.value] ?? [];
  const engines = () => { const agent = state.agent.value; return agent && backendChoices().length > 1 && canSelectAgentBackend(agent) ? { current: agent.backend, choices: backendChoices() } : null; };

  async function rememberSelection() {
    if (!state.laptopId.value || !port.selectionStore) return;
    // Navigation remains usable if device storage is temporarily unavailable.
    await port.selectionStore.write(state.laptopId.value, { teamId: state.teamId.value, agentId: state.agentId.value }).catch(() => {});
  }

  async function connect(laptopId: string) {
    ++restoringSelection;
    try {
      const epoch = ++selectionEpoch;
      await state.connect(laptopId);
      if (disposed || epoch !== selectionEpoch || state.status.value !== 'connected') return;
      const saved = await port.selectionStore?.read(laptopId).catch(() => null);
      if (disposed || epoch !== selectionEpoch || state.laptopId.value !== laptopId || state.status.value !== 'connected') return;
      const teams = state.workspace.value.teams;
      const team = teams.find((candidate) => candidate.id === saved?.teamId)
        ?? teams.find((candidate) => candidate.id === state.teamId.value) ?? teams[0];
      await state.selectTeam(team?.id ?? '', team?.id === saved?.teamId ? saved?.agentId : undefined);
      if (!disposed && epoch === selectionEpoch) await rememberSelection();
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
    const groups = projectMobileGroups(state.agents.value, state.agentId.value || null, port.chatsLabel ?? 'Chats', state.workspace.value.repositoryIcons);
    const active = activeSession(groups);
    const capabilities = composerCapabilitiesFor(agent?.backend ?? 'codex', state.models.value);
    const settings = state.composerSettings.value;
    const permissions = state.permissions.value;
    return {
      git: state.git.view.value,
      laptopId: state.laptopId.value,
      activityGroups: projectMobileActivityGroups(state.agents.value, groups, sidebarNow.value, sidebarIdleSort.value),
      queuedPrompts: (state.workspace.value.queuedPrompts ?? []).filter(prompt => prompt.agentId === agent?.id).map(({ id, text }) => ({ id, text })),
      queuedPromptPending: state.queuedPromptPending.value,
      queuedPromptFailed: state.queuedPromptFailed.value,
      projectRepositories: state.projectRepositories.value,
      projectBranches: state.projectBranches.value,
      pushRegistrationFailed: state.pushRegistrationFailed.value,
      requests: state.requests.value, respondingRequest: state.respondingRequest.value, failedRequest: state.failedRequest.value,
      usage: state.usage.value,
      startup: startup.value, connection: state.status.value, error: state.error.value, laptops: laptops.value, pairing: pairing.value, pairingError: pairingError.value,
      teams: state.workspace.value.teams.map(team => ({ ...team, isUnread: state.workspace.value.agents.some(agent => agent.teamId === team.id && hasUnreadActivity(agent)) })).map(({ id, name, avatar, isUnread }) => ({ id, name, isUnread, ...(avatar ? { avatar } : {}) })),
      teamId: state.teamId.value, groups, agentId: state.agentId.value,
      header: active && agent ? { title: active.session.displayTitle, repository: active.group.kind === 'repository' ? active.group.label : null,
        status: active.session.status.type, statusText: agent.statusText ?? active.session.status.type, icon: active.group.icon ?? null } : null,
      composerTarget: agent && team ? companionTarget(state.laptopId.value, team, agent) : null,
      goal: agent?.goal ? { objective: agent.goal.objective, status: agent.goal.status } : null,
      goalBusy: state.goalBusy.value, goalError: state.goalError.value,
      review: state.review.value,
      loading: state.loading.value && !hasConversation.value, canSend: state.canSend.value, draft: state.draft.value.text,
      conversationReady: state.conversationReady.value, refreshing: state.refreshing.value,
      conversationGeneration: state.conversationGeneration.value,
      mentions: { status: state.plugins.value.status, items: state.status.value !== 'connected' ? [] : [
        ...projectAgentMentionLabels(state.agents.value, port.chatsLabel ?? 'Chats').map(({ agentId, label }) => ({
          id: `agent:${agentId}`, kind: 'agent' as const, name: label, insertText: `agent:${agentId}`, description: '',
        })),
        ...state.plugins.value.items.map(plugin => ({ id: `plugin:${plugin.id}`, kind: 'plugin' as const,
          name: pluginDisplayName(plugin), insertText: pluginInsertText(plugin), description: pluginDescription(plugin) })),
      ] },
      skills: { status: state.skills.value.status, items: state.skills.value.items.map((skill) => ({ id: skill.path, name: skillDisplayName(skill), insertText: skillInsertText(skill), description: skillDescription(skill) })) },
      sessionAction: state.sessionAction.value, sessionActionFailed: state.sessionActionFailed.value,
      closePreview: state.closePreview.value, chatCreation: state.chatCreation.value, backends: backendChoices(), branches: state.branches.value,
      backend: agent?.backend ?? null,
      canSelectBackend: engines() !== null,
      models: state.models.value.map((model) => ({ id: model.id, name: model.displayName, efforts: effortsOf(model), tiers: (model.serviceTiers ?? []).map(({ id, name }) => ({ id, name })) })),
      composer: { modelId: settings?.model?.id ?? null, effort: settings?.reasoningEffort ?? null, serviceTier: settings?.serviceTier ?? null, planMode: settings?.planMode ?? false },
      permissions: { approvalPreset: permissions?.approvalPreset ?? null, permissionMode: permissions?.permissionMode ?? null, presets: [...(capabilities.approvalPresets ?? [])],
        modes: (capabilities.permissionModes ?? []).map((mode) => ({ id: mode.id, label: typeof mode.label === 'string' ? mode.label : mode.label.key })) },
      capabilities: { goals: capabilities.goals, models: capabilities.models, reasoningEffort: capabilities.reasoningEffort, serviceTier: capabilities.serviceTier ?? false,
        planMode: capabilities.planMode !== 'unsupported', interrupt: capabilities.interrupt && state.status.value === 'connected' && state.conversationReady.value, attachments: capabilities.attachments && !team?.remoteConnectionId },
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
  const pending: { id: string; agentId: string; text: string; baseline: number; expires: number; createdAt: string }[] = [];
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
    const messages = [...snapshot.messages, ...shown.map((entry): (typeof snapshot.messages)[number] => ({ id: entry.id, agentId: entry.agentId, role: 'user', status: 'complete', parts: [{ type: 'text', text: entry.text }], createdAt: entry.createdAt }))];
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
    if (followUpBehavior === 'queue' || !frame || frame.backend === 'codex' || !state.canSend.value || !command.text.trim()) return state.submit(command.text, { ...command.options, followUpBehavior, uploads: command.uploads, onResolved });
    const entry = { id: `pending-${crypto.randomUUID()}`, agentId: state.agentId.value, text: command.text, baseline: userTexts(frame, command.text), expires: Date.now() + 30_000, createdAt: new Date().toISOString() };
    pending.push(entry);
    postConversation();
    const result = await state.submit(command.text, { ...command.options, followUpBehavior, uploads: command.uploads, onResolved });
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
          const image = await state.readImage(command.agentId, command.path);
          if (!disposed) port.post({ type: 'conversationImage', requestId: command.requestId, agentId: command.agentId, ...image });
        } catch {
          if (!disposed) port.post({ type: 'conversationImage', requestId: command.requestId, agentId: command.agentId, error: 'Image is unavailable.' });
        }
        return;
      }
      case 'respondRequest': return state.respondRequest(command.reply);
      case 'start': return start();
      case 'pair': return pair(command.code, command.deviceName);
      case 'connect': ++notificationEpoch; pendingNotification = null; return connect(command.laptopId);
      case 'disconnect': ++notificationEpoch; pendingNotification = null; ++selectionEpoch; return state.disconnect();
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
        if (command.active) {
          sidebarNow.value = Date.now();
          clearTimeout(backgroundTimer); backgroundTimer = undefined;
          if (backgroundedAt !== undefined && Date.now() - backgroundedAt >= companionBackgroundGraceMs) suspendAfterGrace();
          await suspension?.catch(() => {});
          if (disposed || activity !== activityEpoch || !foreground) return;
          suspension = undefined; backgroundedAt = undefined; backgroundSuspended = false;
          await port.connector.resume?.();
          if (disposed || activity !== activityEpoch || !foreground) return;
          await state.setActive(true);
          if (disposed || activity !== activityEpoch || !foreground) return;
          if (!state.laptopId.value && startup.value === 'ready' && laptops.value.length === 1) await connect(laptops.value[0]!.id);
          else await state.reconnect();
          return openPendingNotification();
        }
        void state.setActive(false);
        if (backgroundedAt === undefined) {
          backgroundedAt = Date.now();
          backgroundTimer = setTimeout(() => {
            backgroundTimer = undefined;
            if (!disposed && !foreground) void suspendAfterGrace()?.catch(() => {});
          }, companionBackgroundGraceMs);
        }
        return;
      }
      case 'reconnect': await state.reconnect(true); return openPendingNotification();
      case 'forget': {
        ++notificationEpoch; pendingNotification = null;
        ++selectionEpoch;
        const laptopId = state.laptopId.value;
        await state.revoke();
        await port.selectionStore?.remove(laptopId).catch(() => {});
        laptops.value = [...port.connector.laptops]; return publish();
      }
      case 'selectTeam': ++notificationEpoch; pendingNotification = null; ++selectionEpoch; await state.selectTeam(command.id); return rememberSelection();
      case 'selectAgent': {
        ++notificationEpoch; pendingNotification = null;
        ++selectionEpoch;
        const loading = state.selectAgent(command.id);
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
      case 'loadBranches': return state.loadBranches(command.repositoryId);
      case 'loadProjectBranches': return state.loadProjectBranches(command.repositoryId, command.source);
      case 'dismissProjectBranches': return state.dismissProjectBranches();
      case 'loadProjectRepositories': return state.loadProjectRepositories(command.source);
      case 'dismissProjectRepositories': return state.dismissProjectRepositories();
      case 'duplicateAgent': return state.duplicateAgent(command.target, command.backend);
      case 'createProject': return state.createProject({ source: command.source, value: command.value, backend: command.backend, ...(command.branch ? { branch: command.branch } : {}), ...(command.worktree ? { worktree: command.worktree } : {}) });
      case 'dismissBranches': return state.dismissBranches();
      case 'newChat': return state.createChat({ repositoryId: command.repositoryId, backend: command.backend, ...(command.existingBranch ? { existingBranch: command.existingBranch } : {}), ...(command.branchName ? { worktree: { branchName: command.branchName } } : {}) });
      case 'backend': return state.selectBackend(command.backend);
      case 'newQuickChat': return state.createQuickChat(command.backend);
      case 'dismissNewChat': return state.dismissChatCreation();
      case 'cancelCloseSession': return state.cancelCloseSession();
      case 'dismissSessionError': return state.dismissSessionError();
      case 'composer': return state.updateComposerSettings(command.change);
      case 'approvalPreset': return state.setApprovalPreset(command.preset);
      case 'permissionMode': return state.setPermissionMode(command.mode);
      case 'delegate': return state.delegate({ startingContext: command.startingContext, ...(command.instructions ? { instructions: command.instructions } : {}) });
      case 'loadReview': return state.loadReview(command.backend);
      case 'dismissReview': return state.dismissReview();
      case 'review': await state.startReview(command.input, command.target); return rememberSelection();
    }
  }

  /** Opens the saved pairing when there is exactly one; with several, the person chooses. */
  async function start() {
    startup.value = 'loading'; publish();
    try {
      await port.connector.initialize?.();
      laptops.value = [...port.connector.laptops];
      publish();
      if (foreground && laptops.value.length === 1) await connect(laptops.value[0]!.id);
      startup.value = 'ready';
    } catch { startup.value = 'error'; }
    publish();
    await openPendingNotification();
  }

  return { dispatch, start, snapshot: () => view.value, dispose() { disposed = true; ++notificationEpoch; pendingNotification = null; stopNotificationReconnect(); stopGitDiff(); clearInterval(sidebarClock); clearTimeout(backgroundTimer); clearTimeout(expiry); clearTimeout(trailing); state.dispose(); void port.connector.dispose?.(); } };
}
