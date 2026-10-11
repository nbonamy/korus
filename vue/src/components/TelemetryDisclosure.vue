<template>
  <FormDialog
    :model-value="visible"
    :title="$t('telemetry.privacy')"
    @update:model-value="() => undefined"
  >
    <p>{{ $t("telemetry.disclosure") }}</p>
    <p>{{ $t("telemetry.delivery") }}</p>
    <p>{{ $t("telemetry.optOut") }}</p>
    <label
      ><input v-model="enabled" type="checkbox" />
      {{ $t("telemetry.reporting") }}</label
    >
    <p v-if="error" role="alert">{{ $t("telemetry.error") }}</p>
    <template #footer
      ><button
        type="button"
        class="app-button app-button--primary"
        :disabled="busy"
        @click="confirm"
      >
        {{ $t("telemetry.continue") }}
      </button></template
    >
  </FormDialog>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import FormDialog from "../shared/dialog/FormDialog.vue";
import { appApi } from "../platform-api";
const visible = ref(false);
const enabled = ref(true);
const error = ref(false);
const busy = ref(false);
onMounted(async () => {
  try {
    visible.value = (await appApi!.getTelemetryPrivacy()).choice === null;
  } catch {
    /* An unavailable host cannot upload. */
  }
});
async function confirm(): Promise<void> {
  busy.value = true;
  try {
    await appApi!.setTelemetryPrivacy({
      enabled: enabled.value,
      disclosure: 1,
    });
    visible.value = false;
  } catch {
    error.value = true;
  } finally {
    busy.value = false;
  }
}
</script>
