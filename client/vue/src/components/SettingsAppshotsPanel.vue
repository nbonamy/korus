<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsAppshotsPanel.appshots')"
    title-id="settings-appshots-title"
  >
    <template #banner>
      <SettingsIntro
        kind="appshots"
        :title="$t('surface.settingsAppshotsPanel.takeAnAppshotToShowCodexYourFrontmostWindow')"
        :description="$t('surface.settingsAppshotsPanel.appshotsCaptureTheWindowImageAndAttachItToYourActiveAgen')"
      />
    </template>

    <FormSection>
      <FormRow
        :title="$t('surface.settingsAppshotsPanel.hotkey')"
        :description="hotkeyDescription"
      >
        <template #control>
          <el-select
            :model-value="settings.hotkey"
            :aria-label="$t('surface.settingsAppshotsPanel.appshotHotkey')"
            class="settings-appshots-panel__select"
            @update:model-value="updateHotkey"
          >
            <el-option label="⌘ + ⌘" value="command" />
            <el-option label="⌥ + ⌥" value="option" />
            <el-option label="⇧ + ⇧" value="shift" />
            <el-option :label="$t('surface.settingsAppshotsPanel.none')" value="none" />
          </el-select>
        </template>
      </FormRow>
      <FormRow
        :title="$t('surface.settingsAppshotsPanel.appshotDestination')"
        :description="$t('surface.settingsAppshotsPanel.chooseWhereAppshotsGoWhenYouUseTheHotkey')"
      >
        <template #control>
          <el-select
            model-value="active-agent"
            :aria-label="$t('surface.settingsAppshotsPanel.appshotDestination')"
            class="settings-appshots-panel__select"
          >
            <el-option :label="$t('surface.settingsAppshotsPanel.activeAgent')" value="active-agent" />
          </el-select>
        </template>
      </FormRow>
      <FormRow
        as="label"
        :title="$t('surface.settingsAppshotsPanel.playSoundEffect')"
        :description="$t('surface.settingsAppshotsPanel.confirmWhenTheFrontmostWindowHasBeenCaptured')"
      >
        <template #control>
          <el-switch
            :model-value="settings.playSound"
            :aria-label="$t('surface.settingsAppshotsPanel.playAppshotSoundEffect')"
            @update:model-value="updatePlaySound"
          />
        </template>
      </FormRow>
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed } from 'vue';
import type { AppshotHotkey, AppshotSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import SettingsIntro from './SettingsIntro.vue';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';

const props = defineProps<{
  settings: AppshotSettings;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
}>();

const hotkeyDescription = computed(() => {
  if (props.settings.hotkey === 'none') return translate('surface.settingsAppshotsPanel.appshotsAreDisabled');
  const label = props.settings.hotkey === 'command' ? translate('surface.settingsAppshotsPanel.command') : props.settings.hotkey === 'option' ? translate('surface.settingsAppshotsPanel.option') : translate('surface.settingsAppshotsPanel.shift');
  return `Press both ${label} keys simultaneously`;
});

function updateHotkey(hotkey: AppshotHotkey): void {
  void props.updateSettings?.({ general: { appshots: { ...props.settings, hotkey } } });
}

function updatePlaySound(playSound: boolean): void {
  void props.updateSettings?.({ general: { appshots: { ...props.settings, playSound } } });
}
</script>

<style scoped>
.settings-appshots-panel__select {
  width: 170px;
}
</style>
