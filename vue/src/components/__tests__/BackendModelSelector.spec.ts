import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h } from 'vue';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElPopover, ElTabs, ElTabPane, ElTooltip } from 'element-plus';
import type { BackendModelOption, ExecutionSelection } from '@workspace/core/contracts';
import BackendModelSelector from '../BackendModelSelector.vue';
import AppMenuButton from '../../shared/menu/AppMenuButton.vue';
import { backendChoicesKey, provideBackendChoices } from '../backend-selection';
import { backendModelCatalogKey } from '../backend-model-catalog';

afterEach(() => { localStorage.removeItem('app:modelCatalog'); document.body.innerHTML = ''; });

// The picker owns catalog races and resets: a late provider/host response must not
// replace the current catalog, and provider/model changes must not retain invalid effort.
describe('BackendModelSelector', () => {
  it('keeps the chosen model and effort when a failed launch remounts the picker', async () => {
    const wrapper = mount(BackendModelSelector, {
      props: { agentId: 'agent', selection: { backend: 'codex', model: 'gpt-fast', reasoningEffort: 'high', serviceTier: null } },
      global: { provide: { [backendModelCatalogKey as symbol]: {
        listModels: async () => [{ id: 'fast', model: 'gpt-fast', displayName: 'GPT Fast' }],
      } } },
    });
    await flushPromises();
    expect(wrapper.emitted('update:model')).toBeUndefined();
    expect(wrapper.emitted('update:reasoningEffort')).toBeUndefined();
    expect(wrapper.get('button').text()).toContain('GPT Fast');
  });
  it('rejects stale catalogs and resets model/effort when switching provider or host', async () => {
    let oldCatalog!: (models: BackendModelOption[]) => void;
    const listModels = vi.fn().mockImplementationOnce(() => new Promise(resolve => { oldCatalog = resolve; }))
      .mockResolvedValue([{ id: 'sonnet', model: 'sonnet', displayName: 'Sonnet', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }]);
    const wrapper = mount(BackendModelSelector, {
      props: { agentId: 'local-agent', selection: { backend: 'codex' as const, model: '', reasoningEffort: '', serviceTier: null }, 'onUpdate:selection': (selection: ExecutionSelection | undefined) => wrapper.setProps({ selection }) },
      global: { components: { ElPopover, ElTabs, ElTabPane }, provide: {
        [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']),
        [backendModelCatalogKey as symbol]: { listModels },
      } },
    });
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    ([...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => tab.querySelector('[aria-label="Claude Code"]'))!).click();
    await flushPromises();
    expect([...document.querySelectorAll('[role="tab"] [aria-label]')].map(tab => tab.getAttribute('aria-label'))).toEqual(['Codex', 'Claude Code']);
    oldCatalog([{ id: 'stale', model: 'stale', displayName: 'Stale model' }]);
    await flushPromises();
    expect(listModels).toHaveBeenLastCalledWith('local-agent', 'claude');
    expect(document.body.textContent).not.toContain('Stale model');
    expect(wrapper.props('selection')?.model).toBe('sonnet');
    expect(wrapper.props('selection')?.reasoningEffort).toBe('high');
    await wrapper.setProps({ agentId: 'remote-agent', selection: { ...wrapper.props('selection')!, reasoningEffort: 'low' } });
    await flushPromises();
    expect(listModels).toHaveBeenLastCalledWith('remote-agent', 'claude');
    expect(wrapper.props('selection')?.model).toBe('sonnet');
    expect(wrapper.props('selection')?.reasoningEffort).toBe('high');
  });

  it('can be dropped in with only a host: it finds an agent on that host to read the catalog from', async () => {
    const snapshot = createEmptySnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    snapshot.remoteConnections.connections = [{ id: 'box', kind: 'ssh', host: 'box', name: 'Box', status: 'ready', createdAt: '', updatedAt: '', providerConnections: structuredClone(snapshot.providerConnections) }] as never;
    snapshot.agents.push(...[
      { id: 'local-agent' },
      { id: 'remote-agent', remoteConnectionId: 'box' },
    ] as never[]);
    const listModels = vi.fn().mockResolvedValue([]);
    const mountFor = (remoteConnectionId?: string) => mount(defineComponent({
      setup() {
        provideBackendChoices(() => snapshot);
        return () => h(BackendModelSelector, { remoteConnectionId, selection: { backend: 'codex', model: null, reasoningEffort: null, serviceTier: null } });
      },
    }), { global: { provide: { [backendModelCatalogKey as symbol]: { listModels } } } });
    mountFor();
    await flushPromises();
    expect(listModels).toHaveBeenLastCalledWith('local-agent', 'codex');
    mountFor('box');
    await flushPromises();
    expect(listModels).toHaveBeenLastCalledWith('remote-agent', 'codex');
  });

  it('reads the catalog of a host that has no agent yet from the host itself', async () => {
    const snapshot = createEmptySnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    snapshot.remoteConnections.connections = [{ id: 'box', kind: 'ssh', host: 'box', name: 'Box', status: 'ready', createdAt: '', updatedAt: '', providerConnections: structuredClone(snapshot.providerConnections) }] as never;
    const listModels = vi.fn().mockResolvedValue([]);
    mount(defineComponent({
      setup() {
        provideBackendChoices(() => snapshot);
        return () => h(BackendModelSelector, { remoteConnectionId: 'box', selection: { backend: 'codex', model: null, reasoningEffort: null, serviceTier: null } });
      },
    }), { global: { provide: { [backendModelCatalogKey as symbol]: { listModels } } } });
    await flushPromises();
    expect(listModels).toHaveBeenLastCalledWith(null, 'codex', 'box');
  });

  it('picks model and reasoning effort together from a cascading menu', async () => {
    const wrapper = mount(BackendModelSelector, {
      props: { agentId: 'agent', selection: { backend: 'codex' as const, model: '', reasoningEffort: '', serviceTier: null }, 'onUpdate:selection': (selection: ExecutionSelection | undefined) => wrapper.setProps({ selection }) },
      global: { components: { ElPopover, ElTabs, ElTabPane }, provide: {
        [backendChoicesKey as symbol]: computed(() => ['codex']),
        [backendModelCatalogKey as symbol]: { listModels: async () => [
          { id: 'fast', model: 'gpt-fast', displayName: 'GPT Fast',
            supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'high', description: '' }] },
          { id: 'plain', model: 'gpt-plain', displayName: 'GPT Plain' },
        ] },
      } },
    });
    await flushPromises();
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    const effort = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(item => item.textContent?.trim() === label)!;
    expect(document.querySelector('input')).toBeNull();
    effort('high').click();
    await flushPromises();
    expect(wrapper.props('selection')?.model).toBe('gpt-fast');
    expect(wrapper.props('selection')?.reasoningEffort).toBe('high');
    expect(wrapper.get('button').text()).toContain('high');
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    effort('GPT Plain').click();
    await flushPromises();
    expect(wrapper.props('selection')?.model).toBe('gpt-plain');
    expect(wrapper.props('selection')?.reasoningEffort).toBeNull();
  });

  describe('service tiers', () => {
    const catalog = [
      { id: 'fast', model: 'gpt-fast', displayName: 'GPT Fast',
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'high', description: '' }],
        serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }, { id: 'ultrafast', name: 'Ultrafast', description: '' }] },
      { id: 'tiers-only', model: 'gpt-tiers', displayName: 'GPT Tiers', serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }] },
      { id: 'plain', model: 'gpt-plain', displayName: 'GPT Plain', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] },
    ] as BackendModelOption[];
    function mountSelector(initial: { model?: string; reasoningEffort?: string; serviceTier?: string } = {}) {
      const wrapper = mount(BackendModelSelector, {
        props: { agentId: 'agent', selection: { backend: 'codex' as const, model: initial.model ?? '', reasoningEffort: initial.reasoningEffort ?? null, serviceTier: initial.serviceTier ?? null }, 'onUpdate:selection': (selection: ExecutionSelection | undefined) => wrapper.setProps({ selection }) },
        global: { components: { ElPopover, ElTabs, ElTabPane, ElTooltip }, stubs: { transition: false }, provide: {
          [backendChoicesKey as symbol]: computed(() => ['codex']),
          [backendModelCatalogKey as symbol]: { listModels: async () => catalog },
        } },
      });
      return wrapper;
    }
    const open = async (wrapper: ReturnType<typeof mountSelector>) => { await wrapper.get('[aria-label="Coding agent and model"]').trigger('click'); await flushPromises(); };
    const row = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(item => item.textContent?.trim() === label)!;

    // Header failures: changing tier changes model/effort, binary mode opens a menu,
    // additional modes cannot be selected, or an unsupported model retains the control.
    it('toggles Standard/Fast from the header without changing the model or effort', async () => {
      const wrapper = mountSelector({ model: 'gpt-tiers' });
      await flushPromises();
      await open(wrapper);
      const toggle = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Service tier:"]')!;
      expect(toggle()).not.toBeNull();
      expect(toggle().getAttribute('aria-label')).toBe('Service tier: Standard');
      expect(toggle().getAttribute('aria-pressed')).toBe('false');
      expect(toggle().getAttribute('aria-haspopup')).toBeNull();
      const activation = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
      toggle().dispatchEvent(activation);
      expect(activation.defaultPrevented).toBe(false);
      toggle().click();
      await flushPromises();
      expect(wrapper.props('selection')).toStrictEqual({ backend: 'codex', model: 'gpt-tiers', reasoningEffort: null, serviceTier: 'priority' });
      expect(toggle().getAttribute('aria-pressed')).toBe('true');
      expect(toggle().getAttribute('aria-label')).toBe('Service tier: Fast');
      expect(row('Standard')).toBeUndefined();
      toggle().click();
      await flushPromises();
      expect(wrapper.props('selection')?.serviceTier).toBeNull();
      expect(toggle().getAttribute('aria-pressed')).toBe('false');
      await wrapper.setProps({ disabled: true });
      expect(toggle().disabled).toBe(true);
    });

    it('opens a mode picker for additional tiers, keeps effort, and lets Standard clear the tier', async () => {
      const wrapper = mountSelector({ model: 'gpt-fast', reasoningEffort: 'low' });
      await flushPromises();
      await open(wrapper);
      const button = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Service tier:"]')!;
      expect(button()).not.toBeNull();
      expect(button().getAttribute('aria-haspopup')).toBe('menu');
      expect(button().getAttribute('aria-pressed')).toBeNull();
      const submenu = row('low').closest('[role="menu"]')!;
      expect([...submenu.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent?.trim())).toStrictEqual(['low', 'high']);
      button().click();
      await flushPromises();
      await vi.waitFor(() => expect(wrapper.findComponent(AppMenuButton).findComponent(ElPopover).emitted('after-enter')).toHaveLength(1));
      expect(wrapper.props('selection')?.serviceTier).toBeNull();
      expect(row('Standard').getAttribute('aria-checked')).toBe('true');
      row('Ultrafast').click();
      await flushPromises();
      expect(wrapper.props('selection')?.model).toBe('gpt-fast');
      expect(wrapper.props('selection')?.reasoningEffort).toBe('low');
      expect(wrapper.props('selection')?.serviceTier).toBe('ultrafast');
      expect(wrapper.get('button').text()).toContain('ultrafast');
      expect(button().getAttribute('aria-label')).toBe('Service tier: Ultrafast');
      await vi.waitFor(() => expect(button().getAttribute('aria-expanded')).toBe('false'));
      button().click();
      await flushPromises();
      expect(row('Ultrafast').getAttribute('aria-checked')).toBe('true');
      row('Standard').click();
      await flushPromises();
      expect(wrapper.props('selection')?.serviceTier).toBeNull();
      expect(wrapper.props('selection')?.reasoningEffort).toBe('low');
    });

    it('selects a model with only tiers directly and hides the control for unsupported models', async () => {
      const wrapper = mountSelector();
      await flushPromises();
      await open(wrapper);
      row('GPT Tiers').click();
      await flushPromises();
      expect(wrapper.props('selection')?.model).toBe('gpt-tiers');
      await open(wrapper);
      expect(document.querySelector('button[aria-label^="Service tier:"]')).not.toBeNull();
      await wrapper.setProps({ selection: { ...wrapper.props('selection')!, model: 'gpt-plain' } });
      await flushPromises();
      expect(document.querySelector('button[aria-label^="Service tier:"]')).toBeNull();
    });

    it('drops a tier the newly chosen model does not offer', async () => {
      const wrapper = mountSelector({ model: 'gpt-fast', reasoningEffort: 'high', serviceTier: 'ultrafast' });
      await flushPromises();
      await wrapper.setProps({ selection: { ...wrapper.props('selection')!, model: 'gpt-plain' } });
      await flushPromises();
      expect(wrapper.props('selection')?.serviceTier).toBeNull();
    });
  });

  it('shows the last known models instantly and keeps the list stable while refreshing', async () => {
    const catalog = [{ id: 'fast', model: 'gpt-fast', displayName: 'GPT Fast' }];
    const mountSelector = (listModels: () => Promise<BackendModelOption[]>) => mount(BackendModelSelector, {
      props: { agentId: 'agent', selection: { backend: 'codex' as const, model: '', reasoningEffort: '', serviceTier: null } },
      global: { components: { ElPopover, ElTabs, ElTabPane }, provide: {
        [backendChoicesKey as symbol]: computed(() => ['codex']),
        [backendModelCatalogKey as symbol]: { listModels },
      } },
    });
    const first = mountSelector(async () => catalog);
    await flushPromises();
    first.unmount();
    const labels = () => [...document.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent?.trim());

    const pending = mountSelector(() => new Promise(() => undefined));
    await pending.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    expect(labels()).toEqual(['GPT Fast']);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Loading models');
  });

  it('keeps the default row and shows placeholders on a cold first load', async () => {
    const wrapper = mount(BackendModelSelector, {
      props: { agentId: 'agent', selection: { backend: 'codex' as const, model: '', reasoningEffort: '', serviceTier: null } },
      global: { components: { ElPopover, ElTabs, ElTabPane }, provide: {
        [backendChoicesKey as symbol]: computed(() => ['codex']),
        [backendModelCatalogKey as symbol]: { listModels: () => new Promise(() => undefined) },
      } },
    });
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    expect([...document.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent?.trim())).toEqual([]);
    expect(document.querySelectorAll('[aria-busy="true"] > *').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('Loading models');
  });

  it("selects the provider default model and its default effort explicitly, with no blank 'Default' entries", async () => {
    const wrapper = mount(BackendModelSelector, {
      props: { agentId: 'agent', selection: { backend: 'codex' as const, model: '', reasoningEffort: '', serviceTier: null }, 'onUpdate:selection': (selection: ExecutionSelection | undefined) => wrapper.setProps({ selection }) },
      global: { components: { ElPopover, ElTabs, ElTabPane }, provide: {
        [backendChoicesKey as symbol]: computed(() => ['codex']),
        [backendModelCatalogKey as symbol]: { listModels: async () => [
          { id: 'a', model: 'gpt-a', displayName: 'GPT A' },
          { id: 'b', model: 'gpt-b', displayName: 'GPT B', isDefault: true, defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'medium', description: '' }] },
        ] },
      } },
    });
    await flushPromises();
    expect(wrapper.props('selection')?.model).toBe('gpt-b');
    expect(wrapper.props('selection')?.reasoningEffort).toBe('medium');
    expect(wrapper.get('button').text()).toContain('medium');
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    expect([...document.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent?.trim())).toEqual(['GPT A', 'low', 'medium']);
  });

  it("shows the real model behind a provider's default alias instead of the alias row", async () => {
    const wrapper = mount(BackendModelSelector, {
      props: { agentId: 'agent', selection: { backend: 'claude' as const, model: '', reasoningEffort: '', serviceTier: null }, 'onUpdate:selection': (selection: ExecutionSelection | undefined) => wrapper.setProps({ selection }) },
      global: { components: { ElPopover, ElTabs, ElTabPane }, provide: {
        [backendChoicesKey as symbol]: computed(() => ['claude']),
        [backendModelCatalogKey as symbol]: { listModels: async () => [
          { id: 'default', model: 'default', displayName: 'Default (recommended)', isDefault: true, providerMetadata: { resolvedModel: 'claude-opus-5-5' } },
          { id: 'opus', model: 'opus', displayName: 'Opus 5.5', providerMetadata: { resolvedModel: 'claude-opus-5-5' } },
          { id: 'sonnet', model: 'sonnet', displayName: 'Sonnet 5.5', providerMetadata: { resolvedModel: 'claude-sonnet-5-5' } },
        ] },
      } },
    });
    await flushPromises();
    expect(wrapper.props('selection')?.model).toBe('opus');
    expect(wrapper.get('button').text()).toContain('Opus 5.5');
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).not.toContain('Default (recommended)');
    expect([...document.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent?.trim())).toEqual(['Opus 5.5', 'Sonnet 5.5']);
  });

  describe('saved provider defaults', () => {
    const catalog: BackendModelOption[] = [
      { id: 'default', model: 'default', displayName: 'Default (recommended)', isDefault: true, providerMetadata: { resolvedModel: 'claude-sonnet-5' } },
      { id: 'sonnet', model: 'sonnet', displayName: 'Sonnet', providerMetadata: { resolvedModel: 'claude-sonnet-5' }, defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'high', description: '' }] },
      { id: 'opus', model: 'opus', displayName: 'Opus', providerMetadata: { resolvedModel: 'claude-opus-5' },
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'high', description: '' }] },
    ];
    async function mountWithSaved(saved?: { model: string; reasoningEffort: string | null }) {
      const snapshot = createEmptySnapshot();
      snapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
      if (saved) snapshot.general.providerModelDefaults = { claude: { ...saved, serviceTier: null } } as never;
      snapshot.teams.push({ id: 't', name: 'T', agentIds: [] });
      snapshot.agents.push({ id: 'a', teamId: 't' } as never);
      const wrapper = mount(defineComponent({
        setup() {
          provideBackendChoices(() => snapshot);
          const state = { model: '', effort: '' };
          return () => h(BackendModelSelector, { teamId: 't', selection: { backend: 'claude', model: state.model, reasoningEffort: state.effort, serviceTier: null }, 'onUpdate:selection': (selection: ExecutionSelection | undefined) => { state.model = selection?.model ?? ''; state.effort = selection?.reasoningEffort ?? ''; } });
        },
      }), { global: { components: { ElPopover, ElTabs, ElTabPane }, provide: { [backendModelCatalogKey as symbol]: { listModels: async () => catalog } } } });
      await flushPromises();
      return wrapper.findComponent(BackendModelSelector);
    }

    it("starts from the user's saved default for the provider, not the catalog's", async () => {
      const selector = await mountWithSaved({ model: 'opus', reasoningEffort: 'low' });
      expect(selector.emitted('update:selection')?.at(-1)?.map(value => (value as ExecutionSelection).model)).toEqual(['opus']);
      expect(selector.emitted('update:selection')?.at(-1)?.map(value => (value as ExecutionSelection).reasoningEffort)).toEqual(['low']);
    });

    it('resolves a saved alias to the real model and falls back to the model default effort when the saved one is unsupported', async () => {
      const selector = await mountWithSaved({ model: 'default', reasoningEffort: 'ultra' });
      expect(selector.emitted('update:selection')?.at(-1)?.map(value => (value as ExecutionSelection).model)).toEqual(['sonnet']);
      expect(selector.emitted('update:selection')?.at(-1)?.map(value => (value as ExecutionSelection).reasoningEffort)).toEqual(['high']);
    });

    it('uses the provider default when nothing is saved', async () => {
      const selector = await mountWithSaved();
      expect(selector.emitted('update:selection')?.at(-1)?.map(value => (value as ExecutionSelection).model)).toEqual(['sonnet']);
      expect(selector.emitted('update:selection')?.at(-1)?.map(value => (value as ExecutionSelection).reasoningEffort)).toEqual(['high']);
    });
  });
});
