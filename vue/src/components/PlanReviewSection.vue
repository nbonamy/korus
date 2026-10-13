<template>
  <section class="plan-review-section">
    <header class="plan-review-section__heading">
      <div v-if="section.heading" class="codex-markdown" v-html="section.heading" />
      <span v-else>{{ section.title }}</span>
      <button
        ref="commentButton"
        type="button"
        :aria-label="`${t('planFeedback.comment')}: ${section.title}`"
        :aria-expanded="target?.id === section.id"
        :disabled="disabled"
        @click="toggleComment"
      >
        <MessageIcon aria-hidden="true" />
      </button>
    </header>
    <div class="plan-review-section__body" @mouseup="selectText">
      <template v-for="(block, index) in section.blocks" :key="index">
        <div v-if="'html' in block" class="codex-markdown" v-html="block.html" />
        <PlanChoiceGroup
          v-else
          :group="block.choice"
          :answer="draft.choices.find((c) => c.id === block.choice.id)"
          :disabled="disabled"
          @change="emit('choice', block.choice.id, $event)"
        />
      </template>
    </div>
    <div v-for="comment in comments" :key="comment.id" :title="comment.quote">
      <p v-if="comment.id !== section.id" class="plan-comment-quote">{{ comment.quote }}</p>
      <PlanCommentEditor
        :id="`${editorId}-${comment.id}`"
        :model-value="comment.body"
        :open="target?.id === comment.id"
        :disabled="disabled"
        @edit="target = comment"
        @close="close"
        @update:model-value="emit('comment', { ...comment, body: $event })"
      />
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PlanReviewDraft } from '@workspace/core/plan-review';
import type { PlanMarkdownSection } from './plan-markdown';
import { MessageIcon } from '../shared/icons/app-icons';
import PlanCommentEditor from './PlanCommentEditor.vue';
import PlanChoiceGroup from './PlanChoiceGroup.vue';
const props = defineProps<{
  section: PlanMarkdownSection;
  draft: PlanReviewDraft;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  comment: [comment: PlanReviewDraft['comments'][number]];
  choice: [id: string, choice: PlanReviewDraft['choices'][number] | null];
}>();
const { t } = useI18n();
const editorId = useId();
const target = ref<PlanReviewDraft['comments'][number] | null>(null);
const commentButton = ref<HTMLButtonElement>();
const comments = computed(() => {
  const saved = props.draft.comments.filter((c) => c.sectionId === props.section.id);
  return target.value && !saved.some((c) => c.id === target.value!.id)
    ? [...saved, target.value]
    : saved;
});
function toggleComment() {
  if (props.disabled) return;
  target.value =
    target.value?.id === props.section.id
      ? null
      : {
          id: props.section.id,
          sectionId: props.section.id,
          quote: props.section.title.slice(0, 2000),
          body: '',
        };
}
function selectText(event: MouseEvent) {
  if (props.disabled || (event.target as Element).closest('.plan-choice-group')) return;
  const selection = window.getSelection();
  const quote = selection?.toString().trim();
  if (
    !quote ||
    !selection?.rangeCount ||
    !(event.currentTarget as Element).contains(selection.getRangeAt(0).commonAncestorContainer)
  )
    return;
  target.value = {
    id: crypto.randomUUID(),
    sectionId: props.section.id,
    quote: quote.slice(0, 2000),
    body: '',
  };
  selection.removeAllRanges();
}
async function close() {
  target.value = null;
  await nextTick();
  commentButton.value?.focus();
}
</script>
<style scoped>
.plan-review-section {
  margin-bottom: 20px;
  min-width: 0;
}
.plan-review-section__heading {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
.plan-review-section__heading > div,
.plan-review-section__heading > span {
  flex: 1;
  min-width: 0;
}
.plan-review-section__heading :deep(h1),
.plan-review-section__heading :deep(h2),
.plan-review-section__heading :deep(h3),
.plan-review-section__heading :deep(h4),
.plan-review-section__heading :deep(h5),
.plan-review-section__heading :deep(h6) {
  margin: 0;
}
.plan-review-section__heading button {
  display: inline-flex;
  padding: 3px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.plan-review-section__heading button:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.plan-review-section__heading svg {
  width: 18px;
  height: 18px;
}
.plan-comment-quote {
  margin: 12px 0 4px;
  color: var(--color-text-muted);
  font-size: 12px;
  white-space: pre-wrap;
}
</style>
