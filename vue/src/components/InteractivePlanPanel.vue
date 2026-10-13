<template>
  <InteractivePlanReview
    :key="identity"
    :plan="plan"
    :respond="respond"
    :native-approval-available="nativeApprovalAvailable"
    :native-approval-disabled="nativeApprovalDisabled"
    @confirm-plan="emit('confirmPlan')"
    @cancel-plan="emit('cancelPlan')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { InteractivePlan, InteractivePlanResponse } from '@workspace/core/interactive-plan';
import InteractivePlanReview from './InteractivePlanReview.vue';

const props = defineProps<{
  plan: InteractivePlan;
  nativeApprovalAvailable?: boolean;
  nativeApprovalDisabled?: boolean;
  respond?: (response: InteractivePlanResponse) => Promise<InteractivePlan>;
}>();
const emit = defineEmits<{ confirmPlan: []; cancelPlan: [] }>();
const identity = computed(() => JSON.stringify([
  props.plan.agentId, props.plan.conversationId, props.plan.id, props.plan.revision,
]));
</script>
