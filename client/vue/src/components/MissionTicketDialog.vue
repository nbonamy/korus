<template>
  <el-dialog
    class="app-dialog mission-ticket-dialog"
    :model-value="modelValue"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="!activeTarget"
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
        <MarkdownPanel
          :content="ticket.body?.trim() || t('missions.noTicketDescription')"
        />
        <AnnotationPopup
          v-if="activeTarget"
          :anchor="activeTarget.anchor"
          :description="activeTarget.quote"
          :initial-value="activeTarget.initialValue"
          :label="t('missions.ticketCommentLabel')"
          :placement="activeTarget.placement"
          :placeholder="t('missions.ticketCommentPlaceholder')"
          strategy="fixed"
          :submit-label="t('missions.saveTicketComment')"
          :width="activeTarget.width"
          @cancel="cancelComment"
          @submit="saveComment"
        />
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
        v-if="comments.length"
        class="mission-ticket-dialog__comments"
        :aria-label="t('missions.ticketComments')"
      >
        <article
          v-for="comment in comments"
          :key="comment.id"
          class="mission-ticket-dialog__comment"
        >
          <button
            type="button"
            :aria-label="t('missions.editTicketComment')"
            :disabled="disabled"
            @click="editComment(comment)"
          >
            <span>{{ oneLine(comment.quote) }}</span>
            <small>{{ oneLine(comment.body) }}</small>
          </button>
          <button
            type="button"
            class="mission-ticket-dialog__comment-remove"
            :aria-label="t('missions.removeTicketComment')"
            :disabled="disabled"
            @click="removeComment(comment.id)"
          >
            <Trash2Icon aria-hidden="true" />
          </button>
        </article>
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
import { ref, useSlots, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { MissionTicket } from "@workspace/core/missions";
import { ExternalLinkIcon, Trash2Icon, X } from "../shared/icons/app-icons";
import AnnotationPopup, {
  type AnnotationPopupAnchor,
} from "./AnnotationPopup.vue";
import AnnotationSendButton from "./AnnotationSendButton.vue";
import MarkdownPanel from "./MarkdownPanel.vue";

export type MissionTicketComment = {
  body: string;
  id: string;
  quote: string;
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
const activeTarget = ref<{
  anchor: AnnotationPopupAnchor;
  initialValue: string;
  placement: "above" | "below";
  quote: string;
  width?: number;
} | null>(null);
const editingId = ref<string | null>(null);
let commentId = 0;

watch(() => [props.modelValue, props.ticketKey], cancelComment);

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
  const rangeRect = range.getBoundingClientRect();
  activeTarget.value = {
    quote: quote.length > 180 ? `${quote.slice(0, 177)}...` : quote,
    initialValue: "",
    placement: "below",
    anchor: {
      x: Math.min(
        Math.max(12, rangeRect.left),
        Math.max(12, window.innerWidth - 332),
      ),
      y: Math.max(12, rangeRect.top),
      width: rangeRect.width,
      height: rangeRect.height,
    },
  };
}

function saveComment(body: string): void {
  const target = activeTarget.value;
  if (!target || !props.ticket) return;
  commentId += 1;
  emit("saveComment", {
    id: editingId.value ?? `ticket-comment-${commentId}`,
    body,
    quote: target.quote,
    ticketKey: props.ticketKey,
    ticketNumber: props.ticketNumber,
    ticketTitle: props.ticket.title,
  });
  cancelComment();
  window.getSelection?.()?.removeAllRanges();
}

function editComment(comment: MissionTicketComment): void {
  if (props.disabled) return;
  const dialog = document.querySelector<HTMLElement>(
    ".mission-ticket-dialog .el-dialog__footer",
  );
  const dialogRect = dialog?.getBoundingClientRect();
  editingId.value = comment.id;
  activeTarget.value = {
    quote: comment.quote,
    initialValue: comment.body,
    placement: "above",
    ...(dialogRect && dialogRect.width > 24
      ? { width: dialogRect.width - 24 }
      : {}),
    anchor: {
      x: (dialogRect?.left ?? 0) + 12,
      y: dialogRect?.top ?? 72,
      width: 0,
      height: 0,
    },
  };
}

function removeComment(id: string): void {
  if (props.disabled) return;
  emit("removeComment", id);
  if (editingId.value === id) cancelComment();
}

function cancelComment(): void {
  activeTarget.value = null;
  editingId.value = null;
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
  min-height: 0;
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

.mission-ticket-dialog__comments {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-8);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-low);
}

.mission-ticket-dialog__comment {
  display: flex;
  min-width: 0;
  overflow: hidden;
  border: 1px solid
    color-mix(in srgb, var(--color-primary) 20%, var(--color-border));
  border-radius: var(--radius-md);
  background: var(--color-surface-lowest);
}

.mission-ticket-dialog__comment > button:first-child {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 1px;
  padding: var(--space-3) var(--space-4);
  overflow: hidden;
  border: 0;
  color: var(--color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.mission-ticket-dialog__comment span,
.mission-ticket-dialog__comment small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-ticket-dialog__comment span {
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
}

.mission-ticket-dialog__comment small {
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
}

.mission-ticket-dialog__comment-remove {
  display: grid;
  width: 34px;
  flex: 0 0 34px;
  place-items: center;
  border: 0;
  border-left: 1px solid var(--color-border);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.mission-ticket-dialog__comment-remove svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.mission-ticket-dialog__comment button:disabled {
  opacity: 0.5;
  cursor: default;
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
</style>
