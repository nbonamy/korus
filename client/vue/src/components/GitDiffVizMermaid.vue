<template>
  <div class="diff-viz-mermaid">
    <div class="diff-viz-mermaid__viewport">
      <div v-if="rendered.error" role="alert" class="diff-viz-mermaid__error">{{ rendered.error }}</div>
      <div v-else ref="stage" class="diff-viz-mermaid__stage" :style="{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }" @click="activate" @keydown="activate" v-html="rendered.svg" />
    </div>
    <div class="diff-viz-mermaid__controls">
      <button type="button" class="app-button app-button--tertiary" :aria-label="translate('visualize.zoomOut')" :disabled="zoom <= 1" @click="zoom = Math.max(1, zoom - 0.25)"><MinusIcon aria-hidden="true" /></button>
      <button type="button" class="app-button app-button--tertiary" :aria-label="translate('visualize.zoomIn')" :disabled="zoom >= 4" @click="zoom = Math.min(4, zoom + 0.25)"><PlusIcon aria-hidden="true" /></button>
      <button type="button" class="app-button app-button--tertiary" :aria-label="translate('visualize.fitCanvas')" @click="zoom = 1"><ArrowsMinimizeIcon aria-hidden="true" /></button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { renderMermaidSVG } from 'beautiful-mermaid';
import type { DiffVizDiagram, DiffVizStatus, DiffVizLocation } from '@workspace/core/git-diff-viz';
import { diffVizTooltip } from './diff-viz-tooltip';
import { sanitizeSvg } from './visualization-svg';
import { translate } from '../i18n';
import { ArrowsMinimizeIcon, MinusIcon, PlusIcon } from '../shared/icons/app-icons';
const props = defineProps<{ diagram: Extract<DiffVizDiagram, { format: 'mermaid' }> }>();
const emit = defineEmits<{ select: [paths: string[], location?: DiffVizLocation] }>();
const zoom = ref(1);
const stage = ref<HTMLElement>();
const namespace = `diff-viz-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
watch(() => props.diagram, () => { zoom.value = 1; });
const rendered = computed(() => {
  try {
    const svg = new DOMParser().parseFromString(sanitizeSvg(renderMermaidSVG(props.diagram.source, { transparent: true })), 'image/svg+xml');
    const root = svg.documentElement;
    const ids = new Map([...svg.querySelectorAll('[id]')].map(element => [element.id, `${namespace}-${element.id}`]));
    for (const element of svg.querySelectorAll('[id]')) element.id = ids.get(element.id)!;
    root.id = `${namespace}-svg`;
    for (const element of svg.querySelectorAll('*')) for (const attribute of [...element.attributes]) {
      if (attribute.value.includes('url(#')) element.setAttribute(attribute.name, attribute.value.replace(/url\(#([^)]*)\)/gu, (_match, id: string) => `url(#${ids.get(id) ?? id})`));
    }
    for (const style of svg.querySelectorAll('style')) style.textContent = (style.textContent ?? '').replace(/(^|\})\s*([^{}]+)\{/gu, (_match, end: string, selectors: string) => `${end}\n${selectors.split(',').map(selector => selector.trim() === 'svg' ? `#${root.id}` : `#${root.id} ${selector.trim()}`).join(', ')} {`);
    root.removeAttribute('width'); root.removeAttribute('height');
    root.style.setProperty('--bg', 'var(--color-surface-lowest)');
    root.style.setProperty('--fg', 'var(--color-text)');
    root.style.setProperty('--_text', 'var(--color-text)');
    root.style.setProperty('--_line', 'var(--color-text-muted)');
    const tokens: Record<DiffVizStatus, [string, string]> = {
      added: ['--color-success', '--color-success-container'], changed: ['--color-warning', '--color-warning-container'],
      deleted: ['--color-error', '--color-error-container'], unchanged: ['--color-text-muted', '--color-surface-lowest'],
    };
    for (const node of props.diagram.nodes) {
      const element = [...svg.querySelectorAll<SVGElement>('g.node')].find(element => element.dataset.id === node.id);
      if (!element) continue;
      element.style.setProperty('--_node-stroke', `var(${tokens[node.status][0]})`);
      element.style.setProperty('--_node-fill', `var(${tokens[node.status][1]})`);
      if (!node.paths.length) continue;
      element.setAttribute('role', 'button'); element.setAttribute('tabindex', '0');
      element.setAttribute('aria-label', translate('surface.diffViz.openChanges', { label: node.label }));
      const title = svg.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = diffVizTooltip(node); element.prepend(title);
    }
    return { svg: new XMLSerializer().serializeToString(root), error: '' };
  } catch (cause) { return { svg: '', error: cause instanceof Error ? cause.message : String(cause) }; }
});
async function exportDiagram(format: 'native' | 'svg' | 'png'): Promise<Blob> {
  if (format === 'native') return new Blob([props.diagram.source], { type: 'text/plain' });
  const source = stage.value?.querySelector('svg');
  if (!source || rendered.value.error) throw new Error(translate('surface.diffViz.notReady'));
  const copy = source.cloneNode(true) as SVGElement;
  const originals = [source, ...source.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  originals.forEach((element, index) => {
    const style = getComputedStyle(element);
    const target = copies[index] as SVGElement;
    target.removeAttribute('style');
    for (const property of ['fill', 'stroke', 'color', 'opacity', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline']) {
      target.style.setProperty(property, style.getPropertyValue(property));
    }
    for (const attribute of [...target.attributes]) {
      if (attribute.value.includes('var(')) target.removeAttribute(attribute.name);
    }
    target.removeAttribute('tabindex'); target.removeAttribute('role');
  });
  copy.querySelectorAll('style').forEach(style => style.remove());
  copy.style.setProperty('background-color', getComputedStyle(document.documentElement).getPropertyValue('--color-surface-lowest').trim());
  const bounds = source.viewBox.baseVal;
  copy.setAttribute('width', String(bounds.width)); copy.setAttribute('height', String(bounds.height));
  const svg = new XMLSerializer().serializeToString(copy);
  if (format === 'svg') return new Blob([svg], { type: 'image/svg+xml' });
  const { rasterizeCanvasImage } = await import('./excalidraw-editor');
  const image = await rasterizeCanvasImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  return (await fetch(image.dataURL)).blob();
}
defineExpose({ exportDiagram });
function activate(event: MouseEvent | KeyboardEvent) {
  if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return;
  const id = (event.target as Element).closest<SVGElement>('g.node')?.dataset.id;
  const node = props.diagram.nodes.find(node => node.id === id);
  if (!node?.paths.length) return;
  event.preventDefault();
  if (node.locations?.[0]) emit('select', node.paths, node.locations[0]);
  else emit('select', node.paths);
}
</script>
<style scoped>
.diff-viz-mermaid { position: relative; display: flex; flex: 1; min-height: 0; min-width: 0; }
.diff-viz-mermaid__viewport { flex: 1; overflow: auto; min-width: 0; min-height: 0; }
.diff-viz-mermaid__stage { min-width: 100%; min-height: 100%; }
.diff-viz-mermaid__stage :deep(svg) { display: block; width: 100%; height: 100%; }
.diff-viz-mermaid__stage :deep([role="button"]) { cursor: pointer; }
.diff-viz-mermaid__stage :deep([role="button"]:hover), .diff-viz-mermaid__stage :deep([role="button"]:focus-visible) { --_node-stroke: var(--color-primary) !important; outline: none; }
.diff-viz-mermaid__controls { position: absolute; display: flex; gap: var(--space-2); right: var(--space-6); bottom: var(--space-6); background: var(--color-surface-lowest); border-radius: var(--radius-lg); }
.diff-viz-mermaid__error { padding: var(--space-6); color: var(--color-error); }
</style>
