<template>
  <SettingsPanelFrame :title="$t('antigravity.name')" title-id="settings-antigravity-title">
    <SettingsEngineConnectionRow provider="antigravity" :capabilities="setupCapabilities" :installed="installed" :title="$t('antigravity.name')" :authentication="authentication" :connected="connected" :enabled="enabled" :set-enabled="setEnabled" :busy="busy" :pending="pending" :error="error" @refresh="emit('refresh')" @install="emit('install')" @connect="emit('connect')" @disconnect="emit('disconnect')" @cancel="emit('cancel')">
      <ProviderUpdateRow provider="antigravity" :enabled="installed" />
      <SettingsEngineSetupRow :capabilities="setupCapabilities" :home="home" @customize="emit('customize')" />
    </SettingsEngineConnectionRow>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import type { ProviderSetupCapabilities, ProviderAuthentication, ProviderHomeSettings } from '@workspace/core/contracts/provider-setup';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsEngineConnectionRow from './SettingsEngineConnectionRow.vue';
import SettingsEngineSetupRow from './SettingsEngineSetupRow.vue';
import ProviderUpdateRow from './ProviderUpdateRow.vue';
withDefaults(defineProps<{ setupCapabilities?: ProviderSetupCapabilities; installed?: boolean; connected?: boolean; enabled?: boolean; authentication?: ProviderAuthentication; home?: ProviderHomeSettings; setEnabled?: (enabled: boolean) => unknown; busy?: boolean; pending?: boolean; error?: string | null }>(), { installed: true });
const emit = defineEmits<{ connect: []; disconnect: []; customize: []; cancel: []; refresh: []; install: [] }>();
</script>
