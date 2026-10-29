<template>
  <section class="visualize-panel" :aria-label="translate('visualize.visualizations')">
    <div v-if="selectedVisualization" class="visualize-panel__canvas">
      <div class="visualize-panel__heading">
        <div>
          <h2>{{ selectedVisualization.title }}</h2>
          <span>{{ kindLabel(selectedVisualization) }}</span>
        </div>
      </div>
      <KeepAlive :max="5">
      <ExcalidrawCanvas
        v-if="selectedVisualization.content.kind !== 'image' || selectedVisualization.canvas || imageSources[selectedVisualization.id]"
        :key="visualizationRenderKey(selectedVisualization)"
        class="visualize-panel__diagram"
        :visualization="selectedVisualization"
        :image-source="imageSources[selectedVisualization.id]"
        :save="saveCanvas"
        :session-id="visualize.id"
        @annotate="emit('annotate', $event)"
      />
      </KeepAlive>
      <div v-if="selectedVisualization.content.kind === 'image' && !selectedVisualization.canvas && !imageSources[selectedVisualization.id]" class="visualize-panel__diagram">
        <span v-if="imageErrors[selectedVisualization.id]" role="alert">{{ imageErrors[selectedVisualization.id] }}</span>
        <span v-else role="status">{{ translate('common.loading') }}</span>
      </div>
    </div>

    <div v-else class="visualize-panel__suggestions">
      <div class="visualize-panel__intro">
        <span class="visualize-panel__eyebrow">{{ translate('visualize.mode') }}</span>
        <h2>{{ translate(visualize.suggestions.length ? 'visualize.chooseDiagram' : 'visualize.chooseInConversation') }}</h2>
        <p>{{ translate(visualize.suggestions.length ? 'visualize.suggestedFromConversation' : 'visualize.conversationChoice') }}</p>
      </div>
      <div v-if="visualize.suggestions.length" class="visualize-panel__suggestion-grid">
        <button
          v-for="suggestion in visualize.suggestions"
          :key="suggestion.id"
          type="button"
          class="visualize-panel__suggestion"
          :disabled="busy || Boolean(suggestion.visualizationId)"
          @click="emit('generate', suggestion.id)"
        >
          <span>{{ suggestion.title }}</span>
          <p :title="suggestion.description">{{ compactDescription(suggestion.description) }}</p>
          <small>{{ translate(suggestion.visualizationId ? 'visualize.generated' : 'visualize.generateDiagram') }}</small>
        </button>
      </div>
    </div>

    <div v-if="visualize.visualizations.length" class="visualize-panel__strip" :aria-label="translate('visualize.visualizations')">
      <div
        v-for="visualization in visualize.visualizations"
        :key="visualization.id"
        class="visualize-panel__thumbnail-item"
      >
        <button
          type="button"
          class="visualize-panel__thumbnail"
          :class="{ 'visualize-panel__thumbnail--selected': visualization.id === visualize.selectedVisualizationId }"
          :aria-label="translate('visualize.showDiagram', { title: visualization.title })"
          :aria-pressed="visualization.id === visualize.selectedVisualizationId"
          @click="emit('select', visualization.id)"
        >
          <VisualizationView
            compact
            :visualization="visualization"
            :image-source="imageSources[visualization.id]"
            :load-error="imageErrors[visualization.id]"
          />
          <span>{{ visualization.title }}</span>
        </button>
        <button
          type="button"
          class="visualize-panel__delete"
          :aria-label="translate('visualize.deleteDiagram', { title: visualization.title })"
          @click="confirmDelete(visualization)"
        >
          <XIcon aria-hidden="true" />
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { IconX as XIcon } from '@tabler/icons-vue';
import type { Visualization, VisualizationAsset, VisualizeSession } from '@workspace/core/visualize';
import { translate } from '../i18n';
import ExcalidrawCanvas from './ExcalidrawCanvas.vue';
import type { SaveCanvasInput, CanvasDocument } from '@workspace/core/visualize-canvas';
import VisualizationView from './VisualizationView.vue';
import { visualizationRenderKey } from './visualization-render-key';
import type { VisualizationAnnotationInput } from './use-visualization-annotations';

const props = withDefaults(defineProps<{
  busy?: boolean;
  saveCanvas: (input: SaveCanvasInput) => Promise<CanvasDocument>;
  visualize: VisualizeSession;
  readAsset: (visualizationId: string) => Promise<VisualizationAsset>;
}>(), { busy: false });

const emit = defineEmits<{
  annotate: [annotation: VisualizationAnnotationInput];
  generate: [suggestionId: string];
  select: [visualizationId: string];
  delete: [visualizationId: string];
}>();

const imageSources = reactive<Record<string, string>>({});
const imageVersions = reactive<Record<string, string>>({});
const imageErrors = reactive<Record<string, string>>({});
const imageRequestIds = new Map<string, number>();
let nextImageRequestId = 0;
const selectedVisualization = computed(() => props.visualize.visualizations.find(
  visualization => visualization.id === props.visualize.selectedVisualizationId,
) ?? props.visualize.visualizations.at(-1) ?? null);

watch(
  () => props.visualize.visualizations.map(visualizationRenderKey),
  () => {
    const currentIds = new Set(props.visualize.visualizations.map(visualization => visualization.id));
    for (const visualizationId of Object.keys(imageSources)) {
      if (!currentIds.has(visualizationId)) delete imageSources[visualizationId];
    }
    for (const visualizationId of Object.keys(imageVersions)) {
      if (!currentIds.has(visualizationId)) delete imageVersions[visualizationId];
    }
    for (const visualizationId of Object.keys(imageErrors)) {
      if (!currentIds.has(visualizationId)) delete imageErrors[visualizationId];
    }
    for (const visualizationId of imageRequestIds.keys()) {
      if (!currentIds.has(visualizationId)) imageRequestIds.delete(visualizationId);
    }
    for (const visualization of props.visualize.visualizations) {
      if (visualization.content.kind !== 'image') {
        delete imageSources[visualization.id];
        delete imageVersions[visualization.id];
        delete imageErrors[visualization.id];
        continue;
      }
      const version = visualizationRenderKey(visualization);
      if (imageVersions[visualization.id] === version) continue;
      imageVersions[visualization.id] = version;
      const requestId = ++nextImageRequestId;
      imageRequestIds.set(visualization.id, requestId);
      delete imageErrors[visualization.id];
      void props.readAsset(visualization.id).then(asset => {
        if (imageRequestIds.get(visualization.id) !== requestId || imageVersions[visualization.id] !== version) return;
        imageSources[visualization.id] = asset.dataUrl;
        delete imageErrors[visualization.id];
      }).catch(() => {
        if (imageRequestIds.get(visualization.id) !== requestId || imageVersions[visualization.id] !== version) return;
        delete imageSources[visualization.id];
        imageErrors[visualization.id] = translate('visualize.imageLoadFailed');
      });
    }
  },
  { immediate: true },
);

function kindLabel(visualization: Visualization): string {
  return visualization.content.kind === 'mermaid'
    ? translate('visualize.kind.mermaid')
    : visualization.content.kind === 'svg'
      ? translate('visualize.kind.svg')
      : translate('visualize.kind.image');
}

function compactDescription(description: string): string {
  const compact = description.replace(/\s+/gu, ' ').trim();
  return compact.length <= 120 ? compact : `${compact.slice(0, 117).trimEnd()}…`;
}

async function confirmDelete(visualization: Visualization): Promise<void> {
  try {
    await ElMessageBox.confirm(
      translate('visualize.deleteDiagramMessage', { title: visualization.title }),
      translate('visualize.deleteDiagramTitle'),
      {
        type: 'warning',
        confirmButtonText: translate('common.delete'),
        cancelButtonText: translate('common.cancel'),
      },
    );
    emit('delete', visualization.id);
  } catch {
    // Cancelling the confirmation leaves the visualization untouched.
  }
}
</script>

<style scoped>
.visualize-panel {
  position: relative;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-shell-main);
}

.visualize-panel__canvas {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  padding: var(--space-12);
  padding-bottom: 108px;
}

.visualize-panel__heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-8);
  margin-bottom: var(--space-8);
}

.visualize-panel__heading h2,
.visualize-panel__intro h2 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-16);
  line-height: var(--line-height-20);
}

.visualize-panel__heading span,
.visualize-panel__intro p {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.visualize-panel__diagram {
  min-height: 0;
  flex: 1 1 auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-low);
}

.visualize-panel__suggestions {
  flex: 1 1 auto;
  overflow: auto;
  padding: var(--space-16);
}

.visualize-panel__intro {
  max-width: 560px;
  margin: 8vh auto var(--space-12);
}

.visualize-panel__eyebrow {
  display: block;
  margin-bottom: var(--space-4);
  color: var(--color-primary);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.visualize-panel__intro p {
  margin: var(--space-4) 0 0;
}

.visualize-panel__suggestion-grid {
  width: min(100%, 720px);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-8);
  margin: 0 auto;
}

.visualize-panel__suggestion {
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: start;
  padding: var(--space-10);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  color: var(--color-text);
  background: var(--color-surface-low);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.visualize-panel__suggestion:hover:not(:disabled),
.visualize-panel__suggestion:focus-visible {
  border-color: var(--color-primary);
  background: var(--color-surface-high);
}

.visualize-panel__suggestion:disabled {
  cursor: default;
  opacity: 0.65;
}

.visualize-panel__suggestion > span {
  font-weight: var(--font-weight-semibold);
}

.visualize-panel__suggestion p {
  flex: 1 1 auto;
  margin: var(--space-4) 0 var(--space-8);
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.visualize-panel__suggestion small {
  color: var(--color-primary);
}

.visualize-panel__strip {
  position: absolute;
  left: var(--space-12);
  bottom: var(--space-12);
  max-width: calc(100% - 2 * var(--space-12));
  display: flex;
  gap: var(--space-6);
  padding: var(--space-4);
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-shell-main);
  box-shadow: var(--shadow-md);
}

.visualize-panel__thumbnail {
  width: 104px;
  height: 76px;
  flex: 0 0 auto;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: var(--space-2);
  padding: var(--space-3);
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  background: var(--color-surface-low);
  cursor: pointer;
}

.visualize-panel__thumbnail-item {
  position: relative;
  flex: 0 0 auto;
}

.visualize-panel__delete {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  color: var(--color-text);
  background: var(--color-shell-main);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}

.visualize-panel__thumbnail-item:hover .visualize-panel__delete,
.visualize-panel__delete:focus-visible {
  opacity: 1;
}

.visualize-panel__delete svg {
  width: 14px;
  height: 14px;
}

.visualize-panel__thumbnail--selected {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.visualize-panel__thumbnail span {
  overflow: hidden;
  font-size: var(--font-size-11);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
