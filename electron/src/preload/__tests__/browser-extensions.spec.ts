import { afterEach, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({
  call: vi.fn(async (_channel: string, _operation: string, _args: unknown[]): Promise<any> => ({ ok: true })),
  listeners: [] as Function[],
}));
vi.mock('electron', () => ({
  ipcRenderer: { on: (_channel: string, listener: Function) => host.listeners.push(listener), invoke: host.call },
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => {
      (globalThis as any)[name] = value;
    },
    executeInMainWorld: ({ func, args = [] }: { func: (...args: any[]) => void; args?: any[] }) => func(...args),
  },
}));
afterEach(() => {
  host.listeners.length = 0;
  host.call.mockReset().mockResolvedValue({ ok: true });
  vi.unstubAllGlobals();
  delete (process as any).type;
  vi.resetModules();
});
it('preserves native worker storage delivery for an extension without a relay', async () => {
  // Replacing native events without a relay leaves sign-in promises waiting.
  const callbacks: Function[] = [];
  const nativeEvent = { addListener: (callback: Function) => callbacks.push(callback) };
  vi.stubGlobal('chrome', {
    runtime: { id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa' },
    storage: { onChanged: nativeEvent, local: { onChanged: nativeEvent } },
  });
  Object.defineProperty(process, 'type', { configurable: true, value: 'service-worker' });
  await import('../browser-extensions');
  const listener = vi.fn();
  (globalThis as any).chrome.storage.onChanged.addListener(listener);
  for (const callback of callbacks) callback({ ownedMarker: { newValue: true } }, 'local');
  expect(listener).toHaveBeenCalledWith({ ownedMarker: { newValue: true } }, 'local');
});

it('enumerates accessible page frames when an embedded extension frame denies document identity injection', async () => {
  // Frame metadata must survive denied injection or a disappearing document;
  // available native IDs must stay authoritative and host failures must reject.
  const frames = [
    { frameId: 0, parentFrameId: -1, url: 'https://example.test/login' },
    { frameId: 8, parentFrameId: 0, url: 'chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/inline/menu/menu.html' },
    { frameId: 9, parentFrameId: 0, url: 'about:blank' },
  ];
  let documentId = 'native-document-one';
  vi.stubGlobal('chrome', {
    runtime: { id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa' },
    scripting: { executeScript: vi.fn(async ({ target }: { target: { frameIds: number[] } }) => {
      if (target.frameIds[0] === 8) throw new Error('Cannot access contents of url.');
      return target.frameIds[0] === 9 ? [] : [{ documentId }];
    }) },
  });
  vi.stubGlobal('browser', { runtime: {} });
  Object.defineProperty(process, 'type', { configurable: true, value: 'service-worker' });
  host.call.mockImplementation(async (_channel, operation, args) => ({ ok: true, value: operation.endsWith('getAllFrames') ? frames : frames.find(frame => frame.frameId === (args[0] as any).frameId) ?? null }));
  await import('../browser-extensions');
  const navigation = (globalThis as any).browser.webNavigation;
  expect(await navigation.getAllFrames({ tabId: 3 })).toStrictEqual([
    { ...frames[0], documentId }, frames[1], frames[2],
  ]);
  const callback = vi.fn();
  navigation.getAllFrames({ tabId: 3 }, callback);
  await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith([
    { ...frames[0], documentId }, frames[1], frames[2],
  ]));
  documentId = 'native-document-after-reload';
  expect(await navigation.getFrame({ tabId: 3, frameId: 0 })).toStrictEqual({ ...frames[0], documentId });
  expect(await navigation.getFrame({ tabId: 3, frameId: 8 })).toStrictEqual(frames[1]);
  expect(await navigation.getFrame({ tabId: 3, frameId: 99 })).toBeNull();
  host.call.mockResolvedValue({ ok: false, error: 'webNavigation permission is required.' });
  await expect(navigation.getAllFrames({ tabId: 3 })).rejects.toThrow('permission');
});

it('delivers Bitwarden root and area storage changes through both namespaces', async () => {
  const nativeEvent = { addListener: vi.fn() };
  vi.stubGlobal('chrome', { runtime: { id: 'nngceckbapebfimnlniiiahkandclblb' }, storage: { onChanged: nativeEvent, local: { onChanged: nativeEvent }, session: { onChanged: nativeEvent } } });
  vi.stubGlobal('browser', { runtime: {}, storage: { onChanged: nativeEvent, local: { onChanged: nativeEvent }, session: { onChanged: nativeEvent } } });
  Object.defineProperty(process, 'type', { configurable: true, value: 'service-worker' });
  await import('../browser-extensions');
  const chrome = (globalThis as any).chrome, browser = (globalThis as any).browser;
  const root = vi.fn(), local = vi.fn(), session = vi.fn();
  browser.storage.onChanged.addListener(root);
  browser.storage.local.onChanged.addListener(local);
  browser.storage.session.onChanged.addListener(session);
  expect(host.call).toHaveBeenCalledWith('browser-extension:call', 'subscribe', ['storage.local.onChanged']);
  expect(browser.storage).toBe(chrome.storage);
  const changes = { ownedMarker: { newValue: true } };
  for (const listener of host.listeners) {
    listener({}, 'storage.onChanged', [changes, 'local']);
    listener({}, 'storage.local.onChanged', [changes]);
    listener({}, 'storage.session.onChanged', [changes]);
  }
  expect(root).toHaveBeenCalledExactlyOnceWith(changes, 'local');
  expect(local).toHaveBeenCalledExactlyOnceWith(changes);
  expect(session).toHaveBeenCalledExactlyOnceWith(changes);
});

it('shares namespace consent and delivers native ports and callback failures without swallowing errors', async () => {
  vi.stubGlobal('chrome', { runtime: { id: 'nngceckbapebfimnlniiiahkandclblb' } });
  vi.stubGlobal('browser', { runtime: {} });
  Object.defineProperty(process, 'type', { configurable: true, value: 'service-worker' });
  host.call.mockImplementation(async (_channel, operation, args) => {
    if (operation === 'permissions.request') return { ok: true, value: true };
    if (operation === 'runtime.nativePostMessage')
      for (const listener of host.listeners) listener({}, 'native.message', [args[0], args[1]]);
    return { ok: true };
  });
  await import('../browser-extensions');
  const chrome = (globalThis as any).chrome,
    browser = (globalThis as any).browser;
  expect(browser.permissions).toBe(chrome.permissions);
  expect(await browser.permissions.request({ permissions: ['nativeMessaging'] })).toBe(true);
  expect(host.call).toHaveBeenCalledWith('browser-extension:call', 'permissions.request', [
    { permissions: ['nativeMessaging'] },
  ]);
  expect(browser.runtime.connectNative).toBe(chrome.runtime.connectNative);
  const port = browser.runtime.connectNative('com.8bit.bitwarden');
  const message = vi.fn();
  port.onMessage.addListener(message);
  port.postMessage({ text: 'owned é 🔐' });
  await vi.waitFor(() => expect(message).toHaveBeenCalledWith({ text: 'owned é 🔐' }, port));
  port.disconnect();
  await vi.waitFor(() =>
    expect(host.call.mock.calls.some(([, operation]) => operation === 'runtime.disconnectNative')).toBe(true),
  );
  host.call.mockResolvedValue({ ok: false, error: 'Native messaging permission is required.' });
  await expect(browser.runtime.sendNativeMessage('com.8bit.bitwarden', {})).rejects.toThrow(/permission/);
  const callback = vi.fn(() => expect(chrome.runtime.lastError.message).toContain('permission'));
  chrome.runtime.sendNativeMessage('com.8bit.bitwarden', {}, callback);
  await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(undefined));
  expect(chrome.runtime.lastError).toBeUndefined();
});
