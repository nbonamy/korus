import type { AgentRequest } from '@workspace/core/agent-request';
import { PromptRejectedError } from './companion-port';
import { createBackoff } from './reconnect-backoff';
import { createRemoteList } from './remote-list';
import { createDraftLedger } from './draft-ledger';
import { createReceiptReconciler } from './receipts';
import { createSessionActions } from './session-actions';
import { createComposerState } from './composer-state';
import { sameTarget } from './companion-target';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { promptSkillInputsFromText } from '@codex-app-sdk/vue';
import type { Agent, AgentBackend, BackendModelOption, BackendSkillSummary, BackendPluginSummary } from '@workspace/core/contracts';
import type { CompanionBranch, CompanionNewChat, CompanionUsage, CompanionProjectInput, CompanionGitHubRepository, CompanionProjectBranch } from '@workspace/core/companion-protocol';
import { companionTarget, companionSessionId, type CompanionTarget, type CompanionRequestReply, type CompanionCloseOptions, type CompanionClosePreview } from '@workspace/core/companion-protocol';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { matchingBranchUpstream } from '@workspace/core/git-remote';
import type { CompanionConnector, CompanionConversation, CompanionHistoryState, CompanionPromptOptions, CompanionReviewInput, CompanionSession, CompanionUpload, CompanionWorkspace } from './companion-port';
import { composerCapabilitiesFor, promptOptionsFor } from './composer-settings';
import { createGitChanges } from './git-changes';
import { reconcileWorkspace } from './workspace-reconcile';
import type { DraftState, DraftStore } from './protected-storage';
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
  // Every list read from the laptop on demand is dropped when the connection or its context changes.
  const remote = { session: () => session, connected: () => status.value === 'connected' };
  const usageList = createRemoteList<CompanionUsage>(remote, {});
  const usage = computed(() => ({ status: usageList.state.value.status, providers: usageList.state.value.items }));
  const stopUsage = watch(status, usageList.reset, { flush: 'sync' });
  async function loadUsage() {
    if (status.value !== 'connected' || usageList.state.value.status === 'loading') return;
    await usageList.load({}, active => active.getUsage?.());
  }
  const respondingRequest = ref<string | null>(null);
  const failedRequest = ref<string | null>(null);
  const pendingGoals = reactive(new Set<string>());
  const goalError = ref(false);
  const queuedPromptPending = ref<string | null>(null);
  const queuedPromptFailed = ref(false);
  const goalKey = () => JSON.stringify([laptopId.value, agentId.value]);
  const goalBusy = computed(() => pendingGoals.has(goalKey()));

  const chatCreation = ref<'idle' | 'creating' | 'failed'>('idle');
  const teamCreation = ref<'idle' | 'creating' | 'failed'>('idle');
  const laptopId = ref('');
  const teamId = ref('');
  const agentId = ref('');
  const workspace = shallowRef<CompanionWorkspace>({ teams: [], agents: [] });
  const conversation = shallowRef<CompanionConversation | null>(null);
  const conversationReady = ref(false);
  const loading = ref(false);
  const refreshing = ref(false);
  const loadingOlder = ref(false);
  const historyFailed = ref(false);
  const hasOlder = ref<boolean | null>(null);
  const history = computed<CompanionHistoryState>(() => ({
    hasOlder: status.value === 'connected' && Boolean(conversation.value) && (hasOlder.value ?? conversation.value?.payload.snapshot.historyState?.hasOlder ?? true),
    loadingOlder: loadingOlder.value,
    failed: historyFailed.value,
  }));
  const ledger = createDraftLedger(store, () => { error.value = 'mobile.errors.storage'; });
  const { drafts, uncertain, commandIds, submittedTexts, sending, storageReady, ready, persist } = ledger;
  const unresolvedReceipts = ledger.unresolved; const receiptCallbacks = ledger.callbacks;
  let session: CompanionSession | null = null;
  let unsubscribe = () => {};
  let connectionEpoch = 0;
  let selectionEpoch = 0;
  const conversationGeneration = ref(0);
  let selectedConversationKey = '';
  let reconnectWanted = false;
  let workspaceLoaded = false;
  let isForeground = true;
  const backoff = createBackoff();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const key = () => JSON.stringify([laptopId.value, agentId.value]);
  const branchList = createRemoteList<CompanionBranch, { repositoryId: string | null }>(remote, { repositoryId: null });
  const branches = branchList.state;
  const dismissBranches = branchList.reset;
  const stopBranches = watch([laptopId, teamId, status], dismissBranches, { flush: 'sync' });
  const loadBranches = (repositoryId: string, team = teamId.value) => branchList.load({ repositoryId }, active => team ? active.listBranches?.(team, repositoryId) : undefined);
  const projectBranchList = createRemoteList<CompanionProjectBranch, { repositoryId: string | null }>(remote, { repositoryId: null });
  const projectBranches = projectBranchList.state;
  const dismissProjectBranches = projectBranchList.reset;
  const loadProjectBranches = (repositoryId: string, source: 'github' | 'gitlab' | 'local' = 'github') => projectBranchList.load({ repositoryId }, active => {
    if (source === 'gitlab') return teamId.value ? active.repositoryBranches?.(teamId.value, source, repositoryId) : undefined;
    const read = source === 'local' ? active.localBranches : active.githubBranches;
    return teamId.value ? read?.call(active, teamId.value, repositoryId) : undefined;
  });
  const projectRepositoryList = createRemoteList<CompanionGitHubRepository>(remote, {});
  const projectRepositories = projectRepositoryList.state;
  function dismissProjectRepositories() { projectRepositoryList.reset(); dismissProjectBranches(); }
  const stopProjects = watch([laptopId, teamId, status], dismissProjectRepositories, { flush: 'sync' });
  const loadProjectRepositories = (source: 'github' | 'gitlab' | 'local' = 'github') => projectRepositoryList.load({}, active => {
    if (source === 'gitlab') return teamId.value ? active.repositoryCatalog?.(teamId.value, source) : undefined;
    const read = source === 'local' ? active.localRepositories : active.githubRepositories;
    return teamId.value ? read?.call(active, teamId.value) : undefined;
  });

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
  const skillList = createRemoteList<BackendSkillSummary>(remote, {});
  const skills = skillList.state;
  const pluginList = createRemoteList<BackendPluginSummary>(remote, {});
  const plugins = pluginList.state;
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
    if (!target || !sameTarget(setup.target, target)) return;
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
          if (!(await refreshWorkspace(active)) || epoch !== reviewEpoch) return;
          if (agents.value.some(agent => agent.id === reviewerId)) await selectAgent(reviewerId);
        } catch { /* The reviewer remains available in the desktop-owned sidebar. */ }
      }
      if (epoch === reviewEpoch) review.value = { status: 'started', setup };
    } catch { if (epoch === reviewEpoch) review.value = { status: 'unknown', setup }; }
  }
  const skillContext = computed(() => JSON.stringify([laptopId.value, status.value, agent.value?.id, agent.value?.backend, agent.value?.folder, agent.value && companionSessionId(agent.value)]));
  const stopSkills = watch(skillContext, skillList.reset, { flush: 'sync' });
  const stopPlugins = watch(skillContext, pluginList.reset, { flush: 'sync' });
  /** Skills and plugins are read once per chat; only the enabled ones are offered, and an engine without them offers none. */
  function loadCatalog<Item extends { enabled: boolean }>(list: ReturnType<typeof createRemoteList<Item>>, capability: 'skills' | 'plugins',
    supports: (active: CompanionSession) => boolean, read: (active: CompanionSession, id: string) => Promise<Item[]> | undefined): Promise<void> {
    const owner = agent.value;
    if (list.pending) return list.pending;
    if (list.state.value.status === 'loaded' || status.value !== 'connected' || !owner) return Promise.resolve();
    if (!session || !supports(session) || !defaultBackendCapabilities(owner.backend)[capability]) { list.settle([]); return Promise.resolve(); }
    return list.loadOnce({}, active => read(active, owner.id)?.then(items => items.filter(item => item.enabled)));
  }
  const loadSkills = () => loadCatalog(skillList, 'skills', active => Boolean(active.listSkills), (active, id) => active.listSkills?.(id));
  const loadPlugins = () => loadCatalog(pluginList, 'plugins', active => Boolean(active.listPlugins), (active, id) => active.listPlugins?.(id));
  // Remember local dismissal and acknowledged consumption while late workspace updates catch up.
  // Include the request content so a reused identity with a new question remains visible.
  const hiddenRequests = reactive(new Map<string, string>());
  function hideRequest(entry: { key: string; request: AgentRequest }) {
    hiddenRequests.delete(entry.key);
    hiddenRequests.set(entry.key, JSON.stringify(entry.request));
    while (hiddenRequests.size > 128) hiddenRequests.delete(hiddenRequests.keys().next().value!);
    if (failedRequest.value === entry.key) failedRequest.value = null;
  }
  const requests = computed(() => {
    const owner = agent.value; const target = targetOf(owner);
    if (!owner || !target) return [];
    return (workspace.value.agentRequests?.[owner.id] ?? []).map((request) => ({
      key: JSON.stringify([target, request.id, request.conversationId]), target, request,
    })).filter(entry => hiddenRequests.get(entry.key) !== JSON.stringify(entry.request));
  });
  function dismissRequest(key: string) {
    const pending = requests.value.find(entry => entry.key === key);
    if (pending?.request.kind === 'question' && respondingRequest.value !== key) hideRequest(pending);
  }
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
        hideRequest(pending);
        workspace.value = { ...workspace.value, agentRequests: { ...workspace.value.agentRequests,
          [reply.target.agentId]: (workspace.value.agentRequests?.[reply.target.agentId] ?? []).filter((request) => request.id !== reply.id || request.conversationId !== reply.conversationId) } };
      }
    } catch {
      if (session === active && epoch === connectionEpoch) {
        // Reconcile an answer handled on desktop or whose acknowledgment was lost. Never replay it.
        let reconciled = false;
        try { reconciled = await refreshWorkspace(active); } catch { /* Keep the request and draft available for an explicit retry. */ }
        if (session !== active || epoch !== connectionEpoch) return;
        const stillPending = workspace.value.agentRequests?.[reply.target.agentId]?.some(request => request.id === reply.id && request.conversationId === reply.conversationId);
        // Skipping a nonblocking question is also a local dismissal; cancelling it on the laptop is best effort.
        const optionalSkip = reply.outcome.kind === 'cancelled' && pending.request.kind === 'question' && pending.request.question.blocking === false;
        if ((reconciled && !stillPending) || optionalSkip) hideRequest(pending);
        else failedRequest.value = pending.key;
      }
    } finally { if (respondingRequest.value === pending.key) respondingRequest.value = null; }
  }
  const composer = createComposerState({ session: () => session, agent: () => agent.value, agentId: () => agentId.value, workspace: () => workspace.value, applyWorkspace: (next) => { applyWorkspace(next); } });
  const { models, composerSettings, modelFavorites, permissions, loadModels } = composer;
  const draft = computed(() => drafts[key()] ?? { text: '', selectionStart: 0, selectionEnd: 0 });
  const deliveryUnknown = computed(() => Boolean(uncertain[key()]));
  const canSend = computed(() => status.value === 'connected' && conversationReady.value && Boolean(agent.value)
    && storageReady.value && !goalBusy.value && !loading.value && !sessionAction.value && !sending[key()] && (!deliveryUnknown.value || unresolvedReceipts[key()] === true));

  /** The agent as the laptop identifies it: host, location, team, agent and session. */
  function targetOf(owner: Agent | null | undefined): CompanionTarget | null {
    const team = workspace.value.teams.find(team => team.id === owner?.teamId);
    return owner && team ? companionTarget(laptopId.value, team, owner) : null;
  }
  /** The selected conversation as the laptop identifies it, captured before any await. */
  const currentTarget = () => targetOf(agent.value);
  function conversationIdentity(owner = agent.value): string {
    const target = targetOf(owner);
    return owner && target ? JSON.stringify([target, owner.backend]) : '';
  }
  /** Reads the laptop's workspace after a command. False when the session changed meanwhile, so nothing is applied. */
  async function refreshWorkspace(active: CompanionSession): Promise<boolean> {
    const next = await active.getWorkspace();
    if (active !== session) return false;
    reconcileNotificationReads(next);
    workspace.value = reconcileWorkspace(workspace.value, next);
    return true;
  }
  const git = createGitChanges({
    owner: () => conversationIdentity(), agent: () => agent.value,
    status: () => workspace.value.gitStatuses?.[agentId.value] ?? null,
    session: () => session, connected: () => status.value === 'connected',
  });
  function matchesCurrentSession(frame: CompanionConversation): boolean {
    const owner = agent.value;
    if (!owner?.backendSession || frame.agentId !== owner.id || frame.backend !== owner.backend) return false;
    if (frame.type === 'codex.conversationSnapshotChanged') return owner.backendSession.kind === 'codex' && frame.threadId === owner.backendSession.threadId;
    return owner.backendSession.kind !== 'codex' && frame.payload.snapshot.sessionId === owner.backendSession.sessionId;
  }
  const notificationReads = new Map<string, number>();
  function forwardNotification(notification: CompanionNotification) {
    if (notification.kind === 'read' && notification.revision !== undefined) {
      const { hostId, locationId, teamId, agentId } = notification.target;
      const key = JSON.stringify([hostId, locationId, teamId, agentId]);
      if (notification.revision <= (notificationReads.get(key) ?? -1)) return;
      notificationReads.set(key, notification.revision);
      if (notificationReads.size > 1024) notificationReads.delete(notificationReads.keys().next().value!);
    }
    onNotification?.(notification);
  }
  function reconcileNotificationReads(next: CompanionWorkspace) {
    for (const agent of next.agents) {
      const team = next.teams.find(team => team.id === agent.teamId);
      if (team && agent.readState && agent.readState.readRevision > 0) forwardNotification({ id: 'read', kind: 'read', revision: agent.readState.readRevision,
        name: '', createdAt: Date.now(), target: companionTarget(laptopId.value, team, agent) });
    }
  }
  function applyWorkspace(next: CompanionWorkspace): boolean {
    reconcileNotificationReads(next);
    workspace.value = reconcileWorkspace(workspace.value, next);
    if ((!agentId.value && agents.value.length) || (agentId.value && selectedConversationKey !== conversationIdentity())) {
      composer.forgetPermission(agentId.value);
      void selectAgent(agentId.value);
      return true;
    }
    return false;
  }

  function closeSession() {
    composer.forgetAllPermissions();
    actions.reset(); chatCreation.value = 'idle'; teamCreation.value = 'idle';
    receipts.clear();
    clearTimeout(retryTimer);
    retryTimer = undefined;
    ++connectionEpoch;
    ++selectionEpoch;
    ++conversationGeneration.value;
    loadingOlder.value = false;
    loading.value = false;
    refreshing.value = false;
    conversationReady.value = false;
    unsubscribe();
    unsubscribe = () => {};
    session?.close();
    session = null;
  }
  function retryConnection() {
    if (!reconnectWanted || !isForeground || disposed || retryTimer || !laptopId.value) return;
    const delay = backoff.next();
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (reconnectWanted && isForeground && !disposed) void connect(laptopId.value, true);
    }, delay);
  }
  async function connect(id: string, reconnecting = false) {
    if (disposed) return;
    reconnectWanted = true;
    if (!reconnecting) backoff.reset();
    closeSession();
    const epoch = connectionEpoch;
    const sameLaptop = laptopId.value === id;
    if (!sameLaptop) { workspaceLoaded = false; teamId.value = ''; agentId.value = ''; workspace.value = { teams: [], agents: [] }; conversation.value = null; composer.forgetModels(); }
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
      workspaceLoaded = true;
      if (!isForeground) void session.setActive?.(false).catch(() => {});
      reconcileNotificationReads(nextWorkspace);
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
          conversation.value = frame;
          if (!refreshing.value) conversationReady.value = true;
          if (error.value === 'mobile.errors.loadConversation') error.value = '';
        }
      }) ?? (() => {});
      const removeNotifications = session.onNotification?.(notification => { if (epoch === connectionEpoch) forwardNotification(notification); }) ?? (() => {});
      unsubscribe = () => { removeDisconnect(); removeUpdates(); removeNotifications(); };
      if (pushRegistration !== undefined) void registerPush(pushRegistration);
      status.value = 'connected';
      // Receipt reads must not hold back the transcript; they settle while it loads.
      const receiptsSettled = receipts.reconcile();
      if (teamId.value) await selectAgent(agentId.value);
      await receiptsSettled;
      if (epoch === connectionEpoch && status.value === 'connected' && (!agentId.value || conversationReady.value)) backoff.reset();
    } catch {
      opened?.close();
      if (epoch === connectionEpoch) {
        error.value = 'mobile.errors.openLaptop';
        if (workspaceLoaded) { status.value = 'error'; retryConnection(); }
        else { reconnectWanted = false; status.value = 'unpaired'; }
      }
    }
  }
  const receipts = createReceiptReconciler({
    ledger, session: () => session, connected: () => status.value === 'connected', connection: () => connectionEpoch, laptopId: () => laptopId.value, disposed: () => disposed,
    settled: (draftKey, outcome) => { if (draftKey === key() && error.value === 'mobile.errors.deliveryUnknown') error.value = outcome === 'accepted' ? '' : 'mobile.errors.commandFailed'; },
  });
  async function selectTeam(id: string, preferredAgentId = agentId.value) {
    teamId.value = workspace.value.teams.some((team) => team.id === id) ? id : '';
    await selectAgent(preferredAgentId);
  }
  /** A laptop-side command that is not the person's draft: sent once, the draft untouched. */
  async function runCommand(command: () => Promise<unknown> | undefined) {
    error.value = '';
    try { await command(); } catch { error.value = 'mobile.errors.commandFailed'; }
  }
  async function changeGoal(target: CompanionTarget, objective: string | null): Promise<'accepted' | 'rejected' | 'unknown'> {
    const active = session; const selected = agent.value;
    const current = currentTarget();
    if (!canSend.value || !active?.changeGoal || !selected || !defaultBackendCapabilities(selected.backend).goals
      || !current || !sameTarget(current, target)
      || (objective !== null && (!objective.trim() || objective.trim().length > 100_000))) return 'rejected';
    const key = goalKey(); const epoch = selectionEpoch;
    pendingGoals.add(key); goalError.value = false;
    try {
      try { await active.changeGoal(target, objective === null ? null : objective.trim()); }
      catch {
        // Initializing an empty session reloads its transcript without navigating away
        // from the goal's owner. Keep its uncertain result visible across that rebind.
        const owner = agent.value; const current = targetOf(owner);
        if (active === session && owner?.backend === selected.backend && current
          && (Object.keys(target) as (keyof CompanionTarget)[]).every(key => (key === 'sessionId' && target.sessionId === null) || target[key] === current[key])) goalError.value = true;
        return 'unknown';
      }
      // The command was accepted even if refreshing later loses the connection.
      try {
        if (await refreshWorkspace(active) && epoch === selectionEpoch) await selectAgent(target.agentId);
      } catch { /* Subscriptions/reconnect will restore authoritative goal state. */ }
      return 'accepted';
    } finally { pendingGoals.delete(key); }
  }

  const delegate = (options: NonNullable<CompanionPromptOptions['delegation']>) => runCommand(() => { const target = currentTarget(); return canSend.value && target ? session?.sendPrompt(target, '/delegate', crypto.randomUUID(), { delegation: options }) : undefined; });
  const actions = createSessionActions({
    session: () => session, connected: () => status.value === 'connected', conversationReady: () => conversationReady.value, agentId: () => agentId.value,
    selection: () => selectionEpoch, currentTarget, refreshWorkspace,
    reopen: async (id) => { conversation.value = null; selectedConversationKey = ''; await selectAgent(id); },
  });
  const { action: sessionAction, failed: sessionActionFailed, closePreview } = actions;
  async function selectAgent(id: string) {
    const nextAgent = agents.value.find((a) => a.id === id) ?? mostRecentAgent();
    id = nextAgent?.id ?? '';
    if (id !== agentId.value) queuedPromptFailed.value = false;
    goalError.value = false;
    actions.reset();
    const epoch = ++selectionEpoch;
    ++conversationGeneration.value;
    const nextKey = conversationIdentity(nextAgent ?? null);
    const nextTarget = targetOf(nextAgent);
    const cached = nextTarget ? session?.cachedConversation?.(id) ?? connector.cachedConversation?.(nextTarget) : undefined;
    const retaining = Boolean(conversation.value) && nextKey === selectedConversationKey;
    selectedConversationKey = nextKey;
    loadingOlder.value = false;
    if (!retaining) { historyFailed.value = false; hasOlder.value = null; conversation.value = cached ?? null; }
    agentId.value = nextAgent?.id ?? '';
    conversationReady.value = cached !== undefined && status.value === 'connected' && session?.isConversationCurrent?.(id) !== false;
    error.value = '';
    loading.value = false; refreshing.value = false;
    if (!session || status.value !== 'connected') return;
    if (!agentId.value) { session.deselectConversation?.(); return; }
    loading.value = cached === undefined && !retaining;
    refreshing.value = Boolean(conversation.value);
    const active = session;
    try {
      const frame = await active.loadConversation(id);
      if (epoch !== selectionEpoch) return;
      if (frame && (frame.agentId !== id || frame.backend !== agent.value?.backend)) throw new Error('Conversation identity mismatch.');
      if (!frame && agent.value?.backendSession) throw new Error('Conversation is unavailable.');
      conversation.value = frame;
      if (!conversationReady.value) ++conversationGeneration.value;
      conversationReady.value = true;
      void loadModels(id, active);
    } catch {
      if (epoch === selectionEpoch) error.value = 'mobile.errors.loadConversation';
    } finally {
      if (epoch === selectionEpoch) { loading.value = false; refreshing.value = false; }
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
      || !current || !sameTarget(current, target)
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
    const catalogEpoch = skillList.epoch;
    // Resolve the same typed skill aliases as the desktop, including pasted mentions.
    if (/[$/][A-Za-z0-9_.-]+/.test(prompt)) {
      await loadSkills();
      if (epoch !== selectionEpoch || session !== capturedSession || catalogEpoch !== skillList.epoch || !canSend.value) return 'rejected';
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
      // Admission is complete. A slow transcript refresh must not hold the native composer open.
      if (epoch === selectionEpoch) void selectAgent(target.agentId);
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
      receipts.schedule();
      if (epoch === selectionEpoch) error.value = ledger.storageFailed ? 'mobile.errors.storage' : 'mobile.errors.deliveryUnknown';
      await persist().catch(() => {});
      return 'unknown';
    } finally {
      sending[draftKey] = false;
    }
  }
  /** Creates through the owning laptop and reconciles its authoritative workspace. */
  async function createTeam(value: string): Promise<string | null> {
    const name = value.trim(); const active = session;
    if (!active || status.value !== 'connected' || teamCreation.value === 'creating' || !name || name.length > 100) return null;
    teamCreation.value = 'creating';
    try {
      if (!active.createTeam) throw new Error('Team creation unavailable.');
      const id = await active.createTeam(name);
      if (!await refreshWorkspace(active)) return null;
      if (!workspace.value.teams.some(team => team.id === id)) throw new Error('Created team is unavailable.');
      teamCreation.value = 'idle';
      return id;
    } catch {
      if (session === active) teamCreation.value = 'failed';
      return null;
    }
  }
  const dismissTeamCreation = () => { if (teamCreation.value !== 'creating') teamCreation.value = 'idle'; };

  /** Starts a chat and opens it once the laptop has it ready. */
  async function startChat(start: (active: CompanionSession, team: string) => Promise<string> | undefined, team = teamId.value) {
    const active = session; const epoch = selectionEpoch;
    if (!active || !team || status.value !== 'connected' || chatCreation.value === 'creating') return;
    chatCreation.value = 'creating';
    try {
      const created = await start(active, team);
      if (!created) throw new Error('Chat creation unavailable.');
      if (!(await refreshWorkspace(active))) return;
      chatCreation.value = 'idle';
      if (epoch === selectionEpoch) await selectTeam(workspace.value.agents.find(agent => agent.id === created)?.teamId ?? team, created);
    } catch {
      if (active === session) chatCreation.value = 'failed';
    }
  }
  const createChat = (chat: Omit<CompanionNewChat, 'teamId'>, team = teamId.value) => startChat((active, teamId) => active.createChat?.({ ...chat, teamId }), team);
  const createQuickChat = (backend: AgentBackend) => startChat((active, teamId) => active.createQuickChat?.({ teamId, backend }));
  const createProject = (input: Omit<CompanionProjectInput, 'teamId'>) => startChat((active, teamId) => active.createProject?.({ ...input, teamId }));
  const duplicateAgent = (target: CompanionTarget, backend: AgentBackend) => startChat((active) => {
    const current = currentTarget();
    if (!current || !sameTarget(current, target)) throw new Error('Target is stale.');
    if (!workspace.value.backends?.[current.teamId]?.includes(backend)) throw new Error('That engine is not available.');
    return active.duplicateAgent?.(target, backend);
  });
  /** The engine of a chat that has not started: changed on the laptop, then the agent is reopened with it. */
  async function selectBackend(backend: AgentBackend) {
    const id = agentId.value; const active = session; const epoch = selectionEpoch;
    if (!id || !active?.setBackend || status.value !== 'connected' || agent.value?.backend === backend) return;
    try {
      await active.setBackend(id, backend);
      if (await refreshWorkspace(active) && epoch === selectionEpoch) await selectAgent(id);
    } catch { if (active === session && epoch === selectionEpoch) error.value = 'mobile.errors.commandFailed'; }
  }
  const dismissChatCreation = () => { if (chatCreation.value === 'failed') chatCreation.value = 'idle'; };
  function disconnect() { reconnectWanted = false; closeSession(); status.value = 'disconnected'; }
  async function setActive(active: boolean) {
    if (isForeground === active) return;
    isForeground = active;
    if (!active) { clearTimeout(retryTimer); retryTimer = undefined; } else backoff.reset();
    try { await session?.setActive?.(active); } catch { /* The channel reports transport loss through onDisconnect. */ }
  }
  async function reconnect(force = false) {
    if (laptopId.value && (force || ['disconnected', 'error'].includes(status.value))) { backoff.reset(); await connect(laptopId.value, true); }
  }
  function chooseConnection() {
    disconnect();
    conversation.value = null;
    workspace.value = { teams: [], agents: [] };
    laptopId.value = ''; teamId.value = ''; agentId.value = '';
    workspaceLoaded = false;
    error.value = '';
    status.value = 'unpaired';
  }
  async function revoke() {
    reconnectWanted = false;
    const id = laptopId.value;
    closeSession();
    conversation.value = null;
    workspace.value = { teams: [], agents: [] };
    teamId.value = ''; agentId.value = '';
    workspaceLoaded = false;
    status.value = 'revoked';
    try { await connector.revoke(id); }
    catch { error.value = 'mobile.errors.revoke'; }
  }
  async function markRead(id: string, revision: number) {
    if (id !== agentId.value || !conversationReady.value || !session?.markRead) return;
    await session.markRead(id, revision);
  }
  return {
    // The link to the laptop.
    status, error, laptopId, connect, setActive, disconnect, chooseConnection, reconnect, revoke, registerPush, pushRegistrationFailed,
    // What the laptop hosts, and which of it is selected.
    teamId, agentId, workspace, agents, agent, selectTeam, selectAgent, selectBackend, markRead, createTeam, teamCreation, dismissTeamCreation,
    // The selected conversation and its history.
    conversation, conversationReady, conversationGeneration, loading, refreshing, history, loadOlder, readImage, readConversationContent,
    conversationUpdates: (since: import('@workspace/core/companion-journal').CompanionCheckpoint | null) => {
      const target = currentTarget();
      return target ? connector.conversationUpdates?.(target, since) ?? null : null;
    },
    // The composer: the draft, sending it, and what was sent along with it.
    draft, updateDraft, submit, canSend, deliveryUnknown, models, composerSettings, updateComposerSettings: composer.updateSettings, modelFavorites,
    permissions, setApprovalPreset: composer.setApprovalPreset, setPermissionMode: composer.setPermissionMode,
    skills, loadSkills, plugins, loadPlugins, delegate, queuedPromptPending, queuedPromptFailed, updateQueuedPrompt,
    // Goals and questions the agent asks.
    goalBusy, goalError, changeGoal, requests, dismissRequest, respondRequest, respondingRequest, failedRequest,
    // Actions on the selected chat, and creating new ones.
    renameAgent: actions.rename, interrupt: actions.interrupt, restartSession: actions.restart, requestCloseSession: actions.requestClose,
    confirmCloseSession: actions.confirmClose, cancelCloseSession: actions.cancelClose, closePreview, sessionAction, sessionActionFailed, dismissSessionError: actions.dismissError,
    chatCreation, createChat, createQuickChat, createProject, duplicateAgent, dismissChatCreation,
    // Lists read from the laptop on demand.
    usage, loadUsage, branches, loadBranches, dismissBranches, projectBranches, loadProjectBranches, dismissProjectBranches,
    projectRepositories, loadProjectRepositories, dismissProjectRepositories, review, loadReview, startReview, dismissReview, git,
    dispose() {
      git.dispose(); receiptCallbacks.clear(); disposed = true; reconnectWanted = false; closeSession();
      stopProjects(); dismissProjectRepositories(); stopUsage(); stopSkills(); skillList.reset(); stopPlugins(); pluginList.reset();
      stopBranches(); dismissBranches(); stopReview(); dismissReview();
    },
  };
}
