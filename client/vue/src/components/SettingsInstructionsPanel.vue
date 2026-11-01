<template>
  <SettingsPanelFrame :title="$t('surface.instructionSettings.git')" title-id="settings-git-title">
    <template #banner>
      <SettingsIntro kind="git" :title="$t('surface.instructionSettings.gitIntroTitle')" :description="$t('surface.instructionSettings.gitIntroDescription')" />
    </template>
    <SettingsGitWorkflowSection :settings="settings" :update-settings="updateSettings" />
    <FormSection
      class="settings-instructions__worktree-section"
      :title="$t('surface.instructionSettings.worktrees')"
      title-id="settings-git-worktrees-title"
    >
      <template #actions>
        <a class="settings-instructions__worktree-guide" :href="worktreeGuideUrl" target="_blank" rel="noopener noreferrer" @click.prevent="appPlatformActions.openExternal?.(worktreeGuideUrl)">{{ $t('surface.instructionSettings.worktreeInitializationGuide') }}</a>
      </template>
      <FormRow
        :title="$t('surface.instructionSettings.worktreeInitialization')"
        :description="$t('surface.instructionSettings.prepareNewWorktreesBeforeAgentsStart')"
      >
        <template #control>
          <el-select
            class="settings-instructions__worktree-select"
            :model-value="settings.worktreeInitializationMode"
            :aria-label="$t('surface.instructionSettings.worktreeInitialization')"
            @update:model-value="updateWorktreeInitializationMode"
          >
            <el-option :label="$t('surface.instructionSettings.worktreeInitializationAutomatic')" value="automatic" />
            <el-option :label="$t('surface.instructionSettings.worktreeInitializationRepository')" value="repository" />
            <el-option :label="$t('surface.instructionSettings.worktreeInitializationDisabled')" value="off" />
          </el-select>
        </template>
      </FormRow>
    </FormSection>
    <div class="settings-instructions__fields">
      <SettingsTextareaField
        v-for="field in fields"
        :key="field"
        :model-value="draft[field]"
        :title="$t(`surface.instructionSettings.${field}`)"
        :description="$t(`surface.instructionSettings.${field}Description`)"
        :placeholder="$t(`surface.instructionSettings.${field}Placeholder`)"
        @update:model-value="updateInstruction(field, $event)"
      />
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { product } from '@workspace/core/product';
import { appPlatformActions } from '../platform-api';
import { useDebouncedSave } from '../shared/use-debounced-save';
import type { AppGeneralSettings, UpdateSettingsInput, WorktreeInitializationMode } from '@workspace/core/contracts';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsGitWorkflowSection from './SettingsGitWorkflowSection.vue';
import SettingsIntro from './SettingsIntro.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';
import SettingsTextareaField from './SettingsTextareaField.vue';

const props = defineProps<{
  settings: AppGeneralSettings;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
}>();
const worktreeGuideUrl = `${product.repositoryUrl}/wiki/Automatic-worktree-initialization`;
type Field = 'commitMessageInstructions' | 'pullRequestInstructions';
const fields: Field[] = ['commitMessageInstructions', 'pullRequestInstructions'];
const draft = reactive({ commitMessageInstructions: '', pullRequestInstructions: '' });
const persisted = reactive({ ...draft });
const { schedule, error } = useDebouncedSave(async (general: typeof draft) => {
  if (!props.updateSettings) throw new Error('Settings client unavailable.');
  await props.updateSettings({ general });
  Object.assign(persisted, general);
});
function updateWorktreeInitializationMode(value: WorktreeInitializationMode): void {
  void props.updateSettings?.({ general: { worktreeInitializationMode: value } });
}
function updateInstruction(field: Field, value: string): void {
  draft[field] = value;
  schedule({ ...draft });
}
watch(() => [props.settings.commitMessageInstructions, props.settings.pullRequestInstructions], () => {
  for (const field of Object.keys(draft) as Field[]) {
    if (draft[field] === persisted[field]) draft[field] = props.settings[field];
    persisted[field] = props.settings[field];
  }
}, { immediate: true });
</script>

<style scoped>
.settings-instructions__worktree-section { margin-bottom: var(--space-24); }
.settings-instructions__worktree-guide { color: var(--color-primary); font-size: var(--font-size-13); }
.settings-instructions__worktree-select { width: 280px; max-width: 100%; }
.settings-instructions__fields { display: flex; flex-direction: column; gap: var(--space-24); }
</style>
