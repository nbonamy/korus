<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsAppearancePanel.appearance')"
    title-id="settings-appearance-title"
  >
    <template #banner>
      <SettingsIntro kind="appearance" :title="$t('surface.settingsAppearancePanel.introTitle')" :description="$t('surface.settingsAppearancePanel.introDescription')" />
    </template>
    <FormSection
      :title="$t('surface.settingsAppearancePanel.color')"
      title-id="settings-appearance-color-title"
    >
      <FormRow
        as="label"
        :title="$t('surface.settingsAppearancePanel.mode')"
        :description="$t('surface.settingsAppearancePanel.chooseHowAppFollowsLightAndDarkAppearances')"
      >
        <template #control>
          <el-segmented
            :model-value="settings.mode"
            :options="modeOptions"
            @update:model-value="updateMode"
          />
        </template>
      </FormRow>
      <FormRow
        as="label"
        :title="$t('surface.settingsAppearancePanel.theme')"
        :description="$t('surface.settingsAppearancePanel.selectTheColorPaletteUsedAcrossTheApp')"
      >
        <template #control>
          <el-select
            class="settings-appearance-panel__theme-select"
            :model-value="settings.id"
            :aria-label="$t('surface.settingsAppearancePanel.theme')"
            @update:model-value="updateThemeId"
          >
            <el-option
              v-for="theme in visibleThemes"
              :key="theme.id"
              :label="theme.name"
              :value="theme.id"
            />
          </el-select>
        </template>
      </FormRow>
    </FormSection>

    <FormSection
      :title="$t('surface.settingsAppearancePanel.typography')"
      title-id="settings-appearance-typography-title"
    >
      <FormGrid>
        <FormField
          density="compact"
          :label="$t('surface.settingsAppearancePanel.chatFontSize')"
          :help="$t('surface.settingsAppearancePanel.adjustConversationTextSize')"
        >
          <el-input-number
            :model-value="settings.chatFontSize"
            :aria-label="$t('surface.settingsAppearancePanel.chatFontSize')"
            :min="11"
            :max="22"
            @update:model-value="updateNumericTheme('chatFontSize', $event)"
          />
        </FormField>
        <FormField
          density="compact"
          :label="$t('surface.settingsAppearancePanel.codeFontSize')"
          :help="$t('surface.settingsAppearancePanel.adjustMonospaceTextSizeInCodeAndCommandOutput')"
        >
          <el-input-number
            :model-value="settings.codeFontSize"
            :aria-label="$t('surface.settingsAppearancePanel.codeFontSize')"
            :min="11"
            :max="22"
            @update:model-value="updateNumericTheme('codeFontSize', $event)"
          />
        </FormField>
      </FormGrid>
    </FormSection>

    <FormSection
      :title="$t('surface.settingsAppearancePanel.diffPreview')"
      title-id="settings-appearance-diff-preview-title"
    >
      <GitDiffPreviewPanel
        class="settings-appearance-panel__diff-preview"
        :diff="diffPreview"
      />
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed } from 'vue';
import type { AppThemeSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsIntro from './SettingsIntro.vue';
import FormField from '../shared/form/FormField.vue';
import FormGrid from '../shared/form/FormGrid.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';
import GitDiffPreviewPanel from './GitDiffPreviewPanel.vue';
import { appThemes, themeIdForAppearance, themeIdForSystemMode } from '../theme/themes';

const props = defineProps<{
  settings: AppThemeSettings;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
}>();

const themes = appThemes;
const visibleThemes = computed(() => {
  if (props.settings.mode === 'system') {
    return themes;
  }

  return themes.filter((theme) => theme.appearance === props.settings.mode);
});
const modeOptions = [
  { label: translate('surface.settingsAppearancePanel.light'), value: 'light' },
  { label: translate('surface.settingsAppearancePanel.dark'), value: 'dark' },
  { label: translate('surface.settingsAppearancePanel.system'), value: 'system' },
];
const diffPreview = [
  'diff --git a/src/theme.ts b/src/theme.ts',
  '--- a/src/theme.ts',
  '+++ b/src/theme.ts',
  '@@ -29,5 +29,5 @@',
  ' export const appearance = {',
  "-  accent: 'blue',",
  "+  accent: 'app',",
  "   mode: 'system',",
  ' };',
].join('\n');

function updateTheme(theme: Partial<AppThemeSettings>): void {
  void props.updateSettings?.({ theme });
}

function updateMode(mode: string | number): void {
  if (mode !== 'dark' && mode !== 'light' && mode !== 'system') {
    return;
  }

  if (mode === 'system') {
    const systemThemeId = themeIdForSystemMode(props.settings.id);
    updateTheme({ mode, ...(systemThemeId !== props.settings.id ? { id: systemThemeId } : {}) });
    return;
  }

  const currentTheme = themes.find((theme) => theme.id === props.settings.id);
  const nextThemeId = currentTheme?.appearance === mode
    ? currentTheme.id
    : themeIdForAppearance(props.settings.id, mode);

  updateTheme({
    mode,
    ...(nextThemeId ? { id: nextThemeId } : {}),
  });
}

function updateThemeId(id: string): void {
  updateTheme({ id });
}

function updateNumericTheme(key: 'chatFontSize' | 'codeFontSize' | 'uiFontSize', value: number | null): void {
  if (typeof value !== 'number') {
    return;
  }

  updateTheme({ [key]: value });
}
</script>

<style scoped>
.settings-appearance-panel__theme-select {
  width: 220px;
}

.settings-appearance-panel__diff-preview {
  max-height: 280px;
}
</style>
