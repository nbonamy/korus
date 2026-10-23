import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { serialize } from 'node:v8';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElMessage } from 'element-plus';
import BrowserPanel from '../BrowserPanel.vue';
import { setElectronTestClient } from '../../test/client';
import type { AppCommand, MainToRendererEvent } from '@workspace/core/contracts';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import GitDiffControl from '../GitDiffControl.vue';
import { useAppState } from '../../app-state';

class ResizeObserverStub {
  static latest: ResizeObserverStub | null = null;
  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.latest = this;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  notify(): void { this.callback([], this as unknown as ResizeObserver); }
}

beforeEach(() => {
  ResizeObserverStub.latest = null;
  Object.defineProperty(HTMLElement.prototype, 'getWebContentsId', { configurable: true, value: () => 42 });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'getWebContentsId');
});

function mountPanel(
  props: { agentId?: string; browserId?: string; initialUrl?: string; openRequestId?: number; visualization?: { path: string; title: string } } = {},
  options: { deferDomReady?: boolean; attachTo?: Element } = {},
) {
  let listener: ((event: MainToRendererEvent) => void) | null = null;
  let commandListener: ((command: AppCommand) => void) | null = null;
  const browserOpen = vi.fn().mockResolvedValue({
    url: '',
    title: '',
    canGoBack: true,
    canGoForward: true,
  });
  const api = {
    updateSettings: vi.fn().mockResolvedValue(createInitialSnapshot()),
    browserOpen,
    browserOpenVisualization: vi.fn().mockResolvedValue({
      url: '',
      title: 'Backlog icon candidates',
      canGoBack: false,
      canGoForward: false,
    }),
    browserNavigate: vi.fn().mockResolvedValue({
      url: 'https://example.com/',
      title: 'Example',
      canGoBack: false,
      canGoForward: false,
    }),
    browserGoBack: vi.fn().mockResolvedValue({ url: 'https://back.example/', title: 'Back', canGoBack: false, canGoForward: true }),
    browserGoForward: vi.fn().mockResolvedValue({ url: 'https://forward.example/', title: 'Forward', canGoBack: true, canGoForward: false }),
    browserReload: vi.fn().mockResolvedValue({ url: 'https://reload.example/', title: 'Reload', canGoBack: true, canGoForward: true }),
    browserGetZoom: vi.fn().mockResolvedValue(100),
    browserSetZoom: vi.fn(async (_agentId: string, _browserId: string, percent: number) => percent),
    browserCopyScreenshot: vi.fn().mockResolvedValue(undefined),
    browserSetBounds: vi.fn().mockResolvedValue(undefined),
    browserViewportApplied: vi.fn().mockResolvedValue(undefined),
    browserSetVisible: vi.fn().mockResolvedValue(undefined),
    browserSetAnnotationMode: vi.fn().mockResolvedValue(undefined),
    browserClearAnnotations: vi.fn().mockResolvedValue(undefined),
    browserClose: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn((nextListener) => {
      listener = nextListener;
      return vi.fn();
    }),
    onAppCommand: vi.fn((nextListener) => {
      commandListener = nextListener;
      return () => { commandListener = null; };
    }),
  };
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  setElectronTestClient(api);
  const wrapper = mount(BrowserPanel, { attachTo: options.attachTo, props: { agentId: 'agent-1', visible: true, ...props } });
  const emitDomReady = () => wrapper.get('webview').element.dispatchEvent(new Event('dom-ready'));
  if (!options.deferDomReady) queueMicrotask(emitDomReady);
  return { api, browserOpen, emitDomReady, emitEvent: (event: MainToRendererEvent) => listener?.(event), emitCommand: (command: AppCommand) => commandListener?.(command), wrapper };
}

describe('BrowserPanel', () => {
  it('saves only bookmark preferences and opens a bookmark in the owning agent and browser pane', async () => {
    const appState = useAppState();
    appState.snapshot.value = createInitialSnapshot();
    const { wrapper, api } = mountPanel({ agentId: 'agent-2', browserId: 'second-tab' });
    await flushPromises();
    await wrapper.get('input[aria-label="Browser address"]').setValue('https://example.com/');
    await wrapper.get('form.browser-panel__address').trigger('submit');
    await flushPromises();
    const updated = createInitialSnapshot();
    updated.general.browserBookmarks = [{ title: 'Example preview', url: 'https://example.com/' }];
    api.updateSettings.mockResolvedValue(updated);
    await wrapper.get('button[aria-label="Bookmark this page"]').trigger('click');
    await flushPromises();
    const page = new DOMWrapper(document.body);
    await page.get('input[aria-label="Bookmark name"]').setValue('Example preview');
    await page.get('form[id^="bookmark-"]').trigger('submit');
    await flushPromises();
    expect(api.updateSettings).toHaveBeenCalledExactlyOnceWith({ general: { browserBookmarks: updated.general.browserBookmarks } });
    expect(wrapper.get('button[aria-label="Delete Example preview"]').attributes('aria-pressed')).toBe('true');
    await wrapper.get('[aria-label="Bookmarks"]').trigger('click');
    await flushPromises();
    await page.get('.quick-open-dialog__item').trigger('click');
    await flushPromises();
    expect(api.browserNavigate).toHaveBeenLastCalledWith('agent-2', 'second-tab', 'https://example.com/');
    await wrapper.setProps({ visualization: { path: '/repo/chart.html', title: 'Chart' } });
    expect(wrapper.find('[aria-label="Bookmarks"]').exists()).toBe(false);
    wrapper.unmount();
    appState.snapshot.value = createInitialSnapshot();
  });
  it.each([false, true])('recovers model navigation after initial failure (manual recovery: %s)', async (manualRecovery) => {
    const { api, emitDomReady, wrapper } = mountPanel({ initialUrl: 'http://127.0.0.1:57540' }, { deferDomReady: true });
    api.browserOpen.mockRejectedValueOnce(new Error('ERR_CONNECTION_REFUSED'));
    emitDomReady();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('ERR_CONNECTION_REFUSED');
    const recovered = { url: 'https://example.com/', title: 'Example', canGoBack: false, canGoForward: false };
    api.browserOpen.mockResolvedValue(recovered);
    if (manualRecovery) {
      await wrapper.get('input[aria-label="Browser address"]').setValue('https://example.com/');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    }
    api.browserNavigate.mockClear();
    await wrapper.setProps({ initialUrl: recovered.url, openRequestId: 1 });
    await flushPromises();
    expect(manualRecovery ? api.browserNavigate : api.browserOpen).toHaveBeenLastCalledWith(
      'agent-1', 'primary', recovered.url, ...(manualRecovery ? [] : [42]),
    );
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.emitted('url-change')?.at(-1)).toStrictEqual([recovered.url]);
  });

  it('honors a new model request when the initial page fails while loading', async () => {
    const { api, emitDomReady, wrapper } = mountPanel({}, { deferDomReady: true });
    let failInitial: ((reason: Error) => void) | undefined;
    api.browserOpen.mockImplementationOnce(() => new Promise((_resolve, reject) => { failInitial = reject; }));
    emitDomReady();
    await flushPromises();
    const url = 'https://example.com/';
    api.browserOpen.mockResolvedValue({ url, title: 'Example', canGoBack: false, canGoForward: false });
    await wrapper.setProps({ initialUrl: url, openRequestId: 1 });
    failInitial?.(new Error('ERR_CONNECTION_REFUSED'));
    await flushPromises();
    expect(api.browserOpen).toHaveBeenLastCalledWith('agent-1', 'primary', url, 42);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.emitted('url-change')?.at(-1)).toStrictEqual([url]);
  });

  it('applies targeted viewport requests through device controls and acknowledges layout, including reset', async () => {
    const { wrapper, api, emitCommand } = mountPanel();
    await flushPromises();
    const request = { type: 'set-browser-viewport' as const, agentId: 'agent-1', browserId: 'primary', requestId: 'phone', viewport: { preset: 'phone' as const, width: 390, height: 844 } };
    emitCommand({ ...request, agentId: 'someone-else' });
    emitCommand({ ...request, browserId: 'other-tab' });
    expect(api.browserViewportApplied).not.toHaveBeenCalled();
    expect(wrapper.find('.browser-panel__device-toolbar').exists()).toBe(false);

    emitCommand(request);
    await vi.waitFor(() => expect(api.browserViewportApplied).toHaveBeenCalledWith('agent-1', 'primary', 'phone', undefined));
    expect(wrapper.get<HTMLSelectElement>('[aria-label="Device mode"]').element.value).toBe('phone');
    expect(wrapper.get<HTMLElement>('.browser-panel__guest-frame').element.style.width).toBe('390px');
    expect(wrapper.get<HTMLElement>('.browser-panel__guest-frame').element.style.height).toBe('844px');

    emitCommand({ ...request, requestId: 'custom', viewport: { preset: 'custom', width: 900, height: 700 } });
    await vi.waitFor(() => expect(api.browserViewportApplied).toHaveBeenCalledWith('agent-1', 'primary', 'custom', undefined));
    expect(wrapper.get<HTMLInputElement>('[aria-label="Viewport width"]').element.value).toBe('900');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Viewport height"]').element.value).toBe('700');
    emitCommand({ ...request, requestId: 'fit', viewport: { preset: 'fit' } });
    await vi.waitFor(() => expect(api.browserViewportApplied).toHaveBeenCalledWith('agent-1', 'primary', 'fit', undefined));
    expect(wrapper.find('.browser-panel__device-toolbar').exists()).toBe(false);
    expect(wrapper.get<HTMLElement>('.browser-panel__guest-frame').element.style.width).toBe('');
    wrapper.unmount();
  });

  it('rejects viewport requests when the panel is hidden', async () => {
    const { wrapper, api, emitCommand } = mountPanel();
    await flushPromises();
    await wrapper.setProps({ visible: false });
    emitCommand({ type: 'set-browser-viewport', agentId: 'agent-1', browserId: 'primary', requestId: 'hidden', viewport: { preset: 'phone', width: 390, height: 844 } });
    await flushPromises();
    expect(api.browserViewportApplied).toHaveBeenCalledWith('agent-1', 'primary', 'hidden', expect.stringContaining('Open'));
    expect(wrapper.find('.browser-panel__device-toolbar').exists()).toBe(false);
    wrapper.unmount();
  });
  it.each([
    ['app', 'https://www.google.com/search?q=app'],
    ['  how do worktrees work?  ', 'https://www.google.com/search?q=how%20do%20worktrees%20work%3F'],
    ['example.com/docs', 'example.com/docs'],
    ['example.com:8080/docs', 'https://example.com:8080/docs'],
    ['localhost:3000', 'http://localhost:3000'],
    ['https://example.com/', 'https://example.com/'],
    ['javascript:alert(1)', 'javascript:alert(1)'],
  ])('submits address-bar input %s as a URL or search', async (input, expected) => {
    const { wrapper, api } = mountPanel();
    await flushPromises();
    await wrapper.get('input[aria-label="Browser address"]').setValue(input);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.browserNavigate).toHaveBeenCalledWith('agent-1', 'primary', expected);
  });

  it('waits for the attached guest document before requesting its WebContents ID', async () => {
    const getWebContentsId = vi.fn(() => 42);
    Object.defineProperty(HTMLElement.prototype, 'getWebContentsId', { configurable: true, value: getWebContentsId });
    const { browserOpen, emitDomReady } = mountPanel({}, { deferDomReady: true });

    expect(getWebContentsId).not.toHaveBeenCalled();
    expect(browserOpen).not.toHaveBeenCalled();
    emitDomReady();
    await flushPromises();

    expect(getWebContentsId).toHaveBeenCalledOnce();
    expect(browserOpen).toHaveBeenCalledWith('agent-1', 'primary', '', 42);
  });

  it('keeps a clean browser surface and does not set bounds when guest startup fails', async () => {
    Object.defineProperty(HTMLElement.prototype, 'getWebContentsId', {
      configurable: true,
      value: () => { throw new Error('Guest failed to initialize'); },
    });
    const { api, emitDomReady, wrapper } = mountPanel({}, { deferDomReady: true });

    expect(wrapper.find('.browser-panel__viewport').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Opening browser');
    emitDomReady();
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Guest failed to initialize');
    expect(api.browserOpen).not.toHaveBeenCalled();
    expect(api.browserSetBounds).not.toHaveBeenCalled();
  });

  it('keeps the browser page and a header menu in the same visible workspace', async () => {
    const { api, wrapper } = mountPanel();
    await flushPromises();
    const header = mount(GitDiffControl, {
      attachTo: document.body,
      props: {
        agentId: 'agent-1',
        gitStatus: {
          folder: '/src/project', branch: 'main', addedLines: 4, removedLines: 2, changedFiles: 1,
          ahead: 0, behind: 0, hasUntracked: false, state: 'dirty', updatedAt: '2026-09-25T00:00:00Z',
        },
      },
    });
    api.browserSetVisible.mockClear();
    await header.get('.git-diff-control__menu-trigger').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
    expect(wrapper.find('.browser-panel__viewport webview').exists()).toBe(true);
    expect(api.browserSetVisible).not.toHaveBeenCalled();
  });

  it('keeps the native browser visible when a tooltip is already present', async () => {
    const tooltip = document.createElement('span');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.style.opacity = '0';
    document.body.append(tooltip);
    try {
      const { api } = mountPanel();
      await flushPromises();
      expect(api.browserSetVisible).not.toHaveBeenCalledWith('agent-1', 'primary', false);
    } finally {
      tooltip.remove();
    }
  });
  it('opens an isolated browser for the active agent and exposes annotation mode', async () => {
    const { api, browserOpen, wrapper } = mountPanel();
    await flushPromises();

    expect(browserOpen).toHaveBeenCalledWith('agent-1', 'primary', '', 42);
    expect((wrapper.get('[aria-label="Browser address"]').element as HTMLInputElement).value).toBe('');
    expect(api.browserSetBounds).toHaveBeenCalledTimes(1);

    await wrapper.get('.browser-panel__annotate').trigger('click');

    expect(api.browserSetAnnotationMode).toHaveBeenCalledWith('agent-1', 'primary', true);
    expect(wrapper.get('.browser-panel__annotation-title').text()).toContain('Annotating');
  });

  it('navigates an already-open pane when the model sends another browser request', async () => {
    const { api, wrapper } = mountPanel();
    await flushPromises();

    await wrapper.setProps({ initialUrl: 'https://example.com', openRequestId: 1 } as Record<string, unknown>);
    await flushPromises();

    expect(api.browserNavigate).toHaveBeenCalledWith('agent-1', 'primary', 'https://example.com');
    expect((wrapper.get('[aria-label="Browser address"]').element as HTMLInputElement).value).toBe('https://example.com/');
  });

  it('hides idle address actions while keeping their keyboard targets in the bar', async () => {
    const { api, emitDomReady, wrapper } = mountPanel({}, { deferDomReady: true, attachTo: document.body });
    api.browserOpen.mockResolvedValueOnce({ url: 'https://example.com/', title: 'Example', canGoBack: false, canGoForward: false });
    emitDomReady();
    await flushPromises();
    const bookmarkPage = wrapper.get<HTMLElement>('[aria-label="Bookmark this page"]').element;
    const external = wrapper.get<HTMLElement>('[aria-label="Open in external browser"]').element;
    const picker = wrapper.get<HTMLButtonElement>('[aria-label="Bookmarks"]').element;
    expect(picker.closest('form')).toBeNull();
    expect(bookmarkPage.closest('form')).toBe(wrapper.get('form.browser-panel__address').element);
    for (const control of [bookmarkPage, external]) {
      expect(getComputedStyle(control).opacity).toBe('0');
      expect(getComputedStyle(control).pointerEvents).toBe('none');
    }
    const address = wrapper.get<HTMLInputElement>('input[aria-label="Browser address"]').element;
    address.focus();
    expect(document.activeElement).toBe(address);
    picker.focus();
    expect(document.activeElement).toBe(picker);
    picker.blur();
    expect(getComputedStyle(bookmarkPage).opacity).toBe('0');
    wrapper.unmount();
  });

  it('opens the loaded page in the system browser and follows navigation inside the page', async () => {
    const { api, emitDomReady, wrapper } = mountPanel({}, { deferDomReady: true });
    api.browserOpen.mockResolvedValueOnce({
      url: 'https://example.com/start', title: 'Start', canGoBack: false, canGoForward: false,
    });
    const openExternal = vi.spyOn(window, 'open').mockReturnValue(null);
    emitDomReady();
    await flushPromises();

    const button = wrapper.get('[aria-label="Open in external browser"]');
    await button.trigger('click');
    expect(openExternal).toHaveBeenCalledWith('https://example.com/start', '_blank', 'noopener,noreferrer');

    wrapper.get('webview').element.dispatchEvent(Object.assign(new Event('did-navigate'), {
      url: 'https://example.com/next',
    }));
    await flushPromises();

    expect((wrapper.get('[aria-label="Browser address"]').element as HTMLInputElement).value).toBe('https://example.com/next');
    expect(wrapper.emitted('url-change')?.at(-1)).toStrictEqual(['https://example.com/next']);
    await button.trigger('click');
    expect(openExternal).toHaveBeenLastCalledWith('https://example.com/next', '_blank', 'noopener,noreferrer');

    wrapper.get('webview').element.dispatchEvent(Object.assign(new Event('did-navigate-in-page'), {
      url: 'https://example.com/next#details', isMainFrame: true,
    }));
    await flushPromises();
    expect(wrapper.emitted('url-change')?.at(-1)).toStrictEqual(['https://example.com/next#details']);
  });

  it('keeps the latest requested address when blank browser startup finishes after navigation', async () => {
    const { api, emitDomReady, wrapper } = mountPanel({}, { deferDomReady: true });
    const requestedUrl = 'http://127.0.0.1:4174/videos/visualize-film.html?t=25';
    let finishBlankOpen: ((state: { url: string; title: string; canGoBack: boolean; canGoForward: boolean }) => void) | undefined;
    api.browserOpen.mockImplementationOnce(() => new Promise((resolve) => { finishBlankOpen = resolve; }));
    api.browserNavigate.mockResolvedValueOnce({ url: requestedUrl, title: 'Visualize and refine', canGoBack: true, canGoForward: false });
    emitDomReady();
    await flushPromises();

    await wrapper.setProps({ initialUrl: requestedUrl, openRequestId: 1 });
    finishBlankOpen?.({ url: 'about:blank', title: '', canGoBack: false, canGoForward: false });
    await flushPromises();

    expect(api.browserNavigate).toHaveBeenCalledWith('agent-1', 'primary', requestedUrl);
    expect((wrapper.get('[aria-label="Browser address"]').element as HTMLInputElement).value).toBe(requestedUrl);
  });

  it('opens visualization content through the dedicated host API without exposing it as a browser address', async () => {
    const { api, browserOpen, wrapper } = mountPanel({
      visualization: { path: '/tmp/backlog-icon-candidates.html', title: 'Backlog icon candidates' },
    });
    await flushPromises();

    expect(browserOpen).not.toHaveBeenCalled();
    expect(api.browserOpenVisualization).toHaveBeenCalledWith(
      'agent-1',
      'primary',
      '/tmp/backlog-icon-candidates.html',
      'Backlog icon candidates',
      42,
    );
    expect(wrapper.get('.browser-panel__visualization-title').text()).toBe('Backlog icon candidates');
    expect(wrapper.find('[aria-label="Browser address"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Annotate page"]').exists()).toBe(false);
  });

  it('accumulates annotations and sends one scoped prompt when the batch is ready', async () => {
    const { api, emitEvent, wrapper } = mountPanel({}, { attachTo: document.body });
    await flushPromises();
    await wrapper.get('[aria-label="Annotate page"]').trigger('click');

    emitEvent({
      seq: 1,
      type: 'browser.annotationCreated',
      occurredAt: '2026-07-29T00:00:00.000Z',
      payload: {
        id: 'annotation-1',
        agentId: 'agent-1',
        browserId: 'primary',
        kind: 'element',
        url: 'http://localhost:3000/',
        selector: '#save',
        label: 'Save changes',
        comment: 'Keep this on one line on mobile.',
        rect: { x: 8, y: 16, width: 100, height: 40 },
      },
    });
    emitEvent({
      seq: 2,
      type: 'browser.annotationCreated',
      occurredAt: '2026-07-29T00:00:01.000Z',
      payload: {
        id: 'annotation-2',
        agentId: 'agent-1',
        browserId: 'primary',
        kind: 'area',
        url: 'http://localhost:3000/',
        comment: 'Make this button blue.',
        rect: { x: 120, y: 220, width: 160, height: 40 },
      },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('send-prompt')).toBeUndefined();
    expect(wrapper.find('[aria-label="Browser side panel"]').exists()).toBe(false);

    const send = wrapper.get<HTMLButtonElement>('[aria-label="Send 2 annotations"]');
    const style = getComputedStyle(send.element);
    expect(style.display).toBe('inline-flex');
    expect(style.width).toBe('auto');
    expect(style.whiteSpace).toBe('nowrap');
    await send.trigger('click');

    expect(wrapper.emitted('send-prompt')).toStrictEqual([[
      'Browser annotations on http://localhost:3000/\n\n1. Target: element #save\n   Feedback: Keep this on one line on mobile.\n\n2. Target: selected area at 120,220 (160×40)\n   Feedback: Make this button blue.\n\nInspect the rendered page and make the smallest changes that address every annotation.',
    ]]);
    expect(api.browserClearAnnotations).toHaveBeenCalledTimes(1);
  });

  it('clears every queued annotation when annotation mode is cancelled', async () => {
    const { api, emitEvent, wrapper } = mountPanel();
    await flushPromises();
    await wrapper.get('[aria-label="Annotate page"]').trigger('click');
    emitEvent({
      seq: 1,
      type: 'browser.annotationCreated',
      occurredAt: '2026-07-29T00:00:00.000Z',
      payload: {
        id: 'annotation-1', agentId: 'agent-1', browserId: 'primary', kind: 'element', url: 'http://localhost:3000/', comment: 'Translate this.', rect: { x: 8, y: 16, width: 100, height: 40 },
      },
    });
    await wrapper.vm.$nextTick();

    await wrapper.get('[aria-label="Exit annotation mode"]').trigger('click');

    expect(wrapper.find('[aria-label="Send 1 annotations"]').exists()).toBe(false);
    expect(api.browserSetAnnotationMode).toHaveBeenLastCalledWith('agent-1', 'primary', false);
    expect(api.browserClearAnnotations).toHaveBeenCalledTimes(1);
  });

  it('ignores annotations created in another agent browser', async () => {
    const { emitEvent, wrapper } = mountPanel();
    await flushPromises();
    emitEvent({
      seq: 1,
      type: 'browser.annotationCreated',
      occurredAt: '2026-07-29T00:00:00.000Z',
      payload: {
        id: 'annotation-other', agentId: 'agent-2', browserId: 'secondary', kind: 'element', url: 'https://example.com/', comment: 'Ignore this.', rect: { x: 8, y: 16, width: 100, height: 40 },
      },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[aria-label^="Send "]').exists()).toBe(false);
  });

  it('keeps closing the browser in tab chrome, not its overflow menu', async () => {
    const { api, wrapper } = mountPanel();
    await flushPromises();

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    expect(wrapper.findAll('[role="menuitem"]').some(item => item.text().includes('Close browser'))).toBe(false);
    const screenshotItem = wrapper.findAll('[role="menuitem"]').find(item => item.text() === 'Screenshot')!;
    expect(screenshotItem.element.previousElementSibling?.getAttribute('role')).toBe('separator');
    wrapper.unmount();

    expect(api.browserClose).toHaveBeenCalledWith('agent-1', 'primary');
  });

  it('dismisses the browser menu when interacting outside it, including the guest page', async () => {
    const { wrapper } = mountPanel({}, { attachTo: document.body });
    await flushPromises();
    const trigger = wrapper.get('[aria-label="Browser menu"]');

    await trigger.trigger('click');
    await wrapper.get('[aria-label="Zoom in"]').trigger('pointerdown');
    expect(wrapper.find('.browser-panel__menu').exists()).toBe(true);

    await wrapper.get('[aria-label="Browser address"]').trigger('pointerdown');
    expect(wrapper.find('.browser-panel__menu').exists()).toBe(false);

    await trigger.trigger('click');
    await wrapper.get('.browser-panel__viewport').trigger('pointerdown');
    expect(wrapper.find('.browser-panel__menu').exists()).toBe(false);

    await trigger.trigger('click');
    wrapper.get('webview').element.dispatchEvent(new Event('focus'));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.browser-panel__menu').exists()).toBe(false);

    await trigger.trigger('click');
    await trigger.trigger('pointerdown');
    expect(wrapper.find('.browser-panel__menu').exists()).toBe(true);
    await trigger.trigger('click');
    expect(wrapper.find('.browser-panel__menu').exists()).toBe(false);
  });

  it('changes page zoom through the browser guest and resets it from the menu', async () => {
    const { api, wrapper } = mountPanel();
    await flushPromises();

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    expect(wrapper.get('[role="group"][aria-label="Zoom"]').element.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(wrapper.get('[aria-label="Reset zoom"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[aria-label="Zoom in"]').trigger('click');
    await flushPromises();
    expect(api.browserSetZoom).toHaveBeenCalledWith('agent-1', 'primary', 110);
    expect(wrapper.get('.browser-panel__zoom-actions').text()).toContain('110%');
    await wrapper.get('[aria-label="Reset zoom"]').trigger('click');
    await flushPromises();
    expect(api.browserSetZoom).toHaveBeenLastCalledWith('agent-1', 'primary', 100);
    expect(wrapper.get('.browser-panel__zoom-actions').text()).toContain('100%');
  });

  it('shows the guest zoom after opening, navigation, and an external origin zoom change', async () => {
    const { api, emitDomReady, wrapper } = mountPanel({}, { deferDomReady: true });
    api.browserGetZoom.mockResolvedValue(125);
    emitDomReady();
    await flushPromises();

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.browser-panel__zoom-actions').text()).toContain('125%');
    expect(wrapper.get('[aria-label="Reset zoom"]').attributes('disabled')).toBeUndefined();

    api.browserGetZoom.mockResolvedValue(100);
    wrapper.get('webview').element.dispatchEvent(Object.assign(new Event('did-navigate'), {
      url: 'https://another.example/', isMainFrame: true,
    }));
    await flushPromises();
    expect(wrapper.get('.browser-panel__zoom-actions').text()).toContain('100%');
    expect(wrapper.get('[aria-label="Reset zoom"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    api.browserGetZoom.mockResolvedValue(120);
    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.browser-panel__zoom-actions').text()).toContain('120%');
    await wrapper.get('[aria-label="Zoom in"]').trigger('click');
    expect(api.browserSetZoom).toHaveBeenLastCalledWith('agent-1', 'primary', 125);
  });

  it('resizes the actual webview for device presets and custom dimensions', async () => {
    const { wrapper } = mountPanel();
    await flushPromises();

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    const toggle = wrapper.get('[role="menuitem"]');
    expect(toggle.text()).toBe('Show device toolbar');
    await toggle.trigger('click');
    await flushPromises();
    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    expect(wrapper.get('[role="menuitem"]').text()).toBe('Hide device toolbar');
    expect(wrapper.find('[role="menuitemcheckbox"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    const mode = wrapper.get<HTMLSelectElement>('[aria-label="Device mode"]');
    await mode.setValue('phone');
    expect(wrapper.get('.browser-panel__guest-frame').attributes('style')).toContain('width: 390px');
    expect(wrapper.get('.browser-panel__guest-frame').attributes('style')).toContain('height: 844px');
    expect(wrapper.find('.browser-panel__guest-frame webview').exists()).toBe(true);

    await wrapper.get<HTMLInputElement>('[aria-label="Viewport width"]').setValue('520');
    expect(mode.element.value).toBe('custom');
    expect(wrapper.get('.browser-panel__guest-frame').attributes('style')).toContain('width: 520px');
    const rotateButton = wrapper.get('[aria-label="Rotate viewport"]');
    expect(rotateButton.find('svg.tabler-icon-rotate-rectangle').exists()).toBe(true);
    await rotateButton.trigger('click');
    expect(wrapper.get('.browser-panel__guest-frame').attributes('style')).toContain('width: 844px');
    await wrapper.get('[aria-label="Hide device toolbar"]').trigger('click');
    expect(wrapper.find('.browser-panel__device-toolbar').exists()).toBe(false);
    expect(wrapper.find('.browser-panel__guest-frame webview').exists()).toBe(true);
    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    expect(wrapper.get('[role="menuitem"]').text()).toBe('Show device toolbar');
  });

  it('restores a fluid viewport when Responsive is selected and tracks pane resizing', async () => {
    const { wrapper } = mountPanel();
    await flushPromises();
    const viewport = wrapper.get<HTMLElement>('.browser-panel__viewport').element;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 720 },
      clientHeight: { configurable: true, value: 540 },
    });

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    await wrapper.get('[role="menuitem"]').trigger('click');
    const mode = wrapper.get<HTMLSelectElement>('[aria-label="Device mode"]');
    await mode.setValue('phone');
    expect(wrapper.get('.browser-panel__guest-frame').attributes('style')).toContain('width: 390px');

    await mode.setValue('responsive');
    await flushPromises();
    expect(wrapper.get('.browser-panel__guest-frame').attributes('style') ?? '').not.toContain('390px');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Viewport width"]').element.value).toBe('720');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Viewport height"]').element.value).toBe('540');

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 600 });
    ResizeObserverStub.latest!.notify();
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[aria-label="Viewport width"]').element.value).toBe('600');
  });

  it('keeps annotation bounds clipped to the visible device viewport while scrolling', async () => {
    const { api, wrapper } = mountPanel();
    await flushPromises();
    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    await wrapper.get('[role="menuitem"]').trigger('click');
    await wrapper.get<HTMLSelectElement>('[aria-label="Device mode"]').setValue('phone');

    const viewport = wrapper.get<HTMLElement>('.browser-panel__viewport').element;
    const guest = wrapper.get<HTMLElement>('webview').element;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 50, top: 100, right: 650, bottom: 600, width: 600, height: 500 } as DOMRect);
    vi.spyOn(guest, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 20, right: 490, bottom: 864, width: 390, height: 844 } as DOMRect);
    api.browserSetBounds.mockClear();

    viewport.dispatchEvent(new Event('scroll'));
    await flushPromises();
    expect(api.browserSetBounds).toHaveBeenLastCalledWith('agent-1', 'primary', {
      x: 100, y: 100, width: 390, height: 500, contentOffset: { x: 0, y: 80 },
    });
  });

  it('copies the visible page and a dragged screenshot area, while Escape cancels selection', async () => {
    const { api, wrapper } = mountPanel();
    await flushPromises();
    const notifySuccess = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never);
    api.browserCopyScreenshot.mockImplementation(async (_agentId, _browserId, rect) => {
      try {
        serialize(rect);
      } catch (reason) {
        throw new Error(String(reason));
      }
    });

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    await wrapper.findAll('[role="menuitem"]').find(item => item.text() === 'Screenshot')!.trigger('click');
    await flushPromises();
    expect(api.browserCopyScreenshot).toHaveBeenCalledWith('agent-1', 'primary', undefined);

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    await wrapper.findAll('[role="menuitem"]').find(item => item.text() === 'Screenshot area')!.trigger('click');
    const overlay = wrapper.get<HTMLElement>('[aria-label="Select screenshot area"]');
    vi.spyOn(overlay.element, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 400, height: 300 } as DOMRect);
    overlay.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 60 }));
    overlay.element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 120 }));
    overlay.element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 150, clientY: 120 }));
    await flushPromises();
    expect(api.browserCopyScreenshot).toHaveBeenLastCalledWith('agent-1', 'primary', { x: 40, y: 40, width: 100, height: 60 });
    expect(notifySuccess).toHaveBeenCalledTimes(2);
    expect(notifySuccess).toHaveBeenLastCalledWith('Screenshot copied to clipboard');
    expect(wrapper.find('[role="alert"]').exists() ? wrapper.get('[role="alert"]').text() : '').toBe('');
    expect(wrapper.find('[aria-label="Select screenshot area"]').exists()).toBe(false);

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    await wrapper.findAll('[role="menuitem"]').find(item => item.text() === 'Screenshot area')!.trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('[aria-label="Select screenshot area"]').exists()).toBe(false);
    expect(api.browserCopyScreenshot).toHaveBeenCalledTimes(2);
    notifySuccess.mockRestore();
  });

  it('keeps the native view visible while its own menu is open', async () => {
    const { api, wrapper } = mountPanel();
    await flushPromises();
    api.browserSetVisible.mockClear();

    await wrapper.get('[aria-label="Browser menu"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
    expect(api.browserSetVisible).not.toHaveBeenCalled();
  });

  it('runs navigation controls, visibility updates, errors, resize, and cleanup', async () => {
    const { api, emitEvent, wrapper } = mountPanel();
    await flushPromises();

    await wrapper.get('[aria-label="Go back"]').trigger('click');
    await flushPromises();
    await wrapper.get('[aria-label="Go forward"]').trigger('click');
    await flushPromises();
    api.browserReload.mockRejectedValueOnce('reload failed');
    await wrapper.get('[aria-label="Reload page"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Could not load this page.');

    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    window.dispatchEvent(new Event('resize'));
    emitEvent({ seq: 10, type: 'snapshot.updated', payload: createInitialSnapshot(), occurredAt: 'now' });
    emitEvent({
      seq: 11,
      type: 'browser.annotationCreated',
      payload: {
        id: 'annotation-resize',
        agentId: 'agent-2',
        browserId: 'primary',
        url: 'https://example.com/',
        kind: 'element',
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
      occurredAt: 'now',
    });
    await flushPromises();

    expect(api.browserGoBack).toHaveBeenCalledWith('agent-1', 'primary');
    expect(api.browserGoForward).toHaveBeenCalledWith('agent-1', 'primary');
    expect(api.browserSetVisible).toHaveBeenNthCalledWith(1, 'agent-1', 'primary', false);
    expect(api.browserSetVisible).toHaveBeenNthCalledWith(2, 'agent-1', 'primary', true);
    wrapper.unmount();
    expect(api.browserClose).toHaveBeenCalledWith('agent-1', 'primary');
  });
});
