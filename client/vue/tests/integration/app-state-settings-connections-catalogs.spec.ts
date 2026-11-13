import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { UserText, createConversationPaneController } from '@korus-dev/agent-ui-sdk';
import ConversationPane from '../../src/components/ConversationPane.vue';
import { agentConversationState } from '../../src/components/use-agent-conversation';
import { useAppState } from '../../src/app-state';
import { createAgentComposerState } from '../../src/agent-composer-state';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, ProviderApprovalRequest, ProviderConversationRef, AppApi, ConversationSummary, DevicePairingSession, MainToRendererEvent, RendererMessage, SourceRepository, UpdateAgentInput, WorkItem, WorkSource } from '@workspace/core/contracts';
import { updateAgentFromInput } from '@workspace/core/agent-manager';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import { workItemAssignmentPrompt } from '@workspace/core/work-item-prompts';
import { clearConfetti, useConfetti } from '../../src/shared/confetti/use-confetti';
import { stubElectronTestWindow } from '../support/client';
import { configureAppClient } from '../../src/platform-api';
import { sessionSnapshotEvent, sessionState } from '../support/conversation-fixtures';
import { clearFirstRunOnboardingStage, setFirstRunOnboardingStage } from '../../src/onboarding-session';
describe('useAppState', () => {
  it('loads workspace files only for the opened agent and leaves skills unloaded on selection', async () => {
    const snapshot = createInitialSnapshot();
    const template = snapshot.agents[0]!;
    snapshot.agents = Array.from({ length: 24 }, (_, index) => ({ ...template, id: `catalog-agent-${index}`, folder: `/repo/${index}`, providerSession: undefined }));
    snapshot.agents[1]!.provider = 'antigravity';
    snapshot.agents[1]!.providerDefaults = { kind: 'antigravity' };
    snapshot.activeAgentId = snapshot.agents[0]!.id;
    snapshot.teams = [{ ...snapshot.teams[0]!, agentIds: snapshot.agents.map(agent => agent.id), activeAgentId: snapshot.activeAgentId }];
    snapshot.activeTeamId = snapshot.teams[0]!.id;
    const listAgentFiles = vi.fn(async (_agentId: string) => []);
    const listProviderSkills = vi.fn(async () => []);
    stubElectronTestWindow({ app: { getSnapshot: async () => snapshot, listAgentFiles, listProviderSkills,
      selectAgent: async agentId => ({ ...snapshot, activeAgentId: agentId,
        teams: [{ ...snapshot.teams[0]!, activeAgentId: agentId }] }) } satisfies Partial<AppApi> });
    const state = useAppState();
    await state.loadSnapshot();
    expect(listAgentFiles.mock.calls.map(([agentId]) => agentId)).toStrictEqual(['catalog-agent-0']);
    await state.selectAgent('catalog-agent-1');
    expect(listAgentFiles.mock.calls.map(([agentId]) => agentId)).toStrictEqual(['catalog-agent-0', 'catalog-agent-1']);
    expect(listProviderSkills).not.toHaveBeenCalled();
    // App-owned skills are available even without native provider skill support.
    await state.loadProviderSkills('catalog-agent-1');
    await vi.waitFor(() => expect(listProviderSkills).toHaveBeenCalledWith('catalog-agent-1'));
  });
  afterEach(() => {
    clearConfetti();
    clearFirstRunOnboardingStage();
    vi.useRealTimers();
  });

  it('reloads a background agent catalog after a provider switch without changing the active agent', async () => {
    let remote = createInitialSnapshot();
    const hostId = remote.agents[0]!.id;
    const guestId = remote.agents[1]!.id;
    const listProviderModels = vi.fn(async (id: string) => {
      const backend = remote.agents.find(agent => agent.id === id)!.provider;
      return [{ id: `${backend}-model`, model: `${backend}-model`, displayName: backend, isDefault: true }];
    });
    stubElectronTestWindow({ app: {
      getSnapshot: async () => structuredClone(remote),
      listProviderModels,
      updateAgent: async input => {
        remote = { ...remote, agents: remote.agents.map(agent => agent.id === input.id ? { ...agent, provider: input.selection?.provider! } : agent) };
        return structuredClone(remote);
      },
    } satisfies Partial<AppApi> });
    const state = useAppState();
    await state.loadSnapshot();
    await state.prepareAgentConversation(guestId);
    expect(state.agentConversationFor(guestId)?.composer.models[0]?.id).toBe('codex-model');
    await state.updateAgent({ id: guestId, selection: { provider: 'claude' } });
    expect(state.agentConversationFor(guestId)?.composer.models[0]?.id).toBe('claude-model');
    expect(state.agentConversationFor(hostId)?.composer.models[0]?.id).toBe('codex-model');
    expect(state.snapshot.value.activeAgentId).toBe(hostId);
  });

  it('updates settings and forwards app quit and restart through the preload bridge', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    updatedSnapshot.theme = {
      ...updatedSnapshot.theme,
      id: 'github-dark',
      mode: 'dark',
    };
    let resolveUpdateSettings: (snapshot: ReturnType<typeof createInitialSnapshot>) => void = () => undefined;
    const updateSettings = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveUpdateSettings = resolve;
    }));
    const quit = vi.fn().mockResolvedValue(undefined);
    const restartApp = vi.fn().mockResolvedValue(undefined);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        updateSettings,
        quit,
        restartApp,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    const updatePromise = state.updateSettings({ theme: { id: 'github-dark', mode: 'dark' } });

    expect(state.snapshot.value.theme.id).toBe(remoteSnapshot.theme.id);
    expect(state.snapshot.value.theme.mode).toBe(remoteSnapshot.theme.mode);

    resolveUpdateSettings(updatedSnapshot);
    await updatePromise;
    await state.quit();
    await state.restartApp();

    expect(updateSettings).toHaveBeenCalledWith({ theme: { id: 'github-dark', mode: 'dark' } });
    expect(state.snapshot.value.theme.id).toBe('github-dark');
    expect(quit).toHaveBeenCalledOnce();
    expect(restartApp).toHaveBeenCalledOnce();
  });

  it('adopts the resource sharing result from the preload bridge', async () => {
    const updatedSnapshot = createInitialSnapshot();
    updatedSnapshot.general.providerHomes = { codex: { isolated: true, shareSkills: false, homePath: "/app/codex-home" } };
    const setCodexResourceSharing = vi.fn().mockResolvedValue(updatedSnapshot);
    const reloadRenderer = vi.fn().mockResolvedValue(undefined);
    stubElectronTestWindow({
      app: {
        setCodexResourceSharing,
        reloadRenderer,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();

    await state.setCodexResourceSharing({ enabled: false, mode: 'copy' });

    expect(setCodexResourceSharing).toHaveBeenCalledWith({ enabled: false, mode: 'copy' });
    expect(state.snapshot.value.general.providerHomes?.codex?.shareSkills).toBe(false);
    expect(reloadRenderer).toHaveBeenCalledOnce();
    state.backendRestartInProgress.value = false;
  });

  it.each([
    ['initial migration', { enabled: true as const }],
    ['an Advanced settings change', { enabled: false as const, mode: 'copy' as const }],
    ['fresh isolation', { enabled: false as const, mode: 'fresh' as const }],
  ])('blocks the renderer and reloads it after %s', async (_scenario, input) => {
    const updatedSnapshot = createInitialSnapshot();
    const setCodexResourceSharing = vi.fn().mockResolvedValue(updatedSnapshot);
    const reloadRenderer = vi.fn().mockResolvedValue(undefined);
    stubElectronTestWindow({
      app: {
        setCodexResourceSharing,
        reloadRenderer,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();

    const operation = state.setCodexResourceSharing(input);
    expect(state.backendRestartInProgress.value).toBe(true);
    await operation;

    expect(setCodexResourceSharing).toHaveBeenCalledWith(input);
    expect(reloadRenderer).toHaveBeenCalledOnce();
    state.backendRestartInProgress.value = false;
  });

  it('keeps the renderer available when the migration is declined without restarting the backend', async () => {
    const updatedSnapshot = createInitialSnapshot();
    const setCodexResourceSharing = vi.fn().mockResolvedValue(updatedSnapshot);
    const reloadRenderer = vi.fn().mockResolvedValue(undefined);
    stubElectronTestWindow({
      app: {
        setCodexResourceSharing,
        reloadRenderer,
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();

    await state.setCodexResourceSharing({ enabled: false, mode: 'keep' });

    expect(state.backendRestartInProgress.value).toBe(false);
    expect(reloadRenderer).not.toHaveBeenCalled();
  });

  it('loads the resource sharing migration status after startup', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const getCodexResourceSharingStatus = vi.fn().mockResolvedValue({
      enabled: true,
      migrationRequired: true,
    });
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        getCodexResourceSharingStatus,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();

    await state.loadSnapshot();

    expect(getCodexResourceSharingStatus).toHaveBeenCalledOnce();
    expect(state.codexResourceSharingStatus.value).toStrictEqual({
      enabled: true,
      migrationRequired: true,
    });
  });

  it('JSON-normalizes reactive device pairing sessions before Electron IPC', async () => {
    const checkDevicePairing = vi.fn((session: DevicePairingSession) => {
      structuredClone(session);
      return Promise.resolve(true);
    });
    stubElectronTestWindow({
      app: {
        checkDevicePairing,
      } satisfies Partial<AppApi>,
    });
    const session = reactive<DevicePairingSession>({
      pairingCode: 'opaque-payload',
      manualPairingCode: 'ABCD-EFGH',
      environmentId: 'environment-1',
      expiresAt: '2030-03-17T17:46:40.000Z',
    });

    const state = useAppState();
    await expect(state.checkDevicePairing(session)).resolves.toBe(true);
    expect(checkDevicePairing).toHaveBeenCalledWith({
      pairingCode: 'opaque-payload',
      manualPairingCode: 'ABCD-EFGH',
      environmentId: 'environment-1',
      expiresAt: '2030-03-17T17:46:40.000Z',
    });
  });

  it('restores persisted model and reasoning defaults when the renderer starts', async () => {
    const base = createInitialSnapshot();
    base.agents[0].id = 'agent-persisted-settings';
    base.agents[0].providerDefaults = {
      kind: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    };
    base.teams[0].agentIds = ['agent-persisted-settings'];
    base.teams[0].activeAgentId = 'agent-persisted-settings';
    base.activeAgentId = 'agent-persisted-settings';
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(base),
        listProviderModels: vi.fn().mockResolvedValue([{ id: 'gpt-5.4', model: 'gpt-5.4', displayName: 'GPT', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }] }]),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(state.selectedModelId.value).toBe('gpt-5.4');
    expect(state.selectedReasoningEffort.value).toBe('high');
  });

  it.each(['codex', 'claude'] as const)('keeps changed %s settings for the next prompt across old settings and reload', async provider => {
    const persisted = createInitialSnapshot();
    persisted.general.claudeCodeEnabled = true;
    persisted.providerRuntimes = [{ provider: provider, status: 'running', capabilities: { reasoningEffort: true, serviceTier: true } }];
    persisted.agents[0]!.provider = provider;
    persisted.agents[0]!.providerSession = provider === 'codex' ? { kind: 'codex', conversationId: 'thread-1' } : { kind: 'claude', conversationId: 'thread-1', transport: 'stdio' };
    persisted.agents[0]!.providerDefaults = { kind: provider, model: 'astra', reasoningEffort: 'medium' };
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    let releaseFirstSave = () => undefined;
    const updateAgent = vi.fn((input: UpdateAgentInput) => {
      if (updateAgent.mock.calls.length === 1) {
        return new Promise<AppSnapshot>((resolve) => {
          releaseFirstSave = () => {
            updateAgentFromInput(persisted, input);
            resolve(structuredClone(persisted));
          };
        });
      }
      updateAgentFromInput(persisted, input);
      return Promise.resolve(structuredClone(persisted));
    });
    const listProviderModels = vi.fn().mockResolvedValue(['astra', 'sol'].map((model) => ({
      id: model === 'sol' ? 'sol-id' : model, model, displayName: model,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'medium', description: 'Medium' },
        { reasoningEffort: 'high', description: 'High' },
      ],
      serviceTiers: [{ id: 'fast', name: 'Fast', description: 'Fast responses' }],
    })));
    const sendPrompt = vi.fn().mockImplementation(async () => structuredClone(persisted));
    stubElectronTestWindow({ app: {
      getSnapshot: vi.fn().mockImplementation(async () => structuredClone(persisted)),
      listProviderModels,
      updateAgent,
      sendPrompt,
      onEvent: vi.fn((listener) => { listeners.push(listener); return () => undefined; }),
    } satisfies Partial<AppApi> });

    const state = useAppState();
    await state.loadSnapshot();
    state.selectServiceTier('fast');
    const agent = persisted.agents[0]!;
    listeners[0]?.(sessionSnapshotEvent(agent.id, sessionState(), { seq: 1, provider, conversation: 'thread-1' }));
    const controller = createConversationPaneController({
      state: agentConversationState(() => state.agentConversationFor(agent.id)!),
      actions: { updateSettings: settings => {
        if (settings.model !== undefined) state.selectModel(settings.model);
        if (settings.reasoningEffort != null) state.selectReasoningEffort(settings.reasoningEffort);
      } },
    });
    const wrapper = mount(ConversationPane, { props: { agent, controller }, attachTo: document.body });
    try {
      await wrapper.get('button[aria-label="Coding agent and model"]').trigger('click');
      await wrapper.findAll('[role="menuitem"]').find(item => item.text().startsWith('sol'))!.trigger('mouseenter');
      await wrapper.findAll('[role="menuitemradio"]').filter(item => item.text().trim() === 'medium').at(-1)!.trigger('click');
      await flushPromises();
      expect(wrapper.get('.provider-model-selector__label').text()).toContain('sol');
      expect(wrapper.get('.provider-model-selector').text()).toContain('fast');
    } finally { wrapper.unmount(); }
    state.selectReasoningEffort('high');
    await vi.waitFor(() => expect(updateAgent).toHaveBeenCalledTimes(1));
    listeners[0]?.({
      seq: 2, agentId: persisted.agents[0]!.id, provider: 'codex', conversationId: 'thread-1',
      type: 'conversation.settingsUpdated',
      payload: { settings: { model: 'astra', reasoningEffort: 'medium' } },
      occurredAt: '2026-09-26T00:00:00.000Z',
    });
    expect(state.selectedModelId.value).toBe('sol-id');
    expect(state.selectedReasoningEffort.value).toBe('high');
    expect(state.selectedServiceTier.value).toBe('fast');

    await state.sendPrompt('use my next-prompt selection');
    expect(sendPrompt).toHaveBeenCalledWith(persisted.agents[0]!.id, 'use my next-prompt selection',
      expect.objectContaining({ selection: { model: 'sol', reasoningEffort: 'high', serviceTier: 'fast' } }));

    releaseFirstSave();
    await vi.waitFor(() => expect(persisted.agents[0]!.providerDefaults).toStrictEqual({
      kind: provider, model: 'sol', reasoningEffort: 'high', serviceTier: 'fast', userSelectedModel: true,
    }));

    const reloaded = createAgentComposerState({ getSnapshot: () => persisted });
    await reloaded.loadModels(persisted.agents[0]!.id);
    expect(reloaded.selectedModelId.value).toBe('sol-id');
    expect(reloaded.selectedReasoningEffort.value).toBe('high');
    expect(reloaded.selectedServiceTier.value).toBe('fast');
    expect(reloaded.resolvePromptOptions(persisted.agents[0]!.id, 'after restart')).toMatchObject({
      selection: { model: 'sol', reasoningEffort: 'high', serviceTier: 'fast' },
    });
  });

  it('restores Claude thread settings ahead of the agent fallback selection', async () => {
    const base = createInitialSnapshot();
    base.agents[0] = {
      ...base.agents[0],
      provider: 'claude',
      providerSession: { kind: 'claude',
        conversationId: 'claude-session-current',
        transport: 'stdio',
        model: 'claude-sonnet-5',
        reasoningEffort: 'xhigh',
      },
      providerDefaults: {
        kind: 'claude',
        model: 'haiku',
        reasoningEffort: 'low',
      },
    };
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(base),
        listProviderModels: vi.fn().mockResolvedValue([
          {
            id: 'sonnet',
            model: 'sonnet',
            displayName: 'Sonnet',
            providerMetadata: { resolvedModel: 'claude-sonnet-5' },
            supportedReasoningEfforts: [
              { reasoningEffort: 'high', description: 'Deep reasoning' },
              { reasoningEffort: 'xhigh', description: 'Deeper reasoning' },
            ],
          },
          { id: 'haiku', model: 'haiku', displayName: 'Haiku', isDefault: true },
        ]),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(state.selectedModelId.value).toBe('sonnet');
    expect(state.selectedReasoningEffort.value).toBe('xhigh');
  });

  it('keeps a delegated Claude model visible when startup reports its resolved model id', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.provider = 'claude';
    agent.delegatedByAgentId = snapshot.agents[1]!.id;
    agent.providerDefaults = { kind: 'claude', model: 'claude-sonnet-5-5', permission: 'auto' };
    agent.providerSession = { kind: 'claude', conversationId: 'delegated-session', transport: 'stdio', model: 'claude-sonnet-5-5' };
    let receive!: (event: MainToRendererEvent) => void;
    const sendPrompt = vi.fn().mockResolvedValue(snapshot);
    stubElectronTestWindow({ app: {
      getSnapshot: async () => snapshot,
      listProviderModels: async () => [
        { id: 'default', model: 'default', displayName: 'Default', isDefault: true },
        { id: 'sonnet', model: 'sonnet', displayName: 'Sonnet 5.5', providerMetadata: { resolvedModel: 'claude-sonnet-5-5' } },
      ],
      onEvent: listener => { receive = listener; return () => undefined; }, sendPrompt,
    } satisfies Partial<AppApi> });
    const state = useAppState();
    await state.loadSnapshot();
    receive(sessionSnapshotEvent(agent.id, sessionState(), { seq: 1, provider: 'claude', conversation: 'delegated-session' }));
    const controller = createConversationPaneController({
      state: agentConversationState(() => state.agentConversationFor(agent.id)!),
      actions: { updateComposerState: value => state.updateComposerState(agent.id, value) },
    });
    const wrapper = mount(ConversationPane, { props: { agent, controller } });
    try {
      expect(wrapper.text()).toContain('Sonnet 5.5');
      receive({ seq: 2, agentId: agent.id, provider: 'claude', type: 'conversation.settingsUpdated',
        payload: { settings: { model: 'claude-sonnet-5-5' } }, occurredAt: '2026-10-07T13:46:28Z' });
      await nextTick();
      expect(wrapper.text()).toContain('Sonnet 5.5');
      await state.sendAgentPrompt(agent.id, 'Continue');
      expect(sendPrompt).toHaveBeenCalledWith(agent.id, 'Continue', expect.objectContaining({ selection: { model: 'sonnet' } }));
    } finally { wrapper.unmount(); }
  });

  it('uses the last Claude selection when the thread has no model metadata', async () => {
    const base = createInitialSnapshot();
    base.agents[0] = {
      ...base.agents[0],
      provider: 'claude',
      providerSession: { kind: 'claude',
        conversationId: 'claude-session-without-settings',
        transport: 'stdio',
      },
      providerDefaults: {
        kind: 'claude',
        model: 'haiku',
        reasoningEffort: 'low',
      },
    };
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(base),
        listProviderModels: vi.fn().mockResolvedValue([{ id: 'haiku', model: 'haiku', displayName: 'Haiku', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }] }]),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(state.selectedModelId.value).toBe('haiku');
    expect(state.selectedReasoningEffort.value).toBe('low');
  });

  it('shares the warmed catalogs across agent switches while preserving composer settings', async () => {
    const base = createInitialSnapshot();
    const models = [{
      id: 'shared-model',
      model: 'shared-model',
      displayName: 'Shared model',
      description: '',
      hidden: false,
      isDefault: true,
    }];
    const listProviderModels = vi.fn().mockResolvedValue(models);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(base),
        listProviderModels,
        selectAgent: vi.fn((agentId: string) => Promise.resolve({ ...base, activeAgentId: agentId })),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    expect(state.selectedModelId.value).toBe('shared-model');
    state.setPlanMode(true);

    await state.selectAgent('agent-jesse');
    expect(state.selectedModelId.value).toBe('shared-model');
    expect(state.planMode.value).toBe(false);

    await state.selectAgent('agent-dina');
    expect(state.selectedModelId.value).toBe('shared-model');
    expect(state.planMode.value).toBe(true);
    expect(listProviderModels).toHaveBeenCalledOnce();
    state.setPlanMode(false);
  });

  it('loads backend models, selects the default reasoning effort, and sends it with prompts', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    const listProviderModels = vi.fn().mockResolvedValue([
      {
        id: 'codex-fast',
        model: 'gpt-5.1-codex-fast',
        displayName: 'GPT-5.1 Codex Fast',
        description: 'Fast coding work',
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Quick' },
          { reasoningEffort: 'medium', description: 'Balanced' },
        ],
        defaultReasoningEffort: 'medium',
        serviceTiers: [{ id: 'fast', name: 'Fast', description: 'Quick responses' }],
        defaultServiceTier: 'fast',
        isDefault: false,
      },
      {
        id: 'codex-max',
        model: 'gpt-5.1-codex-max',
        displayName: 'GPT-5.1 Codex Max',
        description: 'Deep coding work',
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium', description: 'Balanced' },
          { reasoningEffort: 'high', description: 'Deep' },
        ],
        defaultReasoningEffort: 'high',
        isDefault: true,
      },
    ]);
    const sendPrompt = vi.fn().mockResolvedValue(updatedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        listProviderModels,
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.loadProviderModels();

    expect(state.modelCatalogStatus.value).toBe('loaded');
    expect(state.selectedModelId.value).toBe('codex-max');
    expect(state.selectedReasoningEffort.value).toBe('high');

    state.selectModel('codex-fast');
    state.selectReasoningEffort('low');
    await state.sendPrompt('use the selected model');

    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', 'use the selected model', { planMode: false, selection: { model: 'gpt-5.1-codex-fast', reasoningEffort: 'low', serviceTier: null } });
  });

  it('loads skills on demand and sends selected skill references in prompt options', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    const listProviderSkills = vi.fn().mockResolvedValue([
      {
        name: 'frontend-design',
        description: 'Design polished frontend pages and UI.',
        path: '/Users/nbonamy/.codex/skills/frontend-design/SKILL.md',
        scope: 'project',
        enabled: true,
      },
      {
        name: 'skill-creator',
        description: 'Create or update Codex skills.',
        path: '/Users/nbonamy/.codex/skills/skill-creator/SKILL.md',
        scope: 'user',
        enabled: true,
      },
    ]);
    const listProviderPlugins = vi.fn().mockResolvedValue([{
      id: 'app-69b31dc2110c8191b8b47dc98fe5a052',
      name: 'dropbox',
      displayName: 'Dropbox',
      enabled: true,
    }]);
    const sendPrompt = vi.fn().mockResolvedValue(updatedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        listProviderPlugins,
        listProviderSkills,
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    state.setPlanMode(false);

    expect(listProviderSkills).not.toHaveBeenCalled();
    state.updateComposerState('agent-dina', { text: 'ordinary text', selectionStart: 13, selectionEnd: 13 });
    expect(listProviderSkills).not.toHaveBeenCalled();
    await state.loadProviderSkills('agent-dina');
    await vi.waitFor(() => expect(state.skillCatalogStatus.value).toBe('loaded'));
    expect(state.skillCatalogStatus.value).toBe('loaded');
    expect(listProviderSkills).toHaveBeenCalledWith('agent-dina');
    expect(listProviderPlugins).toHaveBeenCalledWith('agent-dina');
    expect(state.providerPlugins.value).toStrictEqual([{
      id: 'app-69b31dc2110c8191b8b47dc98fe5a052',
      name: 'dropbox',
      displayName: 'Dropbox',
      enabled: true,
    }]);
    expect(state.providerSkills.value.map((skill) => skill.name)).toStrictEqual([
      'frontend-design',
      'skill-creator',
    ]);
    await state.loadProviderSkills('agent-dina');
    expect(listProviderSkills).toHaveBeenCalledTimes(1);

    await state.sendPrompt('$frontend-design make the dialog beautiful');
    expect(sendPrompt).toHaveBeenLastCalledWith('agent-dina', '$frontend-design make the dialog beautiful');
    const content = [{ type: 'mention' as const, kind: 'skill' as const, id: '/Users/nbonamy/.codex/skills/frontend-design/SKILL.md', value: 'frontend-design', label: 'Frontend design' }, { type: 'text' as const, text: ' make the dialog beautiful' }];
    await state.sendPrompt('Frontend design make the dialog beautiful', { content });

    expect(sendPrompt).toHaveBeenLastCalledWith('agent-dina', 'Frontend design make the dialog beautiful', {
      content,
    });
  });

  it('loads active agent files from preload for composer mentions', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const listAgentFiles = vi.fn().mockResolvedValue([
      { name: 'README.md', path: 'README.md' },
      { name: 'research.md', path: 'docs/research.md' },
    ]);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        listAgentFiles,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(state.fileCatalogStatus.value).toBe('loaded');
    expect(listAgentFiles).toHaveBeenCalledWith('agent-dina');
    expect(state.agentFiles.value).toStrictEqual([
      { name: 'README.md', path: 'README.md' },
      { name: 'research.md', path: 'docs/research.md' },
    ]);
  });

  it('reads the active agent files again on request, so files created later can be found', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const listAgentFiles = vi.fn()
      .mockResolvedValueOnce([{ name: 'README.md', path: 'README.md' }])
      .mockResolvedValue([{ name: 'README.md', path: 'README.md' }, { name: 'AGENTS.md', path: 'core/AGENTS.md' }]);
    stubElectronTestWindow({ app: { getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot), listAgentFiles, onEvent: vi.fn() } satisfies Partial<AppApi> });

    const state = useAppState();
    await state.loadSnapshot();
    expect(state.agentFiles.value).toHaveLength(1);

    await state.loadAgentFiles();
    expect(listAgentFiles).toHaveBeenCalledTimes(2);
    expect(state.agentFiles.value.map((file) => file.path)).toStrictEqual(['README.md', 'core/AGENTS.md']);
  });

  it('does not request a file catalog for a workspace-free quick chat', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const activeAgent = remoteSnapshot.agents.find((agent) => agent.id === remoteSnapshot.activeAgentId)!;
    activeAgent.folder = null;
    activeAgent.sessionKind = 'quickChat';
    const listAgentFiles = vi.fn();

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        listAgentFiles,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    expect(listAgentFiles).not.toHaveBeenCalled();
    expect(state.fileCatalogStatus.value).toBe('loaded');
    expect(state.agentFiles.value).toStrictEqual([]);
  });

  it('keeps repository skills when the global catalog refresh finishes later', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const snapshot = createInitialSnapshot();
    const skill = { name: 'prepare-release', path: `${snapshot.agents[0]!.folder}/.agents/skills/prepare-release/SKILL.md`, enabled: true };
    const globalSkill = { name: 'cp', path: '/skills/cp/SKILL.md', enabled: true };
    const listProviderSkills = vi.fn(async () => [skill, globalSkill]);
    stubElectronTestWindow({ app: {
      getSnapshot: async () => snapshot,
      listProviderSkills,
      onEvent: listener => { listeners.push(listener); return () => undefined; },
    } satisfies Partial<AppApi> });
    const state = useAppState();
    await state.loadSnapshot();
    expect(listProviderSkills).not.toHaveBeenCalled();
    const mention = mount(UserText, { props: { content: 'Use [$prepare-release](/skills/prepare-release/SKILL.md)' } });
    expect(mention.get('.chat-user-text__mention--skill').text()).toBe('Prepare Release');
    const agent = snapshot.agents[0]!;
    const controller = createConversationPaneController({
      state: agentConversationState(() => state.agentConversationFor(agent.id)!),
      actions: { updateComposerState: value => state.updateComposerState(agent.id, value), requestSkills: () => state.loadProviderSkills(agent.id) },
    });
    const wrapper = mount(ConversationPane, { attachTo: document.body, props: { agent, controller } });
    const editor = wrapper.get<HTMLElement>('.chat-rich-text-editor');
    editor.element.focus();
    editor.element.textContent = '$prepare';
    const selection = window.getSelection()!;
    selection.selectAllChildren(editor.element);
    selection.collapseToEnd();
    await editor.trigger('input');
    await editor.trigger('keyup');
    await vi.waitFor(() => expect(wrapper.find('[role="option"]').exists()).toBe(true));
    expect(listProviderSkills).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[role="option"]').text()).toContain('prepare-release');

    listeners[0]?.({
      seq: 1, type: 'skills.changed', provider: 'codex',
      payload: { cwd: null, status: 'loaded', skills: [globalSkill] },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    await nextTick();
    expect(wrapper.get('[role="option"]').text()).toContain('prepare-release');
    await wrapper.get('[role="option"]').trigger('mousedown');
    expect(state.agentConversationFor(agent.id)?.composerState.content).toContainEqual({ type: 'mention', kind: 'skill', id: skill.path, value: skill.name, label: skill.name });
  });

  it.each(['codex', 'claude'] as const)('refreshes %s skills without applying another engine’s catalog', async (provider) => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    const active = remoteSnapshot.agents[0]!;
    active.provider = provider;
    active.providerDefaults = { kind: provider };
    const other = remoteSnapshot.agents[1]!;
    other.provider = provider === 'codex' ? 'claude' : 'codex';
    other.providerDefaults = { kind: other.provider };
    other.folder = active.folder;
    const listProviderSkills = vi.fn().mockResolvedValue([]);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        listProviderSkills,
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    listProviderSkills.mockClear();
    const event: Extract<MainToRendererEvent, { type: 'skills.changed' }> = {
      seq: 1,
      type: 'skills.changed',
      provider: provider,
      payload: {
        cwd: active.folder,
        status: 'loaded',
        skills: [{
          name: 'skill-creator',
          description: 'Create or update Codex skills.',
          path: '/Users/nbonamy/.codex/skills/skill-creator/SKILL.md',
          scope: 'user',
          enabled: true,
        }],
      },
      occurredAt: '2026-06-05T00:00:01.000Z',
    };
    listeners[0]?.(event);
    await vi.waitFor(() => {
      expect(state.providerSkills.value.map((skill) => skill.name)).toStrictEqual(['skill-creator']);
    });
    expect(state.agentConversationFor(other.id)?.composer.skills).toStrictEqual([]);
    expect(listProviderSkills).not.toHaveBeenCalled();
    const skillsReference = state.providerSkills.value;
    listeners[0]?.({
      ...event,
      seq: 2,
      agentId: active.id,
      provider: other.provider,
      payload: { ...event.payload, skills: [] },
    });
    expect(state.providerSkills.value).toBe(skillsReference);
    listeners[0]?.({ ...event, seq: 3, agentId: active.id });
    expect(state.providerSkills.value).toBe(skillsReference);
  });

  it('refreshes the Claude model catalog and reasoning choices after a models changed event', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0] = { ...remoteSnapshot.agents[0]!, provider: 'claude' };
    const listProviderModels = vi.fn().mockResolvedValue([]);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        listProviderModels,
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    listeners[0]?.({
      seq: 1,
      provider: 'claude',
      type: 'models.changed',
      payload: {
        models: [{
          id: 'claude-sonnet-4-5',
          model: 'claude-sonnet-4-5',
          displayName: 'Sonnet 4.5',
          supportedReasoningEfforts: [
            { reasoningEffort: 'low', description: 'Minimal thinking' },
            { reasoningEffort: 'high', description: 'Deep reasoning' },
          ],
          defaultReasoningEffort: 'high',
          isDefault: true,
        }],
      },
      occurredAt: '2026-06-05T00:00:01.000Z',
    });

    await vi.waitFor(() => {
      expect(state.providerModels.value).toEqual([expect.objectContaining({ id: 'claude-sonnet-4-5' })]);
      expect(state.selectedModelId.value).toBe('claude-sonnet-4-5');
      expect(state.selectedReasoningEffort.value).toBe('high');
    });
    expect(listProviderModels).toHaveBeenCalled();
  });

  it('handles model catalog loading guards, errors, and invalid selections', async () => {
    const listProviderModels = vi.fn().mockRejectedValue(new Error('models unavailable'));
    stubElectronTestWindow({
      app: {
        listProviderModels,
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    state.modelCatalogStatus.value = 'loading';
    await state.loadProviderModels();

    expect(listProviderModels).not.toHaveBeenCalled();

    state.modelCatalogStatus.value = 'notLoaded';
    state.modelCatalogError.value = null;
    await state.loadProviderModels();

    expect(state.modelCatalogStatus.value).toBe('error');
    expect(state.modelCatalogError.value).toBe('models unavailable');

    state.selectedModelId.value = null;
    state.selectedReasoningEffort.value = null;
    state.selectModel('missing-model');
    state.selectReasoningEffort('high');

    expect(state.selectedModelId.value).toBeNull();
    expect(state.selectedReasoningEffort.value).toBeNull();
  });

  it('keeps an already selected model when the catalog reloads', async () => {
    stubElectronTestWindow({
      app: {
        listProviderModels: vi.fn().mockResolvedValue([
          {
            id: 'codex-existing',
            model: 'gpt-5.1-codex-existing',
            displayName: 'Existing',
            hidden: false,
            supportedReasoningEfforts: [],
            isDefault: false,
          },
          {
            id: 'codex-default',
            model: 'gpt-5.1-codex-default',
            displayName: 'Default',
            hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
            defaultReasoningEffort: 'medium',
            isDefault: true,
          },
        ]),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    state.modelCatalogStatus.value = 'notLoaded';
    state.selectedModelId.value = 'codex-existing';
    state.selectedReasoningEffort.value = null;

    await state.loadProviderModels();

    expect(state.selectedModelId.value).toBe('codex-existing');
    expect(state.selectedReasoningEffort.value).toBeNull();
  });
});
