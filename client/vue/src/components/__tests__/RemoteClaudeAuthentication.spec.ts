import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteConnection } from '@workspace/core/contracts';
import RemoteClaudeAuthentication from '../RemoteClaudeAuthentication.vue';

const connection: RemoteConnection = {
  id: 'wall-e', host: 'wall-e', name: 'wall-e', kind: 'ssh', status: 'ready', createdAt: '', updatedAt: '',
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('RemoteClaudeAuthentication', () => {
  it('offers subscription and Console sign-in commands and refreshes after login', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      const api = { getClaudeAuthentication: vi.fn().mockResolvedValue({ loggedIn: true }) };
      const wrapper = mount(RemoteClaudeAuthentication, { props: { connection, api } });
      await flushPromises();
      expect(api.getClaudeAuthentication).not.toHaveBeenCalled();

      expect(document.body.textContent).toContain('On wall-e, run one of these commands:');
      expect(document.body.textContent).toContain('Claude subscription');
      expect(document.body.textContent).toContain('Anthropic Console (API billing)');
      const commandRows = Array.from(document.body.querySelectorAll('.remote-claude-auth__command-row'));
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
      expect(api.getClaudeAuthentication).toHaveBeenCalledExactlyOnceWith('wall-e');
      expect(wrapper.text()).toContain('Claude connected');
      expect(document.body.querySelector('.remote-claude-auth__command')).toBeNull();
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('keeps the selected login home when an explicit status refresh fails and allows retry', async () => {
    const api = { getClaudeAuthentication: vi.fn().mockRejectedValueOnce(new Error('SSH disconnected')).mockResolvedValue({ loggedIn: false }) };
    const wrapper = mount(RemoteClaudeAuthentication, { props: { connection, api, authentication: { loggedIn: false, configDirectory: '/remote/claude-selected' } } });
    await flushPromises();
    (document.body.querySelector('.app-dialog__footer .app-button--primary') as HTMLButtonElement).click();
    await flushPromises();
    expect(wrapper.text()).toContain('Could not check Claude on this host.');
    expect(wrapper.text()).not.toContain('SSH disconnected');
    expect(document.body.querySelector('code')?.textContent).toContain("CLAUDE_CONFIG_DIR='/remote/claude-selected'");
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Claude subscription');
  });

  it('ignores a late response from another host and does not check offline connections', async () => {
    let resolveFirst!: (value: { loggedIn: boolean }) => void;
    const api = { getClaudeAuthentication: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue({ loggedIn: false }) };
    const wrapper = mount(RemoteClaudeAuthentication, { props: { connection, api } });
    (document.body.querySelector('.app-dialog__footer .app-button--primary') as HTMLButtonElement).click();
    await flushPromises();
    await wrapper.setProps({ connection: { ...connection, id: 'eve', host: 'eve' } });
    await flushPromises();
    resolveFirst({ loggedIn: true });
    await flushPromises();
    expect(document.body.textContent).toContain('Claude subscription');
    expect(wrapper.text()).not.toContain('Claude connected');
    expect(api.getClaudeAuthentication).toHaveBeenCalledExactlyOnceWith('wall-e');

    await wrapper.setProps({ connection: { ...connection, status: 'error' } });
    await flushPromises();
    expect(api.getClaudeAuthentication).toHaveBeenCalledOnce();
  });
});
