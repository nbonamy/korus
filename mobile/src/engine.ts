import { watch } from 'vue';
import type { Agent, BackendModelOption } from '@workspace/core/contracts';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { CompanionConnector, CompanionConversation, CompanionHistoryState, CompanionPromptOptions, CompanionReviewInput } from './companion-port';
import { createCompanionState } from './companion-state';
import type { ComposerChange } from './composer-settings';
import { activeSession, projectMobileGroups, type MobileSidebarGroup } from './workspace-groups';
import type { SelectionStore } from './selection-store';

/** Everything the native shell draws, as plain data: no framework, no protocol detail. */
export type EngineState = {
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
  | { type: 'conversation'; agentId: string; ready: boolean; frame: CompanionConversation | null; agent: Agent | null; agents: Agent[]; history: CompanionHistoryState };

export type EngineCommand =
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
  | { type: 'composer'; change: ComposerChange }
  | { type: 'approvalPreset'; preset: string } | { type: 'permissionMode'; mode: string }
  | { type: 'delegate'; startingContext: 'conversation' | 'handoff'; instructions?: string }
  | { type: 'review'; input: CompanionReviewInput };

export type EnginePort = { connector: CompanionConnector; selectionStore?: SelectionStore; chatsLabel?: string; post(event: EngineEvent): void };

const effortsOf = (model: BackendModelOption) => (model.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort);

export function createEngine(port: EnginePort) {
  const state = createCompanionState(port.connector, undefined);
  let startup: EngineState['startup'] = 'loading';
  let pairing: EngineState['pairing'] = 'idle';
  let pairingError = '';
  let laptops = [...port.connector.laptops];
  let disposed = false;
  let scheduled = false;
  let selectionEpoch = 0;

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

  function snapshot(): EngineState {
    const agent = state.agent.value;
    const groups = projectMobileGroups(state.agents.value, state.agentId.value || null, port.chatsLabel ?? 'Chats', state.workspace.value.repositoryIcons);
    const active = activeSession(groups);
    const capabilities = defaultBackendCapabilities(agent?.backend ?? 'codex');
    const settings = state.composerSettings.value;
    const permissions = state.permissions.value;
    return {
      startup, connection: state.status.value, error: state.error.value, laptops, pairing, pairingError,
      teams: state.workspace.value.teams.map(({ id, name, avatar }) => ({ id, name, ...(avatar ? { avatar } : {}) })),
      teamId: state.teamId.value, groups, agentId: state.agentId.value,
      header: active && agent ? { title: active.session.displayTitle, repository: active.group.kind === 'repository' ? active.group.label : null,
        status: active.session.status.type, statusText: agent.statusText ?? active.session.status.type, icon: active.group.icon ?? null } : null,
      loading: state.loading.value && !state.conversation.value, canSend: state.canSend.value, draft: state.draft.value.text,
      models: state.models.value.map((model) => ({ id: model.id, name: model.displayName, efforts: effortsOf(model), tiers: (model.serviceTiers ?? []).map(({ id, name }) => ({ id, name })) })),
      composer: { modelId: settings?.model?.id ?? null, effort: settings?.reasoningEffort ?? null, serviceTier: settings?.serviceTier ?? null, planMode: settings?.planMode ?? false },
      permissions: { approvalPreset: permissions?.approvalPreset ?? null, permissionMode: permissions?.permissionMode ?? null, presets: [...(capabilities.approvalPresets ?? [])],
        modes: (capabilities.permissionModes ?? []).map((mode) => ({ id: mode.id, label: typeof mode.label === 'string' ? mode.label : mode.label.key })) },
      capabilities: { models: capabilities.models, reasoningEffort: capabilities.reasoningEffort, serviceTier: capabilities.serviceTier ?? false,
        planMode: capabilities.planMode !== 'unsupported', interrupt: capabilities.interrupt, attachments: capabilities.attachments },
      favorites: state.modelFavorites.value.filter((favorite) => favorite.backend === agent?.backend).map(({ modelId, reasoningEffort, serviceTier }) => ({ modelId, reasoningEffort, serviceTier })),
    };
  }
  // Many refs change together; one state event per turn of the event loop is enough.
  function publish() {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!disposed) port.post({ type: 'state', state: snapshot() }); });
  }
  watch(snapshot, publish, { deep: true, flush: 'sync' });
  watch(() => [state.conversation.value, state.agent.value, state.agents.value, state.history.value, state.conversationReady.value] as const, ([frame, agent, agents, history, ready]) => {
    port.post({ type: 'conversation', agentId: state.agentId.value, ready, frame, agent, agents, history });
  }, { flush: 'sync' });

  async function pair(code: string, deviceName: string) {
    if (!port.connector.pair || pairing !== 'idle') return;
    pairing = 'working'; pairingError = ''; publish();
    try {
      const id = await port.connector.pair(code, deviceName, () => { pairing = 'awaitingApproval'; publish(); });
      laptops = [...port.connector.laptops];
      pairing = 'idle'; publish();
      await connect(id);
    } catch (error) {
      pairing = 'idle'; pairingError = error instanceof Error ? error.message : 'mobile.errors.pairing'; publish();
    }
  }

  async function dispatch(command: EngineCommand): Promise<void> {
    switch (command.type) {
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
        laptops = [...port.connector.laptops]; return publish();
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
      case 'send': return state.submit(command.text, command.options);
      case 'interrupt': return state.interrupt();
      case 'composer': return state.updateComposerSettings(command.change);
      case 'approvalPreset': return state.setApprovalPreset(command.preset);
      case 'permissionMode': return state.setPermissionMode(command.mode);
      case 'delegate': return state.delegate({ startingContext: command.startingContext, ...(command.instructions ? { instructions: command.instructions } : {}) });
      case 'review': return state.startReview(command.input);
    }
  }

  /** Opens the saved pairing when there is exactly one; with several, the person chooses. */
  async function start() {
    startup = 'loading'; publish();
    try {
      await port.connector.initialize?.();
      laptops = [...port.connector.laptops];
      publish();
      if (laptops.length === 1) await connect(laptops[0]!.id);
      startup = 'ready';
    } catch { startup = 'error'; }
    publish();
  }

  return { dispatch, start, snapshot, dispose() { disposed = true; state.dispose(); void port.connector.dispose?.(); } };
}

export type { CompanionPromptOptions };
