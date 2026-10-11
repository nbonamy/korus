import type { CapacitorConfig } from '@capacitor/cli';
import product from '../core/src/product.json';

const config: CapacitorConfig = {
  appId: `${product.appId}.companion`,
  appName: `${product.name} Companion`,
  webDir: 'dist',
  plugins: { Keyboard: { resize: 'native', resizeOnFullScreen: true } },
};
export default config;
