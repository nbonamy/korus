<template>
  <SettingsPanelFrame :title="$t('telemetry.privacy')" title-id="privacy-title">
    <p>{{ $t("telemetry.disclosure") }}</p>
    <p>{{ $t("telemetry.delivery") }}</p>
    <p>{{ $t("telemetry.optOut") }}</p>
    <FormSection>
      <FormRow
        :title="$t('telemetry.reporting')"
        :description="
          privacy?.active ? $t('telemetry.active') : $t('telemetry.inactive')
        "
      >
        <template #control
          ><el-switch
            :model-value="privacy?.choice?.enabled ?? true"
            :disabled="busy || !privacy"
            :aria-label="$t('telemetry.reporting')"
            @update:model-value="save(Boolean($event))"
        /></template>
      </FormRow>
    </FormSection>
    <button
      v-if="privacy && !privacy.choice"
      class="app-button"
      type="button"
      :disabled="busy"
      @click="save(true)"
    >
      {{ $t("telemetry.continue") }}
    </button>
    <p v-if="error" role="alert">{{ $t("telemetry.error") }}</p>
    <details v-if="privacy">
      <summary>{{ $t("telemetry.pending") }}</summary>
      <pre>{{ JSON.stringify(privacy.pending, null, 2) }}</pre>
    </details>
  </SettingsPanelFrame>
</template>
<script setup lang="ts">
import { telemetryDisclosureVersion } from "@workspace/core/telemetry";
import { onMounted, ref } from "vue";
import type { TelemetryPrivacy } from "@workspace/core/telemetry";
import { appApi } from "../platform-api";
import SettingsPanelFrame from "./SettingsPanelFrame.vue";
import FormSection from "../shared/form/FormSection.vue";
import FormRow from "../shared/form/FormRow.vue";
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
