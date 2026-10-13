<template>
  <footer class="plan-review-footer">
    <div class="plan-review-footer__status"><slot /></div>
    <div class="plan-review-footer__actions">
      <button
        class="app-button app-button--tertiary"
        type="button"
        :disabled="disabled"
        @click="emit('cancel')"
      >
        {{ t('chat.planReview.cancel') }}
      </button>
      <button
        class="app-button app-button--secondary"
        type="button"
        :disabled="disabled || !hasFeedback"
        @click="emit('revise')"
      >
        {{ t('planFeedback.submit') }}
      </button>
      <button
        v-if="canApprove"
        class="app-button app-button--primary"
        type="button"
        :disabled="disabled"
        @click="emit('approve')"
      >
        {{ t('planFeedback.implement') }}
      </button>
    </div>
  </footer>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
withDefaults(defineProps<{ disabled?: boolean; hasFeedback: boolean; canApprove?: boolean }>(), {
  canApprove: true,
});
const emit = defineEmits<{ cancel: []; revise: []; approve: [] }>();
const { t } = useI18n();
</script>
<style scoped>
.plan-review-footer {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-lowest);
}
.plan-review-footer__status:empty {
  display: none;
}
.plan-review-footer__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-3);
}
.plan-review-footer__actions .app-button {
  flex-shrink: 0;
  white-space: nowrap;
}
</style>
