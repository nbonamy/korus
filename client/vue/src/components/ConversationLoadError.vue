<template>
  <div class="conversation-load-error" role="alert">
    <div
      class="conversation-load-error__illustration"
      data-testid="conversation-load-error-illustration"
      aria-hidden="true"
    >
      <MessageCircleXIcon />
    </div>
    <div class="conversation-load-error__copy">
      <h1>{{ $t('surface.conversationPane.historyLoadFailed') }}</h1>
      <p>{{ $t('surface.conversationPane.historyLoadFailedReason') }}</p>
    </div>
    <button
      class="app-button app-button--secondary"
      type="button"
      :disabled="loading"
      @click="emit('retry')"
    >{{ $t('surface.conversationPane.retryHistory') }}</button>
  </div>
</template>

<script setup lang="ts">
import { MessageCircleXIcon } from '../shared/icons/app-icons';

defineProps<{ loading: boolean }>();

const emit = defineEmits<{
  retry: [];
}>();
</script>

<style scoped>
.conversation-load-error {
  display: grid;
  justify-items: center;
  gap: var(--space-8);
  width: min(100%, 520px);
  margin: auto;
  padding: var(--space-12);
  text-align: center;
  transform: translateY(calc(var(--space-32) * -1));
}

.conversation-load-error__illustration {
  display: grid;
  width: 72px;
  height: 72px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  place-items: center;
  color: var(--color-text-muted);
  background: var(--color-surface-low);
}

.conversation-load-error__illustration svg {
  width: 38px;
  height: 38px;
  stroke-width: 1.5;
}

.conversation-load-error__copy {
  display: grid;
  gap: var(--space-3);
}

.conversation-load-error h1,
.conversation-load-error p {
  margin: 0;
}

.conversation-load-error h1 {
  color: var(--color-text);
  font-size: var(--font-size-24);
  font-weight: 650;
  line-height: 1.25;
}

.conversation-load-error p {
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  line-height: 1.5;
}
</style>
