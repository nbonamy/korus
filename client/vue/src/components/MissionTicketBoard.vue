<template>
  <div class="mission-ticket-board">
    <TransitionGroup
      name="mission-ticket-card"
      tag="ol"
      class="mission-ticket-board__list"
      appear
    >
      <li
        v-for="(ticket, index) in tickets"
        :key="ticketKey(ticket, index)"
        class="mission-ticket-board__item"
      >
        <button
          :ref="(element) => setCardRef(ticketKey(ticket, index), element)"
          type="button"
          class="mission-ticket-board__card"
          :class="{
            'mission-ticket-board__card--selected':
              selectedKey === ticketKey(ticket, index),
          }"
          :aria-label="t('missions.openTicketDetails', { title: ticket.title })"
          :aria-expanded="selectedKey === ticketKey(ticket, index)"
          :aria-controls="
            selectedKey === ticketKey(ticket, index)
              ? 'mission-ticket-details'
              : undefined
          "
          @click="selectTicket(ticketKey(ticket, index))"
        >
          <span class="mission-ticket-board__summary">
            <span class="mission-ticket-board__heading">
              <span class="mission-ticket-board__number">{{
                ticketNumber(index)
              }}</span>
              <strong>{{ ticket.title }}</strong>
            </span>
            <span class="mission-ticket-board__preview">{{
              ticketPreview(ticket)
            }}</span>
          </span>
          <span class="mission-ticket-board__card-footer">
            <small v-if="ticket.dependsOn?.length">
              {{
                t("missions.blockedByShort", {
                  tickets: ticket.dependsOn
                    .map((dependency) => ticketNumber(dependency))
                    .join(", "),
                })
              }}
            </small>
            <small v-else>{{
              t(
                ticket.done
                  ? "missions.ticketComplete"
                  : "missions.ticketReady",
              )
            }}</small>
            <span
              v-if="ticketCommentCount(ticketKey(ticket, index))"
              class="mission-ticket-board__comment-count"
            >{{ t('missions.ticketCommentCount', { count: ticketCommentCount(ticketKey(ticket, index)) }) }}</span>
            <span v-if="ticket.repositoryPath" class="mission-ticket-board__repository">{{ repositoryName(ticket.repositoryPath) }}</span>
            <ChevronRightIcon aria-hidden="true" />
          </span>
        </button>
      </li>
    </TransitionGroup>

    <footer v-if="comments.length" class="mission-ticket-board__review-bar">
      <span>{{ ticketCommentSummary }}</span>
      <AnnotationSendButton
        :count="comments.length"
        :disabled="disabled"
        :label="t('missions.sendTicketComments', comments.length)"
        @click="emit('sendComments', comments)"
      />
    </footer>

    <MissionTicketDialog
      :annotatable="annotatable"
      :comment-summary="ticketCommentSummary"
      :comments="selectedTicketComments"
      :disabled="disabled"
      :model-value="Boolean(selectedTicket)"
      :ticket="selectedTicket?.ticket"
      :ticket-key="selectedKey"
      :ticket-number="selectedTicket ? ticketNumber(selectedTicket.index) : ''"
      :total-comment-count="comments.length"
      @close="closeDetails"
      @remove-comment="removeComment"
      @save-comment="saveComment"
      @send-comments="emit('sendComments', comments)"
    />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  ref,
  watch,
  type ComponentPublicInstance,
} from "vue";
import { useI18n } from "vue-i18n";
import type { MissionTicket } from "@workspace/core/missions";
import { ChevronRightIcon } from "../shared/icons/app-icons";
import AnnotationSendButton from "./AnnotationSendButton.vue";
import MissionTicketDialog, { type MissionTicketComment } from "./MissionTicketDialog.vue";
export type { MissionTicketComment } from "./MissionTicketDialog.vue";

const props = withDefaults(defineProps<{
  annotatable?: boolean;
  disabled?: boolean;
  resetKey?: number;
  tickets: readonly MissionTicket[];
}>(), { annotatable: false, disabled: false, resetKey: 0 });
const emit = defineEmits<{ sendComments: [comments: MissionTicketComment[]] }>();
const { t } = useI18n();
const selectedKey = ref("");
const cardRefs = new Map<string, HTMLButtonElement>();
const comments = ref<MissionTicketComment[]>([]);
const selectedTicket = computed(() => {
  const index = props.tickets.findIndex(
    (ticket, ticketIndex) =>
      ticketKey(ticket, ticketIndex) === selectedKey.value,
  );
  return index < 0 ? undefined : { ticket: props.tickets[index]!, index };
});
const selectedTicketComments = computed(() => comments.value.filter(comment => comment.ticketKey === selectedKey.value));
const ticketCommentSummary = computed(() => {
  const ticketCount = new Set(comments.value.map(comment => comment.ticketKey)).size;
  return ticketCount === 1
    ? t('missions.ticketCommentSummarySingle', comments.value.length)
    : t('missions.ticketCommentSummary', { comments: comments.value.length, tickets: ticketCount });
});

watch(
  () => props.tickets,
  () => {
    if (selectedKey.value && !selectedTicket.value) selectedKey.value = "";
    const validKeys = new Set(props.tickets.map(ticketKey));
    comments.value = comments.value.filter(comment => validKeys.has(comment.ticketKey));
  },
  { deep: true },
);
watch(() => props.resetKey, () => {
  comments.value = [];
});

function ticketKey(ticket: MissionTicket, index: number): string {
  return ticket.id ?? `ticket-${index}`;
}

function ticketNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function ticketPreview(ticket: MissionTicket): string {
  const body = ticket.body?.replace(/```[\s\S]*?```/g, " ") ?? "";
  const whatToBuild = body.match(/(?:^|\n)\s*(?:#{1,6}\s+)?(?:\*\*)?What to build(?:\*\*)?\s*:?\s*([\s\S]*)/iu)?.[1];
  const previewSource = (whatToBuild ?? body).split(/\n\s*(?:#{1,6}\s+)?(?:\*\*)?(?:Acceptance criteria|Verification|Dependencies)(?:\*\*)?\s*:?\s*/iu)[0] ?? "";
  const plainText = previewSource
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plainText || t("missions.noTicketDescription");
}

function repositoryName(repositoryPath: string): string {
  return repositoryPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? repositoryPath;
}

function setCardRef(
  key: string,
  element: Element | ComponentPublicInstance | null,
): void {
  if (element instanceof HTMLButtonElement) cardRefs.set(key, element);
  else cardRefs.delete(key);
}

function selectTicket(key: string): void {
  selectedKey.value = key;
}

async function closeDetails(): Promise<void> {
  const key = selectedKey.value;
  selectedKey.value = "";
  await nextTick();
  cardRefs.get(key)?.focus();
}

function ticketCommentCount(key: string): number {
  return comments.value.filter(comment => comment.ticketKey === key).length;
}

function saveComment(comment: MissionTicketComment): void {
  comments.value = comments.value.some(existing => existing.id === comment.id)
    ? comments.value.map(existing => existing.id === comment.id ? comment : existing)
    : [...comments.value, comment];
}

function removeComment(id: string): void {
  comments.value = comments.value.filter(comment => comment.id !== id);
}
</script>

<style scoped>
.mission-ticket-board {
  display: grid;
  gap: var(--space-10);
}

.mission-ticket-board__list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-6);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mission-ticket-board__item {
  min-width: 0;
}

.mission-ticket-board__card {
  display: grid;
  width: 100%;
  height: 196px;
  grid-template-rows: 1fr auto;
  gap: var(--space-4);
  padding: var(--space-8);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  color: var(--color-text);
  background: var(--color-surface-lowest);
  text-align: left;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.mission-ticket-board__card:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-low);
  box-shadow: var(--shadow-md);
}

.mission-ticket-board__card:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.mission-ticket-board__card--selected {
  border-color: var(--color-primary);
  background: var(--color-primary-container);
  box-shadow: var(--shadow-md);
}

.mission-ticket-board__number {
  display: inline-grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: var(--radius-md);
  color: var(--color-on-primary-container);
  background: var(--color-primary-container);
  font-size: var(--font-size-11);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.04em;
}

.mission-ticket-board__card--selected .mission-ticket-board__number {
  color: var(--color-on-primary);
  background: var(--color-primary);
}

.mission-ticket-board__summary {
  display: grid;
  min-height: 0;
  align-content: start;
  gap: var(--space-4);
}

.mission-ticket-board__heading {
  display: grid;
  min-width: 0;
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: var(--space-4);
}

.mission-ticket-board__heading strong {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--font-size-16);
  line-height: var(--line-height-22);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.mission-ticket-board__preview {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.mission-ticket-board__card-footer {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
}

.mission-ticket-board__card-footer small {
  overflow: hidden;
  font-size: var(--font-size-11);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-ticket-board__repository {
  max-width: 42%;
  margin-left: auto;
  overflow: hidden;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  color: var(--color-on-primary-container);
  background: var(--color-primary-container);
  font-size: var(--font-size-11);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-ticket-board__comment-count {
  flex: 0 0 auto;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  color: var(--color-on-warning-container);
  background: var(--color-warning-container);
  font-size: var(--font-size-11);
  white-space: nowrap;
}

.mission-ticket-board__card-footer svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
}

.mission-ticket-board__review-bar {
  --annotation-send-button-height: var(--space-16);
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-md);
  font-size: var(--font-size-12);
}

.mission-ticket-card-enter-active {
  transition:
    opacity 220ms ease,
    transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.mission-ticket-card-leave-active {
  position: absolute;
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.mission-ticket-card-move {
  transition: transform 220ms ease;
}

.mission-ticket-card-enter-from,
.mission-ticket-card-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

@media (max-width: 700px) {
  .mission-ticket-board__list {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mission-ticket-board__card,
  .mission-ticket-card-enter-active,
  .mission-ticket-card-leave-active,
  .mission-ticket-card-move {
    transition-duration: 1ms;
    transition-delay: 0ms;
  }
}
</style>
