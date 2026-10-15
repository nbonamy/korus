import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { ElTooltip } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSubagentTree, OpenInApplicationCatalog, RendererMessage } from '@workspace/core/contracts';
import RightWorkspacePanel from '../RightWorkspacePanel.vue';
import BrowserPanel from '../BrowserPanel.vue';
import { rightWorkspaceFileTab, type RightWorkspaceFilePanel, type RightWorkspaceFileTab, type RightWorkspaceImagePanel, type RightWorkspaceImageTab, type RightWorkspaceTab } from '../right-workspace';
import type { SidePanelMarkdownState } from '../side-panel';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

afterEach(() => {
  vi.restoreAllMocks();
  delete window.app;
});

function mountPanel(
  tabs: RightWorkspaceTab[] = ['review', 'browser'],
  activeTab: RightWorkspaceTab | null = 'review',
  filePanels: Partial<Record<RightWorkspaceFileTab, RightWorkspaceFilePanel>> = {},
  planPanel: SidePanelMarkdownState | null = null,
  imagePanels: Partial<Record<RightWorkspaceImageTab, RightWorkspaceImagePanel>> = {},
  openInCatalog?: OpenInApplicationCatalog,
  browserAvailable = true,
  subagent?: {
    tree: AgentSubagentTree;
    loadMessages: (conversationId: string) => Promise<RendererMessage[]>;
  },
) {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  window.app = {
    browserOpen: vi.fn().mockResolvedValue({ url: '', title: '', canGoBack: false, canGoForward: false }),
    browserSetBounds: vi.fn().mockResolvedValue(undefined),
    browserSetVisible: vi.fn().mockResolvedValue(undefined),
    browserClose: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn(() => vi.fn()),
  } as never;
  return mount(RightWorkspacePanel, {
    props: {
      activeTab,
      agent: {
        id: 'agent-1', teamId: 'team-1', name: 'Dina', avatar: 'D', folder: '/repo', backend: 'codex', status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
      },
      gitPanel: { kind: 'gitDiff', title: 'Review', diff: '', state: 'idle' },
      browserAvailable,
      filePanels,
      imagePanels,
      openInAvailable: Boolean(openInCatalog),
      openInCatalog,
      planPanel,
      tabs,
      visible: true,
      subagentTree: subagent?.tree,
      loadSubagentMessages: subagent?.loadMessages,
      startCodeReview: vi.fn(),
      decideCodeReviewFinding: vi.fn(),
      discussCodeReviewFinding: vi.fn(),
      submitCodeReviewRound: vi.fn(),
      finishCodeReview: vi.fn(),
      reviewCodeAgain: vi.fn(),
    },
    global: { components: { ElTooltip } },
  });
}

describe('RightWorkspacePanel', () => {
  it('offers a collapsed outline for a full Markdown document tab', async () => {
    const tab = rightWorkspaceFileTab('readme.md');
    const wrapper = mountPanel([tab], tab, {
      [tab]: { kind: 'markdown', title: 'README', content: '# Guide\n\n## Setup', state: 'idle' },
    });
    await flushPromises();
    const toggle = wrapper.get('.markdown-panel button[aria-expanded]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');
    expect(wrapper.findAll('[aria-label="Document outline"] button').map(row => row.text())).toStrictEqual(['Guide', 'Setup']);
  });
  it('saves an inactive transient tab from its own action without selecting or closing it', async () => {
    const first = 'file:markdown:first'; const second = 'file:markdown:second'; const saved = 'file:saved.md';
    const wrapper = mountPanel([first, second, saved], first, {
      [first]: { kind: 'markdown', title: 'First', documentId: 'first', content: '# First', state: 'idle' },
      [second]: { kind: 'markdown', title: 'Second', documentId: 'second', content: '# Second', state: 'idle' },
      [saved]: { kind: 'markdown', title: 'Saved', savedPath: '/repo/saved.md', content: '# Saved', state: 'idle' },
    });
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await wrapper.setProps({ saveDocument: save });
    const action = wrapper.get('[aria-label="Save Second as…"]');
    expect(wrapper.find('[aria-label="Save Saved as…"]').exists()).toBe(false);
    expect(action.element.nextElementSibling?.getAttribute('aria-label')).toBe('Close Second tab');
    expect(getComputedStyle(action.element).display).toBe('none');
    await action.trigger('click');
    expect(save).toHaveBeenCalledExactlyOnceWith(second);
    expect(action.attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('selectTab')).toBeUndefined();
    expect(wrapper.emitted('closeTab')).toBeUndefined();
    finish(); await flushPromises();
    expect(action.attributes('disabled')).toBeUndefined();
  });

  it('covers the browser with a drop target without unmounting its page', async () => {
    const wrapper = mountPanel(['browser'], 'browser');
    await wrapper.setProps({ linkDropActive: true });
    const target = wrapper.get('[aria-label="Drop link to open in sidebar"]');
    // The real stylesheet must place the hit target above the guest, not in the tab layout.
    expect(getComputedStyle(target.element).position).toBe('absolute');
    expect(Number(getComputedStyle(target.element).zIndex)).toBeGreaterThan(0);
    expect(getComputedStyle(target.element).pointerEvents).toBe('auto');
    expect(getComputedStyle(wrapper.element).position).toBe('relative');
    expect(wrapper.findComponent(BrowserPanel).exists()).toBe(true);
    await wrapper.setProps({ linkDropActive: false });
    expect(wrapper.find('[aria-label="Drop link to open in sidebar"]').exists()).toBe(false);
    expect(wrapper.findComponent(BrowserPanel).exists()).toBe(true);
  });
  it(`shows a ${product.name} launcher when no workspace tab has been opened`, async () => {
    const wrapper = mountPanel([], null);

    expect(wrapper.get('[aria-label="Open a workspace tab"]').text()).toContain('Review');
    expect(wrapper.get('[aria-label="Open a workspace tab"]').text()).toContain('Visualize');
    expect(wrapper.get('[aria-label="Open a workspace tab"]').text()).toContain('Changes');
    expect(wrapper.get('[aria-label="Open a workspace tab"]').text()).toContain('Browser');
    expect(wrapper.get('[aria-label="Open a workspace tab"]').text()).toContain('Files');
    expect(wrapper.findAll('.right-workspace-panel__launcher kbd').map((shortcut) => shortcut.text())).toStrictEqual(['⌘G', '⌘B']);
    expect(wrapper.text()).not.toContain('Terminal');

    for (const button of wrapper.findAll('.right-workspace-panel__launcher button')) {
      await button.trigger('click');
    }

    expect(wrapper.emitted('openTab')).toStrictEqual([['codeReview'], ['visualize'], ['review'], ['simulator'], ['browser'], ['files']]);

    await wrapper.get('[aria-label="Open right workspace tab"]').trigger('click');
    const visualizeMenuItem = wrapper.findAll('[role="menuitem"]').find(item => item.text() === 'Visualize');
    expect(visualizeMenuItem).toBeDefined();
    await visualizeMenuItem!.trigger('click');
    expect(wrapper.emitted('openTab')?.at(-1)).toStrictEqual(['visualize']);
  });

  it('switches and closes Browser and Review tabs', async () => {
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['Changes', 'Browser']);
    expect(wrapper.find('[aria-label="Show file explorer"]').exists()).toBe(false);
    await wrapper.findAll('[role="tab"]')[1]?.trigger('click');
    await wrapper.get('[aria-label="Close Changes tab"]').trigger('click');

    expect(wrapper.emitted('selectTab')).toStrictEqual([['browser']]);
    expect(wrapper.emitted('closeTab')).toStrictEqual([['review']]);
  });

  it('opens a changed file from its diff header in a full file tab', async () => {
    const wrapper = mountPanel(['review'], 'review');
    await wrapper.setProps({
      gitPanel: {
        kind: 'gitDiff',
        title: 'Review',
        diff: [
          'diff --git a/src/main.ts b/src/main.ts',
          '--- a/src/main.ts',
          '+++ b/src/main.ts',
          '@@ -1 +1 @@',
          '-export const oldValue = 1;',
          '+export const newValue = 2;',
        ].join('\n'),
        state: 'idle',
      },
    });

    await wrapper.get('[aria-label="Open src/main.ts in a tab"]').trigger('click');

    expect(wrapper.emitted('previewFile')).toStrictEqual([['src/main.ts']]);
    expect(wrapper.get('.git-diff-preview-panel__file-header').attributes('aria-expanded')).toBe('true');
  });

  it('shows a tab title tooltip when the label may be compressed', async () => {
    const fileTab = rightWorkspaceFileTab('src/long-file-name.ts');
    const wrapper = mountPanel([fileTab], fileTab, {
      [fileTab]: {
        kind: 'source', title: 'long-file-name.ts', subtitle: 'src/long-file-name.ts', content: '',
        language: 'typescript', state: 'idle', error: null,
      },
    });
    const tab = wrapper.get('[role="tab"]');

    expect(tab.attributes('aria-label')).toBe('long-file-name.ts');
    expect(tab.attributes('title')).toBeUndefined();
    await tab.trigger('mouseenter');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('long-file-name.ts');
    }, { timeout: 1_200 });
  });

  it('compresses tabs to icon width before requiring scroll navigation', async () => {
    const tabs = Array.from({ length: 20 }, (_, index) => rightWorkspaceFileTab(`src/file-${index}.ts`));
    const wrapper = mountPanel(tabs, tabs[0], {
      [tabs[0]!]: {
        kind: 'source', title: 'file-0.ts', subtitle: 'src/file-0.ts', content: '',
        language: 'typescript', state: 'idle', error: null,
      },
    });
    const strip = wrapper.get<HTMLElement>('.right-workspace-panel__tab-strip').element;
    const list = wrapper.get<HTMLElement>('.right-workspace-panel__tab-list').element;
    const track = wrapper.get<HTMLElement>('.right-workspace-panel__tab-track').element;
    Object.defineProperties(strip, { clientWidth: { configurable: true, value: 400 } });
    Object.defineProperties(list, {
      clientWidth: { configurable: true, value: 352 },
      scrollWidth: { configurable: true, value: 952 },
    });
    Object.defineProperties(track, { scrollWidth: { configurable: true, value: 952 } });
    window.dispatchEvent(new Event('resize'));
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(20);
    expect(getComputedStyle(track).width).toBe('100%');
    expect(getComputedStyle(wrapper.get('.right-workspace-panel__tab').element).minWidth).toBe('40px');
    expect(getComputedStyle(wrapper.get('.right-workspace-panel__tab').element).flexShrink).toBe('1');
    expect(wrapper.get('[role="tab"]').attributes('aria-label')).toBe('file-0.ts');
    expect(getComputedStyle(list).overflowX).toBe('auto');
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Scroll tabs left"]').element.disabled).toBe(true);
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Scroll tabs right"]').element.disabled).toBe(false);

    await wrapper.get('[aria-label="Scroll tabs right"]').trigger('click');
    expect(list.scrollLeft).toBe(304);
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Scroll tabs left"]').element.disabled).toBe(false);

    list.scrollLeft = 600;
    list.dispatchEvent(new Event('scroll'));
    await wrapper.vm.$nextTick();
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Scroll tabs right"]').element.disabled).toBe(true);

    list.scrollLeft = 0;
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 352 } as DOMRect);
    vi.spyOn(wrapper.findAll('.right-workspace-panel__tab')[19]!.element, 'getBoundingClientRect')
      .mockReturnValue({ left: 912, right: 952 } as DOMRect);
    await wrapper.setProps({ activeTab: tabs[19] });
    await flushPromises();
    expect(list.scrollLeft).toBe(600);
  });

  it('keeps the rendered tab control at the same height when its label is visible', () => {
    const wrapper = mountPanel();
    const tab = wrapper.get<HTMLElement>('[role="tab"]').element;

    expect(tab.textContent).toContain('Changes');
    expect(getComputedStyle(tab).height).toBe('var(--space-16)');
  });

  it('renders Files with a collapsible explorer beside supported workspace tabs', async () => {
    const wrapper = mountPanel(['files'], 'files');
    await wrapper.setProps({
      filesPaneOpen: true,
      files: [{ name: 'README.md', path: 'README.md' }],
    });

    expect(wrapper.get('[role="tab"]').text()).toBe('Open file');
    expect(wrapper.get('.right-workspace-panel__files-pane').text()).toContain('README.md');
    expect(wrapper.get('[aria-label="Collapse file explorer"]').attributes('aria-pressed')).toBe('true');

    await wrapper.get('button[title="Preview README.md"]').trigger('click');
    await wrapper.get('[aria-label="Collapse file explorer"]').trigger('click');

    expect(wrapper.emitted('previewFile')).toStrictEqual([['README.md']]);
    expect(wrapper.emitted('toggleFilesPane')).toHaveLength(1);
    await wrapper.setProps({ filesPaneOpen: false });
    expect(wrapper.find('.right-workspace-panel__files-pane').exists()).toBe(false);

    await wrapper.setProps({ activeTab: 'review', tabs: ['files', 'review'] });
    expect(wrapper.find('.right-workspace-panel__files-pane').exists()).toBe(false);

    await wrapper.setProps({ activeTab: 'files', filesPaneOpen: true });
    expect(wrapper.get('.right-workspace-panel__files-pane').text()).toContain('README.md');
  });

  it('resizes the file explorer with its keyboard-accessible separator', async () => {
    const wrapper = mountPanel(['files'], 'files');
    await wrapper.setProps({ filesPaneOpen: true, filesPaneWidth: 280 });
    vi.spyOn(wrapper.get('.right-workspace-panel__body').element, 'getBoundingClientRect').mockReturnValue({
      bottom: 600, height: 560, left: 0, right: 500, top: 40, width: 500, x: 0, y: 40, toJSON: () => ({}),
    });

    await wrapper.get('[aria-label="Resize file explorer"]').trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('resizeFilesPane')).toStrictEqual([[296]]);
    expect(wrapper.get('.right-workspace-panel__files-shell').attributes('style')).toContain('width: 296px');

    await wrapper.get('[aria-label="Resize file explorer"]').trigger('pointerdown');
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 180 }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('resizeFilesPane')).toStrictEqual([[296], [320]]);
    expect(wrapper.get('.right-workspace-panel__files-shell').attributes('style')).toContain('width: 320px');
    document.dispatchEvent(new MouseEvent('pointerup'));
  });

  it('opens the dedicated Review pane from the add-tab menu', async () => {
    const wrapper = mountPanel();

    await wrapper.get('[aria-label="Open right workspace tab"]').trigger('click');
    expect(wrapper.findAll('.app-menu__item').map((item) => item.text())).toStrictEqual(['Review', 'Visualize', 'Changes', 'Simulator', 'Browser', 'Files']);
    await wrapper.findAll('.app-menu__item')[0]?.trigger('click');

    expect(wrapper.emitted('openTab')).toStrictEqual([['codeReview']]);
  });

  it('renders an existing repository backlog without offering it in the add-tab menu', async () => {
    const startRepositoryWork = vi.fn().mockResolvedValue(undefined);
    const launcher = mountPanel([], null);
    await launcher.setProps({ githubRepository: 'nbonamy/agent-workspace' });

    expect(launcher.get('[aria-label="Open a workspace tab"]').text()).not.toContain('Backlog');

    const wrapper = mountPanel(['backlog'], 'backlog');
    await wrapper.setProps({
      githubRepository: 'nbonamy/agent-workspace',
      startRepositoryWork,
    });

    expect(wrapper.get('[role="tab"]').text()).toBe('Backlog');
    expect(wrapper.get('[role="tab"]').findComponent({ name: 'BacklogIcon' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'RepositoryBacklogPanel' }).props()).toMatchObject({
      repositoryId: 'nbonamy/agent-workspace',
      startWorkAction: startRepositoryWork,
    });

    await wrapper.get('[aria-label="Open right workspace tab"]').trigger('click');
    expect(wrapper.findAll('.app-menu__item').map((item) => item.text())).not.toContain('Backlog');
  });

  it('omits the embedded Browser when the host does not provide it', async () => {
    const wrapper = mountPanel([], null, {}, null, {}, undefined, false);

    expect(wrapper.get('[aria-label="Open a workspace tab"]').text()).toContain('Review');
    expect(wrapper.get('[aria-label="Open a workspace tab"]').text()).not.toContain('Browser');
    await wrapper.get('[aria-label="Open right workspace tab"]').trigger('click');
    expect(wrapper.findAll('.app-menu__item').map((item) => item.text())).toStrictEqual(['Review', 'Visualize', 'Changes', 'Simulator', 'Files']);
  });

  it('renders file previews as independently closable workspace tabs', async () => {
    const fileTab = 'file:src%2Fmain.ts' as const;
    const wrapper = mountPanel(['browser', fileTab], fileTab, {
      [fileTab]: {
        kind: 'source',
        title: 'main.ts',
        subtitle: 'src/main.ts',
        content: 'export const ready = true;\n',
        language: 'typescript',
        state: 'idle',
        error: null,
      },
    });
    await flushPromises();

    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['Browser', 'main.ts']);
    expect(wrapper.get('.source-preview-panel').text()).toContain('ready');
    expect(wrapper.get('[aria-label="Show file explorer"]').attributes('aria-pressed')).toBe('false');

    await wrapper.get('[aria-label="Close main.ts tab"]').trigger('click');
    expect(wrapper.emitted('closeTab')).toStrictEqual([[fileTab]]);
  });

  it('copies absolute and relative paths from the right-clicked file tab without selecting it', async () => {
    const fileTab = 'file:src%2Fmain.ts' as const;
    const copyText = vi.fn().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copyText } });
    try {
      const wrapper = mountPanel(['browser', fileTab], 'browser', {
        [fileTab]: {
          kind: 'source', title: 'main.ts', subtitle: 'src/main.ts', content: '',
          language: 'typescript', state: 'idle', error: null,
        },
      });
      await wrapper.findAll('.right-workspace-panel__tab')[1]?.trigger('contextmenu', { clientX: 32, clientY: 48 });

      const menu = document.body.querySelector('[aria-label="Tab actions"]');
      expect([...menu!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())).toStrictEqual([
        'Copy path', 'Copy relative path', 'Close tab', 'Close other tabs',
      ]);
      expect(menu?.querySelectorAll('[role="separator"]')).toHaveLength(1);
      expect(wrapper.emitted('selectTab')).toBeUndefined();
      (menu?.querySelector('[role="menuitem"]') as HTMLElement).click();
      await flushPromises();

      expect(document.body.querySelector('[aria-label="Tab actions"]')).toBeNull();

      await wrapper.findAll('.right-workspace-panel__tab')[1]?.trigger('contextmenu');
      const relativeMenu = document.body.querySelector('[aria-label="Tab actions"]');
      const copyRelative = [...relativeMenu!.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.trim() === 'Copy relative path');
      copyRelative?.click();
      await flushPromises();

      await wrapper.setProps({
        filePanels: {
          [fileTab]: {
            kind: 'source', title: 'main.ts', subtitle: '/repo/src/main.ts', content: '',
            language: 'typescript', state: 'idle', error: null,
          },
        },
      });
      await wrapper.findAll('.right-workspace-panel__tab')[1]?.trigger('contextmenu');
      const absoluteMenu = document.body.querySelector('[aria-label="Tab actions"]');
      const relativeFromAbsolute = [...absoluteMenu!.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.trim() === 'Copy relative path');
      relativeFromAbsolute?.click();
      await flushPromises();

      await wrapper.setProps({
        filePanels: {
          [fileTab]: {
            kind: 'source', title: 'main.ts', subtitle: '/outside/main.ts', content: '',
            language: 'typescript', state: 'idle', error: null,
          },
        },
      });
      await wrapper.findAll('.right-workspace-panel__tab')[1]?.trigger('contextmenu');
      const outsideMenu = document.body.querySelector('[aria-label="Tab actions"]');
      expect([...outsideMenu!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())).toStrictEqual([
        'Copy path', 'Close tab', 'Close other tabs',
      ]);
      (outsideMenu?.querySelector('[role="menuitem"]') as HTMLElement).click();
      await flushPromises();
      expect(copyText.mock.calls).toStrictEqual([
        ['/repo/src/main.ts'],
        ['src/main.ts'],
        ['src/main.ts'],
        ['/outside/main.ts'],
      ]);
      expect(wrapper.emitted('selectTab')).toBeUndefined();

      await wrapper.findAll('.right-workspace-panel__tab')[0]?.trigger('contextmenu');
      const browserMenu = document.body.querySelector('[aria-label="Tab actions"]');
      expect([...browserMenu!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())).toStrictEqual([
        'Copy URL', 'Open in external browser', 'Close tab', 'Close other tabs',
      ]);
      expect(browserMenu?.querySelectorAll('[role="separator"]')).toHaveLength(1);
      expect([...browserMenu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].slice(0, 2).map((item) => item.disabled)).toStrictEqual([true, true]);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('copies the current browser URL and opens it in the system browser from the tab menu', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copyText } });
    const openExternal = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      const wrapper = mountPanel(['browser'], 'browser');
      wrapper.getComponent(BrowserPanel).vm.$emit('url-change', 'https://example.com/current');
      await wrapper.vm.$nextTick();
      await wrapper.get('.right-workspace-panel__tab').trigger('contextmenu');

      const menu = document.body.querySelector('[aria-label="Tab actions"]');
      expect([...menu!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())).toStrictEqual([
        'Copy URL', 'Open in external browser', 'Close tab', 'Close other tabs',
      ]);
      expect(menu?.querySelectorAll('[role="separator"]')).toHaveLength(1);
      (menu?.querySelector('[role="menuitem"]') as HTMLElement).click();
      await flushPromises();
      expect(copyText).toHaveBeenCalledWith('https://example.com/current');

      await wrapper.get('.right-workspace-panel__tab').trigger('contextmenu');
      const external = [...document.body.querySelectorAll<HTMLElement>('[aria-label="Tab actions"] [role="menuitem"]')]
        .find((item) => item.textContent?.trim() === 'Open in external browser');
      external?.click();
      await flushPromises();
      expect(openExternal).toHaveBeenCalledWith('https://example.com/current', '_blank', 'noopener,noreferrer');

      wrapper.getComponent(BrowserPanel).vm.$emit('url-change', 'file:///repo/README.md');
      await wrapper.vm.$nextTick();
      await wrapper.get('.right-workspace-panel__tab').trigger('contextmenu');
      const fileUrlMenu = document.body.querySelector('[aria-label="Tab actions"]');
      expect([...fileUrlMenu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].slice(0, 2).map((item) => item.disabled)).toStrictEqual([false, true]);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('closes a tab through its context menu and disables Close other tabs when it is alone', async () => {
    const wrapper = mountPanel(['files'], 'files');
    await wrapper.get('.right-workspace-panel__tab').trigger('contextmenu');

    const menu = document.body.querySelector('[aria-label="Tab actions"]');
    const closeOthers = [...menu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.trim() === 'Close other tabs');
    expect(closeOthers?.disabled).toBe(true);
    const closeTab = [...menu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.trim() === 'Close tab');
    closeTab?.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('closeTab')).toStrictEqual([['files']]);
    expect(document.body.querySelector('[aria-label="Tab actions"]')).toBeNull();
  });

  it('keeps the right-clicked inactive tab and closes every other tab', async () => {
    const wrapper = mountPanel(['review', 'browser', 'files'], 'review');
    await wrapper.findAll('.right-workspace-panel__tab')[1]?.trigger('contextmenu');

    const menu = document.body.querySelector('[aria-label="Tab actions"]');
    const closeOthers = [...menu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.trim() === 'Close other tabs');
    closeOthers?.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('selectTab')).toStrictEqual([['browser']]);
    expect(wrapper.emitted('closeTab')).toStrictEqual([['review'], ['files']]);
    expect(document.body.querySelector('[aria-label="Tab actions"]')).toBeNull();
  });

  it('keeps the native browser visible while tab menus open and close', async () => {
    const wrapper = mountPanel(['browser'], 'browser');
    await flushPromises();
    const browserSetVisible = vi.mocked(window.app!.browserSetVisible);
    browserSetVisible.mockClear();

    await wrapper.get('.right-workspace-panel__tab').trigger('contextmenu');
    await flushPromises();
    expect(document.body.querySelector('[aria-label="Tab actions"]')).not.toBeNull();
    expect(browserSetVisible).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(document.body.querySelector('[aria-label="Tab actions"]')).toBeNull();
    expect(browserSetVisible).not.toHaveBeenCalled();

    await wrapper.get('[aria-label="Open right workspace tab"]').trigger('click');
    await flushPromises();
    expect(browserSetVisible).not.toHaveBeenCalled();

    document.body.click();
    await flushPromises();
    expect(browserSetVisible).not.toHaveBeenCalled();
  });

  it('opens project files externally but omits Open In for outside-file previews', async () => {
    const fileTab = 'file:src%2Fmain.ts' as const;
    const projectPanel = {
      kind: 'source' as const,
      title: 'main.ts',
      subtitle: 'src/main.ts',
      content: 'export const ready = true;\n',
      language: 'typescript',
      state: 'idle' as const,
      error: null,
    };
    const catalog: OpenInApplicationCatalog = {
      defaultApplication: 'vscode',
      applications: [{ id: 'vscode', label: 'VS Code' }],
    };
    const wrapper = mountPanel([fileTab], fileTab, { [fileTab]: projectPanel }, null, {}, catalog);

    expect(wrapper.get('.open-in-control').classes()).toContain('open-in-control--compact');
    await wrapper.get('[aria-label="Open in VS Code"]').trigger('click');
    expect(wrapper.emitted('openIn')).toStrictEqual([[
      { application: 'vscode', filePath: 'src/main.ts' },
    ]]);

    const outsideWrapper = mountPanel([fileTab], fileTab, {
      [fileTab]: { ...projectPanel, subtitle: '/outside/main.ts' },
    }, null, {}, catalog);
    expect(outsideWrapper.find('[aria-label="Open in VS Code"]').exists()).toBe(false);
  });

  it.each(['markdown', 'native review'] as const)('renders a %s plan beside existing workspace tabs', async (kind) => {
    const wrapper = mountPanel(['browser', 'plan'], 'plan', {}, {
      kind: 'markdown',
      purpose: 'plan',
      title: 'Implementation plan',
      content: '# Plan\n\nKeep Browser available.',
      state: 'idle',
      error: null,
    });
    if (kind === 'native review') {
      await wrapper.setProps({ agent: {
        ...wrapper.props('agent'),
        backendSession: { kind: 'codex', threadId: 'plan-thread' },
        planReview: { id: 'plan-review', conversationId: 'plan-thread', turnId: 'plan-turn', markdown: '# Plan\n\nKeep Browser available.', status: 'pending' },
      } });
    }

    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['Browser', 'Implementation plan']);
    expect(wrapper.get('h1').text()).toBe('Plan');
    expect(wrapper.get('[aria-label="Right workspace"]').text()).toContain('Keep Browser available.');
    expect(wrapper.find('.plan-review-footer').exists()).toBe(kind === 'native review');

    await wrapper.findAll('[role="tab"]')[0]?.trigger('click');
    await wrapper.get('[aria-label="Close Implementation plan tab"]').trigger('click');

    expect(wrapper.emitted('selectTab')).toStrictEqual([['browser']]);
    expect(wrapper.emitted('closeTab')).toStrictEqual([['plan']]);
  });

  it('renders conversation images as independently closable workspace tabs', async () => {
    const imageTab = 'image:preview' as const;
    const wrapper = mountPanel([imageTab], imageTab, {}, null, {
      [imageTab]: {
        kind: 'image',
        title: 'diagram.png',
        subtitle: '/repo/diagram.png',
        path: '/repo/diagram.png',
        src: 'data:image/png;base64,aW1hZ2U=',
        alt: 'Architecture diagram',
        mimeType: 'image/png',
        state: 'idle',
        error: null,
      },
    });

    expect(wrapper.get('[role="tab"]').text()).toBe('diagram.png');
    expect(wrapper.get('.image-preview-panel img').attributes()).toMatchObject({
      alt: 'Architecture diagram',
      src: 'data:image/png;base64,aW1hZ2U=',
    });

    await wrapper.get('[aria-label="Close diagram.png tab"]').trigger('click');
    expect(wrapper.emitted('closeTab')).toStrictEqual([[imageTab]]);
  });

  it('renders selected subagents as independent workspace tabs', async () => {
    const loadMessages = vi.fn().mockResolvedValue([]);
    const wrapper = mountPanel(['subagent:thread-scout', 'subagent:thread-reviewer'], 'subagent:thread-reviewer', {}, null, {}, undefined, true, {
      loadMessages,
      tree: {
        rootConversationId: 'thread-root',
        nodes: {
          'thread-scout': {
            conversationId: 'thread-scout',
            parentConversationId: 'thread-root',
            createdAt: '2026-08-01T00:00:00.000Z',
            status: 'running',
            agentPath: '/root/scout',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
          'thread-reviewer': {
            conversationId: 'thread-reviewer',
            parentConversationId: 'thread-root',
            createdAt: '2026-08-01T00:00:01.000Z',
            status: 'completed',
            agentPath: '/root/reviewer',
            agentNickname: 'Harvey',
            updatedAt: '2026-08-01T00:00:01.000Z',
          },
        },
        operations: {},
        activities: {},
      },
    });
    await flushPromises();

    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['scout', 'Harvey']);
    expect(wrapper.findAllComponents({ name: 'SubagentPanel' })).toHaveLength(2);
    expect(loadMessages).not.toHaveBeenCalledWith('thread-scout');
    expect(loadMessages).toHaveBeenCalledWith('thread-reviewer');
  });
});
