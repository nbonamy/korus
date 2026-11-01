<template>
  <FormDialog
    :model-value="ready && !!state?.noticePending"
    :title="t('telemetry.title')"
    width="620px"
    teleported
    @update:model-value="dismiss"
  >
    <TelemetryConsentPanel notice />
  </FormDialog>
</template>
<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import FormDialog from "../shared/dialog/FormDialog.vue";
import TelemetryConsentPanel from "./TelemetryConsentPanel.vue";
import { useTelemetryConsent } from "./use-telemetry-consent";
defineProps<{ ready: boolean }>();
const { t } = useI18n();
const { state, busy, load, change } = useTelemetryConsent();
function dismiss(visible: boolean) {
  if (!visible && !busy.value) void change("dismiss");
}
onMounted(load);
</script>
