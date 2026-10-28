import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteConnection } from '@workspace/core/contracts';
import { ElMessageBox } from 'element-plus';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock as createBaseClientApiMock } from '../../test/client-api-mock';
import RemoteEngineConnections from '../RemoteEngineConnections.vue';
function createClientApiMock() {
  const result = createBaseClientApiMock();
  result.api.getProviderUpdate.mockImplementation(async backend => ({ backend, status: 'current', installedVersion: '1.0', method: 'npm', canUpgrade: false, busy: false }));
  return result;
}

async function openMenu(wrapper: ReturnType<typeof mount>, index = 0) {
  await wrapper.findAll('button[aria-haspopup="menu"]')[index]!.trigger('click');
  await flushPromises();
}
function menuItem(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button => button.textContent?.trim() === label);
  if (!button) throw new Error(`Missing menu item: ${label}`);
  return button;
}
async function choose(wrapper: ReturnType<typeof mount>, label: string, index = 0) {
  await openMenu(wrapper, index);
  menuItem(label).click();
  await flushPromises();
}

const connection: RemoteConnection = {
  id: 'wall-e', host: 'wall-e', name: 'wall-e', kind: 'ssh', status: 'ready', createdAt: '', updatedAt: '',
};

beforeEach(() => { vi.spyOn(window, 'open').mockReturnValue(null); });
afterEach(() => { vi.useRealTimers(); configureAppClient(undefined); document.body.innerHTML = ''; vi.restoreAllMocks(); });

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
  it('keeps the connected account on one row and routes refresh and upgrade actions to its host', async () => {
    const { api } = createClientApiMock();
    const engine = { backend: 'claude' as const, installed: true, connected: true, checking: false,
      authentication: { kind: 'claude' as const, connected: true, state: { loggedIn: true, account: { type: 'subscription' as const, email: 'user@example.com', subscription: 'pro' } } },
    };
    api.getProviderConnections.mockResolvedValue([engine]);
    const update = { backend: 'claude' as const, status: 'available' as const, installedVersion: '1.0', latestVersion: '2.0', method: 'native' as const, canUpgrade: true, busy: false, token: 'verified-installation' };
    api.getProviderUpdate.mockResolvedValue(update);
    api.setProviderUpdate.mockResolvedValue({ ...update, status: 'current', installedVersion: '2.0', canUpgrade: false });
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    configureAppClient({ platform: 'desktop', api });
    const wrapper = mount(RemoteEngineConnections, { props: { connection } });
    await flushPromises();
    const row = wrapper.get('.form-row');
    expect(row.text()).toContain('user@example.com · pro');
    expect(row.text()).toContain('1.0');
    await choose(wrapper, 'Check for updates');
    expect(api.getProviderUpdate).toHaveBeenLastCalledWith('claude', 'wall-e', true);
    await row.findAll('button').find(button => button.text() === 'Update')!.trigger('click');
    await flushPromises();
    expect(api.setProviderUpdate).toHaveBeenCalledExactlyOnceWith('claude', { action: 'upgrade', confirmed: true, token: 'verified-installation' }, 'wall-e');
    expect(row.text()).toContain('2.0');
    expect(api.getClaudeAuthentication).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['codex', 'claude'] as const)('keeps remote %s connected on logout failure and refreshes after successful logout', async backend => {
    const { api } = createClientApiMock();
    const engine = { backend, installed: true, connected: true, checking: false, enabled: false };
    api.getProviderConnections.mockResolvedValueOnce([engine]).mockResolvedValue([{ ...engine, connected: false }]);
    api.disconnectProvider.mockRejectedValueOnce(new Error('private CLI output')).mockResolvedValue({ kind: 'claude', connected: false, state: { loggedIn: false } });
    configureAppClient({ platform: 'desktop', api });
    const wrapper = mount(RemoteEngineConnections, { props: { connection } });
    await flushPromises();
    await choose(wrapper, 'Disconnect');
    expect(api.disconnectProvider).toHaveBeenCalledExactlyOnceWith(backend, 'wall-e');
    expect(wrapper.get('[role="alert"]').text()).toBe('Could not sign out. Please try again.');
    await choose(wrapper, 'Disconnect');
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
    await wrapper.findAll('button').find(button => button.text() === 'Install')!.trigger('click');
    await flushPromises();
    expect(api.installProvider).toHaveBeenCalledExactlyOnceWith(backend, 'wall-e');
    expect(api.getProviderConnections).toHaveBeenLastCalledWith('wall-e');
    expect(wrapper.find('.provider-install-actions').exists()).toBe(false);
    expect(wrapper.get('.form-row__control button').text()).toBe('Connect');
    expect(api.authenticateProvider).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['codex', 'claude'] as const)('rechecks external installation and starts %s sign-in with one Connect click', async backend => {
    vi.useFakeTimers();
    const { api } = createClientApiMock();
    const missing = (['codex', 'claude'] as const).map(backend => ({ backend, installed: false, connected: false, checking: false }));
    api.getProviderConnections.mockResolvedValueOnce(missing).mockResolvedValue(missing.map(engine => ({ ...engine, installed: engine.backend === backend, enabled: false, ...(engine.backend === 'claude' ? { authentication: { kind: 'claude' as const, connected: false, state: { loggedIn: false, configDirectory: '/remote/app/claude-home' } } } : {}) })));
    api.refreshProvider.mockResolvedValue({ backend, installed: true, locked: false, isolated: true, shareSkills: true, homePath: '/remote/app/claude-home' });
    api.getClaudeAuthentication.mockResolvedValue({ loggedIn: false, configDirectory: '/remote/app/claude-home' });
    api.getCodexAuthentication.mockResolvedValue({ account: null, requiresOpenaiAuth: true, login: { status: 'idle', error: null } });
    api.cancelCodexChatGptLogin.mockResolvedValue({ account: null, requiresOpenaiAuth: true, login: { status: 'cancelled', error: null } });
    api.startCodexChatGptDeviceCodeLogin.mockResolvedValue({ loginId: 'remote-login', userCode: 'REMOTE-CODE', verificationUrl: 'https://auth.openai.com/codex/device' });
    if (backend === 'codex') api.startCodexChatGptDeviceCodeLogin.mockRejectedValueOnce(new Error('Temporary login error'));
    configureAppClient({ platform: 'desktop', api });
    const wrapper = mount(RemoteEngineConnections, { props: { connection } });
    await flushPromises();

    expect(wrapper.findAll('button').filter(button => button.text() === 'Install')).toHaveLength(2);
    await choose(wrapper, 'Refresh status', backend === 'codex' ? 0 : 1);
    expect(api.refreshProvider).toHaveBeenCalledExactlyOnceWith(backend, 'wall-e');
    expect(api.getProviderConnections).toHaveBeenLastCalledWith('wall-e');
    expect(api.getClaudeAuthentication).not.toHaveBeenCalled();
    expect(api.getCodexAuthentication).not.toHaveBeenCalled();
    await wrapper.findAll('button').find(button => button.text() === 'Connect')!.trigger('click');
    await flushPromises();
    if (backend === 'claude') {
      expect(api.getClaudeAuthentication).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("CLAUDE_CONFIG_DIR='/remote/app/claude-home' claude auth login --console");
    } else {
      expect(api.startCodexChatGptDeviceCodeLogin).toHaveBeenCalledExactlyOnceWith('wall-e');
      expect(wrapper.emitted('activity')?.at(-1)).toStrictEqual([false]);
      await wrapper.findAll('button').find(button => button.text() === 'Retry sign-in')!.trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('REMOTE-CODE');
      expect(wrapper.emitted('activity')?.at(-1)).toStrictEqual([true]);
    }
    const connected = [{ backend, installed: true, connected: true, checking: false, enabled: true }];
    api.setProviderEnabled.mockResolvedValue(connected);
    api.getProviderConnections.mockResolvedValue(connected);
    if (backend === 'claude') {
      api.getClaudeAuthentication.mockResolvedValue({ loggedIn: true, configDirectory: '/remote/app/claude-home' });
      (document.body.querySelector('.app-dialog__footer .app-button--primary') as HTMLButtonElement).click();
    } else {
      api.getCodexAuthentication.mockResolvedValue({ account: { type: 'chatgpt', email: 'remote@example.com', planType: 'plus' }, requiresOpenaiAuth: true, login: { status: 'completed', error: null } });
      await vi.advanceTimersByTimeAsync(2_000);
    }
    await flushPromises();
    expect(api.setProviderEnabled).toHaveBeenCalledExactlyOnceWith(backend, true, 'wall-e');
    expect(wrapper.get('.form-row').text()).toContain('Connected');
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
