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
    const asset = await diffVizIcon(node.icon ?? 'service', color('--color-text'));
    files[asset.id] = { id: asset.id, mimeType: 'image/png', dataURL: asset.dataURL, created: 0 };
    const iconSize = size * 0.52;
    decorations.push({ id: uniqueId(`viz_icon_${shape.id}`), type: 'image', x: x + (size - iconSize) / 2, y: y + (size - iconSize) / 2,
      width: iconSize, height: iconSize, fileId: asset.id, status: 'saved', scale: [1, 1], locked: true });
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
      fontFamily: 2, lineHeight: 1.25, strokeColor: color('--color-text'), ...caption });
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
  return { files, selectedElementIds: [], preview: '', elements: [...diagram.elements.map(element => {
    const node = nodes.get(element.id);
    const group = groups.has(element.id);
    const connection = ['arrow', 'line'].includes(element.type);
    return { ...element, roughness: 0,
      strokeColor: color(node ? palette[node.status] : element.type === 'text' ? '--color-text' : group ? '--color-border' : connection && element.strokeStyle !== 'dashed' ? '--color-primary' : '--color-text-muted'),
      backgroundColor: node ? color('--color-surface-lowest') : group ? color('--color-surface-base') : 'transparent', fillStyle: 'solid',
      strokeWidth: node && node.status !== 'unchanged' ? 2 : connection ? 1.8 : 1.2,
      strokeStyle: node?.status === 'deleted' ? 'dashed' : connection ? element.strokeStyle ?? 'solid' : 'solid',
      ...(element.type === 'rectangle' || node ? { roundness: { type: 3 } } : {}),
      ...(element.type === 'text' ? { fontFamily: 2 } : {}),
      ...presentation.get(element.id),
      ...captionSafeConnection(element),
    };
  }), ...decorations] };
}
