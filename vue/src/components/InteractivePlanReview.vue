<template>
  <section class="interactive-plan-panel" :aria-label="t('htmlPlan.review')">
    <article class="interactive-plan-content" :aria-label="plan.document.title">
      <h1>{{ plan.document.title }}</h1>
      <InteractivePlanSection
        v-for="(section, index) in plan.document.sections"
        :key="section.id"
        :section="section"
        :answers="answers"
        :initially-open="index < 2"
        :disabled="locked || busy || !respond"
        @choice="changeChoice"
        @comment="changeComment"
      />
    </article>
    <PlanReviewFooter
      :comments="[]"
      :disabled="locked || busy || Boolean(error) || nativeApprovalDisabled"
      :show-comment-help="false"
      :show-approval-actions="nativeApprovalAvailable === true"
      :confirm-label="t('htmlPlan.implement')"
      @confirm="approve"
      @cancel="emit('cancelPlan')"
    >
      <template #status>
        <span v-if="status" role="status">{{ status }}</span>
        <span v-if="error" role="alert">{{ error }}</span>
        <button
          v-if="save.error.value"
          class="app-button"
          type="button"
          @click="retrySave"
        >
          {{ t('htmlPlan.retry') }}
        </button>
      </template>
      <template #secondary-actions>
        <button
          class="app-button"
          :class="nativeApprovalAvailable ? 'app-button--secondary' : 'app-button--primary'"
          type="button"
          :disabled="locked || busy || !respond"
          @click="submit"
        >
          {{ t('htmlPlan.submit') }}
        </button>
      </template>
    </PlanReviewFooter>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { isPlanAnswers, type InteractivePlan, type InteractivePlanResponse, type PlanAnswers } from '@workspace/core/interactive-plan';
import { useDebouncedSave } from '../shared/use-debounced-save';
import PlanReviewFooter from './PlanReviewFooter.vue';
import InteractivePlanSection from './InteractivePlanSection.vue';

const props = defineProps<{
  plan: InteractivePlan;
  nativeApprovalAvailable?: boolean;
  nativeApprovalDisabled?: boolean;
  respond?: (response: InteractivePlanResponse) => Promise<InteractivePlan>;
}>();
const emit = defineEmits<{ confirmPlan: []; cancelPlan: [] }>();
const { t } = useI18n();
// The parent keys this review by owner, conversation, plan and revision.
// Pending saves keep their original target when that identity changes.
const planId = props.plan.id;
const revision = props.plan.revision;
const answers = ref<PlanAnswers>(copyAnswers(props.plan.answers));
const version = ref(props.plan.answerVersion);
const pendingAction = ref<'revise' | 'approve' | null>(null);
const busy = computed(() => pendingAction.value !== null);
const submitted = ref(false);
const submitError = ref('');
const locked = computed(() => submitted.value || props.plan.submitted || props.plan.deliveryPending === true);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
const save = useDebouncedSave(async (answers: PlanAnswers) => {
  if (!props.respond) throw new Error(t('htmlPlan.unavailable'));
  const result = await props.respond({ planId, revision, answerVersion: version.value, action: 'save', answers });
  version.value = result.answerVersion;
}, 350);
const error = computed(() => submitError.value || save.error.value);
const status = computed(() => pendingAction.value === 'revise' ? t('htmlPlan.submitting')
  : props.plan.deliveryPending ? t('htmlPlan.deliveryPending')
    : locked.value ? t('htmlPlan.submitted') : '');

function copyAnswers(value: PlanAnswers): PlanAnswers {
  return { choices: { ...value.choices }, comments: { ...value.comments } };
}
function changeChoice(sectionId: string, option: string | null) {
  const next = copyAnswers(answers.value);
  if (option === null) delete next.choices[sectionId];
  else next.choices[sectionId] = option;
  edit(next);
}
function changeComment(sectionId: string, comment: string) {
  const next = copyAnswers(answers.value);
  if (comment) next.comments[sectionId] = comment;
  else delete next.comments[sectionId];
  edit(next);
}
function edit(next: PlanAnswers) {
  if (locked.value || busy.value || !isPlanAnswers(next, props.plan.document)) return;
  answers.value = next;
  submitError.value = '';
  save.schedule(copyAnswers(next));
}
async function retrySave() {
  save.schedule(copyAnswers(answers.value));
  await save.flush();
}
async function submit() {
  if (locked.value || busy.value || !props.respond) return;
  pendingAction.value = 'revise';
  submitError.value = '';
  try {
    if (!(await save.flush()) || disposed || locked.value) return;
    const result = await props.respond({ planId, revision, answerVersion: version.value, action: 'submit', answers: copyAnswers(answers.value) });
    submitted.value = result.submitted;
    version.value = result.answerVersion;
  } catch (cause) {
    submitError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    pendingAction.value = null;
  }
}
async function approve() {
  if (locked.value || busy.value || error.value || !props.nativeApprovalAvailable || props.nativeApprovalDisabled) return;
  pendingAction.value = 'approve';
  try {
    if (!(await save.flush()) || disposed || locked.value || !props.nativeApprovalAvailable || props.nativeApprovalDisabled) return;
    emit('confirmPlan');
  } finally {
    pendingAction.value = null;
  }
}
</script>
<style scoped>
.interactive-plan-panel {
  container-type: inline-size;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-surface-lowest);
}
.interactive-plan-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 28px 24px 12px;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  overflow-wrap: anywhere;
}
.interactive-plan-content h1 {
  font-size: 24px;
  line-height: 1.25;
  letter-spacing: -0.65px;
  font-weight: 700;
  margin: 0 0 18px;
}
.interactive-plan-content :deep(*) { box-sizing: border-box; }
.interactive-plan-content :deep(button) { cursor: pointer; }
.interactive-plan-content :deep(button:disabled) { cursor: default; opacity: 0.5; }
.interactive-plan-content :deep(:focus-visible) { outline: 2px solid var(--color-primary); outline-offset: 3px; }
@container (max-width: 400px) {
  .interactive-plan-content { padding: 20px 16px 8px; }
  .interactive-plan-content h1 { font-size: 21px; }
}
[role='alert'] {
  color: var(--color-error);
}
</style>
