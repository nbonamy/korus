<template>
  <FormSection :title="t('reviewSettings.title')" title-id="settings-workflows-review-title">
    <div class="settings-review__instructions">
      <SettingsTextareaField :model-value="draft" :title="t('reviewSettings.instructions')" :description="t('reviewSettings.description')" :placeholder="t('reviewSettings.placeholder')" :rows="4" @update:model-value="update" />
    </div>
    <FormRow :title="t('reviewSettings.discussWithOriginalThread')" :description="t('reviewSettings.discussWithOriginalThreadDescription')">
      <template #control>
        <el-switch :model-value="discussWithOriginalThread" :aria-label="t('reviewSettings.discussWithOriginalThread')" @update:model-value="updateDiscussWithOriginalThread" />
      </template>
    </FormRow>
    <p v-if="error || discussError" role="alert">{{ error || discussError }}</p>
  </FormSection>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppGeneralSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import { useDebouncedSave } from '../shared/use-debounced-save';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';
import SettingsTextareaField from './SettingsTextareaField.vue';

const props = defineProps<{ settings: AppGeneralSettings; updateSettings?: (input: UpdateSettingsInput) => Promise<void> }>();
const { t } = useI18n();
const discussWithOriginalThread = ref(props.settings.codeReviewDiscussWithOriginalThread === true);
const persistedDiscuss = ref(discussWithOriginalThread.value);
const { schedule: scheduleDiscuss, error: discussError } = useDebouncedSave(async (codeReviewDiscussWithOriginalThread: boolean) => {
  if (!props.updateSettings) throw new Error('Settings client unavailable.');
  await props.updateSettings({ general: { codeReviewDiscussWithOriginalThread } });
  persistedDiscuss.value = codeReviewDiscussWithOriginalThread;
});
function updateDiscussWithOriginalThread(value: boolean) { discussWithOriginalThread.value = value; scheduleDiscuss(value); }
watch(() => props.settings.codeReviewDiscussWithOriginalThread, value => {
  if (discussWithOriginalThread.value === persistedDiscuss.value) discussWithOriginalThread.value = value === true;
  persistedDiscuss.value = value === true;
});
const draft = ref(props.settings.codeReviewInstructions ?? '');
const persisted = ref(draft.value);
const { schedule, error } = useDebouncedSave(async (codeReviewInstructions: string) => {
  if (!props.updateSettings) throw new Error('Settings client unavailable.');
  await props.updateSettings({ general: { codeReviewInstructions } });
  persisted.value = codeReviewInstructions;
});
function update(value: string) { draft.value = value; schedule(value); }
watch(() => props.settings.codeReviewInstructions, value => {
  if (draft.value === persisted.value) draft.value = value ?? '';
  persisted.value = value ?? '';
});
</script>

<style scoped>
.settings-review__instructions {
  padding: var(--space-8);
  border-bottom: 1px solid var(--color-border);
}
</style>
