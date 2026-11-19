import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteConnection } from '@workspace/core/contracts';
import RemoteTerminalAuthentication from '../RemoteTerminalAuthentication.vue';

const claude = (state: { loggedIn: boolean }) => ({ kind: 'claude' as const, connected: state.loggedIn, state });
const connection: RemoteConnection = {
  id: 'wall-e', host: 'wall-e', name: 'wall-e', kind: 'ssh', status: 'ready', createdAt: '', updatedAt: '',
};

const commands = [
  { label: 'Claude subscription', copyLabel: 'Copy Claude subscription command', copiedLabel: 'Claude subscription command copied', command: 'env -u CLAUDE_CONFIG_DIR claude auth login --claudeai' },
  { label: 'Anthropic Console (API billing)', copyLabel: 'Copy Anthropic Console command', copiedLabel: 'Anthropic Console command copied', command: 'env -u CLAUDE_CONFIG_DIR claude auth login --console' },
];
const props = { connection, provider: 'claude' as const, commands };

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('RemoteTerminalAuthentication', () => {
  it('offers subscription and Console sign-in commands and refreshes after login', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      const api = { authenticateProvider: vi.fn().mockResolvedValue(claude({ loggedIn: true })) };
      const wrapper = mount(RemoteTerminalAuthentication, { props: { ...props, api } });
      await flushPromises();
      expect(api.authenticateProvider).not.toHaveBeenCalled();

      expect(document.body.textContent).toContain('Run the sign-in command in a terminal on wall-e.');
      expect(document.body.textContent).toContain('Claude subscription');
      expect(document.body.textContent).toContain('Anthropic Console (API billing)');
      const commandRows = Array.from(document.body.querySelectorAll('.remote-terminal-auth__command-row'));
      expect(commandRows.map((row) => row.querySelector('code')?.textContent)).toEqual([
        'env -u CLAUDE_CONFIG_DIR claude auth login --claudeai',
        'env -u CLAUDE_CONFIG_DIR claude auth login --console',
      ]);
      (commandRows[0]?.querySelector('[aria-label="Copy Claude subscription command"]') as HTMLButtonElement).click();
      await flushPromises();
      expect(writeText).toHaveBeenLastCalledWith('env -u CLAUDE_CONFIG_DIR claude auth login --claudeai');
      (commandRows[1]?.querySelector('[aria-label="Copy Anthropic Console command"]') as HTMLButtonElement).click();
      await flushPromises();
      expect(writeText).toHaveBeenLastCalledWith('env -u CLAUDE_CONFIG_DIR claude auth login --console');
      expect(writeText).toHaveBeenCalledTimes(2);
      (document.body.querySelector('.app-dialog__footer .app-button--primary') as HTMLButtonElement).click();
      await flushPromises();
      expect(api.authenticateProvider).toHaveBeenCalledExactlyOnceWith('claude', 'check', { remoteConnectionId: 'wall-e' });
      expect(wrapper.emitted('connected')).toEqual([[]]);
      expect(document.body.querySelector('.remote-terminal-auth__command')).toBeNull();
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('keeps the commands visible when the account check fails and allows retry', async () => {
    const api = { authenticateProvider: vi.fn().mockRejectedValueOnce(new Error('SSH disconnected')).mockResolvedValue(claude({ loggedIn: false })) };
    const wrapper = mount(RemoteTerminalAuthentication, { props: { ...props, api } });
    await flushPromises();
    (document.body.querySelector('.app-dialog__footer .app-button--primary') as HTMLButtonElement).click();
    await flushPromises();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Could not verify sign-in on wall-e.');
    expect(document.body.textContent).not.toContain('SSH disconnected');
    expect(document.body.querySelector('code')?.textContent).toBe(commands[0]?.command);
    (document.body.querySelector('.app-dialog__footer .app-button--primary') as HTMLButtonElement).click();
    await flushPromises();
    expect(api.authenticateProvider).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted('checked')).toEqual([[claude({ loggedIn: false })]]);
  });

  it('ignores a late response from another host and does not check offline connections', async () => {
    let resolveFirst!: (value: { loggedIn: boolean }) => void;
    const api = { authenticateProvider: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = state => resolve(claude(state)); }))
      .mockResolvedValue(claude({ loggedIn: false })) };
    const wrapper = mount(RemoteTerminalAuthentication, { props: { ...props, api } });
    (document.body.querySelector('.app-dialog__footer .app-button--primary') as HTMLButtonElement).click();
    await flushPromises();
    await wrapper.setProps({ connection: { ...connection, id: 'eve', host: 'eve' } });
    await flushPromises();
    resolveFirst({ loggedIn: true });
    await flushPromises();
    expect(document.body.textContent).toContain('Claude subscription');
    expect(wrapper.emitted('connected')).toBeUndefined();
    expect(api.authenticateProvider).toHaveBeenCalledExactlyOnceWith('claude', 'check', { remoteConnectionId: 'wall-e' });

    await wrapper.setProps({ connection: { ...connection, status: 'error' } });
    await flushPromises();
    expect(api.authenticateProvider).toHaveBeenCalledOnce();
  });
});
