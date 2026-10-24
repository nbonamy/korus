import { afterEach, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ call: vi.fn(async () => ({ ok: true })) }));
vi.mock('electron', () => ({
  ipcRenderer: { on() {}, invoke: host.call },
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => {
      (globalThis as any)[name] = value;
    },
    executeInMainWorld: ({ func, args = [] }: { func: (...args: any[]) => void; args?: any[] }) => func(...args),
  },
}));
afterEach(() => {
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
