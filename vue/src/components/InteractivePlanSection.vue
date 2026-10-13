<template>
  <details class="claim" :open="expanded" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
    <summary>
      <ChevronRightIcon class="chevron" aria-hidden="true" />
      <span class="claim-title">{{ section.claim }}</span>
      <button
        ref="commentButton"
        class="icon-button"
        type="button"
        :aria-label="`${t('htmlPlan.comment')}: ${section.claim}`"
        :aria-expanded="commentOpen"
        :aria-controls="commentId"
        :data-has-comment="Boolean(answers.comments[section.id])"
        :disabled="disabled"
        @click.prevent="toggleComment"
      ><MessageIcon aria-hidden="true" /></button>
    </summary>
    <div class="section">
      <p v-if="section.detail" class="detail">{{ section.detail }}</p>
      <InteractivePlanExhibit v-if="section.exhibit" :exhibit="section.exhibit" />
      <InteractivePlanDecision
        v-if="section.decision"
        :decision="section.decision"
        :model-value="answers.choices[section.id] ?? null"
        :disabled="disabled"
        @update:model-value="emit('choice', section.id, $event)"
      />
      <InteractivePlanComment
        :id="commentId"
        :open="commentOpen"
        :model-value="answers.comments[section.id] ?? ''"
        :disabled="disabled"
        @update:model-value="emit('comment', section.id, $event)"
        @edit="commentOpen = true"
        @close="closeComment"
      />
      <div v-if="section.children" class="children">
        <InteractivePlanSection
          v-for="child in section.children"
          :key="child.id"
          :section="child"
          :answers="answers"
          :disabled="disabled"
          @choice="(id, value) => emit('choice', id, value)"
          @comment="(id, value) => emit('comment', id, value)"
        />
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PlanAnswers, PlanSection } from '@workspace/core/interactive-plan';
import { ChevronRightIcon, MessageIcon } from '../shared/icons/app-icons';
import InteractivePlanExhibit from './InteractivePlanExhibit.vue';
import InteractivePlanDecision from './InteractivePlanDecision.vue';
import InteractivePlanComment from './InteractivePlanComment.vue';

const props = defineProps<{ section: PlanSection; answers: PlanAnswers; initiallyOpen?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ choice: [sectionId: string, option: string | null]; comment: [sectionId: string, text: string] }>();
const { t } = useI18n();
const expanded = ref(props.initiallyOpen === true);
const commentOpen = ref(false);
const commentButton = ref<HTMLButtonElement>();
const commentId = useId();
function toggleComment() {
  if (props.disabled) return;
  commentOpen.value = !commentOpen.value;
  if (commentOpen.value) expanded.value = true;
}
async function closeComment() {
  commentOpen.value = false;
  await nextTick();
  commentButton.value?.focus();
}
</script>

<style scoped>
.claim {
  position: relative;
}
.claim + .claim {
  border-top: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
}
summary {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 17px 0;
  cursor: pointer;
  list-style: none;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}
summary::-webkit-details-marker {
  display: none;
}
.chevron {
  flex: 0 0 12px;
  width: 12px;
  height: 12px;
  margin: 6px 0 0 3px;
  transition: transform 0.12s;
}
.claim[open] > summary > .chevron {
  transform: rotate(90deg);
}
.claim-title {
  flex: 1;
  min-width: 0;
}
.icon-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  border: 0;
  background: transparent;
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
  padding: 2px;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  flex: 0 0 26px;
}
.icon-button:hover {
  background: color-mix(in srgb, var(--color-text) 3%, var(--color-surface-lowest));
  color: var(--color-text);
}
.icon-button[data-has-comment="true"] {
  color: var(--color-primary);
}
.section {
  position: relative;
  margin: 0 0 18px 9px;
  padding: 0 0 0 26px;
  border-left: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
}
.detail {
  margin: 0 0 14px;
  white-space: pre-wrap;
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
}
.children {
  margin-top: 14px;
}
.children > .claim > summary {
  font-size: 14px;
  font-weight: 500;
  padding: 12px 0;
}
.children > .claim:first-child {
  border-top: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
}
.icon-button svg { width: 18px; height: 18px; stroke-width: 1.6; }
@container (max-width: 400px) {
  summary { font-size: 15px; gap: 8px; }
  .section { padding-left: 18px; }
}
@media (prefers-reduced-motion: reduce) { .chevron { transition: none; } }
</style>
