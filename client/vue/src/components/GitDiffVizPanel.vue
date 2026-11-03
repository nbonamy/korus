<template>
  <section class="diff-viz" :aria-label="translate('surface.diffViz.name')" :aria-busy="busy">
    <h3 v-if="diagram?.title" class="diff-viz__title" :title="diagram.layout">{{ diagram.title }}</h3>
    <GitDiffVizCanvas v-if="diagram?.format === 'excalidraw'" :diagram="diagram" ref="renderer" @select="select" />
    <GitDiffVizMermaid v-else-if="diagram?.format === 'mermaid'" :diagram="diagram" ref="renderer" @select="select" />
    <div v-else class="diff-viz__empty">
      <AffiliateIcon aria-hidden="true" class="diff-viz__illustration" />
      <strong>{{ translate('surface.diffViz.title') }}</strong>
      <p>{{ diff.trim() ? translate('surface.diffViz.description') : translate('surface.diffViz.empty') }}</p>
      <div class="diff-viz__actions">
        <button class="app-button app-button--primary diff-viz__generate" type="button" :disabled="busy || !active || !preferencesLoaded || !diff.trim()" @click="generate">
          <LoaderIcon v-if="busy" class="diff-viz__spinner" aria-hidden="true" />
          {{ busy ? loadingLabel : translate('surface.diffViz.generate') }}
        </button>
        <button v-if="busy" class="app-button app-button--tertiary diff-viz__cancel" type="button" :disabled="cancelling" @click="cancel">
          {{ translate(cancelling ? 'surface.diffViz.cancelling' : 'surface.diffViz.cancel') }}
        </button>
        <el-checkbox v-else v-model="doNotAskAgain" class="diff-viz__consent" :disabled="busy || !active || !preferencesLoaded">{{ translate('surface.diffViz.doNotAskAgain') }}</el-checkbox>
      </div>
    </div>
    <div v-if="diagram" class="diff-viz__legend" :aria-label="translate('surface.diffViz.legend')">
      <span v-for="status in diffVizStatuses" :key="status" :data-status="status"><i aria-hidden="true" />{{ translate(`surface.diffViz.${status}`) }}</span>
    </div>
    <p v-if="error" class="diff-viz__error" role="alert">{{ error }}</p>
    <footer v-if="diagram" class="diff-viz__footer">
      <button class="app-button app-button--tertiary diff-viz__generate" type="button" :disabled="busy || !active" @click="generate">
        <LoaderIcon v-if="busy" class="diff-viz__spinner" aria-hidden="true" />
        {{ busy ? loadingLabel : translate('surface.diffViz.regenerate') }}
      </button>
      <button v-if="busy" class="app-button app-button--tertiary diff-viz__cancel" type="button" :disabled="cancelling" @click="cancel">
        {{ translate(cancelling ? 'surface.diffViz.cancelling' : 'surface.diffViz.cancel') }}
      </button>
      <span class="diff-viz__save">
        <AppMenuButton :ariaLabel="translate('surface.diffViz.save')" :items="saveItems" placement="top-end" @select="saveOrDownload">
          <template #trigger="{ attrs }">
            <button v-bind="attrs" class="app-button app-button--tertiary" type="button" :disabled="busy || saving || !active">
              <LoaderIcon v-if="saving" class="diff-viz__spinner" aria-hidden="true" /><DownloadIcon v-else aria-hidden="true" />
              {{ translate('surface.diffViz.save') }}<ChevronDown aria-hidden="true" />
            </button>
          </template>
        </AppMenuButton>
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { diffVizStatuses, type DiffVizDiagram, type DiffVisualizationMode, type DiffVizLocation } from '@workspace/core/git-diff-viz';
import type { AgentGitDiffTarget, AgentGitDiffScope } from '@workspace/core/contracts';
import { appApi } from '../platform-api';
import { translate } from '../i18n';
import { ElMessage } from 'element-plus';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { AffiliateIcon, ChevronDown, DownloadIcon, FileTextIcon, PhotoIcon, SaveIcon, LoaderIcon } from '../shared/icons/app-icons';
import GitDiffVizCanvas from './GitDiffVizCanvas.vue';
import GitDiffVizMermaid from './GitDiffVizMermaid.vue';

const props = defineProps<{ agentId: string; diff: string; target: AgentGitDiffTarget; scopes?: AgentGitDiffScope[]; active: boolean; mode: DiffVisualizationMode; automatic: boolean; preferencesLoaded: boolean }>();
const emit = defineEmits<{ select: [paths: string[], location?: DiffVizLocation] }>();
function select(paths: string[], location?: DiffVizLocation) { emit('select', paths, location); }
const diagram = shallowRef<DiffVizDiagram>();
const renderer = ref<{ exportDiagram(format: 'native' | 'svg' | 'png'): Promise<Blob> }>();
const saving = ref(false);
const saveItems = computed<AppMenuItem[]>(() => [
  { type: 'action', id: 'save', label: translate('surface.diffViz.saveVisualization'), icon: SaveIcon, disabled: saving.value || busy.value },
  { type: 'separator', id: 'downloads' },
  { type: 'action', id: 'native', label: translate('surface.diffViz.downloadNative', { format: diagram.value?.format === 'mermaid' ? 'Mermaid' : 'Excalidraw' }), icon: FileTextIcon, disabled: saving.value || busy.value },
  { type: 'action', id: 'svg', label: translate('surface.diffViz.downloadSvg'), icon: DownloadIcon, disabled: saving.value || busy.value },
  { type: 'action', id: 'png', label: translate('surface.diffViz.downloadPng'), icon: PhotoIcon, disabled: saving.value || busy.value },
]);
async function saveOrDownload(action: string) {
  const current = diagram.value;
  const view = renderer.value;
  if (!current || !view || busy.value || saving.value || !props.active || !['save', 'native', 'svg', 'png'].includes(action)) return;
  const agentId = props.agentId;
  const request = epoch;
  saving.value = true;
  error.value = '';
  try {
    const blob = await view.exportDiagram(action === 'save' ? 'native' : action as 'native' | 'svg' | 'png');
    const title = current.title || translate('surface.diffViz.savedTitle');
    if (action === 'save') {
      if (!appApi) throw new Error(translate('surface.diffViz.unavailable'));
      await appApi.saveRepositoryVisualization(agentId, { title, content: { kind: current.format, source: await blob.text() } });
      if (!disposed && request === epoch) ElMessage.success(translate('surface.diffViz.saved'));
    } else {
      const extension = action === 'native' ? (current.format === 'mermaid' ? 'mmd' : 'excalidraw') : action;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title.trim().replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'visualization'}.${extension}`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  } catch (cause) { if (!disposed && request === epoch) error.value = message(cause); }
  finally { saving.value = false; }
}
const busy = ref(false);
const loadingLabelIndex = ref(0);
const loadingLabelOrder = shallowRef<number[]>([]);
const loadingLabel = computed(() => translate(`surface.diffViz.loadingLabels.${loadingLabelOrder.value[loadingLabelIndex.value]}`));
watch(busy, (running, _previous, onCleanup) => {
  loadingLabelIndex.value = 0;
  if (!running) return;
  const order = Array.from({ length: 20 }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  loadingLabelOrder.value = order;
  const timer = setInterval(() => {
    loadingLabelIndex.value = (loadingLabelIndex.value + 1) % loadingLabelOrder.value.length;
  }, 5_000);
  onCleanup(() => clearInterval(timer));
}, { flush: 'sync' });
const error = ref('');
const cancelling = ref(false);
let generation: { id: string; agentId: string; cancelled: boolean } | undefined;
const doNotAskAgain = ref(props.automatic);
let epoch = 0;
let disposed = false;
let inFlight = false;

onBeforeUnmount(() => { disposed = true; epoch++; });
watch(() => props.automatic, value => { doNotAskAgain.value = value; });
watch([() => props.agentId, () => props.diff, () => props.mode, () => JSON.stringify([props.target, props.scopes])], () => {
  epoch++;
  diagram.value = undefined;
  error.value = '';
  busy.value = inFlight;
  maybeGenerate();
});
watch([() => props.active, () => props.automatic, () => props.preferencesLoaded], maybeGenerate, { immediate: true });

function maybeGenerate() {
  if (props.active && props.preferencesLoaded && props.automatic && props.diff.trim() && !busy.value && !diagram.value && !error.value) void generate();
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
async function cancel() {
  const current = generation;
  if (!current || cancelling.value) return;
  cancelling.value = true;
  error.value = '';
  current.cancelled = true;
  try {
    if (!appApi) throw new Error(translate('surface.diffViz.unavailable'));
    await appApi.cancelAgentGitMessage(current.agentId, current.id);
  } catch (cause) {
    if (generation === current) { current.cancelled = false; error.value = message(cause); }
  } finally { if (generation === current) cancelling.value = false; }
}
async function generate() {
  if (busy.value || !props.active || !props.diff.trim()) return;
  const request = ++epoch;
  const current = { id: crypto.randomUUID(), agentId: props.agentId, cancelled: false };
  generation = current;
  cancelling.value = false;
  const { agentId, mode } = props;
  const target = { ...props.target };
  const scopes = props.scopes ? [...props.scopes] : undefined;
  busy.value = true;
  inFlight = true;
  error.value = '';
  try {
    if (!appApi) throw new Error(translate('surface.diffViz.unavailable'));
    if (doNotAskAgain.value !== props.automatic) await appApi.updateSettings({ general: { autoGenerateDiffViz: doNotAskAgain.value } });
    if (disposed || request !== epoch || current.cancelled) return;
    const result = await appApi.generateAgentGitMessage(agentId, { kind: 'viz', generationId: current.id, target, ...(scopes ? { scopes } : {}), mode });
    if (disposed || request !== epoch || current.cancelled) return;
    if (result.kind !== 'viz' || result.diagram.format !== (mode === 'fast' ? 'mermaid' : 'excalidraw')) throw new Error(translate('surface.diffViz.invalid'));
    diagram.value = result.diagram;
  } catch (cause) { if (!disposed && request === epoch && !current.cancelled) error.value = message(cause); }
  finally {
    inFlight = false;
    if (generation === current) { generation = undefined; cancelling.value = false; }
    if (!disposed) { busy.value = false; if (request !== epoch && !current.cancelled) maybeGenerate(); }
  }
}
</script>

<style scoped>
.diff-viz { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.diff-viz__title { margin: 0; padding: var(--space-6); color: var(--color-text); font-size: var(--font-size-14); font-weight: var(--font-weight-semibold); }
.diff-viz__empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-6); padding: var(--space-16); text-align: center; }
.diff-viz__illustration { width: var(--space-20); height: var(--space-20); color: var(--color-text-muted); }
.diff-viz__empty strong { color: var(--color-text); font-size: var(--font-size-16); font-weight: var(--font-weight-semibold); }
.diff-viz__empty p { max-width: 36ch; margin: 0 0 var(--space-4); color: var(--color-text-muted); font-size: var(--font-size-13); }
.diff-viz__actions { display: flex; flex-direction: column; align-items: center; gap: var(--space-6); }
.diff-viz__consent { --el-checkbox-font-size: var(--font-size-13); }
.diff-viz__footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: var(--space-4); padding: var(--space-2) var(--space-6); border-top: 1px solid var(--color-border); }
.diff-viz__save { margin-left: auto; }
.diff-viz__error { margin: 0; padding: var(--space-6); color: var(--color-error); font-size: var(--font-size-13); }
.diff-viz__spinner { animation: app-spin 2s linear infinite; }
@media (prefers-reduced-motion: reduce) { .diff-viz__spinner { animation: none; } }
[data-status] { --viz-state-color: var(--color-text-muted); }
[data-status="added"] { --viz-state-color: var(--color-success); }
[data-status="changed"] { --viz-state-color: var(--color-warning); }
[data-status="deleted"] { --viz-state-color: var(--color-error); }
.diff-viz__legend { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-6); padding: var(--space-4) var(--space-6); color: var(--color-text-muted); font-size: var(--font-size-11); }
.diff-viz__legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
.diff-viz__legend i { width: var(--space-3); height: var(--space-3); border: 1px solid var(--viz-state-color); border-radius: var(--radius-xs); background: color-mix(in srgb, var(--viz-state-color) 15%, transparent); }
</style>
