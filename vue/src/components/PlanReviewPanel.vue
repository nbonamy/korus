<template>
  <PlanReviewEditor
    :key="`${review.conversationId}:${review.id}`"
    :review="review"
    :interactive="interactive"
    :approval-warning="approvalWarning"
    :respond="respond"
    :plan-updating="planUpdating"
  />
</template>
<script setup lang="ts">
import type { PlanReview, PlanReviewResponse } from '@workspace/core/plan-review';
import PlanReviewEditor from './PlanReviewEditor.vue';
withDefaults(
  defineProps<{
    review: PlanReview;
    interactive?: boolean;
    approvalWarning?: string;
    planUpdating?: boolean;
    respond?: (response: PlanReviewResponse) => Promise<PlanReview>;
  }>(),
  { interactive: true },
);
</script>
