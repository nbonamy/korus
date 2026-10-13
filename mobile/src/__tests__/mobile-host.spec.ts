import { describe, expect, it, vi } from 'vitest';
import { createMobileHost } from '../mobile-host';

const native = vi.hoisted(() => ({ platform: 'web', addListener: vi.fn() }));
const scanner = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/barcode-scanner', () => ({ CapacitorBarcodeScanner: { scanBarcode: scanner }, CapacitorBarcodeScannerTypeHint: { QR_CODE: 0 } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => native.platform } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: native.addListener } }));

describe('mobile host lifecycle', () => {
  it('uses the native QR camera and forwards background/foreground without starting a speech service', async () => {
    native.platform = 'android'; scanner.mockResolvedValue({ ScanResult: 'invitation' });
    const host = createMobileHost();
    expect(await host.scanPairingCode!()).toBe('invitation');
    expect(scanner).toHaveBeenCalledWith(expect.objectContaining({ hint: 0 }));
    const remove = vi.fn(); let activity!: (state: { isActive: boolean }) => void;
    native.addListener.mockImplementation(async (_event, listener) => { activity = listener; return { remove }; });
    const changed = vi.fn(); const stop = await host.onActivity!(changed);
    activity({ isActive: false }); activity({ isActive: true }); stop();
    expect(changed.mock.calls).toEqual([[false], [true]]); expect(remove).toHaveBeenCalledOnce();
    native.platform = 'web'; await expect(createMobileHost().scanPairingCode!()).rejects.toThrow('native');
    expect(typeof await createMobileHost().onActivity!(changed)).toBe('function');
  });
  it('does not invoke native plugins in the browser preview', async () => {
    native.platform = 'web';
    native.addListener.mockClear();
    const stop = await createMobileHost().onResume(vi.fn());
    stop();
    expect(native.addListener).not.toHaveBeenCalled();
  });

  it('forwards only native resume and removes its native listener', async () => {
    native.platform = 'ios';
    const remove = vi.fn().mockResolvedValue(undefined);
    let callback!: (state: { isActive: boolean }) => void;
    native.addListener.mockImplementation(async (_event, listener) => {
      callback = listener;
      return { remove };
    });
    const resumed = vi.fn();
    const stop = await createMobileHost().onResume(resumed);
    callback({ isActive: false });
    expect(resumed).not.toHaveBeenCalled();
    callback({ isActive: true });
    expect(resumed).toHaveBeenCalledTimes(1);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
