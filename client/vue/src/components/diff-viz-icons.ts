import { h, render, type Component } from 'vue';
import type { DiffVizIcon } from '@workspace/core/git-diff-viz';
import { AffiliateIcon, ApiIcon, CodeIcon, DatabaseIcon, DeviceImacIcon, FileTextIcon, GitBranchIcon, RefreshIcon, RobotFaceIcon, ServerIcon, SettingsIcon, ShieldCheckIcon, StackIcon, TestPipeIcon } from '../shared/icons/app-icons';
import { rasterizeCanvasImage } from './excalidraw-editor';

const icons: Record<DiffVizIcon, Component> = { repository: GitBranchIcon, interface: DeviceImacIcon, agent: RobotFaceIcon, service: ServerIcon, database: DatabaseIcon, sync: RefreshIcon, api: ApiIcon, code: CodeIcon, settings: SettingsIcon, tests: TestPipeIcon, queue: StackIcon, document: FileTextIcon, security: ShieldCheckIcon, diagram: AffiliateIcon };
const cache = new Map<string, Promise<{ id: string; dataURL: string }>>();

/** Only app-owned icons become native image assets; model output cannot supply SVG or URLs. */
export function diffVizIcon(name: DiffVizIcon, color: string): Promise<{ id: string; dataURL: string }> {
  const key = `${name}:${color}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const operation = (async () => {
    const host = document.createElement('div');
    render(h(icons[name], { size: 96, color, stroke: 1.25 }), host);
    const svg = host.querySelector('svg')!;
    svg.setAttribute('viewBox', '0 0 96 96');
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('transform', 'scale(4)');
    while (svg.firstChild) group.append(svg.firstChild);
    svg.append(group);
    const source = new XMLSerializer().serializeToString(svg);
    render(null, host);
    const { dataURL } = await rasterizeCanvasImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
    const hash = [...key].reduce((value, character) => Math.imul(value, 31) + character.charCodeAt(0) | 0, 0) >>> 0;
    return { id: `viz-icon-${name}-${hash.toString(36)}`, dataURL };
  })();
  if (cache.size >= 64) cache.clear();
  cache.set(key, operation);
  void operation.catch(() => cache.delete(key));
  return operation;
}
