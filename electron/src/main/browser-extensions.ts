import { BrowserWindow, dialog, session, type Session, type WebContents } from 'electron';
import path from 'node:path';
import { browserGuestPartition } from '@workspace/core/browser-guest';
import {
  supportedBrowserExtensions,
  type BrowserExtensionDefinition,
  type BrowserExtensionAction,
  type BrowserExtensionPackage,
  type BrowserExtensionPackageRequest,
  type BrowserExtensionPackageState,
  type BrowserExtensionState,
} from '@workspace/core/browser-extensions';
import { BrowserExtensionBridge } from './browser-extension-bridge';
import { extensionPermissionSummary } from './browser-extension-permissions';

type Profile = {
  session: Session;
  records: BrowserExtensionPackage[];
  bridge: BrowserExtensionBridge;
  windows: Map<BrowserWindow, string>;
  tabs: Map<string, WebContents>;
  relays: Map<string, BrowserWindow>;
  errors: Map<string, string>;
  repairs: Map<string, number>;
  suspended: Set<string>;
};
type Options = {
  request(agentId: string, input: BrowserExtensionPackageRequest): Promise<BrowserExtensionPackageState>;
  parent(): BrowserWindow | null;
  catalog?: readonly BrowserExtensionDefinition[];
  preloadPath?: string;
  confirm?: (message: string, detail: string) => Promise<boolean>;
};

/** Desktop extension lifecycle. Files and durable grants belong to daemon. */
export class BrowserExtensions {
  private readonly profiles = new Map<string, Promise<Profile>>();
  private readonly operations = new Map<string, Promise<unknown>>();
  constructor(private readonly options: Options) {}
  private get catalog(): readonly BrowserExtensionDefinition[] {
    return this.options.catalog ?? supportedBrowserExtensions;
  }
  async dispose(): Promise<void> {
    for (const pending of this.profiles.values()) {
      const profile = await pending.catch(() => null);
      if (!profile) continue;
      for (const record of profile.records) {
        profile.suspended.add(record.id);
        this.stopRelay(profile, record.id);
        this.closeWindows(profile, record.id);
        profile.session.extensions.removeExtension(record.id);
      }
      profile.bridge.dispose();
    }
    this.profiles.clear();
  }

  async attachGuest(agentId: string, browserId: string, contents: WebContents, window: BrowserWindow): Promise<void> {
    const profile = await this.profile(agentId);
    if (contents.session !== profile.session) throw new Error('Browser extension profile mismatch.');
    profile.tabs.set(browserId, contents);
    profile.bridge.attachTab(contents, window);
  }
  async selectGuest(agentId: string, browserId: string): Promise<void> {
    const profile = await this.profile(agentId),
      tab = profile.tabs.get(browserId);
    if (tab && !tab.isDestroyed()) profile.bridge.selectTab(tab.id);
  }
  manage(
    agentId: string,
    action: BrowserExtensionAction,
    id?: string,
    browserId?: string,
  ): Promise<BrowserExtensionState> {
    const previous = this.operations.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.apply(agentId, action, id, browserId));
    this.operations.set(agentId, next);
    void next
      .finally(() => {
        if (this.operations.get(agentId) === next) this.operations.delete(agentId);
      })
      .catch(() => {});
    return next;
  }
  private async profile(agentId: string): Promise<Profile> {
    let pending = this.profiles.get(agentId);
    if (!pending) {
      pending = this.createProfile(agentId);
      this.profiles.set(agentId, pending);
      void pending.catch(() => {
        if (this.profiles.get(agentId) === pending) this.profiles.delete(agentId);
      });
    }
    return pending;
  }
  private async createProfile(agentId: string): Promise<Profile> {
    const state = await this.options.request(agentId, { action: 'list' });
    const ses = session.fromPartition(browserGuestPartition(agentId));
    const profile: Profile = {
      session: ses,
      records: state.extensions,
      bridge: null!,
      windows: new Map(),
      tabs: new Map(),
      relays: new Map(),
      errors: new Map(),
      repairs: new Map(),
      suspended: new Set(),
    };
    profile.bridge = new BrowserExtensionBridge(
      ses,
      this.options.preloadPath ?? path.join(__dirname, 'browser-extensions-preload.cjs'),
      () => profile.records,
      async (id, permissions, remove) => {
        const name = this.catalog.find((extension) => extension.id === id)!.name;
        if (!remove && !(await this.confirmPermissions(name, permissions, 'Allow'))) return false;
        const result = await this.options.request(agentId, {
          action: 'permissions',
          id,
          permissions,
          remove,
        });
        profile.records = result.extensions;
        return true;
      },
      (id, url, active) => this.openPage(profile, id, url, active),
      async (id, host) => {
        const state = await this.options.request(agentId, { action: 'nativeHost', id, host });
        if (!state.nativeHost) throw new Error('Native desktop integration is unavailable.');
        return state.nativeHost;
      },
    );
    ses.extensions.on('extension-unloaded', (_event, extension) => this.stopRelay(profile, extension.id));
    ses.extensions.on('extension-ready', (_event, extension) => {
      if (profile.records.some((record) => record.id === extension.id && record.enabled))
        void this.startRelay(profile, extension.id).catch(() =>
          profile.errors.set(extension.id, 'Extension storage events are unavailable. Try Update or Reinstall.'),
        );
    });
    await this.synchronize(profile);
    return profile;
  }
  private async apply(
    agentId: string,
    action: BrowserExtensionAction,
    id?: string,
    browserId?: string,
  ): Promise<BrowserExtensionState> {
    if (!['list', 'install', 'update', 'reinstall', 'enable', 'disable', 'remove', 'open'].includes(action))
      throw new Error('Invalid extension action.');
    if (action !== 'list' && !this.catalog.some((extension) => extension.id === id))
      throw new Error('Unsupported browser extension.');
    const profile = await this.profile(agentId);
    let message: string | undefined;
    if (browserId) await this.selectGuest(agentId, browserId);
    if (action === 'install' || action === 'update' || action === 'reinstall') {
      const state = await this.options.request(agentId, {
        action: 'prepare',
        id: id!,
        chromeVersion: process.versions.chrome,
      });
      const candidate = state.candidate!;
      const previous = profile.records.find((record) => record.id === id);
      if (action === 'update' && candidate.version === previous?.version && !profile.errors.has(id!)) {
        await this.options.request(agentId, {
          action: 'cancel',
          token: candidate.token,
        });
        message = 'Already up to date.';
      } else {
        if (previous?.version && candidate.addedPermissions.length) {
          const approved = await this.confirmPermissions(
            this.catalog.find((extension) => extension.id === id)!.name,
            candidate.addedPermissions,
            action === 'update' ? 'Update' : action === 'reinstall' ? 'Reinstall' : 'Install',
          );
          if (!approved) {
            await this.options.request(agentId, {
              action: 'cancel',
              token: candidate.token,
            });
            return this.state(profile);
          }
        }
        profile.records = (
          await this.options.request(agentId, {
            action: 'commit',
            token: candidate.token,
          })
        ).extensions;
        await this.synchronize(profile, true, id);
        if (
          action === 'install' &&
          ![...profile.windows].some(([window, owner]) => owner === id && !window.isDestroyed() && window.isVisible())
        ) {
          const setup = this.catalog.find((extension) => extension.id === id)?.setupPage;
          if (setup) await this.openPage(profile, id!, setup, true);
          else await this.openAction(profile, id!);
        }
      }
    } else if (action === 'enable' || action === 'disable') {
      profile.records = (
        await this.options.request(agentId, {
          action: 'enabled',
          id: id!,
          enabled: action === 'enable',
        })
      ).extensions;
      await this.synchronize(profile, true, id);
    } else if (action === 'remove') {
      const record = profile.records.find((record) => record.id === id && record.version);
      if (!record) return this.state(profile);
      if (
        !(await this.confirm(
          `Remove ${record.name}?`,
          'Remove this extension and its local account data from this browser profile? Other extensions and website data will be kept.',
          'Remove',
        ))
      )
        return this.state(profile);
      await this.clearData(agentId, profile, record);
      profile.records = (await this.options.request(agentId, { action: 'remove', id: id! })).extensions;
      await this.synchronize(profile, true, id);
    } else if (action === 'open') await this.openAction(profile, id!);
    return { ...this.state(profile), ...(message ? { message } : {}) };
  }
  private state(profile: Profile): BrowserExtensionState {
    return {
      extensions: profile.records.map(({ id, name, version, enabled, permissions }) => ({
        id,
        name,
        version,
        enabled,
        permissions,
        ...(profile.errors.has(id) ? { error: profile.errors.get(id) } : {}),
      })),
    };
  }
  private async synchronize(profile: Profile, reload = false, reloadId?: string): Promise<void> {
    let changed = false;
    for (const record of profile.records) {
      // Backend validates restored records; enforce the product allowlist here too.
      if (!this.catalog.some((extension) => extension.id === record.id)) continue;
      const loaded = profile.session.extensions.getExtension(record.id);
      if (loaded && (!record.enabled || loaded.path !== record.path || reloadId === record.id)) {
        this.closeWindows(profile, record.id);
        this.stopRelay(profile, record.id);
        profile.session.extensions.removeExtension(record.id);
        changed = true;
      }
      if (record.error) {
        profile.errors.set(record.id, record.error);
        continue;
      }
      if (!record.enabled || !record.path) {
        profile.errors.delete(record.id);
        continue;
      }
      if (!profile.session.extensions.getExtension(record.id)) {
        try {
          profile.errors.delete(record.id);
          const extension = await profile.session.extensions.loadExtension(record.path, { allowFileAccess: false });
          if (extension.id !== record.id) {
            profile.session.extensions.removeExtension(extension.id);
            throw new Error('Extension identity mismatch.');
          }
          await this.startRelay(profile, record.id);
          changed = true;
        } catch (error) {
          profile.errors.set(
            record.id,
            `Could not start this extension: ${error instanceof Error ? error.message : 'Unknown error'}. Try Disable, Update or Reinstall.`,
          );
        }
      }
    }
    if (reload) for (const tab of profile.tabs.values()) if (!tab.isDestroyed()) tab.reload();
  }
  private async openPage(profile: Profile, id: string, value: string, active: boolean): Promise<WebContents> {
    const url = new URL(value === 'about:blank' ? value : value, `chrome-extension://${id}/`);
    if (
      !['http:', 'https:'].includes(url.protocol) &&
      !(url.protocol === 'chrome-extension:' && url.hostname === id) &&
      url.href !== 'about:blank'
    )
      throw new Error('Unsupported extension navigation.');
    const window = this.window(profile, id, active);
    profile.bridge.attachTab(window.webContents, window);
    await window.loadURL(url.href);
    return window.webContents;
  }
  private window(profile: Profile, id: string, show: boolean, javascript = true, popup = false): BrowserWindow {
    const parent = this.options.parent();
    const window = new BrowserWindow({
      width: popup ? 480 : 520,
      height: popup ? 760 : 740,
      useContentSize: true,
      show,
      ...(parent ? { parent } : {}),
      webPreferences: {
        session: profile.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        javascript,
      },
    });
    profile.windows.set(window, id);
    window.once('closed', () => profile.windows.delete(window));
    window.webContents.setWindowOpenHandler(({ url }) => {
      void this.openPage(profile, id, url, true).catch(() => {});
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      try {
        const parsed = new URL(url);
        if (
          !['http:', 'https:'].includes(parsed.protocol) &&
          !(parsed.protocol === 'chrome-extension:' && parsed.hostname === id)
        )
          event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    return window;
  }
  private async openAction(profile: Profile, id: string): Promise<void> {
    const record = profile.records.find((record) => record.id === id && record.enabled);
    const extension = profile.session.extensions.getExtension(id);
    if (!record || !extension) throw new Error('Enable the extension before opening it.');
    const page = extension.manifest.action?.default_popup ?? extension.manifest.browser_action?.default_popup;
    if (typeof page !== 'string') {
      profile.bridge.emit('action.onClicked', [], id);
      return;
    }
    const existing = [...profile.windows].find(
      ([window, owner]) => owner === id && !window.isDestroyed() && window.isVisible(),
    );
    if (existing) {
      existing[0].show();
      existing[0].focus();
      return;
    }
    const window = this.window(profile, id, true, true, true);
    await window.loadURL(new URL(page, `chrome-extension://${id}/`).href);
  }
  private closeWindows(profile: Profile, id: string): void {
    for (const [window, owner] of profile.windows) if (owner === id && !window.isDestroyed()) window.destroy();
  }
  private stopRelay(profile: Profile, id: string): void {
    const relay = profile.relays.get(id);
    profile.relays.delete(id);
    profile.bridge.setStorageRelay(id);
    if (relay && !relay.isDestroyed()) relay.destroy();
  }
  private async startRelay(profile: Profile, id: string): Promise<void> {
    // This Electron workaround is required by the current Bitwarden worker.
    // Other extensions use their native storage delivery unless evidence needs it.
    const relayPage = this.catalog.find((extension) => extension.id === id)?.storageRelayPage;
    if (
      !relayPage ||
      profile.relays.has(id) ||
      profile.suspended.has(id) ||
      !profile.records.some((record) => record.id === id && record.enabled)
    )
      return;
    const relay = this.window(profile, id, false);
    profile.relays.set(id, relay);
    profile.bridge.setStorageRelay(id, relay.webContents);
    relay.webContents.on('render-process-gone', () => {
      this.stopRelay(profile, id);
      const count = (profile.repairs.get(id) ?? 0) + 1;
      profile.repairs.set(id, count);
      if (count > 3) {
        profile.errors.set(id, 'Extension storage events stopped. Try Reinstall.');
        return;
      }
      setTimeout(() => {
        void this.startRelay(profile, id).catch(() =>
          profile.errors.set(id, 'Extension storage events are unavailable.'),
        );
      }, 250);
    });
    try {
      await relay.loadURL(`chrome-extension://${id}/${relayPage}?korusStorageRelay=1`);
    } catch (error) {
      this.stopRelay(profile, id);
      throw error;
    }
  }
  private async clearData(agentId: string, profile: Profile, record: BrowserExtensionPackage): Promise<void> {
    const cleanup = await this.options.request(agentId, {
      action: 'cleanup',
      id: record.id,
    });
    if (!cleanup.cleanupPath) throw new Error('Extension cleanup is unavailable.');
    profile.suspended.add(record.id);
    let window: BrowserWindow | undefined;
    try {
      this.closeWindows(profile, record.id);
      this.stopRelay(profile, record.id);
      profile.session.extensions.removeExtension(record.id);
      const deadline = Date.now() + 5000;
      while (
        Object.values(profile.session.serviceWorkers.getAllRunning()).some((worker) =>
          worker.scope.startsWith(`chrome-extension://${record.id}/`),
        )
      ) {
        if (Date.now() > deadline) throw new Error('Extension is still stopping. Try Remove again.');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await profile.session.extensions.loadExtension(cleanup.cleanupPath, {
        allowFileAccess: false,
      });
      window = this.window(profile, record.id, false);
      await window.loadURL(`chrome-extension://${record.id}/cleanup.html`);
      const cleared = await window.webContents.executeJavaScript(`(async () => {
        const invoke = (area, method, ...args) => new Promise((resolve, reject) => area[method](...args, value => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(value)));
        await invoke(chrome.storage.local, 'clear');
        if (chrome.storage.session) await invoke(chrome.storage.session, 'clear');
        return Object.keys(await invoke(chrome.storage.local, 'get', null)).length === 0;
      })()`);
      if (!cleared) throw new Error('Extension data could not be completely cleared. Try Remove again.');
    } finally {
      if (window && !window.isDestroyed()) window.destroy();
      profile.session.extensions.removeExtension(record.id);
      profile.suspended.delete(record.id);
    }
    await profile.session.clearStorageData({
      origin: `chrome-extension://${record.id}`,
      storages: ['indexdb', 'localstorage', 'serviceworkers', 'cachestorage', 'filesystem'],
    });
    profile.session.flushStorageData();
  }
  private confirmPermissions(name: string, permissions: string[], action: string): Promise<boolean> {
    const message = action === 'Allow' ? `Allow more access for ${name}?` : `${action} ${name}?`;
    const detail = `${name} requests additional access to:\n\n${extensionPermissionSummary(permissions)}\n\nThis applies to this agent’s browser. Agents using it can interact with pages you sign into.`;
    return this.confirm(message, detail, action, permissions.join('\n'));
  }
  private async confirm(message: string, detail: string, action = 'Continue', permissions?: string): Promise<boolean> {
    if (this.options.confirm) return this.options.confirm(message, detail);
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      message,
      detail,
      buttons: [action, 'Cancel', ...(permissions ? ['Permission details…'] : [])],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const parent = this.options.parent();
    const show = (input: Electron.MessageBoxOptions) =>
      parent ? dialog.showMessageBox(parent, input) : dialog.showMessageBox(input);
    while (true) {
      const { response } = await show(options);
      if (response !== 2 || !permissions) return response === 0;
      await show({
        type: 'info',
        message: 'Requested permissions',
        detail: permissions,
        buttons: ['Back'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
    }
  }
}
