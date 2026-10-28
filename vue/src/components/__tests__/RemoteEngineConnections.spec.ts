import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { RemoteConnection } from '@workspace/core/contracts';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import RemoteEngineConnections from '../RemoteEngineConnections.vue';
import { ElSwitch } from 'element-plus';

const connection: RemoteConnection = {
  id: 'wall-e', host: 'wall-e', name: 'wall-e', kind: 'ssh', status: 'ready', createdAt: '', updatedAt: '',
};

afterEach(() => { configureAppClient(undefined); document.body.innerHTML = ''; });

describe('RemoteEngineConnections', () => {
  it('keeps Antigravity sign-in native without offering unsupported remote upgrades', async () => {
    const { api } = createClientApiMock();
    api.getProviderConnections.mockResolvedValue([{ backend: 'antigravity', installed: true, connected: false, checking: false }]);
    configureAppClient({ platform: 'desktop', api });
    const wrapper = mount(RemoteEngineConnections, { props: { connection } });
    await flushPromises();
    expect(wrapper.text()).toContain('Antigravity');
    expect(wrapper.find('[aria-label="Check for updates"]').exists()).toBe(false);
    expect(api.getProviderUpdate).not.toHaveBeenCalled();
    await wrapper.get('.form-row__control button').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('Sign in to Antigravity on the remote host');
    expect(api.authenticateProvider).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('toggles an authenticated remote engine from cached status without another auth check', async () => {
    const { api } = createClientApiMock();
    const engine = { backend: 'claude' as const, installed: true, connected: true, checking: false, enabled: true,
      authentication: { kind: 'claude' as const, connected: true, state: { loggedIn: true, account: { type: 'subscription' as const, email: 'user@example.com', subscription: 'pro' } } },
    };
    api.getProviderConnections.mockResolvedValue([engine]);
    api.setProviderEnabled.mockResolvedValueOnce([{ ...engine, enabled: false }]).mockResolvedValue([engine]);
    configureAppClient({ platform: 'desktop', api });
    const wrapper = mount(RemoteEngineConnections, { props: { connection }, global: { components: { ElSwitch } } });
    await flushPromises();
    const row = wrapper.get('.form-row');
    expect(row.text()).toContain('Claude Code');
    expect(row.text()).toContain('user@example.com · pro');
    expect(row.get('button').text()).toBe('Disconnect');
    expect(row.get('[role="switch"]').attributes('aria-label')).toBe('Enable engine · Claude Code');
    await wrapper.get('[role="switch"]').trigger('click');
    await flushPromises();
    expect(api.setProviderEnabled).toHaveBeenCalledExactlyOnceWith('claude', false, 'wall-e');
    expect(wrapper.get('.form-row__control button').text()).toBe('Disconnect');
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false');
    await wrapper.get('[role="switch"]').trigger('click');
    await flushPromises();
    expect(api.setProviderEnabled).toHaveBeenLastCalledWith('claude', true, 'wall-e');
    expect(wrapper.get('.form-row__control button').text()).toBe('Disconnect');
    expect(api.getClaudeAuthentication).not.toHaveBeenCalled();
    expect(api.disconnectProvider).not.toHaveBeenCalled();
  });

  it.each(['codex', 'claude'] as const)('keeps remote %s connected on logout failure and refreshes after successful logout', async backend => {
    const { api } = createClientApiMock();
    const engine = { backend, installed: true, connected: true, checking: false, enabled: false };
    api.getProviderConnections.mockResolvedValueOnce([engine]).mockResolvedValue([{ ...engine, connected: false }]);
    api.disconnectProvider.mockRejectedValueOnce(new Error('private CLI output')).mockResolvedValue({ kind: 'claude', connected: false, state: { loggedIn: false } });
    configureAppClient({ platform: 'desktop', api });
    const wrapper = mount(RemoteEngineConnections, { props: { connection } });
    await flushPromises();
    await wrapper.get('.form-row__control button').trigger('click');
    await flushPromises();
    expect(api.disconnectProvider).toHaveBeenCalledExactlyOnceWith(backend, 'wall-e');
    expect(wrapper.get('[role="alert"]').text()).toBe('Could not sign out. Please try again.');
    expect(wrapper.get('.form-row__control button').text()).toBe('Disconnect');
    await wrapper.get('.form-row__control button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('.form-row__control button').text()).toBe('Connect');
    expect(api.getProviderConnections).toHaveBeenLastCalledWith('wall-e');
    expect(api.setProviderEnabled).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['antigravity', 'codex', 'claude'] as const)('installs %s on its owning remote host and refreshes its availability without signing in', async (backend) => {
    const { api } = createClientApiMock();
    const engine = { backend, installed: false, connected: false, checking: false };
    api.getProviderConnections.mockResolvedValueOnce([engine]).mockResolvedValue([{ ...engine, installed: true }]);
    api.installProvider.mockResolvedValue({ backend: 'antigravity', installed: true, locked: false, isolated: true, shareSkills: false, homePath: '/remote/app/antigravity-home' });
    configureAppClient({ platform: 'desktop', api });
    const wrapper = mount(RemoteEngineConnections, { props: { connection } });
    await flushPromises();
    await wrapper.get('.provider-install-actions button').trigger('click');
    await flushPromises();
    expect(api.installProvider).toHaveBeenCalledExactlyOnceWith(backend, 'wall-e');
    expect(api.getProviderConnections).toHaveBeenLastCalledWith('wall-e');
    expect(wrapper.find('.provider-install-actions').exists()).toBe(false);
    expect(wrapper.get('.form-row__control button').text()).toBe('Connect');
    expect(api.authenticateProvider).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('rechecks the owning remote host after external installation and signs in separately', async () => {
    const { api } = createClientApiMock();
    const missing = (['codex', 'claude'] as const).map(backend => ({ backend, installed: false, connected: false, checking: false }));
    api.getProviderConnections.mockResolvedValueOnce(missing).mockResolvedValue([
      missing[0]!, { ...missing[1]!, installed: true },
    ]);
    api.refreshProvider.mockResolvedValue({ backend: 'claude', installed: true, locked: false, isolated: true, shareSkills: true, homePath: '/remote/app/claude-home' });
    api.getClaudeAuthentication.mockResolvedValue({ loggedIn: false, configDirectory: '/remote/app/claude-home' });
    configureAppClient({ platform: 'desktop', api });
    const wrapper = mount(RemoteEngineConnections, { props: { connection } });
    await flushPromises();

    expect(wrapper.findAll('.provider-install-actions')).toHaveLength(2);
    await wrapper.findAll('button').filter(button => button.attributes('aria-label') === 'Check again')[1]!.trigger('click');
    await flushPromises();
    expect(api.refreshProvider).toHaveBeenCalledExactlyOnceWith('claude', 'wall-e');
    expect(api.getProviderConnections).toHaveBeenLastCalledWith('wall-e');
    expect(api.getClaudeAuthentication).not.toHaveBeenCalled();
    expect(api.getCodexAuthentication).not.toHaveBeenCalled();
    await wrapper.findAll('button').find(button => button.text() === 'Connect')!.trigger('click');
    await flushPromises();
    expect(api.getClaudeAuthentication).toHaveBeenCalledWith('wall-e');
    await wrapper.findAll('button').find(button => button.text() === 'Connect Claude')!.trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain("CLAUDE_CONFIG_DIR='/remote/app/claude-home' claude auth login --console");
    wrapper.unmount();
  });

  it('shows the remote update error without inventing an available engine and lets users retry', async () => {
    const { api } = createClientApiMock();
    api.getProviderConnections.mockRejectedValueOnce(new Error(`Update ${product.name} on wall-e to report connected engines.`)).mockResolvedValue([]);
    configureAppClient({ platform: 'desktop', api });
    const wrapper = mount(RemoteEngineConnections, { props: { connection } });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(`Update ${product.name} on wall-e`);
    expect(wrapper.text()).not.toContain('Connect Codex');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(api.getProviderConnections).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
