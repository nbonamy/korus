import path from 'node:path';
import { BrowserPane as NativeBrowserPane, type BrowserPaneOptions } from 'ai-app-sdk/browser/electron';
import { annotationFromBrowserOwner, viewportFromBrowserOwner, type BrowserAnnotation, type BrowserViewportRequest } from '@workspace/core/browser-contracts';
import { browserGuestPartition } from '@workspace/core/browser-guest';
import { supportedBrowserExtensions } from '@workspace/core/browser-extensions';
export { browserPaneKey } from 'ai-app-sdk/browser/electron';
type AppBrowserPaneOptions = Omit<BrowserPaneOptions, 'partitionFor' | 'sharedPartition' | 'preservedOrigins' | 'annotationEditor' | 'onAnnotation' | 'onViewportRequest'> & {
  onAnnotation(annotation: BrowserAnnotation): void;
  onViewportRequest?(request: BrowserViewportRequest, window: Parameters<NonNullable<BrowserPaneOptions['onViewportRequest']>>[1]): void;
};
export class BrowserPane extends NativeBrowserPane {
  constructor(options: AppBrowserPaneOptions) {
    super({ ...options,
      onAnnotation: annotation => options.onAnnotation(annotationFromBrowserOwner(annotation)),
      onViewportRequest: (request, window) => options.onViewportRequest?.(viewportFromBrowserOwner(request), window),
      partitionFor: browserGuestPartition, sharedPartition: browserGuestPartition('shared'),
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
