<template>
  <FormSection
    :title="$t('telemetry.privacy')"
    title-id="settings-telemetry-title"
  >
    <TelemetryReportingControl
      :model-value="privacy?.choice?.enabled ?? false"
      :disabled="busy || !privacy"
      :description="
        privacy?.active ? $t('telemetry.active') : $t('telemetry.inactive')
      "
      @update:model-value="save"
    />
    <p v-if="error" role="alert">{{ $t("telemetry.error") }}</p>
    <details v-if="privacy">
      <summary>{{ $t("telemetry.pending") }}</summary>
      <pre>{{ JSON.stringify(privacy.pending, null, 2) }}</pre>
    </details>
  </FormSection>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  telemetryDisclosureVersion,
  type TelemetryPrivacy,
} from "@workspace/core/telemetry";
import { appApi } from "../platform-api";
import FormSection from "../shared/form/FormSection.vue";
import TelemetryReportingControl from "./TelemetryReportingControl.vue";
const privacy = ref<TelemetryPrivacy | null>(null);
const busy = ref(false);
const error = ref(false);
onMounted(async () => {
  try {
    privacy.value = await appApi!.getTelemetryPrivacy();
  } catch {
    error.value = true;
  }
});
async function save(enabled: boolean): Promise<void> {
  busy.value = true;
  error.value = false;
  try {
    privacy.value = await appApi!.setTelemetryPrivacy({
      enabled,
      disclosure: telemetryDisclosureVersion,
    });
  } catch {
    error.value = true;
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped>
pre {
  max-width: 100%;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
