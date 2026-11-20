<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsSidebar.projects')"
    title-id="settings-projects-title"
  >
    <template #banner>
      <SettingsIntro
        :title="$t('surface.settingsProjectsPanel.introTitle')"
        :description="$t('surface.settingsProjectsPanel.introDescription')"
      />
    </template>

    <FormSection>
      <FormRow
        as="label"
        :title="$t('surface.settingsProjectsPanel.flow')"
        :description="$t('surface.settingsProjectsPanel.flowDescription')"
      >
        <template #control>
          <el-switch
            :model-value="settings.projectFlowEnabled === true"
            :aria-label="$t('surface.settingsProjectsPanel.flow')"
            @update:model-value="updateFlow"
          />
        </template>
      </FormRow>
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import type { AppGeneralSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import SettingsIntro from './SettingsIntro.vue';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';

const props = defineProps<{
  settings: AppGeneralSettings;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
}>();

function updateFlow(enabled: string | number | boolean): void {
  void props.updateSettings?.({ general: { projectFlowEnabled: enabled === true } });
}
</script>
