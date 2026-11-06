import { isCanvasDocument, type CanvasDocument } from '@workspace/core/visualize-canvas';

/** Chat previews stay small; larger scenes belong in Visualize. */
export function parseInlineExcalidraw(source: string): CanvasDocument {
  if (source.length > 100_000) throw new Error('Diagram is too large for chat. Use Visualize.');
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid diagram scene.');
  const data = value as Record<string, unknown>;
  const scene: unknown = { revision: 1, elements: data.elements, files: data.files ?? {}, selectedElementIds: [], preview: '' };
  if (!isCanvasDocument(scene) || !scene.elements.length || scene.elements.length > 40
    || Object.keys(scene.files).length > 0 || scene.elements.some(element => element.type === 'image')
    || scene.elements.some(element => ['x', 'y', 'width', 'height'].some(key => Math.abs(Number(element[key])) > 10_000))) {
    throw new Error('Invalid or oversized chat diagram. Use Visualize for larger scenes.');
  }
  return scene;
}
