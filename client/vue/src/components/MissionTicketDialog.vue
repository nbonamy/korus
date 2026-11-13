<template>
  <el-dialog
    class="app-dialog mission-ticket-dialog"
    :model-value="modelValue"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="!target"
    append-to-body
    destroy-on-close
    width="min(720px, calc(100vw - 48px))"
    @update:model-value="onDialogVisibilityChanged"
  >
    <template #header>
      <div v-if="ticket" class="mission-ticket-dialog__header">
        <span class="mission-ticket-dialog__number">{{ ticketNumber }}</span>
        <div>
          <small>{{ t("missions.ticketDetails") }}</small>
          <h3>{{ ticket.title }}</h3>
        </div>
        <button
          type="button"
          class="mission-ticket-dialog__close"
          :aria-label="t('missions.closeTicketDetails')"
          @click="closeDetails"
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </template>

    <article
      v-if="ticket"
      id="mission-ticket-details"
      class="mission-ticket-dialog__body"
      :aria-label="t('missions.ticketDetails')"
    >
      <div class="mission-ticket-dialog__document" @mouseup="captureSelection">
        <ChatAnnotatedText
          :message-key="ticketKey"
          :annotations="anchored"
          :focus-request="focusRequest"
          @edit="editById"
        >
          <MarkdownPanel
            :content="ticket.body?.trim() || t('missions.noTicketDescription')"
          />
        </ChatAnnotatedText>
      </div>

      <div
        v-if="
          ticket.repositoryPath || ticket.dependsOn?.length || ticket.reference
        "
        class="mission-ticket-dialog__metadata"
      >
        <span v-if="ticket.repositoryPath">
          {{ t("missions.repository") }}: {{ ticket.repositoryPath }}
        </span>
        <span v-if="ticket.dependsOn?.length">
          {{ t("missions.blockedBy") }}:
          {{ ticket.dependsOn.map(formatTicketNumber).join(", ") }}
        </span>
        <a
          v-if="ticket.reference"
          :href="ticket.reference"
          target="_blank"
          rel="noreferrer"
        >
          {{ t("missions.canonicalReference") }}
          <ExternalLinkIcon aria-hidden="true" />
        </a>
      </div>

      <slot />

      <section
        v-if="shownComments.length"
        class="mission-ticket-dialog__comments"
        :aria-label="t('missions.ticketComments')"
      >
        <AnnotationComment
          v-for="comment in shownComments"
          :key="comment.id"
          :comment="comment"
          :quote="oneLine(comment.quote)"
          :show-quote="true"
          :number="numberOf(comment)"
          :editor-id="`${editorId}-${comment.id}`"
          :open="target?.id === comment.id"
          :disabled="disabled"
          :placeholder="t('missions.ticketCommentPlaceholder')"
          @reveal="reveal(comment)"
          @edit="editComment(comment)"
          @close="cancelComment"
          @remove="removeComment(comment.id)"
          @update="update(comment, $event)"
        />
      </section>
    </article>

    <template v-if="annotatable || totalCommentCount || slots.footer" #footer>
      <div class="mission-ticket-dialog__footer">
        <span v-if="annotatable">{{
          totalCommentCount ? commentSummary : t("missions.ticketCommentHelp")
        }}</span>
        <AnnotationSendButton
          v-if="totalCommentCount"
          :count="totalCommentCount"
          :disabled="disabled"
          :label="t('missions.sendTicketComments', totalCommentCount)"
          @click="emit('sendComments')"
        />
        <slot name="footer" />
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, useSlots, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { MissionTicket } from "@workspace/core/missions";
import { ExternalLinkIcon, X } from "../shared/icons/app-icons";
import AnnotationComment from "./AnnotationComment.vue";
import AnnotationSendButton from "./AnnotationSendButton.vue";
import ChatAnnotatedText from "./ChatAnnotatedText.vue";
import { textStartIn } from "./chat-text-anchor";
import MarkdownPanel from "./MarkdownPanel.vue";
import { usePendingAnnotationHighlight } from "./use-pending-annotation-highlight";

export type MissionTicketComment = {
  body: string;
  id: string;
  quote: string;
  /** The selected passage and where it starts in the ticket, so it can be marked again. */
  text?: string;
  textStart?: number;
  ticketKey: string;
  ticketNumber: string;
  ticketTitle: string;
};

const props = withDefaults(
  defineProps<{
    annotatable?: boolean;
    commentSummary?: string;
    comments?: readonly MissionTicketComment[];
    disabled?: boolean;
    modelValue: boolean;
    ticket?: MissionTicket | null;
    ticketKey?: string;
    ticketNumber?: string;
    totalCommentCount?: number;
  }>(),
  {
    annotatable: false,
    commentSummary: "",
    comments: () => [],
    disabled: false,
    ticket: null,
    ticketKey: "",
    ticketNumber: "",
    totalCommentCount: 0,
  },
);
const emit = defineEmits<{
  close: [];
  removeComment: [id: string];
  saveComment: [comment: MissionTicketComment];
  sendComments: [];
}>();
const { t } = useI18n();
const slots = useSlots();
const editorId = useId();
// The comment being written or edited; like a requirement comment it is saved as the user types.
const target = ref<MissionTicketComment | null>(null);
let commentId = 0;
const pendingHighlight = usePendingAnnotationHighlight();

watch(() => [props.modelValue, props.ticketKey], cancelComment);

// Saved comments are marked in the text with their number, like chat annotations and requirement comments.
const anchored = computed(() => props.comments.flatMap((comment, index) => comment.text && comment.textStart !== undefined
  ? [{ id: comment.id, text: comment.text, comment: comment.body, number: index + 1, textStart: comment.textStart }]
  : []));
const focusRequest = ref<{ id: string } | null>(null);
function numberOf(comment: MissionTicketComment): number | undefined {
  return anchored.value.find(candidate => candidate.id === comment.id)?.number;
}
function reveal(comment: MissionTicketComment): void {
  focusRequest.value = { id: comment.id };
}
function editById(id: string): void {
  const comment = props.comments.find(candidate => candidate.id === id);
  if (comment) editComment(comment);
}

// Clicking anywhere but the open comment and the markers that open one deselects it.
function dismissOutside(event: PointerEvent): void {
  if (!target.value) return;
  const keep = "[data-annotation-id], [data-annotation-comment]";
  if (!event.composedPath().some(node => node instanceof Element && node.matches(keep))) cancelComment();
}
watch(target, (open, was) => {
  if (open && !was) document.addEventListener("pointerdown", dismissOutside, true);
  else if (!open) document.removeEventListener("pointerdown", dismissOutside, true);
});
onBeforeUnmount(() => document.removeEventListener("pointerdown", dismissOutside, true));

function closeDetails(): void {
  cancelComment();
  emit("close");
}

function onDialogVisibilityChanged(visible: boolean): void {
  if (!visible) closeDetails();
}

function formatTicketNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function captureSelection(event: MouseEvent): void {
  if (!props.annotatable || props.disabled || !props.ticket) return;
  const selection = window.getSelection?.();
  const quote = selection?.toString().trim() ?? "";
  if (!selection || !quote || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const documentElement =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!documentElement?.contains(range.commonAncestorContainer)) return;
  const content = documentElement.querySelector<HTMLElement>("[data-chat-annotation-content]");
  commentId += 1;
  pendingHighlight.hold(range);
  target.value = {
    id: `ticket-comment-${commentId}`,
    body: "",
    quote: quote.length > 180 ? `${quote.slice(0, 177)}...` : quote,
    ...(content?.contains(range.startContainer)
      ? { text: quote.slice(0, 2000), textStart: textStartIn(content, range) }
      : {}),
    ticketKey: props.ticketKey,
    ticketNumber: props.ticketNumber,
    ticketTitle: props.ticket.title,
  };
  selection.removeAllRanges();
}

// Saved comments plus the one being written, which is saved on its first words.
const shownComments = computed(() => target.value && !props.comments.some(comment => comment.id === target.value!.id)
  ? [...props.comments, target.value]
  : props.comments);

function update(comment: MissionTicketComment, body: string): void {
  target.value = { ...comment, body };
  if (body.trim()) emit("saveComment", { ...comment, body });
  else if (props.comments.some(saved => saved.id === comment.id)) emit("removeComment", comment.id);
}

function editComment(comment: MissionTicketComment): void {
  if (props.disabled) return;
  pendingHighlight.release();
  target.value = comment;
}

function removeComment(id: string): void {
  if (props.disabled) return;
  emit("removeComment", id);
  if (target.value?.id === id) cancelComment();
}

function cancelComment(): void {
  pendingHighlight.release();
  target.value = null;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
</script>

<style scoped>
:global(.mission-ticket-dialog.el-dialog) {
  display: grid;
  /* A ticket is a document: give it most of the window, with a margin all around. The default top
     margin (15vh) would push a tall dialog off the bottom, so it is set explicitly. */
  height: calc(100vh - 96px);
  max-height: 1100px;
  margin: 48px auto;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
}

:global(.mission-ticket-dialog.el-dialog > .el-dialog__header) {
  margin: 0;
  padding: 0;
}

:global(.mission-ticket-dialog.el-dialog > .el-dialog__body) {
  min-height: 0;
  padding: 0;
  overflow: auto;
}

:global(.mission-ticket-dialog.el-dialog > .el-dialog__footer) {
  padding: 0;
  border-top: 1px solid var(--color-border);
}

.mission-ticket-dialog__footer {
  --annotation-send-button-height: var(--space-16);
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.mission-ticket-dialog__header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: var(--space-6);
  padding: var(--space-8);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-low);
}

.mission-ticket-dialog__number {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: var(--radius-md);
  color: var(--color-on-primary-container);
  background: var(--color-primary-container);
  font-size: var(--font-size-11);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.04em;
}

.mission-ticket-dialog__header > div {
  display: grid;
  gap: var(--space-1);
}

.mission-ticket-dialog__header h3 {
  margin: 0;
  font-size: var(--font-size-18);
  line-height: var(--line-height-24);
}

.mission-ticket-dialog__header small {
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.mission-ticket-dialog__body {
  display: flex;
  min-height: 100%;
  flex-direction: column;
}

.mission-ticket-dialog__document :deep(.markdown-panel) {
  max-height: none;
  padding: var(--space-10);
  overflow: visible;
}

.mission-ticket-dialog__metadata {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-8);
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.mission-ticket-dialog__metadata a {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-primary);
  text-decoration: none;
}

.mission-ticket-dialog__metadata a:hover {
  text-decoration: underline;
}

.mission-ticket-dialog__metadata svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.mission-ticket-dialog__close {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.mission-ticket-dialog__close:hover,
.mission-ticket-dialog__close:focus-visible {
  color: var(--color-text);
  background: var(--color-surface-high);
}

.mission-ticket-dialog__close svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

/* The list stays at the bottom of the dialog while the ticket scrolls. */
.mission-ticket-dialog__comments {
  position: sticky;
  z-index: 2;
  bottom: 0;
  margin-top: auto;
  padding: var(--space-3) var(--space-6);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-low);
}

</style>
