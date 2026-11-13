<template>
  <section
    v-if="shellReady && noticeVisible"
    class="telemetry-notice"
    :aria-label="t('telemetry.title')"
  >
    <div class="telemetry-notice__content">
      <p>{{ t('telemetry.notice', { product: product.name }) }}</p>
      <div class="telemetry-notice__actions">
        <button class="app-button app-button--small app-button--tertiary" type="button" :disabled="busy" @click="change('disable')">
          {{ t('common.cancel') }}
        </button>
        <button class="app-button app-button--small app-button--primary" type="button" :disabled="busy" @click="change('enable')">
          {{ t('common.close') }}
        </button>
      </div>
    </div>
    <p v-if="failed" class="telemetry-notice__error" role="alert">{{ t('telemetry.failed') }}</p>
  </section>
</template>
<script setup lang="ts">
import { inject, onMounted, ref } from 'vue';
import { useForegroundTimeout } from '../shared/use-foreground-timeout';
import { useI18n } from 'vue-i18n';
import { product } from '@workspace/core/product';
import { telemetryNoticeReadyKey, useTelemetryConsent } from './use-telemetry-consent';
const shellReady = inject(telemetryNoticeReadyKey, ref(false));
const { t } = useI18n();
const { state, busy, failed, load, change, noticeVisible, noticeRemainingMs, automaticAttempted, enableAutomatically } = useTelemetryConsent();
useForegroundTimeout(
  () => shellReady.value && noticeVisible.value && state.value?.enabled === undefined && !busy.value && !automaticAttempted.value,
  noticeRemainingMs,
  enableAutomatically,
);
onMounted(load);
</script>
<style scoped>
/* Keep the attached notice above the header shadow across workspace boundaries. */
:global(.workspace-body:has(.telemetry-notice)) {
  z-index: auto;
}
.telemetry-notice {
  position: relative;
  z-index: 6;
  flex: 0 0 auto;
  /* Match the SDK composer footer, including its reserved scrollbar gutter. */
  width: calc(100% - var(--space-16) * 2 - var(--space-4));
  max-width: var(--agent-ui-conversation-content-width, 860px);
  align-self: center;
  margin: 0 var(--space-4) var(--space-6) 0;
  border: 1px solid var(--color-border);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  box-shadow: var(--shadow-sm);
  background: var(--color-surface-lowest);
}
.telemetry-notice__content {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-8);
}
.telemetry-notice__content p {
  flex: 1 1 240px;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}
.telemetry-notice__actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-4);
  margin-left: auto;
}
.telemetry-notice__error {
  margin: 0;
  padding: 0 var(--space-8) var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}
</style>
