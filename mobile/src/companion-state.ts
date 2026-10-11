import { computed, reactive, ref, shallowRef } from 'vue';
import type { CodexComposerState } from '@codex-app-sdk/vue';
import type { CompanionConnector, CompanionConversation, CompanionSession, CompanionWorkspace } from './companion-port';
import { restoreDraftRecord, type DraftStore } from './protected-storage';

export function createCompanionState(connector: CompanionConnector, store?: DraftStore) {
  const status = ref<'unpaired' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'revoked' | 'error'>('unpaired');
  const error = ref('');
  const laptopId = ref('');
  const teamId = ref('');
  const agentId = ref('');
  const workspace = shallowRef<CompanionWorkspace>({ teams: [], agents: [] });
  const conversation = shallowRef<CompanionConversation | null>(null);
  const loading = ref(false);
  const drafts = reactive<Record<string, CodexComposerState>>({});
  const uncertain = reactive<Record<string, boolean>>({});
  const sending = reactive<Record<string, boolean>>({});
  const storageReady = ref(!store);
  let storageFailed = false;
  let writes = Promise.resolve();
  const ready = store ? store.read().then((record) => {
    const restored = restoreDraftRecord(record);
    Object.assign(drafts, restored.drafts);
    Object.assign(uncertain, restored.uncertain);
    storageReady.value = true;
  }).catch(() => { storageFailed = true; error.value = 'mobile.errors.storage'; }) : Promise.resolve();
  function persist() {
    if (!store) return Promise.resolve();
    const record = JSON.parse(JSON.stringify({ drafts, uncertain }));
    const pending = writes.then(() => store.write(record));
    // Each write keeps its rejection for callers; the queue remains usable after a transient lock.
    writes = pending.catch(() => { storageFailed = true; error.value = 'mobile.errors.storage'; });
    return pending.then(() => { storageFailed = false; });
  }
  let session: CompanionSession | null = null;
  let unsubscribe = () => {};
  let connectionEpoch = 0;
  let selectionEpoch = 0;
  const key = () => JSON.stringify([laptopId.value, agentId.value]);
  const agents = computed(() => workspace.value.agents.filter((a) => a.teamId === teamId.value));
  const agent = computed(() => agents.value.find((a) => a.id === agentId.value) ?? null);
  const draft = computed(() => drafts[key()] ?? { text: '', selectionStart: 0, selectionEnd: 0 });
  const deliveryUnknown = computed(() => Boolean(uncertain[key()]));
  const canSend = computed(() => status.value === 'connected' && Boolean(agent.value && conversation.value)
    && storageReady.value && !loading.value && !sending[key()] && !deliveryUnknown.value);

  function closeSession() {
    ++connectionEpoch;
    ++selectionEpoch;
    loading.value = false;
    unsubscribe();
    unsubscribe = () => {};
    session?.close();
    session = null;
  }
  async function connect(id: string, reconnecting = false) {
    closeSession();
    const epoch = connectionEpoch;
    const sameLaptop = laptopId.value === id;
    if (!sameLaptop) { teamId.value = ''; agentId.value = ''; workspace.value = { teams: [], agents: [] }; conversation.value = null; }
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
      unsubscribe = session.onDisconnect(() => {
        ++selectionEpoch;
        loading.value = false;
        status.value = 'disconnected';
      });
      status.value = 'connected';
      if (agentId.value) await selectAgent(agentId.value);
    } catch {
      opened?.close();
      if (epoch === connectionEpoch) { status.value = 'error'; error.value = 'mobile.errors.openLaptop'; }
    }
  }
  async function selectTeam(id: string) {
    teamId.value = workspace.value.teams.some((team) => team.id === id) ? id : '';
    await selectAgent('');
  }
  async function selectAgent(id: string) {
    const epoch = ++selectionEpoch;
    agentId.value = agents.value.some((a) => a.id === id) ? id : '';
    conversation.value = null;
    error.value = '';
    loading.value = false;
    if (!agentId.value || !session || status.value !== 'connected') return;
    loading.value = true;
    try {
      const frame = await session.loadConversation(id);
      if (epoch !== selectionEpoch) return;
      if (frame.agentId !== id || frame.backend !== agent.value?.backend) throw new Error('Conversation identity mismatch.');
      conversation.value = frame;
    } catch {
      if (epoch === selectionEpoch) error.value = 'mobile.errors.loadConversation';
    } finally {
      if (epoch === selectionEpoch) loading.value = false;
    }
  }
  function updateDraft(next: CodexComposerState) {
    if (agentId.value && storageReady.value) {
      drafts[key()] = { ...next };
      void persist().catch(() => {});
    }
  }
  async function submit(prompt: string) {
    if (!canSend.value || !prompt.trim() || !session) return;
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
    try { await persist(); }
    catch { uncertain[draftKey] = false; sending[draftKey] = false; return; }
    try {
      await capturedSession.sendPrompt(target, prompt);
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
  function disconnect() { closeSession(); status.value = 'disconnected'; }
  async function reconnect() {
    if (laptopId.value && ['disconnected', 'error'].includes(status.value)) await connect(laptopId.value, true);
  }
  async function revoke() {
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
    draft, deliveryUnknown, canSend, connect, selectTeam, selectAgent, updateDraft, submit,
    disconnect, reconnect, revoke, dispose: closeSession };
}
