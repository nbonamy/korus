import { BrowserWindow, Notification, ipcMain, type Session, type WebContents } from 'electron';
import { BrowserExtensionNativePort } from './browser-extension-native-port';
import type { BrowserExtensionPackage } from '@workspace/core/browser-extensions';

type BridgeEvent = {
  sender?: WebContents;
  senderFrame?: Electron.WebFrameMain;
  serviceWorker?: Electron.ServiceWorkerMain;
  session?: Session;
};
type Listener = { event: BridgeEvent; names: Set<string>; extensionId: string };
type Tab = { contents: WebContents; window: BrowserWindow };
type Reply = { ok: true; value: unknown } | { ok: false; error: string };
const bridges = new WeakMap<Session, BrowserExtensionBridge>();
let registered = false;
const CHANNEL = 'browser-extension:call';
const EVENTS = 'browser-extension:event';

function extensionId(event: BridgeEvent): string | null {
  try {
    const url = new URL(event.serviceWorker?.scope ?? event.senderFrame?.url ?? '');
    if (url.protocol !== 'chrome-extension:') return null;
    if (!event.serviceWorker && event.senderFrame?.origin !== `chrome-extension://${url.hostname}`) return null;
    return url.hostname;
  } catch {
    return null;
  }
}
function originMatches(pattern: string, url: string): boolean {
  if (!/^https?:/.test(url)) return false;
  if (pattern === '<all_urls>') return true;
  const parts = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*:]+)(\/.*)$/.exec(pattern);
  if (!parts) return false;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const [, scheme, host, path] = parts;
  if (scheme !== '*' && `${scheme}:` !== target.protocol) return false;
  if (host.startsWith('*.')) {
    const suffix = host.slice(2).toLowerCase();
    if (target.hostname !== suffix && !target.hostname.endsWith(`.${suffix}`)) return false;
  } else if (host !== '*' && host.toLowerCase() !== target.hostname) return false;
  const escaped = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(target.pathname + target.search);
}

/** Korus-owned adapter for documented Chrome APIs absent from Electron.
 * Native scripting, messaging, storage and their isolation stay Chromium-owned.
 * IPC derives extension identity from its sender; no caller supplies an ID.
 */
export class BrowserExtensionBridge {
  private readonly tabs = new Map<number, Tab>();
  private readonly listeners = new Map<unknown, Listener>();
  private readonly actions = new Map<string, Record<string, unknown>>();
  private readonly menus = new Map<string, Map<string | number, unknown>>();
  private readonly nativePorts = new Map<string, { id: string; context: unknown; port: BrowserExtensionNativePort }>();
  private activeTab: number | undefined;
  private readonly workers = new WeakSet<Electron.ServiceWorkerMain>();
  private readonly workerTasks = new Map<Electron.ServiceWorkerMain, { id: string; end: () => void }>();
  private readonly storageRelays = new Map<string, WebContents>();
  private readonly notifications = new Map<string, Map<string, Electron.Notification>>();

  constructor(
    readonly session: Session,
    preloadPath: string,
    private readonly records: () => BrowserExtensionPackage[],
    private readonly changePermissions: (id: string, permissions: string[], remove: boolean) => Promise<boolean>,
    private readonly openPage: (id: string, url: string, active: boolean) => Promise<WebContents> = async () => {
      throw new Error('Extension windows are unavailable.');
    },
    private readonly resolveNativeHost?: (id: string, host: string) => Promise<{ name: string; path: string }>,
  ) {
    bridges.set(session, this);
    if (!registered) {
      registered = true;
      ipcMain.handle(CHANNEL, async (event, operation: string, args: unknown[]) => {
        const source = event as unknown as BridgeEvent;
        const owner = bridges.get(source.session ?? source.sender!.session);
        return owner
          ? owner.dispatch(source, operation, args)
          : { ok: false, error: 'Extension session is unavailable.' };
      });
    }
    const handleWorkerStatus = (status: { runningStatus: string; versionId: number }): void => {
      if (status.runningStatus === 'stopped') {
        for (const entry of this.nativePorts.values()) {
          const worker = entry.context as Electron.ServiceWorkerMain;
          if (worker.versionId === status.versionId) entry.port.close('Extension worker stopped.');
        }
      }
      if (status.runningStatus !== 'starting' && status.runningStatus !== 'running') {
        if (status.runningStatus === 'stopped')
          for (const [worker, task] of this.workerTasks)
            if (worker.versionId === status.versionId) {
              try {
                task.end();
              } catch {
                /* Already stopped. */
              }
              this.workerTasks.delete(worker);
              this.listeners.delete(worker);
              this.closeNativePorts(undefined, worker);
            }
        return;
      }
      const worker = session.serviceWorkers.getWorkerFromVersionID(status.versionId);
      if (!worker || !worker.scope.startsWith('chrome-extension://')) return;
      if (!this.workers.has(worker)) {
        this.workers.add(worker);
        worker.ipc.handle(CHANNEL, (event, operation: string, args: unknown[]) =>
          this.dispatch(event as unknown as BridgeEvent, operation, args),
        );
      }
      if (this.workerTasks.has(worker) && status.runningStatus !== 'running') return;
      try {
        const task = worker.startTask();
        this.workerTasks.get(worker)?.end();
        this.workerTasks.set(worker, { id: new URL(worker.scope).hostname, end: () => task.end() });
      } catch {
        /* A starting worker acquires its keepalive when running. */
      }
    };
    session.serviceWorkers.on('running-status-changed', handleWorkerStatus);
    // A persistent session may already have started its worker before the
    // browser/profile finished restoring. Attach IPC before exposing more APIs.
    for (const versionId of Object.keys(session.serviceWorkers.getAllRunning()))
      handleWorkerStatus({ versionId: Number(versionId), runningStatus: 'running' });
    session.registerPreloadScript({ id: 'browser-extension-frame', type: 'frame', filePath: preloadPath });
    session.registerPreloadScript({ id: 'browser-extension-worker', type: 'service-worker', filePath: preloadPath });
    session.extensions.on('extension-unloaded', (_event, extension) => this.forgetExtension(extension.id));
  }

  attachTab(contents: WebContents, window: BrowserWindow): void {
    if (contents.session !== this.session || this.tabs.has(contents.id)) return;
    this.tabs.set(contents.id, { contents, window });
    this.activeTab = contents.id;
    const description = (): Record<string, unknown> => this.describeTab(contents.id, true);
    contents.once('destroyed', () => {
      this.tabs.delete(contents.id);
      this.emit('tabs.onRemoved', [contents.id, { windowId: window.id, isWindowClosing: false }]);
      if (this.activeTab === contents.id) this.activeTab = this.tabs.keys().next().value;
    });
    contents.on('focus', () => this.selectTab(contents.id));
    contents.on('did-start-loading', () =>
      this.emit('tabs.onUpdated', [contents.id, { status: 'loading' }, description()]),
    );
    contents.on('did-stop-loading', () =>
      this.emit('tabs.onUpdated', [contents.id, { status: 'complete' }, description()]),
    );
    contents.on('did-frame-navigate', (_event, url, _code, _text, mainFrame, processId, routingId) => {
      this.emit('webNavigation.onCommitted', [
        {
          tabId: contents.id,
          url,
          frameId: mainFrame
            ? 0
            : contents.mainFrame.framesInSubtree.find(
                (frame) => frame.processId === processId && frame.routingId === routingId,
              )?.frameTreeNodeId,
          timeStamp: Date.now(),
          transitionType: 'link',
          transitionQualifiers: [],
        },
      ]);
    });
    contents.on('dom-ready', () =>
      this.emit('webNavigation.onDOMContentLoaded', [
        { tabId: contents.id, url: contents.getURL(), frameId: 0, timeStamp: Date.now() },
      ]),
    );
    contents.on('did-finish-load', () =>
      this.emit('webNavigation.onCompleted', [
        { tabId: contents.id, url: contents.getURL(), frameId: 0, timeStamp: Date.now() },
      ]),
    );
    contents.on('did-navigate-in-page', (_event, url, mainFrame) =>
      this.emit('webNavigation.onHistoryStateUpdated', [
        { tabId: contents.id, url, frameId: mainFrame ? 0 : -1, timeStamp: Date.now() },
      ]),
    );
    this.emit('tabs.onCreated', [description()]);
  }
  selectTab(id: number): void {
    if (this.tabs.has(id) && this.activeTab !== id) {
      this.activeTab = id;
      this.emit('tabs.onActivated', [{ tabId: id, windowId: this.tabs.get(id)!.window.id }]);
    }
  }
  setStorageRelay(id: string, contents?: WebContents): void {
    if (contents) this.storageRelays.set(id, contents);
    else this.storageRelays.delete(id);
  }
  forgetExtension(id: string): void {
    this.closeNativePorts(id);
    for (const [worker, task] of this.workerTasks)
      if (task.id === id) {
        try {
          task.end();
        } catch {
          /* Already stopped by Chromium. */
        }
        this.workerTasks.delete(worker);
      }
    for (const [key, listener] of this.listeners) if (listener.extensionId === id) this.listeners.delete(key);
    this.actions.delete(id);
    this.menus.delete(id);
    for (const notification of this.notifications.get(id)?.values() ?? []) notification.close();
    this.notifications.delete(id);
  }
  dispose(): void {
    for (const { id } of this.workerTasks.values()) this.forgetExtension(id);
    this.closeNativePorts();
    bridges.delete(this.session);
  }

  emit(name: string, args: unknown[], target?: string): void {
    for (const listener of this.listeners.values()) {
      const record = this.records().find((record) => record.id === listener.extensionId && record.enabled);
      if (!record || (target && target !== record.id) || !listener.names.has(name)) continue;
      if (name.startsWith('webNavigation.') && !record.permissions.includes('webNavigation')) continue;
      const values = name.startsWith('tabs.') ? this.redactTabEvent(record, name, args) : args;
      try {
        const sender = listener.event.serviceWorker ?? listener.event.senderFrame;
        if (sender && !('isDestroyed' in sender && sender.isDestroyed())) sender.send(EVENTS, name, values);
      } catch {
        /* A terminated context registers again when Chromium restarts it. */
      }
    }
  }
  private closeNativePorts(id?: string, context?: unknown): void {
    for (const entry of this.nativePorts.values())
      if ((!id || entry.id === id) && (!context || entry.context === context))
        entry.port.close('Desktop integration disconnected.');
  }
  private async openNativePort(
    record: BrowserExtensionPackage,
    event: BridgeEvent,
    connection: string,
    host: string,
    receive?: (value: unknown) => void,
    disconnected?: (reason?: string) => void,
  ): Promise<BrowserExtensionNativePort> {
    if (!this.resolveNativeHost) throw new Error('Native desktop integration is unavailable.');
    if (!connection || connection.length > 128 || this.nativePorts.has(connection) || this.nativePorts.size >= 32)
      throw new Error('Invalid native connection.');
    const executable = await this.resolveNativeHost(record.id, host);
    if (this.nativePorts.has(connection) || this.nativePorts.size >= 32) throw new Error('Invalid native connection.');
    const current = this.records().find((entry) => entry.id === record.id && entry.enabled);
    if (!current?.permissions.includes('nativeMessaging') || extensionId(event) !== record.id)
      throw new Error('Native messaging permission is required.');
    const context = event.serviceWorker ?? event.senderFrame;
    if (!context) throw new Error('Unknown native context.');
    const send = (name: string, args: unknown[]) => {
      try {
        (event.serviceWorker ?? event.senderFrame)?.send(EVENTS, name, args);
      } catch {
        port.close();
      }
    };
    const onNavigation = () => {
      if (extensionId(event) !== record.id) port.close();
    };
    const onDestroyed = () => port.close();
    const port = new BrowserExtensionNativePort(
      executable.path,
      `chrome-extension://${record.id}/`,
      (value) => {
        const owner = this.records().find((entry) => entry.id === record.id && entry.enabled);
        if (!owner?.permissions.includes('nativeMessaging') || extensionId(event) !== record.id) {
          port.close();
          return;
        }
        if (receive) receive(value);
        else send('native.message', [connection, value]);
      },
      (reason) => {
        this.nativePorts.delete(connection);
        event.sender?.removeListener('destroyed', onDestroyed);
        event.sender?.removeListener('did-frame-navigate', onNavigation);
        if (disconnected) disconnected(reason);
        else send('native.disconnected', [connection, reason]);
      },
    );
    this.nativePorts.set(connection, { id: record.id, context, port });
    event.sender?.once('destroyed', onDestroyed);
    event.sender?.on('did-frame-navigate', onNavigation);
    await port.ready;
    return port;
  }
  private redactTabEvent(record: BrowserExtensionPackage, name: string, args: unknown[]): unknown[] {
    if (name === 'tabs.onCreated') return [this.describeTab((args[0] as { id: number }).id, record)];
    if (name === 'tabs.onUpdated') {
      const id = args[0] as number;
      return [id, { status: (args[1] as { status: string }).status }, this.describeTab(id, record)];
    }
    return args;
  }
  private describeTab(id: number, record: BrowserExtensionPackage | true): Record<string, unknown> {
    const tab = this.tabs.get(id);
    if (!tab || tab.contents.isDestroyed()) throw new Error('Tab is unavailable.');
    const url = tab.contents.getURL();
    const details =
      record === true ||
      record.permissions.includes('tabs') ||
      record.permissions.some((permission) => originMatches(permission, url));
    return {
      id,
      windowId: tab.window.id,
      active: id === this.activeTab,
      highlighted: id === this.activeTab,
      index: [...this.tabs.keys()].indexOf(id),
      incognito: false,
      pinned: false,
      status: tab.contents.isLoading() ? 'loading' : 'complete',
      ...(details ? { url, title: tab.contents.getTitle() } : {}),
    };
  }

  async dispatch(event: BridgeEvent, operation: string, args: unknown[]): Promise<Reply> {
    try {
      const id = extensionId(event),
        record = this.records().find((record) => record.id === id && record.enabled);
      if (!record || (event.session ?? event.sender?.session) !== this.session || !Array.isArray(args))
        throw new Error('Unknown extension context.');
      return { ok: true, value: await this.invoke(record, event, operation, args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Extension operation failed.' };
    }
  }
  private async invoke(
    record: BrowserExtensionPackage,
    event: BridgeEvent,
    operation: string,
    args: unknown[],
  ): Promise<unknown> {
    const first = (args[0] ?? {}) as Record<string, unknown>;
    if (operation === 'relay.storage') {
      if (
        this.storageRelays.get(record.id) !== event.sender ||
        !['local', 'session', 'sync', 'managed'].includes(String(args[1]))
      )
        throw new Error('Unknown storage relay.');
      this.emit('storage.onChanged', [args[0], args[1]], record.id);
      this.emit(`storage.${args[1]}.onChanged`, [args[0]], record.id);
      return;
    }
    if (operation === 'subscribe') {
      const name = args[0];
      if (
        typeof name !== 'string' ||
        !/^(tabs|windows|webNavigation|permissions|action|contextMenus|commands|notifications|storage(?:\.(?:local|session|sync|managed))?)\.on[A-Za-z]+$/.test(
          name,
        )
      )
        throw new Error('Unsupported extension event.');
      const key = event.serviceWorker ?? event.senderFrame;
      if (!key) throw new Error('Unknown event sender.');
      const listener = this.listeners.get(key) ?? { event, names: new Set(), extensionId: record.id };
      listener.names.add(name);
      this.listeners.set(key, listener);
      return;
    }
    if (operation.startsWith('permissions.')) {
      const permissions = Array.isArray(first.permissions) ? (first.permissions as string[]) : [],
        origins = Array.isArray(first.origins) ? (first.origins as string[]) : [];
      if (operation === 'permissions.getAll')
        return {
          permissions: record.permissions.filter((value) => !value.includes('://') && value !== '<all_urls>'),
          origins: record.permissions.filter((value) => value.includes('://') || value === '<all_urls>'),
        };
      if (operation === 'permissions.contains')
        return [...permissions, ...origins].every((value) => record.permissions.includes(value));
      if (operation === 'permissions.request' || operation === 'permissions.remove') {
        const requested = [...permissions, ...origins];
        if (requested.some((value) => typeof value !== 'string' || !(record.optionalPermissions ?? []).includes(value)))
          return false;
        // Electron cannot dynamically grant/revoke Chromium-owned permissions.
        // Only advertise optional grants whose enforcement belongs to this bridge.
        if (
          requested.some(
            (value) =>
              ![
                'tabs',
                'webNavigation',
                'contextMenus',
                'notifications',
                ...(this.resolveNativeHost ? ['nativeMessaging'] : []),
              ].includes(value),
          )
        )
          return false;
        const remove = operation === 'permissions.remove';
        if (!requested.length) return true;
        if (!remove && requested.every((value) => record.permissions.includes(value))) return true;
        if (!(await this.changePermissions(record.id, requested, remove))) return false;
        if (remove && requested.includes('nativeMessaging')) this.closeNativePorts(record.id);
        this.emit(remove ? 'permissions.onRemoved' : 'permissions.onAdded', [{ permissions, origins }], record.id);
        return true;
      }
    }
    if (operation.startsWith('runtime.') && operation.toLowerCase().includes('native')) {
      if (!record.permissions.includes('nativeMessaging')) throw new Error('Native messaging permission is required.');
      const context = event.serviceWorker ?? event.senderFrame;
      if (operation === 'runtime.connectNative') {
        await this.openNativePort(record, event, String(args[0]), String(args[1]));
        return;
      }
      if (operation === 'runtime.nativePostMessage' || operation === 'runtime.disconnectNative') {
        const entry = this.nativePorts.get(String(args[0]));
        if (!entry || entry.context !== context || entry.id !== record.id)
          throw new Error('Unknown native connection.');
        if (operation === 'runtime.nativePostMessage') entry.port.send(args[1]);
        else entry.port.close();
        return;
      }
      if (operation === 'runtime.sendNativeMessage') {
        let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
        const response = new Promise<unknown>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        void response.catch(() => {});
        const timer = setTimeout(() => reject(new Error('Native desktop response timed out.')), 30_000);
        let port: BrowserExtensionNativePort | undefined;
        try {
          port = await this.openNativePort(record, event, crypto.randomUUID(), String(args[0]), resolve, (reason) =>
            reject(new Error(reason ?? 'Native desktop connection closed.')),
          );
          port.send(args[1]);
          return await response;
        } finally {
          clearTimeout(timer);
          port?.close();
        }
      }
      throw new Error('Unsupported native messaging operation.');
    }
    if (
      /^privacy\.services\.(passwordSavingEnabled|autofillEnabled|autofillAddressEnabled|autofillCreditCardEnabled)\.(get|set|clear)$/.test(
        operation,
      )
    ) {
      if (!record.permissions.includes('privacy')) throw new Error('privacy permission is required.');
      // Korus has no built-in credential/card/address saving service to control.
      if (operation.endsWith('.get')) return { value: false, levelOfControl: 'not_controllable' };
      if (operation.endsWith('.set') && first.value !== false)
        throw new Error('Built-in browser autofill is unavailable.');
      return;
    }
    if (operation === 'runtime.openOptionsPage') {
      const manifest = this.session.extensions.getExtension(record.id)?.manifest;
      const page = manifest?.options_ui?.page ?? manifest?.options_page;
      if (typeof page !== 'string') throw new Error('No extension settings page.');
      await this.openPage(record.id, new URL(page, `chrome-extension://${record.id}/`).href, true);
      return;
    }
    if (operation === 'tabs.query') {
      return [...this.tabs.keys()]
        .map((id) => this.describeTab(id, record))
        .filter(
          (tab) =>
            (typeof first.active !== 'boolean' || tab.active === first.active) &&
            (typeof first.windowId !== 'number' || first.windowId < 0 || tab.windowId === first.windowId) &&
            (!first.url ||
              (Array.isArray(first.url) ? first.url : [first.url]).some(
                (pattern) =>
                  typeof pattern === 'string' && typeof tab.url === 'string' && originMatches(pattern, tab.url),
              )),
        );
    }
    if (operation === 'tabs.getCurrent')
      return event.sender && this.tabs.has(event.sender.id) ? this.describeTab(event.sender.id, record) : undefined;
    if (operation === 'tabs.get') return this.describeTab(Number(args[0]), record);
    if (operation === 'tabs.create') {
      const contents = await this.openPage(record.id, String(first.url ?? 'about:blank'), first.active !== false);
      return this.describeTab(contents.id, record);
    }
    if (operation.startsWith('tabs.')) {
      const id = typeof args[0] === 'number' ? args[0] : this.activeTab,
        tab = id === undefined ? undefined : this.tabs.get(id);
      if (!tab) throw new Error('Tab is unavailable.');
      if (operation === 'tabs.reload') {
        tab.contents.reload();
        return;
      }
      if (operation === 'tabs.remove') {
        tab.contents.close();
        return;
      }
      if (operation === 'tabs.update') {
        const update = (typeof args[0] === 'number' ? args[1] : args[0]) as Record<string, unknown>;
        if (update.url) {
          const url = new URL(String(update.url));
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported navigation.');
          await tab.contents.loadURL(url.href);
        }
        if (update.active === true) {
          this.selectTab(id!);
          tab.window.show();
          tab.contents.focus();
        }
        return this.describeTab(id!, record);
      }
    }
    if (operation.startsWith('webNavigation.')) {
      if (!record.permissions.includes('webNavigation')) throw new Error('webNavigation permission is required.');
      const tab = this.tabs.get(Number(first.tabId));
      if (!tab) return operation.endsWith('getAllFrames') ? [] : null;
      const frames = tab.contents.mainFrame.framesInSubtree.map((frame) => ({
        frameId: frame === frame.top ? 0 : frame.frameTreeNodeId,
        parentFrameId: frame.parent ? (frame.parent === frame.top ? 0 : frame.parent.frameTreeNodeId) : -1,
        url: frame.url,
        errorOccurred: false,
        documentLifecycle: 'active',
        frameType: frame.parent ? 'sub_frame' : 'outermost_frame',
      }));
      return operation === 'webNavigation.getAllFrames'
        ? frames
        : (frames.find((frame) => frame.frameId === first.frameId) ?? null);
    }
    if (operation.startsWith('windows.')) {
      const windows = [...new Map([...this.tabs.values()].map((tab) => [tab.window.id, tab.window])).values()].filter(
        (window) => !window.isDestroyed(),
      );
      const describe = (window: BrowserWindow): Record<string, unknown> => ({
        id: window.id,
        focused: window.isFocused(),
        incognito: false,
        type: 'normal',
        state: window.isFullScreen() ? 'fullscreen' : window.isMaximized() ? 'maximized' : 'normal',
        ...window.getBounds(),
        ...(first.populate
          ? {
              tabs: [...this.tabs.keys()]
                .map((id) => this.describeTab(id, record))
                .filter((tab) => tab.windowId === window.id),
            }
          : {}),
      });
      if (operation === 'windows.getAll') return windows.map(describe);
      if (operation === 'windows.getCurrent' || operation === 'windows.getLastFocused')
        return windows.length ? describe(windows.find((window) => window.isFocused()) ?? windows[0]) : undefined;
      if (operation === 'windows.get') {
        const window = windows.find((window) => window.id === args[0]);
        if (!window) throw new Error('Window is unavailable.');
        return describe(window);
      }
      if (operation === 'windows.create') {
        const contents = await this.openPage(
          record.id,
          String(Array.isArray(first.url) ? first.url[0] : (first.url ?? 'about:blank')),
          first.focused !== false,
        );
        return describe(this.tabs.get(contents.id)!.window);
      }
    }
    if (operation.startsWith('action.')) {
      const state = this.actions.get(record.id) ?? {};
      this.actions.set(record.id, state);
      const name = operation.slice(7);
      if (name === 'getUserSettings') return { isOnToolbar: true };
      if (name.startsWith('set')) {
        state[name.slice(3)] = first;
        return;
      }
      if (name.startsWith('get')) {
        const value = state[name.slice(3)] as Record<string, unknown> | undefined;
        return value?.[name === 'getPopup' ? 'popup' : name === 'getTitle' ? 'title' : 'text'] ?? '';
      }
      if (name === 'enable' || name === 'disable') return;
    }
    if (operation.startsWith('contextMenus.')) {
      if (!record.permissions.includes('contextMenus')) throw new Error('contextMenus permission is required.');
      const menus = this.menus.get(record.id) ?? new Map();
      this.menus.set(record.id, menus);
      if (operation === 'contextMenus.create') {
        const id = (first.id as string | undefined) ?? crypto.randomUUID();
        menus.set(id, first);
        return id;
      }
      if (operation === 'contextMenus.removeAll') {
        menus.clear();
        return;
      }
      if (operation === 'contextMenus.remove') {
        menus.delete(args[0] as string);
        return;
      }
      if (operation === 'contextMenus.update') {
        menus.set(args[0] as string, args[1]);
        return;
      }
    }
    if (operation === 'commands.getAll') return [];
    if (operation.startsWith('notifications.')) {
      if (!record.permissions.includes('notifications')) throw new Error('notifications permission is required.');
      const entries = this.notifications.get(record.id) ?? new Map<string, Electron.Notification>();
      this.notifications.set(record.id, entries);
      if (operation === 'notifications.getPermissionLevel') return Notification.isSupported() ? 'granted' : 'denied';
      if (operation === 'notifications.getAll') return Object.fromEntries([...entries.keys()].map((id) => [id, true]));
      const id = typeof args[0] === 'string' ? args[0] : crypto.randomUUID();
      if (operation === 'notifications.clear') {
        const existed = entries.has(id);
        entries.get(id)?.close();
        entries.delete(id);
        return existed;
      }
      if (operation === 'notifications.create' || operation === 'notifications.update') {
        const options = (typeof args[0] === 'string' ? args[1] : first) as Record<string, unknown>;
        if (operation === 'notifications.update' && !entries.has(id)) return false;
        entries.get(id)?.close();
        const notification = new Notification({
          title: String(options.title ?? record.name),
          body: String(options.message ?? ''),
          silent: options.silent === true,
        });
        entries.set(id, notification);
        notification.on('click', () => this.emit('notifications.onClicked', [id], record.id));
        notification.on('close', () => {
          entries.delete(id);
          this.emit('notifications.onClosed', [id, true], record.id);
        });
        notification.show();
        return operation === 'notifications.update' ? true : id;
      }
    }
    throw new Error(`Unsupported browser extension operation: ${operation}`);
  }
}
