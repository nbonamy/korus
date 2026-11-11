import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppApi, CodexAuthentication, RemoteConnection } from '@workspace/core/contracts';
import RemoteCodexAuthentication from '../RemoteCodexAuthentication.vue';
import { configureElectronTestClient } from '../../../tests/support/client';

const connection: RemoteConnection = { id: 'wall-e', host: 'wall-e', name: 'wall-e', kind: 'ssh', status: 'ready', createdAt: '', updatedAt: '' };
const signedOut: CodexAuthentication = { account: null, requiresOpenaiAuth: true, login: { status: 'idle', error: null } };
const pending = { method: 'deviceCode' as const, id: 'login-wall-e', url: 'https://auth.openai.com/codex/device', code: 'ABCD-EFGH' };
const codex = (state: CodexAuthentication) => ({ kind: 'codex' as const, connected: Boolean(state.account), state });
/** Per-action scripts behind the neutral sign-in call, each receiving the host it targets. */
function api() {
  const check = vi.fn<(host: string) => Promise<CodexAuthentication>>().mockResolvedValue(signedOut);
  const login = vi.fn<(host: string) => Promise<typeof pending>>().mockResolvedValue(pending);
  const cancel = vi.fn<(host: string, loginId: string) => Promise<CodexAuthentication>>().mockResolvedValue(signedOut);
  const authenticateProvider = vi.fn<AppApi['authenticateProvider']>(async (provider, action, options = {}) => {
    const host = options.remoteConnectionId;
    if (provider !== 'codex' || !host) throw new Error(`Unexpected ${provider} authentication on ${host ?? 'this computer'}.`);
    if (action === 'check') return codex(await check(host));
    if (action === 'login' && options.method === 'deviceCode') return { ...codex({ ...signedOut, login: { status: 'pending', error: null } }), login: await login(host) };
    if (action === 'cancel' && options.loginId) return codex(await cancel(host, options.loginId));
    throw new Error(`Unexpected ${action} authentication.`);
  });
  return { authenticateProvider, check, login, cancel };
}
function render(client = api()) {
  return { client, wrapper: mount(RemoteCodexAuthentication, { props: { connection, api: client } }) };
}
beforeEach(() => { vi.spyOn(window, 'open').mockReturnValue(null); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('RemoteCodexAuthentication', () => {
  it('copies only the device code, confirms success, and allows retry after clipboard failure', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockRejectedValueOnce(new Error('Clipboard unavailable')).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      const { wrapper } = render();
      await flushPromises();
      await wrapper.get('[aria-label="Copy device code"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('Could not copy');
      await wrapper.get('[aria-label="Copy device code"]').trigger('click');
      await flushPromises();
      expect(writeText.mock.calls).toStrictEqual([[pending.code], [pending.code]]);
      expect(wrapper.find('[aria-label="Device code copied"]').exists()).toBe(true);
      expect(wrapper.text()).not.toContain('Could not copy');
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('starts login immediately on the selected host and polls until the SDK reports its account', async () => {
    vi.useFakeTimers();
    const { client, wrapper } = render();
    await flushPromises();
    expect(client.check).toHaveBeenCalledWith('wall-e');

    expect(client.login).toHaveBeenCalledExactlyOnceWith('wall-e');
    expect(window.open).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain(pending.code);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await wrapper.findAll('button').find(button => button.text() === 'Open sign-in page')!.trigger('click');
    expect(open).toHaveBeenCalledWith(pending.url, '_blank', 'noopener,noreferrer');
    client.check.mockResolvedValue({ ...signedOut, account: { type: 'chatgpt', email: 'remote@example.com', planType: 'plus' }, login: { status: 'completed', error: null } });
    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();
    expect(wrapper.text()).toContain('Codex connected');
    expect(wrapper.text()).toContain('remote@example.com');
    expect(wrapper.text()).not.toContain(pending.code);
    const calls = client.check.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(client.check).toHaveBeenCalledTimes(calls);
    wrapper.unmount();
    expect(client.cancel).not.toHaveBeenCalled();
  });

  it('cancels exactly the pending login and preserves it across unrelated connection metadata refreshes', async () => {
    const { client, wrapper } = render();
    await flushPromises();
    await wrapper.setProps({ connection: { ...connection, detail: 'Refreshed versions' } });
    expect(wrapper.text()).toContain(pending.code);
    expect(client.cancel).not.toHaveBeenCalled();
    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click');
    await flushPromises();
    expect(client.cancel).toHaveBeenCalledWith('wall-e', 'login-wall-e');
    expect(wrapper.text()).not.toContain(pending.code);
  });

  it('cancels a late login result after the row has been unmounted', async () => {
    let resolve!: (value: typeof pending) => void;
    const client = api();
    client.login.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { wrapper } = render(client);
    await flushPromises();
    wrapper.unmount();
    resolve(pending);
    await flushPromises();
    expect(client.cancel).toHaveBeenCalledWith('wall-e', pending.id);
  });

  it('shows SDK login failures and lets the user retry', async () => {
    const client = api();
    client.login.mockRejectedValueOnce(new Error('Device code login unavailable'));
    const { wrapper } = render(client);
    await flushPromises();
    expect(wrapper.text()).toContain('Device code login unavailable');
    expect(wrapper.get('button').text()).toBe('Retry sign-in');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain(pending.code);
  });

  it('retries an unavailable Codex account check and starts sign-in without another click', async () => {
    const client = api();
    client.check.mockRejectedValueOnce(new Error("Error invoking remote method 'provider:authenticate': Error: Codex app-server transport is not started"));
    const { wrapper } = render(client);
    await flushPromises();
    expect(wrapper.text()).toContain('Could not check Codex on this host.');
    expect(wrapper.text()).not.toContain('transport is not started');
    expect(wrapper.get('button').text()).toBe('Retry account check');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain(pending.code);
    expect(client.login).toHaveBeenCalledExactlyOnceWith('wall-e');
  });

  it('reports login expiry and clears the code', async () => {
    vi.useFakeTimers();
    const { client, wrapper } = render();
    await flushPromises();
    client.check.mockResolvedValue({ ...signedOut, login: { status: 'error', error: 'Code expired' } });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(wrapper.text()).toContain('Code expired');
    expect(wrapper.text()).not.toContain(pending.code);
  });

  it('does not apply a late account response from the previously selected host', async () => {
    let resolve!: (value: CodexAuthentication) => void;
    const client = api();
    client.check.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { wrapper } = render(client);
    await wrapper.setProps({ connection: { ...connection, id: 'eve' } });
    await flushPromises();
    resolve({ ...signedOut, account: { type: 'apiKey' } });
    await flushPromises();
    expect(wrapper.text()).toContain(pending.code);
    expect(wrapper.text()).not.toContain('Codex connected');
    expect(client.check).toHaveBeenLastCalledWith('eve');
  });

  it('uses the platform client and does not query an offline connection', async () => {
    const client = api();
    configureElectronTestClient(client);
    const wrapper = mount(RemoteCodexAuthentication, { props: { connection: { ...connection, status: 'error' } } });
    await flushPromises();
    expect(client.check).not.toHaveBeenCalled();
    await wrapper.setProps({ connection });
    await flushPromises();
    expect(client.check).toHaveBeenCalledWith(connection.id);
    expect(wrapper.text()).toContain(pending.code);
  });

  it('keeps the code available when cancellation fails and allows another attempt', async () => {
    const { client, wrapper } = render();
    await flushPromises();
    client.cancel.mockRejectedValueOnce('SSH disconnected');
    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('SSH disconnected');
    expect(wrapper.text()).toContain(pending.code);
    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain(pending.code);
  });

  it('retries transient polling failures and stops polling when unmounted', async () => {
    vi.useFakeTimers();
    const { client, wrapper } = render();
    await flushPromises();
    client.check.mockRejectedValueOnce('Connection lost');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(wrapper.text()).toContain('Connection lost');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(wrapper.text()).not.toContain('Connection lost');
    client.cancel.mockRejectedValueOnce(new Error('Offline'));
    wrapper.unmount();
    await flushPromises();
    const calls = client.check.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(client.check).toHaveBeenCalledTimes(calls);
    expect(client.cancel).toHaveBeenCalledWith(connection.id, pending.id);
  });
});
