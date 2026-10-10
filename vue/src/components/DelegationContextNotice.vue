<template>
  <p v-if="context" class="delegation-context-notice" role="status">
    {{ t(context.effective === 'conversation' ? 'delegation.continued' : 'delegation.startedFresh') }}
    <span v-if="context.reason">{{ t(`delegation.fallback.${context.reason}`) }}</span>
  </p>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { DelegationContext } from '@workspace/core/delegation-context';
defineProps<{ context?: DelegationContext }>();
const { t } = useI18n();
</script>
<style scoped>
.delegation-context-notice {
  margin: 0;
  padding: var(--space-8) var(--space-16);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  border-bottom: 1px solid var(--color-border);
}
</style>
