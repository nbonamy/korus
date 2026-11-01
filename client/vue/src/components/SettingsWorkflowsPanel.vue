<template>
  <SettingsPanelFrame :title="t('workflows.title')" title-id="settings-workflows-title">
    <template #banner>
      <SettingsIntro kind="workflows" :title="t('surface.settingsWorkflowsPanel.introTitle')" :description="t('surface.settingsWorkflowsPanel.introDescription')" />
    </template>
    <FormSection :title="t('guest.settingsTitle')" title-id="settings-workflows-collaboration-title">
      <FormRow as="div" :title="t('guest.displayName')" :description="t('guest.displayNamePurpose')">
        <template #control>
          <el-input
            :model-value="displayName"
            :aria-label="t('guest.displayName')"
            autocomplete="nickname"
            :maxlength="80"
            @update:model-value="updateDisplayName"
          />
        </template>
      </FormRow>
    </FormSection>
    <p v-if="error" role="alert">{{ error }}</p>
    <SettingsPlanModeSection :settings="settings" :update-settings="updateSettings" />
    <SettingsDelegationSection :settings="settings" :update-settings="updateSettings" />
    <SettingsReviewSection :settings="settings" :update-settings="updateSettings" />
    <SettingsMissionSection :settings="settings" :update-settings="updateSettings" />
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppGeneralSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import { useDebouncedSave } from '../shared/use-debounced-save';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsIntro from './SettingsIntro.vue';
import SettingsPlanModeSection from './SettingsPlanModeSection.vue';
import SettingsDelegationSection from './SettingsDelegationSection.vue';
import SettingsReviewSection from './SettingsReviewSection.vue';
import SettingsMissionSection from './SettingsMissionSection.vue';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';

const props = defineProps<{ settings: AppGeneralSettings; updateSettings?: (input: UpdateSettingsInput) => Promise<void> }>();
const { t } = useI18n();
const displayName = ref(props.settings.guestDisplayName ?? '');
const persistedDisplayName = ref(displayName.value.trim());
const { schedule, error } = useDebouncedSave(async (guestDisplayName: string) => {
  if (!props.updateSettings) throw new Error('Settings client unavailable.');
  await props.updateSettings({ general: { guestDisplayName } });
  persistedDisplayName.value = guestDisplayName;
});
function updateDisplayName(value: string) {
  displayName.value = value.replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 80);
  schedule(displayName.value.trim());
}
watch(() => props.settings.guestDisplayName, value => {
  const next = value ?? '';
  if (displayName.value.trim() === persistedDisplayName.value) displayName.value = next;
  persistedDisplayName.value = next;
});
</script>
