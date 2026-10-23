<template>
  <section class="mission-requirement-review" :aria-label="t('missions.requirementReview')">
    <PlanReviewPanel
      v-if="review"
      :review="review"
      :interactive="true"
      :approval-warning="t('missions.unconfirmedRequirementsApprove')"
      :plan-updating="disabled"
      :respond="respond && !readOnly ? respondToReview : undefined"
    />
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyPlanReviewDraft, planReviewFeedback, type PlanReview, type PlanReviewResponse, type PlanReviewResolution } from '@workspace/core/plan-review';
import PlanReviewPanel from './PlanReviewPanel.vue';

const props = defineProps<{
  content: string;
  reviewId: string;
  disabled?: boolean;
  readOnly?: boolean;
  respond?: (resolution: PlanReviewResolution, feedback?: string) => Promise<void>;
}>();
const { t } = useI18n();
const review = ref<PlanReview>();
let revision = 0;
watch(() => [props.content, props.reviewId, props.readOnly] as const, () => {
  review.value = {
    id: `${props.reviewId}:${++revision}`,
    conversationId: null,
    turnId: props.reviewId,
    markdown: props.content,
    status: props.readOnly ? 'accept' : 'pending',
  };
}, { immediate: true });

async function respondToReview(response: PlanReviewResponse): Promise<PlanReview> {
  const current = review.value!;
  if (props.disabled || response.reviewId !== current.id || !props.respond) throw new Error(t('planFeedback.unavailable'));
  if (response.resolution === 'save') {
    review.value = { ...current, draft: copyPlanReviewDraft(response.draft!), draftVersion: (current.draftVersion ?? 0) + 1 };
  } else {
    await props.respond(response.resolution, response.resolution === 'revise' ? planReviewFeedback(current) : undefined);
    if (review.value?.id === current.id) review.value = { ...current, status: response.resolution };
  }
  return review.value!;
}
</script>
<style scoped>
.mission-requirement-review :deep(.plan-review-document) {
  padding: 0;
}
</style>
