import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import type {
  Agent,
  ExecutionSelection,
  AgentFileSearchItem,
  AppSnapshot,
  BackendCapabilities,
  BackendModelOption,
  BackendPluginSummary,
  BackendSkillSummary,
  MainToRendererEvent,
  ReasoningEffort,
  RendererSendPromptOptions,
} from '@workspace/core/contracts';
import { computed, reactive, ref } from 'vue';
import { AsyncCatalogCache, type AsyncCatalogEntry, type AsyncCatalogStatus } from './async-catalog-cache';
import { appApi } from './platform-api';

export type AgentComposerConfiguration = {
  backend: Agent['backend'] | undefined;
  selectionSource: string;
  models: BackendModelOption[];
  modelStatus: AsyncCatalogStatus;
  modelError: string | null;
  skills: BackendSkillSummary[];
  plugins: BackendPluginSummary[];
  skillStatus: AsyncCatalogStatus;
  skillError: string | null;
  files: AgentFileSearchItem[];
  fileStatus: AsyncCatalogStatus;
  fileError: string | null;
  selectedModelId: string | null;
  selectedReasoningEffort: ReasoningEffort | null;
  selectedServiceTier: string | null;
  planMode: boolean;
  pendingSelection: ExecutionSelection | null;
};

type ComposerMainEvent = Extract<
  MainToRendererEvent,
  { type: 'models.changed' | 'skills.changed' | 'conversation.modeUpdated' | 'conversation.settingsUpdated' }
>;
type ComposerModeEvent = Extract<ComposerMainEvent, { type: 'conversation.modeUpdated' | 'conversation.settingsUpdated' }>;

export function createAgentComposerState(options: {
  getSnapshot: () => AppSnapshot;
  persistSelection?: (agentId: string, selection: ExecutionSelection) => Promise<void>;
  onSelectionSaveError?: (error: unknown) => void;
}) {
  const backendModels = ref<BackendModelOption[]>([]);
  const modelCatalogStatus = ref<AsyncCatalogStatus>('notLoaded');
  const modelCatalogError = ref<string | null>(null);
  const backendSkills = ref<BackendSkillSummary[]>([]);
  const backendPlugins = ref<BackendPluginSummary[]>([]);
  const skillCatalogStatus = ref<AsyncCatalogStatus>('notLoaded');
  const skillCatalogError = ref<string | null>(null);
  const agentFiles = ref<AgentFileSearchItem[]>([]);
  const fileCatalogStatus = ref<AsyncCatalogStatus>('notLoaded');
  const fileCatalogError = ref<string | null>(null);
  const selectedModelId = ref<string | null>(null);
  const selectedReasoningEffort = ref<ReasoningEffort | null>(null);
  const selectedServiceTier = ref<string | null>(null);
  const planMode = ref(false);
  const selectedModel = computed(() => (
    backendModels.value.find((model) => model.id === selectedModelId.value) ?? null
  ));

  const loadsByAgentId = new Map<string, Promise<void>>();
  const modelCache = new AsyncCatalogCache<string, BackendModelOption>((value) => ({ ...value }));
  const skillCache = new AsyncCatalogCache<string, BackendSkillSummary>((value) => ({ ...value }));
  const pluginCache = new AsyncCatalogCache<string, BackendPluginSummary>((value) => ({ ...value }));
  const fileCache = new AsyncCatalogCache<string, AgentFileSearchItem>((value) => ({ ...value }));
  const configurationByAgentId = reactive(new Map<string, AgentComposerConfiguration>());
  const selectionSavesByAgentId = new Map<string, Promise<void>>();
  let catalogSessionSource: unknown = null;

  function snapshot(): AppSnapshot {
    return options.getSnapshot();
  }

  function configuration(agentId: string): AgentComposerConfiguration {
    const existing = configurationByAgentId.get(agentId);
    const agent = snapshot().agents.find((candidate) => candidate.id === agentId);
    if (existing) {
      if (agent) synchronizeSelectionWithAgent(existing, agent);
      return existing;
    }
    const selection = selectionFromAgent(agent);
    const created: AgentComposerConfiguration = {
      backend: agent?.backend,
      selectionSource: selection.source,
      models: [],
      modelStatus: 'notLoaded',
      modelError: null,
      skills: [],
      plugins: [],
      skillStatus: 'notLoaded',
      skillError: null,
      files: [],
      fileStatus: 'notLoaded',
      fileError: null,
      selectedModelId: selection.model,
      selectedReasoningEffort: selection.reasoningEffort,
      selectedServiceTier: selection.serviceTier,
      planMode: false,
      pendingSelection: null,
    };
    configurationByAgentId.set(agentId, created);
    return created;
  }

  function rememberActive(): void {
    const agentId = snapshot().activeAgentId;
    if (!agentId) return;
    Object.assign(configuration(agentId), {
      models: backendModels.value,
      modelStatus: modelCatalogStatus.value,
      modelError: modelCatalogError.value,
      skills: backendSkills.value,
      plugins: backendPlugins.value,
      skillStatus: skillCatalogStatus.value,
      skillError: skillCatalogError.value,
      files: agentFiles.value,
      fileStatus: fileCatalogStatus.value,
      fileError: fileCatalogError.value,
      selectedModelId: selectedModelId.value,
      selectedReasoningEffort: selectedReasoningEffort.value,
      selectedServiceTier: selectedServiceTier.value,
      planMode: planMode.value,
    });
  }

  function restore(agentId: string): void {
    const current = configuration(agentId);
    backendModels.value = current.models;
    modelCatalogStatus.value = current.modelStatus;
    modelCatalogError.value = current.modelError;
    backendSkills.value = current.skills;
    backendPlugins.value = current.plugins;
    skillCatalogStatus.value = current.skillStatus;
    skillCatalogError.value = current.skillError;
    agentFiles.value = current.files;
    fileCatalogStatus.value = current.fileStatus;
    fileCatalogError.value = current.fileError;
    selectedModelId.value = current.selectedModelId;
    selectedReasoningEffort.value = current.selectedReasoningEffort;
    selectedServiceTier.value = current.selectedServiceTier;
    planMode.value = current.planMode;
  }

  function clearActive(): void {
    backendModels.value = [];
    modelCatalogStatus.value = 'notLoaded';
    modelCatalogError.value = null;
    backendSkills.value = [];
    backendPlugins.value = [];
    skillCatalogStatus.value = 'notLoaded';
    skillCatalogError.value = null;
    agentFiles.value = [];
    fileCatalogStatus.value = 'notLoaded';
    fileCatalogError.value = null;
    selectedModelId.value = null;
    selectedReasoningEffort.value = null;
    selectedServiceTier.value = null;
    planMode.value = false;
  }

  function resetIfSourceChanged(source: unknown): void {
    if (catalogSessionSource === null || catalogSessionSource === source) {
      catalogSessionSource = source;
      return;
    }
    catalogSessionSource = source;
    modelCache.clear();
    skillCache.clear();
    pluginCache.clear();
    fileCache.clear();
    configurationByAgentId.clear();
    selectionSavesByAgentId.clear();
    clearActive();
  }

  function selectModel(modelId: string): void {
    const model = backendModels.value.find((candidate) => candidate.id === modelId);
    if (!model) return;
    selectedModelId.value = model.id;
    selectedReasoningEffort.value = defaultReasoningEffort(model);
    selectedServiceTier.value = defaultServiceTier(model);
    rememberSelection();
  }

  function selectModelForAgent(agentId: string, modelId: string): void {
    if (agentId === snapshot().activeAgentId) return selectModel(modelId);
    const current = configuration(agentId);
    const model = current.models.find((candidate) => candidate.id === modelId);
    if (!model) return;
    current.selectedModelId = model.id;
    current.selectedReasoningEffort = defaultReasoningEffort(model);
    current.selectedServiceTier = defaultServiceTier(model);
    rememberSelectionForAgent(agentId, model, current.selectedReasoningEffort, current.selectedServiceTier);
  }

  function selectReasoningEffort(reasoningEffort: ReasoningEffort): void {
    const model = selectedModel.value;
    if (!model?.supportedReasoningEfforts?.some((option) => option.reasoningEffort === reasoningEffort)) return;
    selectedReasoningEffort.value = reasoningEffort;
    rememberSelection();
  }

  function selectReasoningEffortForAgent(agentId: string, reasoningEffort: ReasoningEffort): void {
    if (agentId === snapshot().activeAgentId) return selectReasoningEffort(reasoningEffort);
    const current = configuration(agentId);
    const model = current.models.find((candidate) => candidate.id === current.selectedModelId);
    if (!model?.supportedReasoningEfforts?.some((option) => option.reasoningEffort === reasoningEffort)) return;
    current.selectedReasoningEffort = reasoningEffort;
    rememberSelectionForAgent(agentId, model, reasoningEffort, current.selectedServiceTier);
  }

  function selectServiceTier(serviceTier: string | null): void {
    const model = selectedModel.value;
    if (!model || (serviceTier !== null && !model.serviceTiers?.some((tier) => tier.id === serviceTier))) return;
    selectedServiceTier.value = serviceTier;
    rememberSelection();
  }

  function selectServiceTierForAgent(agentId: string, serviceTier: string | null): void {
    if (agentId === snapshot().activeAgentId) return selectServiceTier(serviceTier);
    const current = configuration(agentId);
    const model = current.models.find((candidate) => candidate.id === current.selectedModelId);
    if (!model || (serviceTier !== null && !model.serviceTiers?.some((tier) => tier.id === serviceTier))) return;
    current.selectedServiceTier = serviceTier;
    rememberSelectionForAgent(agentId, model, current.selectedReasoningEffort, serviceTier);
  }

  function rememberSelection(): void {
    const agentId = snapshot().activeAgentId;
    const agent = snapshot().agents.find((candidate) => candidate.id === agentId);
    if (!agentId || !agent || !selectedModel.value) return;
    rememberActive();
    rememberSelectionForAgent(agentId, selectedModel.value, selectedReasoningEffort.value, selectedServiceTier.value);
  }

  function rememberSelectionForAgent(agentId: string, model: BackendModelOption, reasoningEffort: ReasoningEffort | null, serviceTier: string | null): void {
    const agent = snapshot().agents.find((candidate) => candidate.id === agentId);
    if (!agent) return;
    const backend = agent.backend;
    const selection: ExecutionSelection = { backend, model: model.model, reasoningEffort, serviceTier };
    configuration(agentId).pendingSelection = selection;
    if (!options.persistSelection) return;
    const previous = selectionSavesByAgentId.get(agentId) ?? Promise.resolve();
    const save = previous.then(() => {
      if (snapshot().agents.find((candidate) => candidate.id === agentId)?.backend !== backend) return;
      return options.persistSelection!(agentId, selection);
    }).then(() => {
      const current = configurationByAgentId.get(agentId);
      if (current && sameSelection(current.pendingSelection, selection)) {
        current.pendingSelection = null;
        const savedAgent = snapshot().agents.find((candidate) => candidate.id === agentId);
        if (savedAgent) synchronizeSelectionWithAgent(current, savedAgent);
      }
    }).catch((error: unknown) => {
      options.onSelectionSaveError?.(error);
    });
    selectionSavesByAgentId.set(agentId, save);
    void save.finally(() => {
      if (selectionSavesByAgentId.get(agentId) === save) selectionSavesByAgentId.delete(agentId);
    });
  }

  function setPlanMode(enabled: boolean): void {
    planMode.value = enabled;
    rememberActive();
  }

  function setPlanModeForAgent(agentId: string, enabled: boolean): void {
    if (agentId === snapshot().activeAgentId) return setPlanMode(enabled);
    configuration(agentId).planMode = enabled;
  }

  async function loadActive(agentId = snapshot().activeAgentId): Promise<void> {
    if (!agentId || snapshot().agents.find(agent => agent.id === agentId)?.sharedConversation) return;
    const key = `${agentId}:${snapshot().agents.find(agent => agent.id === agentId)?.backend}`;
    const existing = loadsByAgentId.get(key);
    if (existing) return existing;
    const load = Promise.all([
      loadModels(agentId),
      loadPlugins(agentId),
      loadSkills(agentId),
      loadFiles(agentId),
    ]).then(() => undefined).finally(() => {
      if (loadsByAgentId.get(key) === load) loadsByAgentId.delete(key);
    });
    loadsByAgentId.set(key, load);
    await load;
  }

  async function loadAll(): Promise<void> {
    await Promise.all(snapshot().agents.map((agent) => loadActive(agent.id)));
    const activeAgentId = snapshot().activeAgentId;
    if (activeAgentId) restore(activeAgentId);
  }

  async function loadModels(agentId = snapshot().activeAgentId): Promise<void> {
    if (agentId === snapshot().activeAgentId) rememberActive();
    const source = appApi;
    const agent = agentId ? snapshot().agents.find((candidate) => candidate.id === agentId) : null;
    const initial = agentId ? configuration(agentId) : null;
    if (!agent || !source?.listBackendModels) {
      if (initial) {
        initial.models = [];
        initial.modelStatus = 'notLoaded';
        if (agentId === snapshot().activeAgentId) restore(agentId!);
      }
      return;
    }
    const current = configuration(agent.id);
    if (current.modelStatus === 'loading' || (agent.id === snapshot().activeAgentId && modelCatalogStatus.value === 'loading')) return;
    await loadCatalog({
      agentId: agent.id,
      cache: modelCache,
      key: modelKey(agent),
      session: source,
      source: source.listBackendModels,
      load: () => source.listBackendModels!(agent.id),
      sync: syncModels,
    });
  }

  async function loadSkills(agentId = snapshot().activeAgentId): Promise<void> {
    if (agentId === snapshot().activeAgentId) rememberActive();
    const source = appApi;
    const agent = agentId ? snapshot().agents.find((candidate) => candidate.id === agentId) : null;
    const initial = agentId ? configuration(agentId) : null;
    if (!agent || !source?.listBackendSkills) {
      if (initial) {
        initial.skills = [];
        initial.skillStatus = 'notLoaded';
        if (agentId === snapshot().activeAgentId) restore(agentId!);
      }
      return;
    }
    if (configuration(agent.id).skillStatus === 'loading') return;
    await loadCatalog({
      agentId: agent.id,
      cache: skillCache,
      key: catalogKey(agent),
      session: source,
      source: source.listBackendSkills,
      load: () => source.listBackendSkills!(agent.id),
      sync: syncSkills,
    });
  }

  async function loadPlugins(agentId = snapshot().activeAgentId): Promise<void> {
    if (agentId === snapshot().activeAgentId) rememberActive();
    const source = appApi;
    const agent = agentId ? snapshot().agents.find((candidate) => candidate.id === agentId) : null;
    const initial = agentId ? configuration(agentId) : null;
    if (!agent || !source?.listBackendPlugins || !capabilitiesForAgent(agent).plugins) {
      if (initial) {
        initial.plugins = [];
        if (agentId === snapshot().activeAgentId) restore(agentId!);
      }
      return;
    }
    await loadCatalog({
      agentId: agent.id,
      cache: pluginCache,
      key: catalogKey(agent),
      session: source,
      source: source.listBackendPlugins,
      load: () => source.listBackendPlugins!(agent.id),
      sync: syncPlugins,
    });
  }

  async function loadFiles(agentId = snapshot().activeAgentId): Promise<void> {
    if (agentId === snapshot().activeAgentId) rememberActive();
    const source = appApi;
    const agent = agentId ? snapshot().agents.find((candidate) => candidate.id === agentId) : null;
    const initial = agentId ? configuration(agentId) : null;
    if (!agent || !agent.folder || !source?.listAgentFiles) {
      if (initial) {
        initial.files = [];
        initial.fileStatus = agent && !agent.folder ? 'loaded' : 'notLoaded';
        if (agentId === snapshot().activeAgentId) restore(agentId!);
      }
      return;
    }
    if (configuration(agent.id).fileStatus === 'loading') return;
    await loadCatalog({
      agentId: agent.id,
      cache: fileCache,
      key: catalogKey(agent),
      session: source,
      source: source.listAgentFiles,
      load: () => source.listAgentFiles!(agent.id),
      sync: syncFiles,
    });
  }

  function resolvePromptOptions(
    agentId: string,
    prompt: string,
    submissionOptions?: RendererSendPromptOptions,
  ): RendererSendPromptOptions | undefined {
    const selectedOptions = promptOptions(agentId);
    const attachments = submissionOptions?.attachments?.length ? [...submissionOptions.attachments] : undefined;
    if (!selectedOptions && !submissionOptions) return undefined;
    return {
      ...selectedOptions,
      ...submissionOptions,
      ...(attachments ? { attachments } : {}),
    };
  }

  function handleMainEvent(event: ComposerMainEvent): void {
    switch (event.type) {
      case 'models.changed':
        applyModelsChanged(event);
        return;
      case 'skills.changed':
        applySkillsChanged(event);
        return;
      case 'conversation.modeUpdated':
      case 'conversation.settingsUpdated':
        syncMode(event);
        return;
      default: {
        const exhaustive: never = event;
        void exhaustive;
      }
    }
  }

  function synchronizeAgentSelection(agentId: string | undefined): void {
    if (!agentId || !configurationByAgentId.has(agentId)) return;
    const agent = snapshot().agents.find((candidate) => candidate.id === agentId);
    if (!agent) return;
    synchronizeSelectionWithAgent(configurationByAgentId.get(agentId)!, agent);
    if (agentId === snapshot().activeAgentId) restore(agentId);
  }

  function syncModels(agentId: string, cache: AsyncCatalogEntry<BackendModelOption>): void {
    const current = configuration(agentId);
    current.models = cache.value;
    current.modelStatus = cache.status;
    current.modelError = cache.error;
    if (cache.status === 'loaded') selectDefaultModel(current);
  }

  function syncSkills(agentId: string, cache: AsyncCatalogEntry<BackendSkillSummary>): void {
    const current = configuration(agentId);
    current.skills = cache.value;
    current.skillStatus = cache.status;
    current.skillError = cache.error;
  }

  function syncPlugins(agentId: string, cache: AsyncCatalogEntry<BackendPluginSummary>): void {
    configuration(agentId).plugins = cache.value;
  }

  function syncFiles(agentId: string, cache: AsyncCatalogEntry<AgentFileSearchItem>): void {
    const current = configuration(agentId);
    current.files = cache.value;
    current.fileStatus = cache.status;
    current.fileError = cache.error;
  }

  async function loadCatalog<Key, Value>(catalog: {
    agentId: string;
    cache: AsyncCatalogCache<Key, Value>;
    key: Key;
    session: unknown;
    source: unknown;
    load: () => Promise<Value[]>;
    sync: (agentId: string, entry: AsyncCatalogEntry<Value>) => void;
  }): Promise<void> {
    const backend = snapshot().agents.find(agent => agent.id === catalog.agentId)?.backend;
    const entry = catalog.cache.load(catalog.key, catalog.source, catalog.load);
    catalog.sync(catalog.agentId, entry);
    if (catalog.agentId === snapshot().activeAgentId) restore(catalog.agentId);
    await entry.promise;
    if (catalog.session !== appApi || snapshot().agents.find(agent => agent.id === catalog.agentId)?.backend !== backend) return;
    catalog.sync(catalog.agentId, entry);
    if (catalog.agentId === snapshot().activeAgentId) restore(catalog.agentId);
  }

  function applySkillsChanged(event: Extract<ComposerMainEvent, { type: 'skills.changed' }>): void {
    const cwd = event.payload.cwd;
    const skills = event.payload.skills.map((skill) => ({ ...skill }));
    const agents = snapshot().agents.filter((agent) => (
      agent.backend === event.backend &&
      (event.agentId === agent.id || (!event.agentId && !connectionId(agent) && agent.folder === cwd))
    ));
    for (const agent of agents) {
      const cache = skillCache.entry(catalogKey(agent));
      if (cache.status === 'loaded' && sameBackendSkills(cache.value, skills)) continue;
      skillCache.replace(catalogKey(agent), skills);
      syncSkills(agent.id, cache);
      if (agent.id === snapshot().activeAgentId) restore(agent.id);
    }
  }

  function applyModelsChanged(event: Extract<ComposerMainEvent, { type: 'models.changed' }>): void {
    const models = event.payload.models.map((model) => ({ ...model }));
    const owner = event.agentId ? snapshot().agents.find((agent) => agent.id === event.agentId) : undefined;
    if (event.agentId && !owner) return;
    const key = owner ? modelKey(owner) : JSON.stringify([event.backend, 'local']);
    const cache = modelCache.entry(key);
    if (cache.status === 'loaded' && JSON.stringify(cache.value) === JSON.stringify(models)) return;
    modelCache.replace(key, models);
    for (const agent of snapshot().agents) {
      if (modelKey(agent) !== key) continue;
      syncModels(agent.id, cache);
      if (agent.id === snapshot().activeAgentId) restore(agent.id);
    }
  }

  function connectionId(agent: Agent): string | undefined {
    return agent.remoteConnectionId;
  }

  function modelKey(agent: Agent): string {
    return JSON.stringify([agent.backend, connectionId(agent) ?? 'local']);
  }

  function catalogKey(agent: Agent): string {
    return JSON.stringify([modelKey(agent), agent.folder]);
  }

  function syncMode(event: ComposerModeEvent): void {
    if (event.type === 'conversation.settingsUpdated') {
      const agentId = event.agentId ?? snapshot().activeAgentId;
      const settings = event.payload.settings;
      if (!agentId) return;
      const current = configuration(agentId);
      const agent = snapshot().agents.find((candidate) => candidate.id === agentId);
      if (!current.pendingSelection && agent?.backendDefaults?.userSelectedModel !== true) {
        if (settings.model !== undefined) {
          current.selectedModelId = current.models.find(model => modelMatchesSelection(model, settings.model ?? null))?.id ?? settings.model;
        }
        if (settings.reasoningEffort !== undefined) current.selectedReasoningEffort = settings.reasoningEffort;
        if ('serviceTier' in settings && settings.serviceTier !== undefined) {
          current.selectedServiceTier = settings.serviceTier;
        }
      }
      if (agentId === snapshot().activeAgentId) restore(agentId);
      return;
    }
    const agentId = event.agentId ?? snapshot().activeAgentId;
    const mode = event.payload.mode;
    if (!agentId) return;
    configuration(agentId).planMode = mode === 'plan';
    if (agentId === snapshot().activeAgentId) restore(agentId);
  }

  function promptOptions(agentId: string): RendererSendPromptOptions | undefined {
    const isActiveAgent = agentId === snapshot().activeAgentId;
    const current = configuration(agentId);
    const models = isActiveAgent ? backendModels.value : current.models;
    const model = models.find((candidate) => candidate.id === (isActiveAgent ? selectedModelId.value : current.selectedModelId)) ?? null;
    const agent = snapshot().agents.find((candidate) => candidate.id === agentId) ?? null;
    const capabilities = capabilitiesForAgent(agent);
    const promptModel = capabilities.models ? model : null;
    const reasoningEffort = capabilities.reasoningEffort && promptModel
      ? (isActiveAgent ? selectedReasoningEffort.value : current.selectedReasoningEffort) ?? defaultReasoningEffort(promptModel)
      : null;
    const serviceTier = capabilities.serviceTier && promptModel?.serviceTiers?.length
      ? (isActiveAgent ? selectedServiceTier.value : current.selectedServiceTier)
      : undefined;
    if (
      !promptModel &&
      (capabilities.planMode === 'unsupported' || !(isActiveAgent ? planMode.value : current.planMode)) &&
      !reasoningEffort && serviceTier === undefined
    ) return undefined;
    return {
      ...((promptModel || reasoningEffort || serviceTier !== undefined) ? { selection: {
        ...(promptModel ? { model: promptModel.model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(serviceTier !== undefined ? { serviceTier } : {}),
      } } : {}),
      ...(capabilities.planMode === 'native' ? { planMode: isActiveAgent ? planMode.value : current.planMode } : {}),
      ...(capabilities.planMode === 'prompted' && (isActiveAgent ? planMode.value : current.planMode) ? { planMode: true } : {}),
    };
  }

  function capabilitiesForAgent(agent: Agent | null): BackendCapabilities {
    const backend = agent?.backend ?? 'codex';
    const runtime = snapshot().backendRuntimes.find((candidate) => candidate.backend === backend);
    return { ...defaultBackendCapabilities(backend), ...runtime?.capabilities };
  }

  return {
    agentFiles,
    backendModels,
    backendPlugins,
    backendSkills,
    clearActive,
    fileCatalogError,
    fileCatalogStatus,
    handleMainEvent,
    loadActive,
    loadAll,
    loadFiles,
    loadModels,
    loadPlugins,
    loadSkills,
    modelCatalogError,
    modelCatalogStatus,
    planMode,
    rememberActive,
    resetIfSourceChanged,
    resolvePromptOptions,
    restore,
    selectModel,
    selectModelForAgent,
    selectedModel,
    selectedModelId,
    selectedReasoningEffort,
    selectedServiceTier,
    selectReasoningEffort,
    selectReasoningEffortForAgent,
    selectServiceTier,
    selectServiceTierForAgent,
    setPlanMode,
    setPlanModeForAgent,
    configurationForAgent: configuration,
    skillCatalogError,
    skillCatalogStatus,
    synchronizeAgentSelection,
  };
}

function selectDefaultModel(configuration: AgentComposerConfiguration): void {
  const selected = configuration.models.find((model) => modelMatchesSelection(model, configuration.selectedModelId));
  if (selected) {
    configuration.selectedModelId = selected.id;
    if (
      configuration.selectedReasoningEffort &&
      !selected.supportedReasoningEfforts?.some((option) => option.reasoningEffort === configuration.selectedReasoningEffort)
    ) configuration.selectedReasoningEffort = defaultReasoningEffort(selected);
    return;
  }
  const fallback = configuration.models.find((model) => model.isDefault) ?? configuration.models[0] ?? null;
  configuration.selectedModelId = fallback?.id ?? null;
  configuration.selectedReasoningEffort = fallback ? defaultReasoningEffort(fallback) : null;
  configuration.selectedServiceTier = fallback ? defaultServiceTier(fallback) : null;
}

function selectionFromAgent(agent: Agent | undefined): ExecutionSelection & { source: string } {
  if (!agent) return { source: 'missing', backend: 'codex', model: null, reasoningEffort: null, serviceTier: null };
  const defaults = agent.backendDefaults?.kind === agent.backend ? agent.backendDefaults : undefined;
  const preferred = defaults?.userSelectedModel === true ? defaults : undefined;
  const claudeSession = agent.backendSession?.kind === 'claude' ? agent.backendSession : undefined;
  const model = preferred?.model ?? claudeSession?.model ?? defaults?.model ?? null;
  const reasoningEffort = preferred ? preferred.reasoningEffort ?? null : claudeSession?.reasoningEffort ?? defaults?.reasoningEffort ?? null;
  const serviceTier = defaults && defaults.kind !== 'antigravity' ? defaults.serviceTier ?? null : null;
  const sessionId = agent.backendSession?.kind === 'codex'
    ? agent.backendSession.threadId
    : agent.backendSession?.sessionId ?? 'new';
  return {
    backend: agent.backend, source: JSON.stringify([agent.backend, sessionId, model, reasoningEffort, serviceTier]),
    model,
    reasoningEffort,
    serviceTier,
  };
}

function synchronizeSelectionWithAgent(configuration: AgentComposerConfiguration, agent: Agent): void {
  const selection = selectionFromAgent(agent);
  if (configuration.backend !== agent.backend) configuration.pendingSelection = null;
  else if (configuration.pendingSelection) {
    if (agent.backendDefaults?.userSelectedModel !== true || !sameSelection(configuration.pendingSelection, selection)) return;
    configuration.pendingSelection = null;
  }
  if (configuration.selectionSource === selection.source) return;
  if (configuration.backend !== agent.backend) {
    configuration.models = [];
    configuration.modelStatus = 'notLoaded';
    configuration.modelError = null;
    configuration.skills = [];
    configuration.plugins = [];
    configuration.skillStatus = 'notLoaded';
    configuration.skillError = null;
    configuration.planMode = false;
  }
  configuration.backend = agent.backend;
  configuration.selectionSource = selection.source;
  configuration.selectedModelId = selection.model;
  configuration.selectedReasoningEffort = selection.reasoningEffort;
  configuration.selectedServiceTier = selection.serviceTier;
  if (configuration.modelStatus === 'loaded') selectDefaultModel(configuration);
}

function sameSelection(left: ExecutionSelection | null | undefined, right: ExecutionSelection | null | undefined): boolean {
  return Boolean(left && right && left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort && left.serviceTier === right.serviceTier);
}

function modelMatchesSelection(model: BackendModelOption, selection: string | null): boolean {
  return Boolean(selection && (
    model.id === selection || model.model === selection || model.providerMetadata?.resolvedModel === selection
  ));
}

function defaultReasoningEffort(model: BackendModelOption): ReasoningEffort | null {
  return model.defaultReasoningEffort || model.supportedReasoningEfforts?.[0]?.reasoningEffort || null;
}

function defaultServiceTier(model: BackendModelOption): string | null {
  return model.defaultServiceTier ?? null;
}

function sameBackendSkills(left: readonly BackendSkillSummary[], right: readonly BackendSkillSummary[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((skill, index) => {
    const other = right[index];
    return Boolean(other) &&
      skill.id === other.id &&
      skill.name === other.name &&
      skill.description === other.description &&
      skill.shortDescription === other.shortDescription &&
      skill.displayName === other.displayName &&
      skill.iconSmall === other.iconSmall &&
      skill.iconLarge === other.iconLarge &&
      skill.brandColor === other.brandColor &&
      skill.defaultPrompt === other.defaultPrompt &&
      skill.path === other.path &&
      skill.scope === other.scope &&
      skill.enabled === other.enabled;
  });
}
