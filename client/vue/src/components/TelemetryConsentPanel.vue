<template>
  <section class="telemetry-consent" :aria-label="t('telemetry.title')">
    <p class="telemetry-consent__status" role="status">
      {{ t(state?.enabled ? "telemetry.on" : "telemetry.off") }}
    </p>
    <p>{{ t("telemetry.fields", { product: product.name }) }}</p>
    <p>{{ t("telemetry.exclusions") }}</p>
    <p>{{ t("telemetry.identity") }}</p>
    <p>{{ t("telemetry.retention") }}</p>
    <p>
      {{ t("telemetry.control") }}
      <a
        :href="policyUrl"
        @click.prevent="appPlatformActions.openExternal?.(policyUrl)"
        >{{ t("telemetry.policy") }}</a
      >
    </p>
    <p v-if="failed || previewError" role="alert">
      {{ t("telemetry.failed") }}
    </p>
    <div class="telemetry-consent__actions">
      <button
        class="app-button app-button--secondary"
        type="button"
        :disabled="busy || !state"
        @click="choose(state?.enabled ? 'disable' : 'enable')"
      >
        {{ t(state?.enabled ? "telemetry.stop" : "telemetry.share") }}
      </button>
      <button
        class="app-button app-button--tertiary"
        type="button"
        :disabled="busy || !state"
        @click="choose('reset')"
      >
        {{ t("telemetry.reset") }}
      </button>
      <button
        v-if="failed"
        class="app-button app-button--tertiary"
        type="button"
        @click="retry"
      >
        {{ t("common.retry") }}
      </button>
    </div>
    <div class="telemetry-consent__preview-controls">
      <label
        >{{ t("telemetry.day") }}
        <input
          v-model="day"
          type="date"
          :max="today"
          :disabled="previewBusy || busy"
          @change="clearPreview"
      /></label>
      <button
        class="app-button app-button--tertiary"
        type="button"
        :disabled="previewBusy || busy || !state"
        @click="showPreview"
      >
        {{ t("telemetry.preview") }}
      </button>
    </div>
    <template v-if="preview">
      <p role="status">{{ t(`telemetry.${preview.kind}`) }}</p>
      <pre class="telemetry-preview">{{ preview.body }}</pre>
      <button
        class="app-button app-button--secondary"
        type="button"
        @click="copy"
      >
        {{ t("telemetry.copy") }}
      </button>
      <span v-if="copied" role="status">{{ t("telemetry.copied") }}</span>
    </template>
  </section>
</template>
<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { product } from "@workspace/core/product";
import type {
  TelemetryConsentAction,
  TelemetryProfilePreview,
} from "@workspace/core/telemetry-consent";
import { appApi, appPlatformActions } from "../platform-api";
import { useTelemetryConsent } from "./use-telemetry-consent";

const { t } = useI18n();
const { state, busy, failed, load, change, retry } = useTelemetryConsent();
const today = new Date().toISOString().slice(0, 10);
const day = ref(today);
const preview = ref<TelemetryProfilePreview | null>(null);
const previewBusy = ref(false),
  previewError = ref(false),
  copied = ref(false);
const policyUrl = `${product.websiteUrl}/privacy/`;
let revision = 0;
function clearPreview() {
  ++revision;
  preview.value = null;
  copied.value = false;
}
watch(state, clearPreview);
async function choose(action: TelemetryConsentAction) {
  clearPreview();
  await change(action);
}
async function showPreview() {
  const expected = ++revision;
  previewBusy.value = true;
  previewError.value = false;
  copied.value = false;
  try {
    const next = await appApi!.previewTelemetryDay(day.value);
    if (expected === revision) preview.value = next;
  } catch {
    if (expected === revision) previewError.value = true;
  } finally {
    previewBusy.value = false;
  }
}
async function copy() {
  if (!preview.value) return;
  try {
    await navigator.clipboard.writeText(preview.value.body);
    copied.value = true;
  } catch {
    previewError.value = true;
  }
}
onMounted(load);
</script>
<style scoped>
.telemetry-consent {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: 1.5;
}
.telemetry-consent p {
  margin: 0 0 var(--space-4);
}
.telemetry-consent__status {
  color: var(--color-text);
  font-weight: 600;
}
.telemetry-consent a {
  color: var(--color-primary);
}
.telemetry-consent__actions,
.telemetry-consent__preview-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-6);
}
.telemetry-consent input {
  color: var(--color-text);
  background: var(--color-surface-lowest);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2);
  font: inherit;
}
.telemetry-preview {
  overflow: auto;
  max-height: 240px;
  padding: var(--space-4);
  background: var(--color-card-background);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  white-space: pre;
  user-select: text;
}
</style>
