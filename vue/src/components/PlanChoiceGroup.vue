<template>
  <div class="plan-choice-group" role="group" :aria-label="group.quote">
    <label v-for="option in group.options" :key="option.label" class="plan-choice-option">
      <input
        :type="group.kind"
        :name="name"
        :checked="selected.includes(option.label)"
        :disabled="disabled"
        @click="confirmProposal(option.label)"
        @change="change(option.label, ($event.target as HTMLInputElement).checked)"
      />
      <span
        >{{ option.label }}
        <small v-if="option.proposed" :class="{ 'plan-choice-proposed--hidden': answer }">{{ t('planFeedback.proposed') }}</small></span
      >
    </label>
    <button
      v-if="answer"
      type="button"
      class="plan-choice-reset"
      :aria-label="t('planFeedback.clear')"
      :title="t('planFeedback.clear')"
      :disabled="disabled"
      @click="emit('change', null)"
    >
      <ArrowBackUpIcon aria-hidden="true" />
    </button>
  </div>
</template>
<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowBackUpIcon } from '../shared/icons/app-icons';
import type { PlanReviewDraft } from '@workspace/core/plan-review';
import type { PlanChoiceGroup } from './plan-markdown';
const props = defineProps<{
  group: PlanChoiceGroup;
  answer?: PlanReviewDraft['choices'][number];
  disabled?: boolean;
}>();
const emit = defineEmits<{ change: [answer: PlanReviewDraft['choices'][number] | null] }>();
const { t } = useI18n();
const name = useId();
const selected = computed(
  () =>
    props.answer?.selected ??
    props.group.options.filter((o) => o.proposed).map((o) => o.label),
);
function confirmProposal(label: string) {
  // Clicking an already checked radio does not emit a native change event.
  if (props.group.kind === 'radio' && !props.answer && selected.value.includes(label)) {
    change(label, true);
  }
}
function change(label: string, checked: boolean) {
  const values =
    props.group.kind === 'radio'
      ? [label]
      : props.group.options
          .filter((o) => (o.label === label ? checked : selected.value.includes(o.label)))
          .map((o) => o.label);
  emit('change', { id: props.group.id, quote: props.group.quote, selected: values });
}
</script>
<style scoped>
.plan-choice-group {
  position: relative;
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  margin: 12px 0;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-surface);
}
.plan-choice-option {
  display: flex;
  align-items: baseline;
  gap: 9px;
  cursor: pointer;
}
input {
  accent-color: var(--color-primary);
  margin: 0;
  flex-shrink: 0;
}
.plan-choice-option:first-child {
  padding-inline-end: 28px;
}
.plan-choice-proposed--hidden {
  visibility: hidden;
}
small {
  font-size: 10px;
  color: var(--color-text-muted);
  margin-left: 5px;
}
.plan-choice-reset {
  position: absolute;
  inset-block-start: 8px;
  inset-inline-end: 10px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--color-text-muted);
  border-radius: 5px;
  cursor: pointer;
}
.plan-choice-reset:hover:not(:disabled) {
  color: var(--color-text);
}
.plan-choice-reset svg {
  width: 16px;
  height: 16px;
}
</style>
