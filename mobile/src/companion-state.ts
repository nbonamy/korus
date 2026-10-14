import { computed, reactive, ref, shallowRef } from 'vue';
import type { BackendModelOption } from '@workspace/core/contracts';
import { companionSessionId } from '@workspace/core/companion-protocol';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { CompanionConnector, CompanionConversation, CompanionHistoryState, CompanionPromptOptions, CompanionReviewInput, CompanionSession, CompanionUpload, CompanionWorkspace } from './companion-port';
import { applyComposerChoice, promptOptionsFor, resolveComposerSettings, type ComposerChange, type ComposerChoice } from './composer-settings';
import { restoreDraftRecord, type DraftState, type DraftStore } from './protected-storage';

export function createCompanionState(connector: CompanionConnector, store?: DraftStore, resolveUploads?: (references: readonly { type?: string; reference: string }[] | undefined) => CompanionUpload[]) {
  const status = ref<'unpaired' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'revoked' | 'error'>('unpaired');
  const error = ref('');
  const laptopId = ref('');
  const teamId = ref('');
  const agentId = ref('');
  const workspace = shallowRef<CompanionWorkspace>({ teams: [], agents: [] });
  const conversation = shallowRef<CompanionConversation | null>(null);
  const conversationReady = ref(false);
  const loading = ref(false);
  const loadingOlder = ref(false);
  const historyFailed = ref(false);
  const hasOlder = ref<boolean | null>(null);
  const history = computed<CompanionHistoryState>(() => ({
    hasOlder: status.value === 'connected' && Boolean(conversation.value) && (hasOlder.value ?? conversation.value?.payload.snapshot.historyState?.hasOlder ?? true),
    loadingOlder: loadingOlder.value,
    failed: historyFailed.value,
  }));
  const drafts = reactive<Record<string, DraftState>>({});
  const uncertain = reactive<Record<string, boolean>>({});
  const sending = reactive<Record<string, boolean>>({});
  const commandIds = reactive<Record<string, string>>({});
  const submittedTexts = reactive<Record<string, string>>({});
  const storageReady = ref(!store);
  let storageFailed = false;
  let writes = Promise.resolve();
  const ready = store ? store.read().then((record) => {
    const restored = restoreDraftRecord(record);
    Object.assign(drafts, restored.drafts);
    Object.assign(uncertain, restored.uncertain);
    Object.assign(commandIds, restored.commandIds);
    Object.assign(submittedTexts, restored.submittedTexts);
    storageReady.value = true;
  }).catch(() => { storageFailed = true; error.value = 'mobile.errors.storage'; }) : Promise.resolve();
  function persist() {
    if (!store) return Promise.resolve();
    const record = JSON.parse(JSON.stringify({ drafts, uncertain, commandIds, submittedTexts }));
    const pending = writes.then(() => store.write(record));
    // Each write keeps its rejection for callers; the queue remains usable after a transient lock.
    writes = pending.catch(() => { storageFailed = true; error.value = 'mobile.errors.storage'; });
    return pending.then(() => { storageFailed = false; });
  }
  let session: CompanionSession | null = null;
  let unsubscribe = () => {};
  let connectionEpoch = 0;
  let selectionEpoch = 0;
  let selectedConversationKey = '';
  let reconnectWanted = false;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const key = () => JSON.stringify([laptopId.value, agentId.value]);
  const modelCatalog = shallowRef<Record<string, BackendModelOption[]>>({});
  const composerChoices = reactive<Record<string, ComposerChoice>>({});
  const permissionChoices = reactive<Record<string, { approvalPreset?: string; permissionMode?: string }>>({});
  // The desktop's order is the team's: agent order inside it, and repositories by their first agent.
  const agents = computed(() => {
    const order = workspace.value.teams.find((team) => team.id === teamId.value)?.agentIds ?? [];
    const rank = (id: string) => { const index = order.indexOf(id); return index < 0 ? order.length : index; };
    return workspace.value.agents.filter((a) => a.teamId === teamId.value).sort((a, b) => rank(a.id) - rank(b.id));
  });
  const agent = computed(() => agents.value.find((a) => a.id === agentId.value) ?? null);
  const models = computed(() => modelCatalog.value[agentId.value] ?? []);
  const composerSettings = computed(() => agent.value ? resolveComposerSettings(agent.value, models.value, composerChoices[agentId.value]) : null);
  /** What the agent is set to now: the phone's latest choice, else what the laptop reports. */
  const permissions = computed(() => {
    const current = agent.value; if (!current) return null;
    const choice = permissionChoices[current.id] ?? {}; const saved = current.backendDefaults;
    return { approvalPreset: choice.approvalPreset ?? (saved?.kind === 'codex' ? saved.approvalPreset : undefined) ?? null,
      permissionMode: choice.permissionMode ?? (saved && saved.kind !== 'codex' ? saved.permissionMode : undefined) ?? null };
  });
  const modelFavorites = computed(() => workspace.value.modelFavorites ?? []);
  const draft = computed(() => drafts[key()] ?? { text: '', selectionStart: 0, selectionEnd: 0 });
  const deliveryUnknown = computed(() => Boolean(uncertain[key()]));
  const canSend = computed(() => status.value === 'connected' && conversationReady.value && Boolean(agent.value)
    && storageReady.value && !loading.value && !sending[key()] && !deliveryUnknown.value);

  function closeSession() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    ++connectionEpoch;
    ++selectionEpoch;
    loadingOlder.value = false;
    loading.value = false;
    conversationReady.value = false;
    unsubscribe();
    unsubscribe = () => {};
    session?.close();
    session = null;
  }
  function retryConnection() {
    if (!reconnectWanted || disposed || retryTimer || !laptopId.value) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(retryCount++, 5)) * (0.8 + Math.random() * 0.4);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (reconnectWanted && !disposed) void connect(laptopId.value, true);
    }, delay);
  }
  async function connect(id: string, reconnecting = false) {
    if (disposed) return;
    reconnectWanted = true;
    if (!reconnecting) retryCount = 0;
    closeSession();
    const epoch = connectionEpoch;
    const sameLaptop = laptopId.value === id;
    if (!sameLaptop) { teamId.value = ''; agentId.value = ''; workspace.value = { teams: [], agents: [] }; conversation.value = null; modelCatalog.value = {}; }
    laptopId.value = id;
    status.value = reconnecting ? 'reconnecting' : 'connecting';
    error.value = '';
    if (store) await ready;
    if (epoch !== connectionEpoch) return;
    if (!storageReady.value) { status.value = 'error'; error.value = 'mobile.errors.storage'; return; }
    let opened: CompanionSession | null = null;
    try {
      opened = await connector.connect(id);
      const nextWorkspace = await opened.getWorkspace();
      if (epoch !== connectionEpoch) { opened.close(); return; }
      session = opened;
      workspace.value = nextWorkspace;
      const removeDisconnect = session.onDisconnect(() => {
        if (epoch !== connectionEpoch) return;
        ++selectionEpoch;
        loading.value = false;
        conversationReady.value = false;
        status.value = 'disconnected';
        retryConnection();
      });
      const removeUpdates = session.onUpdate?.((nextWorkspace, frame) => {
        if (epoch !== connectionEpoch) return;
        workspace.value = nextWorkspace;
        if (frame && frame.agentId === agentId.value && frame.backend === agent.value?.backend) conversation.value = frame;
      }) ?? (() => {});
      unsubscribe = () => { removeDisconnect(); removeUpdates(); };
      status.value = 'connected';
      if (session.commandStatus) for (const [draftKey, commandId] of Object.entries(commandIds)) {
        if (!uncertain[draftKey] || JSON.parse(draftKey)[0] !== id) continue;
        const receipt = await session.commandStatus(commandId);
        if (epoch !== connectionEpoch) return;
        if (receipt === 'accepted') {
          uncertain[draftKey] = false;
          if (drafts[draftKey]?.text === submittedTexts[draftKey]) drafts[draftKey] = { text: '', selectionStart: 0, selectionEnd: 0 };
          await persist();
        } else if (receipt === 'notReceived') { uncertain[draftKey] = false; await persist(); }
      }
      if (agentId.value) await selectAgent(agentId.value);
      if (epoch === connectionEpoch) retryCount = 0;
    } catch {
      opened?.close();
      if (epoch === connectionEpoch) { status.value = 'error'; error.value = 'mobile.errors.openLaptop'; retryConnection(); }
    }
  }
  async function selectTeam(id: string) {
    teamId.value = workspace.value.teams.some((team) => team.id === id) ? id : '';
    await selectAgent('');
  }
  async function loadModels(id: string, capturedSession: CompanionSession) {
    if (!capturedSession.listModels || modelCatalog.value[id]) return;
    try {
      const list = await capturedSession.listModels(id);
      if (session === capturedSession) modelCatalog.value = { ...modelCatalog.value, [id]: list };
    } catch { /* Without a catalog the model menu simply stays hidden. */ }
  }
  /** One change from the model menu: remembered here, and saved on the laptop like the desktop does. */
  function updateComposerSettings(change: ComposerChange) {
    const id = agentId.value; const active = session;
    if (!id || !active || !agent.value) return;
    const { choice, save } = applyComposerChoice(models.value, composerChoices[id] ?? currentChoice(), change);
    composerChoices[id] = choice;
    if (save && active.selectModel) void active.selectModel(id, save).catch(() => {});
  }
  function currentChoice(): ComposerChoice {
    const settings = composerSettings.value;
    return settings ? { model: settings.model?.model ?? null, reasoningEffort: settings.reasoningEffort, serviceTier: settings.serviceTier, planMode: settings.planMode } : {};
  }
  /** Remembers the choice at once and asks the laptop; the previous value returns if the laptop refuses. */
  function changePermissions(change: { approvalPreset?: string; permissionMode?: string }, send: (active: CompanionSession, id: string) => Promise<void> | undefined) {
    const id = agentId.value; const active = session;
    if (!id || !active) return;
    const previous = permissionChoices[id];
    permissionChoices[id] = { ...previous, ...change };
    void send(active, id)?.catch(() => { if (previous) permissionChoices[id] = previous; else delete permissionChoices[id]; });
  }
  const setApprovalPreset = (preset: string) => changePermissions({ approvalPreset: preset }, (active, id) => active.setApprovalPreset?.(id, preset));
  const setPermissionMode = (mode: string) => changePermissions({ permissionMode: mode }, (active, id) => active.setPermissionMode?.(id, mode));
  /** A laptop-side command that is not the person's draft: sent once, the draft untouched. */
  async function runCommand(command: () => Promise<void> | undefined) {
    error.value = '';
    try { await command(); } catch { error.value = 'mobile.errors.commandFailed'; }
  }
  const delegate = (options: NonNullable<CompanionPromptOptions['delegation']>) => runCommand(() => agentId.value ? session?.sendPrompt(agentId.value, '/delegate', crypto.randomUUID(), { delegation: options }) : undefined);
  const startReview = (input: CompanionReviewInput) => runCommand(() => agentId.value ? session?.startReview?.(agentId.value, input) : undefined);
  function interrupt() { const id = agentId.value; if (id) void session?.interrupt?.(id)?.catch(() => {}); }
  async function selectAgent(id: string) {
    const epoch = ++selectionEpoch;
    const nextAgent = agents.value.find((a) => a.id === id);
    const nextKey = nextAgent ? JSON.stringify([laptopId.value, id, companionSessionId(nextAgent)]) : '';
    const retaining = Boolean(conversation.value) && nextKey === selectedConversationKey;
    selectedConversationKey = nextKey;
    loadingOlder.value = false;
    if (!retaining) { historyFailed.value = false; hasOlder.value = null; conversation.value = null; }
    agentId.value = nextAgent?.id ?? '';
    conversationReady.value = false;
    error.value = '';
    loading.value = false;
    if (!agentId.value || !session || status.value !== 'connected') return;
    loading.value = true;
    const active = session;
    try {
      const frame = await active.loadConversation(id);
      if (epoch !== selectionEpoch) return;
      if (frame && (frame.agentId !== id || frame.backend !== agent.value?.backend)) throw new Error('Conversation identity mismatch.');
      if (!frame && agent.value?.backendSession) throw new Error('Conversation is unavailable.');
      conversation.value = frame;
      conversationReady.value = true;
      void loadModels(id, active);
    } catch {
      if (epoch === selectionEpoch) error.value = 'mobile.errors.loadConversation';
    } finally {
      if (epoch === selectionEpoch) loading.value = false;
    }
  }
  function updateDraft(next: DraftState) {
    if (agentId.value && storageReady.value) {
      drafts[key()] = { ...next };
      void persist().catch(() => {});
    }
  }
  async function loadOlder(id: string) {
    const active = session;
    if (id !== agentId.value || !active?.loadOlderHistory || status.value !== 'connected' || loadingOlder.value || !history.value.hasOlder) return;
    const epoch = selectionEpoch;
    loadingOlder.value = true;
    historyFailed.value = false;
    try {
      const page = await active.loadOlderHistory(id);
      if (epoch !== selectionEpoch || active !== session) return;
      if (page.frame.agentId !== id || page.frame.backend !== agent.value?.backend) throw new Error('Conversation identity mismatch.');
      conversation.value = page.frame;
      hasOlder.value = page.hasOlder;
    } catch {
      if (epoch === selectionEpoch && active === session) historyFailed.value = true;
    } finally {
      if (epoch === selectionEpoch && active === session) loadingOlder.value = false;
    }
  }
  async function submit(prompt: string, sendOptions?: { attachments?: readonly { type?: string; reference: string }[] }) {
    const uploads = resolveUploads?.(sendOptions?.attachments) ?? [];
    if (!canSend.value || (!prompt.trim() && uploads.length === 0) || !session) return;
    const target = agentId.value;
    const draftKey = key();
    const capturedSession = session;
    const epoch = selectionEpoch;
    const sentDraft = draft.value.text ? { ...draft.value } : { text: prompt, selectionStart: prompt.length, selectionEnd: prompt.length };
    // The SDK clears before dispatch; retain the submitted text until admission succeeds.
    if (!drafts[draftKey]?.text) drafts[draftKey] = sentDraft;
    sending[draftKey] = true;
    error.value = '';
    // Persist the intent before dispatch. A killed process cannot silently replay an unknown send.
    uncertain[draftKey] = true;
    const clientCommandId = crypto.randomUUID();
    commandIds[draftKey] = clientCommandId;
    submittedTexts[draftKey] = sentDraft.text;
    try { await persist(); }
    catch { uncertain[draftKey] = false; sending[draftKey] = false; return; }
    try {
      const settings = composerSettings.value;
      const options = settings && agent.value ? promptOptionsFor(settings, defaultBackendCapabilities(agent.value.backend)) : undefined;
      await (uploads.length ? capturedSession.sendPrompt(target, prompt, clientCommandId, options, uploads) : capturedSession.sendPrompt(target, prompt, clientCommandId, options));
      if (drafts[draftKey]?.text === sentDraft.text) drafts[draftKey] = { text: '', selectionStart: 0, selectionEnd: 0 };
      uncertain[draftKey] = false;
      await persist();
      if (epoch === selectionEpoch) await selectAgent(target);
    } catch {
      uncertain[draftKey] = true;
      if (epoch === selectionEpoch) error.value = storageFailed ? 'mobile.errors.storage' : 'mobile.errors.deliveryUnknown';
      await persist().catch(() => {});
    } finally {
      sending[draftKey] = false;
    }
  }
  function disconnect() { reconnectWanted = false; closeSession(); status.value = 'disconnected'; }
  async function reconnect() {
    if (laptopId.value && ['disconnected', 'error'].includes(status.value)) await connect(laptopId.value, true);
  }
  async function revoke() {
    reconnectWanted = false;
    const id = laptopId.value;
    closeSession();
    conversation.value = null;
    workspace.value = { teams: [], agents: [] };
    teamId.value = ''; agentId.value = '';
    status.value = 'revoked';
    try { await connector.revoke(id); }
    catch { error.value = 'mobile.errors.revoke'; }
  }
  return { status, error, laptopId, teamId, agentId, workspace, conversation, loading, agents, agent,
    draft, deliveryUnknown, canSend, history, loadOlder, models, composerSettings, updateComposerSettings, permissions, modelFavorites, setApprovalPreset, setPermissionMode, interrupt, delegate, startReview, connect, selectTeam, selectAgent, updateDraft, submit,
    disconnect, reconnect, revoke, dispose() { disposed = true; reconnectWanted = false; closeSession(); } };
}
