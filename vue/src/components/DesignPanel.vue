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
      <div class="design-panel__body">
        <div class="design-panel__canvas-shell">
          <DesignTools :artboards="current.document.content.artboards" :selected-artboard-id="canvas?.activeArtboardId ?? board?.id ?? null" :locked="locked" :interacting="interacting" :play="play" :pan="pan" :inspector-visible="inspectorVisible" :zoom="canvas?.zoom ?? 1" :zoom-choice="zoomChoice" @focus="focusBoard" @pan="pan = $event" @play="togglePlay" @inspector="inspectorVisible = !inspectorVisible" @zoom="changeZoom">
            <template #actions>
              <AppMenuButton :items="exportItems" :ariaLabel="t('design.export')" :width="190" @select="exportSelection">
                <template #trigger="{ attrs }"><button v-bind="attrs" class="app-icon-button" type="button" :disabled="locked" :aria-label="t('design.export')" :title="t('design.export')"><DownloadIcon /></button></template>
              </AppMenuButton>
            </template>
          </DesignTools>
          <DesignCanvas ref="canvas" :content="canvasContent ?? current.document.content" :document-id="current.document.id" :revision="revision" :selected-artboard-id="board?.id ?? null" :selected-node-id="current.selectedNodeId" :play="play" :locked="locked" :interacting="interacting" :pan="pan" :zoom-choice="zoomChoice" :pending-change="pendingCanvas" @focus="focusBoard" @select="selectCanvasNode" @edit="saveCanvas" @interaction="canvasInteraction" @zoom="zoomChoice = $event">
            <template #history>
              <AppMenuButton v-if="current.document" v-model:open="historyVisible" :items="historyItems" :ariaLabel="t('design.history')" :width="280" placement="bottom-start" @select="historyAction">
                <template #trigger="{ attrs }"><button v-bind="attrs" class="app-icon-button" type="button" :aria-label="t('design.history')" :title="`${t('design.history')} · ${t('design.revision', { revision })}`"><HistoryIcon /></button></template>
                <template #before>
                  <form class="design-panel__history" @submit.prevent="checkpoint">
                    <FormField density="compact" :label="t('design.checkpoint')">
                      <div class="design-panel__actions">
                        <input v-model="checkpointTitle" :aria-label="t('design.checkpoint')" />
                        <button class="app-button app-button--secondary" type="submit" :disabled="locked || !checkpointTitle.trim()">{{ t('design.saveCheckpoint') }}</button>
                      </div>
                    </FormField>
                  </form>
                </template>
              </AppMenuButton>
            </template>
          </DesignCanvas>
          <DesignReviewBar v-if="board && !play" :board="board" :chosen="current.document.content.chosenArtboardId === board.id" :disabled="locked || !!reviewCommentDraft" :commenting="!!reviewCommentDraft" @comment="beginComment" @choose="chooseBoard(board.id)" @build="reviewBuild">
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
        <div v-if="!play" v-show="inspectorVisible" class="design-panel__inspector" :inert="interacting || !!pendingCanvas">
          <button class="app-icon-button design-panel__close-inspector" type="button" :aria-label="t('design.closeInspector')" :title="t('design.closeInspector')" :disabled="interacting" @click="inspectorVisible = false"><XIcon /></button>
          <el-tabs v-model="inspectorTab" class="design-panel__tabs">
            <el-tab-pane name="properties" :label="t('design.properties')" :disabled="!!tweakDraft">
              <fieldset class="design-panel__fields" :disabled="busy">
                <AppMenuButton :items="artboardItems" :ariaLabel="t('design.artboardActions')" :width="210" @select="artboardAction">
                  <template #trigger="{ attrs }"><button v-bind="attrs" class="app-button app-button--tertiary" type="button" :disabled="locked" :aria-label="t('design.artboardActions')">{{ t('design.artboardActions') }}<ChevronDown /></button></template>
                </AppMenuButton>
                <DesignLayers v-if="board" :board="board" :selected-id="current.selectedNodeId" :disabled="locked" @select="selectNode" @edit="editElements" />
                <template v-if="selected || elementCommentDraft">
                  <FormField density="compact" :label="elementCommentDraft ? t('design.commentOn', { title: elementCommentDraft.title }) : t('design.comment')">
                    <textarea v-model="commentDraft" :aria-label="t('design.comment')" rows="2" />
                  </FormField>
                  <div class="design-panel__actions">
                    <button v-if="elementCommentDraft" class="app-button app-button--secondary" type="button" data-action="discard-comment" @click="elementCommentDraft = undefined">{{ t('common.cancel') }}</button>
                    <button class="app-button app-button--secondary" type="button" data-action="comment" :disabled="locked || !commentDraft.trim()" @click="comment">{{ t('design.sendComment') }}</button>
                  </div>
                  <ul v-if="comments.length" class="design-panel__comments">
                    <li v-for="item in comments" :key="item.id">{{ item.text }}</li>
                  </ul>
                </template>
                <template v-if="selected">
                  <FormField v-if="!selected.children?.length && !['img', 'input', 'br', 'hr'].includes(selected.tag)" density="compact" :label="t('design.text')">
                    <textarea v-model="textDraft" :aria-label="t('design.text')" rows="2" @input="dirty = true" />
                  </FormField>
                  <div class="design-panel__properties">
                    <FormField v-for="property in properties" :key="property.key" density="compact" :label="t(property.label)">
                      <input v-model="styleDraft[property.key]" :aria-label="t(property.label)" @input="dirty = true" />
                    </FormField>
                  </div>
                  <DesignLayout :styles="styleDraft" @change="styleDraft = $event; dirty = true" />
                  <DesignInteraction :model-value="interactionDraft" :artboards="current.document.content.artboards" :nodes="nodes" @update:model-value="interactionDraft = $event; dirty = true" />
                  <div class="design-panel__actions">
                    <span role="status">{{ t(busy ? 'design.saving' : dirty ? 'design.unsaved' : 'design.saved') }}</span>
                    <button v-if="dirty" class="app-button app-button--secondary" type="button" @click="reload">{{ t('common.cancel') }}</button>
                    <button class="app-button app-button--primary" type="button" data-action="apply" :disabled="busy || !dirty" @click="apply">{{ t('design.apply') }}</button>
                  </div>
                </template>
              </fieldset>
            </el-tab-pane>
            <el-tab-pane name="code" :label="t('design.code')" :disabled="dirty || !!tweakDraft">
              <DesignCode v-if="board && inspectorTab === 'code'" :node="selected ?? board.root" :css="board.css ?? current.document.content.css" />
            </el-tab-pane>
            <el-tab-pane name="tweaks" :label="t('design.tweaks')" :disabled="dirty">
              <DesignTweaks :tweaks="tweaks" :nodes="nodes" :draft="tweakDraft" :disabled="busy || dirty || interacting || !!pendingCanvas || !!tweakDraft && !!error" @preview="previewTweak" @commit="saveTweak" />
            </el-tab-pane>
          </el-tabs>
        </div>
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
    <FormDialog v-model="boardDialog" :title="t(addingBoard ? 'design.addArtboard' : 'design.artboardSettings')" width="420px">
      <form class="design-panel__board-form" @submit.prevent="saveBoard">
        <FormField :label="t('design.artboardName')"><input v-model="boardDraft.title" :aria-label="t('design.artboardName')" autofocus maxlength="200" required /></FormField>
        <div class="design-panel__dimensions">
          <FormField :label="t('design.width')"><input v-model.number="boardDraft.width" type="number" :aria-label="t('design.width')" min="240" max="3840" required /></FormField>
          <FormField :label="t('design.height')"><input v-model.number="boardDraft.height" type="number" :aria-label="t('design.height')" min="160" max="3840" required /></FormField>
        </div>
        <FormField :label="t('design.notes')"><textarea v-model="boardDraft.notes" :aria-label="t('design.notes')" rows="3" maxlength="4000" /></FormField>
        <p v-if="error" role="alert" class="design-panel__error">{{ error }}</p>
      </form>
      <template #footer>
        <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="boardDialog = false">{{ t('common.cancel') }}</button>
        <button class="app-button app-button--primary" type="button" :disabled="busy || !boardDraft.title.trim()" @click="saveBoard">{{ t('design.save') }}</button>
      </template>
    </FormDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import DesignReviewBar from './DesignReviewBar.vue';
import DesignCode from './DesignCode.vue';
import type { DesignEdit, DesignInteraction as DesignInteractionValue, DesignRequest, DesignResult, DesignWorkspace } from '@workspace/core/design';
import { designNodes } from '@workspace/core/design';
import { designTweakCss, type DesignTweak, type DesignTweakValue } from '@workspace/core/design-tweaks';
import { translate as t } from '../i18n';
import FormField from '../shared/form/FormField.vue';
import FormDialog from '../shared/dialog/FormDialog.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { ArrowBackUpIcon as UndoIcon, ArrowForwardUpIcon as RedoIcon, HistoryIcon, DownloadIcon, XIcon, ChevronDown } from '../shared/icons/app-icons';
import DesignCanvas from './DesignCanvas.vue';
import DesignTools from './DesignTools.vue';
import DesignTweaks from './DesignTweaks.vue';
import DesignLayers from './DesignLayers.vue';
import DesignLayout from './DesignLayout.vue';
import DesignInteraction from './DesignInteraction.vue';
import type { DesignCanvasChange } from './design-frame';

const props = defineProps<{ agentId: string; workspace: DesignWorkspace; execute: (request: DesignRequest) => Promise<DesignResult> }>();
const current = ref(props.workspace);
const inspectorVisible = ref(!!props.workspace.selectedNodeId);
const reviewCommentInput = ref<HTMLTextAreaElement>();
const reviewCommentDraft = ref<{ nodeId: string; title: string; revision: number; text: string }>();
const buildVisible = ref(false);
const buildDraft = ref<{ artboardId: string; title: string; notes?: string; revision: number }>();
const historyVisible = ref(false);
const inspectorTab = ref('properties');
const tweakDraft = ref<{ tweakId: string; value: DesignTweakValue; expectedRevision: number; definition: DesignTweak } | null>(null);
const canvas = ref<InstanceType<typeof DesignCanvas>>();
const pan = ref(false);
const boardDialog = ref(false);
const addingBoard = ref(false);
const boardDraft = ref({ title: '', width: 800, height: 600, notes: '' });
let boardDraftId = '';
let boardDraftRevision = 0;
const play = ref(false);
const zoomChoice = ref<number | 'fit' | 'selection'>(props.workspace.selectedNodeId ? 'selection' : 'fit');
const busy = ref(false);
const dirty = ref(false);
const error = ref('');
const textDraft = ref('');
const styleDraft = ref<Record<string, string>>({});
const interactionDraft = ref<DesignInteractionValue | null>(null);
const elementCommentDraft = ref<{ nodeId: string; title: string; revision: number; text: string }>();
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
const commentDraft = computed({
  get: () => elementCommentDraft.value?.text ?? '',
  set: (text: string) => {
    if (busy.value) return;
    if (!text) { elementCommentDraft.value = undefined; return; }
    if (elementCommentDraft.value) elementCommentDraft.value.text = text;
    else if (selected.value) elementCommentDraft.value = { nodeId: selected.value.id, title: `${selected.value.tag} · ${selected.value.text?.slice(0, 35) || selected.value.id}`, revision: revision.value, text };
  },
});
const comments = computed(() => current.value.document?.content.comments.filter(item => item.nodeId === (elementCommentDraft.value?.nodeId ?? selected.value?.id)) ?? []);
const reviewComments = computed(() => current.value.document?.content.comments.filter(item => item.nodeId === reviewCommentDraft.value?.nodeId) ?? []);
const artboardItems = computed<AppMenuItem[]>(() => [
  { type: 'action', id: 'add', label: t('design.addArtboard'), disabled: (current.value.document?.content.artboards.length ?? 0) >= 12 },
  { type: 'action', id: 'duplicate', label: t('design.duplicateArtboard'), disabled: !board.value || (current.value.document?.content.artboards.length ?? 0) >= 12 },
  { type: 'action', id: 'settings', label: t('design.artboardSettings'), disabled: !board.value },
  { type: 'action', id: 'arrange', label: t('design.arrangeArtboards') },
  { type: 'action', id: 'choose', label: t('design.chooseDirection'), disabled: !board.value || current.value.document?.content.chosenArtboardId === board.value.id },
  { type: 'action', id: 'remove', label: t('design.removeArtboard'), disabled: (current.value.document?.content.artboards.length ?? 0) < 2 },
]);
const historyItems = computed<AppMenuItem[]>(() => [
  { type: 'action', id: 'undo', label: t('design.undo'), icon: UndoIcon, disabled: locked.value || !current.value.undo.length },
  { type: 'action', id: 'redo', label: t('design.redo'), icon: RedoIcon, disabled: locked.value || !current.value.redo?.length },
  ...(current.value.checkpoints.length ? [{ type: 'separator' as const, id: 'checkpoints' }] : []),
  ...current.value.checkpoints.map(item => ({ type: 'action' as const, id: `restore:${item.id}`, label: t('design.restoreNamed', { name: item.title }), disabled: locked.value })),
]);
const exportItems = computed<AppMenuItem[]>(() => [
  { type: 'action', id: 'selected', label: t('design.exportArtboard') },
  { type: 'action', id: 'all', label: t('design.exportAll') },
]);
const properties = [
  { key: 'color', label: 'design.color' }, { key: 'background-color', label: 'design.fill' },
  { key: 'font-size', label: 'design.fontSize' }, { key: 'font-family', label: 'design.fontFamily' },
  { key: 'padding', label: 'design.padding' }, { key: 'gap', label: 'design.gap' },
  { key: 'width', label: 'design.width' }, { key: 'height', label: 'design.height' },
  { key: 'border-radius', label: 'design.radius' },
];
watch(() => props.workspace, workspace => { current.value = workspace; });
watch([selected, revision], () => { if (!dirty.value) resetDraft(); }, { immediate: true });
function resetDraft() {
  textDraft.value = selected.value?.text ?? '';
  styleDraft.value = { ...selected.value?.styles };
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
  if (!draftNodeId.value) return;
  const edits: DesignEdit[] = [];
  const original = nodes.value.find(node => node.id === draftNodeId.value);
  if (!original) { error.value = t('design.targetRemoved'); return; }
  if (textDraft.value !== (original.text ?? '') && !original.children?.length) edits.push({ type: 'text', nodeId: draftNodeId.value, text: textDraft.value });
  const changedStyles = Object.fromEntries(Object.entries(styleDraft.value).filter(([key, value]) => value !== (original.styles?.[key] ?? '')).map(([key, value]) => [key, value.trim() ? value : null]));
  if (Object.keys(changedStyles).length) edits.push({ type: 'style', nodeId: draftNodeId.value, styles: changedStyles });
  const originalAction = original.interaction ?? (original.toggleTargetId ? { type: 'toggle', nodeId: original.toggleTargetId } : null);
  if (JSON.stringify(interactionDraft.value) !== JSON.stringify(originalAction)) edits.push({ type: 'interaction', nodeId: draftNodeId.value, interaction: interactionDraft.value });
  if (!edits.length) { resetDraft(); return; }
  if (await mutate({ type: 'edit', expectedRevision: draftRevision.value, edits })) { dirty.value = false; resetDraft(); }
}
async function reload() { if (await mutate({ type: 'read' })) { pendingCanvas.value = null; tweakDraft.value = null; elementCommentDraft.value = undefined; interacting.value = false; interactingArtboardId = null; dirty.value = false; resetDraft(); } }
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
async function editElements(edits: DesignEdit[]) {
  if (dirty.value) return;
  const ids = new Set(nodes.value.map(node => node.id));
  if (await mutate({ type: 'edit', expectedRevision: revision.value, edits })) {
    const added = nodes.value.find(node => !ids.has(node.id));
    if (added) await selectNode(added.id);
  }
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
async function selectCanvasNode(artboardId: string, nodeId: string) {
  if (locked.value) return;
  if (artboardId !== board.value?.id && zoomChoice.value === 'selection' && canvas.value) zoomChoice.value = canvas.value.zoom;
  await mutate({ type: 'select', artboardId, nodeId });
}
function canvasInteraction(artboardId: string, active: boolean) {
  if (active && locked.value || interactingArtboardId && interactingArtboardId !== artboardId) return;
  interactingArtboardId = active ? artboardId : null;
  interacting.value = active;
}
async function chooseBoard(artboardId: string) { await mutate({ type: 'edit', expectedRevision: revision.value, edits: [{ type: 'choose-artboard', artboardId }] }); }
async function artboardAction(action: string) {
  if (action === 'arrange') {
    let x = 0;
    const edits: DesignEdit[] = current.value.document!.content.artboards.map(artboard => {
      const position = { x, y: 0 }; x += artboard.width + 80;
      return { type: 'artboard-update', artboardId: artboard.id, changes: { position } };
    });
    if (await mutate({ type: 'edit', expectedRevision: revision.value, edits })) zoomChoice.value = 'fit';
    return;
  }
  if (action === 'add' || action === 'settings') {
    addingBoard.value = action === 'add';
    boardDraftId = board.value?.id ?? '';
    boardDraftRevision = revision.value;
    boardDraft.value = action === 'add' ? { title: t('design.newArtboard'), width: board.value?.width ?? 800, height: board.value?.height ?? 600, notes: '' } : { title: board.value!.title, width: board.value!.width, height: board.value!.height, notes: board.value!.notes ?? '' };
    error.value = '';
    boardDialog.value = true;
  } else if (board.value && action === 'choose') await chooseBoard(board.value.id);
  else if (board.value && (action === 'duplicate' || action === 'remove')) {
    const ids = new Set(current.value.document!.content.artboards.map(item => item.id));
    if (await mutate({ type: 'edit', expectedRevision: revision.value, edits: [{ type: action === 'duplicate' ? 'artboard-duplicate' : 'artboard-remove', artboardId: board.value.id }] })) {
      const added = current.value.document!.content.artboards.find(item => !ids.has(item.id));
      if (added) await focusBoard(added.id);
    }
  }
}
async function saveBoard() {
  const changes = { ...boardDraft.value, title: boardDraft.value.title.trim() };
  if (!changes.title || !Number.isInteger(changes.width) || !Number.isInteger(changes.height) || changes.width < 240 || changes.width > 3840 || changes.height < 160 || changes.height > 3840) { error.value = t('design.invalidArtboard'); return; }
  const id = `artboard-${crypto.randomUUID()}`;
  const edit: DesignEdit = addingBoard.value ? { type: 'artboard-add', artboard: { ...changes, id, root: { id: `node-${crypto.randomUUID()}`, tag: 'main', children: [] } } } : { type: 'artboard-update', artboardId: boardDraftId, changes };
  if (await mutate({ type: 'edit', expectedRevision: boardDraftRevision, edits: [edit] })) {
    boardDialog.value = false;
    if (addingBoard.value) await focusBoard(id);
  }
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
async function comment() {
  const draft = elementCommentDraft.value;
  if (draft && await mutate({ type: 'comment', expectedRevision: draft.revision, nodeId: draft.nodeId, text: draft.text })) elementCommentDraft.value = undefined;
}
async function checkpoint() {
  if (await mutate({ type: 'checkpoint', expectedRevision: revision.value, title: checkpointTitle.value })) { checkpointTitle.value = ''; historyVisible.value = false; }
}
async function historyAction(action: string) {
  if (action === 'undo' || action === 'redo') await mutate({ type: action, expectedRevision: revision.value });
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

.design-panel__inspector {
  position: relative;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-height: 48%;
  flex: none;
  overflow: auto;
  border-top: 1px solid var(--color-border);
}

@container design-panel (min-width: 720px) {
  .design-panel__body {
    flex-direction: row;
  }

  .design-panel__inspector {
    width: 280px;
    max-height: none;
    border-top: 0;
    border-left: 1px solid var(--color-border);
  }
}

.design-panel__build-summary p {
  color: var(--color-text-muted);
  line-height: var(--line-height-20);
}

.design-panel__fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.design-panel__close-inspector {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: 1;
}

.design-panel__tabs :deep(.el-tabs__header) {
  padding-right: 32px;
  margin-bottom: var(--space-3);
}

.design-panel__tabs :deep(.el-tabs__item) {
  height: 32px;
  font-size: var(--font-size-13);
}

.design-panel__properties {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}

.design-panel input,
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

.design-panel input:focus-visible,
.design-panel textarea:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
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
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.design-panel__history .design-panel__actions {
  align-items: stretch;
  flex-direction: column;
}

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
