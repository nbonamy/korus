import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppApi } from '@workspace/core/contracts';
import { defaultGeneralSettings } from '@workspace/core/settings';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import SettingsCodexPanel from '../SettingsCodexPanel.vue';

describe('SettingsCodexPanel', () => {
  beforeEach(() => {
    configureAppClient({ api: {} as AppApi, platform: 'desktop' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows engine setup and ChatGPT launch without an executable picker', () => {
    const wrapper = mountPanel();

    expect(wrapper.text()).toContain('Launch ChatGPT');
    expect(wrapper.find('input[aria-label="Share skills and plugins with ChatGPT"]').exists()).toBe(false);
    expect(wrapper.find('input[aria-label="Codex executable path"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Runtime');
    expect(wrapper.text()).not.toContain('Enable Claude Code');
    const hero = wrapper.get('.engine-hero');
    expect(hero.get('.engine-hero__copy strong').text()).toBe('Codex');
    expect(hero.findAll('.engine-hero__details .form-row__copy strong').map(row => row.text())).toEqual(['Version', 'Location', 'Enable engine']);
  });

  it('reads banked resets only for the eligible settings account and owning host', async () => {
    const client = createClientApiMock();
    client.api.getBankedResets.mockResolvedValue({ status: 'ready', summary: { availableCount: '3', credits: null, detailCount: null } });
    configureAppClient({ api: client.api, platform: 'desktop' });
    const wrapper = mountPanel({ connected: false }); await flushPromises();
    expect(client.api.getBankedResets).not.toHaveBeenCalled();
    await wrapper.setProps({ connected: true, remoteConnectionId: 'remote-owner', authentication: { kind: 'codex', connected: true, state: { account: { type: 'chatgpt', email: 'fixture@example.test', planType: 'plus' }, requiresOpenaiAuth: true, login: { status: 'idle', error: null } } } });
    await flushPromises(); expect(wrapper.text()).toContain('3 available');
    expect(client.api.getBankedResets).toHaveBeenCalledExactlyOnceWith('remote-owner');
    await wrapper.setProps({ connected: false }); await flushPromises();
    expect(wrapper.text()).not.toContain('3 available'); wrapper.unmount(); client.dispose();
  });

  it('launches ChatGPT and keeps launch failures visible', async () => {
    const launchChatGptApp = vi.fn().mockRejectedValue(new Error('ChatGPT is unavailable.'));
    const wrapper = mountPanel({ launchChatGptApp });

    await wrapper.findAll('button').find((button) => button.text() === 'Launch ChatGPT')?.trigger('click');
    await flushPromises();

    expect(launchChatGptApp).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('ChatGPT is unavailable.');
  });
});

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(SettingsCodexPanel, {
    props: {
      settings: defaultGeneralSettings,
      ...props,
    },
  });
}
