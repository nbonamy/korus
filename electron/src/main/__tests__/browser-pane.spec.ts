import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import type { BrowserViewportRequest } from '@workspace/core/browser-viewport';

const electronMocks = vi.hoisted(() => {
  const guests = new Map<number, WebContentsMock>();
  const sessions = new Map<string, object>();
  const writeImage = vi.fn();
  class BrowserWindowMock {
    static instances: BrowserWindowMock[] = [];
    readonly close = vi.fn(() => {
      this.destroyed = true;
      this.listeners.get('closed')?.();
    });
    readonly focus = vi.fn();
    readonly hide = vi.fn();
    readonly loadFile = vi.fn(async (_file: string, _options?: { query: Record<string, string> }) => { this.listeners.get('ready-to-show')?.(); });
    readonly loadURL = vi.fn(async (_url: string) => { this.listeners.get('ready-to-show')?.(); });
    readonly options: Record<string, unknown>;
    readonly setBounds = vi.fn();
    readonly show = vi.fn();
    private destroyed = false;
    private readonly listeners = new Map<string, () => void>();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      BrowserWindowMock.instances.push(this);
    }

    isDestroyed = vi.fn(() => this.destroyed);
    once = vi.fn((event: string, listener: () => void) => { this.listeners.set(event, listener); });
  }

  class WebContentsMock {
    readonly id: number;
    hostWebContents: object | null = null;
    session: object | null = null;
    close = vi.fn(() => { this.destroyed = true; });
    executeJavaScript = vi.fn().mockResolvedValue(undefined);
    focus = vi.fn();
    isFocused = () => this.focus.mock.calls.length > 0;
    private debuggerAttached = false;
    debugger = {
      isAttached: vi.fn(() => this.debuggerAttached),
      attach: vi.fn(() => { this.debuggerAttached = true; }),
      detach: vi.fn(() => { this.debuggerAttached = false; }),
      sendCommand: vi.fn(async (_method: string, _params: unknown) => ({})),
    };
    getTitle = vi.fn(() => this.url ? `Title for ${this.url}` : '');
    getType = vi.fn(() => 'webview');
    getURL = vi.fn(() => this.url);
    isDestroyed = vi.fn(() => this.destroyed);
    loadURL = vi.fn(async (url: string) => { this.url = url; });
    on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      this.listeners.set(event, listener);
    });
    setWindowOpenHandler = vi.fn();
    reload = vi.fn();
    navigationHistory = { clear: vi.fn(), canGoBack: vi.fn(() => false), canGoForward: vi.fn(() => false), goBack: vi.fn(), goForward: vi.fn() };
    stop = vi.fn();
    isLoading = vi.fn(() => false);
    once = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      this.listeners.set(event, listener);
    });
    removeListener = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (this.listeners.get(event) === listener) this.listeners.delete(event);
      return this;
    });
    emit(event: string, ...args: unknown[]) { this.listeners.get(event)?.(...args); }
    getZoomFactor = vi.fn(() => 1);
    setZoomFactor = vi.fn();
    capturePage = vi.fn(async (_rect?: { x: number; y: number; width: number; height: number }) => ({ isEmpty: (): boolean => false }));
    private destroyed = false;
    private readonly listeners = new Map<string, (...args: unknown[]) => void>();
    private url = '';

    constructor(id: number) { this.id = id; }

    emitNavigation(event: 'will-navigate' | 'will-redirect', url: string, isMainFrame = true) {
      const navigationEvent = { preventDefault: vi.fn() };
      this.listeners.get(event)?.(navigationEvent, url, false, isMainFrame);
      return navigationEvent;
    }
  }

  function createGuest(owner: { webContents: object }, id: number, partition = 'persist:workspace-browser') {
    const guest = new WebContentsMock(id);
    guest.hostWebContents = owner.webContents;
    guest.session = fromPartition(partition);
    guests.set(id, guest);
    return guest;
  }

  function fromPartition(partition: string) {
    let value = sessions.get(partition);
    if (!value) { value = { clearData: vi.fn(async () => {}), clearAuthCache: vi.fn(async () => {}), clearCodeCaches: vi.fn(async () => {}), flushStorageData: vi.fn() }; sessions.set(partition, value); }
    return value;
  }

  return { BrowserWindowMock, createGuest, fromPartition, guests, sessions, writeImage };
});

vi.mock('electron', () => ({
  BrowserWindow: electronMocks.BrowserWindowMock,
  clipboard: { writeImage: electronMocks.writeImage },
  session: { fromPartition: electronMocks.fromPartition },
  webContents: { fromId: (id: number) => electronMocks.guests.get(id) },
}));

import { BrowserPane, browserPaneKey, normalizeBrowserUrl, readVisualizationDocument, safePartitionName } from '../browser-pane';

beforeEach(() => {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5174');
  electronMocks.BrowserWindowMock.instances.length = 0;
  electronMocks.guests.clear();
  electronMocks.sessions.clear();
  electronMocks.writeImage.mockReset();
});

describe('browser pane helpers', () => {
  it('allows loaded extension resource redirects in browser subframes while retaining navigation boundaries', async () => {
    // Dynamic extension URLs redirect to the real extension origin. Blocking
    // that subframe redirect prevents inline autofill; allowing it at the top
    // level, for an unloaded extension, or in a visualization weakens policy.
    const owner = { webContents: {} };
    const guest = electronMocks.createGuest(owner, 61);
    const id = 'nngceckbapebfimnlniiiahkandclblb';
    Object.assign(guest.session!, {
      extensions: { getExtension: (value: string) => value === id ? { id } : undefined },
    });
    const pane = new BrowserPane({ onAnnotation: vi.fn() });
    await pane.open(owner as never, 'agent-one', 'primary', 'https://example.com', '', 61);
    const resource = `chrome-extension://${id}/overlay/menu.html`;
    expect(guest.emitNavigation('will-redirect', resource, false).preventDefault).not.toHaveBeenCalled();
    expect(guest.emitNavigation('will-redirect', resource).preventDefault).toHaveBeenCalledOnce();
    expect(guest.emitNavigation('will-navigate', resource).preventDefault).toHaveBeenCalledOnce();
    expect(guest.emitNavigation('will-redirect', 'chrome-extension://unloaded/menu.html', false).preventDefault).toHaveBeenCalledOnce();
    expect(guest.emitNavigation('will-redirect', 'file:///outside.html', false).preventDefault).toHaveBeenCalledOnce();
    expect(guest.emitNavigation('will-redirect', 'https://example.com/next').preventDefault).not.toHaveBeenCalled();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-extension-redirect-'));
    try {
      const document = path.join(directory, 'visualization.html');
      await writeFile(document, '<!doctype html><p>Owned visualization</p>');
      const visualization = electronMocks.createGuest(owner, 62, 'agent-workspace-visualization-agent-one');
      Object.assign(visualization.session!, { extensions: { getExtension: () => ({ id }) } });
      await pane.openVisualization(owner as never, 'agent-one', 'visualization', document, 'Owned', 62);
      expect(visualization.emitNavigation('will-redirect', resource, false).preventDefault).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('waits for the matching viewport layout acknowledgement and returns guest measurements', async () => {
    const owner = { webContents: {} };
    const guest = electronMocks.createGuest(owner, 60);
    const onViewportRequest = vi.fn<(request: BrowserViewportRequest) => void>();
    const pane = new BrowserPane({ onAnnotation: vi.fn(), onViewportRequest });
    await pane.open(owner as never, 'agent-one', 'primary', '', '', 60);
    guest.executeJavaScript.mockImplementation(async script => runInNewContext(script, { window: { innerWidth: 390, innerHeight: 844, devicePixelRatio: 2 } }));
    const settled = vi.fn();
    const result = pane.execute('agent-one', 'primary', 'viewport', { preset: 'phone' }).then(settled);
    const request = onViewportRequest.mock.calls[0]![0];
    expect(request).toEqual({ agentId: 'agent-one', browserId: 'primary', requestId: expect.any(String), viewport: { preset: 'phone', width: 390, height: 844 } });
    await pane.viewportApplied('agent-two', 'primary', request.requestId);
    await pane.viewportApplied('agent-one', 'primary', 'stale');
    expect(settled).not.toHaveBeenCalled();
    await pane.viewportApplied('agent-one', 'primary', request.requestId);
    await result;
    expect(settled).toHaveBeenCalledWith({ preset: 'phone', width: 390, height: 844, devicePixelRatio: 2 });
    await pane.closeAll();
  });

  it('bounds viewport input and rejects superseded, closed and timed-out requests', async () => {
    const owner = { webContents: {} };
    electronMocks.createGuest(owner, 60);
    const onViewportRequest = vi.fn<(request: BrowserViewportRequest) => void>();
    const pane = new BrowserPane({ onAnnotation: vi.fn(), onViewportRequest });
    await pane.open(owner as never, 'agent-one', 'primary', '', '', 60);
    for (const input of [{}, { width: 900 }, { width: 239, height: 400 }, { width: 500, height: 2001 }, { preset: 'phone', width: 400 }, { preset: 'invalid' }]) {
      await expect(pane.execute('agent-one', 'primary', 'viewport', input)).rejects.toThrow();
    }
    expect(onViewportRequest).not.toHaveBeenCalled();
    const first = expect(pane.execute('agent-one', 'primary', 'viewport', { width: 800, height: 600 })).rejects.toThrow('superseded');
    const second = expect(pane.execute('agent-one', 'primary', 'viewport', { preset: 'responsive' })).rejects.toThrow('closed');
    await first;
    await pane.closeAll();
    await second;
    electronMocks.createGuest(owner, 61);
    await pane.open(owner as never, 'agent-one', 'primary', '', '', 61);
    vi.useFakeTimers();
    try {
      const timeout = expect(pane.execute('agent-one', 'primary', 'viewport', { preset: 'fit' })).rejects.toThrow('Timed out');
      await vi.advanceTimersByTimeAsync(10_000);
      await timeout;
    } finally { vi.useRealTimers(); await pane.closeAll(); }
  });
  it('waits for a replacement page when a client redirect aborts loadURL', async () => {
    const owner = { webContents: {} };
    const guest = electronMocks.createGuest(owner, 60);
    const pane = new BrowserPane({ onAnnotation: vi.fn() });
    await pane.open(owner as never, 'agent-one', 'primary', '', '', 60);
    guest.isLoading.mockReturnValue(true);
    guest.loadURL.mockRejectedValueOnce(Object.assign(new Error('ERR_ABORTED (-3)'), { code: 'ERR_ABORTED', errno: -3 }));
    let settled = false;
    const navigation = pane.navigate('agent-one', 'primary', 'https://www.google.com/search?q=dark%20mode')
      .then(state => { settled = true; return state; });
    const assertion = expect(navigation).resolves.toMatchObject({ url: 'https://www.google.com/search?q=dark%20mode&sei=redirect' });
    await Promise.resolve();
    guest.emit('did-fail-load', {}, -3, '', 'https://www.google.com/search?q=dark%20mode', true);
    expect(settled).toBe(false);
    guest.getURL.mockReturnValue('https://www.google.com/search?q=dark%20mode&sei=redirect');
    guest.isLoading.mockReturnValue(false);
    guest.emit('did-finish-load');
    await assertion;
  });

  it('keeps genuine navigation failures visible, including after an aborted redirect', async () => {
    const owner = { webContents: {} };
    const guest = electronMocks.createGuest(owner, 61);
    const pane = new BrowserPane({ onAnnotation: vi.fn() });
    await pane.open(owner as never, 'agent-one', 'primary', '', '', 61);
    const failure = Object.assign(new Error('ERR_NAME_NOT_RESOLVED'), { code: 'ERR_NAME_NOT_RESOLVED', errno: -105 });
    guest.loadURL.mockRejectedValueOnce(failure);
    await expect(pane.navigate('agent-one', 'primary', 'https://example.com')).rejects.toBe(failure);
    const abort = Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED', errno: -3 });
    guest.loadURL.mockRejectedValueOnce(abort);
    await expect(pane.navigate('agent-one', 'primary', 'https://example.com')).rejects.toBe(abort);
    guest.isLoading.mockReturnValue(true);
    guest.loadURL.mockRejectedValueOnce(abort);
    const navigation = pane.navigate('agent-one', 'primary', 'https://example.com');
    const assertion = expect(navigation).rejects.toThrow('ERR_NAME_NOT_RESOLVED');
    await Promise.resolve();
    guest.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://example.com/redirect', true);
    await assertion;
  });

  it('normalizes a bare host into an https URL', () => {
    expect(normalizeBrowserUrl('example.com/docs')).toBe('https://example.com/docs');
    expect(normalizeBrowserUrl('http://localhost:3000')).toBe('http://localhost:3000/');
  });

  it('rejects unsafe protocols and empty addresses', () => {
    expect(() => normalizeBrowserUrl('')).toThrow('Enter a URL');
    expect(() => normalizeBrowserUrl('javascript:alert(1)')).toThrow('Only http, https, and workspace file URLs');
    for (const url of ['about:config', 'about:blank?x=1', 'data:text/html,hello']) {
      expect(() => normalizeBrowserUrl(url)).toThrow('Only http, https, and workspace file URLs');
    }
    expect(() => normalizeBrowserUrl('file:///Users/nicolas/.ssh/id_rsa')).toThrow('require an agent workspace');
  });

  it('opens and returns to about:blank without blocking blank-page navigation', async () => {
    const owner = { webContents: {} };
    const guest = electronMocks.createGuest(owner, 62);
    const pane = new BrowserPane({ onAnnotation: vi.fn() });
    try {
      await expect(pane.open(owner as never, 'agent-one', 'primary', 'about:blank', '', 62)).resolves.toMatchObject({ url: 'about:blank' });
      await pane.navigate('agent-one', 'primary', 'https://example.com');
      await expect(pane.navigate('agent-one', 'primary', ' about:blank ')).resolves.toMatchObject({ url: 'about:blank' });
      expect(guest.loadURL).toHaveBeenLastCalledWith('about:blank');
      expect(guest.emitNavigation('will-navigate', 'about:blank').preventDefault).not.toHaveBeenCalled();
      expect(guest.emitNavigation('will-navigate', 'about:config').preventDefault).toHaveBeenCalledOnce();
    } finally { await pane.closeAll(); }
  });

  it('keeps navigation policy installed and retries the extension attach on the same handlers when the profile fails', async () => {
    const owner = { webContents: {} };
    const guest = electronMocks.createGuest(owner, 63);
    const onGuestReady = vi.fn().mockRejectedValueOnce(new Error('profile unavailable')).mockResolvedValue(undefined);
    const pane = new BrowserPane({ onAnnotation: vi.fn(), onGuestReady });
    try {
      await expect(pane.open(owner as never, 'agent-one', 'primary', 'about:blank', '', 63)).rejects.toThrow('profile unavailable');
      expect(guest.setWindowOpenHandler).toHaveBeenCalled();
      expect(guest.emitNavigation('will-navigate', 'about:config').preventDefault).toHaveBeenCalledOnce();
      const handlers = guest.on.mock.calls.length;
      await expect(pane.open(owner as never, 'agent-one', 'primary', 'about:blank', '', 63)).resolves.toMatchObject({ url: 'about:blank' });
      expect(onGuestReady).toHaveBeenCalledTimes(2);
      expect(guest.on.mock.calls).toHaveLength(handlers);
      await pane.open(owner as never, 'agent-one', 'primary', 'about:blank', '', 63);
      expect(onGuestReady).toHaveBeenCalledTimes(2);
    } finally { await pane.closeAll(); }
  });

  it('opens existing workspace files while rejecting escapes and symlinks outside the workspace', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-browser-workspace-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-browser-outside-'));
    const localFile = path.join(workspace, 'preview.html');
    const outsideFile = path.join(outside, 'secret.html');
    const linkedFile = path.join(workspace, 'linked-secret.html');
    await writeFile(localFile, '<h1>Local preview</h1>');
    await writeFile(outsideFile, '<h1>Secret</h1>');
    await symlink(outsideFile, linkedFile);

    try {
      const browserWindow = {
        webContents: {},
        isDestroyed: vi.fn(() => false),
      };
      const guest = electronMocks.createGuest(browserWindow, 11);
      const pane = new BrowserPane({ onAnnotation: vi.fn() });
      const localUrl = pathToFileURL(localFile).toString();

      await expect(pane.open(browserWindow as never, 'agent-one', 'primary', localUrl, workspace, 11)).resolves.toMatchObject({
        url: localUrl,
        title: `Title for ${localUrl}`,
      });
      expect(guest.loadURL).toHaveBeenCalledWith(localUrl);
      expect(() => normalizeBrowserUrl(pathToFileURL(outsideFile).toString(), workspace)).toThrow('stay inside the agent workspace');
      expect(() => normalizeBrowserUrl(pathToFileURL(linkedFile).toString(), workspace)).toThrow('stay inside the agent workspace');

      const navigation = guest.emitNavigation('will-navigate', pathToFileURL(outsideFile).toString());
      expect(navigation?.preventDefault).toHaveBeenCalledOnce();
    } finally {
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });

  it('opens a bounded external visualization as a sandboxed data document without weakening file navigation', async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-visualization-'));
    const visualizationPath = path.join(scratch, 'chart.html');
    const outsideFile = path.join(scratch, 'secret.txt');
    await writeFile(visualizationPath, '<section id="chart">Chart</section><script>document.body.dataset.ready = "yes"</script>');
    await writeFile(outsideFile, 'secret');

    try {
      const browserWindow = {
        webContents: {},
        isDestroyed: vi.fn(() => false),
      };
      const guest = electronMocks.createGuest(browserWindow, 12, 'agent-workspace-visualization-agent-one');
      const pane = new BrowserPane({ onAnnotation: vi.fn() });

      await expect(pane.openVisualization(
        browserWindow as never,
        'agent-one',
        'primary',
        visualizationPath,
        'Interactive chart',
        12,
      )).resolves.toStrictEqual({
        url: '',
        title: 'Interactive chart',
        canGoBack: false,
        canGoForward: false,
      });

      const loadedUrl = guest.loadURL.mock.calls[0]?.[0] as string;
      expect(loadedUrl).toMatch(/^data:text\/html;base64,/u);
      const document = Buffer.from(loadedUrl.slice(loadedUrl.indexOf(',') + 1), 'base64').toString('utf8');
      expect(document).toContain('Content-Security-Policy');
      expect(document).toContain("connect-src 'none'");
      expect(document).toContain('<section id="chart">Chart</section>');
      expect(guest.emitNavigation('will-navigate', pathToFileURL(outsideFile).toString()).preventDefault).toHaveBeenCalledOnce();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('rejects non-HTML, symlinked, and oversized visualization files', async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-visualization-invalid-'));
    const textPath = path.join(scratch, 'notes.txt');
    const htmlPath = path.join(scratch, 'large.html');
    const linkedPath = path.join(scratch, 'linked.html');
    await writeFile(textPath, 'not html');
    await writeFile(htmlPath, 'x'.repeat(1_048_577));
    await symlink(htmlPath, linkedPath);

    try {
      await expect(readVisualizationDocument(textPath, 'Notes')).rejects.toThrow('must be HTML');
      await expect(readVisualizationDocument(linkedPath, 'Linked')).rejects.toThrow('unavailable');
      await expect(readVisualizationDocument(htmlPath, 'Large')).rejects.toThrow('1 MB');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('shares one persistent profile across agents and clears website data without extension storage', async () => {
    // Regressions: per-agent cookies, clearing app/extension storage, surviving
    // sessionStorage/history, or a failed clear reported as success.
    const owner = { webContents: {} };
    const first = electronMocks.createGuest(owner, 70);
    const second = electronMocks.createGuest(owner, 71);
    const visualization = electronMocks.createGuest(owner, 72, 'agent-workspace-visualization-agent-one');
    const pane = new BrowserPane({ onAnnotation: vi.fn() });
    await pane.open(owner as never, 'agent-one', 'primary', 'https://one.example', '', 70);
    await pane.open(owner as never, 'agent-two', 'primary', 'https://two.example', '', 71);
    expect(first.session).toBe(second.session);
    const shared = first.session as any;
    await pane.clearBrowsingData();
    expect(first.getURL()).toBe('about:blank');
    expect(second.getURL()).toBe('about:blank');
    expect(first.navigationHistory.clear).toHaveBeenCalledOnce();
    expect(second.navigationHistory.clear).toHaveBeenCalledOnce();
    expect(shared.clearData).toHaveBeenCalledExactlyOnceWith({ excludeOrigins: [
      'chrome-extension://nngceckbapebfimnlniiiahkandclblb',
      'chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa',
    ] });
    expect(shared.clearAuthCache).toHaveBeenCalledOnce();
    expect((visualization.session as any).clearData).not.toHaveBeenCalled();
    shared.clearData.mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(pane.clearBrowsingData()).rejects.toThrow('Disk unavailable');
  });

  it('uses a safe, stable profile partition name for each agent', () => {
    expect(safePartitionName('agent:/one')).toBe('agent--one');
    expect(safePartitionName('')).toBe('default');
  });

  it('keeps independently attached browser guests for each browser id', async () => {
    const browserWindow = {
      webContents: {},
      isDestroyed: vi.fn(() => false),
    };
    const primary = electronMocks.createGuest(browserWindow, 21);
    const secondary = electronMocks.createGuest(browserWindow, 22);
    const pane = new BrowserPane({ onAnnotation: vi.fn() });

    await pane.open(browserWindow as never, 'agent-one', 'primary', 'https://one.example', '/tmp/project', 21);
    await pane.open(browserWindow as never, 'agent-one', 'secondary', 'https://two.example', '/tmp/project', 22);

    expect(primary.close).not.toHaveBeenCalled();
    pane.setVisible('agent-one', 'primary', true);
    pane.setVisible('agent-one', 'secondary', false);

    await pane.close('agent-one', 'primary');

    expect(primary.close).toHaveBeenCalledOnce();
    expect(secondary.close).not.toHaveBeenCalled();
    await expect(pane.execute('agent-one', 'secondary', 'console', {})).resolves.toStrictEqual({ messages: [] });
  });

  it('zooms the owning guest and copies its selected viewport area to the clipboard', async () => {
    const browserWindow = { webContents: {}, isDestroyed: vi.fn(() => false) };
    const guest = electronMocks.createGuest(browserWindow, 25);
    const pane = new BrowserPane({ onAnnotation: vi.fn() });
    await pane.open(browserWindow as never, 'agent-one', 'primary', 'https://example.com', '/tmp/project', 25);
    guest.getZoomFactor.mockReturnValue(1.25);
    expect(pane.getZoom('agent-one', 'primary')).toBe(125);
    expect(() => pane.getZoom('agent-two', 'primary')).toThrow('Browser is not open');
    expect(pane.setZoom('agent-one', 'primary', 125)).toBe(125);
    expect(guest.setZoomFactor).toHaveBeenCalledWith(1.25);
    expect(() => pane.setZoom('agent-one', 'primary', 0)).toThrow('between 50% and 300%');
    expect(() => pane.setZoom('agent-two', 'primary', 125)).toThrow('Browser is not open');

    const image = { isEmpty: vi.fn(() => false) };
    guest.capturePage.mockResolvedValue(image);
    const rect = { x: 12, y: 24, width: 180, height: 90 };
    await pane.copyScreenshot('agent-one', 'primary', rect);
    expect(guest.capturePage).toHaveBeenCalledWith(rect);
    expect(electronMocks.writeImage).toHaveBeenCalledWith(image);

    await pane.copyScreenshot('agent-one', 'primary');
    expect(guest.capturePage).toHaveBeenLastCalledWith(undefined);
    expect(electronMocks.writeImage).toHaveBeenCalledTimes(2);

    await expect(pane.copyScreenshot('agent-two', 'primary')).rejects.toThrow('Browser is not open');
    await expect(pane.copyScreenshot('agent-one', 'primary', { x: -1, y: 0, width: 1, height: 1 })).rejects.toThrow('Invalid browser screenshot area');
    image.isEmpty.mockReturnValue(true);
    await expect(pane.copyScreenshot('agent-one', 'primary')).rejects.toThrow('The browser screenshot is empty');
    expect(electronMocks.writeImage).toHaveBeenCalledTimes(2);
  });

  it('rejects guests owned by another window or an unapproved session', async () => {
    const browserWindow = {
      webContents: {},
      isDestroyed: vi.fn(() => false),
    };
    const pane = new BrowserPane({ onAnnotation: vi.fn() });
    electronMocks.createGuest({ webContents: {} }, 23);
    electronMocks.createGuest(browserWindow, 24, 'persist:agent-workspace-browser-agent-two');

    await expect(pane.open(browserWindow as never, 'agent-one', 'primary', 'https://example.com', '/tmp/project', 23)).rejects.toThrow('not attached');
    await expect(pane.open(browserWindow as never, 'agent-one', 'primary', 'https://example.com', '/tmp/project', 24)).rejects.toThrow('not attached');
  });

  it('waits for guest navigation and keeps a bounded chronological console history', async () => {
    const window = { webContents: {} };
    const guest = electronMocks.createGuest(window, 40);
    const pane = new BrowserPane({ onAnnotation: vi.fn() });
    await pane.open(window as never, 'agent-one', 'primary', 'https://example.com', '', 40);
    guest.navigationHistory.canGoBack.mockReturnValue(true);
    guest.isLoading.mockReturnValue(true);
    let settled = false;
    const back = pane.goBack('agent-one', 'primary').then(state => { settled = true; return state; });
    await Promise.resolve();
    expect(settled).toBe(false);
    guest.emit('did-finish-load');
    expect(await back).toMatchObject({ url: 'https://example.com/', canGoBack: true });
    expect(guest.navigationHistory.goBack).toHaveBeenCalledOnce();
    guest.isLoading.mockReturnValue(false);
    await pane.goForward('agent-one', 'primary');
    expect(guest.navigationHistory.goForward).not.toHaveBeenCalled();
    guest.navigationHistory.canGoForward.mockReturnValue(true);
    await pane.goForward('agent-one', 'primary');
    expect(guest.navigationHistory.goForward).toHaveBeenCalledOnce();
    await pane.reload('agent-one', 'primary');
    expect(guest.reload).toHaveBeenCalledOnce();
    for (let index = 0; index < 105; index++) guest.emit('console-message', {}, 2, 'message-' + index);
    const result = await pane.execute('agent-one', 'primary', 'console', { limit: 200 }) as { messages: { message: string }[] };
    expect(result.messages).toHaveLength(100);
    expect(result.messages[0]!.message).toBe('message-5');
    expect(result.messages.at(-1)!.message).toBe('message-104');
    await pane.closeAll();
    await expect(pane.reload('agent-one', 'primary')).rejects.toThrow('not open');
  });

  it('executes browser commands against the guest DOM with input events and error propagation', async () => {
    const focusWindow = vi.fn();
    const window = { webContents: {}, focus: focusWindow, isFocused: () => focusWindow.mock.calls.length > 0 };
    const guest = electronMocks.createGuest(window, 41);
    const pane = new BrowserPane({ onAnnotation: vi.fn() });
    await pane.open(window as never, 'agent-one', 'primary', '', '', 41);
    document.body.innerHTML = '<button id="save">Save</button><input id="name" value="old"><div id="label">Label</div>';
    const button = document.querySelector<HTMLButtonElement>('#save')!;
    const input = document.querySelector<HTMLInputElement>('#name')!;
    // Real clicks must reach the native guest, respect zoom and remain inside
    // its viewport; selector lookup alone must never synthesize the action.
    const click = vi.fn();
    const point = vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 10, left: 20, top: 10, right: 100, bottom: 50, width: 80, height: 40, toJSON() {} });
    button.scrollIntoView = vi.fn();
    const oldHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => button });
    const changed = vi.fn();
    button.addEventListener('click', click);
    input.addEventListener('input', changed);
    guest.executeJavaScript.mockImplementation(async (script: string) => globalThis.eval(script));
    try {
      expect(await pane.execute('agent-one', 'primary', 'dom', { selector: '#save' })).toMatchObject({
        selector: '#save', element: { tag: 'button', text: 'Save' },
      });
      await pane.execute('agent-one', 'primary', 'click', { selector: '#save' });
      expect(click).not.toHaveBeenCalled();
      expect(guest.focus).toHaveBeenCalled();
      expect(guest.debugger.sendCommand.mock.calls.map(([method, event]) => ({ method, event }))).toStrictEqual([
        { method: 'Input.dispatchMouseEvent', event: { type: 'mouseMoved', x: 60, y: 30 } },
        { method: 'Input.dispatchMouseEvent', event: { type: 'mousePressed', x: 60, y: 30, button: 'left', clickCount: 1 } },
        { method: 'Input.dispatchMouseEvent', event: { type: 'mouseReleased', x: 60, y: 30, button: 'left', clickCount: 1 } },
      ]);
      guest.getZoomFactor.mockReturnValue(1.25);
      await pane.execute('agent-one', 'primary', 'click', { x: 40, y: 20 });
      expect(guest.debugger.sendCommand).toHaveBeenLastCalledWith('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 40, y: 20, button: 'left', clickCount: 1 });
      expect(guest.focus).toHaveBeenCalledOnce();
      expect(focusWindow).toHaveBeenCalledOnce();
      const deliveries = guest.debugger.sendCommand.mock.calls.length;
      for (const invalid of [{}, { x: 10 }, { x: -1, y: 0 }, { x: 99999, y: 0 }, { selector: '#save', x: 1, y: 2 }])
        await expect(pane.execute('agent-one', 'primary', 'click', invalid)).rejects.toThrow();
      expect(guest.debugger.sendCommand).toHaveBeenCalledTimes(deliveries);
      expect(guest.debugger.detach).toHaveBeenCalledTimes(2);
      guest.debugger.sendCommand.mockRejectedValueOnce(new Error('Input unavailable'));
      await expect(pane.execute('agent-one', 'primary', 'click', { x: 30, y: 20 })).rejects.toThrow('Input unavailable');
      expect(guest.debugger.detach).toHaveBeenCalledTimes(3);
      guest.debugger.isAttached.mockReturnValue(true);
      await pane.execute('agent-one', 'primary', 'click', { x: 30, y: 20 });
      expect(guest.debugger.detach).toHaveBeenCalledTimes(3);
      await pane.execute('agent-one', 'primary', 'type', { selector: '#name', text: 'new' });
      await pane.execute('agent-one', 'primary', 'type', { selector: '#name', text: ' value', clear: false });
      expect(input.value).toBe('new value');
      expect(changed).toHaveBeenCalledTimes(2);
      await expect(pane.execute('agent-one', 'primary', 'type', { selector: '#label', text: 'oops' })).rejects.toThrow('not editable');
      await expect(pane.execute('agent-one', 'primary', 'click', { selector: '#missing' })).rejects.toThrow('No element');
      await expect(pane.execute('agent-one', 'primary', 'click', { selector: 'button, input' })).rejects.toThrow('one element');
      await expect(pane.execute('agent-one', 'primary', 'unknown', {})).rejects.toThrow('Unsupported');
    } finally {
      await pane.closeAll();
      point.mockRestore();
      if (oldHitTest) Object.defineProperty(document, 'elementFromPoint', oldHitTest); else Reflect.deleteProperty(document, 'elementFromPoint');
      document.body.innerHTML = '';
    }
  });

  it('repositions and dismisses a packaged annotation overlay when its guest is replaced', async () => {
    vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', '');
    vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');
    const window = { webContents: {}, getContentBounds: () => ({ x: 10, y: 20, width: 800, height: 600 }) };
    const guest = electronMocks.createGuest(window, 42);
    const onAnnotation = vi.fn();
    const pane = new BrowserPane({ onAnnotation });
    await pane.open(window as never, 'agent-one', 'primary', '', '', 42);
    guest.executeJavaScript.mockResolvedValueOnce({ kind: 'area', rect: { x: 1, y: 2, width: 30, height: 40 } });
    await pane.setAnnotationMode('agent-one', 'primary', true);
    await vi.waitFor(() => expect(electronMocks.BrowserWindowMock.instances).toHaveLength(1));
    const overlay = electronMocks.BrowserWindowMock.instances[0]!;
    expect(overlay.loadFile).toHaveBeenCalledWith(expect.stringContaining('/renderer/main_window/index.html'), expect.objectContaining({
      query: expect.objectContaining({ surface: 'annotation-overlay' }),
    }));
    pane.setBounds('agent-one', 'primary', { x: 30, y: 40, width: 500, height: 400 });
    expect(overlay.setBounds).toHaveBeenLastCalledWith({ x: 40, y: 60, width: 500, height: 400 });
    pane.setVisible('agent-one', 'primary', false);
    expect(overlay.hide).toHaveBeenCalledOnce();
    pane.setVisible('agent-one', 'primary', true);
    expect(overlay.show).toHaveBeenCalledTimes(2);
    electronMocks.createGuest(window, 43);
    await pane.open(window as never, 'agent-one', 'primary', '', '', 43);
    expect(overlay.close).toHaveBeenCalledOnce();
    expect(guest.close).toHaveBeenCalledOnce();
    expect(onAnnotation).not.toHaveBeenCalled();
    await pane.closeAll();
  });

  it('uses collision-safe keys for future multiple browser tabs', () => {
    expect(browserPaneKey('agent:a', 'browser')).not.toBe(browserPaneKey('agent', 'a:browser'));
  });

  it('hosts the annotation popup over the visible viewport with a translated anchor', async () => {
    const onAnnotation = vi.fn();
    const browserWindow = {
      webContents: {},
      getContentBounds: vi.fn(() => ({ x: 10, y: 20, width: 1200, height: 800 })),
      isDestroyed: vi.fn(() => false),
    };
    const guest = electronMocks.createGuest(browserWindow, 31);
    const pane = new BrowserPane({ onAnnotation });
    await pane.open(browserWindow as never, 'agent-one', 'primary', 'https://one.example', '/tmp/project', 31);
    pane.setBounds('agent-one', 'primary', { x: 100, y: 50, width: 600, height: 500, contentOffset: { x: 0, y: 80 } });
    guest.executeJavaScript.mockResolvedValueOnce({
      id: 'annotation-one',
      kind: 'element',
      selector: '#save',
      label: 'Save',
      rect: { x: 30, y: 120, width: 100, height: 30 },
    });

    await pane.setAnnotationMode('agent-one', 'primary', true);
    await vi.waitFor(() => expect(electronMocks.BrowserWindowMock.instances).toHaveLength(1));
    const overlay = electronMocks.BrowserWindowMock.instances[0];
    await vi.waitFor(() => expect((overlay?.loadFile.mock.calls.length ?? 0) + (overlay?.loadURL.mock.calls.length ?? 0)).toBe(1));
    expect(overlay?.options).toMatchObject({ x: 110, y: 70, width: 600, height: 500, transparent: true, frame: false });
    const query = new URL(overlay?.loadURL.mock.calls[0]?.[0] ?? 'http://localhost').searchParams;
    expect(JSON.parse(query.get('anchor') ?? '')).toStrictEqual({ x: 30, y: 40, width: 100, height: 30 });
    const token = query.get('token');
    expect(token).toBeTruthy();

    pane.resolveAnnotation(token!, 'Keep this compact.');
    await vi.waitFor(() => expect(onAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      id: 'annotation-one',
      agentId: 'agent-one',
      browserId: 'primary',
      comment: 'Keep this compact.',
    })));
  });

  it('restores browser capture after the annotation popup is cancelled', async () => {
    const onAnnotation = vi.fn();
    const browserWindow = {
      webContents: {},
      getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
      isDestroyed: vi.fn(() => false),
    };
    const guest = electronMocks.createGuest(browserWindow, 32);
    const pane = new BrowserPane({ onAnnotation });
    await pane.open(browserWindow as never, 'agent-one', 'primary', 'https://one.example', '/tmp/project', 32);
    pane.setBounds('agent-one', 'primary', { x: 0, y: 0, width: 800, height: 600 });
    guest.executeJavaScript.mockResolvedValueOnce({
      id: 'annotation-one',
      kind: 'element',
      selector: '#save',
      label: 'Save',
      rect: { x: 30, y: 40, width: 100, height: 30 },
    });

    await pane.setAnnotationMode('agent-one', 'primary', true);
    await vi.waitFor(() => expect(electronMocks.BrowserWindowMock.instances).toHaveLength(1));
    const overlay = electronMocks.BrowserWindowMock.instances[0];
    await vi.waitFor(() => expect((overlay?.loadFile.mock.calls.length ?? 0) + (overlay?.loadURL.mock.calls.length ?? 0)).toBe(1));
    const query = new URL(overlay?.loadURL.mock.calls[0]?.[0] ?? 'http://localhost').searchParams;

    pane.resolveAnnotation(query.get('token')!, null);

    await vi.waitFor(() => expect(guest.executeJavaScript).toHaveBeenCalledTimes(2));
    expect(guest.focus).toHaveBeenCalledTimes(2);
    expect(onAnnotation).not.toHaveBeenCalled();
  });
});
