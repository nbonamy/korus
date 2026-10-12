<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsCodexPanel.codex')"
    title-id="settings-codex-title"
  >
    <SettingsEngineConnectionRow backend="codex" :installed="installed" :title="$t('surface.settingsCodexPanel.codex')" :authentication="authentication" :connected="connected" :enabled="settings.providerEnabled?.codex !== false" :set-enabled="setEnabled" :busy="connectionBusy" :pending="loginPending" :error="connectionError" @refresh="emit('refresh')" @connect="emit('connect')" @disconnect="emit('disconnect')" @cancel="emit('cancel')">
      <ProviderUpdateRow v-if="installed" backend="codex" />
      <SettingsEngineSetupRow :home="settings.providerHomes?.codex" @customize="emit('customize')" />
    </SettingsEngineConnectionRow>
    <SettingsBankedResets :eligible="Boolean(connected && account?.type === 'chatgpt')" :unavailable="!installed || settings.providerEnabled?.codex === false || Boolean(connected && account && account.type !== 'chatgpt')" :account-key="JSON.stringify([account, settings.providerHomes?.codex?.homePath])" :remote-connection-id="remoteConnectionId" />
    <FormSection
      :title="$t('surface.settingsCodexPanel.chatGPT')"
      title-id="settings-codex-chatgpt-title"
    >
      <FormRow
        :title="$t('surface.settingsCodexPanel.launchChatGPT')"
        :description="$t('surface.settingsCodexPanel.manageCodexPluginsSkillsAndSandboxPoliciesInChatGPTUsing')"
        :error="launchError"
      >
        <template #control>
          <el-button
            :loading="launching"
            size="small"
            @click="launch"
          > {{ $t('surface.settingsCodexPanel.launchChatGPT') }} </el-button>
        </template>
      </FormRow>
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AppGeneralSettings } from '@workspace/core/contracts';
import { appPlatformActions } from '../platform-api';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';
import SettingsEngineConnectionRow from './SettingsEngineConnectionRow.vue';
import SettingsEngineSetupRow from './SettingsEngineSetupRow.vue';
import SettingsBankedResets from './SettingsBankedResets.vue';
import ProviderUpdateRow from './ProviderUpdateRow.vue';
import type { ProviderAuthentication } from '@workspace/core/contracts/provider-setup';

const emit = defineEmits<{ connect: []; disconnect: []; cancel: []; customize: []; refresh: [] }>();

const props = withDefaults(defineProps<{
  connected?: boolean;
  remoteConnectionId?: string;
  installed?: boolean;
  authentication?: ProviderAuthentication;
  setEnabled?: (enabled: boolean) => unknown;
  connectionBusy?: boolean;
  loginPending?: boolean;
  connectionError?: string | null;
  launchChatGptApp?: () => Promise<void>;
  settings: AppGeneralSettings;
}>(), { installed: true });

const account = computed(() => props.authentication?.kind === 'codex' ? props.authentication.state.account : null);

const launching = ref(false);
const launchError = ref<string | null>(null);

async function launch(): Promise<void> {
  launchError.value = null;
  launching.value = true;
  try {
    const launchApp = props.launchChatGptApp ?? appPlatformActions.launchChatGpt;
    await launchApp();
  } catch (error) {
    launchError.value = error instanceof Error ? error.message : String(error);
  } finally {
    launching.value = false;
  }
}
</script>
