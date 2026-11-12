<template>
  <div ref="loadTimingRoot" class="conversation-pane" :data-conversation-agent-id="agent?.id" @keydown.capture="handleDraftShortcut" @focusin.capture="handleDraftFocusIn">
    <TelemetryConsentNotice v-if="appClientPlatform === 'desktop' && keyboardActive" />
    <WorktreeInitializationIndicator :agent="agent" />
    <div v-if="agent?.handoff?.phase === 'failed'" class="conversation-pane__handoff" role="status">
      <p>{{ t('handoff.interrupted') }}</p>
      <details v-if="agent.handoff.note">
        <summary>{{ t('handoff.savedNote') }}</summary>
        <pre>{{ agent.handoff.note }}</pre>
      </details>
    </div>
    <ConversationLoadError
      v-if="historyLoadFailed && !hasVisibleMessages"
      :loading="historyLoading"
      @retry="emit('retry-history')"
    />
    <SdkConversationPane
      v-else
      ref="surface"
      class="conversation-pane__surface"
      :controller="displayController"
      :escape-interrupt="keyboardActive"
      :has-composer-context="textAnnotations.length > 0 || visualizationAnnotations.length > 0 || codeAnnotations.length > 0"
      :message-text-selection="true"
      :render-strategy="annotationRenderAll ? 'eager' : 'lazy'"
      :transform-message="transformConversationMessage"
      :tool-visibility="isAppToolVisible"
      @message-text-selection-change="messageTextSelection = captureChatTextAnchor($event)"
    >
      <template #empty>
        <div class="conversation-pane__empty">
          <h1>{{ heroHeadline }}</h1>
          <p v-if="heroSubhead">{{ heroSubhead }}</p>
          <div v-if="$slots['empty-actions']" class="conversation-pane__empty-actions">
            <slot name="empty-actions" />
          </div>
        </div>
      </template>
      <template #message-text="{ block, message, index }">
        <ChatAnnotatedText
          :message-key="message.id ?? String(index)"
          :focus-request="annotationFocusRequest"
          :annotations="annotationsForMessage(message, index).map(annotation => ({ ...annotation, number: textAnnotations.indexOf(annotation) + 1 }))"
          @edit="annotationReview?.open($event)"
        >
          <MessageBlock :block="block" :mention-groups="textCatalogs?.mentionGroups" :plugins="textCatalogs?.plugins" :skills="textCatalogs?.skills">
            <template #mention="{ item, surface: mentionSurface }">
              <AgentMention v-if="item.value.startsWith('agent:')" :label="item.label" :surface="mentionSurface" />
            </template>
          </MessageBlock>
        </ChatAnnotatedText>
      </template>
      <template #message-header="{ message }">
        <span v-if="guestAuthor(message.id)" class="conversation-pane__message-header">{{ guestAuthor(message.id) }}</span>
        <DeferredConversationContent
          v-if="agent && contentSessionId && message.id && deferredContent(message) && !loadedContent.has(deferredContent(message)!.contentId)"
          :key="deferredContent(message)!.contentId"
          :agent-id="agent.id" :session-id="contentSessionId" :message-id="message.id"
          :content="deferredContent(message)!" :read="readConversationContent"
          @loaded="(id, full) => loadedContent.set(id, full)"
        />
        <span
          v-if="collaborationMessageLabel(message.id)"
          class="conversation-pane__message-header"
        >{{ collaborationMessageLabel(message.id) }}</span>
      </template>
      <template #suggestion-item="{ item }">
        <AgentMention
          v-if="item.value.startsWith('agent:')"
          :label="item.label"
          surface="menu"
        />
      </template>
      <template #mention="{ item, surface: mentionSurface }">
        <AgentMention
          v-if="item.value.startsWith('agent:')"
          :label="item.label"
          :surface="mentionSurface"
        />
      </template>
      <template #composer-attachment-actions="{ attachments, index, disabled }">
        <el-tooltip
          v-if="attachments[index]?.type === 'image'"
          :content="annotationActionLabel(attachments[index])"
          placement="top"
          :show-after="300"
        >
          <button
            class="conversation-pane__annotate-attachment"
            :class="{ 'conversation-pane__annotate-attachment--saved': annotationCount(attachments[index]) > 0 }"
            type="button"
            :aria-label="annotationActionLabel(attachments[index])"
            :disabled="disabled"
            @click="requestAttachmentAnnotation(attachments[index])"
          >
            <ClickIcon aria-hidden="true" />
          </button>
        </el-tooltip>
      </template>
      <template #composer-drawers>
        <GithubStarPrompt v-if="appClientPlatform === 'desktop' && keyboardActive" />
        <slot name="composer-drawers" />
        <ConversationShareActivity v-if="shareProposals.length" :proposals="shareProposals" owner :disabled="shareBusy || movingSuggestion" :edit-disabled="!canMoveSuggestion" :failed="shareFailed" @edit="moveSuggestion" @delete="dismissSuggestion" />
      </template>
      <template #composer-shelf-actions="{ disabled }">
        <div v-if="activeThreadFlags.length > 0 || agent?.rateLimitPause" class="conversation-pane__thread-flags">
          <RateLimitResumeNotice v-if="agent?.rateLimitPause" :agent-id="agent.id" :pause="agent.rateLimitPause" />
          <ThreadFlagAffordance
            v-for="flag in activeThreadFlags"
            :id="flag"
            :key="flag"
            :busy="threadFlagBusy || disabled"
            @respond="emit('thread-flag', $event)"
          />
        </div>
      </template>
      <template v-if="safetyBlock" #composer-replacement>
        <div class="conversation-pane__safety-block" role="alert">
          <details>
            <summary><AlertTriangleIcon aria-hidden="true" /><span class="conversation-pane__safety-title">{{ t('backend.providerSafetyBlocked') }}</span><ChevronDownIcon class="conversation-pane__safety-chevron" aria-hidden="true" /></summary>
            <pre>{{ safetyReview?.explanation || safetyBlock }}</pre>
            <button v-if="safetyReview?.canContinue && appApi" class="app-button app-button--secondary safety-review-continue" type="button" :disabled="safetyReviewBusy" @click="continueSafetyReview">{{ t('backend.continueSafetyReview') }}</button>
          </details>
        </div>
      </template>
      <template #before-composer>
        <button v-if="agent && !providerChoices.includes(agent.provider)" class="app-button app-button--tertiary" type="button" @click="connectEngine">
          {{ t('engineConnection.required') }}
        </button>
        <div v-if="draftPickerOpen" class="conversation-pane__draft-anchor">
          <SavedPromptDraftPicker
            :drafts="agentDrafts"
            @close="closeDraftPicker"
            @delete="deleteSavedDraft"
            @select="restoreSavedDraft"
          />
        </div>
      </template>
      <template #composer-context="{ disabled }">
        <ChatAnnotationReview
          :key="conversationKey"
          ref="annotationReview"
          :annotations="textAnnotations"
          :disabled="disabled"
          @reveal="revealTextAnnotation"
          @edit="(id, comment) => emit('edit-text-annotation', id, comment)"
          @remove="emit('remove-text-annotation', $event)"
        />
        <ComposerContextCards
          v-if="composerContextCards.length > 0"
          :context-label="t('chat.composerContext.label')"
          :items="composerContextCards"
          :disabled="disabled"
          @remove="removeComposerContextCard"
        />
      </template>
    </SdkConversationPane>
    <ChatTextSelectionAnnotation
      :conversation-key="conversationKey"
      :selection="messageTextSelection"
      @dismiss="messageTextSelection = null"
      @save="emit('add-text-annotation', $event)"
    />
    <ConversationPlanPanel
      v-if="plan && planVisible"
      :plan="plan"
      @close="emit('close-plan')"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'AppConversationPane' });
import { providerSafetyBlockPreviewKey } from './debug-provider-safety-block';
import type { PaneMessage } from '../conversation-presentation/presentation';
import { providerSafetyBlockDetails } from '@workspace/core/provider-safety-block';
import { slicePromptContent, replacePromptContentRange } from '@korus-dev/multi-agent-sdk/prompt';
import ConversationShareActivity from './ConversationShareActivity.vue';
import TelemetryConsentNotice from './TelemetryConsentNotice.vue';
import GithubStarPrompt from './GithubStarPrompt.vue';
import { appApi, appClientPlatform, traceConversationLoad } from '../platform-api';
import { supportsConversationSharing, conversationShareTarget, type GuestProposal } from '@workspace/core/conversation-sharing';
import { useConversationShareActivity } from './use-conversation-share-activity';
import { matchesShellShortcut } from '@workspace/core/keyboard-shortcuts';
import { translate } from '../i18n';
import { computed, inject, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ConversationPane as SdkConversationPane,
  MessageBlock,
  defaultChatTranslate,
  provideChatTranslate,
  resolveConversationPaneValue,
  type ComposerState,
  type ChatMessage,
  type ConversationPaneController,
  type NativeAttachment,
} from '@korus-dev/agent-ui-sdk';
import { AlertTriangleIcon, ChevronDown as ChevronDownIcon, ClickIcon } from '../shared/icons/app-icons';
import { IconSitemap } from '@tabler/icons-vue';
import type {
  Agent,
  RendererMessage,
  SavedPromptDraft,
  ThreadPlan,
} from '@workspace/core/contracts';
import { normalizeThreadFlags, type ThreadFlagId, type ThreadFlagResponse } from '@workspace/core/thread-flags';
import { agentDisplayName } from '@workspace/core/agent-display';
import ConversationPlanPanel from './ConversationPlanPanel.vue';
import RateLimitResumeNotice from './RateLimitResumeNotice.vue';
import ConversationLoadError from './ConversationLoadError.vue';
import WorktreeInitializationIndicator from './WorktreeInitializationIndicator.vue';
import DeferredConversationContent from './DeferredConversationContent.vue';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import AgentMention from './AgentMention.vue';
import ComposerContextCards, { type ComposerContextCard } from './ComposerContextCards.vue';
import ChatAnnotatedText from './ChatAnnotatedText.vue';
import { captureChatTextAnchor } from './chat-text-anchor';
import type { ChatTextSelection } from './use-chat-text-annotations';
import ChatAnnotationReview from './ChatAnnotationReview.vue';
import ChatTextSelectionAnnotation from './ChatTextSelectionAnnotation.vue';
import ThreadFlagAffordance from './ThreadFlagAffordance.vue';
import SavedPromptDraftPicker from './SavedPromptDraftPicker.vue';
import { useProviderChoices, useConnectEngine } from './provider-selection';
import { ElMessage } from 'element-plus';
import type { ChatTextAnnotation } from './use-chat-text-annotations';
import type { VisualizationAnnotation } from './use-visualization-annotations';
import { describeCodeRange, type CodeAnnotation } from './use-code-annotations';
import type { CodeReviewFinding } from '@workspace/core/code-review';
import {
  presentCollaborationMessage,
  presentRendererCollaborationMessage,
  type CollaborationMessagePresentation,
} from '../shared/collaboration-message';
import { isAppToolVisible, provideAppToolPresentation } from '../tool-presentation';
import { provideConversationImagePreviews } from './conversation-image-previews';
import { defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import { sessionConversationId } from '@korus-dev/multi-agent-sdk/contracts';
const providerChoices = useProviderChoices(() => props.agent?.remoteConnectionId);
const connectEngine = useConnectEngine();

const { t, te } = useI18n();
const surface = ref<{ focusComposer(): void; $el: HTMLElement } | null>(null);
provideChatTranslate((key, params) => te(key)
  ? t(key, params ?? {})
  : defaultChatTranslate(key, params));

const props = withDefaults(defineProps<{
  controller: ConversationPaneController;
  keyboardActive?: boolean;
  agent: Agent | null;
  agents?: readonly Agent[];
  attachmentAnnotationCounts?: Readonly<Record<string, number>>;
  textAnnotations?: readonly ChatTextAnnotation[];
  visualizationAnnotations?: readonly VisualizationAnnotation[];
  codeAnnotations?: readonly CodeAnnotation[];
  reviewFinding?: CodeReviewFinding | null;
  plan?: ThreadPlan | null;
  planVisible?: boolean;
  historyLoadFailed?: boolean;
  historyLoading?: boolean;
  hasVisibleMessages?: boolean;
  emptyHeadline?: string;
  emptySubhead?: string;
  threadFlagBusy?: boolean;
  savedPromptDrafts?: readonly SavedPromptDraft[];
  savePromptDraft?: (agentId: string, text: string, content?: readonly import('@korus-dev/multi-agent-sdk').PromptPart[]) => Promise<void>;
  removePromptDraft?: (id: string) => Promise<void>;
  readConversationContent?: (agentId: string, input: ConversationContentInput) => Promise<ConversationContentChunk>;
}>(), {
  agents: () => [],
  keyboardActive: true,
  attachmentAnnotationCounts: () => ({}),
  textAnnotations: () => [],
  visualizationAnnotations: () => [],
  codeAnnotations: () => [],
  reviewFinding: null,
  planVisible: true,
  historyLoadFailed: false,
  historyLoading: false,
  hasVisibleMessages: false,
  threadFlagBusy: false,
  savedPromptDrafts: () => [],
});
const safetyBlockPreview = inject(providerSafetyBlockPreviewKey, null);
const safetyReviewBusy = ref(false);
const safetyReview = computed(() => safetyBlockPreview?.value?.agentId === props.agent?.id ? undefined
  : props.agent?.status.type === 'error' ? props.agent.status.safetyReview : undefined);
async function continueSafetyReview(): Promise<void> {
  const agent = props.agent, review = safetyReview.value;
  if (!agent || !review?.canContinue || safetyReviewBusy.value || !appApi) return;
  safetyReviewBusy.value = true;
  try { await appApi.continueInterruptedTurn(agent.id, { id: review.id, conversationId: review.conversationId, turnId: review.turnId }); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : String(error)); }
  finally { safetyReviewBusy.value = false; }
}

const safetyBlock = computed(() => {
  const preview = safetyBlockPreview?.value;
  return preview && preview.agentId === props.agent?.id ? preview.message
    : props.agent?.status.type === 'error' ? providerSafetyBlockDetails(props.agent.status.message) : null;
});
const displayController = computed<ConversationPaneController>(() => {
  if (!safetyBlock.value) return props.controller;
  return {
    state: () => {
      const state = resolveConversationPaneValue(props.controller.state);
      return { ...state, identity: { ...state.identity, disabled: true, error: null },
        policy: { ...state.policy, canDeleteTurn: false, canEditTurn: false, canForkTurn: false, canRetryTurn: false, followUpsDisabled: true } };
    },
    actions: () => ({ ...resolveConversationPaneValue(props.controller.actions),
      submit: undefined, steer: undefined, sendFollowUp: undefined, deleteTurn: undefined, editTurn: undefined, retryTurn: undefined, forkTurn: undefined }),
  };
});

provideConversationImagePreviews(() => props.agent?.id);
provideAppToolPresentation(
  (key, params) => t(key, params ?? {}),
  (identifier) => {
    const agent = props.agents.find((candidate) => candidate.id === identifier);
    return agent ? agentDisplayName(agent) : undefined;
  },
);

const emit = defineEmits<{
  'add-text-annotation': [payload: { selection: ChatTextSelection; comment: string }];
  'annotate-attachment': [attachment: NativeAttachment];
  'close-plan': [];
  'edit-text-annotation': [annotationId: string, comment: string];
  'remove-text-annotation': [annotationId: string];
  'remove-visualization-annotation': [annotationId: string];
  'remove-code-annotation': [annotationId: string];
  'remove-review-finding': [];
  'retry-history': [];
  'thread-flag': [response: ThreadFlagResponse];
}>();

const conversationKey = computed(() => props.agent?.id ?? 'no-agent');
const loadTimingRoot = ref<HTMLElement | null>(null);
let loadTimingRevision = 0;
onUnmounted(() => { loadTimingRevision += 1; });
if (traceConversationLoad) watch([
  () => props.agent?.id,
  () => resolveConversationPaneValue(props.controller.state).history?.loading ?? props.historyLoading,
  () => resolveConversationPaneValue(props.controller.state).identity.messages.length > 0,
], async ([agentId, loading, hasMessages]) => {
  const revision = ++loadTimingRevision;
  if (!agentId || loading || !hasMessages) return;
  await nextTick();
  if (revision !== loadTimingRevision || !loadTimingRoot.value) return;
  const mark = (stage: string) => console.warn('[conversation-load] ' + JSON.stringify({ layer: 'renderer', stage, agentId,
    rendererId: performance.timeOrigin, mountedMessages: loadTimingRoot.value?.querySelectorAll('.chat-message').length ?? 0,
    visibility: document.visibilityState, focused: document.hasFocus(),
    at: performance.timeOrigin + performance.now() }));
  mark('content.dom-committed');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (revision === loadTimingRevision && loadTimingRoot.value) mark('content.paint-opportunity');
  }));
}, { immediate: true, flush: 'post' });
// Messages arrive with deferred content only from harnesses that read conversation content back.
const contentSessionId = computed(() => props.agent?.providerSession && defaultProviderCapabilities(props.agent.provider).conversationContent
  ? sessionConversationId(props.agent.providerSession) : null);
const shareTarget = computed(() => props.agent && supportsConversationSharing(props.agent) ? conversationShareTarget(props.agent) : null);
const { proposals: shareProposals, authors: guestAuthors, busy: shareBusy, failed: shareFailed, dismiss: dismissSuggestion } = useConversationShareActivity(() => shareTarget.value);
const movingSuggestion = ref(false);
const movedSuggestions = new Set<string>();
const canMoveSuggestion = computed(() => Boolean(resolveConversationPaneValue(props.controller.actions).updateComposerState && resolveConversationPaneValue(props.controller.state).composer?.state));
function guestAuthor(id: string | undefined) { return guestAuthors.value.find(author => author.messageId === id)?.name ?? null; }
const loadedContent = reactive(new Map<string, RendererMessage>());
watch(() => [props.agent?.id, contentSessionId.value], () => loadedContent.clear());
function deferredContent(message: ChatMessage | PaneMessage): RendererMessage['deferredContent'] {
  // The SDK header slot exposes its normalized message, so resolve app metadata by ID.
  const original = resolveConversationPaneValue(props.controller.state).identity.messages.find((candidate) => candidate.id === message.id);
  return (original as RendererMessage | undefined)?.deferredContent;
}
const paneConversationKey = computed(() => resolveConversationPaneValue(props.controller.state).identity.conversationKey ?? conversationKey.value);
const agentDrafts = computed(() => props.savedPromptDrafts.filter((draft) => draft.agentId === props.agent?.id));
const draftPickerOpen = ref(false);
const draftSavePending = ref(false);
const insertionRange = ref<{ start: number; end: number } | null>(null);
watch(paneConversationKey, () => { draftPickerOpen.value = false; insertionRange.value = null; });

function composerState(): ComposerState | null {
  return resolveConversationPaneValue(props.controller.state).composer?.state ?? null;
}

function updateComposerState(state: ComposerState): void {
  void resolveConversationPaneValue(props.controller.actions).updateComposerState?.(state);
}

async function moveSuggestion(proposal: GuestProposal): Promise<void> {
  if (movingSuggestion.value || shareBusy.value) return;
  const controller = props.controller;
  const update = resolveConversationPaneValue(controller.actions).updateComposerState;
  const state = resolveConversationPaneValue(controller.state).composer?.state;
  if (!update || !state) return;
  const identity = paneConversationKey.value;
  movingSuggestion.value = true;
  try {
    if (!movedSuggestions.has(proposal.id)) {
      const text = state.text ? `${state.text}\n\n${proposal.text}` : proposal.text;
      const content = state.content === undefined ? undefined : replacePromptContentRange(state.content, state.text.length, state.text.length, [{ type: 'text', text: `${state.text ? '\n\n' : ''}${proposal.text}` }]);
      await update({ ...state, text, ...(content === undefined ? {} : { content }), selectionStart: text.length, selectionEnd: text.length });
      movedSuggestions.add(proposal.id);
    }
    if (identity !== paneConversationKey.value) return;
    await dismissSuggestion(proposal.id);
    void nextTick(() => editorElement()?.focus());
  } catch { shareFailed.value = true; }
  finally { movingSuggestion.value = false; }
}

function editorElement(): HTMLElement | null {
  return surface.value?.$el?.querySelector?.('.chat-composer [contenteditable="true"]') ?? null;
}

function handleDraftShortcut(event: KeyboardEvent): void {
  if (!props.agent) return;
  const input = { key: event.key, meta: event.metaKey, shift: event.shiftKey, control: event.ctrlKey, alt: event.altKey };
  if (matchesShellShortcut('saveDraft', input) && event.target === editorElement()) {
    event.preventDefault();
    event.stopPropagation();
    void saveCurrentDraft();
  } else if (matchesShellShortcut('drafts', input) && event.target === editorElement() && !draftPickerOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    openSavedDraftPicker();
  }
}

function handleDraftFocusIn(event: FocusEvent): void {
  if (draftPickerOpen.value && event.target === editorElement()) {
    draftPickerOpen.value = false;
    insertionRange.value = null;
  }
}

async function saveCurrentDraft(): Promise<void> {
  const agentId = props.agent?.id;
  const state = composerState();
  if (!agentId || !state?.text?.trim() || !props.savePromptDraft || draftSavePending.value) return;
  const start = Math.min(state.selectionStart, state.selectionEnd);
  const end = Math.max(state.selectionStart, state.selectionEnd);
  const hasSelection = end > start;
  const text = hasSelection ? state.text.slice(start, end) : state.text;
  if (!text.trim()) return;
  draftSavePending.value = true;
  try {
    const content = state.content === undefined ? undefined : slicePromptContent(state.content, hasSelection ? start : 0, hasSelection ? end : state.text.length);
    await (content === undefined ? props.savePromptDraft(agentId, text) : props.savePromptDraft(agentId, text, content));
    ElMessage.success(t('chat.savedDrafts.saved'));
    if (props.agent?.id !== agentId || composerState()?.text !== state.text) return;
    const nextText = hasSelection ? state.text.slice(0, start) + state.text.slice(end) : '';
    updateComposerState({
      ...state,
      text: nextText,
      ...(state.content === undefined ? {} : { content: hasSelection ? replacePromptContentRange(state.content, start, end, []) : [] }),
      selectionStart: hasSelection ? start : 0,
      selectionEnd: hasSelection ? start : 0,
      ...(hasSelection ? {} : { activeCommandId: null }),
    });
  } catch (error) {
    ElMessage.error(`${t('chat.savedDrafts.saveFailed')}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    draftSavePending.value = false;
  }
}

function openSavedDraftPicker(): void {
  if (!props.agent) return;
  const state = composerState();
  insertionRange.value = state ? { start: state.selectionStart, end: state.selectionEnd } : null;
  draftPickerOpen.value = true;
}

function closeDraftPicker(): void {
  draftPickerOpen.value = false;
  void nextTick(() => editorElement()?.focus());
}

async function deleteSavedDraft(id: string): Promise<void> {
  try { await props.removePromptDraft?.(id); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : String(error)); }
}

async function restoreSavedDraft(selection: { id: string; keep: boolean }): Promise<void> {
  const draft = agentDrafts.value.find((candidate) => candidate.id === selection.id);
  const state = composerState();
  if (!draft || !state) return;
  const start = Math.min(insertionRange.value?.start ?? state.text.length, state.text.length);
  const end = Math.min(insertionRange.value?.end ?? start, state.text.length);
  const text = `${state.text.slice(0, start)}${draft.text}${state.text.slice(end)}`;
  const caret = start + draft.text.length;
  const content = state.content !== undefined || draft.content !== undefined
    ? replacePromptContentRange(state.content ?? [{ type: 'text', text: state.text }], start, end, draft.content ?? [{ type: 'text', text: draft.text }]) : undefined;
  updateComposerState({ ...state, text, ...(content === undefined ? {} : { content }), selectionStart: caret, selectionEnd: caret });
  closeDraftPicker();
  if (!selection.keep) {
    try { await props.removePromptDraft?.(draft.id); }
    catch (error) { ElMessage.error(`${t('chat.savedDrafts.restoreFailed')}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}
const annotationFocusRequest = ref<{ id: string } | null>(null);
const annotationRenderAll = ref(false);
async function revealTextAnnotation(id: string): Promise<void> {
  const marker = [...(loadTimingRoot.value?.querySelectorAll<HTMLElement>('[data-annotation-id]') ?? [])]
    .find(element => element.dataset.annotationId === id);
  if (!marker) {
    annotationRenderAll.value = true;
    await nextTick();
    await nextTick();
  }
  annotationFocusRequest.value = { id };
}

const annotationReview = ref<InstanceType<typeof ChatAnnotationReview> | null>(null);
function annotationsForMessage(message: { id?: string; role: string }, index: number): readonly ChatTextAnnotation[] {
  return props.textAnnotations.filter(annotation => annotation.messageId
    ? annotation.messageId === message.id
    : annotation.messageIndex === index && annotation.role === message.role);
}
const composerContextCards = computed<ComposerContextCard[]>(() => [
  ...props.visualizationAnnotations.map((annotation) => ({
    id: `visualization-annotation:${annotation.id}`,
    label: t('chat.composerContext.visualizationAnnotation'),
    icon: IconSitemap,
    title: annotation.comment,
    removeLabel: `${t('chat.composerContext.removeVisualizationAnnotation')}: ${annotation.comment}`,
  })),
  ...props.codeAnnotations.map((annotation) => ({
    id: `code-annotation:${annotation.id}`,
    label: t('chat.composerContext.codeAnnotation'),
    detail: `${annotation.path.split('/').pop()}:${annotation.startLine === annotation.endLine ? annotation.startLine : `${annotation.startLine}-${annotation.endLine}`}`,
    title: annotation.comment,
    removeLabel: `${t('chat.composerContext.removeCodeAnnotation')}: ${describeCodeRange(annotation)}`,
  })),
  ...(props.reviewFinding ? [{
    id: 'review-finding',
    label: props.reviewFinding.priority.toUpperCase(),
    detail: props.reviewFinding.title,
    removeLabel: t('chat.composerContext.removeReviewFinding'),
  }] : []),
]);
const activeThreadFlags = computed<ThreadFlagId[]>(() => (
  (['ready_for_review', 'work_proposed'] as const)
    .filter((id) => normalizeThreadFlags(props.agent?.threadFlags ?? {})[id] === true)
));
const textCatalogs = computed(() => resolveConversationPaneValue(props.controller.state).catalogs);
const messageTextSelection = ref<ChatTextSelection | null>(null);
const collaborationMessagePresentations = new Map<string, CollaborationMessagePresentation>();
let transformedMessageCache = new WeakMap<object, ChatMessage | PaneMessage>();
watch(conversationKey, () => {
  annotationFocusRequest.value = null;
  annotationRenderAll.value = false;
  messageTextSelection.value = null;
  collaborationMessagePresentations.clear();
  transformedMessageCache = new WeakMap<object, ChatMessage | PaneMessage>();
});
const heroHeadline = computed(() => {
  if (props.emptyHeadline?.trim()) return props.emptyHeadline.trim();
  if (!props.agent) return translate('surface.conversationPane.selectAnAgent');
  const displayName = agentDisplayName(props.agent);
  if (
    props.agent.sessionKind === 'quickChat'
    && !props.agent.name?.trim()
    && displayName === 'Untitled conversation'
  ) {
    return t('chat.quickChatHeadline');
  }
  return `Chat with ${displayName}`;
});
const heroSubhead = computed(() => {
  if (props.emptySubhead !== undefined) return props.emptySubhead;
  if (!props.agent) return translate('surface.conversationPane.chooseAnAgentFromTheLeftToStartANativeBackendSession');
  if (props.agent.sessionKind === 'quickChat' && !props.agent.sharedConversation) return t('chat.quickChatContext');
  return props.agent.folder;
});
function collaborationMessageLabel(messageId: string | undefined): string | null {
  if (!messageId) return null;
  const presentation = collaborationMessagePresentations.get(messageId);
  if (!presentation) return null;
  const names = presentation.senderNames.join(', ');
  return presentation.messageCount === 1
    ? t('chat.collaboration.messageFrom', { name: names })
    : t('chat.collaboration.messagesFrom', { names });
}

function requestAttachmentAnnotation(attachment: NativeAttachment | undefined): void {
  if (attachment?.type === 'image') emit('annotate-attachment', attachment);
}

function removeComposerContextCard(itemId: string): void {
  if (itemId === 'review-finding') {
    emit('remove-review-finding');
    return;
  }
  if (itemId.startsWith('visualization-annotation:')) {
    emit('remove-visualization-annotation', itemId.slice('visualization-annotation:'.length));
    return;
  }
  if (itemId.startsWith('code-annotation:')) {
    emit('remove-code-annotation', itemId.slice('code-annotation:'.length));
  }
}

function annotationCount(attachment: NativeAttachment | undefined): number {
  return attachment ? props.attachmentAnnotationCounts[attachment.reference] ?? 0 : 0;
}

function annotationActionLabel(attachment: NativeAttachment | undefined): string {
  if (!attachment) return t('chat.attachments.annotate', { name: 'image' });
  const count = annotationCount(attachment);
  return count > 0
    ? t('chat.attachments.editAnnotations', { count, name: attachment.name })
    : t('chat.attachments.annotate', { name: attachment.name });
}

function transformConversationMessage(
  message: ChatMessage | PaneMessage,
): ChatMessage | PaneMessage {
  const deferred = deferredContent(message);
  if (deferred && loadedContent.has(deferred.contentId)) message = loadedContent.get(deferred.contentId)!;
  const cached = transformedMessageCache.get(message);
  if (cached) return cached;

  const result = 'content' in message
    ? presentCollaborationMessage(message)
    : presentRendererCollaborationMessage(message as RendererMessage);
  if (message.id && result.presentation) {
    collaborationMessagePresentations.set(message.id, result.presentation);
  }
  // Work phases come tagged from the harness, so the pane renders them as they arrive.
  const transformed = result.message as ChatMessage | PaneMessage;
  transformedMessageCache.set(message, transformed);
  return transformed;
}

function focusComposer(): void {
  surface.value?.focusComposer?.();
}

defineExpose({ focusComposer, openSavedDraftPicker, saveCurrentDraft });
</script>

<style scoped>
.conversation-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-shell-main);
}

.conversation-pane__handoff {
  flex: 0 0 auto;
  max-height: 240px;
  overflow: auto;
  padding: var(--space-3) var(--space-4);
  color: var(--color-text);
  background: var(--color-shell-main);
}

.conversation-pane__handoff pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.conversation-pane__surface {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

/* The SDK pane paints its own surface token while its composer fade ends in the shell color; in dark themes they differ. */
.conversation-pane .conversation-pane__surface {
  background: var(--color-shell-main);
}

.conversation-pane__draft-anchor {
  position: relative;
  z-index: 10;
  height: 0;
}

.conversation-pane__draft-anchor > * {
  position: absolute;
  bottom: var(--space-2);
  right: 0;
  left: 0;
}

.conversation-pane__thread-flags {
  width: 100%;
  display: grid;
  gap: var(--space-4);
}

.conversation-pane__empty {
  display: grid;
  gap: var(--space-2);
  max-width: var(--conversation-content-width);
  text-align: center;
}

.conversation-pane__empty h1 {
  line-height: 1.2;
}

.conversation-pane__empty-actions {
  width: min(360px, 100%);
  margin: var(--space-8) auto 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}

.conversation-pane__empty-actions :deep(.app-menu__item) {
  min-height: 42px;
  padding-inline: var(--space-6);
  border-radius: var(--radius-lg);
}

.conversation-pane__message-header {
  color: inherit;
  font: inherit;
}

.conversation-pane__annotate-attachment {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  place-items: center;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.conversation-pane__annotate-attachment:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-surface-low);
}

.conversation-pane__annotate-attachment:disabled {
  color: var(--color-text-muted);
  cursor: default;
}

.conversation-pane__annotate-attachment--saved {
  color: var(--color-primary);
}

.conversation-pane__annotate-attachment--saved svg {
  stroke-width: 2.5;
}

.conversation-pane__annotate-attachment svg {
  width: 16px;
  height: 16px;
}

:deep(.chat-tool-call__title-target[href]:hover) {
  text-decoration: underline;
}
.conversation-pane__safety-block {
  margin-bottom: var(--space-8);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  padding: var(--space-8) var(--space-12);
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  line-height: var(--line-height-18);
}
.conversation-pane__safety-block summary { outline: none; display: flex; align-items: center; gap: var(--space-8); cursor: pointer; color: var(--color-error); list-style: none; }
.conversation-pane__safety-block summary::-webkit-details-marker { display: none; }
.conversation-pane__safety-block summary svg { width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto; }
.conversation-pane__safety-block .conversation-pane__safety-title { flex: 1; margin: 0; color: var(--color-error); font-size: inherit; }
.conversation-pane__safety-block .conversation-pane__safety-chevron { margin-left: auto; color: var(--color-error); }
.conversation-pane__safety-block details[open] .conversation-pane__safety-chevron { transform: rotate(180deg); }
.conversation-pane__safety-block p { margin: var(--space-8) 0; }
.conversation-pane__safety-block pre { max-height: 200px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-size-12); }
</style>
