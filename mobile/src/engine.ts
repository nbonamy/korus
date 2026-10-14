import { computed, ref, watch } from 'vue';
import type { Agent, BackendModelOption } from '@workspace/core/contracts';
import { canSelectAgentBackend } from '@workspace/core/agent-backends';
import { agentDisplayName } from '@workspace/core/agent-display';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { CompanionConnector, CompanionConversation, CompanionHistoryState, CompanionPromptOptions, CompanionReviewInput } from './companion-port';
import { createCompanionState } from './companion-state';
import type { ComposerChange } from './composer-settings';
import { activeSession, projectMobileGroups, type MobileSidebarGroup } from './workspace-groups';
import type { SelectionStore } from './selection-store';
import type { CompanionRequestReply, CompanionClosePreview } from '@workspace/core/companion-protocol';

/** Everything the native shell draws, as plain data: no framework, no protocol detail. */
export type EngineState = {
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
  teams: { id: string; name: string; avatar?: string }[];
  teamId: string;
  groups: MobileSidebarGroup[];
  agentId: string;
  header: { title: string; repository: string | null; status: string; statusText: string; icon: string | null } | null;
  loading: boolean;
  canSend: boolean;
  sessionAction: 'interrupt' | 'restart' | 'close' | 'previewClose' | null;
  sessionActionFailed: boolean;
  closePreview: CompanionClosePreview | null;
  chatCreation: 'idle' | 'creating' | 'failed';
  /** The engines the open team's laptop can start a chat with. */
  backends: string[];
  /** The engine of the open chat, and whether it may still be changed: only before the first prompt. */
  backend: string | null;
  canSelectBackend: boolean;
  draft: string;
  models: { id: string; name: string; efforts: string[]; tiers: { id: string; name: string }[] }[];
  composer: { modelId: string | null; effort: string | null; serviceTier: string | null; planMode: boolean };
  permissions: { approvalPreset: string | null; permissionMode: string | null; presets: string[]; modes: { id: string; label: string }[] };
  capabilities: { models: boolean; reasoningEffort: boolean; serviceTier: boolean; planMode: boolean; interrupt: boolean; attachments: boolean };
  favorites: { modelId: string; reasoningEffort: string | null; serviceTier: string | null }[];
};

export type EngineEvent =
  | { type: 'state'; state: EngineState }
  /** The open conversation, for the transcript: the provider's own snapshot plus the agent it belongs to. */
  | ({ type: 'conversation'; agentId: string; frame: CompanionConversation | null } & TranscriptContext)
  /** Everything around the open conversation changed but the conversation itself did not: small, and never resends the transcript. */
  | ({ type: 'conversationContext'; agentId: string } & TranscriptContext);

/** What the transcript needs besides the conversation: the chat's own record, the names it can mention, and what an empty chat offers. */
export type TranscriptContext = {
  ready: boolean; agent: Agent | null; peers: { id: string; label: string }[]; history: CompanionHistoryState;
  /** An empty chat's engine and the ones it may switch to. */
  engines: { current: string; choices: string[] } | null;
};

export type EngineCommand =
  | { type: 'respondRequest'; reply: CompanionRequestReply }
  | { type: 'start' }
  | { type: 'pair'; code: string; deviceName: string }
  | { type: 'connect'; laptopId: string }
  | { type: 'disconnect' } | { type: 'reconnect' } | { type: 'forget' }
  /** The app moved to the foreground or background: the link is held only while it is visible. */
  | { type: 'activity'; active: boolean }
  | { type: 'selectTeam'; id: string } | { type: 'selectAgent'; id: string }
  | { type: 'loadOlder'; agentId: string }
  | { type: 'draft'; text: string }
  | { type: 'send'; text: string; options?: { attachments?: { type?: string; reference: string }[] } }
  | { type: 'interrupt' }
  | { type: 'restartSession' } | { type: 'closeSession' } | { type: 'dismissSessionError' }
  | { type: 'confirmCloseSession'; agentId: string; deleteWorktree: boolean; deleteRemoteBranch?: boolean; discardChanges?: boolean }
  | { type: 'cancelCloseSession' }
  | { type: 'newChat'; repositoryId: string; backend: 'codex' | 'claude' | 'antigravity'; branchName?: string } | { type: 'newQuickChat'; backend: 'codex' | 'claude' | 'antigravity' } | { type: 'dismissNewChat' } | { type: 'backend'; backend: 'codex' | 'claude' | 'antigravity' }
  | { type: 'composer'; change: ComposerChange }
  | { type: 'approvalPreset'; preset: string } | { type: 'permissionMode'; mode: string }
  | { type: 'delegate'; startingContext: 'conversation' | 'handoff'; instructions?: string }
  | { type: 'review'; input: CompanionReviewInput };

export type EnginePort = { connector: CompanionConnector; selectionStore?: SelectionStore; chatsLabel?: string; post(event: EngineEvent): void };

const effortsOf = (model: BackendModelOption) => (model.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort);

export function createEngine(port: EnginePort) {
  const state = createCompanionState(port.connector, undefined);
  const startup = ref<EngineState['startup']>('loading');
  const pairing = ref<EngineState['pairing']>('idle');
  const pairingError = ref('');
  const laptops = ref([...port.connector.laptops]);
  let disposed = false;
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
    const epoch = ++selectionEpoch;
    await state.connect(laptopId);
    if (!port.selectionStore || disposed || epoch !== selectionEpoch || state.status.value !== 'connected') return;
    const saved = await port.selectionStore.read(laptopId).catch(() => null);
    if (disposed || epoch !== selectionEpoch || state.laptopId.value !== laptopId || state.status.value !== 'connected') return;
    const teams = state.workspace.value.teams;
    const team = teams.find((candidate) => candidate.id === saved?.teamId) ?? teams[0];
    await state.selectTeam(team?.id ?? '');
    if (disposed || epoch !== selectionEpoch) return;
    const agent = (team?.id === saved?.teamId ? state.agents.value.find((candidate) => candidate.id === saved?.agentId) : undefined) ?? state.agents.value[0];
    await state.selectAgent(agent?.id ?? '');
    if (!disposed && epoch === selectionEpoch) await rememberSelection();
  }

  // Only whether a conversation is open matters here: its content changing must not rebuild the state.
  const hasConversation = computed(() => Boolean(state.conversation.value));
  function snapshot(): EngineState {
    const agent = state.agent.value;
    const groups = projectMobileGroups(state.agents.value, state.agentId.value || null, port.chatsLabel ?? 'Chats', state.workspace.value.repositoryIcons);
    const active = activeSession(groups);
    const capabilities = defaultBackendCapabilities(agent?.backend ?? 'codex');
    const settings = state.composerSettings.value;
    const permissions = state.permissions.value;
    return {
      requests: state.requests.value, respondingRequest: state.respondingRequest.value, failedRequest: state.failedRequest.value,
      startup: startup.value, connection: state.status.value, error: state.error.value, laptops: laptops.value, pairing: pairing.value, pairingError: pairingError.value,
      teams: state.workspace.value.teams.map(({ id, name, avatar }) => ({ id, name, ...(avatar ? { avatar } : {}) })),
      teamId: state.teamId.value, groups, agentId: state.agentId.value,
      header: active && agent ? { title: active.session.displayTitle, repository: active.group.kind === 'repository' ? active.group.label : null,
        status: active.session.status.type, statusText: agent.statusText ?? active.session.status.type, icon: active.group.icon ?? null } : null,
      loading: state.loading.value && !hasConversation.value, canSend: state.canSend.value, draft: state.draft.value.text,
      sessionAction: state.sessionAction.value, sessionActionFailed: state.sessionActionFailed.value,
      closePreview: state.closePreview.value, chatCreation: state.chatCreation.value, backends: backendChoices(),
      backend: agent?.backend ?? null,
      canSelectBackend: engines() !== null,
      models: state.models.value.map((model) => ({ id: model.id, name: model.displayName, efforts: effortsOf(model), tiers: (model.serviceTiers ?? []).map(({ id, name }) => ({ id, name })) })),
      composer: { modelId: settings?.model?.id ?? null, effort: settings?.reasoningEffort ?? null, serviceTier: settings?.serviceTier ?? null, planMode: settings?.planMode ?? false },
      permissions: { approvalPreset: permissions?.approvalPreset ?? null, permissionMode: permissions?.permissionMode ?? null, presets: [...(capabilities.approvalPresets ?? [])],
        modes: (capabilities.permissionModes ?? []).map((mode) => ({ id: mode.id, label: typeof mode.label === 'string' ? mode.label : mode.label.key })) },
      capabilities: { models: capabilities.models, reasoningEffort: capabilities.reasoningEffort, serviceTier: capabilities.serviceTier ?? false,
        planMode: capabilities.planMode !== 'unsupported', interrupt: capabilities.interrupt, attachments: capabilities.attachments },
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
  const contextNow = (): TranscriptContext => ({ ready: state.conversationReady.value, agent: state.agent.value, peers: peers.value, history: state.history.value, engines: engines() });

  // A conversation crosses the bridge whole, so it crosses once per change of its own content and no faster than the page can
  // draw it: updates in between are folded into the latest. The provider's replica has already applied every one of them.
  const transcriptInterval = 100;
  let sent: { agentId: string; frame: CompanionConversation | null; overlay: string; context: string } | null = null;
  let sentAt = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  function postConversation() {
    if (disposed) return;
    const now = Date.now();
    for (let index = pending.length - 1; index >= 0; index--) if (pending[index]!.expires <= now) pending.splice(index, 1);
    clearTimeout(expiry);
    if (pending.length) expiry = setTimeout(postConversation, Math.max(0, Math.min(...pending.map((entry) => entry.expires)) - now) + 1);
    const agentId = state.agentId.value; const raw = state.conversation.value;
    const overlaid = withPending(raw);
    const changed = !sent || sent.agentId !== agentId || sent.frame !== raw || sent.overlay !== overlaid.key;
    if (changed) {
      // Opening another chat, or a conversation appearing or going, is shown at once; streaming within one is paced.
      const paced = Boolean(sent) && sent!.agentId === agentId && Boolean(sent!.frame) === Boolean(raw) && sent!.overlay === overlaid.key && now - sentAt < transcriptInterval;
      if (paced) { trailing ??= setTimeout(() => { trailing = undefined; postConversation(); }, transcriptInterval - (now - sentAt)); return; }
      clearTimeout(trailing); trailing = undefined;
      const context = contextNow();
      sent = { agentId, frame: raw, overlay: overlaid.key, context: JSON.stringify(context) }; sentAt = now;
      port.post({ type: 'conversation', agentId, frame: overlaid.frame, ...context });
      return;
    }
    const context = contextNow(); const json = JSON.stringify(context);
    if (json === sent!.context) return;
    sent!.context = json;
    port.post({ type: 'conversationContext', agentId, ...context });
  }
  // Selection changes identity, cached frame and readiness together. Never send an intermediate
  // pairing (new transcript / old agent) across the native bridge.
  watch(() => [state.conversation.value, state.agentId.value, state.agent.value, peers.value, state.history.value, state.conversationReady.value, state.workspace.value] as const, postConversation, { flush: 'post' });

  async function send(command: Extract<EngineCommand, { type: 'send' }>) {
    const frame = state.conversation.value;
    if (!frame || frame.backend === 'codex' || !state.canSend.value || !command.text.trim()) return state.submit(command.text, command.options);
    const entry = { id: `pending-${crypto.randomUUID()}`, agentId: state.agentId.value, text: command.text, baseline: userTexts(frame, command.text), expires: Date.now() + 30_000, createdAt: new Date().toISOString() };
    pending.push(entry);
    postConversation();
    await state.submit(command.text, command.options);
    if (state.error.value) { pending.splice(pending.indexOf(entry), 1); postConversation(); }
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
      case 'respondRequest': return state.respondRequest(command.reply);
      case 'start': return start();
      case 'pair': return pair(command.code, command.deviceName);
      case 'connect': return connect(command.laptopId);
      case 'disconnect': ++selectionEpoch; return state.disconnect();
      case 'activity':
        if (command.active) { await port.connector.resume?.(); return state.reconnect(); }
        state.disconnect(); return port.connector.suspend?.();
      case 'reconnect': return state.reconnect();
      case 'forget': {
        ++selectionEpoch;
        const laptopId = state.laptopId.value;
        await state.revoke();
        await port.selectionStore?.remove(laptopId).catch(() => {});
        laptops.value = [...port.connector.laptops]; return publish();
      }
      case 'selectTeam': ++selectionEpoch; await state.selectTeam(command.id); return rememberSelection();
      case 'selectAgent': {
        ++selectionEpoch;
        const loading = state.selectAgent(command.id);
        await rememberSelection();
        return loading;
      }
      case 'loadOlder': return state.loadOlder(command.agentId);
      case 'draft': return state.updateDraft({ text: command.text, selectionStart: command.text.length, selectionEnd: command.text.length });
      case 'send': return send(command);
      case 'interrupt': return state.interrupt();
      case 'restartSession': await state.restartSession(); return rememberSelection();
      case 'closeSession': await state.requestCloseSession(); return rememberSelection();
      case 'confirmCloseSession': await state.confirmCloseSession(command.agentId, command.deleteWorktree, command.deleteRemoteBranch, command.discardChanges); return rememberSelection();
      case 'newChat': return state.createChat({ repositoryId: command.repositoryId, backend: command.backend, ...(command.branchName ? { worktree: { branchName: command.branchName } } : {}) });
      case 'backend': return state.selectBackend(command.backend);
      case 'newQuickChat': return state.createQuickChat(command.backend);
      case 'dismissNewChat': return state.dismissChatCreation();
      case 'cancelCloseSession': return state.cancelCloseSession();
      case 'dismissSessionError': return state.dismissSessionError();
      case 'composer': return state.updateComposerSettings(command.change);
      case 'approvalPreset': return state.setApprovalPreset(command.preset);
      case 'permissionMode': return state.setPermissionMode(command.mode);
      case 'delegate': return state.delegate({ startingContext: command.startingContext, ...(command.instructions ? { instructions: command.instructions } : {}) });
      case 'review': return state.startReview(command.input);
    }
  }

  /** Opens the saved pairing when there is exactly one; with several, the person chooses. */
  async function start() {
    startup.value = 'loading'; publish();
    try {
      await port.connector.initialize?.();
      laptops.value = [...port.connector.laptops];
      publish();
      if (laptops.value.length === 1) await connect(laptops.value[0]!.id);
      startup.value = 'ready';
    } catch { startup.value = 'error'; }
    publish();
  }

  return { dispatch, start, snapshot: () => view.value, dispose() { disposed = true; clearTimeout(expiry); clearTimeout(trailing); state.dispose(); void port.connector.dispose?.(); } };
}

export type { CompanionPromptOptions };
