import { Component, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, CaptureUpdateAction, bumpVersion, convertToExcalidrawElements, exportToCanvas, restoreElements, sceneCoordsToViewportCoords } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, BinaryFiles, AppState, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types';
import type { CanvasDocument, CanvasElement } from '@workspace/core/visualize-canvas';
import type { Visualization } from '@workspace/core/visualize';
import { sanitizeSvg } from './visualization-svg';
import '@excalidraw/excalidraw/index.css';

Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL('./excalidraw/', document.baseURI).href });

export type CanvasScene = Omit<CanvasDocument, 'revision'>;
export type CanvasAnnotationTarget = { id: string; x: number; y: number; width: number; height: number };
export type CanvasControlsState = { zoom: number };
export async function importVisualization(visualization: Visualization, imageSource: string): Promise<CanvasScene> {
  if (visualization.canvas) return structuredClone(visualization.canvas);
  if (visualization.content.kind === 'mermaid') {
    if (/%%\s*\{|\bclick\s+|\b(?:img|icon)\s*:|<(?:img|iframe|script|object|embed|link|style)\b/iu.test(visualization.content.source)) {
      throw new Error('Canvas import does not allow Mermaid directives, links, or external assets.');
    }
    const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');
    // Plain SVG text keeps the converter's image fallback valid XML and preserves labels during sanitization.
    const config = { htmlLabels: false, flowchart: { curve: 'linear' as const, htmlLabels: false } };
    const result = await parseMermaidToExcalidraw(visualization.content.source, config);
    const files: BinaryFiles = {};
    for (const [id, file] of Object.entries(result.files ?? {})) {
      files[id] = file.mimeType === 'image/svg+xml'
        ? { ...file, created: Date.now(), mimeType: 'image/png', dataURL: (await rasterize(file.dataURL)).dataURL as typeof file.dataURL }
        : { ...file, created: Date.now() };
    }
    return { elements: convertToExcalidrawElements(result.elements, { regenerateIds: false }) as unknown as CanvasElement[], files, selectedElementIds: [], preview: '' };
  }
  const source = visualization.content.kind === 'svg'
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeSvg(visualization.content.source))}`
    : imageSource;
  const image = await rasterize(source);
  const id = `image-${visualization.id}`;
  const elements = convertToExcalidrawElements([{ type: 'image', x: 0, y: 0, width: image.width, height: image.height, fileId: id as FileId }]);
  return {
    elements: elements as unknown as CanvasElement[],
    files: { [id]: { id, mimeType: 'image/png', dataURL: image.dataURL, created: Date.now() } },
    selectedElementIds: [], preview: '',
  };
}
async function rasterize(source: string): Promise<{ dataURL: string; width: number; height: number }> {
  if (!source.startsWith('data:image/')) throw new Error('Image is not available.');
  // SVG is always decoded, sanitized and re-encoded before the browser sees it.
  if (source.startsWith('data:image/svg+xml')) {
    const comma = source.indexOf(',');
    const svg = source.slice(0, comma).includes(';base64') ? new TextDecoder().decode(Uint8Array.from(atob(source.slice(comma + 1)), character => character.charCodeAt(0))) : decodeURIComponent(source.slice(comma + 1));
    const document = new DOMParser().parseFromString(sanitizeSvg(svg), 'image/svg+xml');
    const root = document.documentElement;
    const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number);
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
      root.setAttribute('width', String(viewBox[2]));
      root.setAttribute('height', String(viewBox[3]));
    }
    source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
  }
  const image = new Image();
  image.src = source;
  await image.decode();
  const ratio = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataURL: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
class CanvasErrorBoundary extends Component<{ onError: (error: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}
function restoreSceneElements(elements: readonly ExcalidrawElement[]) {
  const restored = restoreElements(elements.map(element => element.type === 'text'
    ? { ...element, text: element.originalText ?? element.text } : element), null,
  { repairBindings: true, refreshDimensions: true });
  const byId = new Map(restored.map(element => [element.id, element]));
  return restored.map(element => {
    if (element.type !== 'text' || !element.containerId) return element;
    const container = byId.get(element.containerId);
    if (!container || !['rectangle', 'ellipse', 'diamond'].includes(container.type)) return element;
    return { ...element,
      x: element.textAlign === 'center' ? container.x + (container.width - element.width) / 2 : element.x,
      y: element.verticalAlign === 'middle' ? container.y + (container.height - element.height) / 2 : element.y,
    };
  });
}
export function mountCanvas(host: HTMLElement, scene: CanvasScene, onChange: (scene: CanvasScene) => void, onError: (error: Error) => void, onViewportChange: () => void = () => {}) {
  const root = createRoot(host);
  let api: ExcalidrawImperativeAPI | undefined;
  let current = scene;
  let unsubscribeScroll: (() => void) | undefined;
  let disposed = false;
  let initialFitPending = true;
  let initialFitScheduled = false;
  const fitInitialScene = () => {
    if (!initialFitPending || initialFitScheduled || disposed || !api || !host.clientWidth || !host.clientHeight) return;
    initialFitScheduled = true;
    requestAnimationFrame(() => {
      initialFitScheduled = false;
      if (!initialFitPending || disposed || !api || !host.clientWidth || !host.clientHeight) return;
      api.scrollToContent(undefined, { fitToContent: true });
      initialFitPending = false;
    });
  };
  const theme = () => document.documentElement.classList.contains('dark') ? 'dark' as const : 'light' as const;
  const syncControlStyle = () => requestAnimationFrame(() => {
    if (disposed) return;
    const container = host.querySelector('.excalidraw');
    if (!container) return;
    const style = getComputedStyle(container);
    for (const [target, source] of Object.entries({ background: '--color-surface-low', foreground: '--text-primary-color', size: '--lg-button-size', radius: '--border-radius-lg' })) {
      host.parentElement?.style.setProperty(`--visualize-control-${target}`, style.getPropertyValue(source));
    }
    onViewportChange();
  });
  const themeObserver = new MutationObserver(() => {
    api?.updateScene({ appState: { theme: theme() }, captureUpdate: CaptureUpdateAction.NEVER });
    syncControlStyle();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const resizeObserver = new ResizeObserver(() => {
    api?.refresh();
    fitInitialScene();
    syncControlStyle();
    onViewportChange();
  });
  resizeObserver.observe(host);
  const refreshTextAfterFontsLoad = () => requestAnimationFrame(() => {
    if (disposed || !api) return;
    // Excalidraw invalidates glyph caches after loading fonts but retains the
    // fallback-font bounds. Remeasure the current scene, never the import snapshot.
    const currentElements = api.getSceneElements();
    const restored = restoreSceneElements(currentElements);
    const changed = restored.map((element, index) => {
      const previous = currentElements[index];
      return element.type === 'text' && (element.width !== previous.width || element.height !== previous.height || element.x !== previous.x || element.y !== previous.y || element.text !== (previous as typeof element).text)
        ? bumpVersion(element) : element;
    });
    api.updateScene({
      elements: changed,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });
  document.fonts.addEventListener('loadingdone', refreshTextAfterFontsLoad);
  const elements = (value: CanvasScene) => restoreSceneElements(value.elements as unknown as ExcalidrawElement[]);
  const update = (value: CanvasScene, undoable: boolean) => {
    current = value;
    api?.addFiles(Object.values(value.files) as unknown as Parameters<ExcalidrawImperativeAPI['addFiles']>[0]);
    api?.updateScene({ elements: elements(value), appState: { selectedElementIds: {} }, captureUpdate: undoable ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER });
    requestAnimationFrame(onViewportChange);
  };
  root.render(createElement(CanvasErrorBoundary, { onError, children: createElement(Excalidraw, {
    initialData: { elements: elements(scene), files: scene.files as BinaryFiles, appState: { selectedElementIds: {}, theme: theme(), viewModeEnabled: true, activeTool: { type: 'hand', customType: null, locked: false, lastActiveTool: null } }, scrollToContent: true },
    excalidrawAPI: (value: ExcalidrawImperativeAPI) => {
      api = value;
      unsubscribeScroll = value.onScrollChange(onViewportChange);
      void document.fonts.ready.then(() => {
        refreshTextAfterFontsLoad();
        fitInitialScene();
      });
      syncControlStyle();
      fitInitialScene();
    },
    onChange: (items: readonly ExcalidrawElement[], _state: AppState, files: BinaryFiles) => {
      if (disposed) return;
      current = { elements: items.map(element => ({ ...element, link: null })) as unknown as CanvasElement[], files, selectedElementIds: current.selectedElementIds, preview: '' };
      onChange(current);
    },
    onLinkOpen: ((_element, event) => event.preventDefault()) as ExcalidrawProps['onLinkOpen'],
    validateEmbeddable: false,
    aiEnabled: false,
    UIOptions: { canvasActions: { clearCanvas: false, loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } },
  }, createElement(MainMenu)) }));
  return {
    update,
    setSelection(elementIds: readonly string[]) {
      current = { ...current, selectedElementIds: [...elementIds], preview: '' };
    },
    getAnnotationTargets(): CanvasAnnotationTarget[] {
      if (!api) return [];
      const appState = api.getAppState();
      return api.getSceneElements()
        .filter(element => !element.isDeleted && ['rectangle', 'ellipse', 'diamond'].includes(element.type))
        .map(element => {
          const start = sceneCoordsToViewportCoords({ sceneX: element.x, sceneY: element.y }, appState);
          const end = sceneCoordsToViewportCoords({ sceneX: element.x + element.width, sceneY: element.y + element.height }, appState);
          return { id: element.id, x: start.x - appState.offsetLeft, y: start.y - appState.offsetTop, width: end.x - start.x, height: end.y - start.y };
        });
    },
    getControlsState(): CanvasControlsState {
      return { zoom: api?.getAppState().zoom.value ?? 1 };
    },
    zoomBy(delta: number): number {
      if (!api) return 1;
      const state = api.getAppState();
      const nextZoom = Math.min(30, Math.max(0.1, Math.round((state.zoom.value + delta) * 10) / 10));
      if (nextZoom === state.zoom.value) return nextZoom;
      const viewportX = state.width / 2;
      const viewportY = state.height / 2;
      const baseScrollX = state.scrollX + viewportX - viewportX / state.zoom.value;
      const baseScrollY = state.scrollY + viewportY - viewportY / state.zoom.value;
      api.updateScene({
        appState: {
          scrollX: baseScrollX - (viewportX - viewportX / nextZoom),
          scrollY: baseScrollY - (viewportY - viewportY / nextZoom),
          zoom: { value: nextZoom } as AppState['zoom'],
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      requestAnimationFrame(onViewportChange);
      return nextZoom;
    },
    fit() { api?.scrollToContent(undefined, { fitToContent: true }); },
    async preview(value = current): Promise<string> {
      const canvas = await exportToCanvas({ elements: elements(value), files: value.files as BinaryFiles, appState: { exportBackground: false }, maxWidthOrHeight: 1000 });
      return canvas.toDataURL('image/png');
    },
    dispose() { document.fonts.removeEventListener('loadingdone', refreshTextAfterFontsLoad); unsubscribeScroll?.(); themeObserver.disconnect(); resizeObserver.disconnect(); disposed = true; root.unmount(); api = undefined; },
  };
}
