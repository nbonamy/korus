<template>
  <PlanReviewEditor
    :key="`${review.conversationId}:${review.id}`"
    :review="review"
    :interactive="interactive"
    :respond="respond"
    :plan-updating="planUpdating"
    :cancellable="cancellable"
  />
</template>
<script setup lang="ts">
import type { PlanReview, PlanReviewResponse } from '@workspace/core/plan-review';
import PlanReviewEditor from './PlanReviewEditor.vue';
withDefaults(
  defineProps<{
    review: PlanReview;
    interactive?: boolean;
    planUpdating?: boolean;
    /** Whether the review can be cancelled; a Mission's requirements are revised or approved instead. */
    cancellable?: boolean;
    respond?: (response: PlanReviewResponse) => Promise<PlanReview>;
  }>(),
  { interactive: true, cancellable: true },
);
</script>
