import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';
import product from '../core/src/product.json';

const config: CapacitorConfig = {
  appId: `${product.appId}.companion`,
  appName: `${product.name} Companion`,
  webDir: 'dist',
  plugins: { Keyboard: { resize: KeyboardResize.Native, resizeOnFullScreen: true } },
};
export default config;
