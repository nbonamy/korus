import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { promptSkillInputsFromText } from '@codex-app-sdk/vue';
import type { AgentBackend, BackendModelOption, BackendSkillSummary } from '@workspace/core/contracts';
import type { CompanionNewChat } from '@workspace/core/companion-protocol';
import { companionTarget, companionSessionId, type CompanionRequestReply, type CompanionCloseOptions, type CompanionClosePreview } from '@workspace/core/companion-protocol';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { CompanionConnector, CompanionConversation, CompanionHistoryState, CompanionPromptOptions, CompanionReviewInput, CompanionSession, CompanionUpload, CompanionWorkspace } from './companion-port';
import { applyComposerChoice, promptOptionsFor, resolveComposerSettings, type ComposerChange, type ComposerChoice } from './composer-settings';
import { reconcileWorkspace } from './workspace-reconcile';
import { restoreDraftRecord, type DraftState, type DraftStore } from './protected-storage';

export function createCompanionState(connector: CompanionConnector, store?: DraftStore, resolveUploads?: (references: readonly { type?: string; reference: string }[] | undefined) => CompanionUpload[]) {
  const status = ref<'unpaired' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'revoked' | 'error'>('unpaired');
  const error = ref('');
  const respondingRequest = ref<string | null>(null);
  const failedRequest = ref<string | null>(null);
  const sessionAction = ref<'interrupt' | 'restart' | 'close' | 'previewClose' | null>(null);
  const sessionActionFailed = ref(false);
  const chatCreation = ref<'idle' | 'creating' | 'failed'>('idle');
  const closePreview = shallowRef<CompanionClosePreview | null>(null);
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
  const skills = shallowRef<{ status: 'idle' | 'loading' | 'loaded' | 'failed'; items: BackendSkillSummary[] }>({ status: 'idle', items: [] });
  const skillContext = computed(() => JSON.stringify([laptopId.value, status.value, agent.value?.id, agent.value?.backend, agent.value?.folder, agent.value && companionSessionId(agent.value)]));
  let skillRequest: Promise<void> | undefined;
  let skillEpoch = 0;
  const stopSkills = watch(skillContext, () => {
    ++skillEpoch; skillRequest = undefined; skills.value = { status: 'idle', items: [] };
  }, { flush: 'sync' });
  function loadSkills(): Promise<void> {
    if (skillRequest) return skillRequest;
    if (skills.value.status === 'loaded' || status.value !== 'connected' || !agent.value) return Promise.resolve();
    const active = session; const id = agent.value.id; const epoch = skillEpoch;
    if (!active?.listSkills || !defaultBackendCapabilities(agent.value.backend).skills) {
      skills.value = { status: 'loaded', items: [] }; return Promise.resolve();
    }
    skills.value = { status: 'loading', items: [] };
    skillRequest = active.listSkills(id).then((items) => {
      if (epoch === skillEpoch && session === active) skills.value = { status: 'loaded', items: items.filter((skill) => skill.enabled) };
    }).catch(() => {
      if (epoch === skillEpoch && session === active) skills.value = { status: 'failed', items: [] };
    }).finally(() => { if (epoch === skillEpoch) skillRequest = undefined; });
    return skillRequest;
  }
  const requests = computed(() => {
    const owner = agent.value;
    const team = workspace.value.teams.find((team) => team.id === owner?.teamId);
    if (!owner || !team) return [];
    const target = companionTarget(laptopId.value, team, owner);
    return (workspace.value.agentRequests?.[owner.id] ?? []).map((request) => ({
      key: JSON.stringify([target, request.id, request.conversationId]), target, request,
    }));
  });
  async function respondRequest(reply: CompanionRequestReply) {
    const pending = requests.value.find((entry) => entry.request.id === reply.id && entry.request.conversationId === reply.conversationId
      && entry.target.hostId === reply.target.hostId && entry.target.locationId === reply.target.locationId
      && entry.target.teamId === reply.target.teamId && entry.target.agentId === reply.target.agentId && entry.target.sessionId === reply.target.sessionId);
    if (!pending || respondingRequest.value || status.value !== 'connected' || !session?.respondRequest) return;
    const active = session; const epoch = connectionEpoch;
    respondingRequest.value = pending.key; failedRequest.value = null;
    try {
      await active.respondRequest!(reply);
      // Acknowledged consumption is safe to hide while the authoritative update catches up.
      if (session === active && epoch === connectionEpoch) {
        workspace.value = { ...workspace.value, agentRequests: { ...workspace.value.agentRequests,
          [reply.target.agentId]: (workspace.value.agentRequests?.[reply.target.agentId] ?? []).filter((request) => request.id !== reply.id || request.conversationId !== reply.conversationId) } };
      }
    } catch {
      if (session === active && epoch === connectionEpoch) {
        failedRequest.value = pending.key;
        // Reconcile an answer handled on desktop or whose acknowledgment was lost. Never replay it.
        try { const next = await active.getWorkspace(); if (session === active && epoch === connectionEpoch) workspace.value = reconcileWorkspace(workspace.value, next); } catch { /* Keep the request and draft available for an explicit retry. */ }
      }
    } finally { if (respondingRequest.value === pending.key) respondingRequest.value = null; }
  }
  /** Models and the person's choice belong to a chat under one engine: another engine has its own. */
  const modelKey = (id: string, backend: string | undefined) => `${id}:${backend ?? ''}`;
  const currentModelKey = () => modelKey(agentId.value, agent.value?.backend);
  const models = computed(() => modelCatalog.value[currentModelKey()] ?? []);
  const composerSettings = computed(() => agent.value ? resolveComposerSettings(agent.value, models.value, composerChoices[currentModelKey()]) : null);
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
    && storageReady.value && !loading.value && !sessionAction.value && !sending[key()] && !deliveryUnknown.value);

  function closeSession() {
    closePreview.value = null; chatCreation.value = 'idle';
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
      workspace.value = reconcileWorkspace(workspace.value, nextWorkspace);
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
        workspace.value = reconcileWorkspace(workspace.value, nextWorkspace);
        if (frame && frame.agentId === agentId.value && frame.backend === agent.value?.backend) {
          conversation.value = frame; conversationReady.value = true;
          if (error.value === 'mobile.errors.loadConversation') error.value = '';
        }
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
    const backendOf = () => workspace.value.agents.find((candidate) => candidate.id === id)?.backend;
    const requested = backendOf(); const key = modelKey(id, requested);
    if (!capturedSession.listModels || modelCatalog.value[key]) return;
    try {
      const list = await capturedSession.listModels(id);
      // A list asked for under another engine is not this engine's list.
      if (session === capturedSession && backendOf() === requested) modelCatalog.value = { ...modelCatalog.value, [key]: list };
    } catch { /* Without a catalog the model menu simply stays hidden. */ }
  }
  /** One change from the model menu: remembered here, and saved on the laptop like the desktop does. */
  function updateComposerSettings(change: ComposerChange) {
    const id = agentId.value; const active = session;
    if (!id || !active || !agent.value) return;
    const key = currentModelKey();
    const { choice, save } = applyComposerChoice(models.value, composerChoices[key] ?? currentChoice(), change);
    composerChoices[key] = choice;
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
  async function controlSession(action: 'interrupt' | 'restart' | 'close', input?: CompanionCloseOptions) {
    const id = agentId.value; const active = session; const epoch = selectionEpoch;
    if (!id || !active || status.value !== 'connected' || sessionAction.value) return;
    const preview = closePreview.value;
    if (action === 'close' && preview?.target.agentId !== id) return;
    sessionAction.value = action; sessionActionFailed.value = false;
    try {
      if (action === 'close' && active.closeSession && preview) await active.closeSession(preview.target, input);
      else if (action === 'restart' && active.restartSession) await active.restartSession(id);
      else if (action === 'interrupt' && active.interrupt) await active.interrupt(id);
      else throw new Error('Session action unavailable.');
      const next = await active.getWorkspace();
      if (active !== session) return;
      workspace.value = reconcileWorkspace(workspace.value, next);
      if (epoch !== selectionEpoch) return;
      if (action !== 'interrupt') {
        conversation.value = null; selectedConversationKey = '';
        await selectAgent(action === 'restart' ? id : agents.value[0]?.id ?? '');
      }
    } catch {
      if (active === session && epoch === selectionEpoch) sessionActionFailed.value = true;
    } finally { sessionAction.value = null; }
  }
  const interrupt = () => controlSession('interrupt');
  const restartSession = () => controlSession('restart');
  async function requestCloseSession() {
    const id = agentId.value; const active = session; const epoch = selectionEpoch;
    if (!id || !active || status.value !== 'connected' || sessionAction.value) return;
    sessionAction.value = 'previewClose'; sessionActionFailed.value = false;
    closePreview.value = null;
    try {
      if (!active.previewCloseSession) throw new Error('Close preview unavailable.');
      const preview = await active.previewCloseSession(id);
      if (epoch !== selectionEpoch || active !== session) return;
      closePreview.value = preview;
    } catch {
      if (epoch === selectionEpoch && active === session) sessionActionFailed.value = true;
    } finally { sessionAction.value = null; }
    if (closePreview.value && !closePreview.value.isLinkedWorktree) await controlSession('close');
  }
  async function confirmCloseSession(id: string, deleteWorktree: boolean, deleteRemoteBranch = false, discardChanges = false) {
    const preview = closePreview.value;
    if (!preview || preview.target.agentId !== id || id !== agentId.value) return;
    if (deleteWorktree && (!preview.isLinkedWorktree || (preview.hasChanges && !discardChanges))) return;
    await controlSession('close', deleteWorktree ? { deleteWorktree: true, deleteRemoteBranch, discardChanges, confirmed: true } : undefined);
  }
  const cancelCloseSession = () => { if (!sessionAction.value) { closePreview.value = null; sessionActionFailed.value = false; } };
  const dismissSessionError = () => { sessionActionFailed.value = false; };
  async function selectAgent(id: string) {
    closePreview.value = null;
    sessionActionFailed.value = false;
    const epoch = ++selectionEpoch;
    const nextAgent = agents.value.find((a) => a.id === id);
    const nextKey = nextAgent ? JSON.stringify([laptopId.value, id, companionSessionId(nextAgent)]) : '';
    const cached = nextAgent && session && status.value === 'connected' ? session.cachedConversation?.(id) : undefined;
    const retaining = Boolean(conversation.value) && nextKey === selectedConversationKey;
    selectedConversationKey = nextKey;
    loadingOlder.value = false;
    if (!retaining) { historyFailed.value = false; hasOlder.value = null; conversation.value = cached ?? null; }
    agentId.value = nextAgent?.id ?? '';
    conversationReady.value = cached !== undefined;
    error.value = '';
    loading.value = false;
    if (!session || status.value !== 'connected') return;
    if (!agentId.value) { session.deselectConversation?.(); return; }
    loading.value = cached === undefined;
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
    const catalogEpoch = skillEpoch;
    // Resolve the same typed skill aliases as the desktop, including pasted mentions.
    if (/[$/][A-Za-z0-9_.-]+/.test(prompt)) {
      await loadSkills();
      if (epoch !== selectionEpoch || session !== capturedSession || catalogEpoch !== skillEpoch || !canSend.value) return;
    }
    const selectedSkills = promptSkillInputsFromText(prompt, skills.value.items);
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
      const composerOptions = settings && agent.value ? promptOptionsFor(settings, defaultBackendCapabilities(agent.value.backend)) : undefined;
      const options = selectedSkills.length ? { ...composerOptions, skills: selectedSkills } : composerOptions;
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
  /** Starts a chat and opens it once the laptop has it ready. */
  async function startChat(start: (active: CompanionSession, team: string) => Promise<string> | undefined) {
    const active = session; const team = teamId.value; const epoch = selectionEpoch;
    if (!active || !team || status.value !== 'connected' || chatCreation.value === 'creating') return;
    chatCreation.value = 'creating';
    try {
      const created = await start(active, team);
      if (!created) throw new Error('Chat creation unavailable.');
      const next = await active.getWorkspace();
      if (active !== session) return;
      workspace.value = reconcileWorkspace(workspace.value, next);
      chatCreation.value = 'idle';
      if (epoch === selectionEpoch) await selectAgent(created);
    } catch {
      if (active === session) chatCreation.value = 'failed';
    }
  }
  const createChat = (chat: Omit<CompanionNewChat, 'teamId'>) => startChat((active, teamId) => active.createChat?.({ ...chat, teamId }));
  const createQuickChat = (backend: AgentBackend) => startChat((active, teamId) => active.createQuickChat?.({ teamId, backend }));
  /** The engine of a chat that has not started: changed on the laptop, then the agent is reopened with it. */
  async function selectBackend(backend: AgentBackend) {
    const id = agentId.value; const active = session; const epoch = selectionEpoch;
    if (!id || !active?.setBackend || status.value !== 'connected' || agent.value?.backend === backend) return;
    try {
      await active.setBackend(id, backend);
      const next = await active.getWorkspace();
      if (active !== session) return;
      workspace.value = reconcileWorkspace(workspace.value, next);
      if (epoch === selectionEpoch) await selectAgent(id);
    } catch { if (active === session && epoch === selectionEpoch) error.value = 'mobile.errors.commandFailed'; }
  }
  const dismissChatCreation = () => { if (chatCreation.value === 'failed') chatCreation.value = 'idle'; };
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
  return { selectBackend, chatCreation, createChat, createQuickChat, dismissChatCreation, requests, respondRequest, respondingRequest, failedRequest, status, error, laptopId, teamId, agentId, workspace, conversation, conversationReady, loading, agents, agent,
    draft, deliveryUnknown, canSend, history, loadOlder, models, skills, loadSkills, composerSettings, updateComposerSettings, permissions, modelFavorites, setApprovalPreset, setPermissionMode, interrupt, restartSession, requestCloseSession, confirmCloseSession, cancelCloseSession, closePreview, sessionAction, sessionActionFailed, dismissSessionError, delegate, startReview, connect, selectTeam, selectAgent, updateDraft, submit,
    disconnect, reconnect, revoke, dispose() { disposed = true; reconnectWanted = false; closeSession(); stopSkills(); ++skillEpoch; } };
}
