import {diagramFonts, loadCanvasFonts} from './diagram-fonts';
import { rasterizeDiagramIcon } from './excalidraw-editor';
import type { NativeDiffVizDiagram, DiffVizStatus } from '@workspace/core/git-diff-viz';
import { resolveChartColor } from '@workspace/core/analytics-chart';
import { readAnalyticsTheme } from './analytics-theme';
import type { CanvasScene } from './excalidraw-editor';
import { diffVizIcon } from './diff-viz-icons';
import type { CanvasElement } from '@workspace/core/visualize-canvas';

/** The model places the architecture; the app owns tiles, captions and semantic colors. */
export async function diffVizScene(diagram: NativeDiffVizDiagram): Promise<CanvasScene> {
  const theme = readAnalyticsTheme();
  const color = (token: string) => resolveChartColor(`var(${token})`, theme.tokens);
  const nodes = new Map(diagram.nodes.map(node => [node.id, node]));
  const groups = new Set(diagram.groups);
  const byId = new Map(diagram.elements.map(element => [element.id, element]));
  const connections = diagram.elements.filter(element => ['arrow', 'line'].includes(element.type));
  const connectionColor = (element: CanvasElement) => color(element.strokeStyle === 'dashed' ? '--color-text-muted' : '--color-primary');
  const relationshipFor = (text: CanvasElement): CanvasElement | undefined => {
    if (text.type !== 'text') return;
    const container = typeof text.containerId === 'string' ? byId.get(text.containerId) : undefined;
    if (container) return connections.includes(container) ? container : undefined;
    // Retained drawings used standalone labels. Keep group headings out of that fallback.
    if (diagram.elements.some(group => groups.has(group.id) && text.x >= group.x && text.x + text.width <= group.x + group.width
      && text.y >= group.y && text.y < group.y + 48)) return;
    const centerX = text.x + text.width / 2, centerY = text.y + text.height / 2;
    let nearest: {connection: CanvasElement; gap: number; center: number} | undefined;
    for (const connection of connections) {
      const points = connection.points as number[][] | undefined;
      for (let i = 1; points && i < points.length; i++) {
        const ax = connection.x + points[i-1]![0]!, ay = connection.y + points[i-1]![1]!;
        const dx = points[i]![0]! - points[i-1]![0]!, dy = points[i]![1]! - points[i-1]![1]!;
        const t = Math.max(0, Math.min(1, ((centerX-ax)*dx + (centerY-ay)*dy) / (dx*dx + dy*dy || 1)));
        const x = ax + t*dx, y = ay + t*dy;
        const gap = Math.hypot(Math.max(text.x-x, 0, x-text.x-text.width), Math.max(text.y-y, 0, y-text.y-text.height));
        const center = Math.hypot(centerX-x, centerY-y);
        if (gap <= 32 && (!nearest || gap < nearest.gap || (gap === nearest.gap && center < nearest.center))) nearest = {connection, gap, center};
      }
    }
    return nearest?.connection;
  };
  const palette: Record<DiffVizStatus, string> = {
    added: '--color-success', changed: '--color-warning', deleted: '--color-error', unchanged: '--color-border',
  };
  const files: CanvasScene['files'] = {};
  const decorations: CanvasElement[] = [];
  const presentation = new Map<string, Partial<CanvasElement>>();
  const captionBottoms = new Map<string, number>();
  const ids = new Set(diagram.elements.map(element => element.id));
  const uniqueId = (prefix: string) => {
    let id = prefix;
    while (ids.has(id)) id += '_';
    ids.add(id);
    return id;
  };
  await Promise.all(diagram.nodes.map(async node => {
    const shape = diagram.elements.find(element => element.id === node.id);
    if (!shape) return;
    // Preserve authored centers for existing drawings as well as the new square-tile geometry.
    const size = Math.min(88, Math.max(64, Math.min(shape.width, shape.height)));
    const x = shape.x + (shape.width - size) / 2;
    const y = shape.y + (shape.height - size) / 2;
    presentation.set(shape.id, { type: 'rectangle', x, y, width: size, height: size,
      boundElements: Array.isArray(shape.boundElements) ? (shape.boundElements as Array<{ type: string }>).filter(bound => bound.type !== 'text') : [] });
    const embedded = node.iconImage;
    const raster = embedded ? await rasterizeDiagramIcon(embedded).catch(() => undefined) : undefined;
    const asset = embedded && raster ? {id:`viz_tech_${node.id}`, ...raster} : await diffVizIcon(node.icon ?? 'service', color('--color-text'));
    if (embedded && raster) presentation.set(shape.id, {...presentation.get(shape.id), backgroundColor:embedded.whiteFill ? '#20242d' : '#ffffff'});
    files[asset.id] = { id: asset.id, mimeType: 'image/png', dataURL: asset.dataURL, created: 0 };
    const iconSize = size * 0.60;
    const ratio = raster ? raster.width / raster.height : 1;
    const iconWidth = iconSize * Math.min(1, ratio);
    const iconHeight = iconSize / Math.max(1, ratio);
    decorations.push({ id: uniqueId(`viz_icon_${shape.id}`), type: 'image', x: x + (size - iconWidth) / 2, y: y + (size - iconHeight) / 2,
      width: iconWidth, height: iconHeight, fileId: asset.id, status: 'saved', scale: [1, 1], locked: true });
    const label = diagram.elements.find(element => element.type === 'text' && element.containerId === node.id);
    // The caption is deliberately unbound: Excalidraw otherwise pulls it into the tile.
    const width = 168;
    const fontSize = 18;
    const lines = Math.max(node.label.split('\n').length, Math.ceil(node.label.length * fontSize * 0.5 / width));
    const caption = { x: x + (size - width) / 2, y: y + size + 12, width, height: lines * fontSize * 1.25,
      fontSize, containerId: null, autoResize: false, textAlign: 'center', verticalAlign: 'top' };
    captionBottoms.set(shape.id, caption.y + caption.height);
    if (label) presentation.set(label.id, caption);
    else decorations.push({ id: uniqueId(`viz_caption_${shape.id}`), type: 'text', text: node.label, originalText: node.label,
      fontFamily: diagramFonts.geist, lineHeight: 1.25, strokeColor: color('--color-text'), ...caption });
  }));
  // Binding repair must respect the caption too, including drawings generated before tile styling.
  const captionSafeConnection = (element: CanvasElement): Partial<CanvasElement> => {
    if (!['arrow', 'line'].includes(element.type) || !Array.isArray(element.points)) return {};
    const points = (element.points as number[][]).map(([x, y]) => [element.x + x!, element.y + y!]);
    const bindings: Record<string, unknown> = {};
    for (const [key, index, neighbor] of [['startBinding', 0, 1], ['endBinding', points.length - 1, points.length - 2]] as const) {
      const binding = element[key] as { elementId: string; gap?: number } | undefined;
      const tile = binding && presentation.get(binding.elementId);
      const bottom = binding && captionBottoms.get(binding.elementId);
      const point = points[index]!;
      const adjacent = points[neighbor]!;
      if (!tile || bottom === undefined || tile.y === undefined || tile.height === undefined) continue;
      // Only bottom-facing vertical segments cross a caption; horizontal routes keep their geometry.
      if (Math.abs(point[0]! - adjacent[0]!) > 1 || point[1]! < tile.y + tile.height) continue;
      point[1] = Math.max(point[1]!, bottom + 8);
      bindings[key] = { ...binding, gap: point[1] - (tile.y + tile.height) };
    }
    if (!Object.keys(bindings).length) return {};
    const [x, y] = points[0]!;
    return { ...bindings, x, y, points: points.map(point => [point[0]! - x!, point[1]! - y!]),
      width: Math.max(...points.map(point => point[0]!)) - Math.min(...points.map(point => point[0]!)),
      height: Math.max(...points.map(point => point[1]!)) - Math.min(...points.map(point => point[1]!)) };
  };
  const scene: CanvasScene = { files, selectedElementIds: [], preview: '', elements: [...diagram.elements.map(element => {
    const node = nodes.get(element.id);
    const group = groups.has(element.id);
    const connection = ['arrow', 'line'].includes(element.type);
    const relationship = relationshipFor(element);
    return { ...element, roughness: 0,
      strokeColor: relationship ? connectionColor(relationship) : connection ? connectionColor(element) : color(node ? palette[node.status] : element.type === 'text' ? '--color-text' : group ? '--color-border' : '--color-text-muted'),
      backgroundColor: node ? color('--color-surface-lowest') : group ? color('--color-surface-base') : 'transparent', fillStyle: 'solid',
      strokeWidth: node && node.status !== 'unchanged' ? 2 : connection ? 1.8 : 1.2,
      strokeStyle: node?.status === 'deleted' ? 'dashed' : connection ? element.strokeStyle ?? 'solid' : 'solid',
      ...(element.type === 'rectangle' || node ? { roundness: { type: 3 } } : {}),
      ...(element.type === 'text' ? { fontFamily: relationship ? diagramFonts.mono : diagramFonts.geist, ...(relationship ? {fontSize:Math.min(typeof element.fontSize === 'number' ? element.fontSize : 14,14)} : {}) } : {}),
      ...presentation.get(element.id),
      ...captionSafeConnection(element),
    };
  }), ...decorations] };
  await loadCanvasFonts(scene.elements);
  return scene;
}
