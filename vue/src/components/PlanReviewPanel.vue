<template>
  <section
    ref="panelRoot"
    class="plan-review-panel"
    :aria-label="$t('surface.planReviewPanel.planReview')"
  >
    <div class="plan-review-panel__markdown-frame">
      <MarkdownPanel
        outline-enabled
        :content="panel.content"
        :error="panel.error"
        :state="panel.state"
        @mouseup="capturePlanSelection"
      />
      <div
        v-if="isPlanUpdating"
        class="plan-review-panel__overlay"
        aria-live="polite"
      >
        <span class="plan-review-panel__spinner" aria-hidden="true" />
        <span>{{ t('chat.planReview.updating') }}</span>
      </div>
    </div>

    <AnnotationPopup
      v-if="activeCommentTarget"
      :anchor="activeCommentTarget.anchor"
      :description="activeCommentTarget.quote"
      :initial-value="activeCommentTarget.initialValue"
      :label="t('chat.planReview.commentLabel')"
      :placement="activeCommentTarget.placement"
      :placeholder="t('chat.planReview.commentPlaceholder')"
      :submit-label="t('chat.planReview.commentSave')"
      :width="activeCommentTarget.width"
      @cancel="cancelPlanComment"
      @submit="savePlanComment"
    />

    <PlanReviewFooter
      v-if="panel.state === 'idle'"
      :comments="planComments"
      :disabled="planReviewLocked"
      @confirm="emit('confirmPlan')"
      @clear="confirmClearPlanComments"
      @delete-comment="deletePlanComment"
      @edit-comment="editPlanComment"
      @send="sendPlanComments"
      @cancel="emit('cancelPlan')"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessageBox } from 'element-plus';
import AnnotationPopup, { type AnnotationPopupAnchor } from './AnnotationPopup.vue';
import MarkdownPanel from './MarkdownPanel.vue';
import PlanReviewFooter from './PlanReviewFooter.vue';
import type { PlanReviewComment, SidePanelMarkdownState } from './side-panel';

const props = defineProps<{
  panel: SidePanelMarkdownState;
  planUpdating?: boolean;
}>();

const emit = defineEmits<{
  confirmPlan: [];
  commentPlan: [comments: PlanReviewComment[]];
  cancelPlan: [];
}>();

const { t } = useI18n();
const panelRoot = ref<HTMLElement | null>(null);
const planComments = ref<PlanReviewComment[]>([]);
const commentsSubmitted = ref(false);
const activeCommentTarget = ref<{
  anchor: AnnotationPopupAnchor;
  initialValue: string;
  placement: 'above' | 'below';
  quote: string;
  width?: number;
} | null>(null);
const editingCommentId = ref<string | null>(null);
let commentId = 0;
const isPlanUpdating = computed(() => props.planUpdating === true);
const planReviewLocked = computed(() => commentsSubmitted.value || isPlanUpdating.value);

watch(() => [props.panel.title, props.panel.content, props.panel.purpose], () => {
  planComments.value = [];
  commentsSubmitted.value = false;
  cancelPlanComment();
});

function capturePlanSelection(event: MouseEvent): void {
  if (planReviewLocked.value || props.panel.purpose !== 'plan' || props.panel.state !== 'idle') return;

  const selection = window.getSelection?.();
  const quote = selection?.toString().trim() ?? '';
  if (!selection || !quote || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const panelElement = event.currentTarget instanceof HTMLElement
    ? event.currentTarget.closest('.plan-review-panel')
    : null;
  if (!panelElement || !panelElement.contains(range.commonAncestorContainer)) return;

  const rangeRect = range.getBoundingClientRect();
  const panelRect = panelElement.getBoundingClientRect();
  activeCommentTarget.value = {
    quote: quote.length > 180 ? `${quote.slice(0, 177)}...` : quote,
    initialValue: '',
    placement: 'below',
    anchor: {
      x: Math.min(Math.max(12, rangeRect.left - panelRect.left), Math.max(12, panelRect.width - 332)),
      y: Math.max(48, rangeRect.top - panelRect.top),
      width: rangeRect.width,
      height: rangeRect.height,
    },
  };
}

function savePlanComment(body: string): void {
  const target = activeCommentTarget.value;
  if (!target) return;

  commentId += 1;
  const nextComment = {
    id: editingCommentId.value ?? `plan-comment-${commentId}`,
    quote: target.quote,
    body,
  };
  planComments.value = editingCommentId.value
    ? planComments.value.map((comment) => (comment.id === editingCommentId.value ? nextComment : comment))
    : [...planComments.value, nextComment];
  cancelPlanComment();
  window.getSelection?.()?.removeAllRanges();
}

function editPlanComment(comment: PlanReviewComment): void {
  if (planReviewLocked.value) return;
  const panelElement = panelRoot.value;
  const footerElement = panelElement?.querySelector<HTMLElement>('.plan-review-footer');
  const panelRect = panelElement?.getBoundingClientRect();
  const footerRect = footerElement?.getBoundingClientRect();
  const panelWidth = panelRect?.width || panelElement?.clientWidth || 0;
  const footerTop = panelRect && footerRect && footerRect.top > panelRect.top
    ? footerRect.top - panelRect.top
    : 72;
  editingCommentId.value = comment.id;
  activeCommentTarget.value = {
    quote: comment.quote,
    initialValue: comment.body,
    placement: 'above',
    ...(panelWidth > 24 ? { width: panelWidth - 24 } : {}),
    anchor: { x: 12, y: footerTop, width: 0, height: 0 },
  };
}

function deletePlanComment(commentIdToDelete: string): void {
  if (planReviewLocked.value) return;
  planComments.value = planComments.value.filter((comment) => comment.id !== commentIdToDelete);
  if (editingCommentId.value === commentIdToDelete) cancelPlanComment();
}

function cancelPlanComment(): void {
  activeCommentTarget.value = null;
  editingCommentId.value = null;
}

function sendPlanComments(): void {
  if (planComments.value.length === 0) return;
  commentsSubmitted.value = true;
  emit('commentPlan', planComments.value);
}

async function confirmClearPlanComments(): Promise<void> {
  if (planComments.value.length === 0 || planReviewLocked.value) return;
  try {
    await ElMessageBox.confirm(
      t('chat.planReview.clearCommentsBody'),
      t('chat.planReview.clearCommentsTitle'),
      {
        cancelButtonText: t('chat.planReview.keepComments'),
        confirmButtonText: t('chat.planReview.clearCommentsConfirm'),
        type: 'warning',
      },
    );
  } catch {
    return;
  }
  planComments.value = [];
  commentsSubmitted.value = false;
  cancelPlanComment();
}
</script>

<style scoped>
.plan-review-panel {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-lowest);
}

.plan-review-panel__markdown-frame {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.plan-review-panel__markdown-frame
  :deep(.codex-markdown ul:has(> li > input[type="checkbox"])) {
  padding-left: 0;
  list-style: none;
}

.plan-review-panel__markdown-frame
  :deep(.codex-markdown ul:has(> li > input[type="checkbox"]) > li) {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}

.plan-review-panel__markdown-frame
  :deep(.codex-markdown ul > li > input[type="checkbox"]) {
  flex: 0 0 auto;
  margin: 0.3em 0 0;
}

.plan-review-panel__overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface-lowest) 72%, transparent);
  backdrop-filter: blur(3px);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  font-weight: var(--font-weight-semibold);
}

.plan-review-panel__spinner {
  width: var(--space-8);
  height: var(--space-8);
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: var(--radius-full);
  animation: plan-review-panel-spinner 900ms linear infinite;
}

@keyframes plan-review-panel-spinner {
  to {
    transform: rotate(1turn);
  }
}
</style>
