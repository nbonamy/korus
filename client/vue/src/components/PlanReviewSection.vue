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
          v-else-if="'choice' in block"
          :group="block.choice"
          :answer="draft.choices.find((c) => c.id === block.choice.id)"
          :disabled="disabled"
          @change="emit('choice', block.choice.id, $event)"
        />
        <figure v-else class="plan-diagram" :aria-label="diagramLabel(block.diagram)" @mouseup.stop>
          <VisualizationView :visualization="{ id: block.diagram.id, title: diagramLabel(block.diagram), content: { kind: 'mermaid', source: block.diagram.source } }">
            <template #error><pre><code>{{ block.diagram.source }}</code></pre></template>
          </VisualizationView>
          <button
            class="app-button app-button--tertiary"
            type="button"
            :aria-label="t('planFeedback.commentDiagram', { number: block.diagram.number, title: section.title })"
            :aria-expanded="target?.id === block.diagram.id"
            :disabled="disabled"
            @click="toggleComment($event, block.diagram)"
          ><MessageIcon aria-hidden="true" /></button>
        </figure>
      </template>
    </div>
    <div v-for="comment in comments" :key="comment.id" :title="comment.quote">
      <p v-if="comment.id !== section.id" class="plan-comment-quote">{{ commentLabel(comment) }}</p>
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
import type { PlanMarkdownSection, PlanMarkdownDiagram } from './plan-markdown';
import { MessageIcon } from '../shared/icons/app-icons';
import PlanCommentEditor from './PlanCommentEditor.vue';
import PlanChoiceGroup from './PlanChoiceGroup.vue';
import VisualizationView from './VisualizationView.vue';
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
let activeCommentButton: HTMLButtonElement | undefined;
const comments = computed(() => {
  const saved = props.draft.comments.filter((c) => c.sectionId === props.section.id);
  return target.value && !saved.some((c) => c.id === target.value!.id)
    ? [...saved, target.value]
    : saved;
});
function diagramLabel(diagram: PlanMarkdownDiagram) {
  return t('planFeedback.diagram', { number: diagram.number, title: props.section.title });
}
function commentLabel(comment: PlanReviewDraft['comments'][number]) {
  const block = props.section.blocks.find(block => 'diagram' in block && block.diagram.id === comment.id);
  return block && 'diagram' in block ? diagramLabel(block.diagram) : comment.quote;
}
function toggleComment(event: MouseEvent, diagram?: PlanMarkdownDiagram) {
  if (props.disabled) return;
  activeCommentButton = event.currentTarget as HTMLButtonElement;
  const id = diagram?.id ?? props.section.id;
  target.value =
    target.value?.id === id
      ? null
      : props.draft.comments.find(comment => comment.id === id) ?? {
          id,
          sectionId: props.section.id,
          quote: (diagram ? `${diagramLabel(diagram)}\n\n${diagram.source}` : props.section.title).slice(0, 2000),
          body: '',
        };
}
function selectText(event: MouseEvent) {
  if (props.disabled || (event.target as Element).closest('.plan-choice-group,.plan-diagram')) return;
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
  (activeCommentButton ?? commentButton.value)?.focus();
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
.plan-diagram {
  position: relative;
  margin: 0 0 var(--space-12);
  border: 1px solid var(--color-outline-variant);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.plan-diagram .visualization-view {
  height: clamp(200px, 35vh, 360px);
}
.plan-diagram > button {
  position: absolute;
  top: var(--space-8);
  right: var(--space-8);
  padding: var(--space-4);
  background: var(--color-overlay);
}
.plan-diagram > button svg {
  width: 18px;
  height: 18px;
}
.plan-diagram pre {
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
}
</style>
