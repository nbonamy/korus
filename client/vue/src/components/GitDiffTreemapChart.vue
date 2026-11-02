<template>
  <canvas ref="canvas" class="diff-treemap__plot" aria-hidden="true" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Chart, LinearScale, Tooltip, type Plugin } from 'chart.js';
import { TreemapController, TreemapElement, type TreemapDataPoint } from 'chartjs-chart-treemap';
import { resolveChartColor } from '@workspace/core/analytics-chart';
import type { MapFile } from './diff-treemap-files';
import type { TreemapLayout } from './diff-treemap-presentation';
import { fileKindColor } from './file-kind-presentation';
import { readAnalyticsTheme } from './analytics-theme';

Chart.register(LinearScale, Tooltip, TreemapController, TreemapElement);
const props = defineProps<{ files: readonly MapFile[] }>();
const emit = defineEmits<{ layout: [value: TreemapLayout] }>();
const canvas = ref<HTMLCanvasElement>();
let chart: Chart<'treemap'> | undefined;
let observer: MutationObserver | undefined;
let theme: ReturnType<typeof readAnalyticsTheme>;

function background(raw: TreemapDataPoint | undefined, ctx: CanvasRenderingContext2D): CanvasGradient | string {
  if (!raw?._data) return 'transparent';
  // A view switch can mount the chart before its hidden parent becomes measurable.
  if (![raw.x, raw.y, raw.w, raw.h].every(Number.isFinite)) return 'transparent';
  const file = raw._data as MapFile;
  const color = resolveChartColor(fileKindColor[file.kind], theme.tokens);
  const surface = resolveChartColor(theme.surface, theme.tokens);
  const gradient = ctx.createLinearGradient(raw.x, raw.y, raw.x + raw.w, raw.y + raw.h);
  gradient.addColorStop(0, `color-mix(in srgb, ${color} 10%, ${surface})`);
  gradient.addColorStop(1, `color-mix(in srgb, ${color} 20%, ${surface})`);
  return gradient;
}

// Native file buttons use the chart's own geometry, preserving keyboard/ARIA access
// and HTML labels without a second layout or custom canvas text renderer.
const accessibleLayout: Plugin<'treemap'> = {
  id: 'diff-file-controls',
  beforeLayout(chart) {
    // Keep fractional areas for tiny changes; the controller otherwise snaps its axes.
    for (const scale of Object.values(chart.scales)) scale.options.alignToPixels = false;
  },
  afterUpdate(chart) {
    const points = chart.data.datasets[0]!.data;
    emit('layout', {
      size: { width: chart.width, height: chart.height },
      tiles: chart.getDatasetMeta(0).data.map((element, index) => {
        const rect = (element as TreemapElement).getProps(['x', 'y', 'width', 'height'], true);
        return { file: points[index]!._data as MapFile,
          rect: { x: rect.x, y: rect.y, width: rect.width ?? 0, height: rect.height ?? 0 } };
      }),
    });
  },
};

onMounted(() => {
  theme = readAnalyticsTheme();
  chart = new Chart(canvas.value!, {
    type: 'treemap',
    data: { datasets: [{
      data: [], tree: props.files.map(file => ({ ...file })), key: 'weight',
      spacing: 0, borderWidth: 1,
      borderRadius: () => Number.parseFloat(theme.tokens['--radius-md'] ?? '6'),
      borderColor: () => resolveChartColor(theme.surface, theme.tokens),
      backgroundColor: context => background(context.raw, context.chart.ctx),
      labels: { display: false }, captions: { display: false },
    }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, events: [],
      layout: { padding: 0, autoPadding: false },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
    plugins: [accessibleLayout],
  });
  observer = new MutationObserver(() => {
    theme = readAnalyticsTheme();
    chart?.update('none');
  });
  observer.observe(document.documentElement, { attributes: true });
});
watch(() => props.files, files => {
  if (!chart) return;
  chart.data.datasets[0]!.tree = files.map(file => ({ ...file }));
  chart.update('none');
}, { flush: 'post' });
onBeforeUnmount(() => { observer?.disconnect(); chart?.destroy(); });
</script>

<style scoped>
.diff-treemap__plot { position: absolute; inset: 0; pointer-events: none; }
</style>
