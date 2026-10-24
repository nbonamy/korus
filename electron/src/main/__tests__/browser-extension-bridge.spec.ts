import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BrowserExtensionBridge } from '../browser-extension-bridge';
const native = vi.hoisted(() => ({ notifications: [] as any[] }));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
  Notification: class extends EventEmitter {
    static isSupported() {
      return true;
    }
    show = vi.fn();
    close = vi.fn(() => this.emit('close'));
    constructor() {
      super();
      native.notifications.push(this);
    }
  },
}));

// The bridge owns sender identity, optional grants and scoped tab visibility.
// Exercising its IPC dispatch protects these boundaries without running a vault.
describe('Korus extension bridge', () => {
  it('requires native consent and isolates framed native ports through revoke and unload', async () => {
    // Protect UTF-8 framing, split/coalesced replies, profile/context isolation,
    // refusal before consent, oversized input and lifetime cleanup at the IPC seam.
    vi.stubEnv('KORUS_NATIVE_TEST_SECRET', 'owned-test-marker');
    const root = await mkdtemp(path.join(tmpdir(), 'extension-native-echo-'));
    const executable = path.join(root, 'echo.cjs');
    await writeFile(
      executable,
      `#!${process.execPath}
const frame = value => { const bytes = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length); return Buffer.concat([header, bytes]); };
let pending = Buffer.alloc(0);
process.stdin.on('data', chunk => { pending = Buffer.concat([pending, chunk]); while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE(0)) { const size = pending.readUInt32LE(0); const value = JSON.parse(pending.subarray(4, size + 4)); pending = pending.subarray(size + 4); if (value.oversize) { const header = Buffer.alloc(4); header.writeUInt32LE(2 * 1024 * 1024); process.stdout.write(header); } else { const reply = Buffer.concat([frame(value.envProbe ? { leaked: Boolean(process.env.KORUS_NATIVE_TEST_SECRET), origin: process.argv[2] } : value), frame({ marker: 'second' })]); process.stdout.write(reply.subarray(0, 3)); setTimeout(() => process.stdout.write(reply.subarray(3)), 5); } } });`,
      { mode: 0o700 },
    );
    const id = 'nngceckbapebfimnlniiiahkandclblb';
    const record = {
      id,
      name: 'Bitwarden',
      enabled: true,
      permissions: [] as string[],
      optionalPermissions: ['nativeMessaging'],
    };
    const session = {
      extensions: new EventEmitter(),
      serviceWorkers: new EventEmitter(),
      registerPreloadScript: vi.fn(),
    };
    let allow = false,
      consentRequests = 0;
    const resolveHost = vi.fn(async (_id: string, host: string) => {
      if (host !== 'com.8bit.bitwarden') throw new Error('Unsupported native host.');
      return { name: host, path: executable };
    });
    const bridge = new BrowserExtensionBridge(
      session as never,
      '/preload.cjs',
      () => [record],
      async (_id, permissions, remove) => {
        if (!remove) consentRequests++;
        if (!remove && !allow) return false;
        record.permissions = remove ? [] : [...permissions];
        return true;
      },
      undefined,
      resolveHost,
    );
    const frame = { url: `chrome-extension://${id}/popup.html`, origin: `chrome-extension://${id}`, send: vi.fn() };
    const sender = { sender: Object.assign(new EventEmitter(), { session }), senderFrame: frame };
    const request = (operation: string, ...args: unknown[]) => bridge.dispatch(sender as never, operation, args);
    try {
      expect(await request('runtime.connectNative', 'owned', 'com.8bit.bitwarden')).toMatchObject({ ok: false });
      expect(resolveHost).not.toHaveBeenCalled();
      expect(await request('permissions.request', { permissions: ['nativeMessaging'] })).toEqual({
        ok: true,
        value: false,
      });
      allow = true;
      expect(await request('permissions.request', { permissions: ['nativeMessaging'] })).toEqual({
        ok: true,
        value: true,
      });
      expect(await request('permissions.contains', { permissions: ['nativeMessaging'] })).toEqual({
        ok: true,
        value: true,
      });
      await request('permissions.request', { permissions: ['nativeMessaging'] });
      expect(consentRequests).toBe(2);
      expect(
        await bridge.dispatch(
          { ...sender, senderFrame: { ...frame, origin: 'null' } } as never,
          'runtime.connectNative',
          ['sandbox', 'com.8bit.bitwarden'],
        ),
      ).toMatchObject({ ok: false });
      expect(await request('runtime.connectNative', 'owned', 'arbitrary')).toMatchObject({ ok: false });
      expect(await request('runtime.connectNative', 'owned', 'com.8bit.bitwarden')).toEqual({
        ok: true,
        value: undefined,
      });
      const value = { text: 'owned café 🔐' };
      expect(await request('runtime.nativePostMessage', 'owned', value)).toMatchObject({ ok: true });
      await vi.waitFor(() =>
        expect(frame.send).toHaveBeenCalledWith('browser-extension:event', 'native.message', ['owned', value]),
      );
      expect(frame.send).toHaveBeenCalledWith('browser-extension:event', 'native.message', [
        'owned',
        { marker: 'second' },
      ]);
      const otherFrame = { ...frame, send: vi.fn() };
      expect(
        await bridge.dispatch({ ...sender, senderFrame: otherFrame } as never, 'runtime.nativePostMessage', [
          'owned',
          value,
        ]),
      ).toMatchObject({ ok: false });
      expect(await request('runtime.sendNativeMessage', 'com.8bit.bitwarden', value)).toEqual({ ok: true, value });
      expect(await request('runtime.sendNativeMessage', 'com.8bit.bitwarden', { envProbe: true })).toEqual({
        ok: true,
        value: { leaked: false, origin: `chrome-extension://${id}/` },
      });
      await request('permissions.remove', { permissions: ['nativeMessaging'] });
      expect(await request('runtime.nativePostMessage', 'owned', value)).toMatchObject({ ok: false });
      await vi.waitFor(() =>
        expect(frame.send).toHaveBeenCalledWith('browser-extension:event', 'native.disconnected', [
          'owned',
          expect.any(String),
        ]),
      );
      await request('permissions.request', { permissions: ['nativeMessaging'] });
      await request('runtime.connectNative', 'malformed', 'com.8bit.bitwarden');
      await request('runtime.nativePostMessage', 'malformed', { oversize: true });
      await vi.waitFor(() =>
        expect(frame.send).toHaveBeenCalledWith('browser-extension:event', 'native.disconnected', [
          'malformed',
          expect.any(String),
        ]),
      );
      const worker = { scope: `chrome-extension://${id}/`, versionId: 7, send: vi.fn() };
      const workerSender = { session, serviceWorker: worker };
      await bridge.dispatch(workerSender as never, 'runtime.connectNative', ['worker', 'com.8bit.bitwarden']);
      session.serviceWorkers.emit('running-status-changed', { runningStatus: 'stopped', versionId: 7 });
      expect(
        await bridge.dispatch(workerSender as never, 'runtime.nativePostMessage', ['worker', value]),
      ).toMatchObject({ ok: false });
      await request('runtime.connectNative', 'unload', 'com.8bit.bitwarden');
      session.extensions.emit('extension-unloaded', {}, { id });
      expect(await request('runtime.nativePostMessage', 'unload', value)).toMatchObject({ ok: false });
    } finally {
      bridge.dispose();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('requires a notification grant and closes native notifications on extension unload', async () => {
    const id = 'aeblfdkhhhdcdjpifhhbdiojplfjncoa';
    const record = { id, name: '1Password', enabled: true, permissions: [] as string[] };
    const session = {
      extensions: new EventEmitter(),
      serviceWorkers: new EventEmitter(),
      registerPreloadScript: vi.fn(),
    };
    const bridge = new BrowserExtensionBridge(
      session as never,
      '/preload.cjs',
      () => [record],
      async () => false,
    );
    const frame = { url: `chrome-extension://${id}/popup.html`, origin: `chrome-extension://${id}`, send: vi.fn() };
    const request = (operation: string, ...args: unknown[]) =>
      bridge.dispatch({ sender: { session }, senderFrame: frame } as never, operation, args);
    expect(await request('notifications.create', 'owned', { title: 'Owned test' })).toMatchObject({ ok: false });
    record.permissions.push('notifications');
    await request('subscribe', 'notifications.onClicked');
    expect(await request('notifications.getPermissionLevel')).toEqual({ ok: true, value: 'granted' });
    expect(await request('notifications.create', 'owned', { title: 'Owned test', message: 'No account data' })).toEqual(
      { ok: true, value: 'owned' },
    );
    const notification = native.notifications.at(-1);
    expect(notification.show).toHaveBeenCalledOnce();
    notification.emit('click');
    expect(frame.send).toHaveBeenCalledWith('browser-extension:event', 'notifications.onClicked', ['owned']);
    expect(await request('notifications.getAll')).toEqual({ ok: true, value: { owned: true } });
    expect(await request('notifications.update', 'missing', {})).toEqual({ ok: true, value: false });
    expect(await request('notifications.clear', 'owned')).toEqual({ ok: true, value: true });
    expect(notification.close).toHaveBeenCalledOnce();
    await request('notifications.create', 'remaining', {});
    const remaining = native.notifications.at(-1);
    session.extensions.emit('extension-unloaded', {}, { id });
    expect(remaining.close).toHaveBeenCalledOnce();
    expect(await request('notifications.getAll')).toEqual({ ok: true, value: {} });
  });
  it('routes tab navigation and storage events only within the owning browser profile', async () => {
    const id = 'nngceckbapebfimnlniiiahkandclblb';
    const record = {
      id,
      name: 'Bitwarden',
      enabled: true,
      permissions: ['tabs', 'webNavigation', 'privacy'],
      optionalPermissions: ['tabs'],
    };
    const session = {
      extensions: Object.assign(new EventEmitter(), {
        getExtension: () => ({ id, manifest: { options_ui: { page: 'options.html' } } }),
      }),
      serviceWorkers: new EventEmitter(),
      registerPreloadScript: vi.fn(),
    };
    const window = {
      id: 1,
      isDestroyed: () => false,
      isFocused: () => true,
      isFullScreen: () => false,
      isMaximized: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      show: vi.fn(),
    };
    const tab = (id: number, initial: string) => {
      let url = initial;
      const frame: any = { url, frameTreeNodeId: id * 10, parent: null };
      frame.top = frame;
      frame.framesInSubtree = [frame];
      return Object.assign(new EventEmitter(), {
        id,
        session,
        mainFrame: frame,
        isDestroyed: () => false,
        isLoading: () => false,
        getURL: () => url,
        getTitle: () => 'Owned page',
        loadURL: vi.fn(async (value: string) => {
          url = value;
        }),
        reload: vi.fn(),
        close: vi.fn(),
        focus: vi.fn(),
      });
    };
    const first = tab(11, 'https://example.test/login'),
      second = tab(12, 'https://other.test/');
    const open = vi.fn(async (_id, url: string) => {
      const created = tab(13, url);
      bridge.attachTab(created as never, window as never);
      return created as never;
    });
    const bridge = new BrowserExtensionBridge(
      session as never,
      '/preload.cjs',
      () => [record],
      async () => true,
      open,
    );
    bridge.attachTab(first as never, window as never);
    bridge.attachTab(second as never, window as never);
    bridge.selectTab(first.id);
    const frame = { url: `chrome-extension://${id}/popup.html`, origin: `chrome-extension://${id}`, send: vi.fn() };
    const sender = { sender: first, senderFrame: frame };
    const request = (operation: string, ...args: unknown[]) => bridge.dispatch(sender as never, operation, args);
    expect(await request('tabs.query', { active: true, windowId: 1, url: ['https://example.test/*'] })).toMatchObject({
      ok: true,
      value: [{ id: 11, url: 'https://example.test/login' }],
    });
    expect(await request('tabs.getCurrent')).toMatchObject({ ok: true, value: { id: 11 } });
    expect(await request('tabs.get', 12)).toMatchObject({ ok: true, value: { id: 12 } });
    expect(await request('tabs.get', 99)).toMatchObject({ ok: false });
    expect(await request('tabs.update', 11, { url: 'file:///private/test' })).toMatchObject({ ok: false });
    expect(await request('tabs.update', 11, { url: 'https://example.test/changed', active: true })).toMatchObject({
      ok: true,
      value: { active: true, url: 'https://example.test/changed' },
    });
    expect(first.loadURL).toHaveBeenCalledWith('https://example.test/changed');
    await request('tabs.reload', 11);
    expect(first.reload).toHaveBeenCalledOnce();
    await request('tabs.remove', 12);
    expect(second.close).toHaveBeenCalledOnce();
    expect(await request('tabs.create', { url: 'https://example.test/setup' })).toMatchObject({
      ok: true,
      value: { id: 13 },
    });
    expect(await request('windows.getAll', { populate: true })).toMatchObject({
      ok: true,
      value: [{ id: 1, tabs: expect.arrayContaining([expect.objectContaining({ id: 11 })]) }],
    });
    expect(await request('windows.getCurrent')).toMatchObject({ ok: true, value: { id: 1 } });
    expect(await request('windows.get', 1)).toMatchObject({ ok: true, value: { id: 1 } });
    expect(await request('windows.get', 99)).toMatchObject({ ok: false });
    expect(await request('windows.create', { url: 'https://example.test/new' })).toMatchObject({
      ok: true,
      value: { id: 1 },
    });
    await request('runtime.openOptionsPage');
    expect(open).toHaveBeenLastCalledWith(id, `chrome-extension://${id}/options.html`, true);
    expect(await request('action.getUserSettings')).toEqual({ ok: true, value: { isOnToolbar: true } });
    expect(await request('privacy.services.passwordSavingEnabled.get', {})).toEqual({
      ok: true,
      value: { value: false, levelOfControl: 'not_controllable' },
    });
    expect(await request('privacy.services.autofillEnabled.set', { value: false })).toMatchObject({ ok: true });
    expect(await request('privacy.services.autofillEnabled.set', { value: true })).toMatchObject({ ok: false });
    expect(await request('webNavigation.getAllFrames', { tabId: 11 })).toMatchObject({
      ok: true,
      value: [{ frameId: 0, url: 'https://example.test/login' }],
    });
    expect(await request('webNavigation.getFrame', { tabId: 11, frameId: 0 })).toMatchObject({
      ok: true,
      value: { frameId: 0 },
    });
    expect(await request('webNavigation.getAllFrames', { tabId: 99 })).toEqual({ ok: true, value: [] });
    await request('subscribe', 'tabs.onUpdated');
    await request('subscribe', 'webNavigation.onCompleted');
    first.emit('did-start-loading');
    first.emit('did-stop-loading');
    first.emit('did-finish-load');
    expect(frame.send).toHaveBeenCalledWith('browser-extension:event', 'tabs.onUpdated', [
      11,
      { status: 'complete' },
      expect.objectContaining({ url: 'https://example.test/changed' }),
    ]);
    record.permissions = [];
    expect(await request('privacy.services.passwordSavingEnabled.get', {})).toMatchObject({ ok: false });
    frame.send.mockClear();
    first.emit('did-stop-loading');
    first.emit('did-finish-load');
    expect(frame.send).toHaveBeenCalledTimes(1);
    expect(frame.send.mock.calls[0][2][2]).not.toHaveProperty('url');
    expect(await request('webNavigation.getFrame', { tabId: 11, frameId: 0 })).toMatchObject({ ok: false });
    await request('subscribe', 'storage.onChanged');
    await request('subscribe', 'storage.local.onChanged');
    expect(await request('relay.storage', {}, 'local')).toMatchObject({ ok: false });
    bridge.setStorageRelay(id, first as never);
    frame.send.mockClear();
    expect(await request('relay.storage', { ownedMarker: { newValue: true } }, 'local')).toMatchObject({ ok: true });
    expect(frame.send.mock.calls.map((call) => call[1])).toEqual(['storage.onChanged', 'storage.local.onChanged']);
    bridge.forgetExtension(id);
    frame.send.mockClear();
    first.emit('did-stop-loading');
    expect(frame.send).not.toHaveBeenCalled();
    first.emit('destroyed');
    expect(await request('tabs.get', 11)).toMatchObject({ ok: false });
    bridge.dispose();
  });
  it('releases a worker keepalive when the extension is unloaded', () => {
    const end = vi.fn(),
      id = 'nngceckbapebfimnlniiiahkandclblb';
    const worker = {
      scope: `chrome-extension://${id}/`,
      versionId: 7,
      ipc: { handle: vi.fn() },
      startTask: vi.fn(() => ({ end })),
    };
    const workers = Object.assign(new EventEmitter(), { getWorkerFromVersionID: () => worker });
    const extensions = new EventEmitter();
    new BrowserExtensionBridge(
      { extensions, serviceWorkers: workers, registerPreloadScript: vi.fn() } as never,
      '/preload.cjs',
      () => [],
      async () => false,
    );
    workers.emit('running-status-changed', { runningStatus: 'starting', versionId: 7 });
    expect(worker.startTask).toHaveBeenCalledOnce();
    extensions.emit('extension-unloaded', {}, { id });
    expect(end).toHaveBeenCalledOnce();
  });
  it('uses sender identity, denies native hosts, and revokes optional grants', async () => {
    const id = 'nngceckbapebfimnlniiiahkandclblb';
    const record = {
      id,
      name: 'Bitwarden',
      enabled: true,
      permissions: ['storage', 'https://example.test/*'],
      optionalPermissions: ['tabs', 'clipboardRead', 'https://optional.test/*'],
    };
    const session = {
      extensions: Object.assign(new EventEmitter(), { getExtension: () => ({ id, manifest: {} }) }),
      serviceWorkers: new EventEmitter(),
      registerPreloadScript: vi.fn(),
    };
    const consent = vi.fn(async (_id, permissions: string[], remove: boolean) => {
      record.permissions = remove
        ? record.permissions.filter((p) => !permissions.includes(p))
        : [...record.permissions, ...permissions];
      return true;
    });
    const bridge = new BrowserExtensionBridge(session as never, '/preload.cjs', () => [record], consent);
    const sender = {
      type: 'frame',
      sender: { session },
      senderFrame: { url: `chrome-extension://${id}/popup.html`, origin: `chrome-extension://${id}`, send: vi.fn() },
    };
    expect(await bridge.dispatch(sender as never, 'permissions.contains', [{ permissions: ['tabs'] }])).toEqual({
      ok: true,
      value: false,
    });
    expect(await bridge.dispatch(sender as never, 'permissions.request', [{ permissions: ['clipboardRead'] }])).toEqual(
      { ok: true, value: false },
    );
    expect(
      await bridge.dispatch(sender as never, 'permissions.request', [{ origins: ['https://optional.test/*'] }]),
    ).toEqual({ ok: true, value: false });
    expect(await bridge.dispatch(sender as never, 'permissions.request', [{ permissions: ['tabs'] }])).toEqual({
      ok: true,
      value: true,
    });
    expect(await bridge.dispatch(sender as never, 'permissions.remove', [{ permissions: ['tabs'] }])).toEqual({
      ok: true,
      value: true,
    });
    expect(await bridge.dispatch(sender as never, 'permissions.contains', [{ permissions: ['tabs'] }])).toEqual({
      ok: true,
      value: false,
    });
    expect(await bridge.dispatch(sender as never, 'runtime.connectNative', ['anything'])).toMatchObject({ ok: false });
    expect(consent).toHaveBeenCalledTimes(2);
    expect(
      await bridge.dispatch({ ...sender, senderFrame: { url: 'https://example.test/' } } as never, 'tabs.query', [{}]),
    ).toMatchObject({ ok: false });
    record.enabled = false;
    expect(await bridge.dispatch(sender as never, 'tabs.query', [{}])).toMatchObject({ ok: false });
  });
});
