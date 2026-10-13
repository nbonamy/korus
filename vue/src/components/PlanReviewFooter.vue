<template>
  <footer class="plan-review-footer">
    <div class="plan-review-footer__status">
      <slot name="status">
        <p
          v-if="showCommentHelp && comments.length === 0"
          class="plan-review-footer__help"
        >
          <IconCirclePlus aria-hidden="true" />
          <span>{{ t('chat.planReview.commentHelp') }}</span>
        </p>
      </slot>
    </div>

    <div
      v-if="comments.length"
      class="plan-review-footer__comments"
      :aria-label="$t('surface.planReviewFooter.planComments')"
    >
      <article
        v-for="comment in comments"
        :key="comment.id"
        class="plan-review-footer__comment"
        :title="commentTitle(comment)"
      >
        <div class="plan-review-footer__comment-copy">
          <span>{{ t('chat.planReview.commentAbout') }}</span>
          <strong>{{ oneLineText(comment.quote) }}</strong>
        </div>
        <div class="plan-review-footer__comment-actions">
          <button
            class="plan-review-footer__comment-button"
            type="button"
            :aria-label="t('chat.planReview.editComment')"
            :disabled="disabled"
            @click="emit('editComment', comment)"
          >
            <PencilIcon aria-hidden="true" />
          </button>
          <button
            class="plan-review-footer__comment-button"
            type="button"
            :aria-label="t('chat.planReview.deleteComment')"
            :disabled="disabled"
            @click="emit('deleteComment', comment.id)"
          >
            <Trash2Icon aria-hidden="true" />
          </button>
        </div>
      </article>
    </div>

    <div class="plan-review-footer__actions">
      <button
        v-if="showApprovalActions"
        class="app-button app-button--tertiary plan-review-footer__button plan-review-footer__button--cancel"
        type="button"
        :disabled="disabled"
        @click="emit('cancel')"
      >
        {{ t('chat.planReview.cancel') }}
      </button>
      <slot name="secondary-actions" />
      <button
        v-if="comments.length"
        class="app-button app-button--secondary plan-review-footer__button"
        type="button"
        :disabled="disabled"
        @click="emit('clear')"
      >
        {{ t('chat.planReview.clear') }}
      </button>
      <button
        v-else-if="showApprovalActions"
        class="app-button app-button--primary plan-review-footer__button plan-review-footer__button--primary"
        type="button"
        :disabled="disabled"
        @click="emit('confirm')"
      >
        {{ confirmLabel || t('chat.planReview.confirm') }}
      </button>
      <AnnotationSendButton
        v-if="comments.length"
        :count="comments.length"
        :disabled="disabled"
        :label="t('chat.planReview.sendComments', comments.length)"
        @click="emit('send')"
      />
    </div>
  </footer>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { IconCirclePlus } from '@tabler/icons-vue';
import { PencilIcon, Trash2Icon } from '../shared/icons/app-icons';
import AnnotationSendButton from './AnnotationSendButton.vue';
import type { PlanReviewComment } from './side-panel';

withDefaults(defineProps<{
  comments: PlanReviewComment[];
  disabled?: boolean;
  showCommentHelp?: boolean;
  showApprovalActions?: boolean;
  confirmLabel?: string;
}>(), {
  disabled: false,
  showCommentHelp: true,
  showApprovalActions: true,
});

const emit = defineEmits<{
  confirm: [];
  clear: [];
  deleteComment: [commentId: string];
  editComment: [comment: PlanReviewComment];
  send: [];
  cancel: [];
}>();

const { t } = useI18n();

function oneLineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function commentTitle(comment: PlanReviewComment): string {
  return `${oneLineText(comment.quote)} - ${oneLineText(comment.body)}`;
}
</script>

<style scoped>
.plan-review-footer {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8);
  border-top: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface-lowest) 94%, transparent);
  backdrop-filter: blur(10px);
}

.plan-review-footer__status {
  min-height: 0;
}

.plan-review-footer__status:empty {
  display: none;
}

.plan-review-footer__help {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.plan-review-footer__help svg {
  width: 15px;
  height: 15px;
  stroke-width: 1.8;
}

.plan-review-footer__comments {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-height: 132px;
  overflow: auto;
  scrollbar-width: thin;
}

.plan-review-footer__comment {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border: 1px solid
    color-mix(in srgb, var(--color-primary) 18%, var(--color-border));
  border-radius: var(--radius-md);
  background: color-mix(
    in srgb,
    var(--color-primary) 7%,
    var(--color-surface-lowest)
  );
}

.plan-review-footer__comment-copy {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  overflow: hidden;
  font-size: var(--font-size-12);
  line-height: var(--line-height-18);
  white-space: nowrap;
}

.plan-review-footer__comment-copy span {
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.plan-review-footer__comment-copy strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-review-footer__comment-actions {
  display: flex;
  gap: var(--space-2);
}

.plan-review-footer__comment-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--space-8);
  height: var(--space-8);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.plan-review-footer__comment-button:hover {
  color: var(--color-text);
  background: var(--color-surface);
}

.plan-review-footer__comment-button:disabled {
  opacity: 0.38;
  cursor: default;
}

.plan-review-footer__comment-button:disabled:hover {
  color: var(--color-text-muted);
  background: transparent;
}

.plan-review-footer__comment-button svg {
  width: 14px;
  height: 14px;
}

.plan-review-footer__actions {
  --annotation-send-button-height: var(--space-16);
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-3);
}

.plan-review-footer__actions :deep(.app-button) {
  flex-shrink: 0;
  white-space: nowrap;
}

.plan-review-footer__button {
  height: var(--space-16);
}
</style>
