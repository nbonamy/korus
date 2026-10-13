<template>
  <section class="plan-review-panel" :aria-label="t('planFeedback.review')">
    <article class="plan-review-document" :aria-label="sections[0]?.title">
      <PlanReviewSection
        v-for="section in sections"
        :key="section.id"
        :section="section"
        :draft="draft"
        :disabled="locked || busy || warning !== null || !respond"
        @comment="changeComment"
        @choice="changeChoice"
      />
    </article>
    <PlanReviewFooter
      :disabled="locked || busy || warning !== null || Boolean(save.error.value) || !respond"
      :has-feedback="hasFeedback"
      :can-approve="review.canApprove !== false"
      @approve="requestDecision('accept')"
      @cancel="decide('cancel')"
      @revise="requestDecision('revise')"
    >
      <span v-if="review.deliveryPending" role="status">{{
        t('planFeedback.deliveryPending')
      }}</span>
      <span v-if="error" role="alert">{{ error }}</span>
      <button v-if="save.error.value" class="app-button" type="button" @click="retrySave">
        {{ t('planFeedback.retry') }}
      </button>
    </PlanReviewFooter>
    <FormDialog
      :model-value="warning !== null && !locked"
      :title="t('planFeedback.unconfirmedTitle')"
      width="440px"
      @update:model-value="warning = null"
    >
      <p>{{ t(warning === 'accept' ? 'planFeedback.unconfirmedApprove' : 'planFeedback.unconfirmedRevise') }}</p>
      <template #footer>
        <button class="app-button app-button--tertiary" type="button" @click="warning = null">
          {{ t('planFeedback.goBack') }}
        </button>
        <button class="app-button app-button--primary" type="button" :disabled="locked || busy" @click="continueDecision">
          {{ t(warning === 'accept' ? 'planFeedback.approveAnyway' : 'planFeedback.reviseAnyway') }}
        </button>
      </template>
    </FormDialog>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  isPlanReviewDraft,
  copyPlanReviewDraft as copy,
  type PlanReview,
  type PlanReviewDraft,
  type PlanReviewResponse,
  type PlanReviewResolution,
} from '@workspace/core/plan-review';
import { useDebouncedSave } from '../shared/use-debounced-save';
import { planMarkdownSections } from './plan-markdown';
import PlanReviewSection from './PlanReviewSection.vue';
import PlanReviewFooter from './PlanReviewFooter.vue';
import FormDialog from '../shared/dialog/FormDialog.vue';
const props = withDefaults(
  defineProps<{
    review: PlanReview;
    interactive?: boolean;
    planUpdating?: boolean;
    respond?: (response: PlanReviewResponse) => Promise<PlanReview>;
  }>(),
  { interactive: true },
);
const { t } = useI18n();
const reviewId = props.review.id;
const draft = ref<PlanReviewDraft>(copy(props.review.draft ?? { comments: [], choices: [] }));
const version = ref(props.review.draftVersion ?? 0);
const busy = ref(false);
const decided = ref(false);
const actionError = ref('');
const warning = ref<'accept' | 'revise' | null>(null);
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
});
const sections = computed(() =>
  planMarkdownSections(props.review.markdown, props.interactive !== false),
);
const locked = computed(
  () =>
    decided.value ||
    props.review.status !== 'pending' ||
    props.review.deliveryPending === true ||
    props.planUpdating === true,
);
const hasFeedback = computed(() => !!(draft.value.comments.length || draft.value.choices.length));
const save = useDebouncedSave(async (draft: PlanReviewDraft) => {
  if (!props.respond) throw new Error(t('planFeedback.unavailable'));
  const result = await props.respond({
    reviewId,
    resolution: 'save',
    draftVersion: version.value,
    draft,
  });
  version.value = result.draftVersion ?? 0;
}, 350);
const error = computed(() => actionError.value || save.error.value);
function edit(next: PlanReviewDraft) {
  if (locked.value || busy.value || !isPlanReviewDraft(next)) return;
  draft.value = next;
  actionError.value = '';
  save.schedule(copy(next));
}
function changeComment(comment: PlanReviewDraft['comments'][number]) {
  edit({
    ...copy(draft.value),
    comments: [
      ...draft.value.comments.filter((c) => c.id !== comment.id),
      ...(comment.body ? [comment] : []),
    ],
  });
}
function changeChoice(id: string, choice: PlanReviewDraft['choices'][number] | null) {
  edit({
    ...copy(draft.value),
    choices: [...draft.value.choices.filter((c) => c.id !== id), ...(choice ? [choice] : [])],
  });
}
async function retrySave() {
  save.schedule(copy(draft.value));
  await save.flush();
}
function requestDecision(resolution: 'accept' | 'revise') {
  if (locked.value || busy.value || !props.respond) return;
  const unconfirmed = sections.value.some(section => section.blocks.some(block =>
    'choice' in block && !draft.value.choices.some(answer => answer.id === block.choice.id && answer.confirmed === true),
  ));
  if (unconfirmed) warning.value = resolution;
  else void decide(resolution);
}
function continueDecision() {
  const resolution = warning.value;
  warning.value = null;
  if (resolution) void decide(resolution);
}
async function decide(resolution: PlanReviewResolution) {
  if (
    locked.value ||
    busy.value ||
    !props.respond ||
    (resolution === 'accept' && props.review.canApprove === false)
  )
    return;
  busy.value = true;
  actionError.value = '';
  try {
    if (!(await save.flush()) || disposed || locked.value) return;
    await props.respond({ reviewId, resolution, draftVersion: version.value });
    decided.value = true;
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped>
.plan-review-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-surface-lowest);
}
.plan-review-document {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  overflow-wrap: anywhere;
}
.plan-review-document :deep(*) {
  box-sizing: border-box;
}
.plan-review-document :deep(:focus-visible) {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}
[role='alert'] {
  color: var(--color-error);
}
</style>
