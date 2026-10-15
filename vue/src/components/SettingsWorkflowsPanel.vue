<template>
  <SettingsPanelFrame :title="t('workflows.title')" title-id="settings-workflows-title">
    <SettingsPlanModeSection :settings="settings" :update-settings="updateSettings" />
    <SettingsDelegationSection :settings="settings" :update-settings="updateSettings" />
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AppGeneralSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsPlanModeSection from './SettingsPlanModeSection.vue';
import SettingsDelegationSection from './SettingsDelegationSection.vue';

defineProps<{ settings: AppGeneralSettings; updateSettings?: (input: UpdateSettingsInput) => Promise<void> }>();
const { t } = useI18n();
</script>
