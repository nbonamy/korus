import { PromptRejectedError } from './companion-port';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { promptSkillInputsFromText } from '@codex-app-sdk/vue';
import type { Agent, AgentBackend, BackendModelOption, BackendSkillSummary, BackendPluginSummary } from '@workspace/core/contracts';
import type { CompanionBranch, CompanionNewChat, CompanionUsage, CompanionProjectInput, CompanionGitHubRepository, CompanionProjectBranch } from '@workspace/core/companion-protocol';
import { companionTarget, companionSessionId, type CompanionTarget, type CompanionRequestReply, type CompanionCloseOptions, type CompanionClosePreview } from '@workspace/core/companion-protocol';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { matchingBranchUpstream } from '@workspace/core/git-remote';
import type { CompanionConnector, CompanionConversation, CompanionHistoryState, CompanionPromptOptions, CompanionReviewInput, CompanionSession, CompanionUpload, CompanionWorkspace } from './companion-port';
import { applyComposerChoice, composerCapabilitiesFor, promptOptionsFor, resolveComposerSettings, type ComposerChange, type ComposerChoice } from './composer-settings';
import { reconcileWorkspace } from './workspace-reconcile';
import { restoreDraftRecord, type DraftState, type DraftStore } from './protected-storage';
import type { CompanionReviewSetup } from '@workspace/core/companion-review';

export function createCompanionState(connector: CompanionConnector, store?: DraftStore, resolveUploads?: (references: readonly { type?: string; reference: string }[] | undefined) => CompanionUpload[], onNotification?: (notification: CompanionNotification) => void) {
  let pushRegistration: CompanionPushRegistration | null | undefined;
  const pushRegistrationFailed = ref(false);
  async function registerPush(registration: CompanionPushRegistration | null) {
    pushRegistration = registration;
    const current = session;
    if (!current?.registerPush) return;
    try { await current.registerPush(registration); if (current === session) pushRegistrationFailed.value = false; }
    catch { if (current === session) pushRegistrationFailed.value = true; }
  }
  const status = ref<'unpaired' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'revoked' | 'error'>('unpaired');
  const error = ref('');
  const usage = shallowRef<{ status: 'idle' | 'loading' | 'loaded' | 'failed'; providers: CompanionUsage[] }>({ status: 'idle', providers: [] });
  let usageEpoch = 0;
  const stopUsage = watch(status, () => {
    ++usageEpoch;
    usage.value = { status: 'idle', providers: [] };
  }, { flush: 'sync' });
  async function loadUsage() {
    const active = session;
    if (status.value !== 'connected' || usage.value.status === 'loading') return;
    const epoch = ++usageEpoch;
    usage.value = { status: 'loading', providers: [] };
    try {
      if (!active?.getUsage) throw new Error('Usage is unavailable.');
      const providers = await active.getUsage();
      if (epoch === usageEpoch && active === session) usage.value = { status: 'loaded', providers };
    } catch {
      if (epoch === usageEpoch && active === session) usage.value = { status: 'failed', providers: [] };
    }
  }
  const respondingRequest = ref<string | null>(null);
  const failedRequest = ref<string | null>(null);
  const sessionAction = ref<'interrupt' | 'restart' | 'close' | 'previewClose' | null>(null);
  const sessionActionFailed = ref(false);
  const pendingGoals = reactive(new Set<string>());
  const goalError = ref(false);
  const queuedPromptPending = ref<string | null>(null);
  const queuedPromptFailed = ref(false);
  const goalKey = () => JSON.stringify([laptopId.value, agentId.value]);
  const goalBusy = computed(() => pendingGoals.has(goalKey()));

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
  const unresolvedReceipts = reactive<Record<string, boolean>>({});
  const receiptCallbacks = new Map<string, (outcome: 'accepted' | 'rejected') => void>();
  let receiptTimer: ReturnType<typeof setTimeout> | undefined;
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
  const conversationGeneration = ref(0);
  let selectedConversationKey = '';
  let reconnectWanted = false;
  let isForeground = true;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const key = () => JSON.stringify([laptopId.value, agentId.value]);
  const branches = shallowRef<{ repositoryId: string | null; status: 'idle' | 'loading' | 'loaded' | 'failed'; items: CompanionBranch[] }>({ repositoryId: null, status: 'idle', items: [] });
  let branchEpoch = 0;
  function dismissBranches() { ++branchEpoch; branches.value = { repositoryId: null, status: 'idle', items: [] }; }
  const stopBranches = watch([laptopId, teamId, status], dismissBranches, { flush: 'sync' });
  const projectRepositories = shallowRef<{ status: 'idle' | 'loading' | 'loaded' | 'failed'; items: CompanionGitHubRepository[] }>({ status: 'idle', items: [] });
  let projectEpoch = 0;
  function dismissProjectRepositories() { ++projectEpoch; projectRepositories.value = { status: 'idle', items: [] }; dismissProjectBranches(); }
  const stopProjects = watch([laptopId, teamId, status], dismissProjectRepositories, { flush: 'sync' });
  async function loadProjectRepositories() {
    const active = session; const team = teamId.value; const epoch = ++projectEpoch;
    projectRepositories.value = { status: 'loading', items: [] };
    try {
      if (!active?.githubRepositories || !team || status.value !== 'connected') throw new Error('GitHub is unavailable.');
      const items = await active.githubRepositories(team);
      if (epoch === projectEpoch && active === session) projectRepositories.value = { status: 'loaded', items };
    } catch {
      if (epoch === projectEpoch) projectRepositories.value = { status: 'failed', items: [] };
    }
  }
  const projectBranches = shallowRef<{ repositoryId: string | null; status: 'idle' | 'loading' | 'loaded' | 'failed'; items: CompanionProjectBranch[] }>({ repositoryId: null, status: 'idle', items: [] });
  let projectBranchEpoch = 0;
  function dismissProjectBranches() { ++projectBranchEpoch; projectBranches.value = { repositoryId: null, status: 'idle', items: [] }; }
  async function loadProjectBranches(repositoryId: string) {
    const active = session, team = teamId.value, epoch = ++projectBranchEpoch;
    projectBranches.value = { repositoryId, status: 'loading', items: [] };
    try {
      if (!active?.githubBranches || !team || status.value !== 'connected') throw new Error('GitHub branches are unavailable.');
      const items = await active.githubBranches(team, repositoryId);
      if (epoch === projectBranchEpoch && active === session) projectBranches.value = { repositoryId, status: 'loaded', items };
    } catch {
      if (epoch === projectBranchEpoch) projectBranches.value = { repositoryId, status: 'failed', items: [] };
    }
  }
  async function loadBranches(repositoryId: string) {
    const active = session; const team = teamId.value; const epoch = ++branchEpoch;
    branches.value = { repositoryId, status: 'loading', items: [] };
    try {
      if (!active?.listBranches || !team || status.value !== 'connected') throw new Error('Branch list unavailable.');
      const items = await active.listBranches(team, repositoryId);
      if (epoch === branchEpoch && active === session) branches.value = { repositoryId, status: 'loaded', items };
    } catch {
      if (epoch === branchEpoch) branches.value = { repositoryId, status: 'failed', items: [] };
    }
  }

  const modelCatalog = shallowRef<Record<string, BackendModelOption[]>>({});
  const composerChoices = reactive<Record<string, ComposerChoice>>({});
  const permissionChoices = reactive<Record<string, { approvalPreset?: string; permissionMode?: string }>>({});
  const permissionRequests = new Map<string, symbol>();
  // The desktop's order is the team's: agent order inside it, and repositories by their first agent.
  const agents = computed(() => {
    const order = workspace.value.teams.find((team) => team.id === teamId.value)?.agentIds ?? [];
    const rank = (id: string) => { const index = order.indexOf(id); return index < 0 ? order.length : index; };
    return workspace.value.agents.filter((a) => a.teamId === teamId.value).sort((a, b) => rank(a.id) - rank(b.id));
  });
  const agent = computed(() => agents.value.find((a) => a.id === agentId.value) ?? null);
  function mostRecentAgent(): Agent | undefined {
    const activity = (candidate: Agent) => Math.max(Date.parse(candidate.lastActivityAt ?? '') || 0, Date.parse(candidate.createdAt) || 0);
    return agents.value.reduce<Agent | undefined>((latest, candidate) =>
      !latest || activity(candidate) > activity(latest) ? candidate : latest, undefined);
  }
  const plugins = shallowRef<{ status: 'idle' | 'loading' | 'loaded' | 'failed'; items: BackendPluginSummary[] }>({ status: 'idle', items: [] });
  const skills = shallowRef<{ status: 'idle' | 'loading' | 'loaded' | 'failed'; items: BackendSkillSummary[] }>({ status: 'idle', items: [] });
  const review = shallowRef<{ status: 'idle' | 'loading' | 'ready' | 'failed' | 'starting' | 'started' | 'unknown'; setup: CompanionReviewSetup | null }>({ status: 'idle', setup: null });
  let reviewEpoch = 0;
  function dismissReview() { ++reviewEpoch; review.value = { status: 'idle', setup: null }; }
  const stopReview = watch(() => JSON.stringify([laptopId.value, status.value, agent.value?.id, agent.value?.backend, agent.value?.folder, agent.value?.teamId,
    workspace.value.teams.find(team => team.id === agent.value?.teamId)?.remoteConnectionId, agent.value && companionSessionId(agent.value)]), dismissReview, { flush: 'sync' });
  async function loadReview(backend?: AgentBackend) {
    const active = session; const id = agentId.value; const epoch = ++reviewEpoch;
    review.value = { status: 'loading', setup: review.value.setup };
    try {
      if (!active?.reviewSetup || !id || status.value !== 'connected') throw new Error('Review unavailable.');
      const setup = await active.reviewSetup(id, backend);
      if (epoch === reviewEpoch && active === session) review.value = { status: 'ready', setup };
    } catch { if (epoch === reviewEpoch) review.value = { status: 'failed', setup: review.value.setup }; }
  }
  async function startReview(input: CompanionReviewInput, target: import('@workspace/core/companion-protocol').CompanionTarget) {
    const active = session; const setup = review.value.setup; const epoch = reviewEpoch;
    if (review.value.status !== 'ready' || !setup || !active?.startReview || !canSend.value || setup.activeReview) return;
    if (!target || (Object.keys(setup.target) as (keyof typeof target)[]).some(key => setup.target[key] !== target[key])) return;
    if ((input.scope.type === 'branch' && (!setup.branchChanges || input.scope.baseRef !== setup.baseRef))
      || (input.scope.type === 'uncommitted' && !setup.uncommitted)
      || (input.threadMode === 'current' && (!setup.currentThread || input.automation?.enabled))
      || (input.threadMode === 'independent' && input.backend !== setup.backend)) return;
    review.value = { status: 'starting', setup };
    try {
      const reviewerId = await active.startReview(setup.target, input);
      if (epoch !== reviewEpoch) return;
      if (reviewerId && reviewerId !== agentId.value) {
        // Discovery failure does not turn an acknowledged start into a retryable start.
        try {
          const next = await active.getWorkspace();
          if (epoch !== reviewEpoch || active !== session) return;
          workspace.value = reconcileWorkspace(workspace.value, next);
          if (agents.value.some(agent => agent.id === reviewerId)) await selectAgent(reviewerId);
        } catch { /* The reviewer remains available in the desktop-owned sidebar. */ }
      }
      if (epoch === reviewEpoch) review.value = { status: 'started', setup };
    } catch { if (epoch === reviewEpoch) review.value = { status: 'unknown', setup }; }
  }
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
  let pluginRequest: Promise<void> | undefined;
  let pluginEpoch = 0;
  const stopPlugins = watch(skillContext, () => {
    ++pluginEpoch; pluginRequest = undefined; plugins.value = { status: 'idle', items: [] };
  }, { flush: 'sync' });
  function loadPlugins(): Promise<void> {
    if (pluginRequest) return pluginRequest;
    if (plugins.value.status === 'loaded' || status.value !== 'connected' || !agent.value) return Promise.resolve();
    const active = session; const id = agent.value.id; const epoch = pluginEpoch;
    if (!active?.listPlugins || !defaultBackendCapabilities(agent.value.backend).plugins) {
      plugins.value = { status: 'loaded', items: [] }; return Promise.resolve();
    }
    plugins.value = { status: 'loading', items: [] };
    pluginRequest = active.listPlugins(id).then((items) => {
      if (epoch === pluginEpoch && session === active) plugins.value = { status: 'loaded', items: items.filter((plugin) => plugin.enabled) };
    }).catch(() => {
      if (epoch === pluginEpoch && session === active) plugins.value = { status: 'failed', items: [] };
    }).finally(() => { if (epoch === pluginEpoch) pluginRequest = undefined; });
    return pluginRequest;
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
    && storageReady.value && !goalBusy.value && !loading.value && !sessionAction.value && !sending[key()] && (!deliveryUnknown.value || unresolvedReceipts[key()] === true));

  function conversationIdentity(owner = agent.value): string {
    const team = workspace.value.teams.find(team => team.id === owner?.teamId);
    return owner && team ? JSON.stringify([companionTarget(laptopId.value, team, owner), owner.backend]) : '';
  }
  function matchesCurrentSession(frame: CompanionConversation): boolean {
    const owner = agent.value;
    if (!owner?.backendSession || frame.agentId !== owner.id || frame.backend !== owner.backend) return false;
    if (frame.type === 'codex.conversationSnapshotChanged') return owner.backendSession.kind === 'codex' && frame.threadId === owner.backendSession.threadId;
    return owner.backendSession.kind !== 'codex' && frame.payload.snapshot.sessionId === owner.backendSession.sessionId;
  }
  function applyWorkspace(next: CompanionWorkspace): boolean {
    workspace.value = reconcileWorkspace(workspace.value, next);
    if ((!agentId.value && agents.value.length) || (agentId.value && selectedConversationKey !== conversationIdentity())) {
      permissionRequests.delete(agentId.value); delete permissionChoices[agentId.value];
      void selectAgent(agentId.value);
      return true;
    }
    return false;
  }

  function closeSession() {
    permissionRequests.clear();
    for (const id of Object.keys(permissionChoices)) delete permissionChoices[id];
    closePreview.value = null; chatCreation.value = 'idle';
    clearTimeout(receiptTimer); receiptTimer = undefined;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    ++connectionEpoch;
    ++selectionEpoch;
    ++conversationGeneration.value;
    loadingOlder.value = false;
    loading.value = false;
    conversationReady.value = false;
    unsubscribe();
    unsubscribe = () => {};
    session?.close();
    session = null;
  }
  function retryConnection() {
    if (!reconnectWanted || !isForeground || disposed || retryTimer || !laptopId.value) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(retryCount++, 5)) * (0.8 + Math.random() * 0.4);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (reconnectWanted && isForeground && !disposed) void connect(laptopId.value, true);
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
      if (!isForeground) void session.setActive?.(false).catch(() => {});
      workspace.value = reconcileWorkspace(workspace.value, nextWorkspace);
      const removeDisconnect = session.onDisconnect(() => {
        if (epoch !== connectionEpoch) return;
        ++selectionEpoch;
        ++conversationGeneration.value;
        loading.value = false;
        conversationReady.value = false;
        status.value = 'disconnected';
        retryConnection();
      });
      const removeUpdates = session.onUpdate?.((nextWorkspace, frame) => {
        if (epoch !== connectionEpoch) return;
        if (applyWorkspace(nextWorkspace)) return;
        if (!loading.value && frame && matchesCurrentSession(frame)) {
          conversation.value = frame; conversationReady.value = true;
          if (error.value === 'mobile.errors.loadConversation') error.value = '';
        }
      }) ?? (() => {});
      const removeNotifications = session.onNotification?.(notification => { if (epoch === connectionEpoch) onNotification?.(notification); }) ?? (() => {});
      unsubscribe = () => { removeDisconnect(); removeUpdates(); removeNotifications(); };
      if (pushRegistration !== undefined) void registerPush(pushRegistration);
      status.value = 'connected';
      await reconcileReceipts();
      if (teamId.value) await selectAgent(agentId.value);
      if (epoch === connectionEpoch && status.value === 'connected' && (!agentId.value || conversationReady.value)) retryCount = 0;
    } catch {
      opened?.close();
      if (epoch === connectionEpoch) { status.value = 'error'; error.value = 'mobile.errors.openLaptop'; retryConnection(); }
    }
  }
  /** Only receipt reads are retried. A timed-out prompt is never submitted again. */
  async function reconcileReceipts() {
    const active = session; const epoch = connectionEpoch;
    if (!active?.commandStatus || status.value !== 'connected') return;
    let retry = false;
    for (const [draftKey, commandId] of Object.entries(commandIds)) {
      if (!uncertain[draftKey] || JSON.parse(draftKey)[0] !== laptopId.value || unresolvedReceipts[draftKey]) continue;
      try {
        const receipt = await active.commandStatus(commandId);
        if (active !== session || epoch !== connectionEpoch || disposed) return;
        if (commandIds[draftKey] !== commandId) continue;
        if (receipt === 'pending') { retry = true; continue; }
        if (receipt === 'unresolved') {
          // The daemon cannot prove delivery (e.g. it restarted during admission).
          // Keep the warning and draft; a deliberate new Send remains available.
          unresolvedReceipts[draftKey] = true;
          continue;
        }
        uncertain[draftKey] = false;
        receiptCallbacks.get(commandId)?.(receipt === 'accepted' ? 'accepted' : 'rejected');
        receiptCallbacks.delete(commandId);
        if (receipt === 'accepted' && drafts[draftKey]?.text === submittedTexts[draftKey]) drafts[draftKey] = { text: '', selectionStart: 0, selectionEnd: 0 };
        if (draftKey === key() && error.value === 'mobile.errors.deliveryUnknown') error.value = receipt === 'accepted' ? '' : 'mobile.errors.commandFailed';
        await persist();
      } catch { retry = true; }
    }
    if (retry && active === session && !disposed) scheduleReceipts();
  }
  function scheduleReceipts() {
    if (receiptTimer || disposed) return;
    receiptTimer = setTimeout(() => { receiptTimer = undefined; void reconcileReceipts(); }, 2000);
  }
  async function selectTeam(id: string, preferredAgentId = agentId.value) {
    teamId.value = workspace.value.teams.some((team) => team.id === id) ? id : '';
    await selectAgent(preferredAgentId);
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
  /** Optimistic only until the owning laptop answers; subsequent policy updates stay authoritative. */
  async function changePermissions(change: { approvalPreset?: string; permissionMode?: string }, send: (active: CompanionSession, id: string) => Promise<void> | undefined) {
    const id = agentId.value; const active = session;
    if (!id || !active) return;
    const token = Symbol();
    permissionRequests.set(id, token);
    permissionChoices[id] = { ...permissionChoices[id], ...change };
    try {
      await send(active, id);
      if (active !== session) return;
      const next = await active.getWorkspace();
      if (active === session) applyWorkspace(next);
    } catch { /* Revert to the latest authoritative policy on rejection or transport failure. */ }
    finally {
      if (permissionRequests.get(id) === token) { permissionRequests.delete(id); delete permissionChoices[id]; }
    }
  }
  const setApprovalPreset = (preset: string) => changePermissions({ approvalPreset: preset }, (active, id) => active.setApprovalPreset?.(id, preset));
  const setPermissionMode = (mode: string) => changePermissions({ permissionMode: mode }, (active, id) => active.setPermissionMode?.(id, mode));
  /** A laptop-side command that is not the person's draft: sent once, the draft untouched. */
  async function runCommand(command: () => Promise<unknown> | undefined) {
    error.value = '';
    try { await command(); } catch { error.value = 'mobile.errors.commandFailed'; }
  }
  /** The selected conversation as the laptop identifies it, captured before any await. */
  function currentTarget(): CompanionTarget | null {
    const selected = agent.value;
    const team = workspace.value.teams.find(team => team.id === selected?.teamId);
    return selected && team ? companionTarget(laptopId.value, team, selected) : null;
  }
  async function changeGoal(target: CompanionTarget, objective: string | null): Promise<'accepted' | 'rejected' | 'unknown'> {
    const active = session; const selected = agent.value;
    const current = currentTarget();
    if (!canSend.value || !active?.changeGoal || !selected || !defaultBackendCapabilities(selected.backend).goals
      || !current || !(Object.keys(current) as (keyof CompanionTarget)[]).every(key => current[key] === target[key])
      || (objective !== null && (!objective.trim() || objective.trim().length > 100_000))) return 'rejected';
    const key = goalKey(); const epoch = selectionEpoch;
    pendingGoals.add(key); goalError.value = false;
    try {
      try { await active.changeGoal(target, objective === null ? null : objective.trim()); }
      catch {
        // Initializing an empty session reloads its transcript without navigating away
        // from the goal's owner. Keep its uncertain result visible across that rebind.
        const owner = agent.value;
        const team = workspace.value.teams.find(team => team.id === owner?.teamId);
        const current = owner && team ? companionTarget(laptopId.value, team, owner) : null;
        if (active === session && owner?.backend === selected.backend && current
          && (Object.keys(target) as (keyof CompanionTarget)[]).every(key => (key === 'sessionId' && target.sessionId === null) || target[key] === current[key])) goalError.value = true;
        return 'unknown';
      }
      // The command was accepted even if refreshing later loses the connection.
      try {
        const next = await active.getWorkspace();
        if (active === session) workspace.value = reconcileWorkspace(workspace.value, next);
        if (active === session && epoch === selectionEpoch) await selectAgent(target.agentId);
      } catch { /* Subscriptions/reconnect will restore authoritative goal state. */ }
      return 'accepted';
    } finally { pendingGoals.delete(key); }
  }

  const delegate = (options: NonNullable<CompanionPromptOptions['delegation']>) => runCommand(() => { const target = currentTarget(); return canSend.value && target ? session?.sendPrompt(target, '/delegate', crypto.randomUUID(), { delegation: options }) : undefined; });
  async function controlSession(action: 'interrupt' | 'restart' | 'close', input?: CompanionCloseOptions) {
    const id = agentId.value; const active = session; const epoch = selectionEpoch;
    if (!id || !active || status.value !== 'connected' || !conversationReady.value || sessionAction.value) return;
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
        await selectAgent(action === 'restart' ? id : '');
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
      closePreview.value = { ...preview, upstream: matchingBranchUpstream(preview.branch, preview.upstream) ?? null };
    } catch {
      if (epoch === selectionEpoch && active === session) sessionActionFailed.value = true;
    } finally { sessionAction.value = null; }
    if (closePreview.value && !closePreview.value.isLinkedWorktree) await controlSession('close');
  }
  async function confirmCloseSession(id: string, deleteWorktree: boolean, deleteRemoteBranch = false, discardChanges = false) {
    const preview = closePreview.value;
    if (!preview || preview.target.agentId !== id || id !== agentId.value) return;
    if (deleteWorktree && (!preview.isLinkedWorktree || (preview.hasChanges && !discardChanges))) return;
    await controlSession('close', deleteWorktree ? { deleteWorktree: true, deleteRemoteBranch: deleteRemoteBranch && Boolean(preview.upstream), discardChanges, confirmed: true } : undefined);
  }
  const cancelCloseSession = () => { if (!sessionAction.value) { closePreview.value = null; sessionActionFailed.value = false; } };
  const dismissSessionError = () => { sessionActionFailed.value = false; };
  async function selectAgent(id: string) {
    const nextAgent = agents.value.find((a) => a.id === id) ?? mostRecentAgent();
    id = nextAgent?.id ?? '';
    if (id !== agentId.value) queuedPromptFailed.value = false;
    goalError.value = false;
    closePreview.value = null;
    sessionActionFailed.value = false;
    const epoch = ++selectionEpoch;
    ++conversationGeneration.value;
    const nextKey = conversationIdentity(nextAgent ?? null);
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
  async function readConversationContent(id: string, input: import('@workspace/core/contracts/conversation').ConversationContentInput) {
    const active = session; const epoch = selectionEpoch;
    const valid = () => active === session && epoch === selectionEpoch && id === agentId.value && status.value === 'connected'
      && agent.value?.backendSession?.kind === 'claude' && agent.value.backendSession.sessionId === input.sessionId;
    if (!valid() || !active?.readConversationContent) throw new Error('Conversation content is unavailable.');
    const chunk = await active.readConversationContent(id, input);
    if (!valid()) throw new Error('Conversation changed.');
    return chunk;
  }
  async function readImage(id: string, path: string) {
    const active = session; const epoch = selectionEpoch;
    const valid = () => active === session && epoch === selectionEpoch && id === agentId.value && status.value === 'connected';
    if (!valid() || !active?.readImage) throw new Error('Image is unavailable.');
    const image = await active.readImage(id, path);
    if (!valid()) throw new Error('Conversation changed.');
    return image;
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
  async function updateQueuedPrompt(target: CompanionTarget, promptId: string, action: 'steer' | 'delete') {
    const active = session; const epoch = selectionEpoch;
    const current = currentTarget();
    if (status.value !== 'connected' || !active?.updateQueuedPrompt || queuedPromptPending.value
      || !current || (Object.keys(current) as (keyof CompanionTarget)[]).some(key => target[key] !== current[key])
      || !workspace.value.queuedPrompts?.some(prompt => prompt.agentId === target.agentId && prompt.id === promptId)) return;
    queuedPromptPending.value = promptId; queuedPromptFailed.value = false;
    try {
      await active.updateQueuedPrompt(target, promptId, action);
      const next = await active.getWorkspace();
      if (active === session) applyWorkspace(next);
    } catch {
      if (active === session && epoch === selectionEpoch) queuedPromptFailed.value = true;
    } finally { queuedPromptPending.value = null; }
  }
  async function submit(prompt: string, sendOptions?: { followUpBehavior?: 'queue' | 'steer'; attachments?: readonly { type?: string; reference: string }[]; uploads?: CompanionUpload[]; onResolved?: (outcome: 'accepted' | 'rejected') => void }): Promise<'accepted' | 'rejected' | 'unknown'> {
    const uploads = sendOptions?.uploads ?? resolveUploads?.(sendOptions?.attachments) ?? [];
    if (!canSend.value || (!prompt.trim() && uploads.length === 0) || !session || (uploads.length > 0 && !defaultBackendCapabilities(agent.value!.backend).attachments)) return 'rejected';
    const target = currentTarget();
    if (!target) return 'rejected';
    const draftKey = key();
    const capturedSession = session;
    const epoch = selectionEpoch;
    const catalogEpoch = skillEpoch;
    // Resolve the same typed skill aliases as the desktop, including pasted mentions.
    if (/[$/][A-Za-z0-9_.-]+/.test(prompt)) {
      await loadSkills();
      if (epoch !== selectionEpoch || session !== capturedSession || catalogEpoch !== skillEpoch || !canSend.value) return 'rejected';
    }
    const selectedSkills = promptSkillInputsFromText(prompt, skills.value.items);
    const sentDraft = draft.value.text ? { ...draft.value } : { text: prompt, selectionStart: prompt.length, selectionEnd: prompt.length };
    // The SDK clears before dispatch; retain the submitted text until admission succeeds.
    if (!drafts[draftKey]?.text) drafts[draftKey] = sentDraft;
    sending[draftKey] = true;
    error.value = '';
    // Persist the intent before dispatch. A killed process cannot silently replay an unknown send.
    uncertain[draftKey] = true;
    unresolvedReceipts[draftKey] = false;
    const clientCommandId = crypto.randomUUID();
    const prior = commandIds[draftKey];
    if (prior) receiptCallbacks.delete(prior);
    commandIds[draftKey] = clientCommandId;
    submittedTexts[draftKey] = sentDraft.text;
    try { await persist(); }
    catch { uncertain[draftKey] = false; sending[draftKey] = false; return 'rejected'; }
    try {
      const settings = composerSettings.value;
      const composerOptions = settings && agent.value ? promptOptionsFor(settings, composerCapabilitiesFor(agent.value.backend, models.value)) : undefined;
      const options = selectedSkills.length || sendOptions?.followUpBehavior ? { ...composerOptions, ...(selectedSkills.length ? { skills: selectedSkills } : {}), ...(sendOptions?.followUpBehavior ? { followUpBehavior: sendOptions.followUpBehavior } : {}) } : composerOptions;
      const promptText = prompt.trim() ? prompt : '(no user instructions)';
      await (uploads.length ? capturedSession.sendPrompt(target, promptText, clientCommandId, options, uploads) : capturedSession.sendPrompt(target, promptText, clientCommandId, options));
      if (drafts[draftKey]?.text === sentDraft.text) drafts[draftKey] = { text: '', selectionStart: 0, selectionEnd: 0 };
      uncertain[draftKey] = false;
      await persist();
      if (epoch === selectionEpoch) await selectAgent(target.agentId);
      return 'accepted';
    } catch (failure) {
      if (failure instanceof PromptRejectedError) {
        uncertain[draftKey] = false;
        if (epoch === selectionEpoch) error.value = 'mobile.errors.commandFailed';
        await persist().catch(() => {});
        return 'rejected';
      }
      uncertain[draftKey] = true;
      if (sendOptions?.onResolved) receiptCallbacks.set(clientCommandId, sendOptions.onResolved);
      scheduleReceipts();
      if (epoch === selectionEpoch) error.value = storageFailed ? 'mobile.errors.storage' : 'mobile.errors.deliveryUnknown';
      await persist().catch(() => {});
      return 'unknown';
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
  const createProject = (input: Omit<CompanionProjectInput, 'teamId'>) => startChat((active, teamId) => active.createProject?.({ ...input, teamId }));
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
  async function setActive(active: boolean) {
    if (isForeground === active) return;
    isForeground = active;
    if (!active) { clearTimeout(retryTimer); retryTimer = undefined; }
    try { await session?.setActive?.(active); } catch { /* The channel reports transport loss through onDisconnect. */ }
  }
  async function reconnect(force = false) {
    if (laptopId.value && (force || ['disconnected', 'error'].includes(status.value))) await connect(laptopId.value, true);
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
  async function markRead(id: string, revision: number) {
    if (id !== agentId.value || !conversationReady.value || !session?.markRead) return;
    await session.markRead(id, revision);
  }
  return { updateQueuedPrompt, queuedPromptPending, queuedPromptFailed, projectBranches, loadProjectBranches, dismissProjectBranches, projectRepositories, loadProjectRepositories, dismissProjectRepositories, createProject, usage, loadUsage, registerPush, pushRegistrationFailed, changeGoal, goalBusy, goalError, review, loadReview, dismissReview, markRead, branches, loadBranches, dismissBranches, selectBackend, chatCreation, createChat, createQuickChat, dismissChatCreation, requests, respondRequest, respondingRequest, failedRequest, status, error, laptopId, teamId, agentId, workspace, conversation, conversationReady, conversationGeneration, loading, agents, agent,
    draft, deliveryUnknown, canSend, history, loadOlder, readImage, readConversationContent, models, plugins, loadPlugins, skills, loadSkills, composerSettings, updateComposerSettings, permissions, modelFavorites, setApprovalPreset, setPermissionMode, interrupt, restartSession, requestCloseSession, confirmCloseSession, cancelCloseSession, closePreview, sessionAction, sessionActionFailed, dismissSessionError, delegate, startReview, connect, selectTeam, selectAgent, updateDraft, submit,
    setActive, disconnect, reconnect, revoke, dispose() { receiptCallbacks.clear(); disposed = true; reconnectWanted = false; closeSession(); stopProjects(); dismissProjectRepositories(); stopUsage(); stopSkills(); ++skillEpoch; stopPlugins(); ++pluginEpoch; stopBranches(); dismissBranches(); stopReview(); dismissReview(); } };
}
