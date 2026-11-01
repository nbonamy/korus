import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppApi } from '@workspace/core/contracts';
import SettingsPluginsPanel from '../SettingsPluginsPanel.vue';
import { configureAppClient } from '../../platform-api';

describe('SettingsPluginsPanel', () => {
  let builtInLaunchChatGpt: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    builtInLaunchChatGpt = vi.fn().mockResolvedValue({ status: 'launched' });
    configureAppClient({
      api: { launchChatGptApp: builtInLaunchChatGpt } as unknown as AppApi,
      platform: 'desktop',
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it(`separates ${product.name} capabilities from Codex plugins`, () => {
    const wrapper = mount(SettingsPluginsPanel, {
    });

    expect(wrapper.findAll('.form-section__header h3').map((heading) => heading.text())).toStrictEqual([
      `${product.name}`,
      'Codex',
    ]);
    const sections = wrapper.findAll('.form-section');
    expect(sections[0].text()).toContain('Computer Use');
    expect(sections[0].text()).not.toContain('Chrome');
    expect(sections[1].text()).toContain('Chrome');
    expect(sections[1].text()).toContain('Install Codex plugins and MCP servers');
    expect(sections[1].text()).not.toContain('Computer Use');
  });

  it('opens the desktop plugin manager without changing Chrome settings', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const getPluginStatus = vi.fn().mockResolvedValue({ chromeEnabled: false });
    const wrapper = mount(SettingsPluginsPanel, {
      props: { updateSettings, getPluginStatus },
      attachTo: document.body,
    });

    await wrapper.get('[aria-label="Enable Chrome"]').trigger('click');
    await flushPromises();

    expect(builtInLaunchChatGpt).toHaveBeenCalledOnce();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(getPluginStatus).toHaveBeenCalled();
  });

  it('opens the plugin manager when Chrome is already enabled and clicked off', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsPluginsPanel, {
      props: {
        settings: { computerUseEnabled: false, chromeEnabled: true },
        updateSettings,
        getPluginStatus: vi.fn().mockResolvedValue({ chromeEnabled: true }),
      },
      attachTo: document.body,
    });

    await wrapper.get('[aria-label="Enable Chrome"]').trigger('click');
    await flushPromises();

    expect(builtInLaunchChatGpt).toHaveBeenCalledOnce();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('disables a capability without opening the plugin manager', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsPluginsPanel, {
      props: {
        settings: { computerUseEnabled: true, chromeEnabled: false },
        updateSettings,
      },
    });

    await wrapper.get('[aria-label="Enable Computer Use"]').trigger('click');
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith({ general: { plugins: { computerUseEnabled: false } } });
    expect(builtInLaunchChatGpt).not.toHaveBeenCalled();
  });

  it('enables Computer Use directly without opening the plugin manager', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsPluginsPanel, {
      props: {
        settings: { computerUseEnabled: false, chromeEnabled: false },
        updateSettings,
      },
    });

    await wrapper.get('[aria-label="Enable Computer Use"]').trigger('click');
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith({ general: { plugins: { computerUseEnabled: true } } });
    expect(builtInLaunchChatGpt).not.toHaveBeenCalled();
  });

  it('does not offer Computer Use when the host does not provide it', () => {
    configureAppClient(undefined);
    const wrapper = mount(SettingsPluginsPanel, {
    });

    expect(wrapper.find('[aria-label="Enable Computer Use"]').exists()).toBe(false);
    expect(wrapper.findAll('.form-section__header h3').map((heading) => heading.text())).toStrictEqual(['Codex']);
  });

  it('opens the configured manager to install Codex plugins and MCP servers', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsPluginsPanel, {
      props: { updateSettings },
      attachTo: document.body,
    });

    await wrapper.get('[aria-label="Install Codex plugins and MCP servers"]').trigger('click');
    await flushPromises();
    expect(builtInLaunchChatGpt).toHaveBeenCalledOnce();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('shows plugin manager failures inline', async () => {
    builtInLaunchChatGpt.mockRejectedValueOnce(new Error('ChatGPT is unavailable.'));
    const wrapper = mount(SettingsPluginsPanel, {
      attachTo: document.body,
    });

    await wrapper.get('[aria-label="Enable Chrome"]').trigger('click');
    await flushPromises();

    const sections = wrapper.findAll('.form-section');
    const appRows = sections[0].findAll('.form-row');
    const codexRows = sections[1].findAll('.form-row');
    expect(appRows[0].text()).not.toContain('ChatGPT is unavailable.');
    expect(codexRows[0].text()).toContain('ChatGPT is unavailable.');
    expect(codexRows[1].text()).not.toContain('ChatGPT is unavailable.');
  });
});
