import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import { BrowserExtensions } from '../browser-extensions';

// Lifecycle failure: a passive hidden relay must not count as vendor setup.
// Setup must open once after install, using the vendor route when supplied.
const host = vi.hoisted(() => ({
  windows: [] as any[],
  loaded: new Map<string, any>(),
  session: null as any,
  showMessageBox: vi.fn(),
}));
vi.mock('../browser-extension-bridge', () => ({
  BrowserExtensionBridge: class {
    attachTab() {}
    selectTab() {}
    setStorageRelay() {}
    dispose() {}
  },
}));
vi.mock('electron', () => ({
  session: { fromPartition: () => host.session },
  dialog: { showMessageBox: host.showMessageBox },
  BrowserWindow: class extends EventEmitter {
    visible: boolean;
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler() {},
      getURL: () => this.url,
      executeJavaScript: vi.fn(async () => true),
    });
    url = '';
    constructor(public options: { show: boolean; width: number; height: number; useContentSize?: boolean }) {
      super();
      this.visible = options.show;
      host.windows.push(this);
    }
    async loadURL(url: string) {
      this.url = url;
    }
    isVisible() {
      return this.visible;
    }
    show() {
      this.visible = true;
    }
    focus() {}
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  },
}));
beforeEach(() => {
  host.windows.length = 0;
  host.loaded.clear();
  host.showMessageBox.mockReset().mockResolvedValue({ response: 0 });
  host.session = {
    serviceWorkers: { getAllRunning: () => ({}) },
    clearStorageData: vi.fn(async () => {}),
    flushStorageData: vi.fn(),
    extensions: Object.assign(new EventEmitter(), {
      getExtension: (id: string) => host.loaded.get(id),
      loadExtension: async (path: string) => {
        const extension = {
          id: path,
          path,
          manifest: { action: { default_popup: 'popup.html' } },
        };
        host.loaded.set(path, extension);
        return extension;
      },
      removeExtension: (id: string) => host.loaded.delete(id),
    }),
  };
});

// State transitions can lose a working installation on failed/cancelled update,
// unload another manager, retain injected scripts after disable, or leave cleanup
// contexts alive. Exercise those boundaries through the desktop lifecycle seam.
it('preserves other extensions across update failure, disable, repair, and scoped removal', async () => {
  const catalog = [
    { id: 'first', name: 'First', storageRelayPage: 'relay.html' },
    { id: 'second', name: 'Second' },
  ];
  let records = catalog.map(({ id, name }) => ({
    id,
    name,
    enabled: true,
    permissions: ['storage'],
    version: '1',
    path: id,
  }));
  let version = '2',
    fail = false,
    approve = true;
  const request = vi.fn(async (input: any): Promise<any> => {
    if (input.action === 'prepare') {
      if (fail) throw new Error('Verification failed');
      return {
        extensions: records,
        candidate: {
          token: input.id,
          id: input.id,
          version,
          permissions: ['storage', 'tabs', 'clipboardRead', 'clipboardWrite', 'https://*/*', 'http://*/*'],
          addedPermissions: ['tabs', 'clipboardRead', 'clipboardWrite', 'https://*/*', 'http://*/*'],
        },
      };
    }
    if (input.action === 'commit')
      records = records.map((record) => (record.id === input.token ? { ...record, version } : record));
    if (input.action === 'enabled')
      records = records.map((record) => (record.id === input.id ? { ...record, enabled: input.enabled } : record));
    if (input.action === 'remove') records = records.filter((record) => record.id !== input.id);
    return {
      extensions: records,
      ...(input.action === 'cleanup' ? { cleanupPath: input.id } : {}),
    };
  });
  const runtime = new BrowserExtensions({
    catalog,
    parent: () => null,
    request,
  });
  host.showMessageBox.mockImplementation(async () => ({ response: approve ? 0 : 1 }));
  await runtime.manage('agent', 'list');
  const contents = {
    session: host.session,
    isDestroyed: () => false,
    reload: vi.fn(),
  };
  await runtime.attachGuest('agent', 'primary', contents as never, {} as never);
  const secondContents = { ...contents, reload: vi.fn() };
  await runtime.attachGuest('other-agent', 'primary', secondContents as never, {} as never);
  await runtime.manage('other-agent', 'open', 'second');
  const otherWindow = host.windows.find((window) => window.url.endsWith('second/popup.html'));
  fail = true;
  await expect(runtime.manage('agent', 'update', 'first')).rejects.toThrow('Verification failed');
  expect((await runtime.manage('agent', 'list')).extensions[0].version).toBe('1');
  fail = false;
  approve = false;
  await runtime.manage('agent', 'update', 'first');
  expect(request.mock.calls.some(([input]) => input.action === 'cancel')).toBe(true);
  expect((await runtime.manage('agent', 'list')).extensions[0].version).toBe('1');
  approve = true;
  host.showMessageBox.mockResolvedValueOnce({ response: 2 }).mockImplementationOnce(async () => {
    expect(records[0].version).toBe('1');
    return { response: 0 };
  });
  const dialogCount = host.showMessageBox.mock.calls.length;
  const updated = await runtime.manage('agent', 'update', 'first');
  expect(updated.message).toBeUndefined();
  const consent = host.showMessageBox.mock.calls[dialogCount][0];
  expect(consent).toMatchObject({
    message: 'Update First?',
    buttons: ['Update', 'Cancel', 'Permission details…'],
    defaultId: 1,
    cancelId: 1,
  });
  expect(consent.detail).toContain('Read and change data on all websites');
  expect(consent.detail).toContain('Read and change your clipboard');
  expect(consent.detail).not.toContain('clipboardRead');
  expect(consent.detail).not.toContain('Store extension data');
  expect(host.showMessageBox.mock.calls[dialogCount + 1][0].detail).toContain('clipboardRead');
  expect(host.showMessageBox.mock.calls[dialogCount + 1][0].buttons).toEqual(['Back']);
  expect(host.showMessageBox.mock.calls[dialogCount + 2][0]).toEqual(consent);
  expect((await runtime.manage('agent', 'list')).extensions[0].version).toBe('2');
  expect(otherWindow.destroyed).toBe(false);
  expect(contents.reload).toHaveBeenCalledOnce();
  expect(secondContents.reload).toHaveBeenCalledOnce();
  expect((await runtime.manage('agent', 'update', 'first')).message).toBe('Already up to date.');
  version = '3';
  vi.spyOn(host.session.extensions, 'loadExtension').mockRejectedValueOnce(new Error('Unsupported runtime API'));
  const broken = (await runtime.manage('agent', 'update', 'first')).extensions.find(
    (extension) => extension.id === 'first',
  );
  expect(broken).toMatchObject({
    version: '3',
    enabled: true,
    error: expect.stringContaining('Could not start'),
  });
  expect(otherWindow.destroyed).toBe(false);
  const repaired = (await runtime.manage('agent', 'reinstall', 'first')).extensions.find(
    (extension) => extension.id === 'first',
  );
  expect(repaired?.error).toBeUndefined();
  expect(host.loaded.has('first')).toBe(true);
  await runtime.manage('agent', 'disable', 'first');
  expect(host.loaded.has('first')).toBe(false);
  expect(host.windows.some((window) => !window.destroyed && window.url.includes('korusStorageRelay'))).toBe(false);
  await expect(runtime.manage('agent', 'open', 'first')).rejects.toThrow(/Enable/);
  await runtime.manage('agent', 'enable', 'first');
  expect(host.loaded.has('first')).toBe(true);
  await runtime.manage('agent', 'reinstall', 'first');
  approve = false;
  await runtime.manage('agent', 'remove', 'first');
  expect(host.loaded.has('first')).toBe(true);
  approve = true;
  vi.spyOn(host.session.extensions, 'loadExtension').mockRejectedValueOnce(new Error('Cleanup unavailable'));
  await expect(runtime.manage('agent', 'remove', 'first')).rejects.toThrow('Cleanup unavailable');
  await runtime.manage('agent', 'reinstall', 'first');
  expect(host.windows.some((window) => !window.destroyed && window.url.includes('korusStorageRelay'))).toBe(true);
  const removed = await runtime.manage('agent', 'remove', 'first');
  expect(removed.message).toBeUndefined();
  expect(host.loaded.has('first')).toBe(false);
  expect(host.loaded.has('second')).toBe(true);
  expect(otherWindow.destroyed).toBe(false);
  expect(host.session.clearStorageData).toHaveBeenCalledWith(
    expect.objectContaining({ origin: 'chrome-extension://first' }),
  );
  expect(host.windows.filter((window) => !window.destroyed).map((window) => window.url)).toEqual([
    'chrome-extension://second/popup.html',
  ]);
  await expect(runtime.manage('agent', 'open', 'unknown')).rejects.toThrow(/Unsupported/);
  await runtime.dispose();
  expect(otherWindow.destroyed).toBe(true);
});
it('opens visible vendor setup after install alongside a passive relay', async () => {
  const catalog = [
    { id: 'first', name: 'First', storageRelayPage: 'relay.html' },
    { id: 'second', name: 'Second', setupPage: 'app.html#/welcome' },
  ];
  let records = catalog.map(({ id, name }) => ({
    id,
    name,
    enabled: false,
    permissions: [] as string[],
    version: undefined as string | undefined,
    path: undefined as string | undefined,
  }));
  let candidate = '';
  const runtime = new BrowserExtensions({
    catalog,
    parent: () => null,
    request: async (input) => {
      if (input.action === 'prepare') {
        candidate = input.id;
        return {
          extensions: records,
          candidate: {
            token: candidate,
            id: candidate,
            version: '1',
            permissions: ['storage', 'tabs', 'clipboardRead', 'clipboardWrite', 'https://*/*', 'http://*/*'],
            addedPermissions: ['storage', 'tabs', 'clipboardRead', 'clipboardWrite', 'https://*/*', 'http://*/*'],
          },
        };
      }
      if (input.action === 'commit')
        records = records.map((record) =>
          record.id === candidate ? { ...record, enabled: true, version: '1', path: candidate } : record,
        );
      return { extensions: records };
    },
  });
  await runtime.manage('agent', 'install', 'first');
  expect(host.showMessageBox).not.toHaveBeenCalled();
  const popup = host.windows.find(window => window.isVisible());
  expect(popup.options).toMatchObject({ width: 480, height: 760, useContentSize: true });
  expect(host.windows.filter((window) => window.isVisible()).map((window) => window.url)).toEqual([
    'chrome-extension://first/popup.html',
  ]);
  await runtime.manage('agent', 'install', 'second');
  expect(host.windows.filter((window) => window.isVisible()).map((window) => window.url)).toContain(
    'chrome-extension://second/app.html#/welcome',
  );
});
