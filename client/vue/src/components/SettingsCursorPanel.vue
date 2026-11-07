<template>
  <SettingsPanelFrame :title="$t('cursor.name')" title-id="settings-cursor-title">
    <SettingsEngineConnectionRow backend="cursor" :installed="installed" :title="$t('cursor.name')" :authentication="authentication" :connected="connected" :enabled="enabled" :set-enabled="setEnabled" :busy="busy" :pending="pending" :error="error || nativeState?.error" @refresh="emit('refresh')" @connect="emit('connect')" @disconnect="emit('disconnect')" @cancel="emit('cancel')">
      <SettingsEngineSetupRow :home="home" @customize="emit('customize')" />
      <FormRow v-if="nativeState?.team" :title="$t('cursor.team')" :description="nativeState.team" />
      <ProviderUpdateRow backend="cursor" :enabled="installed" :remote-connection-id="remoteConnectionId" />
    </SettingsEngineConnectionRow>
  </SettingsPanelFrame>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { ProviderAuthentication, ProviderHomeSettings } from '@workspace/core/contracts/provider-setup';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsEngineConnectionRow from './SettingsEngineConnectionRow.vue';
import ProviderUpdateRow from './ProviderUpdateRow.vue';
import SettingsEngineSetupRow from './SettingsEngineSetupRow.vue';
import FormRow from '../shared/form/FormRow.vue';
const props = withDefaults(defineProps<{ home?: ProviderHomeSettings; installed?: boolean; connected?: boolean; enabled?: boolean; authentication?: ProviderAuthentication; setEnabled?: (enabled: boolean) => unknown; busy?: boolean; pending?: boolean; error?: string | null; remoteConnectionId?: string }>(), { installed: false });
const nativeState = computed(() => props.authentication?.kind === 'cursor' ? props.authentication.state : undefined);
const emit = defineEmits<{ customize: []; connect: []; disconnect: []; cancel: []; refresh: [] }>();
</script>
