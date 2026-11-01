<template>
  <section
    v-if="shellReady && state && state.enabled === undefined"
    class="telemetry-notice"
    :aria-label="t('telemetry.title')"
  >
    <div class="telemetry-notice__content">
      <p>{{ t('telemetry.notice', { product: product.name }) }}</p>
      <div class="telemetry-notice__actions">
        <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="change('disable')">
          {{ t('telemetry.optOut') }}
        </button>
        <button class="app-button app-button--primary" type="button" :disabled="busy" @click="change('enable')">
          {{ t('common.close') }}
        </button>
      </div>
    </div>
    <p v-if="failed" class="telemetry-notice__error" role="alert">{{ t('telemetry.failed') }}</p>
  </section>
</template>
<script setup lang="ts">
import { inject, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { product } from '@workspace/core/product';
import { telemetryNoticeReadyKey, useTelemetryConsent } from './use-telemetry-consent';
const shellReady = inject(telemetryNoticeReadyKey, ref(false));
const { t } = useI18n();
const { state, busy, failed, load, change } = useTelemetryConsent();
onMounted(load);
</script>
<style scoped>
.telemetry-notice {
  width: 100%;
  margin-bottom: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
}
.telemetry-notice__content {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8);
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
