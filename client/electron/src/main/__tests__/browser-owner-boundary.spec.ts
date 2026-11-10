import { expect, it, vi } from 'vitest';
import type { BrowserPaneOptions } from 'ai-app-sdk/browser/electron';
import { BrowserPane } from '../browser-pane';

const sdk = vi.hoisted(() => ({ options: null as BrowserPaneOptions | null }));
vi.mock('ai-app-sdk/browser/electron', () => ({
  BrowserPane: class { constructor(options: BrowserPaneOptions) { sdk.options = options; } },
  browserPaneKey: (ownerId: string) => ownerId,
}));

it('keeps agent-based annotation and viewport payloads at the Electron host boundary', () => {
  const onAnnotation = vi.fn(), onViewportRequest = vi.fn();
  new BrowserPane({ onAnnotation, onViewportRequest });
  const annotation = { id: 'selection', ownerId: 'agent-a', browserId: 'primary', comment: 'Inspect this', url: 'https://example.com', selector: '#target', kind: 'element', rect: { x: 1, y: 2, width: 30, height: 40 } } satisfies Parameters<BrowserPaneOptions['onAnnotation']>[0];
  const request = { ownerId: 'agent-a', browserId: 'primary', requestId: 'viewport', viewport: { preset: 'custom', width: 800, height: 600 } } satisfies Parameters<NonNullable<BrowserPaneOptions['onViewportRequest']>>[0];
  const window = {} as Parameters<NonNullable<BrowserPaneOptions['onViewportRequest']>>[1];
  sdk.options!.onAnnotation(annotation);
  sdk.options!.onViewportRequest!(request, window);
  const { ownerId: annotationOwner, ...annotationFields } = annotation;
  const { ownerId: viewportOwner, ...viewportFields } = request;
  expect(onAnnotation).toHaveBeenCalledExactlyOnceWith({ ...annotationFields, agentId: annotationOwner });
  expect(onViewportRequest).toHaveBeenCalledExactlyOnceWith({ ...viewportFields, agentId: viewportOwner }, window);
  expect(annotation.ownerId).toBe('agent-a');
  expect(request.ownerId).toBe('agent-a');
});
