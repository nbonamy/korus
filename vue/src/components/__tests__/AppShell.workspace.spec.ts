import { product } from '@workspace/core/product';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import type {
  CodexNativeRendererApi,
} from '@codex-app-sdk/vue';
import type { SurfaceMessage } from '@codex-app-sdk/core/surface';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShell from '../AppShell.vue';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppCommand, AppApi } from '@workspace/core/contracts';
import { workItemAssignmentPrompt, workItemComposerPrompt } from '@workspace/core/work-item-prompts';
import { setElectronTestClient } from '../../test/client';
import { codexConversationSnapshot, codexTextMessage } from '../../test/codex-conversation-fixtures';
import { useConfetti } from '../../shared/confetti/use-confetti';

import {
  conversationControllerActions,
  mountShell as mountRealShell,
  readyBrowserGuest,
  workItem,
} from './app-shell-test-harness';

/** Workspace persistence is debounced; wait past the window. */
const settlePersistence = async () => { await new Promise(resolve => setTimeout(resolve, 300)); await flushPromises(); };
const mountShell: typeof mountRealShell = (overrides = {}) => mountRealShell({
  ...overrides,
  stubTeamRail: true,
});

vi.mock('../image-annotation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../image-annotation')>(),
  centeredImageCropDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,centered-fallback'),
}));

vi.mock('../../shared/confetti/canvas-celebration', () => ({
  launchCanvasCelebration: vi.fn(),
}));

afterEach(() => {
  useConfetti().clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.removeItem('cockpitGlobalScope:github');
  window.sessionStorage.clear();
  document.body.innerHTML = '';
  delete window.app;
  delete (window as Window & { codexAppSdkNative?: CodexNativeRendererApi }).codexAppSdkNative;
});

describe('AppShell workspace and plans', () => {
  it('persists browser navigation and reopens primary and additional browsers in a fresh workspace', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    let stored: import('@workspace/core/document-workspace').DocumentWorkspace = {
      tabs: [
        { id: 'browser', title: 'browser', browser: { id: 'primary', url: 'https://example.com/start' } },
        { id: 'browser:docs', title: 'Docs', browser: { id: 'docs', url: 'https://example.org/docs' } },
      ], activeTab: 'browser', open: true, width: 420, filesPaneOpen: false, filesPaneWidth: 280,
    };
    const browserState = (url: string) => ({ url, title: '', canGoBack: false, canGoForward: false });
    const browserOpen = vi.fn(async (_agent: string, _browser: string, url: string) => browserState(url));
    setElectronTestClient({
      getDocumentWorkspaces: async () => ({ 'agent-dina': structuredClone(stored) }),
      updateDocumentWorkspace: async (_agent, change) => {
        for (const tab of change.upsert ?? []) {
          const index = stored.tabs.findIndex(old => old.id === tab.id);
          if (index < 0) stored.tabs.push(structuredClone(tab)); else stored.tabs[index] = structuredClone(tab);
        }
        stored = { ...stored, activeTab: change.activeTab ?? stored.activeTab };
        return structuredClone(stored);
      },
      browserOpen, browserNavigate: vi.fn(async (_agent, _browser, url) => browserState(url)),
      browserSetBounds: vi.fn().mockResolvedValue(undefined), browserSetVisible: vi.fn().mockResolvedValue(undefined),
      browserClose: vi.fn().mockResolvedValue(undefined), browserGetZoom: vi.fn().mockResolvedValue(1),
    });
    const wrapper = mountShell(); await flushPromises();
    expect(wrapper.findAll('webview')).toHaveLength(2);
    wrapper.findAll('webview').forEach((guest, index) => readyBrowserGuest(guest.element, 42 + index));
    await flushPromises();
    expect(browserOpen).toHaveBeenCalledWith('agent-dina', 'primary', 'https://example.com/start', 42);
    expect(browserOpen).toHaveBeenCalledWith('agent-dina', 'docs', 'https://example.org/docs', 43);
    const addresses = wrapper.findAll('[aria-label="Browser address"]');
    await addresses[0]!.setValue('https://example.com/latest?q=one#section');
    await wrapper.findAll('.browser-panel__address')[0]!.trigger('submit'); await flushPromises();
    await addresses[1]!.setValue('https://example.org/next');
    await wrapper.findAll('.browser-panel__address')[1]!.trigger('submit'); await flushPromises();
    await settlePersistence();
    expect(stored.tabs.map(tab => tab.browser?.url)).toEqual(['https://example.com/latest?q=one#section', 'https://example.org/next']);
    wrapper.unmount(); browserOpen.mockClear();
    const restarted = mountShell(); await flushPromises();
    restarted.findAll('webview').forEach((guest, index) => readyBrowserGuest(guest.element, 52 + index));
    await flushPromises();
    expect(browserOpen).toHaveBeenCalledWith('agent-dina', 'primary', 'https://example.com/latest?q=one#section', 52);
    expect(browserOpen).toHaveBeenCalledWith('agent-dina', 'docs', 'https://example.org/next', 53);
    restarted.unmount();
  });

  it('restores document tabs, selected tab and collapsed layout, and retains an inactive-agent display', async () => {
    const tabId = 'file:markdown:restored';
    const saved = { tabs: [{ id: tabId, title: 'Restored proposal', documentId: 'restored' }], activeTab: tabId, open: false, width: 610, filesPaneOpen: false, filesPaneWidth: 280 };
    const update = vi.fn().mockResolvedValue(saved);
    setElectronTestClient({
      getDocumentWorkspaces: vi.fn().mockResolvedValue({ 'agent-dina': saved }),
      readWorkspaceDocument: vi.fn().mockResolvedValue({ content: '# Exact restored content' }),
      updateDocumentWorkspace: update,
    });
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({ snapshot });
    await flushPromises();
    const panel = wrapper.findAll('[aria-label="Right workspace"]')[0]!;
    expect(panel.isVisible()).toBe(false);
    expect(panel.attributes('style')).toContain('610px');
    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    expect(wrapper.get('[role="tab"][aria-label="Restored proposal"]').attributes('aria-selected')).toBe('true');
    expect(panel.text()).toContain('Exact restored content');
    await wrapper.setProps({ sidePanelRequest: { kind: 'markdown', agentId: 'agent-jesse', documentId: 'background', title: 'Background proposal', content: '# Background content' } });
    expect(wrapper.emitted('select-agent')).toBeUndefined();
    expect(panel.attributes('style')).not.toContain('display: none');
    await wrapper.setProps({ activeAgent: snapshot.agents[1] });
    expect(wrapper.findAll('[aria-label="Right workspace"]')[1]!.text()).toContain('Background content');
    await wrapper.get('[aria-label="Close Background proposal tab"]').trigger('click');
    await settlePersistence();
    expect(update).toHaveBeenCalledWith('agent-jesse', expect.objectContaining({ close: ['file:markdown:background'] }));
  });

  it('saves through the rendered action without duplicating the tab and preserves it on cancellation or write failure', async () => {
    const tabId = 'file:markdown:proposal';
    const saved = { tabs: [{ id: tabId, title: 'Proposal', documentId: 'proposal' }], activeTab: tabId, open: true, width: 420, filesPaneOpen: false, filesPaneWidth: 280 };
    const choose = vi.fn().mockResolvedValueOnce(null).mockResolvedValue('/work/saved.md');
    const save = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue({ ...saved, tabs: [{ id: tabId, title: 'saved.md', savedPath: '/work/saved.md' }] });
    const update = vi.fn().mockResolvedValue(saved);
    setElectronTestClient({ getDocumentWorkspaces: vi.fn().mockResolvedValue({ 'agent-dina': saved }), readWorkspaceDocument: vi.fn().mockResolvedValue({ content: '# Keep this' }), updateDocumentWorkspace: update, chooseDocumentSavePath: choose, saveWorkspaceDocument: save });
    const snapshot = createInitialSnapshot(); snapshot.agents[0]!.folder = '/work/branch';
    const wrapper = mountShell({ snapshot });
    await flushPromises();
    const clickSave = async () => { await wrapper.get('button[aria-label^="Save "][aria-label$=" as…"]').trigger('click'); await flushPromises(); };
    await clickSave();
    expect(choose).toHaveBeenCalledWith('/work/branch/Proposal.md');
    expect(save).not.toHaveBeenCalled();
    await clickSave();
    expect(wrapper.text()).toContain('Keep this');
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
    await clickSave();
    expect(save).toHaveBeenLastCalledWith('agent-dina', { tabId, path: '/work/saved.md', overwrite: true });
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toStrictEqual(['saved.md']);
    expect(wrapper.find('button[aria-label^="Save "][aria-label$=" as…"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Close saved.md tab"]').trigger('click');
    await settlePersistence();
    expect(update).toHaveBeenLastCalledWith('agent-dina', expect.objectContaining({ close: [tabId] }));
  });

  it('coalesces a burst of layout changes into one backend update', async () => {
    const tabId = 'file:markdown:burst';
    const saved = { tabs: [{ id: tabId, title: 'Burst', documentId: 'burst' }], activeTab: tabId, open: false, width: 420, filesPaneOpen: false, filesPaneWidth: 280 };
    const update = vi.fn().mockResolvedValue(saved);
    setElectronTestClient({ getDocumentWorkspaces: vi.fn().mockResolvedValue({ 'agent-dina': saved }), readWorkspaceDocument: vi.fn().mockResolvedValue({ content: '# Burst' }), updateDocumentWorkspace: update });
    const wrapper = mountShell(); await flushPromises();
    await settlePersistence();
    update.mockClear();
    const toggle = wrapper.get('[aria-label="Toggle right workspace"]');
    await toggle.trigger('click'); await toggle.trigger('click'); await toggle.trigger('click');
    expect(update).not.toHaveBeenCalled();
    await settlePersistence();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('agent-dina', expect.objectContaining({ open: true, upsert: [], close: [] }));
    wrapper.unmount();
  });

  it('does not resurrect a tab closed while restoration is still pending', async () => {
    const tabId = 'file:markdown:race';
    const saved = { tabs: [{ id: tabId, title: 'Race proposal', documentId: 'race' }], activeTab: tabId, open: true, width: 420, filesPaneOpen: false, filesPaneWidth: 280 };
    let restore!: (value: Record<string, typeof saved>) => void;
    const update = vi.fn().mockResolvedValue(saved);
    setElectronTestClient({ getDocumentWorkspaces: () => new Promise(resolve => { restore = resolve; }), updateDocumentWorkspace: update });
    const wrapper = mountShell();
    await wrapper.setProps({ sidePanelRequest: { kind: 'markdown', agentId: 'agent-dina', documentId: 'race', title: 'Race proposal', content: '# Retain until closed' } });
    await wrapper.get('[aria-label="Close Race proposal tab"]').trigger('click');
    restore({ 'agent-dina': saved });
    await flushPromises();
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(update).toHaveBeenCalledWith('agent-dina', expect.objectContaining({ close: [tabId] }));
  });

  it('uses the remote owning folder and preserves the document when replacement is rejected', async () => {
    const tabId = 'file:markdown:remote';
    const saved = { tabs: [{ id: tabId, title: 'Remote proposal', documentId: 'remote' }], activeTab: tabId, open: true, width: 420, filesPaneOpen: false, filesPaneWidth: 280 };
    const nativeDialog = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('File already exists. Confirm replacement to save.'));
    setElectronTestClient({ getDocumentWorkspaces: vi.fn().mockResolvedValue({ 'agent-dina': saved }), readWorkspaceDocument: vi.fn().mockResolvedValue({ content: '# Remote content' }), updateDocumentWorkspace: vi.fn().mockResolvedValue(saved), chooseDocumentSavePath: nativeDialog, saveWorkspaceDocument: save });
    const snapshot = createInitialSnapshot();
    snapshot.teams[0]!.remoteConnectionId = 'remote-test'; snapshot.agents[0]!.folder = '/remote/worktree';
    const wrapper = mountShell({ snapshot }); await flushPromises();
    await wrapper.get('button[aria-label^="Save "][aria-label$=" as…"]').trigger('click'); await flushPromises();
    const box = new DOMWrapper(document.querySelector('.el-message-box')!);
    expect((box.get('input').element as HTMLInputElement).value).toBe('/remote/worktree/Remote proposal.md');
    expect(box.get('.el-button--primary').text()).toBe('Save');
    await box.get('.el-button--primary').trigger('click'); await flushPromises();
    const replacement = new DOMWrapper(Array.from(document.querySelectorAll('.el-message-box')).at(-1)!);
    expect(replacement.text()).toContain('Replace the existing file?');
    await replacement.get('.el-message-box__btns .el-button:not(.el-button--primary)').trigger('click'); await flushPromises();
    expect(nativeDialog).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledExactlyOnceWith('agent-dina', { tabId, path: '/remote/worktree/Remote proposal.md', overwrite: false });
    expect(wrapper.get('[role="tab"]').text()).toBe('Remote proposal');
    expect(wrapper.text()).toContain('Remote content');
  });

  it('does not recreate a tab when its pending Save As finishes after it was closed', async () => {
    const tabId = 'file:markdown:saving';
    const saved = { tabs: [{ id: tabId, title: 'Saving', documentId: 'saving' }], activeTab: tabId, open: true, width: 420, filesPaneOpen: false, filesPaneWidth: 280 };
    let finishSave!: (result: import('@workspace/core/document-workspace').DocumentWorkspace) => void;
    setElectronTestClient({ getDocumentWorkspaces: vi.fn().mockResolvedValue({ 'agent-dina': saved }), readWorkspaceDocument: vi.fn().mockResolvedValue({ content: '# Content' }), updateDocumentWorkspace: vi.fn().mockResolvedValue(saved), chooseDocumentSavePath: vi.fn().mockResolvedValue('/work/saved.md'), saveWorkspaceDocument: () => new Promise(resolve => { finishSave = resolve; }) });
    const wrapper = mountShell(); await flushPromises();
    await wrapper.get('button[aria-label^="Save "][aria-label$=" as…"]').trigger('click'); await flushPromises();
    await wrapper.get('[aria-label="Close Saving tab"]').trigger('click');
    finishSave({ ...saved, tabs: [{ id: tabId, title: 'saved.md', savedPath: '/work/saved.md' }] });
    await flushPromises();
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
  });

  it('opens every document delivered in one render batch without changing agents', async () => {
    const wrapper = mountShell();
    await wrapper.setProps({ markdownDisplayRequests: [
      { kind: 'markdown', agentId: 'agent-dina', documentId: 'one', title: 'Same title', content: '# One' },
      { kind: 'markdown', agentId: 'agent-dina', documentId: 'two', title: 'Same title', content: '# Two' },
      { kind: 'markdown', agentId: 'agent-jesse', documentId: 'three', title: 'Background', content: '# Three' },
    ] });
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toEqual(['Same title', 'Same title', 'Background']);
    expect(wrapper.emitted('consume-markdown-displays')).toEqual([[3]]);
    expect(wrapper.emitted('select-agent')).toBeUndefined();
  });

  it('keeps a missing referenced file visible and closeable', async () => {
    const tabId = 'file:missing.md';
    setElectronTestClient({
      getDocumentWorkspaces: vi.fn().mockResolvedValue({ 'agent-dina': { tabs: [{ id: tabId, title: 'missing.md', path: 'missing.md' }], activeTab: tabId, open: true, width: 420, filesPaneOpen: false, filesPaneWidth: 280 } }),
      readWorkspaceDocument: vi.fn().mockResolvedValue({ content: '', error: 'File is missing. You can close this tab.' }),
      updateDocumentWorkspace: vi.fn().mockResolvedValue({ tabs: [] }),
    });
    const wrapper = mountShell(); await flushPromises();
    expect(wrapper.text()).toContain('File is missing. You can close this tab.');
    await wrapper.get('[aria-label="Close missing.md tab"]').trigger('click');
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
  });

  it('downloads an unsupported chat file without opening a workspace tab', async () => {
    const readAgentFileChunk = vi.fn().mockResolvedValue({ path: 'film.mp4', size: 2, data: 'AAE=', nextOffset: 2 });
    setElectronTestClient({ readAgentFileChunk });
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:film');
      static revokeObjectURL = vi.fn();
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('film.mp4');
    });
    try {
      const wrapper = mountShell({
        realConversationPane: true,
        previewAgentFile: vi.fn().mockResolvedValue({ path: 'film.mp4', kind: 'binary', size: 2 }),
        codexConversationSnapshot: codexConversationSnapshot([
          codexTextMessage('video', 'assistant', '[Film](film.mp4)'),
        ]),
      });
      await wrapper.get('a[href="film.mp4"]').trigger('click');
      await flushPromises();
      expect(readAgentFileChunk).toHaveBeenCalledWith('agent-dina', 'film.mp4', 0);
      expect(download).toHaveBeenCalledOnce();
      expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
      expect(wrapper.get('[aria-label="Right workspace"]').isVisible()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drops chat file links into additive sidebar tabs, including when the sidebar is closed', async () => {
    const previewAgentFile = vi.fn().mockImplementation(async (_agentId: string, path: string) => ({
      kind: 'text', path, content: `# Content of ${path}`, size: 40,
    }));
    const wrapper = mountShell({
      realConversationPane: true,
      previewAgentFile,
      codexConversationSnapshot: codexConversationSnapshot([
        codexTextMessage('links', 'assistant', '[First](docs/first.md) [Second](docs/second.md:12)'),
      ]),
    });
    const transfer = { effectAllowed: 'all', dropEffect: 'none' };
    await wrapper.get('a[href="docs/first.md"]').trigger('dragstart', { dataTransfer: transfer });
    const closedTarget = wrapper.get('[aria-label="Drop link to open in sidebar"]');
    await closedTarget.trigger('dragover', { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe('copy');
    await closedTarget.trigger('drop', { dataTransfer: transfer });
    await flushPromises();
    expect(previewAgentFile).toHaveBeenCalledWith('agent-dina', 'docs/first.md');
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toStrictEqual(['first.md']);
    expect(wrapper.text()).toContain('Content of docs/first.md');

    await wrapper.get('a[href="docs/second.md:12"]').trigger('dragstart', { dataTransfer: transfer });
    await wrapper.get('[aria-label="Drop link to open in sidebar"]').trigger('drop', { dataTransfer: transfer });
    await flushPromises();
    expect(previewAgentFile).toHaveBeenCalledWith('agent-dina', 'docs/second.md');
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toStrictEqual(['first.md', 'second.md']);
    expect(wrapper.find('[aria-label="Drop link to open in sidebar"]').exists()).toBe(false);
  });

  it('opens dropped web links in independent browser tabs without replacing the existing browser', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const browserOpen = vi.fn().mockImplementation(async (_agent: string, _browser: string, url: string) => ({
      url, title: '', canGoBack: false, canGoForward: false,
    }));
    const browserClose = vi.fn().mockResolvedValue(undefined);
    setElectronTestClient({ browserOpen, browserClose });
    const externalOpen = vi.spyOn(window, 'open');
    const wrapper = mountShell({
      realConversationPane: true,
      codexConversationSnapshot: codexConversationSnapshot([
        codexTextMessage('links', 'assistant', '[Example](https://example.com/docs) [Other](https://example.org/)'),
      ]),
    });
    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await wrapper.findAll('.right-workspace-panel__launcher button').find(button => button.text().includes('Browser'))!.trigger('click');
    readyBrowserGuest(wrapper.get('webview').element, 41);
    await flushPromises();
    for (const [index, href] of ['https://example.com/docs', 'https://example.org/'].entries()) {
      await wrapper.get(`a[href="${href}"]`).trigger('dragstart', { dataTransfer: { effectAllowed: 'all' } });
      await wrapper.get('[aria-label="Drop link to open in sidebar"]').trigger('drop');
      await nextTick();
      readyBrowserGuest(wrapper.findAll('webview')[index + 1]!.element, 42 + index);
      await flushPromises();
    }
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toStrictEqual(['Browser', 'example.com', 'example.org']);
    const opens = browserOpen.mock.calls;
    expect(opens.map(call => call[2])).toStrictEqual(['', 'https://example.com/docs', 'https://example.org/']);
    expect(new Set(opens.map(call => call[1])).size).toBe(3);
    expect(externalOpen).not.toHaveBeenCalled();
    await wrapper.get('[aria-label="Close example.com tab"]').trigger('click');
    await flushPromises();
    expect(browserClose).toHaveBeenCalledWith('agent-dina', opens[1]![1]);
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toStrictEqual(['Browser', 'example.org']);
  });

  it('clears a cancelled link drag and ignores text drags and unsupported link protocols', async () => {
    const previewAgentFile = vi.fn();
    const wrapper = mountShell({
      realConversationPane: true, previewAgentFile,
      codexConversationSnapshot: codexConversationSnapshot([
        codexTextMessage('links', 'assistant', '[File](docs/first.md) [Email](mailto:hello@example.com)'),
      ]),
    });
    await wrapper.get('a[href="docs/first.md"]').trigger('dragstart', { dataTransfer: {} });
    expect(wrapper.find('[aria-label="Drop link to open in sidebar"]').exists()).toBe(true);
    window.dispatchEvent(new Event('dragend'));
    await nextTick();
    expect(wrapper.find('[aria-label="Drop link to open in sidebar"]').exists()).toBe(false);
    await wrapper.get('a[href^="mailto:"]').trigger('dragstart', { dataTransfer: {} });
    expect(wrapper.find('[aria-label="Drop link to open in sidebar"]').exists()).toBe(false);
    await wrapper.get('.conversation-pane').trigger('dragstart', { dataTransfer: {} });
    expect(wrapper.find('[aria-label="Drop link to open in sidebar"]').exists()).toBe(false);
    expect(previewAgentFile).not.toHaveBeenCalled();
  });

  it('resolves a dropped relative file against its source agent even if focus changes during the drag', async () => {
    const snapshot = createInitialSnapshot();
    const previewAgentFile = vi.fn().mockResolvedValue({ kind: 'text', path: 'README.md', content: '# Dina project', size: 14 });
    const wrapper = mountShell({
      snapshot, realConversationPane: true, previewAgentFile,
      codexConversationSnapshot: codexConversationSnapshot([
        codexTextMessage('link', 'assistant', '[Readme](README.md)'),
      ]),
    });
    await wrapper.get('a[href="README.md"]').trigger('dragstart', { dataTransfer: {} });
    await wrapper.setProps({ activeAgent: snapshot.agents[1] });
    await wrapper.get('[aria-label="Drop link to open in sidebar"]').trigger('drop');
    await flushPromises();
    expect(previewAgentFile.mock.calls).toStrictEqual([['agent-dina', 'README.md']]);
    expect(wrapper.emitted('select-agent')?.at(-1)).toStrictEqual(['agent-dina']);
  });

  it('opens the empty workspace launcher before preserving a selected Browser tab', async () => {
    const snapshot = createInitialSnapshot();
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    const browserOpen = vi.fn().mockResolvedValue({ url: '', title: '', canGoBack: false, canGoForward: false });
    const browserSetVisible = vi.fn().mockResolvedValue(undefined);
    setElectronTestClient({
      browserOpen,
      browserSetBounds: vi.fn().mockResolvedValue(undefined),
      browserSetVisible,
      browserClose: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => vi.fn()),
    });
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
      },
    });

    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Chat with Dina');
    expect(wrapper.find('.app-shell__right-workspace').exists()).toBe(true);
    expect(wrapper.get('[aria-label="Open a workspace tab"]').text()).toContain('Review');
    expect(wrapper.get('[aria-label="Open a workspace tab"]').text()).toContain('Browser');
    expect(browserOpen).not.toHaveBeenCalled();

    await wrapper.findAll('.right-workspace-panel__launcher button').find((button) => button.text().includes('Browser'))?.trigger('click');
    readyBrowserGuest(wrapper.get('webview').element, 42);
    await flushPromises();

    expect(wrapper.get('[role="tab"]').text()).toBe('Browser');

    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await flushPromises();
    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await flushPromises();

    expect(browserSetVisible).toHaveBeenCalledWith('agent-dina', 'primary', false);
    expect(browserOpen).toHaveBeenCalledTimes(1);

    await wrapper.get('[aria-label="Close Browser tab"]').trigger('click');
    await nextTick();

    expect(wrapper.find('.app-shell__right-workspace').isVisible()).toBe(false);
  });

  it('keeps resizing the browser workspace when the pointer crosses into its page', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    setElectronTestClient({
      browserOpen: vi.fn().mockResolvedValue({ url: '', title: '', canGoBack: false, canGoForward: false }),
      browserSetBounds: vi.fn().mockResolvedValue(undefined),
      browserSetVisible: vi.fn().mockResolvedValue(undefined),
      browserClose: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => vi.fn()),
    });
    const wrapper = mountShell();
    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await wrapper.findAll('.right-workspace-panel__launcher button').find((button) => button.text().includes('Browser'))?.trigger('click');
    readyBrowserGuest(wrapper.get('webview').element, 42);
    await flushPromises();

    const body = wrapper.get('.app-shell__body').element as HTMLElement;
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ right: 1200, width: 1200 } as DOMRect);
    await wrapper.get('.app-shell__right-workspace-resizer').trigger('pointerdown');
    expect(wrapper.find('.app-shell__right-workspace-resize-shield').exists()).toBe(true);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900 }));
    await nextTick();

    const workspace = wrapper.findAll('.app-shell__right-workspace').find((panel) => panel.isVisible());
    expect((workspace?.element as HTMLElement).style.flexBasis).toBe('300px');
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 }));
    await nextTick();
    expect((workspace?.element as HTMLElement).style.flexBasis).toBe('715px');
    window.dispatchEvent(new Event('pointerup'));
    await nextTick();
    expect(wrapper.find('.app-shell__right-workspace-resize-shield').exists()).toBe(false);
  });

  it('opens Files as a right-side explorer pane and keeps it open beside previews', async () => {
    const previewAgentFile = vi.fn().mockImplementation(async (_agentId: string, path: string) => ({
      path, size: 8, kind: 'text' as const, content: path === 'README.md' ? `# ${product.name}
` : 'export {};\n',
    }));
    const wrapper = mountShell({
      agentFiles: [
        { name: 'README.md', path: 'README.md' },
        { name: 'main.ts', path: 'main.ts' },
      ],
      previewAgentFile,
    });

    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await wrapper.findAll('.right-workspace-panel__launcher button')
      .find((button) => button.text().includes('Files'))
      ?.trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="tab"]').text()).toBe('Open file');
    expect(wrapper.find('.right-workspace-panel__files-pane').exists()).toBe(true);
    await wrapper.get('button[title="Preview README.md"]').trigger('click');
    await flushPromises();

    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['README.md']);
    expect(wrapper.find('.right-workspace-panel__files-pane').exists()).toBe(true);
    await wrapper.get('button[title="Preview main.ts"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['README.md', 'main.ts']);
    await wrapper.get('[aria-label="Collapse file explorer"]').trigger('click');
    expect(wrapper.find('.right-workspace-panel__files-pane').exists()).toBe(false);
  });

  it('opens each selected header subagent in an independent right-workspace tab', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-root' };
    snapshot.subagentTrees[snapshot.agents[0].id] = {
      rootConversationId: 'thread-root',
      nodes: {
        'thread-scout': {
          conversationId: 'thread-scout',
          parentConversationId: 'thread-root',
          createdAt: '2026-06-05T00:00:00.000Z',
          status: 'running',
          agentPath: '/root/scout',
          updatedAt: '2026-06-05T00:00:00.000Z',
        },
        'thread-reviewer': {
          conversationId: 'thread-reviewer',
          parentConversationId: 'thread-root',
          createdAt: '2026-06-05T00:00:01.000Z',
          status: 'completed',
          agentPath: '/root/reviewer',
          updatedAt: '2026-06-05T00:00:01.000Z',
        },
      },
      operations: {},
      activities: {},
    };
    const readConversationMessages = vi.fn().mockResolvedValue([]);
    const wrapper = mountShell({ snapshot, readConversationMessages });

    await wrapper.get('[aria-label="Subagents (1 active)"]').trigger('click');
    await wrapper.findAll('.subagent-control__row')[0]?.trigger('click');
    await wrapper.get('[aria-label="Subagents (1 active)"]').trigger('click');
    await wrapper.findAll('.subagent-control__row')[1]?.trigger('click');
    await flushPromises();

    expect(wrapper.getComponent({ name: 'RightWorkspacePanel' }).props('tabs')).toStrictEqual([
      'subagent:thread-scout',
      'subagent:thread-reviewer',
    ]);
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['scout', 'reviewer']);
    expect(readConversationMessages).toHaveBeenCalledWith(
      { backend: 'codex', threadId: 'thread-scout' },
      snapshot.agents[0].id,
    );
    expect(readConversationMessages).toHaveBeenCalledWith(
      { backend: 'codex', threadId: 'thread-reviewer' },
      snapshot.agents[0].id,
    );
  });

  it('keeps each agent workspace and browser mounted while switching agents', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    const snapshot = createInitialSnapshot();
    const browserOpen = vi.fn().mockResolvedValue({ url: '', title: '', canGoBack: false, canGoForward: false });
    const browserClose = vi.fn().mockResolvedValue(undefined);
    const browserSetVisible = vi.fn().mockResolvedValue(undefined);
    window.app = {
      browserOpen,
      browserSetBounds: vi.fn().mockResolvedValue(undefined),
      browserSetVisible,
      browserClose,
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ snapshot });

    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await wrapper.findAll('.right-workspace-panel__launcher button').find((button) => button.text().includes('Browser'))?.trigger('click');
    readyBrowserGuest(wrapper.get('webview').element, 42);
    await flushPromises();
    expect(browserOpen).toHaveBeenCalledWith('agent-dina', 'primary', '', 42);

    await wrapper.setProps({ activeAgent: snapshot.agents.find((agent) => agent.id === 'agent-jesse') } as Record<string, unknown>);
    await flushPromises();

    expect(browserClose).not.toHaveBeenCalled();
    expect(wrapper.findAllComponents({ name: 'BrowserPanel' })).toHaveLength(1);
    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await wrapper.findAll('.right-workspace-panel__launcher button').find((button) => button.isVisible() && button.text().includes('Browser'))?.trigger('click');
    readyBrowserGuest(wrapper.findAll('webview')[1]!.element, 43);
    await flushPromises();

    expect(browserOpen).toHaveBeenCalledWith('agent-jesse', 'primary', '', 43);
    expect(wrapper.findAllComponents({ name: 'BrowserPanel' })).toHaveLength(2);
    await wrapper.setProps({ activeAgent: snapshot.agents.find((agent) => agent.id === 'agent-dina') } as Record<string, unknown>);
    await flushPromises();

    const workspaces = wrapper.findAllComponents({ name: 'RightWorkspacePanel' });
    expect(workspaces.find((panel) => panel.props('agent').id === 'agent-dina')?.props('tabs')).toStrictEqual(['browser']);
    expect(workspaces.find((panel) => panel.props('agent').id === 'agent-jesse')?.props('tabs')).toStrictEqual(['browser']);
    expect(browserClose).not.toHaveBeenCalled();
    expect(browserSetVisible).toHaveBeenCalledWith('agent-dina', 'primary', true);
  });

  it('opens a background agent browser without changing the selected agent', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    let listener: (command: AppCommand) => void = () => undefined;
    const browserOpen = vi.fn().mockResolvedValue({ url: 'https://example.com/', title: 'Example', canGoBack: false, canGoForward: false });
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      browserOpen,
      browserSetBounds: vi.fn().mockResolvedValue(undefined),
      browserSetVisible: vi.fn().mockResolvedValue(undefined),
      browserClose: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ realConversationPane: true });

    listener({ type: 'open-browser', agentId: 'agent-jesse', browserId: 'primary', url: 'https://example.com' });
    await nextTick();
    readyBrowserGuest(wrapper.get('webview').element, 43);
    await flushPromises();

    expect(browserOpen).toHaveBeenCalledWith('agent-jesse', 'primary', 'https://example.com', 43);
    expect(wrapper.emitted('select-agent')).toBeUndefined();
    expect(wrapper.text()).toContain('Chat with Dina');
  });

  it('opens the active agent git diff from header diff stats', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agentGitStatuses['agent-dina'] = {
      folder: '/Users/nbonamy/src/id8',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changedFiles: 1,
      addedLines: 45,
      removedLines: 23,
      hasUntracked: false,
      state: 'dirty',
      diffCatalog: {
        defaultTarget: { type: 'branch', baseRef: 'origin/main' },
        branch: { baseRef: 'origin/main', addedLines: 45, removedLines: 23, changedFiles: 1 },
        uncommitted: { addedLines: 45, removedLines: 23, changedFiles: 1 },
        unstaged: { addedLines: 45, removedLines: 23, changedFiles: 1 },
        staged: { addedLines: 0, removedLines: 0, changedFiles: 0 },
        commits: [],
      },
      updatedAt: '2026-06-05T00:00:00.000Z',
    };
    let resolveDiff!: (diff: import('@workspace/core/contracts').AgentGitDiff) => void;
    const getAgentGitDiff = vi.fn((_agentId: string, target?: object) => {
      structuredClone(target);
      return new Promise<import('@workspace/core/contracts').AgentGitDiff>((resolve) => { resolveDiff = resolve; });
    });
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
        getAgentGitDiff,
      },
    });

    await wrapper.get('[aria-label="Open repository diff"]').trigger('click');

    expect(getAgentGitDiff).toHaveBeenCalledWith('agent-dina', { type: 'uncommitted' });
    expect(wrapper.get('[aria-label="Right workspace"]').text()).toContain('Changes');
    expect(wrapper.get('.git-diff-preview-panel').attributes('aria-busy')).toBe('true');

    resolveDiff({
        target: { type: 'uncommitted' },
        summary: { addedLines: 45, removedLines: 23, changedFiles: 1 },
        sections: [],
        diff: [
          'diff --git a/src/main.ts b/src/main.ts',
          '--- a/src/main.ts',
          '+++ b/src/main.ts',
          '@@ -1 +1 @@',
          '-const oldValue = 1;',
          '+const newValue = 2;',
        ].join('\n'),
    });
    await flushPromises();

    expect(wrapper.text()).toContain('src/main.ts');
    expect(wrapper.text()).toContain('newValue');
  });

  it('keeps linked backlog work available and routes repository work through the selected workspace', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.name = 'agent-workspace';
    snapshot.agentGitStatuses['agent-dina'] = {
      folder: '/Users/nbonamy/src/agent-workspace',
      repository: 'agent-workspace',
      githubRepository: 'nbonamy/agent-workspace',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changedFiles: 0,
      addedLines: 0,
      removedLines: 0,
      hasUntracked: false,
      state: 'clean',
      updatedAt: '2026-08-12T00:00:00.000Z',
    };
    const item = workItem();
    snapshot.agents[0]!.workspace = { kind: 'git', folder: '/workspace/agent-workspace', repositoryName: 'agent-workspace', repositoryRoot: '/workspace/agent-workspace', primaryWorktreeRoot: '/workspace/agent-workspace', branch: 'main', isLinkedWorktree: false, updatedAt: 'now' };
    const unresolvedPullRequest = workItem({ kind: 'pullRequest', number: 44, id: 'nbonamy/agent-workspace#44' });
    const resolvedPullRequest = { ...unresolvedPullRequest, branchName: 'feature/resolved-pr-44' };
    const loadWorkItems = vi.fn()
      .mockResolvedValueOnce([resolvedPullRequest]);
    const duplicateAgentAction = vi.fn().mockImplementation(async (_agentId: string, options?: { name?: string }) => ({
      ...snapshot.agents[0]!,
      id: options?.name?.endsWith('42') ? 'agent-reviewer' : 'agent-gh-24',
      name: options?.name ?? 'duplicate',
    }));
    const createAgentGitBranch = vi.fn().mockResolvedValue({});
    const assignWorkItemAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      loadWorkItems,
      duplicateAgentAction,
      createAgentGitBranch,
      assignWorkItemAction,
    });

    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await nextTick();
    await wrapper.get('[aria-label="Open right workspace tab"]').trigger('click');
    const backlogMenuItem = wrapper.findAll('.right-workspace-panel__add-menu .app-menu__item')
      .find((candidate) => candidate.text().includes('Backlog'));
    expect(backlogMenuItem).toBeUndefined();

    wrapper.getComponent({ name: 'RightWorkspacePanel' }).vm.$emit('openTab', 'backlog');
    await flushPromises();

    expect(loadWorkItems).not.toHaveBeenCalled();
    expect(wrapper.get('[role="tab"]').text()).toBe('Backlog');
    const backlog = wrapper.getComponent({ name: 'RepositoryBacklogPanel' });

    await backlog.props('startWorkAction')({
      action: 'fix',
      item,
      target: 'current',
      workspace: { branchName: 'fix/12-backlog', kind: 'worktree' },
    });

    expect(createAgentGitBranch).not.toHaveBeenCalled();
    expect(assignWorkItemAction).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      item,
      prompt: workItemAssignmentPrompt(item, { action: 'fix' }),
    });

    await backlog.props('startWorkAction')({ action: 'custom', item, target: 'current', workspace: { kind: 'current' } });
    await nextTick();
    expect(wrapper.emitted('update:composerState')).toContainEqual([{
      agentId: 'agent-dina',
      state: {
        text: workItemComposerPrompt(item),
        selectionStart: workItemComposerPrompt(item).length,
        selectionEnd: workItemComposerPrompt(item).length,
      },
    }]);

    createAgentGitBranch.mockClear();
    assignWorkItemAction.mockClear();
    await backlog.props('startWorkAction')({
      action: 'investigate',
      item,
      target: 'current',
      workspace: { kind: 'current' },
    });
    expect(createAgentGitBranch).not.toHaveBeenCalled();
    expect(assignWorkItemAction).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      item,
      prompt: workItemAssignmentPrompt(item, { action: 'investigate' }),
    });

    const workspace = wrapper.getComponent({ name: 'RightWorkspacePanel' });
    const reviewPullRequest = workItem({ branchName: 'feature/pull-request-42', kind: 'pullRequest', number: 42, id: 'nbonamy/agent-workspace#42' });
    createAgentGitBranch.mockClear();
    assignWorkItemAction.mockClear();

    await workspace.props('startRepositoryWork')({
      action: 'review',
      item: reviewPullRequest,
      target: 'duplicate',
      workspace: { branchName: 'feature/pull-request-42', kind: 'worktree' },
    });

    expect(duplicateAgentAction).toHaveBeenCalledWith('agent-dina', {
      name: 'agent-workspace #42',
      select: false,
    });
    expect(createAgentGitBranch).toHaveBeenCalledWith('agent-reviewer', {
      name: 'feature/pull-request-42',
      createWorktree: true,
      pullRequestNumber: 42,
      confirmed: true,
    });
    expect(assignWorkItemAction).toHaveBeenCalledWith({
      agentId: 'agent-reviewer',
      item: reviewPullRequest,
      prompt: workItemAssignmentPrompt(reviewPullRequest, { action: 'review' }),
    });

    const issue = workItem({ id: 'nbonamy/agent-workspace#24', number: 24 });
    duplicateAgentAction.mockClear();
    await workspace.props('startRepositoryWork')({
      action: 'fix',
      item: issue,
      target: 'duplicate',
      workspace: { branchName: 'fix/gh-24', kind: 'worktree' },
    });

    expect(duplicateAgentAction).toHaveBeenCalledWith('agent-dina', {
      name: 'agent-workspace #24',
      select: false,
    });

    const currentPullRequest = workItem({ branchName: 'feature/pull-request-43', kind: 'pullRequest', number: 43, id: 'nbonamy/agent-workspace#43' });
    createAgentGitBranch.mockClear();
    assignWorkItemAction.mockClear();

    await workspace.props('startRepositoryWork')({
      action: 'addressFeedback',
      item: currentPullRequest,
      target: 'current',
      workspace: { kind: 'current' },
    });

    expect(createAgentGitBranch).not.toHaveBeenCalled();
    expect(assignWorkItemAction).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      item: currentPullRequest,
      prompt: workItemAssignmentPrompt(currentPullRequest, { action: 'addressFeedback' }),
    });

    createAgentGitBranch.mockClear();
    assignWorkItemAction.mockClear();

    await workspace.props('startRepositoryWork')({
      action: 'review',
      item: unresolvedPullRequest,
      target: 'current',
      workspace: { kind: 'current' },
    });

    expect(loadWorkItems).toHaveBeenCalledWith('github', 'nbonamy/agent-workspace', undefined, {
      kind: 'pullRequest',
      state: 'all',
    });
    expect(createAgentGitBranch).not.toHaveBeenCalled();
    expect(assignWorkItemAction).toHaveBeenCalledWith(expect.objectContaining({ item: resolvedPullRequest }));
  });

  it('does not auto-open repository review for a turn-scoped diff event', () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
        sidePanelRequest: {
          kind: 'gitDiff',
          scope: 'turn',
          title: 'Git Diff',
          subtitle: 'Current turn',
          diff: 'diff --git a/src/main.ts b/src/main.ts\n',
        },
      },
    });

    expect(wrapper.get('[aria-label="Right workspace"]').isVisible()).toBe(false);
  });

  it('opens markdown links in additive right-workspace tabs through the agent file bridge', async () => {
    const snapshot = createInitialSnapshot();
    let resolveReadAgentFile: (result: { content: string; path: string }) => void = () => undefined;
    const previewAgentFile = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveReadAgentFile = resolve;
    }));
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        codexConversationSnapshot: codexConversationSnapshot([
          codexTextMessage('message-doc-link', 'assistant', 'Open [architecture](docs/architecture.md).'),
        ]),
        isLoading: false,
        isSending: false,
        previewAgentFile,
      },
    });

    await wrapper.get('a[href="docs/architecture.md"]').trigger('click');

    expect(previewAgentFile).toHaveBeenCalledWith('agent-dina', 'docs/architecture.md');
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).not.toContain('architecture.md');

    resolveReadAgentFile({
      path: 'docs/architecture.md',
      content: '# Architecture\n\nThis is the side panel.',
    });
    await flushPromises();

    expect(wrapper.find('.side-panel').exists()).toBe(false);
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toContain('architecture.md');
    expect(wrapper.text()).toContain('This is the side panel.');

    await wrapper.get('[aria-label="Close architecture.md tab"]').trigger('click');
    expect(wrapper.find('.markdown-panel').exists()).toBe(false);
  });

  it('opens source file links as read-only source previews', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].folder = '/workspace/dina';
    const previewAgentFile = vi.fn()
      .mockResolvedValueOnce({
        path: 'src/main.ts',
        content: 'const answer: number = 42;\n',
      })
      .mockResolvedValueOnce({
        path: 'src/main.ts',
        content: 'const answer: number = 43;\n',
      });
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        codexConversationSnapshot: codexConversationSnapshot([
          codexTextMessage('message-source-link', 'assistant', 'Open [main](src/main.ts).'),
        ]),
        isLoading: false,
        isSending: false,
        previewAgentFile,
      },
    });

    await wrapper.findAll('.right-workspace-panel__launcher button').find((button) => button.text().includes('Review'))?.trigger('click');
    await flushPromises();
    await wrapper.get('a[href="src/main.ts"]').trigger('click');
    await flushPromises();

    expect(previewAgentFile).toHaveBeenCalledWith('agent-dina', 'src/main.ts');
    expect(wrapper.find('.source-preview-panel').exists()).toBe(true);
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['Review', 'main.ts']);
    expect(wrapper.html()).toContain('shiki');
    expect(wrapper.text()).toContain('answer');

    await wrapper.setProps({
      fileActivity: {
        agentId: 'agent-dina', turnId: 'turn-edit', messageId: 'message-edit', itemId: 'item-edit',
        path: '/workspace/dina/src/main.ts', action: 'edit', status: 'completed',
        occurredAt: '2026-08-02T00:00:00.000Z',
      },
    } as Record<string, unknown>);
    await flushPromises();

    expect(previewAgentFile).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['Review', 'main.ts']);
    expect(wrapper.text()).toContain('43');
  });

  it('opens edit links in a turn-scoped diff tab', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].folder = '/workspace/dina';
    snapshot.turnGitDiffs['turn-edit'] = {
      agentId: snapshot.agents[0]!.id,
      turnId: 'turn-edit',
      addedLines: 1,
      removedLines: 0,
      diff: [
        'diff --git a/src/main.ts b/src/main.ts',
        '--- a/src/main.ts',
        '+++ b/src/main.ts',
        '@@ -1,1 +1,2 @@',
        ' const answer: number = 42;',
        '+export const done = true;',
      ].join('\n'),
      updatedAt: '2026-08-02T00:00:00.000Z',
    };
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
      },
    });

    await conversationControllerActions(wrapper).openLink?.({
      kind: 'file',
      href: '/workspace/dina/src/main.ts',
      path: '/workspace/dina/src/main.ts',
      action: 'edit',
      turnId: 'turn-edit',
    });
    await nextTick();

    expect(wrapper.find('.git-diff-preview-panel').exists()).toBe(true);
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['main.ts']);
    expect(wrapper.text()).toContain('done = true');
  });

  it('falls back to the current git review for edit links without turn context', async () => {
    const snapshot = createInitialSnapshot();
    const getAgentGitDiff = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
        getAgentGitDiff,
      },
    });

    await conversationControllerActions(wrapper).openLink?.({
      kind: 'file',
      href: 'src/main.ts',
      path: 'src/main.ts',
      action: 'edit',
    });
    await flushPromises();

    expect(getAgentGitDiff).toHaveBeenCalledWith('agent-dina');
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toContain('Changes');
  });

  it('does not open agent workspaces from background file activity', async () => {
    const snapshot = createInitialSnapshot();
    const [dina, jesse] = snapshot.agents;
    if (!dina || !jesse) throw new Error('Expected seeded agents.');
    dina.folder = '/workspace/dina';
    jesse.folder = '/workspace/jesse';
    const previewAgentFile = vi.fn().mockResolvedValue({
      path: 'src/main.ts',
      content: 'export const updated = true;\n',
    });
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: dina,
        isLoading: false,
        isSending: false,
        previewAgentFile,
        fileActivity: null,
      },
    });

    await wrapper.setProps({
      fileActivity: {
        agentId: jesse.id, turnId: 'turn-1', messageId: 'message-1', itemId: 'item-1',
        path: '/workspace/jesse/src/main.ts', action: 'edit', status: 'running',
        occurredAt: '2026-08-02T00:00:00.000Z',
      },
    } as Record<string, unknown>);

    expect(previewAgentFile).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Right workspace"]:not([style*="display: none"])').exists()).toBe(false);

    await wrapper.setProps({
      fileActivity: {
        agentId: jesse.id, turnId: 'turn-1', messageId: 'message-1', itemId: 'item-1',
        path: '/workspace/jesse/src/main.ts', action: 'edit', status: 'completed',
        occurredAt: '2026-08-02T00:00:01.000Z',
      },
    } as Record<string, unknown>);
    await flushPromises();

    expect(previewAgentFile).not.toHaveBeenCalled();

    await wrapper.setProps({ activeAgent: jesse } as Record<string, unknown>);
    await nextTick();

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);

    await wrapper.setProps({
      fileActivity: {
        agentId: jesse.id, turnId: 'turn-2', messageId: 'message-2', itemId: 'item-2',
        path: '/workspace/jesse/src/main.ts', action: 'read', status: 'running',
        occurredAt: '2026-08-02T00:00:02.000Z',
      },
    } as Record<string, unknown>);

    expect(previewAgentFile).not.toHaveBeenCalled();
  });

  it('normalizes file preview links while preserving absolute external paths', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].folder = '/Users/nbonamy/src/id8';
    const previewAgentFile = vi.fn().mockImplementation(async (_agentId: string, path: string) => ({
      path,
      content: path.endsWith('SKILL.md') ? '# Writing for agents\n' : `# ${path}\n`,
    }));
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        codexConversationSnapshot: codexConversationSnapshot([
          codexTextMessage('message-preview-links', 'assistant', [
            'Open [relative](README.md:40),',
            '[line URL](file:///Users/nbonamy/src/id8/README.md:40:2),',
            '[encoded URL](file:///Users/nbonamy/src/id8/src/file%20name.ts),',
            'and [external](file:///Users/nbonamy/dotfiles/.agents/skills/writing-for-agents/SKILL.md).',
          ].join(' ')),
        ]),
        isLoading: false,
        isSending: false,
        previewAgentFile,
      },
    });

    await wrapper.get('a[href="README.md:40"]').trigger('click');
    await flushPromises();

    expect(previewAgentFile).toHaveBeenCalledWith('agent-dina', 'README.md');
    previewAgentFile.mockClear();

    await wrapper.get('a[href="file:///Users/nbonamy/src/id8/README.md:40:2"]').trigger('click');
    await flushPromises();

    expect(previewAgentFile).toHaveBeenCalledWith('agent-dina', 'README.md');
    previewAgentFile.mockClear();

    await wrapper.get('a[href="file:///Users/nbonamy/src/id8/src/file%20name.ts"]').trigger('click');
    await flushPromises();

    expect(previewAgentFile).toHaveBeenCalledWith('agent-dina', 'src/file name.ts');
    expect(wrapper.find('.source-preview-panel').exists()).toBe(true);
    previewAgentFile.mockClear();

    await wrapper.get('a[href="file:///Users/nbonamy/dotfiles/.agents/skills/writing-for-agents/SKILL.md"]').trigger('click');
    await flushPromises();

    expect(previewAgentFile).toHaveBeenCalledWith(
      'agent-dina',
      '/Users/nbonamy/dotfiles/.agents/skills/writing-for-agents/SKILL.md',
    );
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toContain('SKILL.md');
    expect(wrapper.text()).toContain('Writing for agents');
  });

  it('ignores stale markdown reads after the file tab closes', async () => {
    const snapshot = createInitialSnapshot();
    let resolveReadAgentFile: (result: { content: string; path: string }) => void = () => undefined;
    const previewAgentFile = vi.fn().mockResolvedValueOnce({ path: 'docs/architecture.md', kind: 'text', content: '# Original' }).mockReturnValue(new Promise((resolve) => {
      resolveReadAgentFile = resolve;
    }));
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        codexConversationSnapshot: codexConversationSnapshot([
          codexTextMessage('message-doc-link', 'assistant', 'Open [architecture](docs/architecture.md).'),
        ]),
        isLoading: false,
        isSending: false,
        previewAgentFile,
      },
    });

    await wrapper.get('a[href="docs/architecture.md"]').trigger('click');
    await flushPromises();
    await wrapper.get('a[href="docs/architecture.md"]').trigger('click');
    await wrapper.get('[aria-label="Close architecture.md tab"]').trigger('click');

    resolveReadAgentFile({
      path: 'docs/architecture.md',
      content: '# Architecture\n\nThis result is stale.',
    });
    await flushPromises();

    expect(wrapper.find('.side-panel').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('This result is stale.');
  });

  it('keeps file read state scoped to the originating agent when switching agents', async () => {
    const snapshot = createInitialSnapshot();
    let rejectReadAgentFile: (error: Error) => void = () => undefined;
    const previewAgentFile = vi.fn().mockReturnValue(new Promise((_resolve, reject) => {
      rejectReadAgentFile = reject;
    }));
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        codexConversationSnapshot: codexConversationSnapshot([
          codexTextMessage('message-doc-link', 'assistant', 'Open [architecture](docs/architecture.md).'),
        ]),
        isLoading: false,
        isSending: false,
        previewAgentFile,
      },
    });

    await wrapper.get('a[href="docs/architecture.md"]').trigger('click');
    await wrapper.setProps({ activeAgent: snapshot.agents[1] } as Record<string, unknown>);

    rejectReadAgentFile(new Error('This error is stale.'));
    await flushPromises();

    expect(wrapper.findAll('.right-workspace-panel').every((panel) => !panel.isVisible())).toBe(true);

    await wrapper.setProps({ activeAgent: snapshot.agents[0] } as Record<string, unknown>);
    expect(wrapper.findAll('.right-workspace-panel')[0]?.text()).toContain('This error is stale.');
  });

  it('shows markdown file-tab read errors', async () => {
    const snapshot = createInitialSnapshot();
    const previewAgentFile = vi.fn().mockRejectedValue(new Error('File is outside the agent folder.'));
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        codexConversationSnapshot: codexConversationSnapshot([
          codexTextMessage('message-doc-link', 'assistant', 'Open [secret](../secret.md).'),
        ]),
        isLoading: false,
        isSending: false,
        previewAgentFile,
      },
    });

    await wrapper.get('a[href="../secret.md"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('.side-panel').exists()).toBe(false);
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toContain('secret.md');
    expect(wrapper.text()).toContain('File is outside the agent folder.');
  });

  it('ignores blank markdown file preview requests', async () => {
    const snapshot = createInitialSnapshot();
    const previewAgentFile = vi.fn().mockResolvedValue({
      path: 'docs/architecture.md',
      content: '# Architecture',
    });
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
        previewAgentFile,
      },
    });

    await conversationControllerActions(wrapper).openLink?.({
      kind: 'file',
      href: '   ',
      path: '   ',
    });
    await flushPromises();

    expect(previewAgentFile).not.toHaveBeenCalled();
    expect(wrapper.find('.side-panel').exists()).toBe(false);
  });

  it('opens MCP markdown requests as right-workspace tabs', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
        sidePanelRequest: {
          kind: 'markdown',
          title: 'Generated Plan',
          content: '# Plan\n\nShip it.',
        },
      },
    });

    expect(wrapper.find('.side-panel').exists()).toBe(false);
    expect(wrapper.find('.right-workspace-panel').exists()).toBe(true);
    expect(wrapper.text()).toContain('Generated Plan');
    expect(wrapper.text()).toContain('Ship it.');

    await wrapper.setProps({
      sidePanelRequest: {
        kind: 'markdown',
        path: 'docs/mcp.md',
        content: '# MCP',
      },
    } as Record<string, unknown>);

    expect(wrapper.text()).toContain('mcp.md');
    expect(wrapper.text()).toContain('MCP');

    await wrapper.setProps({
      sidePanelRequest: {
        kind: 'markdown',
        content: '# Generated',
      },
    } as Record<string, unknown>);

    expect(wrapper.find('.side-panel').exists()).toBe(false);
    expect(wrapper.text()).toContain('Markdown');
    expect(wrapper.text()).toContain('Generated');
  });

  it.each(['document-first', 'review-first', 'reload'] as const)('keeps one interactive tab for a duplicated plan (%s)', async order => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const markdown = '# Dummy plan\n\n## Storage\n- ( ) Project\n- ( ) Home';
    const review = { id: 'native', conversationId: null, turnId: 'turn', markdown, status: 'pending' as const };
    const tabId = 'file:markdown:duplicate';
    const saved = { tabs: [{ id: tabId, title: 'Dummy document', documentId: 'duplicate' }], activeTab: tabId, open: true, width: 420, filesPaneOpen: false, filesPaneWidth: 280 };
    const update = vi.fn().mockResolvedValue(saved);
    setElectronTestClient({
      getDocumentWorkspaces: async () => order === 'reload' ? { [agent.id]: saved } : {},
      readWorkspaceDocument: async () => ({ content: markdown }),
      updateDocumentWorkspace: update,
    });
    if (order !== 'document-first') agent.planReview = review;
    const updatePlanReview = vi.fn().mockResolvedValue({ ...review, status: 'accept' });
    const wrapper = mountShell({ snapshot });
    try {
      await wrapper.setProps({ updatePlanReview });
      await flushPromises();
      if (order !== 'reload') {
        await wrapper.setProps({ sidePanelRequest: { kind: 'markdown', agentId: agent.id, documentId: 'duplicate', title: 'Dummy document', content: markdown } });
        if (order === 'document-first') {
          expect(wrapper.get('[role="tab"]').text()).toBe('Dummy document');
          const next = structuredClone(snapshot);
          next.agents[0]!.planReview = review;
          await wrapper.setProps({ snapshot: next, activeAgent: next.agents[0]! });
        }
      }
      await flushPromises();
      expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
      expect(wrapper.get('.plan-review-panel').isVisible()).toBe(true);
      expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2);
      await settlePersistence();
      expect(update.mock.calls.some(([, change]) => change.close.includes(tabId))).toBe(true);
      // A similarly titled report, a source file, and another agent's document are independent.
      for (const request of [
        { agentId: agent.id, documentId: 'report', title: 'Dummy plan', content: '# Different report' },
        { agentId: agent.id, path: 'plan.md', title: 'Source file', content: markdown },
        { agentId: snapshot.agents[1]!.id, documentId: 'other', title: 'Other agent', content: markdown },
      ]) await wrapper.setProps({ sidePanelRequest: { kind: 'markdown', ...request } });
      expect(wrapper.findAll('[role="tab"]').filter(tab => tab.isVisible()).map(tab => tab.text())).toEqual(['Plan', 'Dummy plan', 'Source file']);
      await wrapper.get('[role="tab"][aria-label="Plan"]').trigger('click');
      await wrapper.get('.plan-review-footer .app-button--primary').trigger('click');
      await flushPromises();
      expect(updatePlanReview).toHaveBeenCalledExactlyOnceWith(agent.id, { reviewId: 'native', resolution: 'accept', draftVersion: 0 });
      expect(wrapper.findAll('[role="tab"][aria-label="Other agent"]')).toHaveLength(1);
    } finally { wrapper.unmount(); }
  });

  it('opens native Markdown plans, reopens revised proposals, and keeps approval separate from feedback', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'planning' };
    agent.planReview = { id: 'native-review', conversationId: 'planning', turnId: 'native-turn', markdown: '# Native proposal', status: 'pending' };
    const updatePlanReview = vi.fn().mockResolvedValue({ ...agent.planReview, status: 'accept' });
    const wrapper = mount(AppShell, { props: { snapshot, activeAgent: agent, isLoading: false, isSending: false, updatePlanReview } });
    try {
      expect(wrapper.get('article[aria-label="Native proposal"]').isVisible()).toBe(true);
      expect(wrapper.get('.plan-review-footer__actions').findAll('button').map(button => button.text())).toStrictEqual(['Cancel', 'Revise', 'Approve']);
      await wrapper.get('[aria-label="Close Plan tab"]').trigger('click');
      const revised = structuredClone(snapshot);
      revised.agents[0]!.planReview = { ...agent.planReview, id: 'revision-two', markdown: '# Revised proposal' };
      await wrapper.setProps({ snapshot: revised, activeAgent: revised.agents[0]! });
      expect(wrapper.get('article[aria-label="Revised proposal"]').isVisible()).toBe(true);
      const foreign = structuredClone(revised);
      foreign.agents[0]!.planReview!.conversationId = 'other';
      await wrapper.setProps({ snapshot: foreign, activeAgent: foreign.agents[0]! });
      expect(wrapper.find('.plan-review-footer').exists()).toBe(false);
      await wrapper.setProps({ snapshot: revised, activeAgent: revised.agents[0]! });
      await wrapper.get('.plan-review-footer .app-button--primary').trigger('click');
      await flushPromises();
      expect(updatePlanReview).toHaveBeenCalledExactlyOnceWith(agent.id, { reviewId: 'revision-two', resolution: 'accept', draftVersion: 0 });
      expect(wrapper.emitted('sendPrompt')).toBeUndefined();
    } finally { wrapper.unmount(); }
  });

  it.each(['accept', 'cancel'] as const)('routes %s to the native review and closes the preview after success', async resolution => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.planReview = { id: 'native', conversationId: null, turnId: 'turn', markdown: '# Plan', status: 'pending', draftVersion: 1, draft: { comments: [{ id: 's0', sectionId: 's0', quote: 'Plan', body: 'Split the work.' }], choices: [] } };
    const updatePlanReview = vi.fn().mockResolvedValue({ ...agent.planReview, status: resolution });
    const wrapper = mount(AppShell, { props: { snapshot, activeAgent: agent, isLoading: false, isSending: false, planMode: true, updatePlanReview } });
    try {
      const label = { accept: 'Approve', cancel: 'Cancel' }[resolution];
      await wrapper.get('.plan-review-footer').findAll('button').find(b => b.text() === label)!.trigger('click');
      await flushPromises();
      expect(updatePlanReview).toHaveBeenCalledExactlyOnceWith(agent.id, { reviewId: 'native', resolution, draftVersion: 1 });
      expect(wrapper.emitted('update:planMode')).toStrictEqual([[false]]);
      expect(wrapper.findAll('[role="tab"]').map(t => t.text())).not.toContain('Plan');
    } finally { wrapper.unmount(); }
  });

  it('keeps the submitted plan visible through revision, reload and replacement', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.planReview = { id: 'native', conversationId: null, turnId: 'turn', markdown: '# Original plan', status: 'pending', draftVersion: 1, draft: { comments: [{ id: 's0', sectionId: 's0', quote: 'Original plan', body: 'Split the work.' }], choices: [] } };
    const updatePlanReview = vi.fn().mockResolvedValue({ ...agent.planReview, status: 'revise' });
    let wrapper = mount(AppShell, { props: { snapshot, activeAgent: agent, isLoading: false, isSending: false, planMode: true, updatePlanReview } });
    try {
      await wrapper.get('.plan-review-footer').findAll('button').find(b => b.text() === 'Revise')!.trigger('click');
      await flushPromises();
      expect(wrapper.get('article[aria-label="Original plan"]').isVisible()).toBe(true);
      expect(wrapper.emitted('update:planMode')).toStrictEqual([[true]]);
      const waiting = structuredClone(snapshot);
      waiting.agents[0]!.planReview!.status = 'revise';
      await wrapper.setProps({ snapshot: waiting, activeAgent: waiting.agents[0]! });
      expect(wrapper.get('article[aria-label="Original plan"]').isVisible()).toBe(true);
      expect(wrapper.get('.comment-preview').text()).toContain('Split the work.');
      expect(wrapper.get('.plan-review-footer').findAll('button').every(b => b.attributes('disabled') !== undefined)).toBe(true);
      wrapper.unmount();
      wrapper = mount(AppShell, { props: { snapshot: waiting, activeAgent: waiting.agents[0]!, isLoading: false, isSending: false, updatePlanReview } });
      expect(wrapper.get('article[aria-label="Original plan"]').isVisible()).toBe(true);
      const replacement = structuredClone(waiting);
      replacement.agents[0]!.planReview = { id: 'revised', conversationId: null, turnId: 'next-turn', markdown: '# Revised plan', status: 'pending' };
      await wrapper.setProps({ snapshot: replacement, activeAgent: replacement.agents[0]! });
      expect(wrapper.get('article[aria-label="Revised plan"]').isVisible()).toBe(true);
      expect(wrapper.find('article[aria-label="Original plan"]').exists()).toBe(false);
      expect(wrapper.get('.app-button--primary').attributes('disabled')).toBeUndefined();
    } finally { wrapper.unmount(); }
  });

  it('dismisses review when another client resolves the persisted proposal', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.planReview = { id: 'review-1', conversationId: null, turnId: 'turn-1', markdown: '# Plan', status: 'pending' };
    const wrapper = mount(AppShell, { props: {
      snapshot, activeAgent: snapshot.agents[0], isLoading: false, isSending: false,
      sidePanelRequest: { kind: 'markdown', purpose: 'plan', title: 'Plan', content: '# Plan' },
    } });
    expect(wrapper.find('.plan-review-footer').exists()).toBe(true);
    const resolved = structuredClone(snapshot);
    resolved.agents[0]!.planReview!.status = 'cancel';
    await wrapper.setProps({ snapshot: resolved, activeAgent: resolved.agents[0] });
    await flushPromises();
    expect(wrapper.find('.plan-review-footer').exists()).toBe(false);
    expect(wrapper.emitted('sendPrompt')).toBeUndefined();
  });

  it('locks plan review actions while a plan progress tool is running', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.planReview = { id: 'native', conversationId: null, turnId: 'turn', markdown: '# Previous Plan', status: 'pending' };
    const planProgressMessage: SurfaceMessage = {
      id: 'assistant-turn-plan',
      role: 'assistant',
      status: 'streaming',
      turnId: 'turn-plan',
      createdAt: '2026-06-05T00:00:00.000Z',
      parts: [{
        type: 'tool',
        id: 'plan-turn-plan',
        kind: 'generic',
        title: 'plan',
        status: 'running',
        metadata: {
          planProgress: true,
        },
      }],
    };
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        codexConversationSnapshot: codexConversationSnapshot([planProgressMessage], {
          activeTurnId: 'turn-plan',
          turnIds: ['turn-plan'],
          busy: true,
        }),
        isLoading: false,
        isSending: true,
        planMode: true,
        sidePanelRequest: {
          kind: 'markdown',
          purpose: 'plan',
          title: 'Plan',
          content: '# Previous Plan',
        },
      },
    });

    expect(wrapper.get('.plan-review-footer').findAll('button').every(b => b.attributes('disabled') !== undefined)).toBe(true);
  });
});
