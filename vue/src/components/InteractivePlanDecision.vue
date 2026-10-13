<template>
  <div class="decision" role="group" :aria-labelledby="questionId">
    <div :id="questionId" class="decision-question">{{ decision.question }}</div>
    <label v-for="option in decision.options" :key="option.id" class="option">
      <input
        type="radio"
        :name="questionId"
        :value="option.id"
        :checked="modelValue === option.id"
        :disabled="disabled"
        @change="emit('update:modelValue', option.id)"
      >
      <span class="option-text">{{ option.label }} <span v-if="decision.proposed === option.id" class="proposed">{{ t('htmlPlan.proposed') }}</span></span>
    </label>
    <button v-if="modelValue !== null" class="clear-choice" type="button" :disabled="disabled" @click="emit('update:modelValue', null)">{{ t('htmlPlan.clear') }}</button>
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PlanSection } from '@workspace/core/interactive-plan';

defineProps<{ decision: NonNullable<PlanSection['decision']>; modelValue: string | null; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>();
const questionId = useId();
const { t } = useI18n();
</script>

<style scoped>
.decision {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
  border-radius: 7px;
  padding: 12px 14px;
  margin: 12px 0;
  background: color-mix(in srgb, var(--color-text) 3%, var(--color-surface-lowest));
}
.decision-question {
  margin-bottom: 8px;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 6px 0;
  cursor: pointer;
}
.option input {
  accent-color: var(--color-primary);
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin: 3px 0 0;
}
.option-text {
  flex: 1;
}
.proposed {
  display: inline-block;
  vertical-align: middle;
  font-size: 10px;
  line-height: 18px;
  padding: 0 6px;
  margin-left: 5px;
  font-weight: 400;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-lowest));
  border-radius: 4px;
}
.clear-choice {
  display: block;
  border: 0;
  padding: 4px 0 0;
  background: transparent;
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
  font-size: 12px;
}
.clear-choice:hover {
  color: var(--color-primary);
}
@container (max-width: 400px) { .decision { padding: 10px; } }
</style>
