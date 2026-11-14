import { defaultHarnessProvider, defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import type {
  Agent,
  ExecutionSelection,
  AgentFileSearchItem,
  AppSnapshot,
  ProviderCapabilities,
  ProviderModelOption,
  ProviderPluginSummary,
  ProviderSkillSummary,
  MainToRendererEvent,
  ReasoningEffort,
  RendererSendPromptOptions,
} from '@workspace/core/contracts';
import { computed, reactive, ref } from 'vue';
import { AsyncCatalogCache, type AsyncCatalogEntry, type AsyncCatalogStatus } from './async-catalog-cache';
import { appApi } from './platform-api';
import { projectSessionSelection } from './conversation-presentation/presentation';
import { sessionConversationId } from '@korus-dev/multi-agent-sdk/contracts';

export type AgentComposerConfiguration = {
  provider: Agent['provider'] | undefined;
  selectionSource: string;
  models: ProviderModelOption[];
  modelStatus: AsyncCatalogStatus;
  modelError: string | null;
  skills: ProviderSkillSummary[];
  plugins: ProviderPluginSummary[];
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
  const configurationByAgentId = reactive(new Map<string, AgentComposerConfiguration>());
  /** What the composer shows for the active agent: read from, and written to, that agent's configuration. */
  function activeField<K extends keyof AgentComposerConfiguration>(key: K, fallback: AgentComposerConfiguration[K]) {
    return computed({
      get: () => configurationByAgentId.get(snapshot().activeAgentId ?? '')?.[key] ?? fallback,
      set: (value) => {
        const agentId = snapshot().activeAgentId;
        if (agentId) configuration(agentId)[key] = value;
      },
    });
  }
  const providerModels = activeField('models', []);
  const modelCatalogStatus = activeField('modelStatus', 'notLoaded');
  const modelCatalogError = activeField('modelError', null);
  const providerSkills = activeField('skills', []);
  const providerPlugins = activeField('plugins', []);
  const skillCatalogStatus = activeField('skillStatus', 'notLoaded');
  const skillCatalogError = activeField('skillError', null);
  const agentFiles = activeField('files', []);
  const fileCatalogStatus = activeField('fileStatus', 'notLoaded');
  const fileCatalogError = activeField('fileError', null);
  const selectedModelId = activeField('selectedModelId', null);
  const selectedReasoningEffort = activeField('selectedReasoningEffort', null);
  const selectedServiceTier = activeField('selectedServiceTier', null);
  const planMode = activeField('planMode', false);
  const selectedModel = computed(() => (
    providerModels.value.find((model) => model.id === selectedModelId.value) ?? null
  ));

  const loadsByAgentId = new Map<string, Promise<void>>();
  const modelCache = new AsyncCatalogCache<string, ProviderModelOption>((value) => ({ ...value }));
  const skillCache = new AsyncCatalogCache<string, ProviderSkillSummary>((value) => ({ ...value }));
  const pluginCache = new AsyncCatalogCache<string, ProviderPluginSummary>((value) => ({ ...value }));
  const fileCache = new AsyncCatalogCache<string, AgentFileSearchItem>((value) => ({ ...value }));
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
      provider: agent?.provider,
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
  }

  function selectModel(modelId: string): void {
    const agentId = snapshot().activeAgentId;
    if (agentId) selectModelForAgent(agentId, modelId);
  }

  function selectModelForAgent(agentId: string, modelId: string): void {
    const current = configuration(agentId);
    const model = current.models.find((candidate) => candidate.id === modelId);
    if (!model) return;
    current.selectedModelId = model.id;
    current.selectedReasoningEffort = defaultReasoningEffort(model);
    current.selectedServiceTier = serviceTierForModel(model, current.selectedServiceTier);
    rememberSelectionForAgent(agentId, model, current.selectedReasoningEffort, current.selectedServiceTier);
  }

  function selectReasoningEffort(reasoningEffort: ReasoningEffort): void {
    const agentId = snapshot().activeAgentId;
    if (agentId) selectReasoningEffortForAgent(agentId, reasoningEffort);
  }

  function selectReasoningEffortForAgent(agentId: string, reasoningEffort: ReasoningEffort): void {
    const current = configuration(agentId);
    const model = current.models.find((candidate) => candidate.id === current.selectedModelId);
    if (!model?.supportedReasoningEfforts?.some((option) => option.reasoningEffort === reasoningEffort)) return;
    current.selectedReasoningEffort = reasoningEffort;
    rememberSelectionForAgent(agentId, model, reasoningEffort, current.selectedServiceTier);
  }

  function selectServiceTier(serviceTier: string | null): void {
    const agentId = snapshot().activeAgentId;
    if (agentId) selectServiceTierForAgent(agentId, serviceTier);
  }

  function selectServiceTierForAgent(agentId: string, serviceTier: string | null): void {
    const current = configuration(agentId);
    const model = current.models.find((candidate) => candidate.id === current.selectedModelId);
    if (!model || (serviceTier !== null && !model.serviceTiers?.some((tier) => tier.id === serviceTier))) return;
    current.selectedServiceTier = serviceTier;
    rememberSelectionForAgent(agentId, model, current.selectedReasoningEffort, serviceTier);
  }

  function rememberSelectionForAgent(agentId: string, model: ProviderModelOption, reasoningEffort: ReasoningEffort | null, serviceTier: string | null): void {
    const agent = snapshot().agents.find((candidate) => candidate.id === agentId);
    if (!agent) return;
    const provider = agent.provider;
    const selection: ExecutionSelection = { provider: provider, model: model.model, reasoningEffort, serviceTier };
    configuration(agentId).pendingSelection = selection;
    if (!options.persistSelection) return;
    const previous = selectionSavesByAgentId.get(agentId) ?? Promise.resolve();
    const save = previous.then(() => {
      if (snapshot().agents.find((candidate) => candidate.id === agentId)?.provider !== provider) return;
      return options.persistSelection!(agentId, selection);
    }).catch((error: unknown) => {
      options.onSelectionSaveError?.(error);
    });
    selectionSavesByAgentId.set(agentId, save);
    void save.finally(() => {
      if (selectionSavesByAgentId.get(agentId) === save) selectionSavesByAgentId.delete(agentId);
    });
  }

  function setPlanMode(enabled: boolean): void {
    const agentId = snapshot().activeAgentId;
    if (agentId) setPlanModeForAgent(agentId, enabled);
  }

  function setPlanModeForAgent(agentId: string, enabled: boolean): void {
    configuration(agentId).planMode = enabled;
  }

  async function loadActive(agentId = snapshot().activeAgentId): Promise<void> {
    if (!agentId || snapshot().agents.find(agent => agent.id === agentId)?.sharedConversation) return;
    const key = `${agentId}:${snapshot().agents.find(agent => agent.id === agentId)?.provider}`;
    const existing = loadsByAgentId.get(key);
    if (existing) return existing;
    const load = Promise.all([
      loadModels(agentId),
      loadPlugins(agentId),
      loadFiles(agentId),
    ]).then(() => undefined).finally(() => {
      if (loadsByAgentId.get(key) === load) loadsByAgentId.delete(key);
    });
    loadsByAgentId.set(key, load);
    await load;
  }

  async function loadAllModels(): Promise<void> {
    await Promise.all(snapshot().agents.map(agent => loadModels(agent.id)));
  }

  async function loadModels(agentId = snapshot().activeAgentId): Promise<void> {
    const source = appApi;
    const agent = agentId ? snapshot().agents.find((candidate) => candidate.id === agentId) : null;
    const initial = agentId ? configuration(agentId) : null;
    if (!agent || !source?.listProviderModels) {
      if (initial) {
        initial.models = [];
        initial.modelStatus = 'notLoaded';
      }
      return;
    }
    const current = configuration(agent.id);
    if (current.modelStatus === 'loading') return;
    await loadCatalog({
      agentId: agent.id,
      cache: modelCache,
      key: modelKey(agent),
      session: source,
      source: source.listProviderModels,
      load: () => source.listProviderModels!(agent.id),
      sync: syncModels,
    });
  }

  async function loadSkills(agentId = snapshot().activeAgentId): Promise<void> {
    const source = appApi;
    const agent = agentId ? snapshot().agents.find((candidate) => candidate.id === agentId) : null;
    const initial = agentId ? configuration(agentId) : null;
    if (!agent || !source?.listProviderSkills) {
      if (initial) {
        initial.skills = [];
        initial.skillStatus = 'notLoaded';
      }
      return;
    }
    if (configuration(agent.id).skillStatus === 'loading') return;
    await loadCatalog({
      agentId: agent.id,
      cache: skillCache,
      key: catalogKey(agent),
      session: source,
      source: source.listProviderSkills,
      load: () => source.listProviderSkills!(agent.id),
      sync: syncSkills,
    });
  }

  async function loadPlugins(agentId = snapshot().activeAgentId): Promise<void> {
    const source = appApi;
    const agent = agentId ? snapshot().agents.find((candidate) => candidate.id === agentId) : null;
    const initial = agentId ? configuration(agentId) : null;
    // Korus lists its own plugins for every harness, so this never waits for the harness to offer plugins.
    if (!agent || !source?.listProviderPlugins) {
      if (initial) {
        initial.plugins = [];
      }
      return;
    }
    await loadCatalog({
      agentId: agent.id,
      cache: pluginCache,
      key: catalogKey(agent),
      session: source,
      source: source.listProviderPlugins,
      load: () => source.listProviderPlugins!(agent.id),
      sync: syncPlugins,
    });
  }

  async function loadFiles(agentId = snapshot().activeAgentId, refresh = false): Promise<void> {
    const source = appApi;
    const agent = agentId ? snapshot().agents.find((candidate) => candidate.id === agentId) : null;
    const initial = agentId ? configuration(agentId) : null;
    if (!agent || !agent.folder || !source?.listAgentFiles) {
      if (initial) {
        initial.files = [];
        initial.fileStatus = agent && !agent.folder ? 'loaded' : 'notLoaded';
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
      refresh,
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
  }

  function syncModels(agentId: string, cache: AsyncCatalogEntry<ProviderModelOption>): void {
    const current = configuration(agentId);
    current.models = cache.value;
    current.modelStatus = cache.status;
    current.modelError = cache.error;
    if (cache.status === 'loaded') selectDefaultModel(current);
  }

  function syncSkills(agentId: string, cache: AsyncCatalogEntry<ProviderSkillSummary>): void {
    const current = configuration(agentId);
    current.skills = cache.value;
    current.skillStatus = cache.status;
    current.skillError = cache.error;
  }

  function syncPlugins(agentId: string, cache: AsyncCatalogEntry<ProviderPluginSummary>): void {
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
    /** Read the catalog again even if it is already loaded. */
    refresh?: boolean;
  }): Promise<void> {
    const backend = snapshot().agents.find(agent => agent.id === catalog.agentId)?.provider;
    const entry = catalog.refresh
      ? catalog.cache.refresh(catalog.key, catalog.source, catalog.load)
      : catalog.cache.load(catalog.key, catalog.source, catalog.load);
    catalog.sync(catalog.agentId, entry);
    await entry.promise;
    if (catalog.session !== appApi || snapshot().agents.find(agent => agent.id === catalog.agentId)?.provider !== backend) return;
    catalog.sync(catalog.agentId, entry);
  }

  function applySkillsChanged(event: Extract<ComposerMainEvent, { type: 'skills.changed' }>): void {
    const cwd = event.payload.cwd;
    const skills = event.payload.skills.map((skill) => ({ ...skill }));
    const agents = snapshot().agents.filter((agent) => (
      agent.provider === event.provider &&
      (event.agentId === agent.id || (!event.agentId && !connectionId(agent) && agent.folder === cwd))
    ));
    for (const agent of agents) {
      const cache = skillCache.entry(catalogKey(agent));
      if (cache.status === 'loaded' && sameProviderSkills(cache.value, skills)) continue;
      skillCache.replace(catalogKey(agent), skills);
      syncSkills(agent.id, cache);
    }
  }

  function applyModelsChanged(event: Extract<ComposerMainEvent, { type: 'models.changed' }>): void {
    const models = event.payload.models.map((model) => ({ ...model }));
    const owner = event.agentId ? snapshot().agents.find((agent) => agent.id === event.agentId) : undefined;
    if (event.agentId && !owner) return;
    const key = owner ? modelKey(owner) : JSON.stringify([event.provider, 'local']);
    const cache = modelCache.entry(key);
    if (cache.status === 'loaded' && JSON.stringify(cache.value) === JSON.stringify(models)) return;
    modelCache.replace(key, models);
    for (const agent of snapshot().agents) {
      if (modelKey(agent) !== key) continue;
      syncModels(agent.id, cache);
    }
  }

  function connectionId(agent: Agent): string | undefined {
    return agent.remoteConnectionId;
  }

  function modelKey(agent: Agent): string {
    return JSON.stringify([agent.provider, connectionId(agent) ?? 'local']);
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
      if (current.pendingSelection) {
        const pending = current.pendingSelection;
        // The conversation reports the model it runs, which the pending choice may name by an alias.
        const model = settings.model ? current.models.find(model => model.id === catalogModelId(current.models, settings.model!, current.selectedModelId)) : undefined;
        if ((model?.model ?? settings.model) !== pending.model
          || (settings.reasoningEffort ?? null) !== pending.reasoningEffort
          || (settings.serviceTier ?? null) !== pending.serviceTier) return;
        current.pendingSelection = null;
      }
      if (settings.model !== undefined) {
        current.selectedModelId = settings.model === null ? null : catalogModelId(current.models, settings.model, current.selectedModelId);
      }
      if (settings.reasoningEffort !== undefined) current.selectedReasoningEffort = settings.reasoningEffort;
      if (settings.serviceTier !== undefined) current.selectedServiceTier = settings.serviceTier;
      return;
    }
    const agentId = event.agentId ?? snapshot().activeAgentId;
    const mode = event.payload.mode;
    if (!agentId) return;
    syncPlanMode(agentId, mode === 'plan');
  }

  function syncPlanMode(agentId: string, enabled: boolean): void {
    configuration(agentId).planMode = enabled;
  }

  function promptOptions(agentId: string): RendererSendPromptOptions | undefined {
    const current = configuration(agentId);
    const model = current.models.find((candidate) => candidate.id === current.selectedModelId) ?? null;
    const agent = snapshot().agents.find((candidate) => candidate.id === agentId) ?? null;
    const capabilities = capabilitiesForAgent(agent);
    const promptModel = capabilities.models ? model : null;
    const reasoningEffort = capabilities.reasoningEffort && promptModel
      ? current.selectedReasoningEffort ?? defaultReasoningEffort(promptModel)
      : null;
    const serviceTier = capabilities.serviceTier && promptModel?.serviceTiers?.length
      ? current.selectedServiceTier
      : undefined;
    if (
      !promptModel &&
      (capabilities.planMode === 'unsupported' || !current.planMode) &&
      !reasoningEffort && serviceTier === undefined
    ) return undefined;
    return {
      ...((promptModel || reasoningEffort || serviceTier !== undefined) ? { selection: {
        ...(promptModel ? { model: promptModel.model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(serviceTier !== undefined ? { serviceTier } : {}),
      } } : {}),
      ...(capabilities.planMode === 'native' ? { planMode: current.planMode } : {}),
      ...(capabilities.planMode === 'prompted' && current.planMode ? { planMode: true } : {}),
    };
  }

  function capabilitiesForAgent(agent: Agent | null): ProviderCapabilities {
    const backend = agent?.provider ?? defaultHarnessProvider;
    const runtime = snapshot().providerRuntimes.find((candidate) => candidate.provider === backend);
    return { ...defaultProviderCapabilities(backend), ...runtime?.capabilities };
  }

  return {
    agentFiles,
    providerModels,
    providerPlugins,
    providerSkills,
    fileCatalogError,
    fileCatalogStatus,
    handleMainEvent,
    loadActive,
    loadAllModels,
    loadFiles,
    loadModels,
    loadPlugins,
    loadSkills,
    modelCatalogError,
    modelCatalogStatus,
    planMode,
    resetIfSourceChanged,
    resolvePromptOptions,
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
    syncPlanMode,
    configurationForAgent: configuration,
    skillCatalogError,
    skillCatalogStatus,
    synchronizeAgentSelection,
  };
}

function selectDefaultModel(configuration: AgentComposerConfiguration): void {
  const selected = namedModel(configuration.models, configuration.selectedModelId);
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
  if (!agent) return { source: 'missing', provider: defaultHarnessProvider, model: null, reasoningEffort: null, serviceTier: null };
  const defaults = agent.providerDefaults?.kind === agent.provider ? agent.providerDefaults : undefined;
  const native = projectSessionSelection(agent.providerSession);
  const model = native?.model ?? defaults?.model ?? null;
  const reasoningEffort = native ? native.reasoningEffort ?? null : defaults?.reasoningEffort ?? null;
  const serviceTier = defaults && 'serviceTier' in defaults ? defaults.serviceTier ?? null : null;
  const sessionId = agent.providerSession ? sessionConversationId(agent.providerSession) : 'new';
  return {
    provider: agent.provider, source: JSON.stringify([agent.provider, sessionId, model, reasoningEffort, serviceTier]),
    model,
    reasoningEffort,
    serviceTier,
  };
}

function synchronizeSelectionWithAgent(configuration: AgentComposerConfiguration, agent: Agent): void {
  const selection = selectionFromAgent(agent);
  if (configuration.provider !== agent.provider) configuration.pendingSelection = null;
  else if (configuration.pendingSelection) return;
  if (configuration.selectionSource === selection.source) return;
  if (configuration.provider !== agent.provider) {
    configuration.models = [];
    configuration.modelStatus = 'notLoaded';
    configuration.modelError = null;
    configuration.skills = [];
    configuration.plugins = [];
    configuration.skillStatus = 'notLoaded';
    configuration.skillError = null;
    configuration.planMode = false;
  }
  configuration.provider = agent.provider;
  configuration.selectionSource = selection.source;
  configuration.selectedModelId = selection.model;
  configuration.selectedReasoningEffort = selection.reasoningEffort;
  configuration.selectedServiceTier = selection.serviceTier;
  if (configuration.modelStatus === 'loaded') selectDefaultModel(configuration);
}

/**
 * The catalog entry to show for the model a conversation reports. Several entries can resolve to the same model
 * (Claude's "default" and "sonnet"), so the entry already chosen is kept when it names that model.
 */
export function catalogModelId(models: readonly ProviderModelOption[], reported: string, chosenId: string | null): string {
  const chosen = models.find(model => model.id === chosenId);
  if (chosen && modelMatchesSelection(chosen, reported)) return chosen.id;
  return namedModel(models, reported)?.id ?? reported;
}

/**
 * The catalog entry a model name means: the entry with that id, else one that resolves to it. A name is a specific
 * model, so the provider's "default" entry is taken only when nothing else resolves to it.
 */
function namedModel(models: readonly ProviderModelOption[], name: string | null): ProviderModelOption | undefined {
  const matches = models.filter(model => modelMatchesSelection(model, name));
  return matches.find(model => model.id === name) ?? matches.find(model => !model.isDefault) ?? matches[0];
}

function modelMatchesSelection(model: ProviderModelOption, selection: string | null): boolean {
  return Boolean(selection && (
    model.id === selection || model.model === selection || model.providerMetadata?.resolvedModel === selection
  ));
}

function defaultReasoningEffort(model: ProviderModelOption): ReasoningEffort | null {
  return model.defaultReasoningEffort || model.supportedReasoningEfforts?.[0]?.reasoningEffort || null;
}

function serviceTierForModel(model: ProviderModelOption, serviceTier: string | null): string | null {
  return serviceTier === null || model.serviceTiers?.some((tier) => tier.id === serviceTier)
    ? serviceTier
    : defaultServiceTier(model);
}

function defaultServiceTier(model: ProviderModelOption): string | null {
  return model.defaultServiceTier ?? null;
}

function sameProviderSkills(left: readonly ProviderSkillSummary[], right: readonly ProviderSkillSummary[]): boolean {
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
