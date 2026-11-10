import path from 'node:path';
import { BrowserPane as NativeBrowserPane, type BrowserPaneOptions } from 'ai-app-sdk/browser/electron';
import { browserGuestPartition } from '@workspace/core/browser-guest';
import { supportedBrowserExtensions } from '@workspace/core/browser-extensions';
export { browserPaneKey } from 'ai-app-sdk/browser/electron';
export class BrowserPane extends NativeBrowserPane {
  constructor(options: Omit<BrowserPaneOptions, 'partitionFor' | 'sharedPartition' | 'preservedOrigins' | 'annotationEditor'>) {
    super({ ...options, partitionFor: browserGuestPartition, sharedPartition: browserGuestPartition('shared'),
      preservedOrigins: supportedBrowserExtensions.map(extension => `chrome-extension://${extension.id}`),
      annotationEditor: { preload: path.join(__dirname, 'preload.js'), load: async (overlay, query) => {
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const target = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
      await overlay.loadURL(target.toString());
    } else {
      await overlay.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query });
    }
      } },
    });
  }
}
