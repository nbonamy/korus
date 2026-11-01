import { BrowserWindow, clipboard, session, webContents, type WebContents } from 'electron';
import { constants as fsConstants, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserAnnotation, BrowserBounds, BrowserState, BrowserViewportBounds } from '@workspace/core/contracts';
import { supportedBrowserExtensions } from '@workspace/core/browser-extensions';
import { browserGuestPartition } from '@workspace/core/browser-guest';
import { parseBrowserViewport, type BrowserViewportRequest } from '@workspace/core/browser-viewport';
export { safePartitionName } from '@workspace/core/browser-guest';

type BrowserPaneOptions = {
  onGuestReady?(agentId: string, browserId: string, contents: WebContents, window: BrowserWindow): Promise<void>;
  onGuestSelected?(agentId: string, browserId: string): void;
  onAnnotation(annotation: BrowserAnnotation): void;
  onViewportRequest?(request: BrowserViewportRequest): void;
};

type HostedBrowserPane = {
  agentId: string;
  annotationEnabled: boolean;
  annotationOverlay: BrowserWindow | null;
  annotationRequest: Promise<void> | null;
  annotationResolve: ((comment: string | null) => void) | null;
  annotationToken: string | null;
  bounds: BrowserBounds;
  browserId: string;
  browserWindow: BrowserWindow;
  consoleMessages: Array<{ level: string; message: string; timestamp: string }>;
  contentOffset: { x: number; y: number };
  extensionsAttached: boolean;
  fileRoot: string;
  navigationEnabled: boolean;
  presentedTitle: string | null;
  presentedUrl: string | null;
  webContents: WebContents;
  visible: boolean;
};

const maximumVisualizationBytes = 1_048_576;

/**
 * Owns navigation and annotation policy for a renderer-hosted webview. The
 * renderer only passes its guest ID; it never receives the guest WebContents.
 */
export class BrowserPane {
  private readonly panes = new Map<string, HostedBrowserPane>();
  private readonly clicks = new WeakMap<WebContents, Promise<unknown>>();
  private readonly viewportRequests = new Map<string, {
    request: BrowserViewportRequest;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly options: BrowserPaneOptions) {}

  async open(
    browserWindow: BrowserWindow,
    agentId: string,
    browserId: string,
    url: string,
    fileRoot: string,
    guestWebContentsId: number,
  ): Promise<BrowserState> {
    const pane = await this.createPane(browserWindow, agentId, browserId, fileRoot, true, guestWebContentsId);
    if (url.trim()) return this.navigate(agentId, browserId, url);
    await pane.webContents.loadURL('about:blank');
    return { ...this.state(pane), url: '', title: '' };
  }

  async openVisualization(
    browserWindow: BrowserWindow,
    agentId: string,
    browserId: string,
    filePath: string,
    title: string,
    guestWebContentsId: number,
  ): Promise<BrowserState> {
    const document = await readVisualizationDocument(filePath, title);
    const pane = await this.createPane(browserWindow, agentId, browserId, '', false, guestWebContentsId);
    pane.presentedTitle = title.trim() || 'Visualization';
    pane.presentedUrl = '';
    await pane.webContents.loadURL(document);
    return this.state(pane);
  }

  private async createPane(
    browserWindow: BrowserWindow,
    agentId: string,
    browserId: string,
    fileRoot: string,
    navigationEnabled: boolean,
    guestWebContentsId: number,
  ): Promise<HostedBrowserPane> {
    const guest = webContents.fromId(guestWebContentsId);
    const expectedPartition = browserGuestPartition(agentId, !navigationEnabled);
    if (!Number.isSafeInteger(guestWebContentsId) || !guest
      || guest.isDestroyed()
      || guest.getType() !== 'webview'
      || guest.hostWebContents !== browserWindow.webContents
      || guest.session !== session.fromPartition(expectedPartition)) {
      throw new Error('Browser guest is not attached to this window and agent.');
    }
    const key = browserPaneKey(agentId, browserId);
    const previous = this.panes.get(key);
    if (previous?.webContents === guest) {
      await this.cancelAnnotationMode(previous);
      previous.fileRoot = fileRoot;
      previous.navigationEnabled = navigationEnabled;
      previous.presentedTitle = null;
      previous.presentedUrl = null;
      await this.attachExtensions(previous);
      return previous;
    }
    await this.close(agentId, browserId);
    const pane: HostedBrowserPane = {
      agentId,
      annotationEnabled: false,
      annotationOverlay: null,
      annotationRequest: null,
      annotationResolve: null,
      annotationToken: null,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      browserId,
      browserWindow,
      consoleMessages: [],
      contentOffset: { x: 0, y: 0 },
      extensionsAttached: false,
      fileRoot,
      navigationEnabled,
      presentedTitle: null,
      presentedUrl: null,
      webContents: guest,
      visible: true,
    };
    this.panes.set(key, pane);
    guest.setWindowOpenHandler(() => ({ action: 'deny' }));
    const preventDisallowedNavigation = (event: { preventDefault(): void }, target: string): void => {
      if (!pane.navigationEnabled) {
        event.preventDefault();
        return;
      }
      try {
        normalizeBrowserUrl(target, pane.fileRoot);
      } catch {
        event.preventDefault();
      }
    };
    guest.on('will-navigate', preventDisallowedNavigation);
    guest.on('will-redirect', (event, target, _inPlace, isMainFrame) => {
      // Chromium redirects dynamic web-accessible resource URLs to their loaded
      // extension origin. Keep its subframe access checks; the browser's URL
      // policy still governs top-level navigation and every other redirect.
      if (!isMainFrame && pane.navigationEnabled) {
        try {
          const url = new URL(target);
          if (url.protocol === 'chrome-extension:' && guest.session.extensions.getExtension(url.hostname)) return;
        } catch {
          // Invalid destinations fall through to the normal navigation policy.
        }
      }
      preventDisallowedNavigation(event, target);
    });
    guest.on('console-message', (_event, level, message) => {
      pane.consoleMessages.push({ level: String(level), message, timestamp: new Date().toISOString() });
      if (pane.consoleMessages.length > 100) pane.consoleMessages.shift();
    });
    await this.attachExtensions(pane);
    return pane;
  }

  /**
   * Navigation policy is installed before this runs. A failed extension profile keeps the
   * pane registered (one handler set per guest) and the next open retries the attach.
   */
  private async attachExtensions(pane: HostedBrowserPane): Promise<void> {
    if (!pane.navigationEnabled) {
      pane.extensionsAttached = true;
      return;
    }
    if (pane.extensionsAttached) return;
    await this.options.onGuestReady?.(pane.agentId, pane.browserId, pane.webContents, pane.browserWindow);
    pane.extensionsAttached = true;
  }

  async clearBrowsingData(): Promise<void> {
    const browsing = [...this.panes.values()].filter(pane => pane.navigationEnabled && !pane.webContents.isDestroyed());
    // Stop website scripts and discard their per-tab session storage/history.
    // Extension pages, workers and authenticated storage remain in place.
    for (const pane of browsing) {
      pane.webContents.stop();
      await pane.webContents.executeJavaScript('try { sessionStorage.clear(); } catch {}');
      await pane.webContents.loadURL('about:blank');
      pane.webContents.navigationHistory.clear();
      pane.consoleMessages = [];
    }
    const shared = session.fromPartition(browserGuestPartition('shared'));
    await shared.clearData({
      excludeOrigins: supportedBrowserExtensions.map(extension => `chrome-extension://${extension.id}`),
    });
    await shared.clearAuthCache();
    await shared.clearCodeCaches({ urls: [] });
    shared.flushStorageData();
  }

  async navigate(agentId: string, browserId: string, url: string): Promise<BrowserState> {
    const pane = this.requirePane(agentId, browserId);
    const target = normalizeBrowserUrl(url, pane.fileRoot);
    try {
      await pane.webContents.loadURL(target);
    } catch (error) {
      // A page can replace its initial navigation before loadURL settles.
      // Electron rejects that original load even though its replacement is loading.
      const aborted = error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED';
      if (!aborted || pane.webContents.isDestroyed() || !pane.webContents.isLoading()) throw error;
      return this.waitForNavigation(pane);
    }
    return this.state(pane);
  }

  async goBack(agentId: string, browserId: string): Promise<BrowserState> {
    const pane = this.requirePane(agentId, browserId);
    const webContents = pane.webContents;
    if (webContents.navigationHistory.canGoBack()) webContents.navigationHistory.goBack();
    return this.waitForNavigation(pane);
  }

  async goForward(agentId: string, browserId: string): Promise<BrowserState> {
    const pane = this.requirePane(agentId, browserId);
    const webContents = pane.webContents;
    if (webContents.navigationHistory.canGoForward()) webContents.navigationHistory.goForward();
    return this.waitForNavigation(pane);
  }

  async reload(agentId: string, browserId: string): Promise<BrowserState> {
    const pane = this.requirePane(agentId, browserId);
    const webContents = pane.webContents;
    webContents.reload();
    return this.waitForNavigation(pane);
  }

  openDevTools(agentId: string, browserId: string): void {
    this.requirePane(agentId, browserId).webContents.openDevTools({ mode: 'detach' });
  }

  getZoom(agentId: string, browserId: string): number {
    return Math.round(this.requirePane(agentId, browserId).webContents.getZoomFactor() * 100);
  }

  setZoom(agentId: string, browserId: string, percent: number): number {
    if (!Number.isInteger(percent) || percent < 50 || percent > 300) {
      throw new Error('Browser zoom must be between 50% and 300%.');
    }
    this.requirePane(agentId, browserId).webContents.setZoomFactor(percent / 100);
    return percent;
  }

  async copyScreenshot(agentId: string, browserId: string, rect?: BrowserBounds): Promise<void> {
    if (rect !== undefined && (
      typeof rect !== 'object' || rect === null ||
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) ||
      rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 ||
      rect.x + rect.width > 10_000 || rect.y + rect.height > 10_000
    )) throw new Error('Invalid browser screenshot area.');
    const image = await this.requirePane(agentId, browserId).webContents.capturePage(rect);
    if (image.isEmpty()) throw new Error('The browser screenshot is empty.');
    clipboard.writeImage(image);
  }

  setBounds(agentId: string, browserId: string, bounds: BrowserViewportBounds): void {
    const pane = this.requirePane(agentId, browserId);
    pane.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
    pane.contentOffset = {
      x: Math.max(0, Math.round(bounds.contentOffset?.x ?? 0)),
      y: Math.max(0, Math.round(bounds.contentOffset?.y ?? 0)),
    };
    this.syncAnnotationOverlayBounds(pane);
  }

  setVisible(agentId: string, browserId: string, visible: boolean): void {
    const pane = this.requirePane(agentId, browserId);
    pane.visible = visible;
    if (visible && pane.navigationEnabled) this.options.onGuestSelected?.(agentId, browserId);
    if (!visible) this.rejectViewportRequest(agentId, browserId, 'Browser pane was hidden.');
    if (pane.annotationOverlay && !pane.annotationOverlay.isDestroyed()) {
      if (visible) pane.annotationOverlay.show();
      else pane.annotationOverlay.hide();
    }
  }

  async setAnnotationMode(agentId: string, browserId: string, enabled: boolean): Promise<void> {
    const pane = this.requirePane(agentId, browserId);
    pane.annotationEnabled = enabled;
    if (!enabled) {
      await this.cancelAnnotationMode(pane);
      return;
    }

    this.startAnnotationCapture(pane);
  }

  private startAnnotationCapture(pane: HostedBrowserPane): void {
    if (!pane.annotationEnabled || pane.annotationRequest || pane.annotationOverlay) return;

    const webContents = pane.webContents;
    if (webContents.isDestroyed()) return;
    webContents.focus();
    let resumeAfterPopup = false;
    const request = webContents.executeJavaScript(annotationCaptureScript(), true)
      .then(async (value: unknown) => {
        const annotation = parseAnnotation(value, webContents.getURL());
        if (!annotation) return;
        resumeAfterPopup = true;
        const comment = await this.openAnnotationOverlay(pane, annotation);
        if (!comment) return;
        this.options.onAnnotation({
          ...annotation,
          comment,
          agentId: pane.agentId,
          browserId: pane.browserId,
        });
      })
      .catch(() => {
        resumeAfterPopup = false;
        this.finishAnnotationOverlay(pane, null);
      })
      .finally(() => {
        if (pane.annotationRequest === request) pane.annotationRequest = null;
        if (resumeAfterPopup && pane.annotationEnabled) this.startAnnotationCapture(pane);
      });
    pane.annotationRequest = request;
  }

  resolveAnnotation(token: string, comment: string | null): void {
    const pane = [...this.panes.values()].find((candidate) => candidate.annotationToken === token);
    if (!pane) return;
    this.finishAnnotationOverlay(pane, typeof comment === 'string' ? comment.trim() || null : null);
  }

  async clearAnnotations(agentId: string, browserId: string): Promise<void> {
    this.requirePane(agentId, browserId);
  }

  async close(agentId: string, browserId: string): Promise<void> {
    this.rejectViewportRequest(agentId, browserId, 'Browser pane was closed.');
    const key = browserPaneKey(agentId, browserId);
    const pane = this.panes.get(key);
    if (!pane) return;
    await this.cancelAnnotationMode(pane);
    if (!pane.webContents.isDestroyed()) {
      pane.webContents.close();
    }
    this.panes.delete(key);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.panes.values()].map((pane) => this.close(pane.agentId, pane.browserId)));
  }

  private async click(pane: HostedBrowserPane, input: Record<string, unknown>): Promise<unknown> {
    if (!pane.visible) throw new Error('Open this agent’s Browser pane before clicking.');
    const selector = typeof input.selector === 'string' ? input.selector.trim() : undefined;
    const selectorOnly = Boolean(selector) && input.x === undefined && input.y === undefined;
    const pointOnly = input.selector === undefined && typeof input.x === 'number' && Number.isFinite(input.x)
      && typeof input.y === 'number' && Number.isFinite(input.y) && input.x >= 0 && input.y >= 0;
    if (!selectorOnly && !pointOnly) throw new Error('Provide either one CSS selector or both x and y in viewport CSS pixels.');
    const target = selectorOnly ? { selector } : { x: input.x, y: input.y };
    const point = await pane.webContents.executeJavaScript(`(() => {
      const input = ${JSON.stringify(target)};
      let x = input.x, y = input.y;
      if (input.selector) {
        const matches = document.querySelectorAll(input.selector);
        if (!matches.length) throw new Error('No element matches selector: ' + input.selector);
        if (matches.length !== 1) throw new Error('The selector must match exactly one element.');
        const element = matches[0];
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') throw new Error('The element is not visible.');
        x = rect.left + rect.width / 2; y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit !== element && !element.contains(hit)) throw new Error('The element is covered.');
      }
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) throw new Error('Click coordinates are outside the browser viewport.');
      return { x, y, width: innerWidth, height: innerHeight };
    })()`);
    if (!pane.browserWindow.isFocused()) pane.browserWindow.focus();
    if (!pane.webContents.isFocused()) pane.webContents.focus();
    // Chromium routes viewport CSS coordinates into out-of-process extension
    // frames. Electron's sendInputEvent can instead hit the page behind them.
    const debugger_ = pane.webContents.debugger;
    const attachedHere = !debugger_.isAttached();
    if (attachedHere) debugger_.attach('1.3');
    try {
      await debugger_.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await debugger_.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await debugger_.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    } finally {
      if (attachedHere && debugger_.isAttached()) debugger_.detach();
    }
    return { clicked: selectorOnly ? selector : target };
  }

  async execute(agentId: string, browserId: string, command: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const pane = this.requirePane(agentId, browserId);
    const webContents = pane.webContents;
    if (command === 'click') {
      const next = (this.clicks.get(webContents) ?? Promise.resolve()).catch(() => {}).then(() => this.click(pane, arguments_));
      this.clicks.set(webContents, next);
      return next;
    }
    if (command === 'viewport') {
      const viewport = parseBrowserViewport(arguments_);
      if (!pane.navigationEnabled || !pane.visible) throw new Error('Open this agent’s Browser pane before changing its viewport.');
      const notify = this.options.onViewportRequest;
      if (!notify) throw new Error('Browser viewport controls are unavailable.');
      // Dimensions are CSS pixels, independent of a previous manual page zoom.
      pane.webContents.setZoomFactor(1);
      this.rejectViewportRequest(agentId, browserId, 'Browser viewport request was superseded.');
      return new Promise((resolve, reject) => {
        const request = { agentId, browserId, requestId: crypto.randomUUID(), viewport };
        const timer = setTimeout(() => this.rejectViewportRequest(agentId, browserId, 'Timed out resizing the browser viewport.'), 10_000);
        this.viewportRequests.set(browserPaneKey(agentId, browserId), { request, resolve, reject, timer });
        try { notify(request); } catch (error) {
          this.rejectViewportRequest(agentId, browserId, error instanceof Error ? error.message : String(error));
        }
      });
    }
    if (command === 'screenshot') {
      const image = await webContents.capturePage();
      return { mimeType: 'image/png', data: image.toPNG().toString('base64') };
    }
    if (command === 'console') return { messages: pane.consoleMessages.slice(-(typeof arguments_.limit === 'number' ? arguments_.limit : 50)) };
    const selector = typeof arguments_.selector === 'string' ? arguments_.selector : undefined;
    const payload = JSON.stringify({ command, selector, text: typeof arguments_.text === 'string' ? arguments_.text : '', clear: arguments_.clear !== false, deltaY: typeof arguments_.deltaY === 'number' ? arguments_.deltaY : 500 });
    return webContents.executeJavaScript(`(() => {
      const input = ${payload}; const root = input.selector ? document.querySelector(input.selector) : document.body;
      if (!root) throw new Error('No element matches selector: ' + input.selector);
      const describe = (element) => { const rect = element.getBoundingClientRect(); return { tag: element.tagName.toLowerCase(), text: (element.innerText || element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 4000), html: element.outerHTML.slice(0, 12000), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }; };
      if (input.command === 'dom') return { url: location.href, title: document.title, selector: input.selector || 'body', element: describe(root) };
      if (input.command === 'type') { if (!('value' in root)) throw new Error('Selected element is not editable.'); root.focus(); if (input.clear) root.value = ''; root.value += input.text; root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: input.text })); root.dispatchEvent(new Event('change', { bubbles: true })); return { typed: input.text.length, selector: input.selector }; }
      if (input.command === 'scroll') { (input.selector ? root : window).scrollBy({ top: input.deltaY, behavior: 'instant' }); return { scrolled: input.deltaY, selector: input.selector || 'window' }; }
      throw new Error('Unsupported browser command.');
    })()`, true);
  }

  async viewportApplied(agentId: string, browserId: string, requestId: string, error?: string): Promise<void> {
    const key = browserPaneKey(agentId, browserId);
    const pending = this.viewportRequests.get(key);
    if (!pending || pending.request.requestId !== requestId) return;
    if (error) { this.rejectViewportRequest(agentId, browserId, error); return; }
    try {
      const metrics = await this.requirePane(agentId, browserId).webContents.executeJavaScript(
        '({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio })',
      );
      if (this.viewportRequests.get(key) !== pending) return;
      if (!metrics || !Number.isFinite(metrics.width) || metrics.width <= 0 || !Number.isFinite(metrics.height) || metrics.height <= 0) {
        throw new Error('Could not measure the browser viewport.');
      }
      clearTimeout(pending.timer);
      this.viewportRequests.delete(key);
      pending.resolve({ preset: pending.request.viewport.preset, width: metrics.width, height: metrics.height, devicePixelRatio: metrics.devicePixelRatio });
    } catch (error) {
      if (this.viewportRequests.get(key) === pending) this.rejectViewportRequest(agentId, browserId, error instanceof Error ? error.message : String(error));
    }
  }

  private rejectViewportRequest(agentId: string, browserId: string, message: string): void {
    const key = browserPaneKey(agentId, browserId);
    const pending = this.viewportRequests.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.viewportRequests.delete(key);
    pending.reject(new Error(message));
  }

  private async cancelAnnotationMode(pane: HostedBrowserPane): Promise<void> {
    pane.annotationEnabled = false;
    this.finishAnnotationOverlay(pane, null);
    if (pane.webContents.isDestroyed()) return;
    await pane.webContents.executeJavaScript('window.__appCancelAnnotation?.()', true).catch(() => undefined);
  }

  private async openAnnotationOverlay(
    pane: HostedBrowserPane,
    annotation: Omit<BrowserAnnotation, 'agentId' | 'browserId'>,
  ): Promise<string | null> {
    this.finishAnnotationOverlay(pane, null);
    const token = crypto.randomUUID();
    const overlay = new BrowserWindow({
      parent: pane.browserWindow,
      ...this.annotationOverlayBounds(pane),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    pane.annotationOverlay = overlay;
    pane.annotationToken = token;
    const completion = new Promise<string | null>((resolve) => {
      pane.annotationResolve = resolve;
    });

    overlay.once('ready-to-show', () => {
      if (overlay.isDestroyed()) return;
      overlay.show();
      overlay.focus();
    });
    overlay.once('closed', () => {
      if (pane.annotationOverlay === overlay) this.finishAnnotationOverlay(pane, null, false);
    });

    const query = {
      surface: 'annotation-overlay',
      token,
      anchor: JSON.stringify({
        ...annotation.rect,
        x: annotation.rect.x - pane.contentOffset.x,
        y: annotation.rect.y - pane.contentOffset.y,
      }),
      description: annotation.label ?? annotation.selector ?? 'Selected page area',
    };
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const target = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
      await overlay.loadURL(target.toString());
    } else {
      await overlay.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query });
    }
    return completion;
  }

  private finishAnnotationOverlay(pane: HostedBrowserPane, comment: string | null, closeWindow = true): void {
    const resolve = pane.annotationResolve;
    const overlay = pane.annotationOverlay;
    pane.annotationResolve = null;
    pane.annotationOverlay = null;
    pane.annotationToken = null;
    if (closeWindow && overlay && !overlay.isDestroyed()) overlay.close();
    resolve?.(comment);
  }

  private syncAnnotationOverlayBounds(pane: HostedBrowserPane): void {
    const overlay = pane.annotationOverlay;
    if (!overlay || overlay.isDestroyed()) return;
    overlay.setBounds(this.annotationOverlayBounds(pane));
  }

  private annotationOverlayBounds(pane: HostedBrowserPane): BrowserBounds {
    const contentBounds = pane.browserWindow.getContentBounds();
    return {
      x: contentBounds.x + pane.bounds.x,
      y: contentBounds.y + pane.bounds.y,
      width: pane.bounds.width,
      height: pane.bounds.height,
    };
  }

  private async waitForNavigation(pane: HostedBrowserPane): Promise<BrowserState> {
    const webContents = pane.webContents;
    if (webContents.isLoading()) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          webContents.removeListener('did-finish-load', finished);
          webContents.removeListener('did-fail-load', failed);
          webContents.removeListener('did-stop-loading', stopped);
          webContents.removeListener('destroyed', destroyed);
        };
        const finished = () => { cleanup(); resolve(); };
        const fail = (error: Error) => { cleanup(); reject(error); };
        const failed = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
          if (isMainFrame && code !== -3) fail(new Error(description || `Navigation failed (${code}).`));
        };
        const stopped = () => fail(new Error('Browser navigation was stopped.'));
        const destroyed = () => fail(new Error('Browser was closed during navigation.'));
        const timeout = setTimeout(() => fail(new Error('Browser navigation timed out.')), 30_000);
        webContents.once('did-finish-load', finished);
        webContents.on('did-fail-load', failed);
        webContents.once('did-stop-loading', stopped);
        webContents.once('destroyed', destroyed);
      });
    }
    return this.state(pane);
  }

  private state(pane: HostedBrowserPane): BrowserState {
    const webContents = pane.webContents;
    return {
      url: pane.presentedUrl ?? webContents.getURL(),
      title: pane.presentedTitle ?? webContents.getTitle(),
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
    };
  }

  private requirePane(agentId: string, browserId: string): HostedBrowserPane {
    const pane = this.panes.get(browserPaneKey(agentId, browserId));
    if (!pane || pane.webContents.isDestroyed()) throw new Error('Browser is not open.');
    return pane;
  }
}

export async function readVisualizationDocument(filePath: string, title: string): Promise<string> {
  const trimmedPath = filePath.trim();
  if (!/\.html?$/iu.test(trimmedPath)) {
    throw new Error('Visualizations must be HTML files.');
  }

  const handle = await open(trimmedPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    .catch(() => null);
  if (!handle) {
    throw new Error('Visualization file is unavailable.');
  }
  let fragment: string;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error('Visualization file is unavailable.');
    }
    if (metadata.size > maximumVisualizationBytes) {
      throw new Error('Visualization exceeds the 1 MB size limit.');
    }
    fragment = await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close();
  }
  const safeTitle = escapeHtml(title.trim() || 'Visualization');
  const document = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://fonts.bunny.net; font-src data: https://fonts.gstatic.com https://fonts.bunny.net; img-src data: blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<title>${safeTitle}</title>
<style>${visualizationHostStyles()}</style>
</head>
<body>${fragment}</body>
</html>`;
  return `data:text/html;base64,${Buffer.from(document).toString('base64')}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function visualizationHostStyles(): string {
  return `
:root {
  color-scheme: light dark;
  --background: light-dark(#ffffff, #181818);
  --foreground: light-dark(#242424, #f1f1f1);
  --card: light-dark(#ffffff, #202020);
  --card-foreground: var(--foreground);
  --popover: var(--card);
  --popover-foreground: var(--foreground);
  --primary: light-dark(#2557bd, #7aa2ff);
  --primary-foreground: light-dark(#ffffff, #10192e);
  --secondary: light-dark(#f0f1f3, #2b2b2b);
  --secondary-foreground: var(--foreground);
  --muted: light-dark(#f4f4f5, #292929);
  --muted-foreground: light-dark(#71717a, #a1a1aa);
  --accent: light-dark(#ebf1ff, #243456);
  --accent-foreground: var(--foreground);
  --destructive: light-dark(#d92d20, #ff7469);
  --border: light-dark(#d8dadd, #444444);
  --input: var(--border);
  --ring: var(--primary);
  --blue: light-dark(#2563eb, #60a5fa);
  --orange: light-dark(#d97706, #f59e0b);
  --green: light-dark(#059669, #34d399);
  --red: light-dark(#dc2626, #f87171);
  --purple: light-dark(#7c3aed, #a78bfa);
  --yellow: light-dark(#ca8a04, #facc15);
  --viz-series-1: var(--blue);
  --viz-series-2: var(--orange);
  --viz-series-3: var(--green);
  --viz-series-4: var(--purple);
  --viz-series-5: var(--red);
  --viz-series-6: var(--yellow);
  --font-size-base: 14px;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--background); color: var(--foreground); }
body { padding: 16px; font: var(--font-size-base)/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
button, input, select, textarea { font: inherit; }
`;
}

export function browserPaneKey(agentId: string, browserId: string): string {
  return JSON.stringify([agentId, browserId]);
}

export function normalizeBrowserUrl(value: string, fileRoot?: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Enter a URL to open.');
  if (trimmed === 'about:blank') return trimmed;
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol === 'file:') {
    assertFileUrlInsideRoot(parsed, fileRoot);
  } else if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http, https, and workspace file URLs can be opened in the browser.');
  }
  return parsed.toString();
}

function assertFileUrlInsideRoot(url: URL, fileRoot?: string): void {
  if (!fileRoot?.trim()) {
    throw new Error('File URLs require an agent workspace.');
  }

  let canonicalRoot: string;
  let canonicalTarget: string;
  try {
    canonicalRoot = realpathSync(expandHome(fileRoot));
    canonicalTarget = realpathSync(fileURLToPath(url));
  } catch {
    throw new Error('File URLs must point to an existing file inside the agent workspace.');
  }

  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('File URLs must stay inside the agent workspace.');
  }
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith(`~${path.sep}`) ? path.join(os.homedir(), value.slice(2)) : value;
}

function parseAnnotation(value: unknown, url: string): Omit<BrowserAnnotation, 'agentId' | 'browserId'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rect = record.rect;
  if ((record.kind !== 'element' && record.kind !== 'area') || !rect || typeof rect !== 'object' || Array.isArray(rect)) return null;
  const bounds = rect as Record<string, unknown>;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  return {
    id: typeof record.id === 'string' ? record.id : crypto.randomUUID(),
    url,
    kind: record.kind,
    ...(typeof record.selector === 'string' ? { selector: record.selector } : {}),
    ...(typeof record.label === 'string' ? { label: record.label } : {}),
    ...(typeof record.comment === 'string' ? { comment: record.comment } : {}),
    rect: { x: bounds.x as number, y: bounds.y as number, width: bounds.width as number, height: bounds.height as number },
  };
}

function annotationCaptureScript(): string {
  return `(() => new Promise((resolve) => {
    window.__appCancelAnnotation?.();
    const style = document.createElement('style');
    style.textContent = '* { cursor: crosshair !important; }';
    document.documentElement.append(style);
    const highlight = document.createElement('div');
    highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:3px solid #0a84ff;background:rgba(10,132,255,.18);box-sizing:border-box;display:none;';
    document.documentElement.append(highlight);
    let start = null;
    let hovered = null;
    const selectorFor = (element) => {
      if (element.id) return '#' + CSS.escape(element.id);
      const parts = [];
      let node = element;
      while (node && node.nodeType === 1 && parts.length < 5) {
        let part = node.tagName.toLowerCase();
        if (node.classList.length) part += '.' + [...node.classList].slice(0, 2).map(CSS.escape).join('.');
        const siblings = node.parentElement ? [...node.parentElement.children].filter((child) => child.tagName === node.tagName) : [];
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mouseup', onUp, true);
      style.remove();
      highlight.remove();
      delete window.__appCancelAnnotation;
    };
    const finish = (value) => { cleanup(); resolve(value); };
    const showHighlight = (rect) => {
      highlight.style.display = 'block';
      highlight.style.left = rect.x + 'px'; highlight.style.top = rect.y + 'px';
      highlight.style.width = rect.width + 'px'; highlight.style.height = rect.height + 'px';
    };
    const onMove = (event) => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element) return;
      hovered = element;
      showHighlight(element.getBoundingClientRect());
    };
    const onDown = (event) => { event.preventDefault(); event.stopPropagation(); start = { x: event.clientX, y: event.clientY }; };
    const onUp = (event) => {
      event.preventDefault(); event.stopPropagation();
      const origin = start || { x: event.clientX, y: event.clientY };
      const dx = Math.abs(event.clientX - origin.x); const dy = Math.abs(event.clientY - origin.y);
      if (dx > 6 || dy > 6) {
        finish({ kind: 'area', rect: { x: Math.min(origin.x, event.clientX), y: Math.min(origin.y, event.clientY), width: dx, height: dy } });
        return;
      }
      const element = hovered || document.elementFromPoint(event.clientX, event.clientY);
      if (!element) return finish(null);
      const rect = element.getBoundingClientRect();
      finish({ kind: 'element', selector: selectorFor(element), label: (element.getAttribute('aria-label') || element.innerText || element.textContent || element.tagName).trim().slice(0, 160), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    };
    window.__appCancelAnnotation = () => finish(null);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseup', onUp, true);
  }))()`;
}
