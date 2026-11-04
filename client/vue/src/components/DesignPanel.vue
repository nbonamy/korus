<template>
  <section class="design-panel" :aria-label="t('design.title')" :data-revision="revision">
    <div v-if="error || draftTargetRemoved || tweakDraftRemoved" class="design-panel__error" role="alert">
      <span>{{ error || t(tweakDraftRemoved ? 'design.tweakChanged' : 'design.targetRemoved') }}</span>
      <button v-if="tweakDraft" type="button" class="app-button app-button--primary" :disabled="busy" @click="retryTweak">{{ t('design.retryTweak') }}</button>
      <button v-if="pendingCanvas" type="button" class="app-button app-button--primary" :disabled="busy" @click="retryCanvas">{{ t('design.retryCanvas') }}</button>
      <button type="button" class="app-button app-button--secondary" data-action="reload" :disabled="busy" @click="reload">{{ t('design.discardReload') }}</button>
    </div>
    <div v-if="!current.document" class="design-panel__empty">
      <h2>{{ t('design.emptyTitle') }}</h2>
      <p>{{ t('design.emptyHelp') }}</p>
    </div>
    <template v-else>
      <div ref="body" class="design-panel__body" :class="{ 'design-panel__body--resizing': inspectorResizing }">
        <div class="design-panel__canvas-shell">
          <DesignTools :artboards="current.document.content.artboards" :selected-artboard-id="canvas?.activeArtboardId ?? board?.id ?? null" :locked="locked" :interacting="interacting" :play="play" :pan="pan" :inspector-visible="inspectorVisible" :zoom="canvas?.zoom ?? 1" :zoom-choice="zoomChoice" @focus="focusBoard" @pan="changePan" @play="togglePlay" @inspector="inspectorVisible = !inspectorVisible" @zoom="changeZoom">
            <template #actions>
              <button class="app-icon-button" type="button" :aria-label="t('design.undo')" :title="t('design.undo')" :disabled="locked || !history.canUndo.value" @click="historyAction('undo')"><UndoIcon /></button>
              <button class="app-icon-button" type="button" :aria-label="t('design.redo')" :title="t('design.redo')" :disabled="locked || !history.canRedo.value" @click="historyAction('redo')"><RedoIcon /></button>
              <span class="design-panel__toolbar-divider" />
              <AppMenuButton v-if="current.document" v-model:open="historyVisible" :items="historyItems" :ariaLabel="t('design.history')" :width="280" placement="bottom-start" @select="historyAction">
                <template #trigger="{ attrs }"><button v-bind="attrs" class="app-icon-button" type="button" :aria-label="t('design.history')" :title="`${t('design.history')} · ${t('design.revision', { revision })}`"><HistoryIcon /></button></template>
                <template #before>
                  <form class="design-panel__history" @submit.prevent="checkpoint">
                    <ClearableTextInput v-model="checkpointTitle" subtle :aria-label="t('design.checkpoint')" :placeholder="t('design.checkpoint')" :disabled="locked" />
                    <button class="app-button app-button--secondary app-button--small" type="submit" :aria-label="t('design.saveCheckpoint')" :title="t('design.saveCheckpoint')" :disabled="locked || !checkpointTitle.trim()">{{ t('design.save') }}</button>
                  </form>
                </template>
              </AppMenuButton>
              <AppMenuButton :items="exportItems" :ariaLabel="t('design.export')" :width="190" @select="exportSelection">
                <template #trigger="{ attrs }"><button v-bind="attrs" class="app-icon-button" type="button" :disabled="locked" :aria-label="t('design.export')" :title="t('design.export')"><DownloadIcon /></button></template>
              </AppMenuButton>
            </template>
          </DesignTools>
          <DesignCanvas ref="canvas" :content="canvasContent ?? current.document.content" :document-id="current.document.id" :revision="revision" :selected-artboard-id="board?.id ?? null" :selected-node-id="pan ? null : current.selectedNodeId" :play="play" :locked="locked" :interacting="interacting" :pan="pan" :zoom-choice="zoomChoice" :pending-change="pendingCanvas" @focus="focusBoard" @select="selectCanvasNode" @styles="receiveStyles" @edit="saveCanvas" @interaction="canvasInteraction" @zoom="zoomChoice = $event">
          </DesignCanvas>
          <DesignReviewBar v-if="board && !play" :board="board" :disabled="locked || !!reviewCommentDraft" :commenting="!!reviewCommentDraft" @comment="beginComment" @build="reviewBuild">
            <template #comment>
              <form v-if="reviewCommentDraft" class="design-panel__review-comment" :aria-label="t('design.commentOn', { title: reviewCommentDraft.title })" @submit.prevent="sendReviewComment">
                <strong>{{ t('design.commentOn', { title: reviewCommentDraft.title }) }}</strong>
                <ul v-if="reviewComments.length" class="design-panel__comments"><li v-for="item in reviewComments" :key="item.id">{{ item.text }}</li></ul>
                <textarea ref="reviewCommentInput" v-model="reviewCommentDraft.text" :aria-label="t('design.proposalComment')" :placeholder="t('design.commentPlaceholder')" rows="3" :disabled="busy" />
                <p v-if="error" role="alert">{{ error }}</p>
                <div class="design-panel__actions">
                  <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="reviewCommentDraft = undefined">{{ t('common.cancel') }}</button>
                  <button class="app-button app-button--primary" type="submit" :disabled="locked || !reviewCommentDraft.text.trim()">{{ t('design.sendComment') }}</button>
                </div>
              </form>
            </template>
          </DesignReviewBar>
        </div>
        <PaneTransition :enabled="!inspectorResizing">
        <div v-if="!play" v-show="inspectorVisible" ref="inspector" class="design-panel__inspector-shell" :style="{ '--design-inspector-width': `${inspectorWidth}px` }">
          <div class="design-panel__inspector-resizer" role="separator" :aria-label="t('design.resizeInspector')" aria-orientation="vertical" tabindex="0" aria-valuemin="220" :aria-valuemax="body?.clientWidth || 800" :aria-valuenow="inspectorWidth" @pointerdown="startInspectorResize" @keydown.left.prevent="resizeInspector(inspectorWidth + 16)" @keydown.right.prevent="resizeInspector(inspectorWidth - 16)" />
        <div class="design-panel__inspector" :inert="interacting || !!pendingCanvas">
          <el-tabs v-model="inspectorTab" class="design-panel__tabs">
            <el-tab-pane name="properties" :label="t('design.properties')" :disabled="!!tweakDraft">
              <fieldset class="design-panel__fields" :disabled="busy && !autoSaving">
                <DesignLayers v-if="board" class="design-panel__tree" :board="board" :selected-id="current.selectedNodeId" :disabled="locked" @select="selectNode" />
                <template v-if="selected">
                  <FormSection v-if="!selected.children?.length && !['img', 'input', 'br', 'hr'].includes(selected.tag)" class="design-panel__section" density="compact" :title="t('design.textContent')">
                    <textarea v-model="textDraft" :aria-label="t('design.text')" rows="3" @input="queueApply" @change="apply" />
                  </FormSection>
                  <FormSection v-for="section in propertySections" :key="section.title" class="design-panel__section" density="compact" :title="t(section.title)">
                    <template v-for="property in section.fields" :key="property.key">
                      <h4 v-if="property.heading" class="design-panel__subsection">{{ t(property.heading) }}</h4>
                      <FormRow as="label" :title="t(property.label)">
                        <template #control>
                          <select v-if="property.key === '@layout'" :value="layoutChoice" :aria-label="t(property.label)" @change="changeLayout(($event.target as HTMLSelectElement).value)">
                            <option v-for="option in ['block', 'row', 'column', 'grid', 'inline', 'inline-block', 'none']" :key="option" :value="option">{{ option }}</option>
                          </select>
                          <select v-else-if="property.key === '@type'" v-model="controlTypeDraft" :aria-label="t(property.label)" @change="queueApply">
                            <option v-for="option in controlTypes" :key="option" :value="option">{{ option }}</option>
                          </select>
                          <span v-else-if="property.key === '@spacing'" class="design-panel__paired-inputs">
                            <input v-model="styleDraft['line-height']" :aria-label="t('design.lineHeight')" :title="t('design.lineHeight')" @input="queueApply" @change="apply" />
                            <input v-model="styleDraft['letter-spacing']" :aria-label="t('design.letterSpacing')" :title="t('design.letterSpacing')" @input="queueApply" @change="apply" />
                          </span>
                          <select v-else-if="property.options" v-model="styleDraft[property.key]" :aria-label="t(property.aria ?? property.label)" @change="queueApply">
                            <option v-if="styleDraft[property.key] && !property.options.includes(styleDraft[property.key] ?? '')" :value="styleDraft[property.key]">{{ styleDraft[property.key] }}</option>
                            <option v-for="option in property.options" :key="option" :value="option">{{ option }}</option>
                          </select>
                          <input v-else v-model="styleDraft[property.key]" :aria-label="t(property.aria ?? property.label)" @input="changeProperty(property.key)" @change="apply" />
                        </template>
                      </FormRow>
                    </template>
                  </FormSection>
                </template>
              </fieldset>
            </el-tab-pane>
            <el-tab-pane name="code" :label="t('design.code')" :disabled="dirty || !!tweakDraft">
              <DesignCode v-if="board && inspectorTab === 'code'" :node="selected ?? board.root" :styles="codeStyles?.nodeId === (selected ?? board.root).id && codeStyles.revision === revision ? codeStyles.styles : undefined" />
            </el-tab-pane>
            <el-tab-pane name="tweaks" :label="t('design.tweaks')" :disabled="dirty">
              <DesignTweaks :tweaks="tweaks" :nodes="nodes" :draft="tweakDraft" :disabled="busy || dirty || interacting || !!pendingCanvas || !!tweakDraft && !!error" @preview="previewTweak" @commit="saveTweak" />
            </el-tab-pane>
          </el-tabs>
        </div>
        </div>
        </PaneTransition>
      </div>
    </template>
    <FormDialog v-model="buildVisible" :title="t('design.sendForCoding')" width="420px" compact>
      <div v-if="buildDraft" class="design-panel__build-summary">
        <strong>{{ buildDraft.title }}</strong>
        <p v-if="buildDraft.notes">{{ buildDraft.notes }}</p>
        <p>{{ t('design.buildHelp') }}</p>
        <p v-if="error" role="alert">{{ error }}</p>
      </div>
      <template #footer>
        <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="buildVisible = false">{{ t('common.cancel') }}</button>
        <button class="app-button app-button--primary" type="button" data-action="implement" :disabled="busy" @click="implement">{{ t('design.sendForCoding') }}</button>
      </template>
    </FormDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRaw, watch } from 'vue';
import { ElMessage } from 'element-plus';
import DesignReviewBar from './DesignReviewBar.vue';
import DesignCode from './DesignCode.vue';
import type { DesignEdit, DesignInteraction as DesignInteractionValue, DesignRequest, DesignResult, DesignWorkspace } from '@workspace/core/design';
import { designNodes } from '@workspace/core/design';
import { designTweakCss, type DesignTweak, type DesignTweakValue } from '@workspace/core/design-tweaks';
import { translate as t } from '../i18n';
import ClearableTextInput from '../shared/form/ClearableTextInput.vue';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormDialog from '../shared/dialog/FormDialog.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import PaneTransition from '../shared/PaneTransition.vue';
import { useCollapsiblePaneResize } from '../shared/use-collapsible-pane-resize';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { ArrowBackUpIcon as UndoIcon, ArrowForwardUpIcon as RedoIcon, HistoryIcon, DownloadIcon } from '../shared/icons/app-icons';
import DesignCanvas from './DesignCanvas.vue';
import DesignTools from './DesignTools.vue';
import DesignTweaks from './DesignTweaks.vue';
import DesignLayers from './DesignLayers.vue';
import type { DesignCanvasChange } from './design-frame';
import { createDesignHistory } from './design-history';

const props = defineProps<{ agentId: string; workspace: DesignWorkspace; execute: (request: DesignRequest) => Promise<DesignResult> }>();
const current = ref(props.workspace);
// Undo and redo are the client's: the daemon only ever receives the content to restore.
const history = createDesignHistory(props.agentId);
const savedDocument = () => {
  const document = current.value.document;
  return document ? { id: document.id, revision: document.revision, content: toRaw(document.content) } : null;
};
watch(() => current.value.document, () => history.observe(savedDocument()), { immediate: true, flush: 'sync' });
const inspectorVisible = ref(!!props.workspace.selectedNodeId);
const inspectorWidth = ref(280);
const body = ref<HTMLElement>();
const inspector = ref<HTMLElement>();
const { resizing: inspectorResizing, start: startPaneResize } = useCollapsiblePaneResize();
function resizeInspector(width: number) {
  inspectorWidth.value = Math.round(Math.max(220, Math.min(width, body.value?.getBoundingClientRect().width || 800)));
}
function startInspectorResize(event: PointerEvent) {
  const width = inspector.value?.getBoundingClientRect().width || inspectorWidth.value;
  const startX = event.clientX;
  startPaneResize(event, {
    minimum: 220,
    width,
    widthAt: move => width + startX - move.clientX,
    resize: resizeInspector,
    setOpen: open => { inspectorVisible.value = open; },
  });
}
const reviewCommentInput = ref<HTMLTextAreaElement>();
const reviewCommentDraft = ref<{ nodeId: string; title: string; revision: number; text: string }>();
const buildVisible = ref(false);
const buildDraft = ref<{ artboardId: string; title: string; notes?: string; revision: number }>();
const historyVisible = ref(false);
const inspectorTab = ref('properties');
const codeStyles = ref<{ nodeId: string; revision: number; styles: Record<string, string>; properties: Record<string, string> }>();
function receiveStyles(artboardId: string, nodeId: string, frameRevision: number, styles: Record<string, string>, properties: Record<string, string>) {
  if (artboardId !== board.value?.id || nodeId !== (selected.value ?? board.value?.root)?.id || frameRevision !== revision.value) return;
  codeStyles.value = { nodeId, revision: frameRevision, styles, properties };
  if (!dirty.value) resetDraft();
}
const tweakDraft = ref<{ tweakId: string; value: DesignTweakValue; expectedRevision: number; definition: DesignTweak } | null>(null);
const canvas = ref<InstanceType<typeof DesignCanvas>>();
const pan = ref(false);
const play = ref(false);
const zoomChoice = ref<number | 'fit' | 'selection'>(props.workspace.selectedNodeId ? 'selection' : 'fit');
const busy = ref(false);
const dirty = ref(false);
const autoSaving = ref(false);
let applyTimer: ReturnType<typeof setTimeout> | undefined;
const error = ref('');
const textDraft = ref('');
const styleDraft = ref<Record<string, string>>({});
const styleBaseline = ref<Record<string, string>>({});
const controlTypeDraft = ref('');
const interactionDraft = ref<DesignInteractionValue | null>(null);
const checkpointTitle = ref('');
const draftRevision = ref(0);
const draftNodeId = ref<string | null>(null);
const interacting = ref(false);
const pendingCanvas = ref<DesignCanvasChange | null>(null);
let interactingArtboardId: string | null = null;
const locked = computed(() => busy.value || dirty.value || interacting.value || !!pendingCanvas.value || !!tweakDraft.value);
const revision = computed(() => current.value.document?.revision ?? 0);
const board = computed(() => current.value.document?.content.artboards.find(item => item.id === current.value.selectedArtboardId) ?? current.value.document?.content.artboards[0]);
const nodes = computed(() => board.value && current.value.document ? designNodes({ ...current.value.document.content, artboards: [board.value] }) : []);
const draftTargetRemoved = computed(() => dirty.value && !nodes.value.some(node => node.id === draftNodeId.value));
const tweaks = computed(() => current.value.document?.content.tweaks?.filter(tweak => nodes.value.some(node => node.id === tweak.nodeId)) ?? []);
const tweakDraftRemoved = computed(() => {
  const draft = tweakDraft.value;
  return !!draft && !tweaks.value.some(tweak => tweak.id === draft.tweakId);
});
const canvasContent = computed(() => {
  const content = current.value.document?.content;
  if (!content || !tweakDraft.value) return content;
  const preview = JSON.parse(JSON.stringify(content)) as typeof content;
  const { definition, value } = tweakDraft.value;
  const node = designNodes(preview).find(item => item.id === definition.nodeId);
  if (node) node.styles = { ...node.styles, [definition.property]: designTweakCss(definition, value) };
  return preview;
});
const selected = computed(() => nodes.value.find(node => node.id === current.value.selectedNodeId));
const reviewComments = computed(() => current.value.document?.content.comments.filter(item => item.nodeId === reviewCommentDraft.value?.nodeId) ?? []);
const historyItems = computed<AppMenuItem[]>(() => [
  ...current.value.checkpoints.map(item => ({ type: 'action' as const, id: `restore:${item.id}`, label: t('design.restoreNamed', { name: item.title }), disabled: locked.value })),
]);
const exportItems = computed<AppMenuItem[]>(() => [
  { type: 'action', id: 'selected', label: t('design.exportArtboard') },
  { type: 'action', id: 'all', label: t('design.exportAll') },
]);
type InspectorField = { key: string; label: string; aria?: string; heading?: string; options?: string[] };
const propertySections = computed<{ title: string; fields: InspectorField[] }[]>(() => [
  { title: 'design.size', fields: [
    { key: 'width', label: 'design.width' }, { key: 'height', label: 'design.height' },
    { key: 'position', label: 'design.position', options: ['static', 'relative', 'absolute', 'fixed', 'sticky'] },
    { key: 'flex-grow', label: 'design.grow' },
  ] },
  { title: 'design.layout', fields: [{ key: '@layout', label: 'design.layout' }, { key: 'margin', label: 'design.margin' }, { key: 'padding', label: 'design.padding' }] },
  ...(selected.value && ['button', 'input'].includes(selected.value.tag) ? [{ title: 'design.control', fields: [{ key: '@type', label: 'design.type' }] }] : []),
  { title: 'design.appearance', fields: [
    { key: 'background-color', label: 'design.fill' }, { key: 'opacity', label: 'design.opacity' }, { key: 'border-radius', label: 'design.radius' },
    { key: 'border-color', label: 'design.colorLabel', aria: 'design.borderColor', heading: 'design.border' },
    { key: 'border-width', label: 'design.width', aria: 'design.borderWidth' },
  ] },
  { title: 'design.text', fields: [
    { key: 'font-style', label: 'design.textStyle', options: ['normal', 'italic', 'oblique'] },
    { key: 'font-family', label: 'design.font', aria: 'design.fontFamily' },
    { key: 'font-weight', label: 'design.weight', options: ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'] },
    { key: 'font-size', label: 'design.size', aria: 'design.fontSize' }, { key: '@spacing', label: 'design.spacing' },
    { key: 'color', label: 'design.colorLabel', aria: 'design.color' },
    { key: 'text-align', label: 'design.align', options: ['start', 'left', 'center', 'right', 'justify', 'end'] },
  ] },
]);
const controlTypes = computed(() => selected.value?.tag === 'button' ? ['button', 'submit', 'reset'] : ['text', 'email', 'password', 'number', 'tel', 'url', 'search', 'checkbox', 'radio', 'date', 'time', 'range', 'color', 'file', 'hidden']);
const layoutChoice = computed(() => ['flex', 'inline-flex'].includes(styleDraft.value.display ?? '') ? styleDraft.value['flex-direction']?.startsWith('column') ? 'column' : 'row' : styleDraft.value.display);
function changeLayout(layout: string) {
  styleDraft.value.display = layout === 'row' || layout === 'column' ? 'flex' : layout;
  if (layout === 'row' || layout === 'column') styleDraft.value['flex-direction'] = layout;
  queueApply();
}
function changeProperty(property: string) {
  if ((property === 'border-color' || property === 'border-width') && (!styleDraft.value['border-style'] || styleDraft.value['border-style'] === 'none')) styleDraft.value['border-style'] = 'solid';
  queueApply();
}
watch(() => props.workspace, workspace => { current.value = workspace; });
watch([selected, revision], () => { if (!dirty.value) resetDraft(); }, { immediate: true });
function resetDraft() {
  textDraft.value = selected.value?.text ?? '';
  controlTypeDraft.value = selected.value?.attributes?.type ?? (selected.value?.tag === 'button' ? 'button' : 'text');
  const inspected = codeStyles.value;
  const applied = inspected && selected.value && inspected.nodeId === selected.value.id && inspected.revision === revision.value ? inspected.properties : {};
  styleDraft.value = { ...applied, ...selected.value?.styles };
  styleBaseline.value = { ...styleDraft.value };
  interactionDraft.value = selected.value?.interaction ? { ...selected.value.interaction } : selected.value?.toggleTargetId ? { type: 'toggle', nodeId: selected.value.toggleTargetId } : null;
  draftRevision.value = revision.value;
  draftNodeId.value = selected.value?.id ?? null;
  dirty.value = false;
}
async function mutate(request: DesignRequest): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  error.value = '';
  try {
    // Native IPC cannot clone Vue proxies retained in gesture or form drafts.
    const result = await props.execute(JSON.parse(JSON.stringify(request)) as DesignRequest);
    if ((result.workspace.document?.revision ?? 0) >= revision.value || request.type === 'read') current.value = result.workspace;
    return true;
  } catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure); return false; }
  finally { busy.value = false; }
}
async function apply() {
  clearTimeout(applyTimer);
  if (!dirty.value || !draftNodeId.value || autoSaving.value) return;
  if (busy.value) { queueApply(); return; }
  const edits: DesignEdit[] = [];
  const original = nodes.value.find(node => node.id === draftNodeId.value);
  if (!original) { error.value = t('design.targetRemoved'); return; }
  if (textDraft.value !== (original.text ?? '') && !original.children?.length) edits.push({ type: 'text', nodeId: draftNodeId.value, text: textDraft.value });
  const changedStyles = Object.fromEntries(Object.entries(styleDraft.value).filter(([key, value]) => value !== (styleBaseline.value[key] ?? '')).map(([key, value]) => [key, value.trim() ? value : null]));
  if (Object.keys(changedStyles).length) edits.push({ type: 'style', nodeId: draftNodeId.value, styles: changedStyles });
  if (['button', 'input'].includes(original.tag) && controlTypeDraft.value !== (original.attributes?.type ?? (original.tag === 'button' ? 'button' : 'text'))) edits.push({ type: 'attributes', nodeId: original.id, attributes: { type: controlTypeDraft.value } });
  const originalAction = original.interaction ?? (original.toggleTargetId ? { type: 'toggle', nodeId: original.toggleTargetId } : null);
  if (JSON.stringify(interactionDraft.value) !== JSON.stringify(originalAction)) edits.push({ type: 'interaction', nodeId: draftNodeId.value, interaction: interactionDraft.value });
  if (!edits.length) { resetDraft(); return; }
  const submitted = draftSignature();
  const submittedStyles = { ...styleDraft.value };
  const submittedRevision = draftRevision.value;
  autoSaving.value = true;
  try {
    if (await mutate({ type: 'edit', expectedRevision: submittedRevision, edits })) {
      if (draftSignature() === submitted) resetDraft();
      else { styleBaseline.value = submittedStyles; draftRevision.value = submittedRevision + 1; queueApply(); }
    }
  } finally { autoSaving.value = false; }
}
function draftSignature() { return JSON.stringify([draftNodeId.value, textDraft.value, styleDraft.value, interactionDraft.value, controlTypeDraft.value]); }
function queueApply() {
  dirty.value = true;
  clearTimeout(applyTimer);
  applyTimer = setTimeout(() => void apply(), 400);
}
onBeforeUnmount(() => { clearTimeout(applyTimer); if (dirty.value && !busy.value) void apply(); });
async function reload() { if (await mutate({ type: 'read' })) { pendingCanvas.value = null; tweakDraft.value = null; interacting.value = false; interactingArtboardId = null; dirty.value = false; resetDraft(); } }
function previewTweak(tweak: DesignTweak, value: DesignTweakValue) {
  if (busy.value || dirty.value || interacting.value || pendingCanvas.value) return;
  if (tweakDraft.value && tweakDraft.value.tweakId !== tweak.id) return;
  try { designTweakCss(tweak, value); }
  catch (failure) { error.value = String(failure); return; }
  tweakDraft.value = { tweakId: tweak.id, value, expectedRevision: tweakDraft.value?.expectedRevision ?? revision.value, definition: tweakDraft.value?.definition ?? JSON.parse(JSON.stringify(tweak)) };
}
async function saveTweak(tweak: DesignTweak, value: DesignTweakValue) {
  previewTweak(tweak, value);
  const draft = tweakDraft.value;
  if (!draft || busy.value) return;
  if (await mutate({ type: 'edit', expectedRevision: draft.expectedRevision, edits: [{ type: 'tweak-value', tweakId: draft.tweakId, value: draft.value }] })) tweakDraft.value = null;
}
async function retryTweak() {
  const draft = tweakDraft.value;
  if (!draft || !await mutate({ type: 'read' })) return;
  const definition = current.value.document?.content.tweaks?.find(tweak => tweak.id === draft.tweakId);
  if (JSON.stringify(definition) !== JSON.stringify(draft.definition)) { error.value = t('design.tweakChanged'); return; }
  draft.expectedRevision = revision.value;
  await saveTweak(draft.definition, draft.value);
}
async function selectNode(nodeId: string) {
  if (dirty.value || !board.value) return;
  await mutate({ type: 'select', artboardId: board.value.id, nodeId });
}
async function selectBoard(artboardId: string) {
  if (dirty.value) { error.value = t('design.applyFirst'); return; }
  await mutate({ type: 'select', artboardId, nodeId: null });
}
async function focusBoard(artboardId: string) {
  if (locked.value) return;
  play.value = false; pan.value = false; zoomChoice.value = 'selection';
  await selectBoard(artboardId);
  await canvas.value?.focus(artboardId);
}
function changeZoom(value: number | 'fit' | 'selection') { if (value === 'fit') { play.value = false; pan.value = false; } zoomChoice.value = value; }
function togglePlay() { play.value = !play.value; pan.value = false; zoomChoice.value = 'selection'; }
async function changePan(value: boolean) {
  pan.value = value;
  if (value && board.value && current.value.selectedNodeId) await selectCanvasNode(board.value.id, null);
}
async function selectCanvasNode(artboardId: string, nodeId: string | null) {
  if (locked.value) return;
  if (artboardId !== board.value?.id && zoomChoice.value === 'selection' && canvas.value) zoomChoice.value = canvas.value.zoom;
  await mutate({ type: 'select', artboardId, nodeId });
}
function canvasInteraction(artboardId: string, active: boolean) {
  if (active && locked.value || interactingArtboardId && interactingArtboardId !== artboardId) return;
  interactingArtboardId = active ? artboardId : null;
  interacting.value = active;
}
async function beginComment() {
  if (locked.value || !board.value) return;
  reviewCommentDraft.value = { nodeId: board.value.root.id, title: board.value.title, revision: revision.value, text: '' };
  error.value = '';
  await nextTick(); reviewCommentInput.value?.focus();
}
async function sendReviewComment() {
  const draft = reviewCommentDraft.value;
  if (draft && await mutate({ type: 'comment', expectedRevision: draft.revision, nodeId: draft.nodeId, text: draft.text })) reviewCommentDraft.value = undefined;
}
async function reviewBuild() {
  if (locked.value || !board.value) return;
  if (!await mutate({ type: 'read' }) || !board.value) return;
  buildDraft.value = { artboardId: board.value.id, title: board.value.title, notes: board.value.notes, revision: revision.value };
  error.value = ''; buildVisible.value = true;
}
async function implement() {
  const draft = buildDraft.value;
  if (!draft || busy.value) return;
  const accepted = await mutate({ type: 'implement', expectedRevision: draft.revision, artboardId: draft.artboardId });
  // A rejected submission may already have saved the choice. Return to the
  // canvas so another attempt reviews fresh state before confirming it.
  buildVisible.value = false;
  buildDraft.value = undefined;
  if (accepted) ElMessage.success(t('design.sentForCoding'));
}
async function checkpoint() {
  if (await mutate({ type: 'checkpoint', expectedRevision: revision.value, title: checkpointTitle.value })) { checkpointTitle.value = ''; historyVisible.value = false; }
}
async function historyAction(action: string) {
  if (action === 'undo' || action === 'redo') await history.step(action, async content => await mutate({ type: 'replace', expectedRevision: revision.value, content }) && savedDocument());
  else if (action.startsWith('restore:')) await mutate({ type: 'restore', expectedRevision: revision.value, checkpointId: action.slice(8) });
}
function exportSelection(action: string) { void download(action === 'selected' ? canvas.value?.activeArtboardId ?? board.value?.id : undefined); }
async function download(artboardId?: string) {
  try {
    const result = await props.execute({ type: 'export', ...(artboardId ? { artboardId } : {}) });
    const title = current.value.document!.content.title.replace(/[^a-z0-9_-]/gi, '-') || 'design';
    for (const [extension, content, mime] of [['html', result.html!, 'text/html'], ['md', result.handoff!, 'text/markdown']]) {
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const link = document.createElement('a'); link.href = url; link.download = `${title}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (result.screenshot) { const image = document.createElement('a'); image.href = result.screenshot; image.download = `${title}.png`; image.click(); }
  } catch (failure) { error.value = String(failure); }
}
async function saveCanvas(change: DesignCanvasChange) {
  if (await mutate({ type: 'edit', expectedRevision: change.expectedRevision, edits: [change.edit] })) {
    pendingCanvas.value = null;
    if (current.value.selectedNodeId !== change.nodeId || current.value.selectedArtboardId !== change.artboardId) await mutate({ type: 'select', artboardId: change.artboardId, nodeId: change.nodeId });
  } else {
    pendingCanvas.value = change;
    if (!error.value) error.value = t('design.canvasNotSaved');
  }
  interacting.value = false;
  interactingArtboardId = null;
}
async function retryCanvas() {
  const change = pendingCanvas.value;
  if (!change || !await mutate({ type: 'read' })) return;
  await saveCanvas({ ...change, expectedRevision: revision.value });
}
</script>

<style scoped>
.design-panel__review-comment {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  font-size: var(--font-size-13);
}
.design-panel__review-comment strong { font-weight: var(--font-weight-medium); }
.design-panel__review-comment textarea { resize: vertical; min-height: 72px; max-height: 200px; }
.design-panel__review-comment .design-panel__comments { max-height: 140px; overflow: auto; }
.design-panel__review-comment .design-panel__actions { justify-content: flex-end; }
.design-panel {
  container: design-panel / inline-size;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-surface);
}

.design-panel__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.design-panel__toolbar-divider { width: 1px; height: var(--space-8); margin-inline: var(--space-2); flex: none; background: var(--color-border); }

.design-panel__canvas-shell {
  container: design-canvas-controls / inline-size;
  display: flex;
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.design-panel__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.design-panel .app-icon-button[aria-pressed="true"] {
  background: var(--color-primary-container);
  color: var(--color-primary);
}

.design-panel__inspector-shell {
  --design-inspector-width: 280px;

  background: var(--color-surface-lowest);
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 48%;
  flex: none;
  border-top: 1px solid var(--color-border);
}

.design-panel__inspector {
  position: relative;
  padding: var(--space-3);
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: var(--space-3);
  overflow: auto;
}

.design-panel__inspector-resizer { display: none; }

.design-panel__body--resizing { cursor: col-resize; user-select: none; }
.design-panel__body--resizing :deep(iframe) { pointer-events: none; }

@container design-panel (min-width: 720px) {
  .design-panel__body {
    flex-direction: row;
  }

  .design-panel__inspector-shell {
    flex-direction: row;
    flex-basis: min(var(--design-inspector-width), 100%);
    width: min(var(--design-inspector-width), 100%);
    max-height: none;
    border-top: 0;
  }

  .design-panel__inspector-resizer {
    display: block;
    flex: 0 0 5px;
    border-left: 1px solid var(--color-border);
    cursor: col-resize;
    touch-action: none;
  }

  .design-panel__inspector-resizer:hover,
  .design-panel__inspector-resizer:focus-visible { border-left-color: var(--color-primary); outline: 0; }
}

.design-panel__build-summary p {
  color: var(--color-text-muted);
  line-height: var(--line-height-20);
}

.design-panel__fields {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.design-panel__tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-3);
}

.design-panel__tabs :deep(.el-tabs__item) {
  height: 32px;
  font-size: var(--font-size-13);
}

.design-panel__tree { padding-bottom: var(--space-6); margin-bottom: var(--space-4); border-bottom: 1px solid var(--color-border); }
.design-panel__section { padding-block: var(--space-3); }
.design-panel__subsection { margin: var(--space-4) 0 var(--space-2); color: var(--color-text-muted); font-size: var(--font-size-12); font-weight: var(--font-weight-medium); }
.design-panel__paired-inputs { display: flex; flex: 1; width: 100%; gap: var(--space-2); min-width: 0; }
.design-panel__paired-inputs input { flex: 1; min-width: 0; }
.design-panel__fields :deep(.form-section + .form-section) { margin-top: 0; }
.design-panel__section :deep(.form-section__group) { border: 0; border-radius: 0; background: transparent; overflow: visible; }
.design-panel__section :deep(.form-section__header) { min-height: 0; padding-bottom: var(--space-2); }
.design-panel__section :deep(.app-section-label) { margin: 0; color: var(--color-text); font-size: var(--font-size-12); font-weight: var(--font-weight-semibold); text-transform: none; letter-spacing: normal; }
.design-panel__inspector .design-panel__fields :deep(.form-section--compact .form-row) { grid-template-columns: 80px minmax(0, 1fr); min-height: 0; gap: var(--space-2); padding: var(--space-1) 0; }
.design-panel__fields .design-panel__section :deep(.form-row + .form-row) { border-top: 0; }
.design-panel__section :deep(.form-row__copy strong) { color: var(--color-text-muted); font-size: var(--font-size-12); font-weight: var(--font-weight-regular); }
.design-panel__section :deep(.form-row__control) { width: 100%; min-width: 0; }
.design-panel .design-panel__inspector input,
.design-panel .design-panel__inspector select,
.design-panel .design-panel__inspector textarea { background: var(--color-surface-lowest); }
.design-panel .design-panel__inspector input,
.design-panel__inspector .design-panel__fields :deep(select) { height: 24px; padding: var(--space-1) var(--space-3); font-size: var(--font-size-12); line-height: 18px; }

.design-panel input,
.design-panel select,
.design-panel textarea,
.design-panel__history input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

.design-panel textarea {
  resize: vertical;
}

.design-panel :deep(input:focus-visible),
.design-panel :deep(textarea:focus-visible),
.design-panel :deep(select:focus-visible) {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.design-panel__review-comment textarea,
.design-panel__review-comment textarea:focus-visible {
  padding: var(--space-4) 0;
  border: 0;
  border-radius: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
}

.design-panel__actions [role="status"] {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.design-panel__error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  color: var(--color-error);
}

.design-panel__empty {
  margin: auto;
  padding: var(--space-6);
  text-align: center;
  max-width: 40ch;
}

.design-panel__empty h2 {
  font-size: var(--font-size-16);
}

.design-panel__empty p {
  color: var(--color-text-muted);
  line-height: 1.5;
}

.design-panel__comments {
  margin: 0;
  padding-left: var(--space-4);
  font-size: var(--font-size-13);
}

.design-panel__history {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.design-panel__history > :first-child { flex: 1; min-width: 0; }
.design-panel__history :deep(.clearable-text-input--subtle) { min-height: 28px; }
.design-panel__history :deep(input) { font-size: var(--font-size-13); }
.design-panel__history > button { flex: none; height: 28px; }

.design-panel__board-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.design-panel__dimensions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}
</style>
