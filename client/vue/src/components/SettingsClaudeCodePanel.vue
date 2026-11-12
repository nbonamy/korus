<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsClaudeCodePanel.claudeCode')"
    title-id="settings-claude-code-title"
  >
    <SettingsEngineConnectionRow provider="claude" :capabilities="setupCapabilities" :installed="installed" :title="$t('surface.settingsClaudeCodePanel.claudeCode')" :authentication="authentication" :connected="connected" :enabled="enabled" :set-enabled="setEnabled" :busy="busy" :error="error" @install="emit('install')" @refresh="emit('refresh')" @connect="emit('connect')" @disconnect="emit('disconnect')">
      <ProviderUpdateRow v-if="installed" provider="claude" />
      <SettingsEngineSetupRow :capabilities="setupCapabilities" :home="home" @customize="emit('customize')" />
    </SettingsEngineConnectionRow>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsEngineConnectionRow from './SettingsEngineConnectionRow.vue';
import SettingsEngineSetupRow from './SettingsEngineSetupRow.vue';
import ProviderUpdateRow from './ProviderUpdateRow.vue';
import type { ProviderSetupCapabilities, ProviderAuthentication, ProviderHomeSettings } from '@workspace/core/contracts/provider-setup';

withDefaults(defineProps<{ setupCapabilities?: ProviderSetupCapabilities; installed?: boolean; connected?: boolean; enabled?: boolean; authentication?: ProviderAuthentication; home?: ProviderHomeSettings; setEnabled?: (enabled: boolean) => unknown; busy?: boolean; error?: string | null }>(), { enabled: true, installed: true });
const emit = defineEmits<{ connect: []; disconnect: []; customize: []; refresh: []; install: [] }>();
</script>
