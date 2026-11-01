<template>
  <FormSection :title="t('delegation.title')" title-id="settings-workflows-delegation-title">
    <FormRow :title="t('delegation.startingContext')" :description="t(draft.worktreeDelegationStartingContext === 'conversation' ? 'delegation.forkDescription' : 'delegation.handoffDescription')">
      <template #control>
        <el-segmented :model-value="draft.worktreeDelegationStartingContext" :options="contextOptions" :aria-label="t('delegation.startingContext')" @update:model-value="updateContext" />
      </template>
    </FormRow>
    <div class="settings-delegation__instructions">
      <SettingsTextareaField :model-value="draft.worktreeDelegationInstructions" :title="t('delegation.instructions')" :description="t('delegation.instructionsDescription')" :placeholder="t('delegation.instructionsPlaceholder')" :rows="4" @update:model-value="updateInstructions" />
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </FormSection>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppGeneralSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import type { DelegationStartingContext } from '@workspace/core/delegation-context';
import { useDebouncedSave } from '../shared/use-debounced-save';
import SettingsTextareaField from './SettingsTextareaField.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';

const props = defineProps<{ settings: AppGeneralSettings; updateSettings?: (input: UpdateSettingsInput) => Promise<void> }>();
const { t } = useI18n();
const contextOptions = computed(() => [
  { label: t('delegation.handoff'), value: 'handoff' },
  { label: t('delegation.conversation'), value: 'conversation' },
]);
const draft = reactive({ worktreeDelegationStartingContext: 'handoff' as DelegationStartingContext, worktreeDelegationInstructions: '' });
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
  if (draft.worktreeDelegationStartingContext === persisted.worktreeDelegationStartingContext) draft.worktreeDelegationStartingContext = props.settings.worktreeDelegationStartingContext ?? 'handoff';
  if (draft.worktreeDelegationInstructions === persisted.worktreeDelegationInstructions) draft.worktreeDelegationInstructions = props.settings.worktreeDelegationInstructions ?? '';
  persisted.worktreeDelegationStartingContext = props.settings.worktreeDelegationStartingContext ?? 'handoff';
  persisted.worktreeDelegationInstructions = props.settings.worktreeDelegationInstructions ?? '';
}, { immediate: true });
</script>

<style scoped>
.settings-delegation__instructions {
  padding: var(--space-8);
  border-top: 1px solid var(--color-border);
}
</style>
