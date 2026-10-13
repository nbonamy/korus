import { Capacitor } from '@capacitor/core';
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from '@capacitor/barcode-scanner';
import { App } from '@capacitor/app';

export type MobileHost = {
  platform: string;
  scanPairingCode?(): Promise<string>;
  onActivity?(listener: (isActive: boolean) => void): Promise<() => void>;
  onResume(listener: () => void): Promise<() => void>;
};

/** Native affordances stay here; the shared Vue shell never imports a platform plugin. */
export function createMobileHost(): MobileHost {
  const platform = Capacitor.getPlatform();
  return {
    platform,
    async scanPairingCode() {
      if (platform === 'web') throw new Error('Pairing camera requires a native host.');
      const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: 'Scan the pairing code on your laptop.', cancelButtonAccessibilityLabel: 'Cancel scan' });
      return result.ScanResult;
    },
    async onActivity(listener) {
      if (platform === 'web') return () => {};
      const handle = await App.addListener('appStateChange', ({ isActive }) => listener(isActive));
      return () => { void handle.remove(); };
    },
    async onResume(listener) {
      if (platform === 'web') return () => {};
      const handle = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) listener(); });
      return () => { void handle.remove(); };
    },
  };
}
