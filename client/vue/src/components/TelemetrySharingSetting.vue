<template>
  <FormRow
    as="label"
    :title="$t('telemetry.share')"
    :error="telemetryFailed ? $t('telemetry.failed') : null"
  >
    <template #control>
      <ElSwitch
        :model-value="telemetryState?.enabled === true"
        :disabled="telemetryBusy || !telemetryState"
        :aria-label="$t('telemetry.share')"
        @update:model-value="changeTelemetry($event ? 'enable' : 'disable')"
      />
    </template>
  </FormRow>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { ElSwitch } from 'element-plus';
import FormRow from '../shared/form/FormRow.vue';
import { useTelemetryConsent } from './use-telemetry-consent';

const { state: telemetryState, busy: telemetryBusy, failed: telemetryFailed, load: loadTelemetry, change: changeTelemetry } = useTelemetryConsent();
onMounted(loadTelemetry);
</script>
