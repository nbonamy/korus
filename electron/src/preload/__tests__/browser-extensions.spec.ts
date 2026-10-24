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
