<template>
  <SettingsPanelFrame :title="t('delegation.title')" title-id="settings-delegation-title">
    <FormSection :title="t('delegation.preferences')" title-id="settings-delegation-preferences-title">
      <FormRow :title="t('delegation.startingContext')" :description="t('delegation.contextDescription')">
        <template #control>
          <el-select :model-value="draft.worktreeDelegationStartingContext" :aria-label="t('delegation.startingContext')" @update:model-value="updateContext">
            <el-option value="conversation" :label="t('delegation.conversation')" />
            <el-option value="handoff" :label="t('delegation.handoff')" />
          </el-select>
        </template>
      </FormRow>
    </FormSection>
    <SettingsTextareaField :model-value="draft.worktreeDelegationInstructions" :title="t('delegation.instructions')" :description="t('delegation.instructionsDescription')" :placeholder="t('delegation.instructionsPlaceholder')" @update:model-value="updateInstructions" />
    <p v-if="error" role="alert">{{ error }}</p>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppGeneralSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import type { DelegationStartingContext } from '@workspace/core/delegation-context';
import { useDebouncedSave } from '../shared/use-debounced-save';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsTextareaField from './SettingsTextareaField.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';

const props = defineProps<{ settings: AppGeneralSettings; updateSettings?: (input: UpdateSettingsInput) => Promise<void> }>();
const { t } = useI18n();
const draft = reactive({ worktreeDelegationStartingContext: 'conversation' as DelegationStartingContext, worktreeDelegationInstructions: '' });
const persisted = reactive({ ...draft });
const { schedule, error } = useDebouncedSave(async (general: typeof draft) => {
  if (!props.updateSettings) throw new Error('Settings client unavailable.');
  await props.updateSettings({ general });
  Object.assign(persisted, general);
});
function updateContext(value: DelegationStartingContext): void {
  draft.worktreeDelegationStartingContext = value;
  schedule({ ...draft });
}
function updateInstructions(value: string): void {
  draft.worktreeDelegationInstructions = value;
  schedule({ ...draft });
}
watch(() => [props.settings.worktreeDelegationStartingContext, props.settings.worktreeDelegationInstructions], () => {
  if (draft.worktreeDelegationStartingContext === persisted.worktreeDelegationStartingContext) draft.worktreeDelegationStartingContext = props.settings.worktreeDelegationStartingContext ?? 'conversation';
  if (draft.worktreeDelegationInstructions === persisted.worktreeDelegationInstructions) draft.worktreeDelegationInstructions = props.settings.worktreeDelegationInstructions ?? '';
  persisted.worktreeDelegationStartingContext = props.settings.worktreeDelegationStartingContext ?? 'conversation';
  persisted.worktreeDelegationInstructions = props.settings.worktreeDelegationInstructions ?? '';
}, { immediate: true });
</script>
